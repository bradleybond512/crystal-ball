/**
 * Globe4DManager — orchestrator for God's Eye 4D mode.
 *
 * Wires swimlane + playback + trails + pillars + degradation + predictions +
 * branching behind a single enable() / disable() lifecycle. Hosts plug into
 * the broadcast via {@link onChange} for HUD updates.
 */

import type { GlobeDataManager } from '@/components/GlobeDataManager';
import type { GlobeTimeMachine } from '@/components/GlobeTimeMachine';
import type { GlobeHUD } from '@/components/GlobeHUD';
import type { AutoFollowEngine } from '@/components/gods-vision/AutoFollowEngine';
import type { Viewer } from 'cesium';
import { GlobeSwimlane } from '@/components/gods-vision/GlobeSwimlane';
import { GlobePlayback } from '@/components/gods-vision/GlobePlayback';
import type { PlaybackMode } from '@/components/gods-vision/GlobePlayback';
import { GlobeTrails } from '@/components/gods-vision/GlobeTrails';
import { GlobePillars } from '@/components/gods-vision/GlobePillars';
import { GlobeDegradation } from '@/components/gods-vision/GlobeDegradation';
import { GlobePredictions } from '@/components/gods-vision/GlobePredictions';
import { GlobeBranching } from '@/components/gods-vision/GlobeBranching';
import type {
  AftershockForecast,
  BranchingForecast,
  ForecastCone,
} from '@/services/forecast-engine';

export type { PlaybackMode } from '@/components/gods-vision/GlobePlayback';

export interface Globe4DState {
  /** True when the user has toggled 4D mode on (e.g. via the `T` key). */
  active: boolean;
  /** Currently selected playback mode. Defaults to documentary. */
  playbackMode: PlaybackMode;
  /** Active trail count — populated when GlobeTrails lands. */
  trailCount: number;
  /** Forecast-entity count — populated when GlobeDegradation lands. */
  forecastCount: number;
}

export interface Globe4DManagerDeps {
  hud?: GlobeHUD | null;
  timeMachine?: GlobeTimeMachine | null;
  dataManager?: GlobeDataManager | null;
  autoFollow?: AutoFollowEngine | null;
  /** Cesium viewer needed for trails + pillars (Cesium-rendered overlays). */
  viewer?: Viewer | null;
  /** DOM node the swimlane mounts into. Usually the God's Eye container. */
  overlayContainer?: HTMLElement | null;
}

const HUD_REFRESH_MS = 1000;

const SWIMLANE_REFRESH_MS = 1500;

export class Globe4DManager {
  private state: Globe4DState = {
    active: false,
    playbackMode: 'documentary',
    trailCount: 0,
    forecastCount: 0,
  };
  private listeners: ((state: Readonly<Globe4DState>) => void)[] = [];
  private deps: Globe4DManagerDeps;
  private unsubTimeChange: (() => void) | null = null;
  private swimlane: GlobeSwimlane | null = null;
  private swimlaneRefreshId: ReturnType<typeof setInterval> | null = null;
  private playback: GlobePlayback | null = null;
  private trails: GlobeTrails | null = null;
  private pillars: GlobePillars | null = null;
  private degradation: GlobeDegradation | null = null;
  private predictions: GlobePredictions | null = null;
  private branching: GlobeBranching | null = null;
  private hudRefreshId: ReturnType<typeof setInterval> | null = null;

  constructor(deps: Globe4DManagerDeps) {
    this.deps = deps;
  }

  /** Idempotent enable. Wires sub-components when they exist. */
  enable(): void {
    if (this.state.active) return;
    this.state = { ...this.state, active: true };
    document.body.classList.add('gods-eye-4d-active');

    this.mountSwimlane();
    this.mountPlayback();
    this.mountVisualOverlays();
    this.startHudCounterRefresh();

    // Drive swimlane NOW line + degradation pipeline from time-machine state.
    this.unsubTimeChange = this.deps.timeMachine?.onTimeChange((ms) => {
      this.swimlane?.updateNow(ms);
      this.degradation?.applyDegradation(ms);
    }) ?? null;

    this.broadcast();
  }

  /** Idempotent disable. Tears down any active sub-component. */
  disable(): void {
    if (!this.state.active) return;
    this.state = { ...this.state, active: false };
    document.body.classList.remove('gods-eye-4d-active');

    if (this.unsubTimeChange) {
      this.unsubTimeChange();
      this.unsubTimeChange = null;
    }

    this.stopHudCounterRefresh();
    this.unmountVisualOverlays();
    this.unmountPlayback();
    this.unmountSwimlane();

    this.broadcast();
  }

  toggle(): void {
    if (this.state.active) this.disable();
    else this.enable();
  }

  isActive(): boolean { return this.state.active; }

  setPlaybackMode(mode: PlaybackMode): void {
    if (this.state.playbackMode === mode) return;
    this.state = { ...this.state, playbackMode: mode };
    this.playback?.setMode(mode);
    this.broadcast();
  }

  /** Play/pause the active playback engine. No-op if 4D is off. */
  togglePlayback(): void {
    this.playback?.toggle();
  }

  /** Collapse / expand the swimlane. No-op if 4D is off. */
  toggleSwimlaneCollapse(): void {
    this.swimlane?.toggleCollapse();
  }

  /** Step swimlane zoom one preset finer (1h ← 6h ← 24h ← 7d ← 30d). */
  swimlaneZoomIn(): void { this.swimlane?.zoomIn(); }

  /** Step swimlane zoom one preset coarser. */
  swimlaneZoomOut(): void { this.swimlane?.zoomOut(); }

  getState(): Readonly<Globe4DState> { return this.state; }

  /**
   * Subscribe to 4D state changes. Returns an unsubscribe function.
   * Listeners are invoked synchronously after state is updated.
   */
  onChange(listener: (state: Readonly<Globe4DState>) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  destroy(): void {
    this.disable();
    this.listeners = [];
  }

  private mountSwimlane(): void {
    const container = this.deps.overlayContainer;
    const dataManager = this.deps.dataManager;
    if (!container || !dataManager) return; // running headless or pre-mount

    this.swimlane = new GlobeSwimlane(container);
    this.swimlane.setOnTimeChange((ms) => { this.deps.timeMachine?.setTime(ms); });
    this.swimlane.setOnEventClick((block) => {
      // Future PR (Tier 2 deep analysis) will fly camera to block.lat/lon
      // and open prediction overlays. For now, just scrub time to the event.
      this.deps.timeMachine?.setTime(block.startMs);
    });
    this.swimlane.setOnLaneToggle((category) => {
      // Lane labels toggle the contributing data layers. The mapping lives
      // in GlobeDataManager (SWIMLANE_CATEGORY_MAP) but isn't currently
      // exported; for the swimlane MVP we leave this as a no-op hook so
      // future PRs can wire layer visibility via a public method.
      // eslint-disable-next-line no-console
      console.debug('[Globe4DManager] lane toggle (no-op pending layer-visibility hook):', category);
    });
    this.swimlane.mount();
    this.refreshSwimlaneBlocks();
    this.swimlaneRefreshId = setInterval(() => this.refreshSwimlaneBlocks(), SWIMLANE_REFRESH_MS);
  }

  private unmountSwimlane(): void {
    if (this.swimlaneRefreshId != null) {
      clearInterval(this.swimlaneRefreshId);
      this.swimlaneRefreshId = null;
    }
    this.swimlane?.destroy();
    this.swimlane = null;
  }

  private refreshSwimlaneBlocks(): void {
    if (!this.deps.dataManager) return;
    try {
      const blocks = this.deps.dataManager.getEventBlocks();
      this.swimlane?.updateBlocks(blocks);
      this.playback?.updateEventBlocks(blocks);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Globe4DManager] getEventBlocks failed', error);
    }
  }

  private mountPlayback(): void {
    const timeMachine = this.deps.timeMachine;
    if (!timeMachine) return;
    this.playback = new GlobePlayback(timeMachine, this.deps.autoFollow ?? null);
    this.playback.setMode(this.state.playbackMode);
    this.playback.setOnModeChange((mode) => {
      if (this.state.playbackMode !== mode) {
        this.state = { ...this.state, playbackMode: mode };
        this.broadcast();
      }
    });
  }

  private unmountPlayback(): void {
    this.playback?.destroy();
    this.playback = null;
  }

  private mountVisualOverlays(): void {
    const viewer = this.deps.viewer;
    const dataManager = this.deps.dataManager;
    if (!viewer || !dataManager) return;
    this.trails = new GlobeTrails(viewer, dataManager);
    this.trails.mount();
    this.pillars = new GlobePillars(viewer, dataManager);
    this.pillars.mount();
    this.degradation = new GlobeDegradation(viewer, dataManager);
    // Apply once on enable so any forecast entities visible at NOW are
    // immediately degraded; subsequent updates ride the time-change hook.
    const initialMs = this.deps.timeMachine?.getCurrentMs() ?? Date.now();
    this.degradation.applyDegradation(initialMs);
    this.predictions = new GlobePredictions(viewer);
    this.predictions.mount();
    this.branching = new GlobeBranching(viewer);
    this.branching.mount();
  }

  private unmountVisualOverlays(): void {
    this.trails?.destroy();
    this.trails = null;
    this.pillars?.destroy();
    this.pillars = null;
    this.degradation?.destroy();
    this.degradation = null;
    this.predictions?.destroy();
    this.predictions = null;
    this.branching?.destroy();
    this.branching = null;
  }

  /** Imperative Tier 2 overlay API. Wired into entity click/hover by
   * GodsEyeView in a follow-up; today the API surface is here so callers
   * can invoke it with a known-good shape. */
  showPredictionCone(cone: ForecastCone): void { this.predictions?.showCone(cone); }
  showAftershockForecast(forecast: AftershockForecast): void {
    this.predictions?.showAftershock(forecast);
  }
  showBranchingForecast(forecast: BranchingForecast): void {
    this.branching?.showBranches(forecast);
  }
  clearTier2(): void {
    this.predictions?.clear();
    this.branching?.clear();
  }
  hasActiveTier2(): boolean {
    return (this.predictions?.hasActive() ?? false) || (this.branching?.hasActive() ?? false);
  }

  private startHudCounterRefresh(): void {
    if (!this.deps.hud) return;
    this.tickHudCounters();
    this.hudRefreshId = setInterval(() => this.tickHudCounters(), HUD_REFRESH_MS);
  }

  private tickHudCounters(): void {
    const trailCount = this.trails?.activeTrailCount ?? 0;
    const forecastCount = this.degradation?.forecastEntityCount ?? this.pillars?.activePillarCount ?? 0;
    if (this.state.trailCount !== trailCount || this.state.forecastCount !== forecastCount) {
      this.state = { ...this.state, trailCount, forecastCount };
      this.broadcast();
    }
  }

  private stopHudCounterRefresh(): void {
    if (this.hudRefreshId) {
      clearInterval(this.hudRefreshId);
      this.hudRefreshId = null;
    }
    this.state = { ...this.state, trailCount: 0, forecastCount: 0 };
  }

  private broadcast(): void {
    for (const listener of this.listeners) {
      try { listener(this.state); }
      catch (error) {
        // eslint-disable-next-line no-console
        console.error('[Globe4DManager] listener threw', error);
      }
    }
  }
}

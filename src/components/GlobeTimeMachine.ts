import { JulianDate, type Viewer } from 'cesium';
import type { GlobeDataManager } from '@/components/GlobeDataManager';

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 200;
const SPEEDS = new Set([1, 4, 16, 64]);

export interface GlobeTimeMachineState {
  readonly cursorMs: number;
  readonly anchorMs: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly mode: 'latest' | 'selected';
}

export class GlobeTimeMachine {
  private currentMs = Date.now();
  private anchorMs = this.currentMs;
  private playing = false;
  private speed = 1;
  private live = true;
  private mounted = false;
  private timerId: number | null = null;
  private generation = 0;
  private lastTick = 0;
  private timeChangeListeners: ((ms: number) => void)[] = [];
  private stateChangeListeners: ((state: GlobeTimeMachineState) => void)[] = [];
  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.pause();
  };

  constructor(
    private viewer: Viewer,
    private dataManager: GlobeDataManager,
  ) {}

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.snapToNow();
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.stopPlayback();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.timeChangeListeners = [];
    this.stateChangeListeners = [];
    this.dataManager.applyTimeFilter(null);
  }

  getCurrentMs(): number { return this.currentMs; }
  getSpeed(): number { return this.speed; }
  isPlaying(): boolean { return this.playing; }
  isLive(): boolean { return this.live; }

  getState(): GlobeTimeMachineState {
    return Object.freeze({
      cursorMs: this.currentMs,
      anchorMs: this.anchorMs,
      playing: this.playing,
      speed: this.speed,
      mode: this.live ? 'latest' : 'selected',
    });
  }

  onTimeChange(listener: (ms: number) => void): () => void {
    this.timeChangeListeners.push(listener);
    return () => {
      this.timeChangeListeners = this.timeChangeListeners.filter(l => l !== listener);
    };
  }

  onStateChange(listener: (state: GlobeTimeMachineState) => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter(l => l !== listener);
    };
  }

  setTime(ms: number): void {
    if (!this.mounted || !Number.isFinite(ms)) return;
    this.stopPlayback();
    this.commitCursor(Math.max(this.anchorMs - DAY_MS, Math.min(this.anchorMs, ms)), false);
  }

  play(): void {
    if (!this.mounted || this.playing || document.hidden) return;
    this.playing = true;
    this.viewer.clock.shouldAnimate = false;
    this.lastTick = performance.now();
    if (this.currentMs >= this.anchorMs) this.commitCursor(this.anchorMs - DAY_MS, false);
    else this.notifyStateChange();
    this.scheduleTick();
  }

  pause(): void {
    if (!this.mounted) return;
    this.stopPlayback();
    this.dataManager.applyTimeFilter(this.live ? null : this.currentMs);
    this.notifyStateChange();
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(multiplier: number): void {
    if (!this.mounted || !SPEEDS.has(multiplier)) return;
    this.speed = multiplier;
    this.viewer.clock.multiplier = multiplier;
    this.notifyStateChange();
  }

  snapToNow(): void {
    if (!this.mounted) return;
    this.stopPlayback();
    this.anchorMs = Date.now();
    this.commitCursor(this.anchorMs, true);
  }

  private stopPlayback(): void {
    this.playing = false;
    this.viewer.clock.shouldAnimate = false;
    this.generation++;
    if (this.timerId !== null) window.clearTimeout(this.timerId);
    this.timerId = null;
  }

  private scheduleTick(): void {
    if (!this.mounted || !this.playing) return;
    const generation = this.generation;
    this.timerId = window.setTimeout(() => {
      if (!this.mounted || !this.playing || generation !== this.generation) return;
      this.timerId = null;
      if (document.hidden) {
        this.pause();
        return;
      }
      const now = performance.now();
      const next = Math.min(this.anchorMs, this.currentMs + (now - this.lastTick) * this.speed);
      this.lastTick = now;
      if (next === this.anchorMs) this.stopPlayback();
      this.commitCursor(next, false);
      if (generation === this.generation) this.scheduleTick();
    }, TICK_MS);
  }

  private commitCursor(ms: number, live: boolean): void {
    this.currentMs = ms;
    this.live = live;
    this.viewer.clock.shouldAnimate = false;
    this.viewer.clock.currentTime = JulianDate.fromDate(new Date(ms));
    this.dataManager.applyTimeFilter(live ? null : ms);
    this.notifyStateChange();
    for (const listener of this.timeChangeListeners) {
      try { listener(ms); }
      catch (error) {
        // eslint-disable-next-line no-console
        console.error('[GlobeTimeMachine] time-change listener threw', error);
      }
    }
  }

  private notifyStateChange(): void {
    const state = this.getState();
    for (const listener of this.stateChangeListeners) {
      try { listener(state); }
      catch (error) {
        // eslint-disable-next-line no-console
        console.error('[GlobeTimeMachine] state-change listener threw', error);
      }
    }
  }
}

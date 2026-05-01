/**
 * GlobeSwimlane — multi-lane temporal timeline overlay for God's Eye 4D mode.
 *
 * DOM-based overlay (no Cesium primitives). Receives event blocks from
 * GlobeDataManager and broadcasts time-scrub / event-click / lane-toggle
 * intents back to the orchestrator (Globe4DManager).
 *
 * Spec: docs/superpowers/specs/2026-04-13-gods-eye-4d-design.md
 * Plan: docs/superpowers/plans/2026-04-13-gods-eye-4d.md (Task 4)
 */

import type { EventBlock } from '@/components/GlobeDataManager';

interface LaneConfig {
  key: EventBlock['category'];
  label: string;
  color: string;
}

const LANES: readonly LaneConfig[] = [
  { key: 'conflicts', label: 'CONFLICTS', color: '#ff3333' },
  { key: 'disasters', label: 'DISASTERS', color: '#ffa500' },
  { key: 'military',  label: 'MILITARY',  color: '#00c8ff' },
  { key: 'seismic',   label: 'SEISMIC',   color: '#ffc800' },
  { key: 'cyber',     label: 'CYBER',     color: '#00ffaa' },
  { key: 'weather',   label: 'WEATHER',   color: '#8682ff' },
] as const;

const ZOOM_PRESETS: readonly { key: string; ms: number }[] = [
  { key: '1h',  ms: 3_600_000 },
  { key: '6h',  ms: 21_600_000 },
  { key: '24h', ms: 86_400_000 },
  { key: '7d',  ms: 604_800_000 },
  { key: '30d', ms: 2_592_000_000 },
] as const;

const DEFAULT_ZOOM_KEY = '24h';
const PAST_RATIO = 0.58; // 58% of viewport is past, 42% future
const NOW_LINE_REFRESH_MS = 250;
const TRACK_LEFT_PX = 70; // matches .ge-lane-label width

export class GlobeSwimlane {
  private container: HTMLElement;
  private root: HTMLElement | null = null;
  private lanesContainer: HTMLElement | null = null;
  private nowLine: HTMLElement | null = null;
  private tooltip: HTMLElement | null = null;
  private collapsed = false;
  private zoomKey = DEFAULT_ZOOM_KEY;
  private zoomMs = ZOOM_PRESETS.find(z => z.key === DEFAULT_ZOOM_KEY)?.ms ?? 86_400_000;
  private nowMs = Date.now();
  private destroyed = false;
  private blocks: EventBlock[] = [];
  private zoomPills = new Map<string, HTMLElement>();
  private laneTrackEls = new Map<EventBlock['category'], HTMLElement>();
  private laneLabels = new Map<EventBlock['category'], HTMLElement>();
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;

  private onTimeChangeCb: ((ms: number) => void) | null = null;
  private onEventClickCb: ((block: EventBlock) => void) | null = null;
  private onLaneToggleCb: ((category: EventBlock['category']) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setOnTimeChange(cb: (ms: number) => void): void { this.onTimeChangeCb = cb; }
  setOnEventClick(cb: (block: EventBlock) => void): void { this.onEventClickCb = cb; }
  setOnLaneToggle(cb: (category: EventBlock['category']) => void): void { this.onLaneToggleCb = cb; }

  mount(): void {
    if (this.root) return; // idempotent
    this.root = document.createElement('div');
    this.root.className = 'ge-swimlane expanded';
    this.buildHeader();
    this.buildLanes();
    this.buildTooltip();
    this.container.append(this.root);
    this.startNowLineUpdate();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimeout != null) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
    this.root?.remove();
    this.root = null;
    this.tooltip?.remove();
    this.tooltip = null;
    this.zoomPills.clear();
    this.laneTrackEls.clear();
    this.laneLabels.clear();
  }

  updateBlocks(blocks: EventBlock[]): void {
    this.blocks = blocks;
    this.renderBlocks();
  }

  updateNow(ms: number): void {
    this.nowMs = ms;
    this.renderBlocks();
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    if (!this.root) return;
    this.root.className = `ge-swimlane ${this.collapsed ? 'collapsed' : 'expanded'}`;
    if (this.lanesContainer) {
      this.lanesContainer.style.display = this.collapsed ? 'none' : '';
    }
  }

  zoomIn(): void {
    const idx = ZOOM_PRESETS.findIndex(z => z.key === this.zoomKey);
    const next = idx > 0 ? ZOOM_PRESETS[idx - 1] : undefined;
    if (next) this.setZoom(next.key);
  }

  zoomOut(): void {
    const idx = ZOOM_PRESETS.findIndex(z => z.key === this.zoomKey);
    const next = idx !== -1 && idx < ZOOM_PRESETS.length - 1 ? ZOOM_PRESETS[idx + 1] : undefined;
    if (next) this.setZoom(next.key);
  }

  get isCollapsed(): boolean { return this.collapsed; }
  get zoomLabel(): string { return this.zoomKey; }

  private setZoom(key: string): void {
    const preset = ZOOM_PRESETS.find(z => z.key === key);
    if (!preset) return;
    this.zoomKey = key;
    this.zoomMs = preset.ms;
    for (const [k, el] of this.zoomPills) {
      el.classList.toggle('active', k === key);
    }
    this.renderBlocks();
  }

  private buildHeader(): void {
    if (!this.root) return;
    const header = document.createElement('div');
    header.className = 'ge-swimlane-header';

    const left = document.createElement('div');
    left.className = 'ge-swimlane-header-left';
    const title = document.createElement('div');
    title.className = 'ge-swimlane-title';
    title.textContent = '4D TIMELINE';
    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'ge-pill-group';
    for (const preset of ZOOM_PRESETS) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `ge-pill${preset.key === this.zoomKey ? ' active' : ''}`;
      pill.textContent = preset.key;
      pill.addEventListener('click', () => this.setZoom(preset.key));
      zoomGroup.append(pill);
      this.zoomPills.set(preset.key, pill);
    }
    left.append(title, zoomGroup);

    const right = document.createElement('div');
    right.className = 'ge-swimlane-controls';
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'ge-pill';
    collapseBtn.title = 'Collapse swimlane';
    collapseBtn.textContent = '▼';
    collapseBtn.addEventListener('click', () => this.toggleCollapse());
    right.append(collapseBtn);

    header.append(left, right);
    this.root.append(header);
  }

  private buildLanes(): void {
    if (!this.root) return;
    this.lanesContainer = document.createElement('div');
    this.lanesContainer.className = 'ge-swimlane-lanes';

    this.nowLine = document.createElement('div');
    this.nowLine.className = 'ge-now-line';
    this.nowLine.title = 'Drag to scrub time';
    const nowLabel = document.createElement('div');
    nowLabel.className = 'ge-now-label';
    nowLabel.textContent = 'NOW';
    this.nowLine.append(nowLabel);
    this.lanesContainer.append(this.nowLine);

    this.nowLine.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.beginScrubDrag();
    });

    for (const lane of LANES) {
      const row = document.createElement('div');
      row.className = `ge-lane ge-lane-${lane.key}`;
      row.style.setProperty('--ge-lane-color', lane.color);

      const label = document.createElement('div');
      label.className = 'ge-lane-label';
      label.textContent = lane.label;
      label.title = `Toggle ${lane.label.toLowerCase()} layer`;
      label.addEventListener('click', () => this.onLaneToggleCb?.(lane.key));
      this.laneLabels.set(lane.key, label);

      const track = document.createElement('div');
      track.className = 'ge-lane-track';
      this.laneTrackEls.set(lane.key, track);

      row.append(label, track);
      this.lanesContainer.append(row);
    }

    this.root.append(this.lanesContainer);
  }

  private buildTooltip(): void {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'ge-swimlane-tooltip';
    this.tooltip.style.display = 'none';
    this.container.append(this.tooltip);
  }

  private beginScrubDrag(): void {
    // The two arrow functions form a paired add/remove pair so they share
    // closure state — extracting them to module scope would lose the `this`
    // and bound-listener identity required for removeEventListener. The
    // unicorn/consistent-function-scoping rule does not handle paired
    // event-listener teardown well; disable on the two handlers below.
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const onMove = (ev: MouseEvent): void => this.scrubFromClientX(ev.clientX);
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private scrubFromClientX(clientX: number): void {
    const track = this.laneTrackEls.values().next().value;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const windowStart = this.nowMs - this.zoomMs * PAST_RATIO;
    const timeAtPct = windowStart + pct * this.zoomMs;
    this.onTimeChangeCb?.(timeAtPct);
  }

  private renderBlocks(): void {
    const now = this.nowMs;
    const windowStart = now - this.zoomMs * PAST_RATIO;
    const windowEnd = windowStart + this.zoomMs;

    for (const [category, track] of this.laneTrackEls) {
      while (track.firstChild) track.firstChild.remove();

      const categoryBlocks = this.blocks.filter(b => b.category === category);
      for (const block of categoryBlocks) {
        if (block.endMs < windowStart || block.startMs > windowEnd) continue;
        const leftPct = Math.max(0, ((block.startMs - windowStart) / this.zoomMs) * 100);
        const widthPct = Math.max(0.5, Math.min(100 - leftPct, ((block.endMs - block.startMs) / this.zoomMs) * 100));
        const el = document.createElement('div');
        el.className = `ge-event-block ${block.isForecast ? 'forecast' : 'past'}`;
        el.style.left = `${leftPct}%`;
        el.style.width = `${widthPct}%`;
        el.addEventListener('click', () => this.onEventClickCb?.(block));
        el.addEventListener('mouseenter', (ev) => this.showTooltip(ev, block));
        el.addEventListener('mouseleave', () => this.hideTooltip());
        track.append(el);
      }
    }

    if (this.nowLine) {
      const pct = ((now - windowStart) / this.zoomMs) * 100;
      this.nowLine.style.left = `calc(${TRACK_LEFT_PX}px + ${pct}%)`;
    }
  }

  private showTooltip(e: MouseEvent, block: EventBlock): void {
    if (!this.tooltip) return;
    const name = block.name.length > 50 ? `${block.name.slice(0, 47)}...` : block.name;
    const start = new Date(block.startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const end = new Date(block.endMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.tooltip.textContent = `${name} — ${start} to ${end}`;
    this.tooltip.style.display = '';
    this.tooltip.style.left = `${e.clientX + 12}px`;
    this.tooltip.style.top = `${e.clientY - 24}px`;
  }

  private hideTooltip(): void {
    if (this.tooltip) this.tooltip.style.display = 'none';
  }

  private startNowLineUpdate(): void {
    const tick = (): void => {
      if (this.destroyed) return;
      this.renderBlocks();
      this.refreshTimeout = setTimeout(tick, NOW_LINE_REFRESH_MS);
    };
    tick();
  }
}

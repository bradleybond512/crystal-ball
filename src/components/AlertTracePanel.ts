/**
 * Alert Trace Panel — "Why did/didn't I get warned?" pipeline tracer UI.
 *
 * Lets the operator pick a recent ObservationEvent from the in-memory
 * store and renders the six pipeline stages as a vertical timeline with
 * pass/fail/skip indicators + plain-English explanations. Zero network
 * calls on trace — every stage is pure local computation.
 */

import { Panel } from './Panel';
import { traceAlert, type AlertTrace, type AlertTraceStage, type AlertTraceStageStatus } from '@/services/notifications/alert-trace';
import { getRecent } from '@/services/intelligence/observation-store';
import { getSettings } from '@/services/notifications/notification-settings-service';
import { getSavedPlaces } from '@/services/saved-places';
import { escapeHtml } from '@/utils/sanitize';
import type { ObservationEvent } from '@/types/intelligence';

const REFRESH_MS = 5000;
const MAX_EVENTS = 50;

const STATUS_COLOR: Record<AlertTraceStageStatus, string> = {
  pass: '#4caf50',
  fail: '#f44336',
  skip: '#9e9e9e',
};

const STATUS_LABEL: Record<AlertTraceStageStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
};

const OUTCOME_COLOR: Record<AlertTrace['outcome'], string> = {
  delivered: '#4caf50',
  suppressed: '#f44336',
  'not-evaluated': '#9e9e9e',
};

const OUTCOME_LABEL: Record<AlertTrace['outcome'], string> = {
  delivered: 'DELIVERED',
  suppressed: 'SUPPRESSED',
  'not-evaluated': 'NOT EVALUATED',
};

export class AlertTracePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private selectedEventId: string | null = null;
  private cachedEvents: ObservationEvent[] = [];
  private onChange: (() => void) | null = null;

  constructor() {
    super({
      id: 'alert-trace',
      title: 'Alert Trace',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        '"Why did/didn\'t I get warned?" — replays an event through the 6-stage notification pipeline (source-receipt → normalization → relevance → quiet-hours → threshold → delivery) and shows where it was suppressed.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    // Re-render when notification settings change so the trace reflects
    // the freshest threshold / quiet-hours / channel configuration.
    this.onChange = () => this.render();
    if (typeof document !== 'undefined') {
      document.addEventListener('wm:notification-settings-changed', this.onChange);
    }
    if (this.content) {
      this.content.addEventListener('change', this.onSelectChange);
    }
  }

  private readonly onSelectChange = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.role !== 'alert-trace-event-select') return;
    this.selectedEventId = target.value || null;
    this.render();
  };

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.onChange && typeof document !== 'undefined') {
      document.removeEventListener('wm:notification-settings-changed', this.onChange);
      this.onChange = null;
    }
    if (this.content) {
      this.content.removeEventListener('change', this.onSelectChange);
    }
  }

  private render(): void {
    this.cachedEvents = getRecent(MAX_EVENTS);

    if (this.cachedEvents.length === 0) {
      this.setCount(0);
      this.setContent(this.renderEmptyState());
      return;
    }

    // Default to the most recent event if none selected, or if the selection went stale.
    if (!this.selectedEventId || !this.cachedEvents.some((e) => e.id === this.selectedEventId)) {
      this.selectedEventId = this.cachedEvents[0]?.id ?? null;
    }
    const selected = this.cachedEvents.find((e) => e.id === this.selectedEventId);
    if (!selected) {
      this.setContent(this.renderEmptyState());
      return;
    }

    const settings = getSettings();
    const places = getSavedPlaces();
    const trace = traceAlert(selected, settings, places);
    this.setCount(trace.stages.filter((s) => s.status === 'fail').length);

    this.setContent(this.renderTrace(trace, this.cachedEvents, selected.id));
  }

  private renderEmptyState(): string {
    return `<div style="padding:16px;color:var(--text-secondary,#aaa);font-size:12px;">
      No recent observation events available. Once events flow through the intelligence
      pipeline they appear here for replay.
    </div>`;
  }

  private renderTrace(trace: AlertTrace, events: ObservationEvent[], selectedId: string): string {
    const outcomeColor = OUTCOME_COLOR[trace.outcome];
    const outcomeLabel = OUTCOME_LABEL[trace.outcome];

    const optionsHtml = events
      .slice(0, MAX_EVENTS)
      .map((e) => {
        const label = `${new Date(e.timestamp).toISOString().slice(11, 19)} · ${e.severity} · ${e.title}`;
        const selectedAttr = e.id === selectedId ? ' selected' : '';
        return `<option value="${escapeHtml(e.id)}"${selectedAttr}>${escapeHtml(label)}</option>`;
      })
      .join('');

    const timeline = trace.stages.map((s, i) => this.renderStage(s, i === trace.stages.length - 1)).join('');

    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      <div>
        <label style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;display:block;margin-bottom:4px;">Event</label>
        <select data-role="alert-trace-event-select"
                style="width:100%;padding:6px 8px;background:var(--surface-1,#111);color:#e5e5e5;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">
          ${optionsHtml}
        </select>
      </div>

      <div data-outcome="${escapeHtml(trace.outcome)}"
           style="padding:10px 12px;background:${withAlpha(outcomeColor, 0.1)};border-left:3px solid ${outcomeColor};border-radius:3px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <strong style="color:${outcomeColor};font-size:13px;letter-spacing:0.05em;">${outcomeLabel}</strong>
          <span style="font-size:10px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(trace.eventId)}</span>
        </div>
        <div style="margin-top:4px;font-size:12px;color:#e5e5e5;">${escapeHtml(trace.summary)}</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:0;">${timeline}</div>
    </div>`;
  }

  private renderStage(stage: AlertTraceStage, isLast: boolean): string {
    const color = STATUS_COLOR[stage.status];
    const label = STATUS_LABEL[stage.status];
    const valueHtml = stage.value === undefined
      ? ''
      : `<span style="margin-left:6px;font-family:ui-monospace,monospace;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(String(stage.value))}</span>`;
    const connector = isLast
      ? ''
      : `<div style="margin-left:5px;width:2px;height:18px;background:${color};opacity:0.5;"></div>`;

    return `<div data-stage="${escapeHtml(stage.name)}" data-status="${escapeHtml(stage.status)}" style="display:flex;flex-direction:column;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="flex:0 0 12px;width:12px;height:12px;border-radius:50%;background:${color};margin-top:3px;"></div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:12px;font-weight:600;color:#e5e5e5;">${escapeHtml(stage.name)}</span>
            <span style="font-size:10px;color:${color};letter-spacing:0.05em;">${label}${valueHtml}</span>
          </div>
          <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(stage.detail)}</div>
        </div>
      </div>
      ${connector}
    </div>`;
  }
}

function withAlpha(hexColor: string, alpha: number): string {
  // Accept '#rgb' / '#rrggbb' / 'rgba(...)' fall-throughs.
  if (!hexColor.startsWith('#')) return hexColor;
  const hex = hexColor.length === 4
    ? `${hexColor[1]!}${hexColor[1]!}${hexColor[2]!}${hexColor[2]!}${hexColor[3]!}${hexColor[3]!}`
    : hexColor.slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

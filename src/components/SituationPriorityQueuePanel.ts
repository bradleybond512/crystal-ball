/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Situation Priority Queue Panel — operator's "what should I look at
 * next?" view. Renders the ranked queue with rank number, urgency bar,
 * severity badge, domain chip, confidence %, time-ago. Top-of-panel
 * weight sliders let the operator re-tune the four axes; weights
 * normalize so they always sum to 1 and the queue re-ranks on the fly.
 */

import { Panel } from './Panel';
import {
  getSituationPriorityQueueService,
  type PriorityEntry,
  type PriorityWeights,
} from '@/services/intelligence/situation-priority-queue';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const DISPLAY_LIMIT = 50;

const SEVERITY_BADGE: Record<string, string> = {
  critical: '#ff453a',
  high: '#ff9800',
  medium: '#ffb74d',
  low: '#9e9e9e',
  unknown: '#616161',
};

const SLIDER_AXES: readonly { key: keyof PriorityWeights; label: string }[] = [
  { key: 'severity', label: 'Severity' },
  { key: 'recency', label: 'Recency' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'domainWeight', label: 'Domain' },
];

export class SituationPriorityQueuePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;

  constructor() {
    super({
      id: 'situation-priority-queue',
      title: 'Situation Priority Queue',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Ranked list of active Situations sorted by urgency. Urgency = weighted blend of severity, recency, confidence, and domain weight. Adjust the sliders to re-rank the queue.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getSituationPriorityQueueService().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private render(): void {
    const svc = getSituationPriorityQueueService();
    const snapshot = svc.getSnapshot();
    const entries = snapshot.entries.slice(0, DISPLAY_LIMIT);
    this.setCount(snapshot.entries.length);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${renderWeightEditor(snapshot.weights)}
      ${renderQueue(entries, snapshot.computedAt)}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      root.querySelectorAll<HTMLInputElement>('[data-spq-slider]').forEach((el) => {
        el.addEventListener('change', () => {
          const axis = el.dataset.spqSlider as keyof PriorityWeights | undefined;
          if (!axis) return;
          const numeric = Number(el.value);
          if (!Number.isFinite(numeric)) return;
          getSituationPriorityQueueService().setWeights({ [axis]: numeric / 100 } as Partial<PriorityWeights>);
        });
      });
      const refresh = root.querySelector<HTMLButtonElement>('#spqRefresh');
      refresh?.addEventListener('click', () => this.render());
    }, 0);
  }
}

// ── Rendering helpers ───────────────────────────────────────────────

function renderWeightEditor(weights: PriorityWeights): string {
  const sliders = SLIDER_AXES.map((axis) => {
    const pct = Math.round(weights[axis.key] * 100);
    return `<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--text-secondary,#aaa);">
      <span style="display:flex;justify-content:space-between;">
        <span>${escapeHtml(axis.label)}</span>
        <span style="font-family:ui-monospace,monospace;color:var(--text-primary,#ddd);">${pct}%</span>
      </span>
      <input type="range" min="0" max="100" step="5" value="${pct}" data-spq-slider="${axis.key}" style="width:100%;" />
    </label>`;
  }).join('');
  return `<div style="display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:var(--surface-2,#1a1a1a);">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Weights</span>
      <button id="spqRefresh" style="padding:3px 10px;font-size:11px;background:#4a9eff26;color:#4a9eff;border:1px solid #4a9eff55;border-radius:3px;cursor:pointer;">Refresh</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">${sliders}</div>
  </div>`;
}

function renderQueue(entries: readonly PriorityEntry[], computedAt: number): string {
  if (entries.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:16px;text-align:center;border:1px dashed var(--border-subtle,#333);border-radius:4px;">Queue is empty. Active Situations will appear here.</div>`;
  }
  const rows = entries.map((e) => renderRow(e, computedAt)).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Ranked Queue</div>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;">${rows}</ul>
  </div>`;
}

function renderRow(entry: PriorityEntry, computedAt: number): string {
  const pct = Math.round(entry.urgencyScore * 100);
  const severityColor = SEVERITY_BADGE[entry.severity] ?? SEVERITY_BADGE.unknown;
  const ago = formatTimeAgo(computedAt - entry.detectedAt);
  const confPct = Math.round(entry.confidence * 100);
  return `<li style="display:grid;grid-template-columns:36px 1fr 90px 80px 60px 70px;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:var(--surface-2,#1a1a1a);font-size:12px;">
    <span style="font-family:ui-monospace,monospace;font-weight:600;color:var(--text-primary,#ddd);">#${entry.rank}</span>
    <div style="display:flex;flex-direction:column;gap:3px;min-width:0;">
      <span style="font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entry.situationId)}</span>
      <div style="height:4px;background:var(--surface-3,#222);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:#4a9eff;"></div>
      </div>
    </div>
    <span style="padding:2px 6px;font-size:10px;font-weight:600;text-transform:uppercase;border-radius:3px;background:${severityColor}33;color:${severityColor};border:1px solid ${severityColor}66;text-align:center;">${escapeHtml(entry.severity)}</span>
    <span style="font-size:11px;color:var(--text-secondary,#aaa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entry.domain)}</span>
    <span style="font-family:ui-monospace,monospace;text-align:right;">${confPct}%</span>
    <span style="font-family:ui-monospace,monospace;text-align:right;color:var(--text-secondary,#aaa);">${escapeHtml(ago)}</span>
  </li>`;
}

function formatTimeAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

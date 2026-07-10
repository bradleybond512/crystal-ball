/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Notification Provenance Panel — Phase 4 "why was this alert sent?".
 *
 * Search bar + recent-notification list (newest-first). Clicking a row
 * expands the provenance card showing the trigger observation,
 * contributing correlations, top driver scores, threshold vs actual
 * score, and the human-readable explanation paragraph from
 * NotificationProvenanceService.
 */

import { Panel } from './Panel';
import {
  getNotificationProvenanceService,
  type ProvenanceDriverScore,
  type ProvenanceRecord,
} from '@/services/notifications/notification-provenance';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const RECENT_LIMIT = 50;

interface PanelState {
  query: string;
  expandedId: string | null;
}

export class NotificationProvenancePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = { query: '', expandedId: null };

  constructor() {
    super({
      id: 'notification-provenance',
      title: 'Notification Provenance',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 "why was this alert sent?" panel. Stores the full causal chain for every notification: trigger observation, contributing correlations, driver-scorer breakdown, threshold crossed, suppression flags. Click any row to expand the human-readable explanation.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getNotificationProvenanceService().subscribe(() => this.render());
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

  private currentList(): ProvenanceRecord[] {
    const svc = getNotificationProvenanceService();
    const q = this.state.query.trim();
    if (q.length === 0) return svc.getRecent(RECENT_LIMIT);
    // Search returns insertion-order results; resort to newest-first so
    // the search view matches the unfiltered view's ordering.
    return [...svc.search(q)].sort((a, b) => b.sentAt - a.sentAt).slice(0, RECENT_LIMIT);
  }

  private render(): void {
    const records = this.currentList();
    this.setCount(records.length);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${this.renderSearchBar()}
      ${renderList(records, this.state.expandedId)}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private renderSearchBar(): string {
    return `<div style="display:flex;align-items:center;gap:8px;">
      <input id="provenanceSearch" type="search" value="${escapeHtml(this.state.query)}" placeholder="Search title / domain / explanation…" style="flex:1;padding:6px 8px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">${this.state.query ? 'filtered' : 'recent 50'}</span>
    </div>`;
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      const search = root.querySelector<HTMLInputElement>('#provenanceSearch');
      search?.addEventListener('input', () => {
        this.state.query = search.value;
        this.render();
      });
      root.querySelectorAll<HTMLElement>('[data-provenance-row]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.provenanceRow;
          if (!id) return;
          this.state.expandedId = this.state.expandedId === id ? null : id;
          this.render();
        });
      });
    }, 0);
  }
}

function renderList(records: readonly ProvenanceRecord[], expandedId: string | null): string {
  if (records.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No matching notifications.</div>`;
  }
  const items = records.map((r) => renderRow(r, r.notificationId === expandedId)).join('');
  return `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${items}</ul>`;
}

function severityColor(score: number, threshold: number): string {
  if (score >= threshold + 0.2) return '#f44336';
  if (score >= threshold) return '#ffb74d';
  return '#4caf50';
}

function suppressionBadges(r: ProvenanceRecord): string {
  const badges: string[] = [];
  if (r.suppressedByQuietHours) {
    badges.push(`<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:#4a9eff26;color:#4a9eff;">quiet hours</span>`);
  }
  if (r.suppressedByTrustBudget) {
    badges.push(`<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:#ffb74d26;color:#ffb74d;">trust budget</span>`);
  }
  return badges.join(' ');
}

function renderRow(r: ProvenanceRecord, expanded: boolean): string {
  const color = severityColor(r.finalScore, r.thresholdUsed);
  const ago = formatAgo(Date.now() - r.sentAt);
  const arrow = expanded ? '▾' : '▸';
  return `<li data-provenance-row="${escapeHtml(r.notificationId)}" style="cursor:pointer;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;background:var(--surface-2,#1a1a1a);padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
      <span style="color:var(--text-secondary,#aaa);width:12px;">${arrow}</span>
      <span style="font-weight:600;flex:1;">${escapeHtml(r.title)}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(r.domain)} · ${r.finalScore.toFixed(2)}/${r.thresholdUsed.toFixed(2)}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(ago)}</span>
    </div>
    ${suppressionBadges(r) ? `<div style="display:flex;gap:6px;">${suppressionBadges(r)}</div>` : ''}
    ${expanded ? renderExpansion(r) : ''}
  </li>`;
}

function renderExpansion(r: ProvenanceRecord): string {
  return `<div style="display:flex;flex-direction:column;gap:8px;padding-top:6px;border-top:1px solid var(--border-subtle,#333);">
    ${renderTrigger(r)}
    ${renderCorrelations(r)}
    ${renderDrivers(r.driverScores)}
    ${renderScoreVsThreshold(r)}
    ${renderExplanation(r)}
  </div>`;
}

function renderTrigger(r: ProvenanceRecord): string {
  const obs = r.triggerObservation;
  return `<div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Trigger observation</div>
    <div style="font-size:11px;font-family:ui-monospace,monospace;color:var(--text-primary,#fff);">${escapeHtml(obs.title || obs.id)}</div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(obs.id)} · ${escapeHtml(obs.sourceId)} · severity ${escapeHtml(obs.severity)}</div>
  </div>`;
}

function renderCorrelations(r: ProvenanceRecord): string {
  if (r.correlationIds.length === 0) {
    return `<div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Correlations</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);">none</div>
    </div>`;
  }
  const items = r.correlationIds.map((id) =>
    `<li style="font-size:11px;font-family:ui-monospace,monospace;color:var(--text-primary,#fff);">${escapeHtml(id)}</li>`,
  ).join('');
  return `<div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Correlations (${r.correlationIds.length})</div>
    <ul style="margin:0;padding-left:18px;">${items}</ul>
  </div>`;
}

function renderDrivers(drivers: readonly ProvenanceDriverScore[]): string {
  if (drivers.length === 0) {
    return `<div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Driver scores</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);">no driver contributions</div>
    </div>`;
  }
  const sorted = [...drivers].sort((a, b) => b.score - a.score);
  const rows = sorted.map((d) => {
    const pct = Math.max(0, Math.min(100, d.score * 100));
    return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;">
      <span style="width:120px;font-family:ui-monospace,monospace;">${escapeHtml(d.label)}</span>
      <div style="flex:1;height:6px;background:var(--surface-2,#1a1a1a);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:#4a9eff;"></div>
      </div>
      <span style="width:42px;text-align:right;font-family:ui-monospace,monospace;">${d.score.toFixed(2)}</span>
    </div>`;
  }).join('');
  return `<div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Driver scores</div>
    <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
  </div>`;
}

function renderScoreVsThreshold(r: ProvenanceRecord): string {
  const max = Math.max(r.finalScore, r.thresholdUsed, 1);
  const scorePct = (r.finalScore / max) * 100;
  const thresholdPct = (r.thresholdUsed / max) * 100;
  const color = severityColor(r.finalScore, r.thresholdUsed);
  return `<div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Score vs threshold</div>
    <div style="position:relative;height:10px;background:var(--surface-2,#1a1a1a);border-radius:2px;overflow:hidden;">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${scorePct.toFixed(1)}%;background:${color};"></div>
      <div style="position:absolute;left:${thresholdPct.toFixed(1)}%;top:-2px;bottom:-2px;width:2px;background:#fff;"></div>
    </div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;font-family:ui-monospace,monospace;">score ${r.finalScore.toFixed(2)} · threshold ${r.thresholdUsed.toFixed(2)}</div>
  </div>`;
}

function renderExplanation(r: ProvenanceRecord): string {
  return `<div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Explanation</div>
    <div style="font-size:11px;line-height:1.5;color:var(--text-primary,#fff);">${escapeHtml(r.explanation)}</div>
  </div>`;
}

function formatAgo(ms: number): string {
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

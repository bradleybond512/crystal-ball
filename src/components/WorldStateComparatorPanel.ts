/**
 * WorldStateComparatorPanel — side-by-side compare of a historical
 * snapshot ("then") against the latest snapshot ("now"). Reads from
 * HistoricalPlaybackService; pure projection logic lives in
 * `world-state-comparator-helpers.ts` so it's unit-testable without
 * mounting the Panel base.
 *
 * Sections (top → bottom):
 *   1. Snapshot selector (dropdown of timeline entries)
 *   2. Domain delta table (severity arrows + event-count delta)
 *   3. Summary stats card (alerts/situations totals, escalated/de-escalated)
 *   4. Timeline scrubber (horizontal bar of all snapshot timestamps)
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  HistoricalPlaybackService,
  type TimelineEntry,
  type WorldSnapshot,
} from '@/services/intelligence/historical-playback';
import {
  arrowFor,
  buildScrubberMarks,
  colorFor,
  computeDomainDeltas,
  computeSummary,
  formatDelta,
  formatDuration,
  formatTimestamp,
  safe,
  timelineEntryById,
  type DomainDelta,
  type ComparatorSummary,
  type ScrubberMark,
} from './world-state-comparator-helpers';

const REFRESH_MS = 30_000;

/** Render a single labelled summary stat cell. Module-scoped so the
 *  lint rule about constructor-local arrow functions doesn't fire. */
function statCell(label: string, value: string, suffix = ''): string {
  return `<div><div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(label)}</div>
    <div style="font-size:14px;color:#ddd;font-weight:600;">${escapeHtml(value)}<span style="font-size:11px;font-weight:400;color:var(--text-secondary,#aaa);"> ${escapeHtml(suffix)}</span></div></div>`;
}

export class WorldStateComparatorPanel extends Panel {
  private thenSnapshotId: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'world-state-comparator',
      title: 'World State Comparator',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Pick a past snapshot from the HistoricalPlaybackService and diff it against the current snapshot — domain severity Δ, escalations, scrubber.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  // ── State + data ─────────────────────────────────────────────────────

  private getTimeline(): TimelineEntry[] {
    return safe(() => HistoricalPlaybackService.getInstance().getTimeline()) ?? [];
  }

  private getNowSnapshot(timeline: readonly TimelineEntry[]): WorldSnapshot | null {
    if (timeline.length === 0) return null;
    const newest = timeline[timeline.length - 1]!;
    return safe(() => HistoricalPlaybackService.getInstance().getSnapshot(newest.id)) ?? null;
  }

  private getThenSnapshot(timeline: readonly TimelineEntry[]): WorldSnapshot | null {
    if (this.thenSnapshotId !== null) {
      const found = safe(() => HistoricalPlaybackService.getInstance().getSnapshot(this.thenSnapshotId!));
      if (found) return found;
    }
    // Default "then" = oldest entry so the panel has something to show
    // before the user picks anything.
    if (timeline.length === 0) return null;
    const oldest = timeline[0]!;
    return safe(() => HistoricalPlaybackService.getInstance().getSnapshot(oldest.id)) ?? null;
  }

  // ── Render ───────────────────────────────────────────────────────────

  private render(): void {
    const timeline = this.getTimeline();
    const nowSnapshot = this.getNowSnapshot(timeline);
    const thenSnapshot = this.getThenSnapshot(timeline);
    const deltas = computeDomainDeltas(thenSnapshot, nowSnapshot);
    const summary = computeSummary(thenSnapshot, nowSnapshot);

    this.setCount(summary.escalatedDomains.length);
    this.setContent(this.buildHtml({
      timeline,
      thenSnapshot,
      nowSnapshot,
      deltas,
      summary,
    }), () => this.wireHandlers());
  }

  private buildHtml(view: {
    timeline: TimelineEntry[];
    thenSnapshot: WorldSnapshot | null;
    nowSnapshot: WorldSnapshot | null;
    deltas: DomainDelta[];
    summary: ComparatorSummary;
  }): string {
    return `<div style="font-size:13px;">${[
      this.renderSelector(view.timeline, view.thenSnapshot),
      this.renderDeltaTable(view.deltas, view.thenSnapshot, view.nowSnapshot),
      this.renderSummary(view.summary, view.thenSnapshot, view.nowSnapshot),
      this.renderScrubber(view.timeline, view.thenSnapshot),
    ].join('')}</div>`;
  }

  // ── Section 1: Snapshot selector ─────────────────────────────────────

  private renderSelector(
    timeline: readonly TimelineEntry[],
    thenSnapshot: WorldSnapshot | null,
  ): string {
    if (timeline.length === 0) {
      return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);color:var(--text-secondary,#aaa);font-size:12px;">
        No historical snapshots yet — HistoricalPlaybackService is empty.
      </div>`;
    }
    const selectedId = thenSnapshot ? thenSnapshot.id : timeline[0]!.id;
    const options = [...timeline].reverse().map((entry) => {
      const selected = entry.id === selectedId ? ' selected' : '';
      const label = `${formatTimestamp(entry.timestamp)} — sev ${entry.severity}`;
      return `<option value="${escapeHtml(entry.id)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');
    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;gap:8px;align-items:center;">
        <span style="font-size:11px;font-weight:700;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;">Compare from</span>
        <select id="wsc-then-select"
          style="flex:1;background:#222;color:#ddd;border:1px solid var(--border-subtle,#333);border-radius:3px;padding:3px 6px;font-size:12px;cursor:pointer;">
          ${options}
        </select>
      </div>`;
  }

  // ── Section 2: Domain delta table ────────────────────────────────────

  private renderDeltaTable(
    deltas: readonly DomainDelta[],
    thenSnapshot: WorldSnapshot | null,
    nowSnapshot: WorldSnapshot | null,
  ): string {
    if (!thenSnapshot || !nowSnapshot || deltas.length === 0) {
      return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);color:var(--text-secondary,#aaa);font-size:12px;">
        Pick a "from" snapshot above to see domain deltas.
      </div>`;
    }
    const rows = deltas.map((row) => this.renderDeltaRow(row)).join('');
    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
        <div style="font-size:11px;font-weight:700;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
          Domain Δ
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-subtle,#333);">
              <th style="padding:4px 6px;text-align:left;color:var(--text-secondary,#aaa);font-weight:600;">Domain</th>
              <th style="padding:4px 6px;text-align:right;color:var(--text-secondary,#aaa);font-weight:600;">Then</th>
              <th style="padding:4px 6px;text-align:right;color:var(--text-secondary,#aaa);font-weight:600;">Now</th>
              <th style="padding:4px 6px;text-align:right;color:var(--text-secondary,#aaa);font-weight:600;">Δ sev</th>
              <th style="padding:4px 6px;text-align:right;color:var(--text-secondary,#aaa);font-weight:600;">Δ events</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  private renderDeltaRow(row: DomainDelta): string {
    const color = colorFor(row.direction);
    const arrow = arrowFor(row.direction);
    const sevDelta = formatDelta(row.severityDelta);
    const eventDelta = formatDelta(row.eventCountDelta);
    const thenCell = row.thenSeverity === null ? '—' : String(row.thenSeverity);
    const nowCell = row.nowSeverity === null ? '—' : String(row.nowSeverity);
    return `<tr style="border-bottom:1px solid var(--border-subtle,#2a2a2a);">
      <td style="padding:4px 6px;color:#ddd;white-space:nowrap;">${escapeHtml(row.domain)}</td>
      <td style="padding:4px 6px;text-align:right;color:var(--text-secondary,#aaa);">${escapeHtml(thenCell)}</td>
      <td style="padding:4px 6px;text-align:right;color:#ddd;">${escapeHtml(nowCell)}</td>
      <td style="padding:4px 6px;text-align:right;color:${color};font-weight:600;white-space:nowrap;">
        <span aria-hidden="true">${arrow}</span> ${escapeHtml(sevDelta)}
      </td>
      <td style="padding:4px 6px;text-align:right;color:${color};">${escapeHtml(eventDelta)}</td>
    </tr>`;
  }

  // ── Section 3: Summary stats ─────────────────────────────────────────

  private renderSummary(
    summary: ComparatorSummary,
    thenSnapshot: WorldSnapshot | null,
    nowSnapshot: WorldSnapshot | null,
  ): string {
    if (!thenSnapshot || !nowSnapshot) {
      return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);color:var(--text-secondary,#aaa);font-size:12px;">
        Summary will appear once both snapshots are loaded.
      </div>`;
    }
    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
        <div style="font-size:11px;font-weight:700;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
          Summary
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">
          ${statCell('Alerts', `${summary.thenAlerts ?? '—'} → ${summary.nowAlerts ?? '—'}`, formatDelta(summary.alertsDelta))}
          ${statCell('Situations', `${summary.thenSituations ?? '—'} → ${summary.nowSituations ?? '—'}`, formatDelta(summary.situationsDelta))}
          ${statCell('Escalated', String(summary.escalatedDomains.length), summary.escalatedDomains.slice(0, 3).join(', '))}
          ${statCell('De-escalated', String(summary.deEscalatedDomains.length), summary.deEscalatedDomains.slice(0, 3).join(', '))}
          ${statCell('Most changed', summary.mostChangedDomain ?? '—', '')}
          ${statCell('Time gap', formatDuration(summary.timeGapMs), '')}
        </div>
      </div>`;
  }

  // ── Section 4: Timeline scrubber ─────────────────────────────────────

  private renderScrubber(
    timeline: readonly TimelineEntry[],
    thenSnapshot: WorldSnapshot | null,
  ): string {
    if (timeline.length === 0) {
      return `<div style="padding:10px 12px;color:var(--text-secondary,#aaa);font-size:12px;">No scrubber — timeline empty.</div>`;
    }
    const marks: readonly ScrubberMark[] = buildScrubberMarks(timeline);
    const activeId = thenSnapshot ? thenSnapshot.id : null;
    const dots = marks.map((m) => {
      const isActive = m.id === activeId;
      const left = `${(m.fraction * 100).toFixed(2)}%`;
      const bg = isActive ? 'var(--accent,#4a9eff)' : 'var(--severity-info)';
      const size = isActive ? '10px' : '7px';
      return `<button class="wsc-scrubber-dot" data-snapshot-id="${escapeHtml(m.id)}"
        title="${escapeHtml(formatTimestamp(m.timestamp))} — sev ${m.severity}"
        style="position:absolute;left:${left};top:50%;transform:translate(-50%,-50%);width:${size};height:${size};border-radius:50%;border:0;background:${bg};cursor:pointer;padding:0;">
      </button>`;
    }).join('');
    return `
      <div style="padding:10px 12px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
          Timeline (${marks.length})
        </div>
        <div style="position:relative;height:24px;background:rgba(255,255,255,0.04);border-radius:3px;border:1px solid var(--border-subtle,#333);">
          ${dots}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">
          <span>${escapeHtml(formatTimestamp(timeline[0]!.timestamp))}</span>
          <span>${escapeHtml(formatTimestamp(timeline[timeline.length - 1]!.timestamp))}</span>
        </div>
      </div>`;
  }

  // ── Handlers ─────────────────────────────────────────────────────────

  private wireHandlers(): void {
    const root = this.content;
    const select = root.querySelector<HTMLSelectElement>('#wsc-then-select');
    select?.addEventListener('change', () => {
      const id = select.value;
      if (!id) return;
      this.applyThenSnapshotById(id);
    });

    for (const dot of root.querySelectorAll<HTMLButtonElement>('.wsc-scrubber-dot')) {
      dot.addEventListener('click', () => {
        const id = dot.dataset.snapshotId;
        if (!id) return;
        this.applyThenSnapshotById(id);
      });
    }
  }

  /** Public for tests so the panel doesn't have to mount. */
  applyThenSnapshotById(id: string): void {
    const timeline = this.getTimeline();
    if (!timelineEntryById(timeline, id)) return;
    this.thenSnapshotId = id;
    this.render();
  }

  /** Public for tests so callers can introspect state without DOM. */
  __getThenSnapshotIdForTests(): string | null {
    return this.thenSnapshotId;
  }
}

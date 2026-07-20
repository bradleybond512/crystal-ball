/**
 * HistoricalPlaybackPanel — UI for HistoricalPlaybackService.
 *
 * Sections (top → bottom):
 *   1. Timeline scrubber — pin-bar of every snapshot; click to select,
 *      "Live" button returns to the latest
 *   2. Snapshot stats — alerts, situations, sev≥3 domains, risk score
 *   3. Domain severity table — selected snapshot's per-domain severity
 *      vs the current (live) snapshot, with Δ + arrow
 *   4. Notes — the selected snapshot's `notes` text; "Capture Now"
 *      button writes a marker snapshot stamped with the user's note
 *
 * Pure projection logic lives in `historical-playback-panel-helpers.ts`
 * so it's testable without mounting the Panel base class.
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
  computeDomainComparison,
  computeSnapshotStats,
  formatDelta,
  formatDuration,
  formatTimestamp,
  pickActiveSnapshotId,
  riskBandFor,
  safe,
  type DomainComparisonRow,
  type ScrubberMark,
  type SnapshotStats,
} from './historical-playback-panel-helpers';

const REFRESH_MS = 30_000;

const RISK_BAND_COLOR: Record<ReturnType<typeof riskBandFor>, string> = {
  low: 'var(--severity-ok)',
  medium: 'var(--severity-medium)',
  high: 'var(--severity-high)',
  critical: 'var(--severity-critical)',
};

/** Render a single labelled stat cell. Module-scoped to satisfy
 *  `unicorn/consistent-function-scoping`. */
function statCell(label: string, value: string, suffix = ''): string {
  return `<div><div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(label)}</div>
    <div style="font-size:14px;color:#ddd;font-weight:600;">${escapeHtml(value)}<span style="font-size:11px;font-weight:400;color:var(--text-secondary,#aaa);"> ${escapeHtml(suffix)}</span></div></div>`;
}

/** Pin colour for a scrubber dot. Module-scoped so the nested ternary
 *  is flattened into an explicit branch list (lint rule). */
function scrubberDotColor(m: ScrubberMark): string {
  if (m.isSelected) return 'var(--accent,#4a9eff)';
  if (m.isLive) return 'var(--severity-ok)';
  return 'var(--severity-info)';
}

/** Pre-rendered HTML for the selected-snapshot notes block. */
function noteBlockHtml(selected: WorldSnapshot | null): string {
  if (!selected) return '';
  const text = selected.notes ?? '';
  if (text.length === 0) {
    return `<div style="padding:6px 8px;color:var(--text-secondary,#aaa);font-size:12px;font-style:italic;">No notes on this snapshot.</div>`;
  }
  return `<div style="padding:6px 8px;background:rgba(255,255,255,0.03);border-left:3px solid var(--accent,#4a9eff);border-radius:3px;color:#ddd;font-size:12px;white-space:pre-wrap;">${escapeHtml(text)}</div>`;
}

export class HistoricalPlaybackPanel extends Panel {
  private selectedSnapshotId: string | null = null;
  private noteDraft = '';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'historical-playback',
      title: 'Historical Playback',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Scrub through past WorldSnapshots. Inspect per-domain severity at any captured moment + compare against now. Bookmark with notes.',
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

  private getService(): HistoricalPlaybackService | null {
    return safe(() => HistoricalPlaybackService.getInstance());
  }

  private getTimeline(): TimelineEntry[] {
    const svc = this.getService();
    if (!svc) return [];
    return safe(() => svc.getTimeline()) ?? [];
  }

  private getSnapshotById(id: string | null): WorldSnapshot | null {
    if (id === null) return null;
    const svc = this.getService();
    if (!svc) return null;
    return safe(() => svc.getSnapshot(id)) ?? null;
  }

  // ── Render ───────────────────────────────────────────────────────────

  private render(): void {
    const timeline = this.getTimeline();
    const activeId = pickActiveSnapshotId(timeline, this.selectedSnapshotId);
    const liveId = timeline.length > 0 ? timeline[timeline.length - 1]!.id : null;
    const selected = this.getSnapshotById(activeId);
    const live = this.getSnapshotById(liveId);
    const stats = computeSnapshotStats(selected);
    const comparison = computeDomainComparison(selected, live);

    this.setCount(stats.highSeverityDomainCount);
    this.setContent(this.buildHtml({
      timeline, activeId, liveId, selected, live, stats, comparison,
    }), () => this.wireHandlers());
  }

  private buildHtml(view: {
    timeline: TimelineEntry[];
    activeId: string | null;
    liveId: string | null;
    selected: WorldSnapshot | null;
    live: WorldSnapshot | null;
    stats: SnapshotStats;
    comparison: DomainComparisonRow[];
  }): string {
    return `<div style="font-size:13px;">${[
      this.renderScrubber(view.timeline, view.activeId, view.liveId),
      this.renderStats(view.stats, view.selected, view.live),
      this.renderDomainTable(view.comparison, view.selected, view.live),
      this.renderNotes(view.selected),
    ].join('')}</div>`;
  }

  // ── Section 1: Scrubber ──────────────────────────────────────────────

  private renderScrubber(
    timeline: readonly TimelineEntry[],
    activeId: string | null,
    liveId: string | null,
  ): string {
    if (timeline.length === 0) {
      return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);color:var(--text-secondary,#aaa);font-size:12px;">
        No snapshots captured yet. Use the "Capture Now" button below to bookmark the current moment.
      </div>`;
    }
    const marks: readonly ScrubberMark[] = buildScrubberMarks(timeline, activeId);
    const selectedMark = marks.find((m) => m.isSelected);
    const headerLine = this.renderHeaderLine(selectedMark);
    const isAtLive = activeId === liveId;
    const liveBtn = `<button id="hpb-live-btn" type="button" ${isAtLive ? 'disabled' : ''}
      title="Jump back to the most recent snapshot"
      style="background:${isAtLive ? 'transparent' : 'rgba(34,197,94,0.15)'};color:${isAtLive ? 'var(--text-secondary,#aaa)' : 'var(--severity-ok)'};border:1px solid ${isAtLive ? 'var(--border-subtle,#333)' : 'var(--severity-ok)'};border-radius:3px;padding:3px 10px;font-size:11px;cursor:${isAtLive ? 'default' : 'pointer'};text-transform:uppercase;letter-spacing:.06em;font-weight:600;">
      ${isAtLive ? 'At Live' : 'Live'}
    </button>`;

    const dots = marks.map((m) => this.renderScrubberDot(m)).join('');
    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text-secondary,#aaa);margin-bottom:6px;">
          <span>${headerLine}</span>
          ${liveBtn}
        </div>
        <div style="position:relative;height:24px;background:rgba(255,255,255,0.04);border-radius:3px;border:1px solid var(--border-subtle,#333);">
          ${dots}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">
          <span>${escapeHtml(formatTimestamp(timeline[0]!.timestamp))}</span>
          <span>${marks.length} snapshots</span>
          <span>${escapeHtml(formatTimestamp(timeline[timeline.length - 1]!.timestamp))}</span>
        </div>
      </div>`;
  }

  private renderHeaderLine(mark: ScrubberMark | undefined): string {
    if (!mark) return '—';
    const liveTag = mark.isLive ? ' <span style="color:var(--severity-ok);">(LIVE)</span>' : '';
    return `Selected: <strong style="color:#ddd;">${escapeHtml(formatTimestamp(mark.timestamp))}</strong>${liveTag}`;
  }

  private renderScrubberDot(m: ScrubberMark): string {
    const left = `${(m.fraction * 100).toFixed(2)}%`;
    const size = m.isSelected ? '12px' : '7px';
    const bg = scrubberDotColor(m);
    return `<button class="hpb-scrubber-dot" data-snapshot-id="${escapeHtml(m.id)}"
      title="${escapeHtml(formatTimestamp(m.timestamp))} — sev ${m.severity}${m.isLive ? ' (LIVE)' : ''}"
      style="position:absolute;left:${left};top:50%;transform:translate(-50%,-50%);width:${size};height:${size};border-radius:50%;border:0;background:${bg};cursor:pointer;padding:0;">
    </button>`;
  }

  // ── Section 2: Snapshot stats ────────────────────────────────────────

  private renderStats(
    stats: SnapshotStats,
    selected: WorldSnapshot | null,
    live: WorldSnapshot | null,
  ): string {
    if (!selected) {
      return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);color:var(--text-secondary,#aaa);font-size:12px;">
        Pick a snapshot above to see its stats.
      </div>`;
    }
    const band = riskBandFor(stats.riskScore);
    const bandColor = RISK_BAND_COLOR[band];
    const ageMs = live && selected ? selected.capturedAt - live.capturedAt : null;
    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
        <div style="font-size:11px;font-weight:700;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
          Snapshot Stats
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">
          ${statCell('Active alerts', stats.activeAlerts === null ? '—' : String(stats.activeAlerts))}
          ${statCell('Situations', stats.situationCount === null ? '—' : String(stats.situationCount))}
          ${statCell('Sev ≥ 3 domains', String(stats.highSeverityDomainCount))}
          <div><div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;">Risk score</div>
            <div style="font-size:14px;color:${bandColor};font-weight:700;">${stats.riskScore}<span style="font-size:11px;font-weight:400;color:var(--text-secondary,#aaa);"> /100 (${escapeHtml(band)})</span></div></div>
          ${statCell('Captured', formatTimestamp(stats.capturedAt))}
          ${statCell('Gap to live', formatDuration(ageMs))}
        </div>
      </div>`;
  }

  // ── Section 3: Domain severity table ─────────────────────────────────

  private renderDomainTable(
    comparison: readonly DomainComparisonRow[],
    selected: WorldSnapshot | null,
    live: WorldSnapshot | null,
  ): string {
    if (!selected || !live || comparison.length === 0) {
      return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);color:var(--text-secondary,#aaa);font-size:12px;">
        Select a snapshot above; the domain comparison appears here.
      </div>`;
    }
    const rows = comparison.map((row) => this.renderDomainRow(row)).join('');
    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
        <div style="font-size:11px;font-weight:700;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
          Domain Severity at Time
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-subtle,#333);">
              <th style="padding:4px 6px;text-align:left;color:var(--text-secondary,#aaa);font-weight:600;">Domain</th>
              <th style="padding:4px 6px;text-align:right;color:var(--text-secondary,#aaa);font-weight:600;">Then</th>
              <th style="padding:4px 6px;text-align:right;color:var(--text-secondary,#aaa);font-weight:600;">Now</th>
              <th style="padding:4px 6px;text-align:right;color:var(--text-secondary,#aaa);font-weight:600;">Δ</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  private renderDomainRow(row: DomainComparisonRow): string {
    const color = colorFor(row.direction);
    const arrow = arrowFor(row.direction);
    const then_ = row.selectedSeverity === null ? '—' : String(row.selectedSeverity);
    const now_ = row.nowSeverity === null ? '—' : String(row.nowSeverity);
    return `<tr style="border-bottom:1px solid var(--border-subtle,#2a2a2a);">
      <td style="padding:4px 6px;color:#ddd;white-space:nowrap;">${escapeHtml(row.domain)}</td>
      <td style="padding:4px 6px;text-align:right;color:var(--text-secondary,#aaa);">${escapeHtml(then_)}</td>
      <td style="padding:4px 6px;text-align:right;color:#ddd;">${escapeHtml(now_)}</td>
      <td style="padding:4px 6px;text-align:right;color:${color};font-weight:600;white-space:nowrap;">
        <span aria-hidden="true">${arrow}</span> ${escapeHtml(formatDelta(row.delta))}
      </td>
    </tr>`;
  }

  // ── Section 4: Notes + Capture ───────────────────────────────────────

  private renderNotes(selected: WorldSnapshot | null): string {
    const draftAttr = escapeHtml(this.noteDraft);
    const displayedNote = noteBlockHtml(selected);
    return `
      <div style="padding:10px 12px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
          Notes
        </div>
        ${displayedNote}
        <div style="display:flex;gap:6px;margin-top:8px;">
          <input id="hpb-note-input" type="text" placeholder="Bookmark this moment (optional note)…" value="${draftAttr}"
            style="flex:1;background:#222;color:#ddd;border:1px solid var(--border-subtle,#333);border-radius:3px;padding:4px 8px;font-size:12px;">
          <button id="hpb-capture-btn" type="button"
            title="Save the current moment as a new snapshot (an empty world-state marker stamped with this note)"
            style="background:rgba(74,158,255,0.15);color:var(--accent,#4a9eff);border:1px solid var(--accent,#4a9eff);border-radius:3px;padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:.06em;">
            Capture Now
          </button>
        </div>
      </div>`;
  }

  // ── Handlers ─────────────────────────────────────────────────────────

  private wireHandlers(): void {
    const root = this.content;
    for (const dot of root.querySelectorAll<HTMLButtonElement>('.hpb-scrubber-dot')) {
      dot.addEventListener('click', () => {
        const id = dot.dataset.snapshotId;
        if (!id) return;
        this.selectedSnapshotId = id;
        this.render();
      });
    }

    const liveBtn = root.querySelector<HTMLButtonElement>('#hpb-live-btn');
    liveBtn?.addEventListener('click', () => {
      this.selectedSnapshotId = null;
      this.render();
    });

    const noteInput = root.querySelector<HTMLInputElement>('#hpb-note-input');
    noteInput?.addEventListener('input', () => { this.noteDraft = noteInput.value; });

    const captureBtn = root.querySelector<HTMLButtonElement>('#hpb-capture-btn');
    captureBtn?.addEventListener('click', () => this.captureNow());
  }

  /**
   * "Capture Now" writes a marker snapshot stamped with the current note
   * draft. The panel doesn't have direct access to live domain states, so
   * it captures an empty-state bookmark — useful for ad-hoc "remember
   * this moment" UX (something happened, mark it). A future PR can wire
   * a data provider for full state capture.
   */
  private captureNow(): void {
    const svc = this.getService();
    if (!svc) return;
    const note = this.noteDraft.trim();
    safe(() => svc.captureSnapshot([], 0, 0, note.length > 0 ? note : undefined));
    this.noteDraft = '';
    this.render();
  }

  /** Public for tests. */
  __getSelectedIdForTests(): string | null {
    return this.selectedSnapshotId;
  }
}

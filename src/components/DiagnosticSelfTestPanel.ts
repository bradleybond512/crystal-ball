/**
 * Diagnostic Self-Test Panel — one-click smoke test across every feed
 * domain plus a prominent mission-state header.
 *
 * Refreshes every 5 minutes so the user can leave it open as a passive
 * monitor; the "Run Self-Test" button forces an immediate run.
 *
 * Composition:
 *   - mission-state-mapper          (Feature 1) → header pill
 *   - sidecar-self-test             (existing)  → per-domain rows
 *   - self-test-aggregator (new)                → roll-up + sort
 *   - buildExportBundle             (existing)  → "Export Diagnostics"
 *
 * The panel never holds keys or PII. It reads from the renderer-side
 * services and writes nothing back to the sidecar.
 */

import { Panel } from './Panel';
import { fetchSidecarSelfTest, formatLatency, type SidecarSelfTestResponse } from '@/services/diagnostics/sidecar-self-test';
import { aggregateByDomain, aggregateOverallStatus, type DomainRow, type AggregateStatus } from '@/services/diagnostics/self-test-aggregator';
import { computeMissionState, classifyFeedHealth, type MissionState, type FeedHealthInput } from '@/services/diagnostics/mission-state-mapper';
import { FEED_CATALOG } from '@/services/diagnostics/feed-catalog';
import { dataFreshness } from '@/services/data-freshness';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes per spec

const STATUS_COLOR: Record<AggregateStatus, string> = {
  PASS: '#4caf50',
  WARN: '#ff9800',
  FAIL: '#ff453a',
};

const MISSION_COLOR: Record<MissionState['global'], string> = {
  DEGRADED: '#ff453a',
  LIMITED:  '#ff9800',
  NOMINAL:  '#4caf50',
  ENHANCED: '#2196f3',
};

const VERDICT_COLOR: Record<'ok' | 'degraded' | 'fail', string> = {
  ok:       '#4caf50',
  degraded: '#ff9800',
  fail:     '#ff453a',
};

const VERDICT_LABEL: Record<'ok' | 'degraded' | 'fail', string> = {
  ok:       'PASS',
  degraded: 'WARN',
  fail:     'FAIL',
};

export class DiagnosticSelfTestPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastResponse: SidecarSelfTestResponse | null = null;
  private rows: DomainRow[] = [];
  private overall: AggregateStatus = 'PASS';
  private missionState: MissionState = computeMissionState([]);
  private lastRunAt: number | null = null;
  private boundClickHandler: ((ev: MouseEvent) => void) | null = null;

  constructor() {
    super({
      id: 'self-test',
      title: 'Self-Test',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'On-demand smoke test across every feed domain. Shows current mission state, per-domain pass/warn/fail, latency, data age, and last error. Auto-refresh every 5 minutes.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.boundClickHandler && typeof document !== 'undefined') {
      document.removeEventListener('click', this.boundClickHandler);
      this.boundClickHandler = null;
    }
    super.destroy();
  }

  private start(): void {
    void this.refreshNow();
    this.refreshTimer = setInterval(() => { void this.refreshNow(); }, REFRESH_MS);
    if (typeof document !== 'undefined') {
      this.boundClickHandler = (ev) => this.onClick(ev);
      document.addEventListener('click', this.boundClickHandler);
    }
  }

  private onClick(ev: MouseEvent): void {
    const target = (ev.target as Element | null)?.closest('[data-self-test-action]');
    if (!target) return;
    const action = target.getAttribute('data-self-test-action');
    if (action === 'run') {
      void this.refreshNow();
    } else if (action === 'export') {
      this.exportDiagnostics();
    }
  }

  private async refreshNow(): Promise<void> {
    if (this.running) {
      this.render();
      return;
    }
    this.running = true;
    this.render();
    try {
      this.missionState = this.computeCurrentMissionState();
      this.lastResponse = await fetchSidecarSelfTest();
      this.rows = aggregateByDomain(this.lastResponse.results);
      this.overall = aggregateOverallStatus(this.rows);
      this.lastRunAt = Date.now();
      this.setCount(this.rows.filter((r) => r.verdict !== 'ok').length);
    } finally {
      this.running = false;
      this.render();
    }
  }

  /** Compose mission-state from the feed catalog + live data-freshness. */
  private computeCurrentMissionState(): MissionState {
    const inputs: FeedHealthInput[] = FEED_CATALOG.map((feed) => {
      const src = feed.sourceId ? dataFreshness.getSource(feed.sourceId) : undefined;
      const lastUpdateMs = src?.lastUpdate ? src.lastUpdate.getTime() : null;
      const hadError = Boolean(src?.lastError);
      const status = classifyFeedHealth(feed, lastUpdateMs, hadError);
      return { id: feed.id, name: feed.name, category: feed.category, status };
    });
    return computeMissionState(inputs);
  }

  /** Dispatch the existing export pipeline. The host listens for
   *  `cb:export-briefing` already (used by ⌘K palette + Cmd+Shift+H);
   *  reuse it here so the panel doesn't reimplement the bundle build. */
  private exportDiagnostics(): void {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent('cb:export-briefing'));
  }

  private render(): void {
    this.setContent(this.buildHtml());
  }

  private buildHtml(): string {
    const missionPill = this.buildMissionPill();
    const headerBar = this.buildHeaderBar();
    const tableBody = this.rows.length > 0
      ? this.rows.map((r) => this.buildRow(r)).join('')
      : `<tr><td colspan="5" style="padding:14px 12px;color:var(--text-secondary,#888);">No self-test results yet. Click <strong>Run Self-Test</strong> to start.</td></tr>`;
    const error = this.lastResponse?.error
      ? `<div style="padding:8px 12px;background:rgba(255, 69, 58,0.12);color:#ff453a;font-size:11px;">Probe error: ${escapeHtml(this.lastResponse.error)}</div>`
      : '';
    return `${missionPill}${headerBar}${error}
      <table role="table" style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="text-align:left;color:var(--text-secondary,#888);border-bottom:1px solid var(--border-subtle,#333);">
            <th scope="col" style="padding:6px 10px;font-weight:600;">Domain</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;">Status</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;text-align:right;">Latency</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;text-align:right;">Probes</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;">Last error</th>
          </tr>
        </thead>
        <tbody>${tableBody}</tbody>
      </table>`;
  }

  private buildMissionPill(): string {
    const state = this.missionState.global;
    const color = MISSION_COLOR[state];
    const degraded = this.missionState.degradedFeeds.length;
    const plural = degraded === 1 ? '' : 's';
    const detail = degraded === 0 ? 'All feeds nominal.' : `${degraded} degraded feed${plural}.`;
    return `<div style="padding:10px 14px;border-bottom:1px solid var(--border-subtle,#222);display:flex;align-items:center;gap:10px;">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);">Mission state</span>
      <span style="font-size:13px;font-weight:700;color:${color};padding:3px 8px;border:1px solid ${color};border-radius:3px;letter-spacing:0.04em;">${escapeHtml(state)}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);flex:1;">${escapeHtml(detail)}</span>
    </div>`;
  }

  private buildHeaderBar(): string {
    const overallColor = STATUS_COLOR[this.overall];
    const lastRun = this.lastRunAt ? new Date(this.lastRunAt).toLocaleTimeString() : '—';
    const runDisabled = this.running ? 'disabled style="opacity:0.6;"' : '';
    return `<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#222);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--text-secondary,#888);">Overall:</span>
      <span style="font-size:11px;font-weight:700;color:${overallColor};letter-spacing:0.04em;">${this.overall}</span>
      <span style="font-size:10px;color:var(--text-secondary,#777);">Last run: ${escapeHtml(lastRun)}</span>
      <span style="flex:1;"></span>
      <button type="button" data-self-test-action="run" ${runDisabled} style="font-size:11px;font-weight:600;padding:5px 10px;border:1px solid var(--accent,#2196f3);border-radius:3px;background:transparent;color:var(--accent,#2196f3);cursor:pointer;">${this.running ? 'Running…' : 'Run Self-Test'}</button>
      <button type="button" data-self-test-action="export" style="font-size:11px;font-weight:600;padding:5px 10px;border:1px solid var(--border-subtle,#444);border-radius:3px;background:transparent;color:var(--text-primary,#ddd);cursor:pointer;">Export Diagnostics</button>
    </div>`;
  }

  private buildRow(row: DomainRow): string {
    const color = VERDICT_COLOR[row.verdict];
    const label = VERDICT_LABEL[row.verdict];
    return `<tr style="border-bottom:1px solid var(--border-subtle,#222);">
      <td style="padding:7px 10px;font-weight:600;">${escapeHtml(row.domain)}</td>
      <td style="padding:7px 10px;">
        <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;padding:1px 5px;border:1px solid ${color};border-radius:2px;">${label}</span>
      </td>
      <td style="padding:7px 10px;text-align:right;font-family:ui-monospace,monospace;color:var(--text-primary,#ddd);">${escapeHtml(formatLatency(row.medianLatencyMs))}</td>
      <td style="padding:7px 10px;text-align:right;font-family:ui-monospace,monospace;color:var(--text-secondary,#888);">${row.probeCount}</td>
      <td style="padding:7px 10px;color:var(--text-secondary,#aaa);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(row.lastError ?? '')}">${escapeHtml(row.lastError ?? '—')}</td>
    </tr>`;
  }
}

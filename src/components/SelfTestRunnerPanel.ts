/**
 * Self-Test Runner Panel — surfaces the domain-keyed self-test report
 * with one row per domain (pass/warn/fail badge + latency + message).
 *
 * Distinct from the existing `self-test` panel (DiagnosticSelfTestPanel):
 * that one reads from the sidecar fan-out and shows per-route probes
 * grouped by domain category. This one reads from data-freshness
 * directly and presents the user's simpler one-row-per-domain view with
 * a JSON-export button.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import { FEED_CATALOG, type FeedDefinition } from '@/services/diagnostics/feed-catalog';
import {
  buildBuiltinSmokeTests,
  runAllTests,
  type DomainSmokeTest,
  type FeedFreshnessSnapshot,
  type SelfTestReport,
  type SmokeStatus,
  type SmokeTestOracle,
  type SmokeTestResult,
} from '@/services/diagnostics/self-test-runner';
import {
  getMissionState,
  MISSION_STATE_COLOR,
  MISSION_STATE_LABEL,
  type MissionState,
} from '@/services/diagnostics/feed-health-mission-state';

const STATUS_COLOR: Record<SmokeStatus, string> = {
  pass: '#4caf50',
  warn: '#ff9800',
  fail: '#ff453a',
};

const STATUS_LABEL: Record<SmokeStatus, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
};

export class SelfTestRunnerPanel extends Panel {
  private report: SelfTestReport | null = null;
  private running = false;
  private tests: DomainSmokeTest[];
  private boundClick: ((ev: MouseEvent) => void) | null = null;

  constructor(oracle: SmokeTestOracle = createLiveOracle()) {
    super({
      id: 'self-test-runner',
      title: 'Self-Test Runner',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'One-button smoke test across major Crystal Ball domains. Each row checks feed freshness and cache validity. Use the JSON export to attach the report to a bug.',
    });
    this.tests = buildBuiltinSmokeTests(oracle);
    this.start();
  }

  private start(): void {
    this.render();
    if (typeof document !== 'undefined') {
      this.boundClick = (ev) => this.onClick(ev);
      document.addEventListener('click', this.boundClick);
    }
    void this.runOnce();
  }

  public override destroy(): void {
    if (this.boundClick && typeof document !== 'undefined') {
      document.removeEventListener('click', this.boundClick);
      this.boundClick = null;
    }
    super.destroy();
  }

  private onClick(ev: MouseEvent): void {
    const target = (ev.target as Element | null)?.closest('[data-self-test-runner-action]');
    if (!target) return;
    const action = target.getAttribute('data-self-test-runner-action');
    if (action === 'run') {
      void this.runOnce();
    } else if (action === 'export') {
      this.exportJson();
    }
  }

  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.render();
    try {
      this.report = await runAllTests(this.tests);
      this.setCount(this.report.failed + this.report.warned);
    } finally {
      this.running = false;
      this.render();
    }
  }

  private exportJson(): void {
    if (!this.report || typeof document === 'undefined') return;
    const blob = new Blob([JSON.stringify(this.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `self-test-${new Date(this.report.runAt).toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private render(): void {
    this.setContent(this.buildHtml());
  }

  private buildHtml(): string {
    const mission = this.report ? getMissionState(this.report) : 'nominal';
    const missionPill = this.buildMissionPill(mission);
    const summary = this.buildSummary();
    const rows = this.buildRows();
    const lastRun = this.report
      ? `Last run ${new Date(this.report.runAt).toLocaleTimeString()} · ${this.report.duration} ms`
      : 'No run yet.';
    return `
      <div style="padding:12px;display:flex;flex-direction:column;gap:10px;">
        ${missionPill}
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button data-self-test-runner-action="run" ${this.running ? 'disabled' : ''}
            style="padding:6px 12px;background:#2196f3;border:none;color:#fff;border-radius:4px;cursor:${this.running ? 'wait' : 'pointer'};font-size:12px;">
            ${this.running ? 'Running…' : 'Run All Tests'}
          </button>
          <button data-self-test-runner-action="export" ${this.report ? '' : 'disabled'}
            style="padding:6px 12px;background:transparent;border:1px solid var(--border-subtle,#444);color:inherit;border-radius:4px;cursor:${this.report ? 'pointer' : 'not-allowed'};font-size:12px;">
            Export JSON
          </button>
          <span style="font-size:11px;color:var(--text-secondary,#888);">${escapeHtml(lastRun)}</span>
        </div>
        ${summary}
        <table role="table" style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="text-align:left;color:var(--text-secondary,#888);border-bottom:1px solid var(--border-subtle,#333);">
              <th scope="col" style="padding:6px 10px;font-weight:600;">Domain</th>
              <th scope="col" style="padding:6px 10px;font-weight:600;">Status</th>
              <th scope="col" style="padding:6px 10px;font-weight:600;text-align:right;">Latency</th>
              <th scope="col" style="padding:6px 10px;font-weight:600;">Message</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  private buildMissionPill(state: MissionState): string {
    const color = MISSION_STATE_COLOR[state];
    const label = MISSION_STATE_LABEL[state];
    return `<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:${color}1a;color:${color};font-size:12px;font-weight:600;">
      Mission state: ${escapeHtml(label)}
    </div>`;
  }

  private buildSummary(): string {
    if (!this.report) {
      return `<div style="font-size:11px;color:var(--text-secondary,#888);">Tap "Run All Tests" to begin.</div>`;
    }
    const { passed, warned, failed } = this.report;
    return `<div style="display:flex;gap:12px;font-size:12px;">
      <span style="color:${STATUS_COLOR.pass};">✓ ${passed} passed</span>
      <span style="color:${STATUS_COLOR.warn};">⚠ ${warned} warned</span>
      <span style="color:${STATUS_COLOR.fail};">✗ ${failed} failed</span>
    </div>`;
  }

  private buildRows(): string {
    if (!this.report) {
      return `<tr><td colspan="4" style="padding:14px 12px;color:var(--text-secondary,#888);">No results yet.</td></tr>`;
    }
    const entries = Object.entries(this.report.results);
    if (entries.length === 0) {
      return `<tr><td colspan="4" style="padding:14px 12px;color:var(--text-secondary,#888);">No tests configured.</td></tr>`;
    }
    return entries
      .map(([domain, result]) => this.buildRow(domain, result))
      .join('');
  }

  private buildRow(domain: string, result: SmokeTestResult): string {
    const color = STATUS_COLOR[result.status];
    const label = STATUS_LABEL[result.status];
    return `<tr style="border-bottom:1px solid var(--border-subtle,#222);">
      <td style="padding:6px 10px;font-weight:600;">${escapeHtml(domain)}</td>
      <td style="padding:6px 10px;">
        <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${color}1a;color:${color};font-size:11px;font-weight:700;">${label}</span>
      </td>
      <td style="padding:6px 10px;text-align:right;color:var(--text-secondary,#888);">${formatLatency(result.latencyMs)}</td>
      <td style="padding:6px 10px;color:var(--text-secondary,#aaa);">${escapeHtml(result.message)}</td>
    </tr>`;
  }
}

/**
 * Production oracle: bridges the abstract `SmokeTestOracle` interface to
 * the live `dataFreshness` registry. Each `feedId` is resolved via the
 * feed-catalog (or a small local map for domain-specific feeds not in
 * the catalog yet).
 */
export function createLiveOracle(): SmokeTestOracle {
  const feedById = new Map<string, FeedDefinition>(
    FEED_CATALOG.map((f) => [f.id, f]),
  );
  return {
    now: () => Date.now(),
    getFeedSnapshot(feedId: string): FeedFreshnessSnapshot | null {
      const feed = feedById.get(feedId);
      if (!feed) return null;
      const source = feed.sourceId
        ? dataFreshness.getSource(feed.sourceId as DataSourceId)
        : undefined;
      const lastUpdateMs = source?.lastUpdate ? source.lastUpdate.getTime() : null;
      const hadError = Boolean(source?.lastError);
      const hasCachedPayload = (source?.itemCount ?? 0) > 0;
      return {
        lastUpdateMs,
        pollIntervalMs: feed.pollIntervalMs,
        hadError,
        hasCachedPayload,
      };
    },
  };
}

function formatLatency(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

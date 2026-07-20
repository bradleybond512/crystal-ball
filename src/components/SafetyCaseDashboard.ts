/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Safety Case Dashboard — Phase 4 "is this system trustworthy right
 * now?" screen.
 *
 * Reads the SafetyCaseService singleton, evaluates a fresh case from
 * live producer signals (algo eval ledger, assumption tracker, trust
 * budget, outcome ledger), and renders a pass/warn/fail grid plus a
 * 10-tick history sparkline. The Re-evaluate button forces a new
 * evaluation; absent that, the panel refreshes on a 30s timer.
 */

import { Panel } from './Panel';
import {
  buildSafetyCase,
  getSafetyCaseService,
  type BiasReport,
  type FeedHealthMap,
  type SafetyCase,
  type SafetyCaseInputs,
  type SafetyProperty,
  type SafetyPropertyStatus,
} from '@/services/intelligence/safety-case';
import { getAlgoEvalLedger } from '@/services/intelligence/algo-eval-ledger';
import { getAssumptionTracker } from '@/services/intelligence/assumption-tracker';
import { getOutcomeLedger } from '@/services/intelligence/outcome-ledger';
import { getTrustBudgetService } from '@/services/notifications/trust-budget';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const HISTORY_TICKS = 10;

const STATUS_COLOR: Record<SafetyPropertyStatus, string> = {
  pass: '#4caf50',
  warn: '#ffb74d',
  fail: '#ff453a',
};

const STATUS_LABEL: Record<SafetyPropertyStatus, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
};

export class SafetyCaseDashboard extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;

  constructor() {
    super({
      id: 'safety-case',
      title: 'Safety Case',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 single-screen trustworthiness verdict. Eight safety properties (accuracy, bias, transparency, reliability, containment) evaluated against documented thresholds. Worst property defines overall status; any "fail" blocks the safeToOperate signal.',
    });
    this.start();
  }

  private start(): void {
    // Initial evaluation seeds the history so the sparkline is never empty.
    this.evaluateAndRender();
    this.refreshTimer = setInterval(() => this.evaluateAndRender(), REFRESH_MS);
    this.unsub = getSafetyCaseService().subscribe(() => this.render());
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

  /** Pulls live signals from each producer singleton, builds the
   *  current SafetyCaseInputs, and asks the service to evaluate. The
   *  service's subscribe() listener then triggers render(). */
  private evaluateAndRender(): void {
    const inputs = collectInputs();
    getSafetyCaseService().evaluate(inputs);
    this.render();
  }

  private render(): void {
    const service = getSafetyCaseService();
    const latest = service.getLatest() ?? buildSafetyCase(collectInputs(), new Date());
    const history = service.getHistory();

    // Panel count: number of fail+warn properties. 0 = green panel chip.
    this.setCount(latest.failCount + latest.warnCount);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderHeader(latest)}
      ${renderSummaryRow(latest)}
      ${renderPropertiesGrid(latest.properties)}
      ${renderSparkline(history)}
      ${renderReEvaluate(latest)}
    </div>`;
    this.setContent(html);
    this.wireReEvaluateButton();
  }

  private wireReEvaluateButton(): void {
    setTimeout(() => {
      const btn = this.content.querySelector<HTMLButtonElement>('#safetyCaseReevalBtn');
      btn?.addEventListener('click', () => this.evaluateAndRender());
    }, 0);
  }
}

function collectInputs(): SafetyCaseInputs {
  const biasReport: BiasReport = { signals: [] };
  const algoStats = getAlgoEvalLedger().getAllStats();
  const assumptionStats = getAssumptionTracker().stats();
  const budgetSnapshot = getTrustBudgetService().getSnapshot();
  const outcomeStats = getOutcomeLedger().stats();
  // Feed-health producer isn't on a service singleton yet; pass an
  // empty map and the evaluator defaults missing critical feeds to
  // 'down' so the panel surfaces the gap rather than hiding it.
  const feedHealth: FeedHealthMap = {};
  return {
    biasReport,
    algoStats,
    assumptionStats,
    budgetSnapshot,
    outcomeStats,
    feedHealth,
    humanReviewBacklog: 0,
  };
}

function renderHeader(sc: SafetyCase): string {
  const headline = sc.safeToOperate ? 'SYSTEM SAFE TO OPERATE' : 'SAFETY REVIEW REQUIRED';
  const color = sc.safeToOperate ? STATUS_COLOR.pass : STATUS_COLOR.fail;
  return `<div style="display:flex;align-items:center;gap:12px;">
    <div style="flex:1;">
      <div style="font-size:20px;font-weight:800;color:${color};letter-spacing:0.04em;">${escapeHtml(headline)}</div>
      <div style="font-size:13px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(sc.operatorSummary)}</div>
    </div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;padding:6px 12px;border-radius:4px;background:${color}26;color:${color};">${STATUS_LABEL[sc.overallStatus]}</div>
  </div>`;
}

function renderSummaryRow(sc: SafetyCase): string {
  return `<div style="display:flex;gap:18px;font-size:12px;font-family:ui-monospace,monospace;">
    <span><strong style="color:${STATUS_COLOR.pass};">${sc.passCount}</strong> pass</span>
    <span><strong style="color:${STATUS_COLOR.warn};">${sc.warnCount}</strong> warn</span>
    <span><strong style="color:${STATUS_COLOR.fail};">${sc.failCount}</strong> fail</span>
  </div>`;
}

function renderPropertiesGrid(properties: readonly SafetyProperty[]): string {
  const cards = properties.map((p) => renderPropertyCard(p)).join('');
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;">${cards}</div>`;
}

function renderPropertyCard(p: SafetyProperty): string {
  const color = STATUS_COLOR[p.status];
  const failPulse = p.status === 'fail'
    ? 'animation: safetyCasePulse 2s ease-in-out infinite;'
    : '';
  // Inline keyframes once per card so the panel doesn't depend on an
  // external stylesheet; modern browsers de-dupe these silently.
  const keyframes = p.status === 'fail'
    ? `<style>@keyframes safetyCasePulse { 0%, 100% { box-shadow: 0 0 0 0 ${color}55; } 50% { box-shadow: 0 0 0 4px ${color}00; } }</style>`
    : '';
  return `${keyframes}<div style="border-left:3px solid ${color};border-radius:4px;background:var(--surface-2,#1a1a1a);padding:8px 10px;${failPulse}">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-weight:600;font-size:12px;flex:1;">${escapeHtml(p.name)}</span>
      <span style="font-size:10px;font-weight:700;letter-spacing:0.05em;color:${color};">${STATUS_LABEL[p.status]}</span>
    </div>
    <div style="font-size:11px;color:var(--text-primary,#fff);margin-top:4px;font-family:ui-monospace,monospace;">${escapeHtml(p.value)}</div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">threshold: ${escapeHtml(p.threshold)}</div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">evidence: ${escapeHtml(p.evidence)}</div>
  </div>`;
}

function renderSparkline(history: readonly SafetyCase[]): string {
  const recent = history.slice(-HISTORY_TICKS);
  if (recent.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">History</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No evaluations recorded yet.</div>
    </div>`;
  }
  const dots = recent.map((c) => {
    const color = STATUS_COLOR[c.overallStatus];
    const time = c.generatedAt.toLocaleTimeString();
    return `<span title="${escapeHtml(time)} — ${STATUS_LABEL[c.overallStatus]}" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};"></span>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">History (last ${recent.length})</div>
    <div style="display:flex;gap:6px;align-items:center;">${dots}</div>
  </div>`;
}

function renderReEvaluate(sc: SafetyCase): string {
  return `<div style="display:flex;align-items:center;gap:12px;">
    <button id="safetyCaseReevalBtn" style="padding:6px 12px;background:var(--accent,#4a9eff);color:#fff;border:0;border-radius:3px;cursor:pointer;font-weight:600;">Re-evaluate</button>
    <span style="font-size:11px;color:var(--text-secondary,#aaa);">last checked ${escapeHtml(sc.generatedAt.toLocaleString())}</span>
  </div>`;
}

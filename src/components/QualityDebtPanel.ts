/**
 * QualityDebtPanel — vanilla TS surface for the QualityDebtTracker.
 *
 * Auto-refreshes every 30s by re-scanning the live OutcomeLedger /
 * AlgoEvalLedger / AssumptionTracker / data-freshness singletons.
 * Renders a total debt score gauge, a trend indicator, a fast-
 * compounding alert strip, a category bar chart, and a per-item
 * action list with Acknowledge / Resolve buttons.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  QualityDebtTracker,
  type DebtCategory,
  type DebtItem,
  type DebtSeverity,
  type DebtSummary,
  type DebtTrend,
  type FeedHealth,
  type ScanParams,
} from '@/services/intelligence/quality-debt';
import { getOutcomeLedger } from '@/services/intelligence/outcome-ledger';
import { getAlgoEvalLedger } from '@/services/intelligence/algo-eval-ledger';
import { getAssumptionTracker } from '@/services/intelligence/assumption-tracker';
import { dataFreshness } from '@/services/data-freshness';

const REFRESH_MS = 30_000;
const DOMAIN_LIST = [
  'earthquake', 'weather', 'wildfire', 'maritime', 'aviation',
  'biosurveillance', 'space-weather', 'cyber', 'sanctions', 'intelligence',
];

const SEVERITY_COLOR: Record<DebtSeverity, string> = {
  negligible: 'var(--text-secondary, #888)',
  minor: 'var(--severity-info, #69a)',
  moderate: 'var(--severity-medium, #facc15)',
  significant: 'var(--severity-high, #fb923c)',
  critical: 'var(--severity-critical, #ef4444)',
};

const CATEGORY_LABEL: Record<DebtCategory, string> = {
  'data-staleness': 'Data staleness',
  'coverage-gap': 'Coverage gap',
  'model-drift': 'Model drift',
  'assumption-debt': 'Assumption debt',
  'calibration-lag': 'Calibration lag',
  'test-coverage': 'Test coverage',
};

const TREND_GLYPH: Record<DebtTrend, string> = {
  accumulating: '↑',
  stable: '→',
  reducing: '↓',
};

const TREND_COLOR: Record<DebtTrend, string> = {
  accumulating: 'var(--severity-critical, #ef4444)',
  stable: 'var(--text-secondary, #aaa)',
  reducing: 'var(--severity-ok, #4ade80)',
};

export class QualityDebtPanel extends Panel {
  private readonly tracker: QualityDebtTracker;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'quality-debt',
      title: 'Quality Debt',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Accumulating analytical and data-quality debt. Items that compound get worse if ignored — work them down before they turn critical.',
    });
    this.tracker = new QualityDebtTracker();
    this.start();
  }

  private start(): void {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private refresh(): void {
    try {
      const summary = this.tracker.scan(this.collectScanParams());
      this.setCount(summary.items.length);
      this.setContent(this.buildHtml(summary));
      queueMicrotask(() => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Quality debt scan error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private collectScanParams(): ScanParams {
    const feedHealthMap: Record<string, FeedHealth> = {};
    const recentObsCounts: Record<string, number> = {};
    const lastBacktestByDomain: Record<string, Date | null> = {};
    const outcomeCountByDomain: Record<string, number> = {};
    const lastOutcomeByDomain: Record<string, Date | null> = {};

    for (const domain of DOMAIN_LIST) {
      feedHealthMap[domain] = liveFeedHealth(domain);
      recentObsCounts[domain] = liveRecentObsCount(domain);
      lastBacktestByDomain[domain] = null;
      const calibration = safe(() => getOutcomeLedger().getCalibration(domain));
      outcomeCountByDomain[domain] = calibration?.totalOutcomes ?? 0;
      lastOutcomeByDomain[domain] = null;
    }

    const algoStats: NonNullable<ScanParams['algoStats']>[number][] = [];
    const ledger = safe(() => getAlgoEvalLedger());
    if (ledger) {
      for (const domain of DOMAIN_LIST) {
        const stats = safe(() => ledger.getStats('driver-scorer', domain));
        if (stats) algoStats.push(stats);
      }
    }

    const assumptionStats = safe(() => getAssumptionTracker().stats()) ?? {
      totalAssumptions: 0,
      totalOutputs: 0,
      byCategory: {
        'data-quality': 0,
        completeness: 0,
        causality: 0,
        baseline: 0,
        model: 0,
        geospatial: 0,
      },
      criticalCount: 0,
      highRiskCount: 0,
      avgConfidence: 1,
    };

    return {
      feedHealthMap,
      recentObsCounts,
      algoStats,
      assumptionStats,
      outcomeCountByDomain,
      lastOutcomeByDomain,
      lastBacktestByDomain,
    };
  }

  private buildHtml(summary: DebtSummary): string {
    const score = summary.totalDebtScore;
    const scoreColor = scoreBandColor(score);
    const trendColor = TREND_COLOR[summary.trend];
    const trendGlyph = TREND_GLYPH[summary.trend];
    const header = `<div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle,#333);display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Total debt score</div>
        <div style="font-size:28px;font-weight:700;line-height:1;color:${scoreColor};">${score}</div>
      </div>
      <div style="font-size:13px;color:${trendColor};">${trendGlyph} ${escapeHtml(summary.trend)}</div>
      <div style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">
        ${summary.items.length} open · ${summary.fastCompoundingCount} fast-compounding
      </div>
    </div>`;

    const fast = summary.items.filter((i) => i.compoundingRate === 'fast');
    const fastStrip = fast.length > 0
      ? `<div style="padding:8px 16px;background:rgba(239,68,68,0.10);border-bottom:1px solid var(--border-subtle,#333);font-size:11px;">
          <strong style="color:${SEVERITY_COLOR.critical};">Compounding fast:</strong>
          ${fast.map((i) => escapeHtml(`${CATEGORY_LABEL[i.category]} (${i.domain})`)).join(', ')}
        </div>`
      : '';

    const categoryBar = renderCategoryBar(summary.byCategory);
    const itemList = summary.items.length === 0
      ? `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">No quality debt detected. System is operating within expected quality bounds.</div>`
      : `<div style="max-height:420px;overflow:auto;">${[...summary.items].sort(byPriorityDesc).map((i) => renderItem(i)).join('')}</div>`;

    return `${header}${fastStrip}${categoryBar}${itemList}`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-debt-action]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const action = button.dataset.debtAction;
        const id = button.dataset.debtId;
        if (!action || !id) return;
        if (action === 'acknowledge') this.tracker.acknowledge(id);
        else if (action === 'resolve') this.tracker.resolve(id);
        this.refresh();
      });
    }
  }
}

function renderCompoundingBadge(rate: DebtItem['compoundingRate']): string {
  if (rate === 'fast') {
    return `<span style="font-size:9px;font-weight:700;padding:2px 5px;background:${SEVERITY_COLOR.critical};color:#fff;border-radius:3px;text-transform:uppercase;">compounding</span>`;
  }
  if (rate === 'slow') {
    return `<span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.08);color:var(--text-secondary,#aaa);border-radius:3px;text-transform:uppercase;">slow</span>`;
  }
  return '';
}

function renderItem(item: DebtItem): string {
  const sevColor = SEVERITY_COLOR[item.severity];
  const ageHours = Math.round(item.ageMs / 3_600_000);
  const ageLabel = ageHours <= 1 ? 'just now' : `${ageHours}h old`;
  const compoundingBadge = renderCompoundingBadge(item.compoundingRate);
  const ackBadge = item.status === 'acknowledged'
    ? `<span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);color:var(--text-secondary,#aaa);border-radius:3px;text-transform:uppercase;">acknowledged</span>`
    : '';
  const ackButton = item.status === 'acknowledged'
    ? ''
    : `<button data-debt-action="acknowledge" data-debt-id="${escapeHtml(item.id)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Acknowledge</button>`;
  const resolveButton = `<button data-debt-action="resolve" data-debt-id="${escapeHtml(item.id)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Resolve</button>`;

  return `<div style="padding:10px 16px;border-bottom:1px solid var(--border-subtle,#333);">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:9px;font-weight:700;padding:2px 5px;background:${sevColor};color:#fff;border-radius:3px;text-transform:uppercase;">${escapeHtml(item.severity)}</span>
      <span style="font-size:10px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;color:var(--text-secondary,#ccc);">${escapeHtml(CATEGORY_LABEL[item.category])}</span>
      ${compoundingBadge}
      ${ackBadge}
      <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(item.domain)} · ${escapeHtml(ageLabel)}</span>
    </div>
    <div style="margin-top:6px;font-size:12px;font-weight:600;">${escapeHtml(item.title)}</div>
    <div style="margin-top:4px;font-size:11px;color:var(--text-secondary,#bbb);">${escapeHtml(item.description)}</div>
    <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:10px;color:var(--text-secondary,#aaa);font-style:italic;">Repair: ${escapeHtml(item.estimatedCostToRepair)}</span>
      <span style="margin-left:auto;display:flex;gap:6px;">${ackButton}${resolveButton}</span>
    </div>
  </div>`;
}

function renderCategoryBar(byCategory: Record<DebtCategory, number>): string {
  const max = Math.max(1, ...Object.values(byCategory));
  const rows = (Object.keys(byCategory) as DebtCategory[]).map((cat) => {
    const count = byCategory[cat];
    const pct = Math.round((count / max) * 100);
    return `<div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:10px;width:120px;color:var(--text-secondary,#ccc);">${escapeHtml(CATEGORY_LABEL[cat])}</span>
      <div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:var(--severity-medium,#facc15);"></div>
      </div>
      <span style="font-size:10px;width:20px;text-align:right;color:var(--text-secondary,#aaa);">${count}</span>
    </div>`;
  }).join('');
  return `<div style="padding:8px 16px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--border-subtle,#333);">${rows}</div>`;
}

function scoreBandColor(score: number): string {
  if (score === 0) return SEVERITY_COLOR.negligible;
  if (score < 5) return SEVERITY_COLOR.minor;
  if (score < 15) return SEVERITY_COLOR.moderate;
  if (score < 30) return SEVERITY_COLOR.significant;
  return SEVERITY_COLOR.critical;
}

function byPriorityDesc(a: DebtItem, b: DebtItem): number {
  const sevOrder: DebtSeverity[] = ['negligible', 'minor', 'moderate', 'significant', 'critical'];
  return sevOrder.indexOf(b.severity) - sevOrder.indexOf(a.severity);
}

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function liveFeedHealth(domain: string): FeedHealth {
  try {
    const sources = dataFreshness.getAllSources();
    const match = sources.find((s) => s.id === domain || s.id.startsWith(`${domain}-`));
    if (!match) return 'healthy';
    if (match.status === 'no_data' || match.status === 'error' || match.status === 'disabled') return 'down';
    if (match.status === 'stale' || match.status === 'very_stale') return 'degraded';
    return 'healthy';
  } catch {
    return 'healthy';
  }
}

/** Domains explicitly known to be sparse — surface their coverage gap
 *  rather than masking it with the default assumed-healthy count.
 *  Today only sanctions qualifies (OFAC-style daily updates). Extend
 *  this map as real observation-count tracking lands. */
const KNOWN_SPARSE_OBS_COUNTS: Record<string, number> = {
  sanctions: 5,
};
const ASSUMED_HEALTHY_OBS_COUNT = 20;

function liveRecentObsCount(domain: string): number {
  return KNOWN_SPARSE_OBS_COUNTS[domain] ?? ASSUMED_HEALTHY_OBS_COUNT;
}

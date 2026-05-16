/**
 * DomainScorecardPanel — vanilla TS panel surfacing the per-domain
 * A–F grade plus a five-component breakdown. Auto-refreshes every 30s
 * by re-pulling the live OutcomeLedger / AlgoEvalLedger /
 * AttentionAllocator / TrustBudget singletons.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  DomainScorecardService,
  type DomainScorecard,
  type DomainScorecardComponents,
  type DomainScorecardSources,
  type FeedHealth,
  type ScorecardGrade,
  type ScorecardTrend,
} from '@/services/intelligence/domain-scorecard';
import { getOutcomeLedger } from '@/services/intelligence/outcome-ledger';
import { getAlgoEvalLedger } from '@/services/intelligence/algo-eval-ledger';
import { getAttentionAllocator } from '@/services/intelligence/attention-allocator';
import { getTrustBudgetService } from '@/services/notifications/trust-budget';
import { dataFreshness } from '@/services/data-freshness';

const REFRESH_MS = 30_000;
const SORT_OPTIONS = ['grade', 'domain', 'trend'] as const;
type SortKey = typeof SORT_OPTIONS[number];

const GRADE_COLOR: Record<ScorecardGrade, string> = {
  A: 'var(--severity-ok, #4ade80)',
  B: 'var(--severity-low, #5eead4)',
  C: 'var(--severity-medium, #facc15)',
  D: 'var(--severity-high, #fb923c)',
  F: 'var(--severity-critical, #ef4444)',
};

const TREND_ARROW: Record<ScorecardTrend, string> = {
  improving: '↑',
  stable: '→',
  degrading: '↓',
};

const COMPONENT_LABELS: Record<keyof DomainScorecardComponents, string> = {
  outcomeQuality: 'Outcome quality',
  predictionAccuracy: 'Prediction accuracy',
  feedHealth: 'Feed health',
  attentionEfficiency: 'Attention efficiency',
  budgetHealth: 'Budget health',
};

const DOMAIN_LIST = [
  'earthquake', 'weather', 'wildfire', 'maritime', 'aviation',
  'biosurveillance', 'space-weather', 'cyber', 'sanctions', 'intelligence',
];

export class DomainScorecardPanel extends Panel {
  private readonly service: DomainScorecardService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private expandedDomain: string | null = null;
  private sortKey: SortKey = 'grade';

  constructor() {
    super({
      id: 'domain-scorecard',
      title: 'Domain Scorecards',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Per-domain A–F grade consolidating outcome quality, prediction accuracy, feed health, attention efficiency, and notification budget.',
    });
    this.service = new DomainScorecardService({ sources: liveSources() });
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
      const feedMap: Record<string, FeedHealth> = {};
      for (const domain of DOMAIN_LIST) feedMap[domain] = liveFeedHealth(domain);
      this.service.generateAll(feedMap);
      this.render();
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Scorecard refresh error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private render(): void {
    const summary = this.service.generateAll(this.feedMap());
    const cards = this.sortCards(summary.scorecards);
    this.setCount(summary.domainsNeedingAttention.length);
    this.setContent(this.buildHtml(summary.systemGrade, summary.domainsNeedingAttention, cards));
    queueMicrotask(() => this.wireHandlers());
  }

  private feedMap(): Record<string, FeedHealth> {
    const out: Record<string, FeedHealth> = {};
    for (const d of DOMAIN_LIST) out[d] = liveFeedHealth(d);
    return out;
  }

  private sortCards(cards: readonly DomainScorecard[]): DomainScorecard[] {
    const list = [...cards];
    if (this.sortKey === 'domain') return list.sort((a, b) => a.domain.localeCompare(b.domain));
    if (this.sortKey === 'trend') {
      const trendOrder: Record<ScorecardTrend, number> = { degrading: 0, stable: 1, improving: 2 };
      return list.sort((a, b) => trendOrder[a.trend] - trendOrder[b.trend]);
    }
    return list.sort((a, b) => b.overallScore - a.overallScore);
  }

  private buildHtml(systemGrade: ScorecardGrade, needsAttention: readonly string[], cards: readonly DomainScorecard[]): string {
    const systemColor = GRADE_COLOR[systemGrade];
    const header = `<div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle,#333);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:32px;font-weight:700;line-height:1;color:${systemColor};">${systemGrade}</span>
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">System grade</div>
          <div style="font-size:12px;color:var(--text-primary,#ddd);">${cards.length} domain${cards.length === 1 ? '' : 's'} graded</div>
        </div>
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
        <select class="dsp-sort" style="font-size:11px;padding:3px 6px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);">
          ${SORT_OPTIONS.map((opt) => `<option value="${opt}"${opt === this.sortKey ? ' selected' : ''}>Sort: ${escapeHtml(opt)}</option>`).join('')}
        </select>
        <button class="dsp-refresh" style="font-size:11px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Refresh</button>
      </div>
    </div>`;

    const banner = needsAttention.length > 0
      ? `<div style="padding:8px 16px;background:rgba(239,68,68,0.12);border-bottom:1px solid var(--border-subtle,#333);font-size:11px;">
          <strong style="color:${GRADE_COLOR.F};">Needs attention:</strong> ${needsAttention.map((n) => escapeHtml(n)).join(', ')}
        </div>`
      : '';

    const cardGrid = cards.length === 0
      ? `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">No domain data yet — scorecards populate as outcomes accumulate.</div>`
      : `<div style="padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;max-height:460px;overflow:auto;">
          ${cards.map((c) => renderCard(c, c.domain === this.expandedDomain)).join('')}
        </div>`;

    return `${header}${banner}${cardGrid}`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    root.querySelector<HTMLButtonElement>('.dsp-refresh')?.addEventListener('click', () => this.refresh());
    const sort = root.querySelector<HTMLSelectElement>('.dsp-sort');
    sort?.addEventListener('change', () => {
      this.sortKey = sort.value as SortKey;
      this.render();
    });
    for (const card of root.querySelectorAll<HTMLElement>('.dsp-card')) {
      card.addEventListener('click', () => {
        const id = card.dataset.domain ?? null;
        this.expandedDomain = this.expandedDomain === id ? null : id;
        this.render();
      });
    }
  }
}

function renderCard(c: DomainScorecard, expanded: boolean): string {
  const color = GRADE_COLOR[c.grade];
  const pct = Math.round(c.overallScore * 100);
  const trendArrow = TREND_ARROW[c.trend];
  const breakdown = expanded
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle,#333);display:flex;flex-direction:column;gap:6px;">
        ${(Object.keys(c.components) as (keyof DomainScorecardComponents)[]).map((k) => renderComponentBar(k, c.components[k])).join('')}
      </div>`
    : '';
  const issue = c.topIssue
    ? `<div style="margin-top:6px;font-size:11px;color:var(--text-secondary,#bbb);">Top issue: ${escapeHtml(c.topIssue)}</div>`
    : '';
  return `<div class="dsp-card" data-domain="${escapeHtml(c.domain)}" style="padding:12px;background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle,#333);border-radius:6px;cursor:pointer;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:24px;font-weight:700;line-height:1;color:${color};">${c.grade}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;text-transform:capitalize;">${escapeHtml(c.domain)}</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">${pct}% · ${escapeHtml(c.trend)} ${trendArrow}</div>
      </div>
    </div>
    <div style="margin-top:8px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${color};"></div>
    </div>
    ${issue}
    <div style="margin-top:4px;font-size:11px;color:var(--text-secondary,#ccc);">${escapeHtml(c.recommendation)}</div>
    ${breakdown}
  </div>`;
}

function componentColorFor(pct: number): string {
  if (pct >= 70) return GRADE_COLOR.B;
  if (pct >= 40) return GRADE_COLOR.C;
  return GRADE_COLOR.F;
}

function renderComponentBar(key: keyof DomainScorecardComponents, value: number): string {
  const pct = Math.round(value * 100);
  const color = componentColorFor(pct);
  return `<div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary,#aaa);">
      <span>${escapeHtml(COMPONENT_LABELS[key])}</span><span>${pct}%</span>
    </div>
    <div style="height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;margin-top:2px;">
      <div style="height:100%;width:${pct}%;background:${color};"></div>
    </div>
  </div>`;
}

function liveSources(): DomainScorecardSources {
  return {
    getCalibration: (domain) => {
      try { return getOutcomeLedger().getCalibration(domain); } catch { return null; }
    },
    getAlgorithmStats: (algorithmId, domain) => {
      try { return getAlgoEvalLedger().getStats(algorithmId, domain); } catch { return null; }
    },
    getAttentionMultiplier: (domain) => {
      try { return getAttentionAllocator().getMultiplier(domain); } catch { return 1; }
    },
    getBudget: (domain) => {
      try { return getTrustBudgetService().getBudget(domain); } catch { return null; }
    },
  };
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

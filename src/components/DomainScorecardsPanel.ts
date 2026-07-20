/**
 * Domain Scorecards Panel (panel id: `domain-scorecards`).
 *
 * Grid of per-domain cards (overall grade letter + 5 metric mini-bars
 * + trend arrow). Sort controls let the operator order by overall
 * grade or by trend. Clicking a card expands a detail view with an
 * ASCII sparkline of the last 10 overall scores.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getDomainScorecardService,
  type DomainScorecard,
  type ScorecardGrade,
  type ScorecardMetric,
  type ScorecardTrend,
} from '@/services/intelligence/domain-scorecards';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const GRADE_COLOR: Record<ScorecardGrade, string> = {
  A: '#2ec27e',
  B: '#7cc06b',
  C: '#f5a524',
  D: '#e07b30',
  F: '#e94f37',
};

const TREND_ICON: Record<ScorecardTrend, string> = {
  improving: '↑',
  stable: '→',
  degrading: '↓',
};

const TREND_COLOR: Record<ScorecardTrend, string> = {
  improving: '#2ec27e',
  stable: '#9ca3af',
  degrading: '#e94f37',
};

const METRIC_LABEL: Record<ScorecardMetric, string> = {
  accuracy: 'Acc',
  completeness: 'Cmp',
  timeliness: 'Tim',
  'signal-to-noise': 'SNR',
  coverage: 'Cov',
};

const METRIC_ORDER: readonly ScorecardMetric[] = [
  'accuracy',
  'completeness',
  'timeliness',
  'signal-to-noise',
  'coverage',
];

type SortKey = 'grade' | 'trend';

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export class DomainScorecardsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((cards: DomainScorecard[]) => void) | null = null;
  private expanded: string | null = null;
  private sortKey: SortKey = 'grade';

  constructor() {
    super({
      id: 'domain-scorecards',
      title: 'Domain Scorecards',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Per-domain quality grades across accuracy, completeness, timeliness, SNR, and coverage. Click a card for snapshot history.',
    });
    const svc = getDomainScorecardService();
    this.listener = () => this.render();
    svc.subscribe(this.listener);
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.listener) {
      getDomainScorecardService().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getDomainScorecardService();
    const cards = this.sortCards(svc.getAllScorecards());
    const flagged = cards.filter((c) => c.overallGrade === 'D' || c.overallGrade === 'F').length;
    this.setCount(flagged);
    this.setContent(this.buildHtml(cards), () => this.wireHandlers());
  }

  private sortCards(cards: readonly DomainScorecard[]): DomainScorecard[] {
    const out = [...cards];
    if (this.sortKey === 'trend') {
      const rank: Record<ScorecardTrend, number> = { degrading: 0, stable: 1, improving: 2 };
      out.sort((a, b) => rank[a.trend] - rank[b.trend] || b.overallScore - a.overallScore);
    } else {
      out.sort((a, b) => b.overallScore - a.overallScore);
    }
    return out;
  }

  private buildHtml(cards: readonly DomainScorecard[]): string {
    return `<div class="ds-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(cards)}
      ${this.renderGrid(cards)}
    </div>`;
  }

  private renderHeader(cards: readonly DomainScorecard[]): string {
    const total = cards.length;
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">${total} domain${total === 1 ? '' : 's'}</span>
      <div style="display:flex;gap:4px;">
        ${this.sortButton('grade', 'Grade')}
        ${this.sortButton('trend', 'Trend')}
      </div>
    </div>`;
  }

  private sortButton(key: SortKey, label: string): string {
    const active = this.sortKey === key;
    const bg = active ? 'rgba(74,158,255,0.25)' : 'rgba(255,255,255,0.05)';
    const border = active ? 'rgba(74,158,255,0.5)' : 'rgba(255,255,255,0.1)';
    return `<button class="ds-sort" data-key="${escapeHtml(key)}" type="button" style="padding:2px 8px;background:${bg};color:inherit;border:1px solid ${border};border-radius:2px;cursor:pointer;font-size:10px;font-family:inherit;">${escapeHtml(label)}</button>`;
  }

  private renderGrid(cards: readonly DomainScorecard[]): string {
    if (cards.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No scorecards yet — record a metric to start.</div>`;
    }
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;">${cards.map((c) => this.renderCard(c)).join('')}</div>`;
  }

  private renderCard(c: DomainScorecard): string {
    const gradeColor = GRADE_COLOR[c.overallGrade];
    const trendIcon = TREND_ICON[c.trend];
    const trendColor = TREND_COLOR[c.trend];
    const isExpanded = this.expanded === c.domain;
    return `<div class="ds-card" data-domain="${escapeHtml(c.domain)}" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:8px;display:flex;flex-direction:column;gap:5px;cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-family:ui-monospace,monospace;font-size:11px;color:#ddd;">${escapeHtml(c.domain)}</span>
        <span style="font-size:18px;font-weight:800;color:${gradeColor};line-height:1;">${c.overallGrade}</span>
      </div>
      <div style="display:flex;gap:3px;align-items:flex-end;height:24px;">
        ${METRIC_ORDER.map((m) => this.renderMetricBar(m, c.scores[m], c.grades[m])).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;font-size:10px;opacity:0.65;">
        <span>Overall ${(c.overallScore * 100).toFixed(0)}%</span>
        <span style="color:${trendColor};font-weight:600;">${trendIcon} ${c.trend}</span>
      </div>
      ${isExpanded ? this.renderDetail(c) : ''}
    </div>`;
  }

  private renderMetricBar(metric: ScorecardMetric, value: number, grade: ScorecardGrade): string {
    const color = GRADE_COLOR[grade];
    const heightPct = Math.max(6, Math.round(value * 100));
    return `<div title="${escapeHtml(metric)} ${(value * 100).toFixed(0)}%" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;">
      <div style="width:100%;background:rgba(255,255,255,0.06);border-radius:2px 2px 0 0;height:18px;display:flex;align-items:flex-end;overflow:hidden;">
        <div style="width:100%;height:${heightPct}%;background:${color};"></div>
      </div>
      <span style="font-size:8px;opacity:0.55;">${escapeHtml(METRIC_LABEL[metric])}</span>
    </div>`;
  }

  private renderDetail(c: DomainScorecard): string {
    const svc = getDomainScorecardService();
    const snaps = svc.getSnapshots(c.domain, undefined, 200);
    const lastTen = buildOverallTimeline(snaps).slice(-10);
    const sparkline = lastTen.length > 0 ? renderSparkline(lastTen) : '—';
    return `<div style="margin-top:4px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:3px;font-size:10px;">
      <div style="display:flex;justify-content:space-between;gap:6px;">
        <span style="opacity:0.55;">Last-10 overall</span>
        <span style="font-family:ui-monospace,monospace;letter-spacing:1px;">${escapeHtml(sparkline)}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;">
        ${METRIC_ORDER.map((m) => `<div style="display:flex;justify-content:space-between;gap:4px;"><span style="opacity:0.55;">${escapeHtml(m)}</span><span style="font-family:ui-monospace,monospace;color:${GRADE_COLOR[c.grades[m]]};">${(c.scores[m] * 100).toFixed(0)}% (${c.grades[m]})</span></div>`).join('')}
      </div>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.ds-sort')) {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const key = btn.getAttribute('data-key');
        if (key === 'grade' || key === 'trend') {
          this.sortKey = key;
          this.render();
        }
      });
    }

    for (const card of root.querySelectorAll<HTMLElement>('.ds-card')) {
      card.addEventListener('click', () => {
        const domain = card.getAttribute('data-domain');
        if (!domain) return;
        this.expanded = this.expanded === domain ? null : domain;
        this.render();
      });
    }
  }
}

interface DomainSnapshotLite {
  metric: ScorecardMetric;
  value: number;
  recordedAt: number;
}

function buildOverallTimeline(snaps: readonly DomainSnapshotLite[]): number[] {
  if (snaps.length === 0) return [];
  const ordered = [...snaps].sort((a, b) => a.recordedAt - b.recordedAt);
  const running: Record<ScorecardMetric, number> = {
    accuracy: 0.7,
    completeness: 0.7,
    timeliness: 0.7,
    'signal-to-noise': 0.7,
    coverage: 0.7,
  };
  const byMoment = new Map<number, number>();
  for (const s of ordered) {
    running[s.metric] = s.value;
    const sum = METRIC_ORDER.reduce((a, m) => a + running[m], 0);
    byMoment.set(s.recordedAt, sum / METRIC_ORDER.length);
  }
  return [...byMoment.values()];
}

function renderSparkline(values: readonly number[]): string {
  if (values.length === 0) return '';
  return values.map((v) => SPARK_CHARS[Math.min(SPARK_CHARS.length - 1, Math.floor(v * SPARK_CHARS.length))] ?? SPARK_CHARS[0]).join('');
}

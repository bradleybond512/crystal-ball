/**
 * IntelligenceQualityDebtPanel — operator surface for QualityDebtTracker.
 *
 * Four sections, refreshed every 2 minutes:
 *   1. Quality Score    — 0..100 gauge with trend vs the previous tick
 *   2. Active Debt Items — sorted critical-first; domain / category / age / impact
 *   3. Resolution Rate  — opened-vs-closed this week + per-category avg time-to-resolve
 *   4. Domain Health    — per-domain A..F grade based on weighted debt density
 *
 * Pure DOM construction via h() / replaceChildren(). Every helper that
 * shapes content lives in `intelligence-quality-debt-helpers.ts` so tests
 * can exercise the same code paths the panel renders.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  QualityDebtTracker,
  type QualityDebt,
} from '@/services/intelligence/quality-debt-tracker';
import {
  CATEGORY_LABEL,
  GRADE_COLOR,
  SCORE_COLOR,
  SEVERITY_COLOR,
  colorForScore,
  computeDomainHealth,
  computeQualityScore,
  computeResolutionRate,
  formatDuration,
  summarizeActiveDebts,
  trendVsPrevious,
  type ActiveDebtRow,
  type DomainHealthRow,
  type ResolutionRateReport,
  type ScoreTrend,
} from './intelligence-quality-debt-helpers';

const REFRESH_MS = 2 * 60_000;
const SECTION_STYLE = 'border:1px solid var(--border-subtle,#333);border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px;';
const SECTION_TITLE_STYLE = 'font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin:0;';
const SUBTLE = 'font-size:11px;color:var(--text-secondary,#aaa);';

/** Best-effort wrapper: invokes the callback, returns a fallback on
 *  throw. Used to keep the panel resilient when the tracker singleton
 *  has not yet hydrated (cold reload, storage quota etc.). */
function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export class IntelligenceQualityDebtPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private previousScore: number | null = null;

  constructor() {
    super({
      id: 'intelligence-quality-debt',
      title: 'Intelligence Quality',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Operator surface for the intelligence-pipeline quality-debt tracker. Shows overall quality score (with trend), open debt items, weekly resolution rate, and per-domain letter grade.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private render(): void {
    const tracker = QualityDebtTracker.getInstance();
    const debts: readonly QualityDebt[] = safe(() => tracker.getAll(), []);
    const now = Date.now();

    const score = computeQualityScore(debts);
    const trend = trendVsPrevious(score, this.previousScore);
    this.previousScore = score;

    const active = summarizeActiveDebts(debts, now);
    this.setCount(active.length);

    const resolution = computeResolutionRate(debts, now);
    const health = computeDomainHealth(debts);

    const root = h(
      'div',
      { style: 'padding:12px;display:flex;flex-direction:column;gap:12px;' },
      this.renderScoreSection(score, trend, active.length),
      this.renderActiveSection(active),
      this.renderResolutionSection(resolution),
      this.renderHealthSection(health, now),
    );
    replaceChildren(this.content, root);
  }

  // ── 1. Quality score gauge ─────────────────────────────────────────

  private renderScoreSection(score: number, trend: ScoreTrend, openCount: number): HTMLElement {
    const colorKey = colorForScore(score);
    const color = SCORE_COLOR[colorKey];
    const gaugeWidthPct = Math.max(0, Math.min(100, score));
    const gauge = h(
      'div',
      { style: 'background:rgba(255,255,255,0.05);height:8px;border-radius:4px;overflow:hidden;' },
      h('div', { style: `width:${gaugeWidthPct}%;height:100%;background:${color};transition:width 240ms ease;` }),
    );
    const scoreLine = h(
      'div',
      { style: 'display:flex;align-items:baseline;gap:8px;' },
      h('span', { style: `font-size:24px;font-weight:600;color:${color};` }, String(score)),
      h('span', { style: SUBTLE }, '/ 100'),
      h(
        'span',
        { style: `font-size:11px;color:${color};margin-left:auto;` },
        `${trend.glyph} ${trend.delta > 0 ? '+' : ''}${trend.delta}`,
      ),
    );
    return h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'score', grade: colorKey } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Quality Score'),
      scoreLine,
      gauge,
      h('div', { style: SUBTLE }, `${openCount} open debt item${openCount === 1 ? '' : 's'}.`),
    );
  }

  // ── 2. Active debt items ───────────────────────────────────────────

  private renderActiveSection(rows: readonly ActiveDebtRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'active' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Active Debt Items'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No open debt items.'));
      return section;
    }
    for (const row of rows) {
      section.append(renderDebtRow(row));
    }
    return section;
  }

  // ── 3. Resolution rate ─────────────────────────────────────────────

  private renderResolutionSection(report: ResolutionRateReport): HTMLElement {
    const summary = h(
      'div',
      { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;' },
      h('div', { dataset: { metric: 'closed' } },
        h('div', { style: SUBTLE }, 'Closed this week'),
        h('div', { style: 'font-size:18px;color:#e5e5e5;' }, String(report.closedThisWeek))),
      h('div', { dataset: { metric: 'opened' } },
        h('div', { style: SUBTLE }, 'Opened this week'),
        h('div', { style: 'font-size:18px;color:#e5e5e5;' }, String(report.openedThisWeek))),
      h('div', { dataset: { metric: 'ratio' } },
        h('div', { style: SUBTLE }, 'Closed / opened'),
        h('div', { style: 'font-size:18px;color:#e5e5e5;' }, formatRatio(report.ratio))),
    );

    const breakdown = h(
      'div',
      { style: 'display:flex;flex-direction:column;gap:4px;font-size:11px;', dataset: { metric: 'avg-resolve' } },
      h('div', { style: SUBTLE }, 'Avg time-to-resolve (by category)'),
    );
    const entries = Object.entries(report.avgResolveMsByCategory) as [keyof typeof CATEGORY_LABEL, number][];
    if (entries.length === 0) {
      breakdown.append(h('div', { style: SUBTLE }, 'No resolved samples yet.'));
    } else {
      entries.sort((a, b) => b[1] - a[1]);
      for (const [category, ms] of entries) {
        breakdown.append(h(
          'div',
          { style: 'display:flex;justify-content:space-between;color:#e5e5e5;' },
          h('span', null, CATEGORY_LABEL[category]),
          h('span', { style: 'font-family:ui-monospace,monospace;' }, formatDuration(ms)),
        ));
      }
    }

    return h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'resolution' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Resolution Rate'),
      summary,
      breakdown,
    );
  }

  // ── 4. Domain health ───────────────────────────────────────────────

  private renderHealthSection(rows: readonly DomainHealthRow[], nowMs: number): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'health' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Domain Health'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No domain data yet.'));
      return section;
    }
    for (const row of rows) {
      section.append(renderDomainRow(row, nowMs));
    }
    return section;
  }
}

// ── Row renderers ────────────────────────────────────────────────────

function renderDebtRow(row: ActiveDebtRow): HTMLElement {
  const sevColor = SEVERITY_COLOR[row.severity];
  return h(
    'div',
    { style: 'display:grid;grid-template-columns:90px 1fr 50px;gap:8px;align-items:start;font-size:12px;', dataset: { row: 'debt', domain: row.domain, severity: row.severity } },
    h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
      h('span', { style: `font-size:10px;text-transform:uppercase;color:${sevColor};letter-spacing:0.05em;` }, row.severity),
      h('span', { style: SUBTLE }, CATEGORY_LABEL[row.category])),
    h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
      h('div', { style: 'color:#e5e5e5;' }, row.title),
      h('div', { style: SUBTLE }, row.estimatedImpact),
      h('div', { style: SUBTLE }, `domain · ${row.domain}`)),
    h('div', { style: 'font-family:ui-monospace,monospace;text-align:right;color:#e5e5e5;' }, row.ageLabel),
  );
}

function renderDomainRow(row: DomainHealthRow, nowMs: number): HTMLElement {
  const gradeColor = GRADE_COLOR[row.grade];
  const lastVerifiedLabel = row.lastVerifiedAt === null
    ? 'never'
    : `${formatDuration(nowMs - row.lastVerifiedAt)} ago`;
  return h(
    'div',
    { style: 'display:grid;grid-template-columns:30px 1fr 80px 100px;gap:8px;align-items:center;font-size:12px;', dataset: { row: 'domain', domain: row.domain, grade: row.grade } },
    h('div', { style: `width:24px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#fff;background:${gradeColor};font-weight:600;font-size:13px;` }, row.grade),
    h('span', { style: 'color:#e5e5e5;' }, row.domain),
    h('span', { style: SUBTLE }, `${row.openCount} open`),
    h('span', { style: SUBTLE }, `verified ${lastVerifiedLabel}`),
  );
}

// ── Local helpers ────────────────────────────────────────────────────

function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  if (ratio >= 10) return `${ratio.toFixed(0)}×`;
  if (ratio === 0) return '0';
  return ratio.toFixed(2);
}

// Exposed for tests.
export const __testables = { formatRatio, safe };

/**
 * Pure helpers shared by IntelligenceQualityDebtPanel — extracted so tests
 * can import them without dragging in `i18n` / Vite's `import.meta.glob`
 * via the Panel base class.
 *
 * No DOM imports, no fetch, no globals. Every helper takes the data it
 * needs as a parameter so it can be exercised with deterministic fixtures.
 */

import type {
  QualityDebt,
  QualityDebtCategory,
  QualityDebtSeverity,
} from '@/services/intelligence/quality-debt-tracker';

// ── Quality score ─────────────────────────────────────────────────────

/** Penalty weights per severity. Each *open* debt subtracts its weight
 *  from a perfect 100 score; the score floors at 0. Heavier weights on
 *  critical/high keep the dial sensitive to the debts that hurt most. */
export const SEVERITY_PENALTY: Record<QualityDebtSeverity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
};

export type QualityGradeColor = 'green' | 'yellow' | 'red';

export const GRADE_GREEN_MIN = 70;
export const GRADE_YELLOW_MIN = 40;

/**
 * Score derived from open debts (resolved + in-progress don't count
 * against the score; "in-progress" means a fix is already underway so
 * the operator's attention has been captured). Returns an integer in
 * `[0, 100]`.
 */
export function computeQualityScore(debts: readonly QualityDebt[]): number {
  let penalty = 0;
  for (const d of debts) {
    if (d.status !== 'open') continue;
    penalty += SEVERITY_PENALTY[d.severity];
  }
  return Math.max(0, Math.min(100, 100 - penalty));
}

export function colorForScore(score: number): QualityGradeColor {
  if (score >= GRADE_GREEN_MIN) return 'green';
  if (score >= GRADE_YELLOW_MIN) return 'yellow';
  return 'red';
}

export interface ScoreTrend {
  /** Difference between current and previous score. */
  delta: number;
  /** "up" when current > previous, "down" when current < previous, else "flat". */
  direction: 'up' | 'down' | 'flat';
  /** Glyph for the trend chip. */
  glyph: '▲' | '▼' | '→';
}

/** Trend against a baseline score. A higher current score is good
 *  ("up"); a higher previous score is bad ("down"). */
export function trendVsPrevious(currentScore: number, previousScore: number | null): ScoreTrend {
  if (previousScore === null || !Number.isFinite(previousScore)) {
    return { delta: 0, direction: 'flat', glyph: '→' };
  }
  const delta = currentScore - previousScore;
  if (delta > 0) return { delta, direction: 'up', glyph: '▲' };
  if (delta < 0) return { delta, direction: 'down', glyph: '▼' };
  return { delta: 0, direction: 'flat', glyph: '→' };
}

// ── Active debt list ──────────────────────────────────────────────────

export interface ActiveDebtRow {
  id: string;
  domain: string;
  category: QualityDebtCategory;
  severity: QualityDebtSeverity;
  title: string;
  ageLabel: string;
  estimatedImpact: string;
}

/** Severity weight from the tracker, exposed locally so callers can
 *  sort independently of the tracker's internal helper export. */
const SEVERITY_RANK_LOCAL: Record<QualityDebtSeverity, number> = {
  critical: 3, high: 2, medium: 1, low: 0,
};

/** Render-ready rows for the Active Debt Items section, sorted
 *  critical-first / oldest-first within tie. Resolved debts are
 *  excluded; in-progress debts are kept so the operator can see them. */
export function summarizeActiveDebts(
  debts: readonly QualityDebt[],
  nowMs: number,
): ActiveDebtRow[] {
  const open = debts.filter((d) => d.status !== 'resolved');
  open.sort((a, b) => {
    const ra = SEVERITY_RANK_LOCAL[a.severity];
    const rb = SEVERITY_RANK_LOCAL[b.severity];
    if (ra !== rb) return rb - ra;
    return a.createdAt - b.createdAt;
  });
  return open.map((d) => ({
    id: d.id,
    domain: d.domain ?? 'global',
    category: d.category,
    severity: d.severity,
    title: d.title,
    ageLabel: formatAge(d.createdAt, nowMs),
    estimatedImpact: d.estimatedImpact,
  }));
}

/** Compact age label. Returns `"-"` when the event is in the future. */
export function formatAge(createdAt: number, nowMs: number): string {
  const diff = nowMs - createdAt;
  if (diff < 0) return '-';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

// ── Resolution rate ───────────────────────────────────────────────────

export interface ResolutionRateReport {
  openedThisWeek: number;
  closedThisWeek: number;
  /** Ratio closedThisWeek / openedThisWeek, capped at 99.9 when zero
   *  debts opened — `Number.isFinite` is true. */
  ratio: number;
  /** Per-category avg time-to-resolve in milliseconds. Categories with
   *  zero resolved samples are omitted. */
  avgResolveMsByCategory: Partial<Record<QualityDebtCategory, number>>;
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function computeResolutionRate(
  debts: readonly QualityDebt[],
  nowMs: number,
): ResolutionRateReport {
  const weekAgo = nowMs - WEEK_MS;
  let openedThisWeek = 0;
  let closedThisWeek = 0;
  const sums: Partial<Record<QualityDebtCategory, { total: number; n: number }>> = {};
  for (const d of debts) {
    if (d.createdAt >= weekAgo) openedThisWeek += 1;
    if (d.status === 'resolved' && typeof d.resolvedAt === 'number') {
      if (d.resolvedAt >= weekAgo) closedThisWeek += 1;
      const dwell = Math.max(0, d.resolvedAt - d.createdAt);
      const bucket = sums[d.category] ?? { total: 0, n: 0 };
      bucket.total += dwell;
      bucket.n += 1;
      sums[d.category] = bucket;
    }
  }
  const avgResolveMsByCategory: Partial<Record<QualityDebtCategory, number>> = {};
  for (const [category, bucket] of Object.entries(sums) as [QualityDebtCategory, { total: number; n: number }][]) {
    if (bucket.n > 0) avgResolveMsByCategory[category] = Math.round(bucket.total / bucket.n);
  }
  const ratio = computeRatio(openedThisWeek, closedThisWeek);
  return { openedThisWeek, closedThisWeek, ratio, avgResolveMsByCategory };
}

function computeRatio(opened: number, closed: number): number {
  if (opened === 0) return closed === 0 ? 0 : 99.9;
  return closed / opened;
}

/** Pretty-print a duration in ms as "Xh Ym" or "Xd Yh". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes - hours * 60;
  if (hours < 24) return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHr = hours - days * 24;
  return remHr > 0 ? `${days}d ${remHr}h` : `${days}d`;
}

// ── Domain health ─────────────────────────────────────────────────────

export type DomainGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface DomainHealthRow {
  domain: string;
  grade: DomainGrade;
  openCount: number;
  /** Most recent createdAt across all *resolved* debts for the domain.
   *  `null` when no resolved debts exist for the domain. */
  lastVerifiedAt: number | null;
  /** Severity-weighted debt density (lower is better). Exposed for
   *  diagnostic / sorting. */
  weightedDensity: number;
}

/** Mapping from severity-weighted density to letter grade. The
 *  thresholds favour generosity at the top end so a single low-severity
 *  debt doesn't drop a domain below A. */
function gradeFromDensity(weighted: number): DomainGrade {
  if (weighted <= 2) return 'A';
  if (weighted <= 6) return 'B';
  if (weighted <= 14) return 'C';
  if (weighted < 25) return 'D';
  return 'F';
}

/** Group open debts by domain (debts without a domain default to
 *  `global`) and compute a letter grade per domain. */
export function computeDomainHealth(
  debts: readonly QualityDebt[],
): DomainHealthRow[] {
  const byDomain = new Map<string, QualityDebt[]>();
  for (const d of debts) {
    const key = d.domain ?? 'global';
    const list = byDomain.get(key);
    if (list) list.push(d);
    else byDomain.set(key, [d]);
  }
  const rows: DomainHealthRow[] = [];
  for (const [domain, list] of byDomain) {
    let weighted = 0;
    let openCount = 0;
    let lastVerifiedAt: number | null = null;
    for (const d of list) {
      if (d.status !== 'resolved') {
        weighted += SEVERITY_PENALTY[d.severity];
        openCount += 1;
      } else if (typeof d.resolvedAt === 'number' && (lastVerifiedAt === null || d.resolvedAt > lastVerifiedAt)) {
        lastVerifiedAt = d.resolvedAt;
      }
    }
    rows.push({
      domain,
      grade: gradeFromDensity(weighted),
      openCount,
      lastVerifiedAt,
      weightedDensity: weighted,
    });
  }
  rows.sort((a, b) => b.weightedDensity - a.weightedDensity || a.domain.localeCompare(b.domain));
  return rows;
}

// ── Display constants ────────────────────────────────────────────────

export const SEVERITY_COLOR: Record<QualityDebtSeverity, string> = {
  critical: 'var(--severity-critical, #ef4444)',
  high: 'var(--severity-high, #fb923c)',
  medium: 'var(--severity-medium, #facc15)',
  low: 'var(--severity-low, #69a)',
};

export const SCORE_COLOR: Record<QualityGradeColor, string> = {
  green: 'var(--severity-ok, #4ade80)',
  yellow: 'var(--severity-medium, #facc15)',
  red: 'var(--severity-critical, #ef4444)',
};

export const GRADE_COLOR: Record<DomainGrade, string> = {
  A: 'var(--severity-ok, #4ade80)',
  B: 'var(--severity-info, #69a)',
  C: 'var(--severity-medium, #facc15)',
  D: 'var(--severity-high, #fb923c)',
  F: 'var(--severity-critical, #ef4444)',
};

export const CATEGORY_LABEL: Record<QualityDebtCategory, string> = {
  data: 'Data',
  model: 'Model',
  coverage: 'Coverage',
  latency: 'Latency',
  accuracy: 'Accuracy',
};

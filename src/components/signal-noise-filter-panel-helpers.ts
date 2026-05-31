/**
 * Pure helpers for SignalNoiseFilterPanel. No DOM, no fetch, no globals —
 * each helper takes the plain `FilterStats` + `SignalScore[]` inputs and
 * returns a serializable view model. The renderer below also takes plain
 * data, so the panel logic is testable without the Panel base class.
 *
 * Four sections:
 *   - Quality Overview  → totalScored + signal%/noise% gauge
 *   - Recent Scores     → per-observation row (domain, isSignal, top factor)
 *   - Factor Breakdown  → averaged contribution per factor across recent
 *   - Noise Summary     → noise count + remediation hint when noise>60%
 */

import type {
  FilterStats,
  ScoreFactor,
  SignalScore,
} from '@/services/intelligence/signal-noise-filter';
import { escapeHtml } from '@/utils/sanitize';

// ── Section 1 — Quality Overview ───────────────────────────────────

export type QualityBadge = 'good' | 'mixed' | 'noisy' | 'empty';

export interface QualityOverview {
  totalScored: number;
  signalCount: number;
  noiseCount: number;
  avgSignalScore: number;          // 0..1
  signalPercent: number;           // 0..100, rounded
  badge: QualityBadge;
}

export function buildQualityOverview(stats: FilterStats): QualityOverview {
  if (stats.totalScored === 0) {
    return {
      totalScored: 0,
      signalCount: 0,
      noiseCount: 0,
      avgSignalScore: 0,
      signalPercent: 0,
      badge: 'empty',
    };
  }
  const signalPercent = Math.round((stats.signalCount / stats.totalScored) * 100);
  const badge = classifyBadge(signalPercent);
  return {
    totalScored: stats.totalScored,
    signalCount: stats.signalCount,
    noiseCount: stats.noiseCount,
    avgSignalScore: stats.avgSignalScore,
    signalPercent,
    badge,
  };
}

// ── Section 2 — Recent Scores ──────────────────────────────────────

export interface RecentScoreRow {
  observationId: string;
  domain: string;
  isSignal: boolean;
  signalScore: number;             // 0..1
  topFactorName: string;
  topFactorContribution: number;   // weight × value, 0..1
}

export function buildRecentScoresView(
  recent: readonly SignalScore[],
  scoreDomain: (observationId: string) => string,
  limit = 20,
): RecentScoreRow[] {
  return recent.slice(0, limit).map((s): RecentScoreRow => {
    const top = pickTopFactor(s.factors);
    return {
      observationId: s.observationId,
      domain: scoreDomain(s.observationId),
      isSignal: s.isSignal,
      signalScore: s.signalScore,
      topFactorName: top.name,
      topFactorContribution: round4(top.weight * top.value),
    };
  });
}

function classifyBadge(signalPercent: number): QualityBadge {
  if (signalPercent > 70) return 'good';
  if (signalPercent >= 40) return 'mixed';
  return 'noisy';
}

function pickTopFactor(factors: readonly ScoreFactor[]): ScoreFactor {
  if (factors.length === 0) {
    return { name: 'none', weight: 0, value: 0 };
  }
  let best = factors[0]!;
  let bestScore = best.weight * best.value;
  for (let i = 1; i < factors.length; i++) {
    const f = factors[i]!;
    const s = f.weight * f.value;
    if (s > bestScore) { best = f; bestScore = s; }
  }
  return best;
}

// ── Section 3 — Factor Breakdown ───────────────────────────────────

export interface FactorBreakdownEntry {
  name: string;
  avgContribution: number;         // 0..1
  percentOfTotal: number;          // 0..100
}

export function buildFactorBreakdown(
  recent: readonly SignalScore[],
): FactorBreakdownEntry[] {
  if (recent.length === 0) return [];
  // Accumulate contribution per factor name.
  const sums = new Map<string, { total: number; count: number }>();
  for (const s of recent) {
    for (const f of s.factors) {
      const entry = sums.get(f.name) ?? { total: 0, count: 0 };
      entry.total += f.weight * f.value;
      entry.count += 1;
      sums.set(f.name, entry);
    }
  }
  const averages = [...sums.entries()].map(([name, { total, count }]) => ({
    name,
    avgContribution: round4(total / Math.max(1, count)),
  }));
  const totalAvg = averages.reduce((sum, e) => sum + e.avgContribution, 0);
  return averages
    .map((e) => ({
      name: e.name,
      avgContribution: e.avgContribution,
      percentOfTotal: totalAvg === 0 ? 0 : Math.round((e.avgContribution / totalAvg) * 100),
    }))
    .sort((a, b) =>
      b.avgContribution - a.avgContribution || a.name.localeCompare(b.name),
    );
}

// ── Section 4 — Noise Summary ──────────────────────────────────────

export interface NoiseSummary {
  noiseCount: number;
  totalScored: number;
  noisePercent: number;            // 0..100
  recommendation: string;
}

const HIGH_NOISE_RECO = 'Reduce source diversity or await corroboration.';
const MIXED_NOISE_RECO = 'Quality is mixed — watch for false positives in noisy domains.';
const HEALTHY_RECO = 'Signal quality is healthy.';

export function buildNoiseSummary(stats: FilterStats): NoiseSummary {
  if (stats.totalScored === 0) {
    return { noiseCount: 0, totalScored: 0, noisePercent: 0, recommendation: 'No observations scored yet.' };
  }
  const noisePercent = Math.round((stats.noiseCount / stats.totalScored) * 100);
  let recommendation: string;
  if (noisePercent > 60) {
    recommendation = HIGH_NOISE_RECO;
  } else if (noisePercent >= 30) {
    recommendation = MIXED_NOISE_RECO;
  } else {
    recommendation = HEALTHY_RECO;
  }
  return { noiseCount: stats.noiseCount, totalScored: stats.totalScored, noisePercent, recommendation };
}

// ── Combined panel state + renderer ────────────────────────────────

export interface SignalNoisePanelState {
  overview: QualityOverview;
  rows: RecentScoreRow[];
  breakdown: FactorBreakdownEntry[];
  noise: NoiseSummary;
  generatedAt: number;
}

export function renderSignalNoiseFilterHtml(state: SignalNoisePanelState): string {
  return `<div class="snfp">
    ${renderOverview(state.overview)}
    ${renderRecent(state.rows)}
    ${renderBreakdown(state.breakdown)}
    ${renderNoise(state.noise)}
    <div class="snfp-footer" style="margin-top:8px;font-size:11px;opacity:0.6">Updated ${escapeHtml(timeAgoLabel(state.generatedAt))}</div>
  </div>`;
}

function renderOverview(o: QualityOverview): string {
  return `<section class="snfp-section" data-section="quality-overview">
    <h3 style="margin:0 0 6px 0;font-size:13px">Quality Overview</h3>
    <div style="display:flex;align-items:baseline;gap:12px;padding:8px;border-radius:6px;background:${badgeBg(o.badge)}">
      <span style="font-size:20px;font-weight:600">${o.signalPercent}%</span>
      <span style="font-size:11px;opacity:0.85;text-transform:uppercase">${escapeHtml(o.badge)}</span>
      <span style="font-size:11px;opacity:0.75">signal ${o.signalCount} · noise ${o.noiseCount} · scored ${o.totalScored}</span>
      <span style="font-size:11px;opacity:0.6">avg ${o.avgSignalScore.toFixed(2)}</span>
    </div>
    ${renderGaugeBar(o.signalPercent)}
  </section>`;
}

function renderGaugeBar(percent: number): string {
  const p = clamp(percent, 0, 100);
  return `<div style="margin-top:6px;height:6px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden">
    <div style="width:${p}%;height:6px;background:${gaugeColor(p)}"></div>
  </div>`;
}

function renderRecent(rows: RecentScoreRow[]): string {
  if (rows.length === 0) {
    return `<section class="snfp-section" data-section="recent-scores">
      <h3 style="margin:8px 0 6px 0;font-size:13px">Recent Scores</h3>
      <div class="snfp-empty" style="opacity:0.6;font-size:12px">No scored observations yet.</div>
    </section>`;
  }
  const items = rows.map((r) => `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:42px;font-weight:600;color:${r.isSignal ? '#22c55e' : '#ef4444'}">${r.isSignal ? 'SIG' : 'NOISE'}</span>
    <code style="opacity:0.9">${escapeHtml(r.observationId)}</code>
    <span style="opacity:0.65"> · ${escapeHtml(r.domain)}</span>
    <span style="opacity:0.65"> · top:${escapeHtml(r.topFactorName)} ${r.topFactorContribution.toFixed(2)}</span>
    <div style="margin-top:2px;height:4px;border-radius:2px;background:rgba(255,255,255,0.05)">
      <div style="width:${Math.round(r.signalScore * 100)}%;height:4px;background:${gaugeColor(r.signalScore * 100)}"></div>
    </div>
  </li>`).join('');
  return `<section class="snfp-section" data-section="recent-scores">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Recent Scores</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function renderBreakdown(entries: FactorBreakdownEntry[]): string {
  if (entries.length === 0) {
    return `<section class="snfp-section" data-section="factor-breakdown">
      <h3 style="margin:8px 0 6px 0;font-size:13px">Factor Breakdown</h3>
      <div class="snfp-empty" style="opacity:0.6;font-size:12px">No factor data yet.</div>
    </section>`;
  }
  const stripeWidth = (e: FactorBreakdownEntry) => Math.max(1, e.percentOfTotal);
  const colors = ['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ec4899'];
  const stripe = entries.map((e, i) => `<div title="${escapeHtml(e.name)} ${e.percentOfTotal}%" style="flex:${stripeWidth(e)};background:${colors[i % colors.length]};height:10px"></div>`).join('');
  const legend = entries.map((e, i) => `<div style="font-size:11px;opacity:0.85;padding:2px 0">
    <span style="display:inline-block;width:10px;height:10px;background:${colors[i % colors.length]};margin-right:6px"></span>
    ${escapeHtml(e.name)} <span style="opacity:0.7">— avg ${e.avgContribution.toFixed(3)} (${e.percentOfTotal}%)</span>
  </div>`).join('');
  return `<section class="snfp-section" data-section="factor-breakdown">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Factor Breakdown</h3>
    <div style="display:flex;border-radius:4px;overflow:hidden">${stripe}</div>
    <div style="margin-top:6px">${legend}</div>
  </section>`;
}

function renderNoise(n: NoiseSummary): string {
  return `<section class="snfp-section" data-section="noise-summary">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Noise Filter Active</h3>
    <div style="font-size:12px">
      Filtered ${n.noiseCount} of ${n.totalScored} observations
      ${n.totalScored > 0 ? `(${n.noisePercent}%)` : ''}
    </div>
    <div style="margin-top:4px;font-size:11px;opacity:0.85">${escapeHtml(n.recommendation)}</div>
  </section>`;
}

// ── Internals ──────────────────────────────────────────────────────

function gaugeColor(percent: number): string {
  if (percent > 70) return '#22c55e';
  if (percent >= 40) return '#eab308';
  return '#ef4444';
}

const BADGE_BG: Record<QualityBadge, string> = {
  good: 'rgba(34, 197, 94, 0.12)',
  mixed: 'rgba(234, 179, 8, 0.14)',
  noisy: 'rgba(239, 68, 68, 0.16)',
  empty: 'rgba(148, 163, 184, 0.10)',
};

function badgeBg(badge: QualityBadge): string {
  return BADGE_BG[badge];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function timeAgoLabel(ts: number, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

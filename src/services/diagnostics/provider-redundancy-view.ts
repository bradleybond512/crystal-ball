/**
 * Pure view-model for the provider-redundancy report: turns the per-domain
 * verdicts into renderable rows (label, tone, corroborating-source count) so
 * any surface — SystemDiagnostic, Command Center, a dedicated panel — renders
 * the same "source confidence" picture without re-deriving it.
 *
 * Pure: no DOM, no fetch, no globals. Fixture-testable.
 */

import type {
  ProviderRedundancyReport,
  RedundancyVerdict,
  ProviderSnapshot,
} from './provider-redundancy.ts';

export type RedundancyTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface RedundancyRowView {
  domain: string;
  verdict: RedundancyVerdict;
  label: string;
  tone: RedundancyTone;
  /** confidenceMultiplier × 100, rounded. */
  confidencePct: number;
  providersUp: number;
  providersTotal: number;
  /** Up providers that carry a comparable fact fingerprint (true corroborators). */
  corroboratingSources: number;
  detail: string;
  remediation: string;
}

export interface RedundancyViewModel {
  rows: RedundancyRowView[];
  healthyCount: number;
  stressedCount: number;
  headline: string;
}

const VERDICT_LABEL: Record<RedundancyVerdict, string> = {
  redundant_agreement: 'Verified',
  redundant_unverified: 'Up, unverified',
  redundant_disagreement: 'Sources disagree',
  single_source: 'Single source',
  primary_down_with_backup: 'Primary down',
  all_down: 'All down',
  unknown: 'Unknown',
};

const VERDICT_TONE: Record<RedundancyVerdict, RedundancyTone> = {
  redundant_agreement: 'good',
  redundant_unverified: 'neutral',
  redundant_disagreement: 'warn',
  single_source: 'warn',
  primary_down_with_backup: 'bad',
  all_down: 'bad',
  unknown: 'neutral',
};

/** Sort worst-first so the surface leads with what needs attention. */
const TONE_RANK: Record<RedundancyTone, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };

export function verdictLabel(v: RedundancyVerdict): string {
  return VERDICT_LABEL[v];
}

export function verdictTone(v: RedundancyVerdict): RedundancyTone {
  return VERDICT_TONE[v];
}

/** A truthful one-liner for a row. Only claims "✓ N independent sources" when
 *  the verdict is actually agreement — NOT for disagreement (where ≥2 providers
 *  carry fingerprints, but different ones). */
export function corroborationSummary(row: RedundancyRowView): string {
  if (row.verdict === 'redundant_agreement' && row.corroboratingSources >= 2) {
    return `✓ ${row.corroboratingSources} independent sources`;
  }
  return `${row.providersUp}/${row.providersTotal} up`;
}

export function buildRedundancyView(report: ProviderRedundancyReport): RedundancyViewModel {
  const rows: RedundancyRowView[] = report.domains.map((d) => {
    const tone = VERDICT_TONE[d.verdict];
    return {
      domain: d.domain,
      verdict: d.verdict,
      label: VERDICT_LABEL[d.verdict],
      tone,
      confidencePct: Math.round(d.confidenceMultiplier * 100),
      providersUp: countUp(d.providers),
      providersTotal: d.providers.length,
      corroboratingSources: countCorroborating(d.providers),
      detail: d.reason,
      remediation: d.remediation,
    };
  });

  rows.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || a.domain.localeCompare(b.domain));

  const healthyCount = rows.filter((r) => r.tone === 'good').length;
  const stressedCount = rows.length - healthyCount;
  return { rows, healthyCount, stressedCount, headline: buildHeadline(rows.length, healthyCount, stressedCount) };
}

function countUp(providers: readonly ProviderSnapshot[]): number {
  return providers.filter((p) => p.level === 'healthy' || p.level === 'degraded').length;
}

function countCorroborating(providers: readonly ProviderSnapshot[]): number {
  return providers.filter(
    (p) => p.recentFactFingerprint && (p.level === 'healthy' || p.level === 'degraded'),
  ).length;
}

function buildHeadline(total: number, healthy: number, stressed: number): string {
  if (total === 0) return 'No provider domains reporting.';
  if (stressed === 0) return `All ${total} domains verified across redundant sources.`;
  return `${healthy}/${total} domains verified; ${stressed} need attention.`;
}

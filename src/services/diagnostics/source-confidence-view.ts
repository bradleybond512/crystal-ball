/**
 * Source Confidence Panel — pure view-model.
 *
 * Composes the existing provider-redundancy report + provider-health
 * timelines into the exact renderable shape SourceConfidencePanel.ts needs:
 * which domains are fusion-verified (multi-source, agreeing) vs disagreeing
 * vs single-source vs down, per-provider health within each domain, and the
 * fusion confidence multiplier. No scoring logic is reimplemented here — it
 * only reshapes `assessProviderRedundancy()` output (via
 * `buildRedundancyView()`) and `provider-health-timeline-view.ts` output.
 *
 * Pure: no DOM, no fetch, no globals. Fixture-testable.
 *
 * Per docs/superpowers/specs/2026-06-28-redundancy-prediction-enhancement-program-design.md
 * §6.E: "SourceConfidencePanel (new, Phase 1): per-domain redundancy
 * verdict, live disagreements, provider-health timeline."
 */

import type {
  ProviderRedundancyReport,
  DomainRedundancy,
  ProviderHealthLevel,
  RedundancyVerdict,
} from './provider-redundancy.ts';
import {
  buildRedundancyView,
  verdictLabel,
  verdictTone,
  corroborationSummary,
  type RedundancyTone,
} from './provider-redundancy-view.ts';
import type { ProviderTimelineView } from '../providers/provider-health-timeline-view.ts';

export interface ProviderRowView {
  providerId: string;
  label: string;
  levelLabel: string;
  tone: RedundancyTone;
  primary: boolean;
  /** Rolling success rate 0..1 from the redundancy snapshot, when known. */
  successRatePct?: number;
  lastSuccessAt?: number;
  fingerprint?: string;
  /** True when this provider's fingerprint differs from the domain's
   *  majority fingerprint — i.e. it's the odd one out in a disagreement. */
  disagreeing: boolean;
  timeline?: ProviderTimelineView;
}

export interface DomainConfidenceView {
  domain: string;
  verdict: RedundancyVerdict;
  label: string;
  tone: RedundancyTone;
  /** confidenceMultiplier × 100, rounded. */
  confidencePct: number;
  corroborationText: string;
  detail: string;
  remediation: string;
  /** True once ≥2 independent sources produce comparable fact fingerprints
   *  (agreement or disagreement) — i.e. the fusion-ingest pipeline is
   *  actively wired for this domain, not just multiple providers registered. */
  fusionActive: boolean;
  providers: readonly ProviderRowView[];
}

export interface SourceConfidenceSummary {
  totalDomains: number;
  /** Domains where sources are up and their fingerprints agree. */
  fusionVerifiedCount: number;
  /** Domains where sources are up but disagree — needs attention. */
  disagreementCount: number;
  /** Domains with only one working provider — a silent point of failure. */
  singleSourceCount: number;
  /** Domains where every provider is down. */
  downCount: number;
  headline: string;
}

export interface SourceConfidenceView {
  summary: SourceConfidenceSummary;
  domains: readonly DomainConfidenceView[];
}

const FUSION_ACTIVE_VERDICTS: ReadonlySet<RedundancyVerdict> = new Set<RedundancyVerdict>([
  'redundant_agreement',
  'redundant_disagreement',
]);

/** A domain is "fusion active" once ≥2 sources emit a comparable fact
 *  fingerprint — whether they agree or disagree. `redundant_unverified`
 *  (2+ up, no comparable fingerprints yet) is NOT fusion-active: it's a
 *  Workstream-A widening candidate, not a proven corroboration. */
export function isFusionActive(verdict: RedundancyVerdict): boolean {
  return FUSION_ACTIVE_VERDICTS.has(verdict);
}

export function buildSourceConfidenceView(
  report: ProviderRedundancyReport,
  timelines: Readonly<Record<string, ProviderTimelineView>> = {},
): SourceConfidenceView {
  // Reuse the existing view-model for label/tone/confidence/corroboration
  // text so every surface renders the identical picture.
  const rowVm = buildRedundancyView(report);
  const rowByDomain = new Map(rowVm.rows.map((r) => [r.domain, r]));

  const domains: DomainConfidenceView[] = report.domains.map((d) => {
    const row = rowByDomain.get(d.domain);
    return {
      domain: d.domain,
      verdict: d.verdict,
      label: row?.label ?? verdictLabel(d.verdict),
      tone: row?.tone ?? verdictTone(d.verdict),
      confidencePct: row?.confidencePct ?? Math.round(d.confidenceMultiplier * 100),
      corroborationText: row ? corroborationSummary(row) : '',
      detail: d.reason,
      remediation: d.remediation,
      fusionActive: isFusionActive(d.verdict),
      providers: buildProviderRows(d, timelines),
    };
  });

  const fusionVerifiedCount = domains.filter((d) => d.verdict === 'redundant_agreement').length;
  const disagreementCount = domains.filter((d) => d.verdict === 'redundant_disagreement').length;
  const singleSourceCount = domains.filter((d) => d.verdict === 'single_source').length;
  const downCount = domains.filter(
    (d) => d.verdict === 'all_down' || d.verdict === 'primary_down_with_backup',
  ).length;

  return {
    summary: {
      totalDomains: domains.length,
      fusionVerifiedCount,
      disagreementCount,
      singleSourceCount,
      downCount,
      headline: buildSummaryHeadline(domains.length, fusionVerifiedCount, singleSourceCount, disagreementCount),
    },
    domains,
  };
}

function buildProviderRows(
  d: DomainRedundancy,
  timelines: Readonly<Record<string, ProviderTimelineView>>,
): ProviderRowView[] {
  const majorityFingerprint = pickMajorityFingerprint(d);
  return d.providers.map((p) => ({
    providerId: p.providerId,
    label: p.label,
    levelLabel: LEVEL_LABEL[p.level],
    tone: LEVEL_TONE[p.level],
    primary: p.primary,
    successRatePct: p.successRate === undefined ? undefined : Math.round(p.successRate * 100),
    lastSuccessAt: p.lastSuccessAt,
    fingerprint: p.recentFactFingerprint,
    disagreeing:
      d.verdict === 'redundant_disagreement' &&
      Boolean(p.recentFactFingerprint) &&
      p.recentFactFingerprint !== majorityFingerprint,
    timeline: timelines[p.providerId],
  }));
}

/** The fingerprint value shared by the most providers (ties broken by
 *  first-seen) — used only to flag which provider(s) are the odd one out
 *  in a disagreement; the underlying disagreement verdict itself comes
 *  from `assessProviderRedundancy()`, not from this tie-break. */
function pickMajorityFingerprint(d: DomainRedundancy): string | undefined {
  const counts = new Map<string, number>();
  for (const p of d.providers) {
    if (!p.recentFactFingerprint) continue;
    counts.set(p.recentFactFingerprint, (counts.get(p.recentFactFingerprint) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = -1;
  for (const [fp, count] of counts) {
    if (count > bestCount) {
      best = fp;
      bestCount = count;
    }
  }
  return best;
}

function buildSummaryHeadline(
  total: number,
  fusionVerified: number,
  singleSource: number,
  disagreement: number,
): string {
  if (total === 0) return 'No provider domains reporting.';
  const parts: string[] = [`${fusionVerified}/${total} fusion-verified`];
  if (disagreement > 0) parts.push(`${disagreement} disagreeing`);
  if (singleSource > 0) parts.push(`${singleSource} single-source`);
  return parts.join(' · ');
}

const LEVEL_LABEL: Record<ProviderHealthLevel, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  failing: 'Failing',
  silent: 'Silent',
  unknown: 'Unknown',
};

const LEVEL_TONE: Record<ProviderHealthLevel, RedundancyTone> = {
  healthy: 'good',
  degraded: 'warn',
  failing: 'bad',
  silent: 'bad',
  unknown: 'neutral',
};

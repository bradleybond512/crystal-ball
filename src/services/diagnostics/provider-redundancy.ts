/**
 * Provider Redundancy Health — gap #11 from
 * docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md.
 *
 * For each data domain (weather, ADS-B, commodities, …) the user
 * deserves a first-class view of whether redundant providers agree.
 * This module produces a deterministic ProviderRedundancyReport from
 * a per-provider snapshot list.
 *
 * Pure deterministic. No DOM, no fetch, no globals.
 *
 * Plan invariants:
 *   - Every domain reports its primary, the active backups, and the
 *     "is the data layer weak?" verdict
 *   - Disagreement penalty is explicit — when providers within a
 *     domain disagree on the same fact, confidence drops and the UI
 *     can show a contradiction
 *   - JSON-serializable for the diagnostics export bundle
 */

// ── Public API ──────────────────────────────────────────────────────────

export type ProviderHealthLevel = 'healthy' | 'degraded' | 'failing' | 'silent' | 'unknown';

export interface ProviderSnapshot {
  providerId: string;
  /** Domain the provider belongs to ('weather', 'adsb', …). */
  domain: string;
  label: string;
  /** True when this provider is the primary for its domain. */
  primary: boolean;
  level: ProviderHealthLevel;
  /** ms timestamp of the most-recent successful fetch. */
  lastSuccessAt?: number;
  /** Optional rolling success rate 0..1. */
  successRate?: number;
  /** Optional fingerprint — when two providers in the same domain
   *  emit different fingerprints for the same fact, that's a
   *  disagreement signal. */
  recentFactFingerprint?: string;
  /** Optional free-text last-error message. */
  lastError?: string;
  /** Set when the provider declares a required API key that isn't configured.
   *  Such a provider is structurally unreachable — it was never switched on,
   *  as opposed to switched on and now failing. */
  unconfiguredSecret?: string;
}

export type RedundancyVerdict =
  | 'redundant_agreement'  // multiple providers up + same fact fingerprint (verified)
  | 'redundant_unverified'  // multiple up but no comparable fingerprints — agreement NOT verified
  | 'redundant_disagreement'  // multiple up but emitting different fingerprints
  | 'single_source'        // primary up, no working backup
  | 'primary_down_with_backup'
  | 'not_configured'       // nothing up, and every provider is waiting on an API key
  | 'all_down'
  | 'unknown';

export interface DomainRedundancy {
  domain: string;
  verdict: RedundancyVerdict;
  /** 0..1 multiplier downstream scoring should apply to facts from
   *  this domain. */
  confidenceMultiplier: number;
  /** Free-text reason. */
  reason: string;
  /** Concrete remediation hint when not healthy. */
  remediation: string;
  /** All providers in this domain, sorted primary first then by level. */
  providers: readonly ProviderSnapshot[];
}

export interface ProviderRedundancyReport {
  generatedAt: number;
  domains: readonly DomainRedundancy[];
  /** "weather: 2/2 healthy redundant; adsb: primary down; …" */
  summary: string;
  /** Concrete actions, sorted by severity. */
  recommendations: readonly string[];
}

export interface AssessRedundancyInput {
  generatedAt?: number;
  snapshots: readonly ProviderSnapshot[];
}

// ── Engine ──────────────────────────────────────────────────────────────

export function assessProviderRedundancy(input: AssessRedundancyInput): ProviderRedundancyReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const byDomain = groupByDomain(input.snapshots);
  const domains: DomainRedundancy[] = [];
  for (const [domain, providers] of byDomain) {
    domains.push(buildDomainEntry(domain, providers));
  }
  domains.sort((a, b) => VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict] || a.domain.localeCompare(b.domain));
  return {
    generatedAt,
    domains,
    summary: describeSummary(domains),
    recommendations: collectRecommendations(domains),
  };
}

function groupByDomain(snapshots: readonly ProviderSnapshot[]): Map<string, ProviderSnapshot[]> {
  const map = new Map<string, ProviderSnapshot[]>();
  for (const s of snapshots) {
    const list = map.get(s.domain) ?? [];
    list.push(s);
    map.set(s.domain, list);
  }
  return map;
}

function buildDomainEntry(domain: string, raw: readonly ProviderSnapshot[]): DomainRedundancy {
  const providers = [...raw].sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
  });
  const verdict = decideVerdict(providers);
  const confidenceMultiplier = MULTIPLIER[verdict];
  const reason = describeVerdict(verdict, providers);
  return {
    domain,
    verdict,
    confidenceMultiplier,
    reason,
    remediation: pickRemediation(verdict, domain, providers),
    providers,
  };
}

function decideVerdict(providers: readonly ProviderSnapshot[]): RedundancyVerdict {
  if (providers.length === 0) return 'unknown';
  const upProviders = providers.filter((p) => p.level === 'healthy' || p.level === 'degraded');
  const primary = providers.find((p) => p.primary);

  if (upProviders.length === 0) {
    // Nothing up. Distinguish "never switched on" from "switched on and broke":
    // only when EVERY provider is waiting on an API key is the honest advice
    // "enter the key". One genuinely broken provider makes it an outage.
    return providers.every((p) => p.unconfiguredSecret) ? 'not_configured' : 'all_down';
  }
  if (upProviders.length === 1) {
    const onlyUp = upProviders[0]!;
    // Only call it 'primary down' when a DIFFERENT provider is the registry
    // primary and it isn't up. A lone healthy source where the registry
    // primary simply isn't represented (e.g. a fused subset of a domain) is
    // honestly 'single_source', not an alarmist 'primary down'.
    if (
      primary && primary.providerId !== onlyUp.providerId &&
      primary.level !== 'healthy' && primary.level !== 'degraded'
    ) {
      return 'primary_down_with_backup';
    }
    return 'single_source';
  }
  // Two or more up — judge agreement by fact fingerprints. Only providers that
  // actually emit a comparable fingerprint count as corroborating; an up
  // provider reporting unrelated facts (no fingerprint) cannot manufacture
  // agreement on its own.
  const fingerprinted = upProviders.filter((p) => p.recentFactFingerprint);
  const fingerprints = new Set(fingerprinted.map((p) => p.recentFactFingerprint));
  if (fingerprints.size > 1) return 'redundant_disagreement';
  // Need ≥2 providers sharing one fingerprint to claim verified agreement.
  if (fingerprints.size === 1 && fingerprinted.length >= 2) return 'redundant_agreement';
  // 0 or 1 providers carry a comparable fingerprint — agreement unverified.
  return 'redundant_unverified';
}

const LEVEL_RANK: Record<ProviderHealthLevel, number> = {
  healthy: 0,
  degraded: 1,
  failing: 2,
  silent: 3,
  unknown: 4,
};

const VERDICT_RANK: Record<RedundancyVerdict, number> = {
  redundant_agreement: 0,
  redundant_unverified: 1,
  unknown: 2,
  single_source: 3,
  redundant_disagreement: 4,
  primary_down_with_backup: 5,
  // Below all_down: a domain that was never enabled is a gap to close, while a
  // domain that WAS answering and stopped is a live problem.
  not_configured: 6,
  all_down: 7,
};

const MULTIPLIER: Record<RedundancyVerdict, number> = {
  redundant_agreement: 1,
  // 2+ providers up (some redundancy) but agreement unverified — a small
  // discount from full confidence, still better than a lone source.
  redundant_unverified: 0.9,
  redundant_disagreement: 0.6,
  single_source: 0.7,
  primary_down_with_backup: 0.5,
  // No key means no data — same zero as all_down, different cause.
  not_configured: 0,
  all_down: 0,
  unknown: 0.5,
};

/** The distinct API keys a domain is waiting on, in provider order. */
function missingSecrets(providers: readonly ProviderSnapshot[]): string[] {
  const keys: string[] = [];
  for (const p of providers) {
    if (p.unconfiguredSecret && !keys.includes(p.unconfiguredSecret)) keys.push(p.unconfiguredSecret);
  }
  return keys;
}

function describeVerdict(verdict: RedundancyVerdict, providers: readonly ProviderSnapshot[]): string {
  const upCount = providers.filter((p) => p.level === 'healthy' || p.level === 'degraded').length;
  const total = providers.length;
  switch (verdict) {
    case 'redundant_agreement': {
      const corroborating = providers.filter(
        (p) => p.recentFactFingerprint && (p.level === 'healthy' || p.level === 'degraded'),
      ).length;
      return `${corroborating} independent source${corroborating === 1 ? '' : 's'} corroborate the latest fact (${upCount} of ${total} providers up).`;
    }
    case 'redundant_unverified': {
      return `${upCount} of ${total} providers up, but agreement is unverified (no comparable fact fingerprints).`;
    }
    case 'redundant_disagreement': {
      return `${upCount} of ${total} providers up but emitting different fingerprints — manual review needed.`;
    }
    case 'single_source': {
      return total === 1
        ? 'Only one provider configured for this domain.'
        : `${upCount} of ${total} providers up — no working backup.`;
    }
    case 'primary_down_with_backup': {
      return `Primary down; running on backup only.`;
    }
    case 'not_configured': {
      const keys = missingSecrets(providers);
      return keys.length === 1
        ? `${keys[0]} is not configured — this domain has no reachable source.`
        : `No reachable source: ${keys.join(', ')} are not configured.`;
    }
    case 'all_down': {
      return `${total} providers configured, none reachable.`;
    }
    case 'unknown': {
      return 'No provider snapshots reported yet.';
    }
  }
}

function pickRemediation(
  verdict: RedundancyVerdict,
  domain: string,
  providers: readonly ProviderSnapshot[],
): string {
  switch (verdict) {
    case 'redundant_agreement': {
      return '';
    }
    case 'redundant_unverified': {
      return `${domain}: providers are up but emit no comparable fact fingerprints, so agreement can't be verified — wire recentFactFingerprint into the snapshots.`;
    }
    case 'redundant_disagreement': {
      return `${domain}: providers disagree on the latest fact. Open the diagnostics inspector to compare fingerprints.`;
    }
    case 'single_source': {
      return `${domain}: configure a backup provider so a single outage doesn't blind this domain.`;
    }
    case 'primary_down_with_backup': {
      return `${domain}: investigate the primary provider; verify keys + upstream availability.`;
    }
    case 'not_configured': {
      return `${domain}: add ${missingSecrets(providers).join(' or ')} in Settings → API Keys to enable this domain.`;
    }
    case 'all_down': {
      return `${domain}: every provider is silent. Check the sidecar + network connectivity.`;
    }
    case 'unknown': {
      return `${domain}: no snapshots yet. Wire the provider registry into the diagnostics state.`;
    }
  }
}

function describeSummary(domains: readonly DomainRedundancy[]): string {
  if (domains.length === 0) return 'No providers configured.';
  const parts: string[] = [];
  let stressed = 0;
  for (const d of domains) {
    if (d.verdict !== 'redundant_agreement') stressed += 1;
  }
  if (stressed === 0) {
    return `All ${domains.length} domains running with redundant agreement.`;
  }
  parts.push(`${stressed} of ${domains.length} domains stressed`);
  return `Provider redundancy: ${parts.join('; ')}.`;
}

function collectRecommendations(domains: readonly DomainRedundancy[]): readonly string[] {
  const out: string[] = [];
  for (const d of [...domains].sort((a, b) => VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict])) {
    if (!d.remediation) continue;
    out.push(d.remediation);
    if (out.length >= 6) break;
  }
  return out;
}

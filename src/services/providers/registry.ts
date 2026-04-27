/**
 * Provider Registry — domain-keyed catalog of upstream data sources used by
 * Crystal Ball. Each provider declaration captures its auth type, freshness
 * expectations, baseline reliability weight, and fallback priority within
 * its domain so panels can iterate sources in a consistent order, and the
 * fusion scorer can weight corroboration across them.
 *
 * The registry intentionally does NOT execute fetches. It's pure metadata.
 * Health (last success/error/latency/status) lives in `./health.ts` so the
 * registry stays a frozen reference table.
 *
 * Adding a new provider:
 *   1. Append to PROVIDERS_BY_DOMAIN under the right domain.
 *   2. Set fallbackPriority — 0 is primary, 1 the first fallback, etc.
 *   3. If it gates on a key, point requiredKey at the matching
 *      RuntimeSecretKey from runtime-config.ts.
 *   4. baselineWeight ∈ [0, 1] — your prior on this source's reliability
 *      *before* any health/freshness adjustments. Authoritative gov
 *      sources start near 0.9; community/scraped feeds start near 0.5.
 */

import type { RuntimeSecretKey } from '../runtime-config';

/** Top-level data domains. Panels query providers within a domain.
 *  Adding a new domain requires updating PROVIDERS_BY_DOMAIN and the
 *  ProviderDomainMap type below. */
export type ProviderDomain =
  | 'aviation'         // ADS-B, METAR/TAF, NOTAMs
  | 'weather'          // forecasts, radar, hazards
  | 'maritime'         // AIS, ports, sea state
  | 'conflict'         // ACLED, UCDP, GDELT-derived
  | 'humanitarian'     // ReliefWeb, HDX, UNHCR
  | 'cyber'            // CVE, IOC, threat intel
  | 'markets'          // SEC, treasury, FX, crypto
  | 'macro'            // FRED, BIS, IMF, WB
  | 'space'            // TLE, space weather, NEO
  | 'infra'            // ASN, BGP, IXP, DNS
  | 'geo'              // OSM, Wikidata, Wikipedia, GeoNames
  | 'transport'        // GTFS, traffic, rail
  | 'news'             // RSS aggregators, NewsAPI, GDELT
  | 'ai'               // LLM providers
  | 'military';        // bases, contracts, posture

/** Authentication style required to call the provider. */
export type ProviderAuth =
  | 'none'             // public, no header/key
  | 'apikey-query'     // key in URL query string
  | 'apikey-header'    // key in custom header (e.g. X-Api-Key)
  | 'bearer'           // Authorization: Bearer
  | 'basic'            // Authorization: Basic
  | 'oauth';           // full OAuth flow

/** Status of the upstream service. Use 'deprecated' (not 'down') when the
 *  service shut down permanently — that signals "don't bother retrying,
 *  remove from rotation" vs "transiently unhealthy". */
export type ProviderLifecycle = 'active' | 'deprecated' | 'experimental';

export interface ProviderDefinition {
  /** Stable short id, kebab-case. Example: 'airplanes-live'. Must be
   *  unique across the entire registry (not just within a domain). */
  id: string;

  /** Domain this provider serves data for. Cross-domain providers (e.g.
   *  WikiData supplies bases AND vessel metadata) get registered once
   *  per domain they serve. */
  domain: ProviderDomain;

  /** Human-readable name for display. */
  name: string;

  /** Auth type. 'none' is preferred; others should specify requiredKey
   *  unless the key is configured server-side via env. */
  auth: ProviderAuth;

  /** Provider's API root URL (informational; clients build full URLs
   *  from endpoint paths). */
  baseUrl: string;

  /** RuntimeSecretKey this provider needs, or null if no client-side
   *  key is required. Multiple keys (e.g. ACLED needs token + email)
   *  pass them as requiredKeys instead. */
  requiredKey?: RuntimeSecretKey | null;
  /** For providers needing more than one secret. */
  requiredKeys?: RuntimeSecretKey[];

  /** Freshness Time-To-Live (ms). Cached responses older than this are
   *  considered stale and a fetch is preferred when fresh data is
   *  needed. NOT the same as HTTP cache-control — this is the
   *  *acceptability* horizon for the data the provider returns. */
  ttlMs: number;

  /** Free-text rate-limit guidance from the provider's docs (e.g.
   *  "100 req/hr free, 1000/hr with key"). For human reference and
   *  future automated quota tracking. */
  rateLimitNotes?: string;

  /** Baseline reliability weight in [0, 1] used by the fusion scorer
   *  before any health/freshness adjustments. Authoritative gov: 0.85+.
   *  Curated commercial: 0.75+. Community: 0.5-0.7. */
  baselineWeight: number;

  /** 0 = primary source for the domain. 1 = first fallback. Multiple
   *  providers can share a priority — the fusion scorer treats them as
   *  parallel sources for corroboration. */
  fallbackPriority: number;

  /** Feature toggles that gate use. Empty = always-on. */
  featureFlags?: string[];

  /** Lifecycle stage. 'deprecated' providers are skipped by
   *  selectActiveProviders() but kept in the registry so we don't
   *  forget about them. */
  lifecycle: ProviderLifecycle;

  /** Docs / signup URL for human reference. */
  docsUrl?: string;

  /** One-line description for tooltips/admin UI. */
  description?: string;
}

/** All registered providers, keyed by domain and ordered by
 *  fallbackPriority ascending. The list-of-lists shape lets the fusion
 *  scorer iterate by domain without filtering the full registry. */
export const PROVIDERS_BY_DOMAIN: Record<ProviderDomain, ProviderDefinition[]> = {
  aviation: [],
  weather: [],
  maritime: [],
  conflict: [],
  humanitarian: [],
  cyber: [],
  markets: [],
  macro: [],
  space: [],
  infra: [],
  geo: [],
  transport: [],
  news: [],
  ai: [],
  military: [],
};

/** Flat lookup by id. Lazily built on first access; rebuilt by
 *  rebuildProviderIndex() when providers are mutated (mostly tests). */
let _idIndex: Map<string, ProviderDefinition> | null = null;

function buildIndex(): Map<string, ProviderDefinition> {
  const m = new Map<string, ProviderDefinition>();
  for (const list of Object.values(PROVIDERS_BY_DOMAIN)) {
    for (const p of list) {
      if (m.has(p.id)) {
        throw new Error(`Duplicate provider id: ${p.id} (domain ${p.domain})`);
      }
      m.set(p.id, p);
    }
  }
  return m;
}

/** Force a rebuild of the id index. Call after directly mutating
 *  PROVIDERS_BY_DOMAIN (mainly for tests). */
export function rebuildProviderIndex(): void {
  _idIndex = buildIndex();
}

/** Lookup a single provider by its stable id. Returns undefined if
 *  no provider with that id is registered. */
export function getProvider(id: string): ProviderDefinition | undefined {
  _idIndex ??= buildIndex();
  return _idIndex.get(id);
}

/** Get the providers serving a domain, sorted by fallbackPriority then
 *  baselineWeight (descending). Excludes deprecated providers by
 *  default — pass includeDeprecated=true to see all. */
export function getProvidersForDomain(
  domain: ProviderDomain,
  options: { includeDeprecated?: boolean } = {},
): ProviderDefinition[] {
  const all = PROVIDERS_BY_DOMAIN[domain] ?? [];
  const filtered = options.includeDeprecated
    ? all
    : all.filter((p) => p.lifecycle !== 'deprecated');
  return [...filtered].sort((a, b) => {
    if (a.fallbackPriority !== b.fallbackPriority) {
      return a.fallbackPriority - b.fallbackPriority;
    }
    return b.baselineWeight - a.baselineWeight;
  });
}

/** Convenience: every active provider, flat. Useful for the admin UI
 *  and for cross-domain operations like health snapshotting. */
export function getAllActiveProviders(): ProviderDefinition[] {
  const out: ProviderDefinition[] = [];
  for (const domain of Object.keys(PROVIDERS_BY_DOMAIN) as ProviderDomain[]) {
    out.push(...getProvidersForDomain(domain));
  }
  return out;
}

/** Register a provider at runtime. Mostly for tests + plugin scenarios.
 *  Production providers should be declared statically via the seed
 *  populator (see ./seed.ts). */
export function registerProvider(p: ProviderDefinition): void {
  if (p.baselineWeight < 0 || p.baselineWeight > 1) {
    throw new Error(`Provider ${p.id} baselineWeight must be in [0,1] (got ${p.baselineWeight})`);
  }
  if (p.fallbackPriority < 0) {
    throw new Error(`Provider ${p.id} fallbackPriority must be >= 0 (got ${p.fallbackPriority})`);
  }
  if (PROVIDERS_BY_DOMAIN[p.domain].some((existing) => existing.id === p.id)) {
    throw new Error(`Provider ${p.id} already registered in domain ${p.domain}`);
  }
  PROVIDERS_BY_DOMAIN[p.domain].push(p);
  rebuildProviderIndex();
}

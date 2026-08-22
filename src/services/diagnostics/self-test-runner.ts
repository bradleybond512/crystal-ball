/**
 * Self-Test Runner — one-button domain smoke test.
 *
 * Sits alongside the existing generic `self-test.ts` (9 standard probes)
 * and `sidecar-self-test.ts` (sidecar fan-out probe). This module adds a
 * domain-keyed surface so the UI can present per-domain rows
 * (earthquakes / weather / aviation / maritime / space-wx / biosurveillance
 * / wildfire / sanctions / infrastructure / gdacs / nuclear) with a single
 * pass/warn/fail verdict + latency per row.
 *
 * Pure / deterministic. Built-in tests accept a `SmokeTestOracle` adapter
 * so unit tests can pin freshness + cache responses without DOM/fetch.
 * The host wires the production oracle once at panel mount.
 */
export type SmokeStatus = 'pass' | 'warn' | 'fail';

export interface SmokeTestResult {
  status: SmokeStatus;
  message: string;
  latencyMs: number;
  details?: unknown;
}

export interface SelfTestReport {
  /** ms epoch when the run started. */
  runAt: number;
  /** Total wall-clock duration of the run in ms. */
  duration: number;
  passed: number;
  warned: number;
  failed: number;
  /** Domain-keyed results so the UI can render one row per domain. */
  results: Record<string, SmokeTestResult>;
}

export interface DomainSmokeTest {
  domain: string;
  name: string;
  test: () => Promise<SmokeTestResult>;
}

export interface RunOptions {
  /** Optional clock override — useful for tests. Defaults to Date.now(). */
  now?: () => number;
  /** Per-test timeout in ms. A test that exceeds this is recorded as fail. */
  timeoutMs?: number;
}

const DEFAULT_TEST_TIMEOUT_MS = 5000;

const FAIL = (message: string, latencyMs = 0): SmokeTestResult =>
  ({ status: 'fail', message, latencyMs });

/**
 * Run every test once and roll the results into a domain-keyed report.
 *
 * If two tests target the same domain, the worse outcome (fail > warn >
 * pass) wins and its message + latency are kept. This keeps the report
 * UI a single-row-per-domain view even when several probes contribute.
 */
export async function runAllTests(
  tests: readonly DomainSmokeTest[],
  options: RunOptions = {},
): Promise<SelfTestReport> {
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  const runAt = now();
  const results: Record<string, SmokeTestResult> = {};

  for (const def of tests) {
    const before = now();
    let outcome: SmokeTestResult;
    try {
      outcome = await raceWithTimeout(def.test(), timeoutMs, def.domain);
    } catch (error) {
      const after = now();
      outcome = {
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
        latencyMs: after - before,
      };
    }
    // Preserve the latency the probe reported; if the probe didn't supply
    // a useful number, fall back to the wall-clock delta the runner saw.
    if (!Number.isFinite(outcome.latencyMs) || outcome.latencyMs < 0) {
      outcome = { ...outcome, latencyMs: now() - before };
    }
    results[def.domain] = mergeDomainResult(results[def.domain], outcome);
  }

  const duration = now() - runAt;
  const tally = countByStatus(results);
  return {
    runAt,
    duration,
    passed: tally.pass,
    warned: tally.warn,
    failed: tally.fail,
    results,
  };
}

/**
 * Run a single domain's tests and return the merged result. If the domain
 * has no registered tests, the result is a synthetic fail so the UI shows
 * a clear "unknown domain" row instead of an empty cell.
 */
export async function runDomainTest(
  domain: string,
  tests: readonly DomainSmokeTest[],
  options: RunOptions = {},
): Promise<SmokeTestResult> {
  const matching = tests.filter((t) => t.domain === domain);
  if (matching.length === 0) {
    return FAIL(`No smoke tests registered for domain "${domain}".`);
  }
  const report = await runAllTests(matching, options);
  return report.results[domain] ?? FAIL(`Domain "${domain}" produced no result.`);
}

// ── Oracle adapter ───────────────────────────────────────────────────────

export interface FeedFreshnessSnapshot {
  /** ms epoch of the last successful update; null when nothing has ever loaded. */
  lastUpdateMs: number | null;
  /** Nominal poll interval in ms — drives the staleness threshold. */
  pollIntervalMs: number;
  /** True when the most recent probe ended in error. */
  hadError: boolean;
  /** True when a cached payload is available (cache-hit validity). */
  hasCachedPayload: boolean;
}

/**
 * Adapter the built-in domain tests call into. The host wires this once;
 * unit tests pass a fake.
 */
export interface SmokeTestOracle {
  /** Return freshness for the named feed. `null` means the feed isn't
   *  registered, which the probe treats as a configuration fail. */
  getFeedSnapshot(feedId: string): FeedFreshnessSnapshot | null;
  /** Current time in ms — overridable so latency math stays deterministic. */
  now(): number;
}

/**
 * Mapping from user-visible domain name → ordered list of feed ids in
 * `feed-catalog.ts` that back that domain. Ordering matters: the first
 * available feed is used as the primary freshness signal; the rest are
 * also probed and produce per-feed details for the UI inspector.
 *
 * Domains the user explicitly named in the spec are present even when
 * the feed-catalog doesn't list a matching feed yet — those cases return
 * a `warn` ("no backing feed configured") so the panel still surfaces the
 * domain rather than silently dropping it.
 */
// Every id here MUST exist in FEED_CATALOG (feed-catalog.ts) — createLiveOracle
// resolves snapshots only for catalog feeds, so a drifted id makes the domain's
// smoke test fail "not registered" forever (alarm fatigue masquerading as a real
// failure). The drift guard in self-test-runner.test.mts enforces this. Domains
// with no catalog-backed feed yet use [] → an honest "no backing feed configured
// yet" warn instead of a misleading hard fail.
export const DOMAIN_TO_FEED_IDS: Record<string, readonly string[]> = {
  earthquakes:       ['usgs-earthquakes'],
  weather:           ['nws-alerts', 'nhc-tropical'],
  aviation:          ['opensky'],
  maritime:          ['ais'],
  'space-wx':        ['swpc-xray', 'swpc-kp'],
  biosurveillance:   [],
  wildfire:          ['firms-modis', 'firms-viirs', 'nifc-perimeters'],
  sanctions:         [],
  infrastructure:    ['eia-930', 'ornl-odin', 'cloudflare-bgp'],
  gdacs:             [],
  nuclear:           ['radnet'],
};

/** Domains the mission-state mapper treats as life-safety critical. */
export const TOP_PRIORITY_DOMAINS: readonly string[] = ['earthquakes', 'weather', 'nuclear'];

/**
 * Build a deterministic smoke test for one domain. The probe checks the
 * primary feed's freshness against a 2× and 10× multiple of its poll
 * interval, plus cache-hit validity. Errors and never-loaded states are
 * surfaced as fail.
 */
export function buildDomainSmokeTest(
  domain: string,
  oracle: SmokeTestOracle,
): DomainSmokeTest {
  const feedIds = DOMAIN_TO_FEED_IDS[domain] ?? [];
  return {
    domain,
    name: prettyDomain(domain),
    test: () => Promise.resolve(probeDomain(domain, feedIds, oracle)),
  };
}

/** Build the full set of built-in smoke tests one per known domain. */
export function buildBuiltinSmokeTests(oracle: SmokeTestOracle): DomainSmokeTest[] {
  return Object.keys(DOMAIN_TO_FEED_IDS).map((d) => buildDomainSmokeTest(d, oracle));
}

// ── Probe logic ──────────────────────────────────────────────────────────

/** Freshness multipliers; mirrors mission-state-mapper.ts's FRESH/STALE. */
export const FRESH_MULT = 2;
export const STALE_MULT = 10;

export function probeDomain(
  domain: string,
  feedIds: readonly string[],
  oracle: SmokeTestOracle,
): SmokeTestResult {
  const start = oracle.now();
  if (feedIds.length === 0) {
    return {
      status: 'warn',
      message: `No backing feed configured for "${domain}" yet.`,
      latencyMs: oracle.now() - start,
    };
  }
  const perFeed: { id: string; verdict: SmokeStatus; reason: string }[] = [];
  let worst: SmokeStatus = 'pass';
  let primaryReason = '';
  for (const feedId of feedIds) {
    const snap = oracle.getFeedSnapshot(feedId);
    const { verdict, reason } = classifyFeedSnapshot(feedId, snap, oracle.now());
    perFeed.push({ id: feedId, verdict, reason });
    if (worse(verdict, worst)) {
      worst = verdict;
      primaryReason = reason;
    }
  }
  return {
    status: worst,
    message: primaryReason || `${domain}: all ${feedIds.length} feed(s) fresh.`,
    latencyMs: oracle.now() - start,
    details: { feeds: perFeed },
  };
}

export function classifyFeedSnapshot(
  feedId: string,
  snap: FeedFreshnessSnapshot | null,
  nowMs: number,
): { verdict: SmokeStatus; reason: string } {
  if (!snap) {
    return { verdict: 'fail', reason: `Feed "${feedId}" not registered.` };
  }
  if (snap.hadError) {
    return { verdict: 'fail', reason: `Feed "${feedId}" reported an upstream error.` };
  }
  if (snap.lastUpdateMs === null) {
    return snap.hasCachedPayload
      ? { verdict: 'warn', reason: `Feed "${feedId}" has cached payload but never refreshed in this session.` }
      : { verdict: 'fail', reason: `Feed "${feedId}" has never loaded and has no cache.` };
  }
  const age = nowMs - snap.lastUpdateMs;
  const freshLimit = snap.pollIntervalMs * FRESH_MULT;
  const staleLimit = snap.pollIntervalMs * STALE_MULT;
  if (age <= freshLimit) {
    return { verdict: 'pass', reason: `Feed "${feedId}" fresh (${formatAge(age)}).` };
  }
  if (age <= staleLimit) {
    return snap.hasCachedPayload
      ? { verdict: 'warn', reason: `Feed "${feedId}" stale (${formatAge(age)}) — using cache.` }
      : { verdict: 'warn', reason: `Feed "${feedId}" stale (${formatAge(age)}).` };
  }
  return { verdict: 'fail', reason: `Feed "${feedId}" very stale (${formatAge(age)}).` };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  domain: string,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    handle = setTimeout(() => {
      reject(new Error(`Smoke test for "${domain}" timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (handle !== undefined) clearTimeout(handle);
  });
}

function mergeDomainResult(
  existing: SmokeTestResult | undefined,
  next: SmokeTestResult,
): SmokeTestResult {
  if (!existing) return next;
  return worse(next.status, existing.status) ? next : existing;
}

function worse(a: SmokeStatus, b: SmokeStatus): boolean {
  const rank = { pass: 0, warn: 1, fail: 2 } as const;
  return rank[a] > rank[b];
}

function countByStatus(
  results: Record<string, SmokeTestResult>,
): { pass: number; warn: number; fail: number } {
  const acc = { pass: 0, warn: 0, fail: 0 };
  for (const r of Object.values(results)) acc[r.status] += 1;
  return acc;
}

const DOMAIN_LABELS: Record<string, string> = {
  earthquakes:     'Earthquakes',
  weather:         'Weather',
  aviation:        'Aviation',
  maritime:        'Maritime',
  'space-wx':      'Space Weather',
  biosurveillance: 'Biosurveillance',
  wildfire:        'Wildfire',
  sanctions:       'Sanctions',
  infrastructure:  'Infrastructure',
  gdacs:           'GDACS',
  nuclear:         'Nuclear',
};

function prettyDomain(domain: string): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return '—';
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h`;
  return `${Math.round(ageMs / 86_400_000)}d`;
}

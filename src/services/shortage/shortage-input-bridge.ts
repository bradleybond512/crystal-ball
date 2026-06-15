/**
 * Shortage Input Bridge — wires already-fetched feeds into the per-commodity
 * `ShortageInputBag` shape that the 8 commodity models consume.
 *
 * Split into two layers:
 *   1. `buildShortageInputsFromSources(...)` — pure, deterministic, testable.
 *      Takes the raw feed payloads and emits input bags. No fetch, no DOM,
 *      no clock-dependence beyond what callers inject.
 *   2. `loadShortageInputs(...)` — thin async shell. Fetches the three
 *      currently-available sources (US Drought Monitor, maritime chokepoint
 *      statuses, US power-grid alerts), passes them through layer 1, and
 *      returns the result. Best-effort: any failed fetch becomes an empty
 *      payload and downstream models surface the gap honestly via their
 *      `dataGaps` field and reduced confidence.
 *
 * What is intentionally NOT wired here: commodity futures prices, USDA
 * WASDE crop conditions, EIA inventories, NOAA HDD/CDD anomalies. Those
 * feeds aren't yet present in the codebase; when they land, add the
 * mapping below — the bridge is the only file that needs to change.
 */

import type { DroughtState, DroughtSummary } from '@/services/drought-monitor';
import type { PowerGridAlert } from '@/services/power-grid-alerts';
import type { ShortageInput, ShortageInputBag } from './shortage-types';
import type { FullSetCommodity, ShortageSummaryEntry } from './shortage-fullset';

// Concrete `fetch*` modules are loaded lazily inside `loadShortageInputs`
// below — they transitively pull in i18n.ts (which uses Vite's
// `import.meta.glob`) and would break the node:test runner when these
// types are imported by a unit test.

// ── Generic chokepoint signal ────────────────────────────────────────────
// The bridge's pure layer is decoupled from any single chokepoint provider.
// Callers (or the async shell below) translate their provider's payload
// into this minimal shape.

export type ChokepointKey = 'bosphorus' | 'suez' | 'hormuz';

export interface ChokepointSignal {
  key: ChokepointKey;
  /** 0-100; higher = more disrupted. */
  disruptionScore: number;
  /** Coarse status floor — escalates `disruptionScore` when set. */
  status?: 'open' | 'stressed' | 'disrupted' | 'blocked';
}

// ── Crop belts ────────────────────────────────────────────────────────────
// Heaviest-production US states per commodity. Source: USDA NASS 2022-2024
// 5-year averages. Used to weight drought severity into per-commodity
// production drivers — drought in Iowa hurts corn, drought in Florida
// does not.

const WHEAT_BELT: ReadonlySet<string> = new Set([
  'KS', 'ND', 'MT', 'WA', 'OK', 'SD', 'TX', 'CO', 'ID', 'MN',
]);
const CORN_BELT: ReadonlySet<string> = new Set([
  'IA', 'IL', 'NE', 'MN', 'IN', 'OH', 'SD', 'MO', 'WI', 'KS',
]);
const SOYBEAN_BELT: ReadonlySet<string> = new Set([
  'IA', 'IL', 'MN', 'IN', 'NE', 'OH', 'MO', 'ND', 'SD', 'AR',
]);

// ── Inputs we accept ──────────────────────────────────────────────────────

export interface ShortageSourceBundle {
  drought?: DroughtSummary;
  chokepoints?: readonly ChokepointSignal[];
  gridAlerts?: readonly PowerGridAlert[];
}

export interface ShortageInputBridgeOptions {
  /** Observation timestamp stamped on every emitted ShortageInput. Defaults
   *  to Date.now(). Inject in tests for determinism. */
  now?: number;
}

// ── Pure-function entry point ─────────────────────────────────────────────

export function buildShortageInputsFromSources(
  sources: ShortageSourceBundle,
  options: ShortageInputBridgeOptions = {},
): Partial<Record<FullSetCommodity, ShortageInputBag>> {
  const now = options.now ?? Date.now();
  const out: InputAccumulator = {};
  const { drought, chokepoints, gridAlerts } = sources;
  if (drought?.states.length) applyDroughtInputs(out, drought);
  if (chokepoints?.length) applyChokepointInputs(out, chokepoints, now);
  if (gridAlerts?.length) applyGridInputs(out, gridAlerts, now);
  return out;
}

type InputAccumulator = Partial<Record<FullSetCommodity, ShortageInputBag>>;

/** Grains: drought-monitor drives the production drivers. observedAt is the
 *  drought summary's own fetch time so freshness propagates accurately. */
function applyDroughtInputs(out: InputAccumulator, drought: DroughtSummary): void {
  const observedAt = drought.fetchedAt.getTime();
  const wheatBag = buildGrainBag(drought.states, WHEAT_BELT, observedAt, 'us-drought-monitor');
  const cornBag  = buildGrainBag(drought.states, CORN_BELT, observedAt, 'us-drought-monitor');
  const soyBag   = buildGrainBag(drought.states, SOYBEAN_BELT, observedAt, 'us-drought-monitor');
  if (Object.keys(wheatBag).length) out.wheat    = { ...out.wheat,    ...wheatBag };
  if (Object.keys(cornBag).length)  out.corn     = { ...out.corn,     ...cornBag };
  if (Object.keys(soyBag).length)   out.soybeans = { ...out.soybeans, ...soyBag };
}

/** Chokepoints: maritime export-corridor stress mapped to corridor/import drivers. */
function applyChokepointInputs(out: InputAccumulator, chokepoints: readonly ChokepointSignal[], now: number): void {
  for (const cp of chokepoints) {
    const stress = corridorStressScore(cp);
    const source = `chokepoint:${cp.key}`;
    if (cp.key === 'bosphorus') {
      out.wheat = { ...out.wheat, export_corridor_status: { value: stress, source, observedAt: now } };
    } else if (cp.key === 'suez') {
      out.rice = { ...out.rice, export_corridor_status: { value: stress, source, observedAt: now } };
    } else if (cp.key === 'hormuz') {
      // Hormuz disruption proxies for crude-import stress on both diesel and
      // gasoline. Mapped onto crude_imports_wow as a negative delta — 100 stress
      // → -40% WoW imports, at the floor of the model's inverseLinear(-25, 5) band.
      const inp: ShortageInput = { value: -stress * 0.4, source, observedAt: now };
      out.diesel   = { ...out.diesel,   crude_imports_wow: inp };
      out.gasoline = { ...out.gasoline, crude_imports_wow: inp };
    }
  }
}

/** Grid alerts: natural-gas demand + curtailment proxies. */
function applyGridInputs(out: InputAccumulator, gridAlerts: readonly PowerGridAlert[], now: number): void {
  const natGasBag = buildNatGasBag(gridAlerts, now);
  if (Object.keys(natGasBag).length) {
    out['natural-gas'] = { ...out['natural-gas'], ...natGasBag };
  }
}

// ── Grain helpers ─────────────────────────────────────────────────────────

function buildGrainBag(
  states: readonly DroughtState[],
  belt: ReadonlySet<string>,
  observedAt: number,
  source: string,
): ShortageInputBag {
  const belted = states.filter((s) => belt.has(s.stateAbbr));
  if (belted.length === 0) return {};
  // d2+d3+d4 % averaged across belt states. 0 = no severe drought, 100 = all severe+.
  const meanSevere = belted.reduce((acc, s) => acc + (s.d2 + s.d3 + s.d4), 0) / belted.length;
  // 70th-percentile dryness is a reasonable threshold for soil-moisture
  // alarm in the models; map linearly to keep the relationship intuitive.
  const soilMoisturePctile = Math.max(0, Math.min(100, 100 - meanSevere));
  const rainfallPctOfNormal = Math.max(20, Math.min(120, 100 - meanSevere * 0.8));
  return {
    soil_moisture_percentile: { value: round(soilMoisturePctile), source, observedAt },
    rainfall_pct_of_normal:   { value: round(rainfallPctOfNormal), source, observedAt },
  };
}

// ── Chokepoint helpers ────────────────────────────────────────────────────

function corridorStressScore(c: ChokepointSignal): number {
  const base = Math.round(c.disruptionScore);
  if (c.status === 'blocked') return Math.max(85, base);
  if (c.status === 'disrupted') return Math.max(60, base);
  if (c.status === 'stressed') return Math.max(30, base);
  return base;
}

// ── Nat-gas helpers ───────────────────────────────────────────────────────

function buildNatGasBag(alerts: readonly PowerGridAlert[], observedAt: number): ShortageInputBag {
  const bag: ShortageInputBag = {};
  let coldSnap = 0;
  let heatStress = 0;
  let curtailment = 0;
  for (const a of alerts) {
    if (a.severity === 'low') continue;
    const text = (a.title + ' ' + a.description).toLowerCase();
    if (text.includes('cold') || text.includes('winter storm') || text.includes('extreme cold')) coldSnap += 1;
    if (text.includes('heat') || text.includes('heatwave') || text.includes('extreme heat')) heatStress += 1;
    if (text.includes('curtailment') || text.includes('conservation') || text.includes('rolling blackout')) curtailment += 1;
  }
  const source = 'power-grid-alerts:aggregated';
  if (coldSnap > 0) {
    // Each qualifying alert pushes HDD anomaly up by 8 (cap at 60). The
    // nat-gas model's directLinear(0,60) saturates there.
    bag.heating_degree_days_vs_normal = { value: Math.min(60, coldSnap * 8), source, observedAt };
    bag.cold_snap_arrival_imminent = { value: 1, source, observedAt };
  }
  if (heatStress > 0) {
    bag.cooling_degree_days_vs_normal = { value: Math.min(60, heatStress * 8), source, observedAt };
  }
  if (curtailment > 0) {
    bag.utility_curtailment_active = { value: 1, source, observedAt };
  }
  return bag;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Per-feed status + per-commodity fail-closed merge ──────────────────────
// A PARTIAL outage (e.g. the chokepoint feed is down but drought is healthy)
// must not silently downgrade the commodities that depend on the dead feed.
// We track which of the three underlying feeds actually refreshed this cycle,
// then merge fresh-vs-cached entries PER COMMODITY: a commodity keeps its prior
// (cached) risk whenever ANY feed it depends on failed.

/** The `dataFreshness` source ids for the three wired shortage feeds. Each is a
 *  valid `DataSourceId` (drought-monitor + power-grid-alerts record under their
 *  own ids; chokepoint status records under the supply_chain domain id). */
export type ShortageFeedId = 'drought-monitor' | 'power-grid-alerts' | 'supply_chain';

/** Which feeds each commodity's inputs are derived from in
 *  `buildShortageInputsFromSources`. Commodities with no wired feed have no
 *  dependencies — their forecast is always the seasonal baseline, so there is
 *  no live risk a failed feed could erase. */
export const COMMODITY_SOURCE_FEEDS: Record<FullSetCommodity, readonly ShortageFeedId[]> = {
  wheat: ['drought-monitor', 'supply_chain'], // belt drought + Bosphorus corridor
  corn: ['drought-monitor'],
  soybeans: ['drought-monitor'],
  rice: ['supply_chain'],                       // Suez corridor
  diesel: ['supply_chain'],                     // Hormuz crude imports
  gasoline: ['supply_chain'],                   // Hormuz crude imports
  'natural-gas': ['power-grid-alerts'],
  'jet-fuel': [],
  fertilizer: [],
  crude: [],
  propane: [],
  electricity: [],
};

export interface ShortageInputsWithStatus {
  inputs: Partial<Record<FullSetCommodity, ShortageInputBag>>;
  /** True iff the feed actually refreshed (or last refreshed) without a pending
   *  error this cycle — see `loadShortageInputsWithStatus`. */
  feedsOk: Record<ShortageFeedId, boolean>;
}

/** Whether every feed a commodity depends on is healthy this cycle. A commodity
 *  with no wired feed (empty deps) is always considered satisfiable. */
export function commodityFeedsOk(
  commodity: FullSetCommodity,
  feedsOk: Readonly<Record<ShortageFeedId, boolean>>,
): boolean {
  return (COMMODITY_SOURCE_FEEDS[commodity] ?? []).every((f) => feedsOk[f]);
}

/** The set of commodities whose feeds are all healthy — i.e. the ones safe to
 *  recompute during a partial outage. Callers pass this as `computeShortageFullSet`'s
 *  `only` option so down-feed commodities are never recomputed (and so never
 *  pollute trend memory with a discarded baseline score). */
export function healthyCommodities(
  feedsOk: Readonly<Record<ShortageFeedId, boolean>>,
): Set<FullSetCommodity> {
  const out = new Set<FullSetCommodity>();
  for (const commodity of Object.keys(COMMODITY_SOURCE_FEEDS) as FullSetCommodity[]) {
    if (commodityFeedsOk(commodity, feedsOk)) out.add(commodity);
  }
  return out;
}

/**
 * Merges freshly-computed entries against the prior cached set, per commodity,
 * over the UNION of both (so `fresh` may be a subset — only the healthy-feed
 * commodities). A commodity adopts its FRESH entry only when every feed it
 * depends on is OK and a fresh entry exists; otherwise it keeps its CACHED entry
 * (preserving a known risk through the outage), falling back to the fresh entry
 * only when no cached entry exists. Pure + deterministic — no fetch, no clock.
 */
export function mergeShortageEntriesByFeedStatus(
  fresh: readonly ShortageSummaryEntry[],
  cached: readonly ShortageSummaryEntry[],
  feedsOk: Readonly<Record<ShortageFeedId, boolean>>,
): ShortageSummaryEntry[] {
  const freshByCommodity = new Map(fresh.map((e) => [e.commodity, e]));
  const cachedByCommodity = new Map(cached.map((e) => [e.commodity, e]));
  const out: ShortageSummaryEntry[] = [];
  const seen = new Set<FullSetCommodity>();
  for (const commodity of [...freshByCommodity.keys(), ...cachedByCommodity.keys()]) {
    if (seen.has(commodity)) continue;
    seen.add(commodity);
    const freshEntry = freshByCommodity.get(commodity);
    const cachedEntry = cachedByCommodity.get(commodity);
    if (commodityFeedsOk(commodity, feedsOk) && freshEntry) {
      out.push(freshEntry);
    } else if (cachedEntry) {
      out.push(cachedEntry);
    } else if (freshEntry) {
      out.push(freshEntry);
    }
  }
  return out;
}

// ── Async shell ───────────────────────────────────────────────────────────

/** Maps a provider's free-text chokepoint name onto one of the three corridors
 *  the bridge models. Returns null for chokepoints we don't yet wire. */
function chokepointKeyFromName(name: string): ChokepointKey | null {
  const n = name.toLowerCase();
  if (n.includes('bosphorus')) return 'bosphorus';
  if (n.includes('suez')) return 'suez';
  if (n.includes('hormuz')) return 'hormuz';
  return null;
}

function toChokepointSignals(
  chokepoints: readonly { name: string; disruptionScore: number; status: string }[],
): ChokepointSignal[] {
  const cps: ChokepointSignal[] = [];
  for (const c of chokepoints) {
    const key = chokepointKeyFromName(c.name);
    if (!key) continue;
    cps.push({ key, disruptionScore: c.disruptionScore, status: (c.status as ChokepointSignal['status']) ?? undefined });
  }
  return cps;
}

/**
 * Fetches the three currently-wired feeds in parallel (best-effort) and
 * runs them through the deterministic bridge. Caller schedules this on
 * whatever cadence makes sense (data-loader runs it every 5 minutes).
 */
export async function loadShortageInputs(): Promise<Partial<Record<FullSetCommodity, ShortageInputBag>>> {
  const [{ fetchDroughtMonitor }, { fetchPowerGridAlerts }, { fetchChokepointStatus }] = await Promise.all([
    import('@/services/drought-monitor'),
    import('@/services/power-grid-alerts'),
    import('@/services/supply-chain'),
  ]);
  const [drought, gridAlerts, chokepoints] = await Promise.allSettled([
    fetchDroughtMonitor(),
    fetchPowerGridAlerts(),
    fetchChokepointStatus(),
  ]);
  const cps = chokepoints.status === 'fulfilled'
    ? toChokepointSignals(chokepoints.value.chokepoints)
    : [];
  return buildShortageInputsFromSources({
    drought:     drought.status === 'fulfilled' ? drought.value : undefined,
    gridAlerts:  gridAlerts.status === 'fulfilled' ? gridAlerts.value : undefined,
    chokepoints: cps.length > 0 ? cps : undefined,
  });
}

/**
 * Same as `loadShortageInputs`, plus a per-feed health verdict read from
 * `dataFreshness` AFTER the fetchers have run. A feed is OK when it has a prior
 * successful update and no pending error — `recordUpdate` clears `lastError`
 * while `recordError` sets it, so this correctly treats an internal cache-hit
 * (no new record this cycle) as healthy and only a genuine failure as down.
 * Callers feed `feedsOk` into `mergeShortageEntriesByFeedStatus` to keep partial
 * outages from downgrading commodities whose feed is still alive.
 */
export async function loadShortageInputsWithStatus(): Promise<ShortageInputsWithStatus> {
  const inputs = await loadShortageInputs();
  const { dataFreshness } = await import('@/services/data-freshness');
  const feedOk = (id: ShortageFeedId): boolean => {
    const s = dataFreshness.getSource(id);
    return !!s?.lastUpdate && !s.lastError;
  };
  return {
    inputs,
    feedsOk: {
      'drought-monitor': feedOk('drought-monitor'),
      'power-grid-alerts': feedOk('power-grid-alerts'),
      'supply_chain': feedOk('supply_chain'),
    },
  };
}

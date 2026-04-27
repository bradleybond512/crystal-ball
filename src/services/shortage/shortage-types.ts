/**
 * Crystal Ball shortage/commodity forecast layer — shared types.
 *
 * Per docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md "First Implementation
 * Batch" (lines 213-251): a shared shortage framework first, then two
 * deterministic models (wheat + diesel). UI surfaces come later.
 *
 * Plan invariants this file encodes:
 *   - every shortage score must include drivers + data gaps
 *   - every forecast must include confirming + invalidating indicators
 *   - source provenance is required for all inputs
 *   - stale or missing data must reduce confidence (not silently drop)
 *
 * No DOM, no fetch, no globals. Plain TypeScript so the models can be
 * tested with static fixtures and reused across the app.
 */

export type ShortageDomain = 'food' | 'energy' | 'fertilizer' | 'water';

export type ShortageConfidence = 'low' | 'medium' | 'high';

/** The six universal driver buckets from the plan's "Leading Indicator
 *  Scores" section (lines 144-166). Each model fills the buckets that
 *  apply to its commodity; missing buckets reduce confidence rather
 *  than silently zero out (see scoreOverallShortage). */
export type ShortageDriverKind =
  | 'production'
  | 'inventory'
  | 'transport'
  | 'policy'
  | 'demand'
  | 'price'
  /** Catch-all for cross-domain overlays (weather × crop calendar,
   *  conflict × port chokepoints) that don't fit a single bucket. */
  | 'cross_domain';

export interface ShortageDriver {
  kind: ShortageDriverKind;
  /** 0-100 risk contribution from this driver. Higher = worse. */
  score: number;
  /** Free-text — what the user sees in the explanation. e.g.
   *  "Distillate inventories below 5-year range". */
  label: string;
  /** Optional source ids (provider registry keys) backing this driver. */
  sources?: string[];
  /** Polarity. 'risk' = adds to shortage; 'protective' = reduces it.
   *  Defaults to 'risk' on read; protective drivers subtract instead
   *  of add when computing the overall score. */
  polarity?: 'risk' | 'protective';
  /** Optional pointer back to a NormalizedFact id (PR 1 evidence
   *  graph) so the UI can drill from a driver into its provenance. */
  factId?: string;
}

export interface ShortageForecast {
  /** Commodity name as used in the playbook ("wheat", "diesel"). */
  commodity: string;
  domain: ShortageDomain;
  /** Free-form region label — country code, region name, "global". */
  region: string;
  /** Forward-looking horizon for the forecast. Models pick from their
   *  playbook's `forecastHorizonDays`. */
  horizonDays: number;
  /** 0-100 weighted overall score. Computed by scoreOverallShortage. */
  riskScore: number;
  confidence: ShortageConfidence;
  drivers: ShortageDriver[];
  /** Plain-language signals the user should expect to see if the
   *  forecast is right (the plan's "Watch Windows" section). */
  confirmingIndicators: string[];
  /** Signals that, if observed, should weaken confidence and could
   *  flip the call. */
  invalidatingIndicators: string[];
  /** Inputs the model wanted but didn't have. Each item drops
   *  confidence and explains *why* it dropped — never silently
   *  swallowed. */
  dataGaps: string[];
  /** ISO-8601 timestamp. Models that consume stale inputs should
   *  reflect that here so the UI can render an "as of" line. */
  lastUpdated: string;
}

// ── Inputs the models accept ─────────────────────────────────────────────

/** Provenance-aware numeric input. The model reads `value` for math
 *  and uses `observedAt` + `source` to compute freshness/confidence. */
export interface ShortageInput {
  value: number;
  /** Epoch ms when this value was measured/published. */
  observedAt: number;
  /** Provider id matching the registry. Optional but expected for
   *  anything that should appear in `dataGaps` when stale. */
  source?: string;
  /** Optional unit (USD/bbl, % of capacity, mm rainfall). Models
   *  ignore the string but pass it through to driver labels. */
  unit?: string;
}

/** A complete-or-partial set of inputs handed to a model. The model is
 *  responsible for noting which inputs were missing as data gaps. */
export type ShortageInputBag = Record<string, ShortageInput | undefined>;

// ── Playbook definition ──────────────────────────────────────────────────

/** Per the plan's "Commodity Playbooks" section (lines 108-142): each
 *  commodity defines its leading/confirming/invalidating signals and
 *  known constants. Playbooks live in `commodity-playbooks.ts`. */
export interface CommodityPlaybook {
  commodity: string;
  domain: ShortageDomain;
  /** Inputs the model considers leading (move first). */
  leadingIndicators: string[];
  /** Inputs the model considers confirming (move with the price). */
  confirmingIndicators: string[];
  /** Inputs that, if present, should weaken or invalidate the call. */
  invalidatingIndicators: string[];
  /** Months of the year (1-12) when the commodity is most exposed.
   *  Empty array means "no clear seasonality". */
  seasonalRiskMonths: number[];
  /** Free-text geographic chokepoints. Wheat: "Black Sea ports".
   *  Diesel: "Strait of Hormuz", "US Gulf Coast refineries". */
  chokepoints: string[];
  /** Country codes most exposed (ISO 3166-1 alpha-2). */
  affectedCountries: string[];
  /** Sectors materially impacted by a sustained shortage. */
  affectedSectors: string[];
  /** Days into the future this playbook's forecasts target. Models
   *  may use a shorter horizon if their inputs are stale. */
  forecastHorizonDays: number;
}

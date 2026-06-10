/**
 * Golden Windows — frozen historical fixture windows for the cognition benchmark.
 *
 * House pattern: replay-fixtures-catalog.ts.
 *
 * Each window is a self-contained synthetic-but-realistic scenario that exercises
 * a specific domain of the cognition pipeline:
 *   episodic recall → base-rate match → aggregation → recalibration → conformal
 *
 * DESIGN INVARIANTS:
 *   - All timestamps are absolute ms epoch (ANCHOR-relative) — stable across machines.
 *   - All data is clearly labeled as synthetic fixtures, not real events.
 *   - Every window provides: episodes to seed, a hypothesis under test, prediction
 *     records for calibration-curve building, and the realized outcome.
 *   - Domains cover: conflict / market / weather / cyber / shortage.
 *   - No DOM, no fetch, no globals at import time — pure deterministic.
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 16.
 */

import type { Episode } from '../episodic-memory';
import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';
import type { FactDomain } from '@/services/intelligence/types';
import type { HypothesisLike } from '../base-rates';

// ── Time anchors ────────────────────────────────────────────────────────────────

/** Stable epoch anchor: 2026-01-01 00:00:00 UTC. Reproducible across machines. */
export const BENCH_ANCHOR = 1_751_328_000_000;

const DAY = 24 * 60 * 60 * 1000;

// ── Types ───────────────────────────────────────────────────────────────────────

/** Realized outcome for a benchmark window's hypothesis. */
export type WindowOutcome = 'materialized' | 'fizzled' | 'partial';

/**
 * A frozen historical fixture window for the cognition benchmark.
 *
 * Contains everything needed to:
 *  1. Seed the episodic memory store (episodes).
 *  2. Exercise matchReferenceClass + blendWithEpisodic (hypothesisUnderTest).
 *  3. Build a calibration curve (predictionRecords).
 *  4. Score Brier, coverage, analog-recall precision (realizedOutcome + plantedAnalogIds).
 *  5. Test consolidation schema learning (plantedClusterSignature).
 */
export interface GoldenWindow {
  id: string;
  /** Primary FactDomain for this window's calibration records. */
  domain: FactDomain;
  description: string;
  /** Episodes to seed into episodic memory before running the pipeline. */
  seedEpisodes: Omit<Episode, 'id'>[];
  /**
   * IDs (within seedEpisodes) of episodes that ARE semantically similar to
   * the hypothesisUnderTest. The analog-recall precision@5 metric checks that
   * at least these episodes surface in the top-5 recall results.
   * NOTE: bench seeds episodes and captures their assigned IDs.
   */
  plantedAnalogSignatures: string[];
  /**
   * Shared signature suffix used to group planted analog episodes.
   * Used for consolidation schema true-positive testing: after consolidation,
   * a learned schema should cover these episodes.
   */
  plantedClusterSignature: string;
  /** The hypothesis the pipeline is asked to score. */
  hypothesisUnderTest: HypothesisLike;
  /** The known realized outcome — used to score Brier. */
  realizedOutcome: WindowOutcome;
  /**
   * Model-forecast probability for the hypothesis (deterministic, pre-computed).
   * This stands in for the forecastHypothesis output in the deterministic-only
   * pipeline path so no LLM is needed.
   */
  modelForecastP: number;
  /**
   * Prediction records for building calibration/conformal curves.
   * Enough to trigger per-domain curves (≥30 for recalibration, ≥40 for conformal).
   * Each record must include domain matching the window's domain.
   */
  predictionRecords: PredictionRecord[];
}

// ── Prediction record factory ────────────────────────────────────────────────────

/**
 * Build a PredictionRecord for fixture use.
 * All prediction records in the benchmark use fixed resolved timestamps
 * for full determinism.
 */
function pr(
  probability: number,
  resolvedTrue: boolean,
  domain: FactDomain,
  offsetDays: number,
): PredictionRecord {
  const resolvedAt = BENCH_ANCHOR - offsetDays * DAY;
  const predictedAt = BENCH_ANCHOR - (offsetDays + 7) * DAY;
  return {
    id: `bench-pr-${domain}-${offsetDays}-${probability.toFixed(2)}`,
    sourceId: 'bench-fixture',
    domain,
    claim: `Bench fixture prediction for ${domain}`,
    probability,
    predictedAt,
    resolveBy: resolvedAt,
    status: resolvedTrue ? 'resolved_true' : 'resolved_false',
    resolvedAt,
  };
}

/**
 * Generate a block of N prediction records for a domain.
 *
 * Provides a realistic distribution: calibration is deliberately slightly
 * over-confident (predicted ≈ 0.65 when materialization rate ≈ 0.55) so
 * the recalibration curve has visible adjustments but the Brier stays reasonable.
 *
 * @param domain  FactDomain string
 * @param n       Number of records to generate (≥30 for recalibration, ≥40 for conformal)
 * @param seed    Deterministic seed to vary per window (0–9)
 */
function generatePredictionBlock(domain: FactDomain, n: number, seed: number): PredictionRecord[] {
  const records: PredictionRecord[] = [];
  // Alternate predicted p values in a fixed pattern (deterministic, seed-shifted).
  const pValues = [0.70, 0.65, 0.60, 0.75, 0.55, 0.50, 0.80, 0.45, 0.40, 0.85];
  // Materialize roughly 55% for overconfidence on high-p bins.
  const outcomes = [true, true, false, true, false, true, true, false, false, true];

  for (let i = 0; i < n; i++) {
    const idx = (i + seed) % pValues.length;
    const pVal = pValues[idx] ?? 0.55;
    const outcome = outcomes[idx] ?? false;
    records.push(pr(pVal, outcome, domain, i + 1));
  }
  return records;
}

// ── Episode factory ──────────────────────────────────────────────────────────────

/** Build a seed episode (without id — the bench assigns ids on insert). */
function ep(
  signature: string,
  summary: string,
  domains: string[],
  entities: string[],
  outcome: Episode['outcome'],
  offsetDays: number,
): Omit<Episode, 'id'> {
  const now = BENCH_ANCHOR - offsetDays * DAY;
  return {
    kind: 'hypothesis',
    signature,
    summary,
    domains,
    entities,
    createdAt: now - 3 * DAY,
    resolvedAt: now,
    outcome,
    outcomeNote: `Resolved ${outcome} at fixture time`,
    vector: [],  // bench fills this via embedHashed
    tier: 'hashed',
  };
}

// ── Window 1: Black Sea grain disruption (shortage/conflict) ─────────────────────

/**
 * WINDOW 1: Black Sea grain corridor shutdown → wheat price spike.
 *
 * Domain: shortage / conflict
 * Hypothesis: wheat prices spike ≥15% within 30 days of Black Sea corridor disruption.
 * Planted analogs: 4 past episodes of Black Sea disruption → wheat price spikes.
 * Known outcome: materialized (wheat futures +18% within 28 days in the fixture).
 */
export const WINDOW_BLACK_SEA_GRAIN: GoldenWindow = {
  id: 'bench-black-sea-grain',
  domain: 'macro',
  description: 'Black Sea grain corridor disruption → wheat price spike (fixture)',
  seedEpisodes: [
    ep('bs-grain-2022a', 'Russia-Ukraine conflict halts Black Sea grain shipments; wheat futures surge 25%', ['shortage', 'conflict', 'macro'], ['Russia', 'Ukraine', 'Black Sea', 'wheat'], 'materialized', 400),
    ep('bs-grain-2022b', 'Bosphorus passage restricted; wheat export tonnage falls 40%; FAO price index spike', ['shortage', 'maritime'], ['Bosphorus', 'wheat', 'Turkey', 'FAO'], 'materialized', 350),
    ep('bs-grain-2021', 'Black Sea drought reduces Ukrainian wheat crop; prices rise 12% on thin supply', ['shortage', 'weather'], ['Ukraine', 'Black Sea', 'wheat', 'drought'], 'materialized', 700),
    ep('bs-grain-2020', 'Export bans by major wheat producers (Russia, India) drive 10% spike', ['shortage', 'conflict'], ['Russia', 'India', 'wheat', 'export ban'], 'partial', 900),
    // Non-analog: different commodity, same region — should NOT surface as analog
    ep('bs-iron-2023', 'Black Sea iron ore shipments disrupted; steel prices rise 8%', ['shortage', 'maritime'], ['Black Sea', 'iron ore', 'steel'], 'fizzled', 200),
  ],
  plantedAnalogSignatures: ['bs-grain-2022a', 'bs-grain-2022b', 'bs-grain-2021'],
  plantedClusterSignature: 'bs-grain',
  hypothesisUnderTest: {
    kind: 'cross-domain-cluster',
    statement: 'Black Sea grain corridor disruption will cause wheat commodity price spike ≥15% within 30 days due to export route blockage and Bosphorus transit restrictions',
    domains: ['shortage', 'conflict', 'maritime'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.68,
  predictionRecords: generatePredictionBlock('macro', 45, 0),
};

// ── Window 2: EM currency crisis (macro/market) ──────────────────────────────────

/**
 * WINDOW 2: Emerging-market currency crisis following Fed rate surprise.
 *
 * Domain: markets / macro
 * Hypothesis: EM currency depreciates ≥10% within 30 days of Fed surprise.
 * Known outcome: materialized (Argentine peso -14% within 25 days in fixture).
 */
export const WINDOW_EM_CURRENCY_CRISIS: GoldenWindow = {
  id: 'bench-em-currency-crisis',
  domain: 'markets',
  description: 'EM currency depreciation ≥10% following Fed rate shock (fixture)',
  seedEpisodes: [
    ep('em-fx-2018a', 'Turkish lira crashes 25% after Fed hike surprise; Erdogan defies orthodox policy response', ['markets', 'macro'], ['Turkey', 'lira', 'FX', 'Fed'], 'materialized', 2800),
    ep('em-fx-2018b', 'Argentine peso loses 18% following IMF austerity program failure and Fed tightening', ['markets', 'macro'], ['Argentina', 'peso', 'IMF', 'Fed', 'FX'], 'materialized', 2600),
    ep('em-fx-2022', 'Sri Lanka rupee -45% amid dollar shortage and Fed pivot; sovereign default', ['markets', 'macro'], ['Sri Lanka', 'rupee', 'IMF', 'FX', 'default'], 'materialized', 1400),
    ep('em-fx-2013', 'Taper tantrum: EM currency basket -12% on Fed QE taper signal', ['markets', 'macro'], ['Fed', 'FX', 'currency', 'taper', 'EM'], 'materialized', 4700),
    // Non-analog: crypto crash, not EM FX
    ep('crypto-2022', 'Bitcoin loses 60% as risk-off wave hits crypto markets post-Fed hike', ['markets', 'crypto'], ['Bitcoin', 'crypto', 'Fed', 'risk-off'], 'materialized', 1500),
  ],
  plantedAnalogSignatures: ['em-fx-2018a', 'em-fx-2018b', 'em-fx-2022'],
  plantedClusterSignature: 'em-fx',
  hypothesisUnderTest: {
    kind: 'cross-domain-cluster',
    statement: 'Emerging-market currency will depreciate ≥10% against USD within 30 days following a surprise Fed rate increase and dollar liquidity tightening',
    domains: ['markets', 'macro'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.61,
  predictionRecords: generatePredictionBlock('markets', 45, 1),
};

// ── Window 3: Critical infrastructure cyberattack (cyber) ────────────────────────

/**
 * WINDOW 3: ICS/SCADA ransomware attack on energy grid causes operational disruption.
 *
 * Domain: cyber / infra
 * Hypothesis: confirmed OT intrusion causes pipeline/grid disruption within 7 days.
 * Known outcome: materialized (simulated Colonial Pipeline-style scenario).
 */
export const WINDOW_ICS_CYBERATTACK: GoldenWindow = {
  id: 'bench-ics-cyberattack',
  domain: 'cyber',
  description: 'ICS ransomware → energy grid operational disruption within 7d (fixture)',
  seedEpisodes: [
    ep('ics-colonial-2021', 'Colonial Pipeline ransomware attack halts fuel supply for 6 days on US East Coast', ['cyber', 'infra', 'shortage'], ['Colonial Pipeline', 'ransomware', 'ICS', 'fuel', 'CISA'], 'materialized', 1800),
    ep('ics-ukraine-2015', 'BlackEnergy malware causes Ukraine power grid blackout affecting 230k customers', ['cyber', 'infra'], ['Ukraine', 'power grid', 'BlackEnergy', 'ICS', 'SCADA'], 'materialized', 3800),
    ep('ics-oldsmar-2021', 'Florida water treatment plant ICS compromised; NaOH level manipulation attempt', ['cyber', 'infra'], ['Florida', 'water treatment', 'ICS', 'SCADA', 'CISA'], 'fizzled', 1850),
    ep('ics-saudi-2017', 'Triton malware targets Saudi Aramco safety systems; production disrupted', ['cyber', 'infra'], ['Saudi Aramco', 'Triton', 'ICS', 'OT', 'SCADA'], 'materialized', 3100),
    // Non-analog: IT breach, not OT/ICS
    ep('it-breach-2020', 'SolarWinds Orion supply chain compromise affects 18k organizations; espionage focus', ['cyber'], ['SolarWinds', 'supply chain', 'espionage', 'CISA'], 'fizzled', 2000),
  ],
  plantedAnalogSignatures: ['ics-colonial-2021', 'ics-ukraine-2015', 'ics-saudi-2017'],
  plantedClusterSignature: 'ics-attack',
  hypothesisUnderTest: {
    kind: 'cross-domain-cluster',
    statement: 'Confirmed ICS/SCADA ransomware intrusion into critical infrastructure will cause operational disruption within 7 days',
    domains: ['cyber', 'infra'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.72,
  predictionRecords: generatePredictionBlock('cyber', 45, 2),
};

// ── Window 4: Flash flood warning (weather) ───────────────────────────────────────

/**
 * WINDOW 4: NWS flash flood warning → documented flood event within 24 hours.
 *
 * Domain: weather
 * Hypothesis: NWS flash flood warning materializes into flood event within 24h.
 * Known outcome: materialized.
 */
export const WINDOW_FLASH_FLOOD: GoldenWindow = {
  id: 'bench-flash-flood',
  domain: 'weather',
  description: 'NWS flash flood warning → documented flood event within 24h (fixture)',
  seedEpisodes: [
    ep('flood-tx-2023', 'Central Texas flash flood warning; Blanco River crests 40ft; 3 fatalities', ['weather'], ['Texas', 'flash flood', 'river', 'NWS', 'Blanco River'], 'materialized', 900),
    ep('flood-ky-2022', 'Eastern Kentucky flash flood; record rainfall; 39 deaths; FEMA declared disaster', ['weather'], ['Kentucky', 'flash flood', 'NWS', 'rainfall', 'FEMA'], 'materialized', 1300),
    ep('flood-vt-2023', 'Vermont flash flooding; Burlington record rain; roads washed out; state of emergency', ['weather'], ['Vermont', 'flash flood', 'Burlington', 'NWS', 'rainfall'], 'materialized', 800),
    ep('flood-az-2021', 'Arizona monsoon flash flood warning; Maricopa County evacuation; flooding documented', ['weather'], ['Arizona', 'monsoon', 'flash flood', 'NWS', 'Maricopa'], 'materialized', 1700),
    ep('flood-warn-fizzle-2022', 'Flash flood watch issued but rain fell short; no flood documented within 24h', ['weather'], ['flood warning', 'NWS', 'rainfall deficit'], 'fizzled', 1200),
  ],
  plantedAnalogSignatures: ['flood-tx-2023', 'flood-ky-2022', 'flood-vt-2023'],
  plantedClusterSignature: 'flash-flood',
  hypothesisUnderTest: {
    kind: 'alert-burst',
    statement: 'NWS flash flood warning for the monitored area will materialize into documented flood event within 24 hours based on current rainfall rate and river gauge levels',
    domains: ['weather'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.58,
  predictionRecords: generatePredictionBlock('weather', 45, 3),
};

// ── Window 5: Ceasefire breakdown (conflict) ──────────────────────────────────────

/**
 * WINDOW 5: Active ceasefire collapses within 7 days (conflict domain).
 *
 * Hypothesis: recently signed ceasefire agreement collapses within 7 days.
 * Known outcome: fizzled (ceasefire held beyond 7-day window in fixture).
 */
export const WINDOW_CEASEFIRE_BREAKDOWN: GoldenWindow = {
  id: 'bench-ceasefire-breakdown',
  domain: 'conflict',
  description: 'Active ceasefire collapses within 7d — fizzled outcome (fixture)',
  seedEpisodes: [
    ep('ceasefire-lyb-2020a', 'Libya ceasefire signed in Berlin; collapses within 5 days as LNA resumes shelling', ['conflict'], ['Libya', 'ceasefire', 'LNA', 'UN', 'Berlin'], 'materialized', 2100),
    ep('ceasefire-eth-2022', 'Ethiopia Tigray ceasefire signed; held for 3 weeks before sporadic violations', ['conflict'], ['Ethiopia', 'Tigray', 'ceasefire', 'AU'], 'partial', 1300),
    ep('ceasefire-syr-2016', 'Syria Aleppo ceasefire collapses after 4 days of Russian-US brokered pause', ['conflict'], ['Syria', 'Aleppo', 'ceasefire', 'Russia', 'US'], 'materialized', 3500),
    ep('ceasefire-nagorno-2020', 'Nagorno-Karabakh ceasefire holds after 44-day war; Azerbaijani gains frozen', ['conflict'], ['Azerbaijan', 'Armenia', 'Nagorno-Karabakh', 'ceasefire', 'Russia'], 'fizzled', 2000),
    // Non-analog: sanctions deal, not ceasefire
    ep('sanctions-deal-iran-2015', 'Iran nuclear deal (JCPOA) signed; sanctions relief begins; monitoring agreed', ['conflict', 'macro'], ['Iran', 'JCPOA', 'sanctions', 'IAEA', 'US'], 'partial', 4000),
  ],
  plantedAnalogSignatures: ['ceasefire-lyb-2020a', 'ceasefire-syr-2016'],
  plantedClusterSignature: 'ceasefire',
  hypothesisUnderTest: {
    kind: 'situation-escalation',
    statement: 'Recently signed ceasefire agreement between warring parties will collapse within 7 days as frontline violations and truce collapse',
    domains: ['conflict'],
  },
  realizedOutcome: 'fizzled',
  modelForecastP: 0.24,
  predictionRecords: generatePredictionBlock('conflict', 45, 4),
};

// ── Window 6: Data breach escalation (cyber) ───────────────────────────────────────

/**
 * WINDOW 6: Data breach expands in scope within 30 days.
 *
 * Hypothesis: reported data breach expands scope or triggers regulatory action within 30d.
 * Known outcome: materialized.
 */
export const WINDOW_DATA_BREACH: GoldenWindow = {
  id: 'bench-data-breach',
  domain: 'cyber',
  description: 'Data breach scope expansion or regulatory action within 30d (fixture)',
  seedEpisodes: [
    ep('breach-equifax-2017', 'Equifax breach: initial 143M disclosure expanded to 147.9M; FTC $700M settlement', ['cyber'], ['Equifax', 'data breach', 'PII', 'FTC', 'regulatory'], 'materialized', 3200),
    ep('breach-t-mobile-2021', 'T-Mobile breach: 47M → 76M customers; FCC investigation launched within 14d', ['cyber'], ['T-Mobile', 'data breach', 'PII', 'FCC', 'regulatory'], 'materialized', 1800),
    ep('breach-mgm-2023', 'MGM Resorts ALPHV breach; casino systems down; GDPR notification within 72h; $100M impact', ['cyber'], ['MGM', 'ALPHV', 'data breach', 'GDPR', 'ransomware'], 'materialized', 1000),
    ep('breach-twitter-2023', 'Twitter/X 200M email dump circulates; FTC settlement reopened; scope confirmed within 14d', ['cyber'], ['Twitter', 'data breach', 'FTC', 'GDPR', 'email', 'PII'], 'materialized', 1100),
    // Non-analog: supply chain attack, minimal PII scope
    ep('supply-chain-xz-2024', 'XZ Utils backdoor discovered; SSH auth bypass risk; no confirmed breach at disclosure', ['cyber'], ['XZ', 'supply chain', 'backdoor', 'SSH', 'Linux'], 'fizzled', 600),
  ],
  plantedAnalogSignatures: ['breach-equifax-2017', 'breach-t-mobile-2021', 'breach-mgm-2023'],
  plantedClusterSignature: 'data-breach',
  hypothesisUnderTest: {
    kind: 'anomaly-convergence',
    statement: 'Reported data breach exfiltration will expand in confirmed scope or trigger FTC/GDPR regulatory enforcement action within 30 days',
    domains: ['cyber'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.66,
  predictionRecords: generatePredictionBlock('cyber', 45, 5),
};

// ── Window 7: Port disruption shipping delays (shortage/maritime) ─────────────────

/**
 * WINDOW 7: Major port closure → measurable shipping delays within 7 days.
 *
 * Hypothesis: port labor action or closure causes ≥24h routing delays within 7d.
 * Known outcome: materialized.
 */
export const WINDOW_PORT_DISRUPTION: GoldenWindow = {
  id: 'bench-port-disruption',
  domain: 'maritime',
  description: 'Port disruption → measurable shipping delay within 7d (fixture)',
  seedEpisodes: [
    ep('port-la-2014', 'LA/Long Beach port labor dispute: 90-day slowdown; container backlogs; $2B/day impact', ['shortage', 'maritime'], ['Los Angeles', 'Long Beach', 'port', 'longshoremen', 'container', 'shipping'], 'materialized', 4200),
    ep('port-suez-2021', 'Ever Given Suez Canal blockage; 369 vessels held; 6-day closure; $9.6B/day trade impact', ['shortage', 'maritime'], ['Suez Canal', 'Ever Given', 'container', 'shipping', 'port', 'chokepoint'], 'materialized', 1900),
    ep('port-uk-2022', 'UK Felixstowe port strike; 500 workers walk out; 8-day disruption; retail supply chains hit', ['shortage', 'maritime'], ['Felixstowe', 'port', 'strike', 'shipping', 'UK', 'container'], 'materialized', 1300),
    ep('port-hk-2013', 'Hong Kong port strike lasting 40 days; container backlog; shipping rerouted to Shenzhen', ['shortage', 'maritime'], ['Hong Kong', 'port', 'strike', 'container', 'Shenzhen', 'shipping'], 'materialized', 4700),
    // Non-analog: airport disruption, not port
    ep('airport-heathrow-2022', 'Heathrow capacity cap: airlines forced to cancel 10k summer flights', ['aviation'], ['Heathrow', 'airport', 'airline', 'capacity', 'cancellation'], 'materialized', 1400),
  ],
  plantedAnalogSignatures: ['port-la-2014', 'port-suez-2021', 'port-uk-2022'],
  plantedClusterSignature: 'port-disruption',
  hypothesisUnderTest: {
    kind: 'cross-domain-cluster',
    statement: 'Major port closure or labor action at key shipping hub will cause measurable routing delays and container backlog within 7 days',
    domains: ['maritime', 'shortage'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.74,
  predictionRecords: generatePredictionBlock('maritime', 45, 6),
};

// ── Window 8: Equity flash crash (market) ────────────────────────────────────────

/**
 * WINDOW 8: Macro shock → equity index -2% within 24 hours.
 *
 * Hypothesis: equity index drops ≥2% within 24h of a macro shock signal.
 * Known outcome: fizzled (market absorbed shock without -2% move in fixture).
 */
export const WINDOW_EQUITY_CRASH: GoldenWindow = {
  id: 'bench-equity-crash',
  domain: 'markets',
  description: 'Macro shock → equity index -2% within 24h — fizzled outcome (fixture)',
  seedEpisodes: [
    ep('equity-covid-2020', 'S&P 500 -9.5% single day on WHO pandemic declaration; VIX spikes to 75', ['markets', 'macro'], ['S&P 500', 'VIX', 'equity', 'pandemic', 'market crash'], 'materialized', 2200),
    ep('equity-fed-2022', 'S&P 500 -4.0% on hotter-than-expected CPI print; Fed 75bp hike anticipated', ['markets', 'macro'], ['S&P 500', 'Fed', 'CPI', 'VIX', 'equity', 'drawdown'], 'materialized', 1400),
    ep('equity-geopolitical-2022', 'Ukraine invasion day 1: S&P -2.5%; oil +5%; safe-haven flows to USD/gold', ['markets', 'macro', 'conflict'], ['S&P 500', 'Ukraine', 'Russia', 'equity', 'VIX', 'drawdown'], 'materialized', 1500),
    ep('equity-shock-absorbed-2023', 'Banking stress signals (SVB failure day): S&P falls 1.4% then reverses; closes +0.2%', ['markets', 'macro'], ['S&P 500', 'SVB', 'banking', 'VIX', 'equity'], 'fizzled', 1100),
    // Non-analog: bond market, not equity flash crash
    ep('bonds-uk-2022', 'UK gilt market crisis: Truss mini-budget; 30y yield +100bp; no S&P -2% move', ['markets', 'macro'], ['UK gilts', 'bonds', 'Truss', 'yield', 'Bank of England'], 'fizzled', 1300),
  ],
  plantedAnalogSignatures: ['equity-covid-2020', 'equity-fed-2022'],
  plantedClusterSignature: 'equity-crash',
  hypothesisUnderTest: {
    kind: 'anomaly-convergence',
    statement: 'Current macro shock signal will produce equity index drawdown of ≥2% within 24 hours as market reprices risk',
    domains: ['markets', 'macro'],
  },
  realizedOutcome: 'fizzled',
  modelForecastP: 0.21,
  predictionRecords: generatePredictionBlock('markets', 45, 7),
};

// ── Window 9: Drought escalation to exceptional D4 (weather/shortage) ────────────

/**
 * WINDOW 9: D2-D3 drought escalates to D4 exceptional within 90 days.
 *
 * Hypothesis: current D2–D3 drought classification escalates to D4 exceptional.
 * Known outcome: fizzled (monsoon broke drought in fixture before D4).
 */
export const WINDOW_DROUGHT_ESCALATION: GoldenWindow = {
  id: 'bench-drought-escalation',
  domain: 'weather',
  description: 'D2-D3 drought → D4 exceptional escalation within 90d — fizzled (fixture)',
  seedEpisodes: [
    ep('drought-ca-2021', 'California D4 exceptional drought: Lake Oroville at 23% capacity; water restrictions', ['weather', 'shortage'], ['California', 'drought', 'D4', 'Lake Oroville', 'water', 'USDM'], 'materialized', 1800),
    ep('drought-sw-2022', 'Lake Mead reaches historic low; Southwest multi-state D4 exceptional declaration', ['weather', 'shortage'], ['Lake Mead', 'Southwest', 'drought', 'D4', 'Colorado River', 'USDM'], 'materialized', 1400),
    ep('drought-horn-2022', 'Horn of Africa 5th consecutive failed rainy season; D4-equivalent humanitarian crisis', ['weather', 'shortage'], ['Somalia', 'Ethiopia', 'drought', 'D4', 'rainfall', 'humanitarian'], 'materialized', 1300),
    ep('drought-tx-2022-broke', 'Texas drought at D3 but Hurricane Ian rainfall broke drought trajectory before D4', ['weather'], ['Texas', 'drought', 'D3', 'hurricane', 'rainfall', 'USDM'], 'fizzled', 1400),
    // Non-analog: wildfire, not drought escalation
    ep('wildfire-ca-2020', 'California wildfire season burns 4.2M acres; weather-driven; no D4 drought linkage', ['weather'], ['California', 'wildfire', 'fire', 'smoke', 'evacuation'], 'materialized', 2000),
  ],
  plantedAnalogSignatures: ['drought-ca-2021', 'drought-sw-2022'],
  plantedClusterSignature: 'drought-d4',
  hypothesisUnderTest: {
    kind: 'cross-domain-cluster',
    statement: 'Current D2–D3 drought classification will escalate to D4 exceptional within 90 days absent significant precipitation events',
    domains: ['weather', 'shortage'],
  },
  realizedOutcome: 'fizzled',
  modelForecastP: 0.17,
  predictionRecords: generatePredictionBlock('weather', 45, 8),
};

// ── Window 10: Commodity price spike (shortage) ───────────────────────────────────

/**
 * WINDOW 10: Supply disruption → commodity price spike ≥20% within 30 days.
 *
 * Hypothesis: identified supply disruption produces ≥20% commodity price move.
 * Known outcome: materialized (diesel +22% in fixture).
 */
export const WINDOW_COMMODITY_SPIKE: GoldenWindow = {
  id: 'bench-commodity-spike',
  domain: 'macro',
  description: 'Supply disruption → commodity price spike ≥20% within 30d (fixture)',
  seedEpisodes: [
    ep('diesel-2022', 'Distillate inventory hits 5-yr low; crack spread widens; diesel retail +18% over 30d', ['shortage', 'macro'], ['diesel', 'distillate', 'crack spread', 'EIA', 'commodity'], 'materialized', 1500),
    ep('nat-gas-2022', 'European natural gas supply crunch post-Nordstream; TTF futures +300% in 60d', ['shortage', 'macro'], ['natural gas', 'Nordstream', 'TTF', 'LNG', 'commodity', 'supply disruption'], 'materialized', 1400),
    ep('wheat-2022', 'Black Sea export disruption drives CBOT wheat futures +40% within 30d of invasion', ['shortage', 'conflict'], ['wheat', 'CBOT', 'Black Sea', 'supply disruption', 'commodity'], 'materialized', 1500),
    ep('oil-opec-2023', 'OPEC+ surprise production cut; Brent crude +8% within 7d but no ≥20% move in 30d', ['shortage', 'macro'], ['oil', 'Brent', 'OPEC', 'crude', 'production cut', 'commodity'], 'fizzled', 1100),
    // Non-analog: equity sector, not commodity
    ep('energy-stocks-2022', 'Energy sector equities rally 50% YTD; not a commodity supply disruption signal', ['markets'], ['energy stocks', 'equities', 'XLE', 'sector rotation'], 'materialized', 1500),
  ],
  plantedAnalogSignatures: ['diesel-2022', 'nat-gas-2022', 'wheat-2022'],
  plantedClusterSignature: 'commodity-spike',
  hypothesisUnderTest: {
    kind: 'cross-domain-cluster',
    statement: 'Current supply disruption signal for a key commodity will produce a price spike of ≥20% within 30 days as market reprices scarcity premium',
    domains: ['shortage', 'macro'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.63,
  predictionRecords: generatePredictionBlock('macro', 45, 9),
};

// ── Window 11: Hurricane landfall (weather/conflict) ─────────────────────────────

/**
 * WINDOW 11: Tropical system → Category 3+ landfall within 7 days.
 *
 * Hypothesis: verified tropical storm reaches Cat 3+ at landfall within 7d.
 * Known outcome: partial (Cat 2 at landfall, below threshold).
 */
export const WINDOW_HURRICANE_LANDFALL: GoldenWindow = {
  id: 'bench-hurricane-landfall',
  domain: 'weather',
  description: 'Tropical storm → Cat 3+ landfall within 7d — partial outcome (fixture)',
  seedEpisodes: [
    ep('hurricane-ian-2022', 'Ian reaches Cat 4 (155mph) at Cayo Costa FL landfall; NHC 5-day forecast accurate', ['weather'], ['Hurricane Ian', 'Florida', 'landfall', 'NHC', 'Cat 4', 'hurricane', 'tropical storm'], 'materialized', 1370),
    ep('hurricane-ida-2021', 'Ida Cat 4 (150mph) landfall Port Fourchon LA; rapid intensification 24h before', ['weather'], ['Hurricane Ida', 'Louisiana', 'landfall', 'NHC', 'Cat 4', 'rapid intensification', 'hurricane'], 'materialized', 1770),
    ep('hurricane-laura-2020', 'Laura Cat 4 (150mph) hits Cameron Parish LA; extreme wind warning issued', ['weather'], ['Hurricane Laura', 'Louisiana', 'Cat 4', 'landfall', 'NHC', 'hurricane'], 'materialized', 2100),
    ep('hurricane-dorian-2019', 'Dorian Cat 5 over Bahamas; weakened to Cat 2 at US East Coast landfall', ['weather'], ['Hurricane Dorian', 'Bahamas', 'landfall', 'Cat 5', 'NHC', 'hurricane'], 'partial', 2500),
    // Non-analog: severe thunderstorm, not tropical
    ep('tornado-outbreak-2021', 'December 2021 KY-AR tornado super outbreak; 73 fatalities; NWS Storm Prediction Center', ['weather'], ['tornado', 'Kentucky', 'Arkansas', 'SPC', 'outbreak', 'severe thunderstorm'], 'materialized', 1650),
  ],
  plantedAnalogSignatures: ['hurricane-ian-2022', 'hurricane-ida-2021', 'hurricane-laura-2020'],
  plantedClusterSignature: 'hurricane-landfall',
  hypothesisUnderTest: {
    kind: 'situation-escalation',
    statement: 'Tropical system will intensify to Category 3 or stronger at landfall within 7 days given current SST, wind shear, and NHC track forecast',
    domains: ['weather'],
  },
  realizedOutcome: 'partial',
  modelForecastP: 0.43,
  predictionRecords: generatePredictionBlock('weather', 45, 2),
};

// ── Window 12: Airspace closure (aviation) ───────────────────────────────────────

/**
 * WINDOW 12: Airspace threat signal → TFR/restriction within 24 hours.
 *
 * Hypothesis: airspace threat signal materializes into active restriction within 24h.
 * Known outcome: materialized.
 */
export const WINDOW_AIRSPACE_CLOSURE: GoldenWindow = {
  id: 'bench-airspace-closure',
  domain: 'aviation',
  description: 'Airspace threat signal → active TFR/restriction within 24h (fixture)',
  seedEpisodes: [
    ep('airspace-ukraine-2022', 'Ukraine airspace closed immediately on Russian invasion; 400+ aircraft rerouted', ['aviation', 'conflict'], ['Ukraine', 'airspace', 'NOTAM', 'Russia', 'TFR', 'no-fly zone'], 'materialized', 1500),
    ep('airspace-iran-2020', 'Iran airspace closed after PS752 shootdown; ICAO emergency; regional diversions', ['aviation', 'conflict'], ['Iran', 'airspace', 'NOTAM', 'ICAO', 'PS752', 'no-fly zone'], 'materialized', 2300),
    ep('airspace-gulf-2019', 'Gulf Strait of Hormuz airspace NOTAM issued after Iran-US tensions; diversions begin', ['aviation', 'conflict'], ['Gulf', 'Hormuz', 'airspace', 'NOTAM', 'Iran', 'US', 'TFR'], 'materialized', 2500),
    ep('airspace-tfr-superbowl', 'Super Bowl TFR issued 24h before game; general aviation restricted; airlines unaffected', ['aviation'], ['TFR', 'FAA', 'Super Bowl', 'airspace', 'restricted area'], 'materialized', 1000),
    // Non-analog: maritime navigation restriction, not airspace
    ep('strait-hormuz-vessel-2019', 'UK tanker seized in Hormuz strait; maritime NOTAM but no airspace restriction', ['maritime', 'conflict'], ['Hormuz', 'tanker', 'UK', 'Iran', 'vessel', 'maritime'], 'fizzled', 2500),
  ],
  plantedAnalogSignatures: ['airspace-ukraine-2022', 'airspace-iran-2020', 'airspace-gulf-2019'],
  plantedClusterSignature: 'airspace-closure',
  hypothesisUnderTest: {
    kind: 'alert-burst',
    statement: 'Airspace threat signal will materialize into active TFR or NOTAM restriction within 24 hours based on current geopolitical tension and airspace security assessment',
    domains: ['aviation'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.69,
  predictionRecords: generatePredictionBlock('aviation', 45, 3),
};

// ── Window 13: Sovereign debt stress (macro) ─────────────────────────────────────

/**
 * WINDOW 13: Fiscal stress → sovereign rating action within 90 days.
 *
 * Hypothesis: sovereign fiscal stress signals produce downgrade or watch listing within 90d.
 * Known outcome: materialized.
 */
export const WINDOW_SOVEREIGN_DEBT: GoldenWindow = {
  id: 'bench-sovereign-debt',
  domain: 'macro',
  description: 'Fiscal stress signals → sovereign downgrade within 90d (fixture)',
  seedEpisodes: [
    ep('sovereign-greece-2010', 'Greece fiscal stress: deficit 13.6% GDP; Moody downgrade 3-notch within 60d', ['macro', 'markets'], ['Greece', 'sovereign debt', 'downgrade', 'Moody', 'IMF', 'bonds', 'deficit'], 'materialized', 5700),
    ep('sovereign-sri-lanka-2022', 'Sri Lanka sovereign default; Fitch downgrade to CC; IMF bailout within 90d', ['macro', 'markets'], ['Sri Lanka', 'sovereign debt', 'default', 'Fitch', 'IMF', 'bonds', 'downgrade'], 'materialized', 1400),
    ep('sovereign-egypt-2023', 'Egypt FX crisis; IMF S&P downgrade to B-; rating watch negative within 45d', ['macro', 'markets'], ['Egypt', 'sovereign debt', 'S&P', 'downgrade', 'IMF', 'FX', 'bonds'], 'materialized', 1000),
    ep('sovereign-italy-2018', 'Italy BTP-Bund spread widens 300bp; S&P places on negative watch; no downgrade', ['macro', 'markets'], ['Italy', 'BTP', 'bonds', 'sovereign debt', 'S&P', 'ECB', 'spread'], 'fizzled', 2800),
    // Non-analog: corporate debt, not sovereign
    ep('corp-ftx-2022', 'FTX crypto exchange insolvency; $8B deficit; no sovereign rating impact', ['markets', 'crypto'], ['FTX', 'crypto', 'insolvency', 'Chapter 11', 'SBF'], 'materialized', 1300),
  ],
  plantedAnalogSignatures: ['sovereign-greece-2010', 'sovereign-sri-lanka-2022', 'sovereign-egypt-2023'],
  plantedClusterSignature: 'sovereign-debt',
  hypothesisUnderTest: {
    kind: 'cross-domain-cluster',
    statement: 'Sovereign fiscal stress signals including rising debt-to-GDP ratio and deficit widening will trigger a rating downgrade or CreditWatch negative placement within 90 days',
    domains: ['macro', 'markets'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.57,
  predictionRecords: generatePredictionBlock('macro', 45, 4),
};

// ── Window 14: Sanctions package announcement (conflict/macro) ──────────────────

/**
 * WINDOW 14: Geopolitical escalation → new sanctions package within 30 days.
 *
 * Hypothesis: escalating geopolitical event produces new sanctions announcement within 30d.
 * Known outcome: materialized.
 */
export const WINDOW_SANCTIONS_TIGHTENING: GoldenWindow = {
  id: 'bench-sanctions-tightening',
  domain: 'conflict',
  description: 'Geopolitical escalation → new sanctions within 30d (fixture)',
  seedEpisodes: [
    ep('sanctions-russia-2022', 'Ukraine invasion triggers broadest US/EU sanctions in history; SWIFT exclusion; 10d', ['conflict', 'macro'], ['Russia', 'sanctions', 'SWIFT', 'OFAC', 'EU', 'Treasury', 'embargo'], 'materialized', 1500),
    ep('sanctions-iran-2019', 'Iran nuclear program escalation; US maximum pressure; OFAC SDN additions within 14d', ['conflict', 'macro'], ['Iran', 'sanctions', 'OFAC', 'nuclear', 'Treasury', 'export control'], 'materialized', 2600),
    ep('sanctions-china-2020', 'HK autonomy crackdown; US HKAA sanctions on officials within 30d', ['conflict', 'macro'], ['China', 'sanctions', 'Hong Kong', 'OFAC', 'Treasury', 'export control'], 'materialized', 2000),
    ep('sanctions-venezuela-2019', 'Venezuela Maduro gov; OFAC PDVSA sanctions; oil exports blocked within 7d', ['conflict', 'macro'], ['Venezuela', 'Maduro', 'sanctions', 'OFAC', 'PDVSA', 'oil', 'Treasury'], 'materialized', 2700),
    // Non-analog: domestic policy dispute, no foreign sanctions
    ep('domestic-tax-dispute-2021', 'US-EU digital services tax dispute; USTR section 301 study; no OFAC sanctions', ['macro'], ['US', 'EU', 'digital tax', 'USTR', 'trade dispute'], 'fizzled', 1800),
  ],
  plantedAnalogSignatures: ['sanctions-russia-2022', 'sanctions-iran-2019', 'sanctions-china-2020'],
  plantedClusterSignature: 'sanctions',
  hypothesisUnderTest: {
    kind: 'cross-domain-cluster',
    statement: 'Escalating geopolitical confrontation will trigger a new US or EU sanctions package or OFAC SDN designation within 30 days',
    domains: ['conflict', 'macro'],
  },
  realizedOutcome: 'materialized',
  modelForecastP: 0.71,
  predictionRecords: generatePredictionBlock('conflict', 45, 5),
};

// ── Catalog ──────────────────────────────────────────────────────────────────────

/** All golden windows in stable order. */
export const GOLDEN_WINDOWS: readonly GoldenWindow[] = [
  WINDOW_BLACK_SEA_GRAIN,
  WINDOW_EM_CURRENCY_CRISIS,
  WINDOW_ICS_CYBERATTACK,
  WINDOW_FLASH_FLOOD,
  WINDOW_CEASEFIRE_BREAKDOWN,
  WINDOW_DATA_BREACH,
  WINDOW_PORT_DISRUPTION,
  WINDOW_EQUITY_CRASH,
  WINDOW_DROUGHT_ESCALATION,
  WINDOW_COMMODITY_SPIKE,
  WINDOW_HURRICANE_LANDFALL,
  WINDOW_AIRSPACE_CLOSURE,
  WINDOW_SOVEREIGN_DEBT,
  WINDOW_SANCTIONS_TIGHTENING,
];

export const WINDOW_COUNT = GOLDEN_WINDOWS.length; // 14

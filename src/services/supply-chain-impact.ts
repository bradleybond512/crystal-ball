/**
 * Supply Chain Impact Tracker
 *
 * Monitors critical maritime chokepoints for disruption signals from
 * ACLED conflict data, GDACS disaster alerts, and AIS vessel concentration.
 * When disruptions are detected, models commodity price impact, shortage
 * timelines, and affected regions. Uses Claude Agent / Ollama fallback
 * to generate consumer-facing impact narratives.
 */

import { getApiBaseUrl } from './runtime';
import { haversineKm } from './proximity-filter';
import { dataFreshness } from './data-freshness';
import { runClaudeAgent } from './claude-agent';

// ── Types ────────────────────────────────────────────────────────────────────

export type ChokepointId =
  | 'hormuz'
  | 'suez'
  | 'malacca'
  | 'panama'
  | 'bab-el-mandeb'
  | 'taiwan'
  | 'turkish'
  | 'good-hope';

export type DisruptionLevel = 'open' | 'stressed' | 'disrupted' | 'blocked';

export type CommodityType =
  | 'oil'
  | 'lng'
  | 'grain'
  | 'semiconductors'
  | 'manufactured-goods'
  | 'minerals'
  | 'containerized-cargo';

export interface AlternativeRoute {
  name: string;
  additionalDaysTransit: number;
  additionalCostPct: number;
}

export interface ChokepointDefinition {
  id: ChokepointId;
  name: string;
  lat: number;
  lon: number;
  commodities: CommodityType[];
  dailyTrafficVolume: number;
  globalTradeSharePct: number;
  alternativeRoutes: AlternativeRoute[];
}

export interface DisruptionSignal {
  source: 'acled' | 'gdacs' | 'ais' | 'weather' | 'news';
  severity: number; // 0-1
  description: string;
  timestamp: string;
}

export interface ChokepointStatus {
  chokepoint: ChokepointDefinition;
  level: DisruptionLevel;
  signals: DisruptionSignal[];
  throughputPct: number; // 0-100, 100 = normal
  lastUpdated: string;
}

export interface CommodityImpact {
  commodity: CommodityType;
  estimatedPriceImpactPct: number;
  timelineToShortageWeeks: number | null;
  affectedRegions: string[];
  confidence: number; // 0-1
}

export interface SupplyDisruption {
  id: string;
  chokepointId: ChokepointId;
  chokepointName: string;
  level: DisruptionLevel;
  startedAt: string;
  commodityImpacts: CommodityImpact[];
  narrative: string;
  signals: DisruptionSignal[];
}

export interface ImpactForecast {
  commodity: CommodityType;
  currentDisruptions: number;
  aggregatePriceImpactPct: number;
  consumerSummary: string;
  timelineWeeks: number | null;
}

// ── Chokepoint Definitions ───────────────────────────────────────────────────

export const CHOKEPOINTS: ChokepointDefinition[] = [
  {
 id: 'hormuz',
 name: 'Strait of Hormuz',
 lat: 26.56,
 lon: 56.25,
 commodities: ['oil', 'lng'],
 dailyTrafficVolume: 80,
 globalTradeSharePct: 21,
 alternativeRoutes: [
 { name: 'East-West Pipeline (Saudi)', additionalDaysTransit: 0, additionalCostPct: 15 },
 { name: 'Cape of Good Hope', additionalDaysTransit: 14, additionalCostPct: 35 },
 ],
  },
  {
 id: 'suez',
 name: 'Suez Canal',
 lat: 30.46,
 lon: 32.34,
 commodities: ['oil', 'containerized-cargo', 'lng', 'grain'],
 dailyTrafficVolume: 55,
 globalTradeSharePct: 12,
 alternativeRoutes: [
 { name: 'Cape of Good Hope', additionalDaysTransit: 10, additionalCostPct: 30 },
 ],
  },
  {
 id: 'malacca',
 name: 'Strait of Malacca',
 lat: 2.5,
 lon: 101.0,
 commodities: ['oil', 'lng', 'containerized-cargo', 'manufactured-goods', 'semiconductors'],
 dailyTrafficVolume: 90,
 globalTradeSharePct: 25,
 alternativeRoutes: [
 { name: 'Lombok Strait', additionalDaysTransit: 2, additionalCostPct: 10 },
 { name: 'Sunda Strait', additionalDaysTransit: 1, additionalCostPct: 8 },
 ],
  },
  {
 id: 'panama',
 name: 'Panama Canal',
 lat: 9.08,
 lon: -79.68,
 commodities: ['containerized-cargo', 'grain', 'lng', 'manufactured-goods'],
 dailyTrafficVolume: 40,
 globalTradeSharePct: 5,
 alternativeRoutes: [
 { name: 'Cape Horn', additionalDaysTransit: 14, additionalCostPct: 40 },
 { name: 'US intermodal rail', additionalDaysTransit: 5, additionalCostPct: 25 },
 ],
  },
  {
 id: 'bab-el-mandeb',
 name: 'Bab el-Mandeb',
 lat: 12.58,
 lon: 43.33,
 commodities: ['oil', 'lng', 'containerized-cargo'],
 dailyTrafficVolume: 45,
 globalTradeSharePct: 9,
 alternativeRoutes: [
 { name: 'Cape of Good Hope', additionalDaysTransit: 12, additionalCostPct: 35 },
 ],
  },
  {
 id: 'taiwan',
 name: 'Taiwan Strait',
 lat: 24.0,
 lon: 119.5,
 commodities: ['semiconductors', 'manufactured-goods', 'containerized-cargo'],
 dailyTrafficVolume: 60,
 globalTradeSharePct: 8,
 alternativeRoutes: [
 { name: 'East of Taiwan (Pacific route)', additionalDaysTransit: 1, additionalCostPct: 12 },
 { name: 'Luzon Strait', additionalDaysTransit: 2, additionalCostPct: 15 },
 ],
  },
  {
 id: 'turkish',
 name: 'Turkish Straits',
 lat: 41.12,
 lon: 29.05,
 commodities: ['oil', 'grain', 'minerals'],
 dailyTrafficVolume: 50,
 globalTradeSharePct: 3,
 alternativeRoutes: [
 { name: 'Druzhba Pipeline (oil)', additionalDaysTransit: 0, additionalCostPct: 10 },
 { name: 'Overland rail via Balkans', additionalDaysTransit: 5, additionalCostPct: 45 },
 ],
  },
  {
 id: 'good-hope',
 name: 'Cape of Good Hope',
 lat: -34.35,
 lon: 18.47,
 commodities: ['oil', 'containerized-cargo', 'minerals', 'grain'],
 dailyTrafficVolume: 30,
 globalTradeSharePct: 4,
 alternativeRoutes: [
 { name: 'Suez Canal (if available)', additionalDaysTransit: -10, additionalCostPct: -20 },
 ],
  },
];

// ── Cache ────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'crystalball-supply-chain-impact-v1';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CachedState {
  statuses: ChokepointStatus[];
  disruptions: SupplyDisruption[];
  forecasts: ImpactForecast[];
  cachedAt: number;
}

function loadCache(): CachedState | null {
  try {
 const raw = localStorage.getItem(CACHE_KEY);
 if (!raw) return null;
 const parsed = JSON.parse(raw) as CachedState;
 if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
 return parsed;
  } catch {
 return null;
  }
}

function saveCache(state: CachedState): void {
  try {
 localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
 // localStorage full or unavailable — silently skip
  }
}

// ── Disruption Detection ─────────────────────────────────────────────────────

const DISRUPTION_PROXIMITY_KM = 500;


interface SidecarConflictEvent {
  lat: number;
  lon: number;
  event_type: string;
  fatalities: number;
  country: string;
  notes: string;
  event_date: string;
}

interface SidecarDisasterAlert {
  lat: number;
  lon: number;
  severity: string;
  type: string;
  title: string;
  date: string;
}

interface SidecarVesselCluster {
  lat: number;
  lon: number;
  count: number;
  isMilitary: boolean;
}

async function fetchConflictEvents(): Promise<SidecarConflictEvent[]> {
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/acled`);
 if (!res.ok) return [];
 const data = (await res.json()) as { events?: SidecarConflictEvent[] };
 return data.events ?? [];
  } catch {
 return [];
  }
}

async function fetchDisasterAlerts(): Promise<SidecarDisasterAlert[]> {
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/gdacs`);
 if (!res.ok) return [];
 const data = (await res.json()) as { alerts?: SidecarDisasterAlert[] };
 return data.alerts ?? [];
  } catch {
 return [];
  }
}

async function fetchVesselClusters(): Promise<SidecarVesselCluster[]> {
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/ais-clusters`);
 if (!res.ok) return [];
 const data = (await res.json()) as { clusters?: SidecarVesselCluster[] };
 return data.clusters ?? [];
  } catch {
 return [];
  }
}

function conflictSignals(cp: ChokepointDefinition, conflicts: SidecarConflictEvent[]): DisruptionSignal[] {
  const out: DisruptionSignal[] = [];
  for (const ev of conflicts) {
 const dist = haversineKm(cp.lat, cp.lon, ev.lat, ev.lon);
 if (dist <= DISRUPTION_PROXIMITY_KM) {
 out.push({
 source: 'acled',
 severity: Math.min(1, 0.3 + ev.fatalities * 0.02),
 description: `${ev.event_type} in ${ev.country}: ${ev.notes.slice(0, 120)}`,
 timestamp: ev.event_date,
 });
 }
  }
  return out;
}

function disasterSeverityScore(level: string): number {
  if (level === 'red') return 0.9;
  if (level === 'orange') return 0.6;
  return 0.3;
}

function disasterSignals(cp: ChokepointDefinition, disasters: SidecarDisasterAlert[]): DisruptionSignal[] {
  const out: DisruptionSignal[] = [];
  for (const d of disasters) {
 const dist = haversineKm(cp.lat, cp.lon, d.lat, d.lon);
 if (dist <= DISRUPTION_PROXIMITY_KM) {
 out.push({
 source: 'gdacs',
 severity: disasterSeverityScore(d.severity),
 description: `${d.type}: ${d.title}`,
 timestamp: d.date,
 });
 }
  }
  return out;
}

function vesselSignals(cp: ChokepointDefinition, vessels: SidecarVesselCluster[]): DisruptionSignal[] {
  const out: DisruptionSignal[] = [];
  for (const v of vessels) {
 if (!v.isMilitary || v.count < 3) continue;
 const dist = haversineKm(cp.lat, cp.lon, v.lat, v.lon);
 if (dist <= DISRUPTION_PROXIMITY_KM) {
 out.push({
 source: 'ais',
 severity: Math.min(1, 0.4 + v.count * 0.05),
 description: `${v.count} military vessels detected within ${Math.round(dist)}km`,
 timestamp: new Date().toISOString(),
 });
 }
  }
  return out;
}

function detectSignalsForChokepoint(
  cp: ChokepointDefinition,
  conflicts: SidecarConflictEvent[],
  disasters: SidecarDisasterAlert[],
  vessels: SidecarVesselCluster[],
): DisruptionSignal[] {
  return [
 ...conflictSignals(cp, conflicts),
 ...disasterSignals(cp, disasters),
 ...vesselSignals(cp, vessels),
  ];
}

function computeDisruptionLevel(signals: DisruptionSignal[]): { level: DisruptionLevel; throughputPct: number } {
  if (signals.length === 0) return { level: 'open', throughputPct: 100 };

  const maxSeverity = Math.max(...signals.map((s) => s.severity));
  const signalCount = signals.length;

  // Composite score: weighted by max severity and number of signals
  const composite = maxSeverity * 0.6 + Math.min(1, signalCount / 5) * 0.4;

  if (composite >= 0.8) return { level: 'blocked', throughputPct: Math.round(Math.max(0, (1 - composite) * 100)) };
  if (composite >= 0.55) return { level: 'disrupted', throughputPct: Math.round((1 - composite * 0.7) * 100) };
  if (composite >= 0.3) return { level: 'stressed', throughputPct: Math.round((1 - composite * 0.4) * 100) };
  return { level: 'open', throughputPct: Math.round((1 - composite * 0.1) * 100) };
}

// ── Impact Modeling ──────────────────────────────────────────────────────────

const COMMODITY_PRICE_SENSITIVITY: Record<CommodityType, number> = {
  'oil': 1.5,
  'lng': 1.3,
  'grain': 1.2,
  'semiconductors': 0.8,
  'manufactured-goods': 0.6,
  'minerals': 0.9,
  'containerized-cargo': 0.5,
};

const COMMODITY_SHORTAGE_WEEKS: Record<CommodityType, number> = {
  'oil': 2,
  'lng': 3,
  'grain': 4,
  'semiconductors': 6,
  'manufactured-goods': 8,
  'minerals': 5,
  'containerized-cargo': 6,
};

const COMMODITY_REGIONS: Record<CommodityType, string[]> = {
  'oil': ['North America', 'Europe', 'East Asia'],
  'lng': ['Europe', 'East Asia', 'South Asia'],
  'grain': ['Middle East', 'North Africa', 'Sub-Saharan Africa'],
  'semiconductors': ['Global — electronics manufacturing'],
  'manufactured-goods': ['North America', 'Europe'],
  'minerals': ['Global — industrial supply chains'],
  'containerized-cargo': ['Global — retail and manufacturing'],
};

function modelCommodityImpact(
  commodity: CommodityType,
  disruptionLevel: DisruptionLevel,
  globalTradeSharePct: number,
): CommodityImpact {
  const levelMultiplier: Record<DisruptionLevel, number> = {
 open: 0,
 stressed: 0.3,
 disrupted: 0.7,
 blocked: 1.0,
  };

  const mult = levelMultiplier[disruptionLevel];
  const sensitivity = COMMODITY_PRICE_SENSITIVITY[commodity];
  const tradeShare = globalTradeSharePct / 100;

  const priceImpact = Math.round(mult * sensitivity * tradeShare * 100 * 10) / 10;
  const shortageWeeks = mult >= 0.7 ? COMMODITY_SHORTAGE_WEEKS[commodity] : null;

  return {
 commodity,
 estimatedPriceImpactPct: priceImpact,
 timelineToShortageWeeks: shortageWeeks,
 affectedRegions: COMMODITY_REGIONS[commodity],
 confidence: mult >= 0.3 ? 0.6 + mult * 0.3 : 0.4,
  };
}

// ── AI Narrative Generation ──────────────────────────────────────────────────

async function generateNarrative(disruption: {
  chokepointName: string;
  level: DisruptionLevel;
  commodityImpacts: CommodityImpact[];
  signals: DisruptionSignal[];
}): Promise<string> {
  const prompt = buildNarrativePrompt(disruption);

  // Try Claude Agent first — routes through the gated runClaudeAgent() path
  // so localModelOnly and llmEgressDisclosed controls are honoured.
  try {
 const agentRes = await runClaudeAgent(prompt, AbortSignal.timeout(15000));
 if (agentRes.response) return agentRes.response;
  } catch {
 // Claude unavailable or gate blocked — try Ollama
  }

  // Ollama fallback
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/ollama-summarize`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ text: prompt, maxTokens: 300 }),
 signal: AbortSignal.timeout(15000),
 });
 if (res.ok) {
 const data = (await res.json()) as { summary?: string };
 if (data.summary) return data.summary;
 }
  } catch {
 // Ollama also unavailable
  }

  // Template fallback
  return buildTemplateFallback(disruption);
}

function buildNarrativePrompt(disruption: {
  chokepointName: string;
  level: DisruptionLevel;
  commodityImpacts: CommodityImpact[];
  signals: DisruptionSignal[];
}): string {
  const impactLines = disruption.commodityImpacts
 .filter((c) => c.estimatedPriceImpactPct > 0)
 .map((c) => {
 const shortage = c.timelineToShortageWeeks
 ? `, shortages possible in ${c.timelineToShortageWeeks} weeks`
 : '';
 return `- ${c.commodity}: +${c.estimatedPriceImpactPct}% price impact${shortage}`;
 })
 .join('\n');

  const signalLines = disruption.signals
 .slice(0, 5)
 .map((s) => `- [${s.source}] ${s.description}`)
 .join('\n');

  return `You are a supply chain analyst for a consumer-facing crystal ball app. Write a brief (2-3 sentence) consumer-friendly impact summary.

Chokepoint: ${disruption.chokepointName}
Status: ${disruption.level}

Disruption signals:
${signalLines}

Modeled commodity impacts:
${impactLines}

Write a clear, specific consumer impact statement. Example tone: "Expect fuel prices +15% in 2 weeks. Semiconductor shortages may affect electronics availability in 4-6 weeks." Be specific about percentages and timelines.`;
}

function buildTemplateFallback(disruption: {
  chokepointName: string;
  level: DisruptionLevel;
  commodityImpacts: CommodityImpact[];
}): string {
  const topImpacts = disruption.commodityImpacts
 .filter((c) => c.estimatedPriceImpactPct > 1)
 .sort((a, b) => b.estimatedPriceImpactPct - a.estimatedPriceImpactPct)
 .slice(0, 3);

  if (topImpacts.length === 0) {
 return `${disruption.chokepointName} is currently ${disruption.level}. No significant consumer impact expected at this time.`;
  }

  const parts = topImpacts.map((c) => {
 const commodity = c.commodity.replace(/-/g, ' ');
 const shortage = c.timelineToShortageWeeks
 ? ` Shortages possible in ${c.timelineToShortageWeeks} weeks.`
 : '';
 return `${commodity} prices may increase ~${c.estimatedPriceImpactPct}%.${shortage}`;
  });

  return `${disruption.chokepointName} ${disruption.level}: ${parts.join(' ')}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

let cachedState: CachedState | null = null;
let refreshPromise: Promise<void> | null = null;

function aggregateForecasts(disruptions: SupplyDisruption[]): ImpactForecast[] {
  const commodityMap = new Map<CommodityType, { impacts: CommodityImpact[]; disruptions: number }>();
  for (const d of disruptions) {
 for (const ci of d.commodityImpacts) {
 const existing = commodityMap.get(ci.commodity);
 if (existing) {
 existing.impacts.push(ci);
 existing.disruptions++;
 } else {
 commodityMap.set(ci.commodity, { impacts: [ci], disruptions: 1 });
 }
 }
  }

  const forecasts: ImpactForecast[] = [];
  for (const [commodity, { impacts, disruptions: disruptionCount }] of commodityMap) {
 const aggPriceImpact = impacts.reduce((sum, i) => sum + i.estimatedPriceImpactPct, 0);
 const minTimeline = impacts
 .map((i) => i.timelineToShortageWeeks)
 .filter((w): w is number => w !== null);
 const timeline = minTimeline.length > 0 ? Math.min(...minTimeline) : null;

 const commodityLabel = commodity.replace(/-/g, ' ');
 const shortageSuffix = timeline ? ' Possible shortages in ' + String(timeline) + ' weeks.' : '';
 const consumerSummary = aggPriceImpact > 5
 ? 'Significant ' + commodityLabel + ' price increases expected (~' + aggPriceImpact.toFixed(1) + '%).' + shortageSuffix
 : 'Moderate ' + commodityLabel + ' market pressure (+' + aggPriceImpact.toFixed(1) + '%). Monitor for escalation.';

 forecasts.push({
 commodity,
 currentDisruptions: disruptionCount,
 aggregatePriceImpactPct: Math.round(aggPriceImpact * 10) / 10,
 consumerSummary,
 timelineWeeks: timeline,
 });
  }
  return forecasts;
}

async function buildDisruptions(
  statuses: ChokepointStatus[],
  now: string,
): Promise<SupplyDisruption[]> {
  const disruptions: SupplyDisruption[] = [];
  for (const s of statuses) {
 if (s.level === 'open') continue;
 const cp = s.chokepoint;
 const commodityImpacts = cp.commodities.map((c) =>
 modelCommodityImpact(c, s.level, cp.globalTradeSharePct),
 );
 const narrative = await generateNarrative({
 chokepointName: cp.name,
 level: s.level,
 commodityImpacts,
 signals: s.signals,
 });
 disruptions.push({
 id: `${cp.id}-${Date.now()}`,
 chokepointId: cp.id,
 chokepointName: cp.name,
 level: s.level,
 startedAt: now,
 commodityImpacts,
 narrative,
 signals: s.signals,
 });
  }
  return disruptions;
}

async function refreshData(): Promise<void> {
  try {
    const [conflicts, disasters, vessels] = await Promise.all([
      fetchConflictEvents(),
      fetchDisasterAlerts(),
      fetchVesselClusters(),
    ]);

    const now = new Date().toISOString();
    const statuses: ChokepointStatus[] = CHOKEPOINTS.map((cp) => {
      const signals = detectSignalsForChokepoint(cp, conflicts, disasters, vessels);
      const { level, throughputPct } = computeDisruptionLevel(signals);
      return { chokepoint: cp, level, signals, throughputPct, lastUpdated: now };
    });

    const disruptions = await buildDisruptions(statuses, now);
    const forecasts = aggregateForecasts(disruptions);

    cachedState = { statuses, disruptions, forecasts, cachedAt: Date.now() };
    saveCache(cachedState);
    dataFreshness.recordUpdate('supply-chain-impact', statuses.length);
  } catch (error) {
    dataFreshness.recordError('supply-chain-impact', String(error));
    throw error;
  }
}

async function ensureData(): Promise<CachedState> {
  if (cachedState && Date.now() - cachedState.cachedAt < CACHE_TTL_MS) {
 return cachedState;
  }

  const fromStorage = loadCache();
  if (fromStorage) {
 cachedState = fromStorage;
 return fromStorage;
  }

  refreshPromise ??= refreshData().finally(() => {
 refreshPromise = null;
  });
  await refreshPromise;

  return cachedState ?? { statuses: [], disruptions: [], forecasts: [], cachedAt: Date.now() };
}

export async function getChokepointStatus(): Promise<ChokepointStatus[]> {
  const state = await ensureData();
  return state.statuses;
}

export async function getActiveDisruptions(): Promise<SupplyDisruption[]> {
  const state = await ensureData();
  return state.disruptions;
}

export async function getImpactForecast(): Promise<ImpactForecast[]> {
  const state = await ensureData();
  return state.forecasts;
}

/** Force a data refresh, ignoring cache. */
export async function refreshSupplyChainImpact(): Promise<void> {
  cachedState = null;
  localStorage.removeItem(CACHE_KEY);
  refreshPromise ??= refreshData().finally(() => {
 refreshPromise = null;
  });
  await refreshPromise;
}

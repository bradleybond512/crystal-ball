/**
 * Financial Contagion Model Service
 *
 * Models cascade paths between financial domains and estimates systemic risk
 * by tracking 8 contagion channels: yield curve inversion, credit spread
 * widening, VIX spike, bank stress, commodity shock, currency crisis,
 * sovereign debt stress, and supply chain disruption.
 *
 * Uses live data from economic-stress indicators and market data to compute
 * channel stress levels (0-100), then models cascade probabilities across
 * linked domains: banking → credit → housing → consumer → employment.
 *
 * When Claude Agent or Ollama is available, generates a narrative risk
 * assessment summarising the contagion landscape.
 */

import { fetchEconomicStress, type EconomicStressData } from './economic-stress';
import { runClaudeAgent } from './claude-agent';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContagionTrend = 'rising' | 'stable' | 'falling';

export interface ChannelDataPoint {
  label: string;
  value: number;
  source: string;
}

export interface ChannelStress {
  channel: string;
  stressLevel: number;
  trend: ContagionTrend;
  dataPoints: ChannelDataPoint[];
}

export interface CascadeStep {
  label: string;
  probability: number;
  stressLevel: number;
}

export interface CascadePath {
  trigger: string;
  steps: CascadeStep[];
  overallProbability: number;
}

export interface ContagionModel {
  channels: ChannelStress[];
  cascadePaths: CascadePath[];
  systemicRiskScore: number;
  aiNarrative: string | null;
  updatedAt: string;
}

// ── Channel definitions ──────────────────────────────────────────────────────

interface ChannelDef {
  id: string;
  label: string;
  /** Map economic-stress indicator values to a 0-100 stress level. */
  compute: (data: EconomicStressData) => { stress: number; dataPoints: ChannelDataPoint[] };
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

const CHANNEL_DEFS: ChannelDef[] = [
  {
 id: 'yield-curve',
 label: 'Yield Curve Inversion',
 compute(data) {
 const spread = data.indicators.yieldCurve.value;
 // Negative spread = inversion; -1% → stress 100
 const stress = clamp(spread <= 0 ? 50 + Math.abs(spread) * 50 : 50 - spread * 20);
 return {
 stress,
 dataPoints: [{ label: '10Y-2Y Spread', value: spread, source: 'FRED' }],
 };
 },
  },
  {
 id: 'credit-spread',
 label: 'Credit Spread Widening',
 compute(data) {
 const bank = data.indicators.bankSpread.value;
 // Bank spread above 2% is severe; 0% is calm
 const stress = clamp(bank * 33);
 return {
 stress,
 dataPoints: [{ label: 'Bank Spread', value: bank, source: 'FRED' }],
 };
 },
  },
  {
 id: 'vix-spike',
 label: 'VIX Spike',
 compute(data) {
 const vix = data.indicators.vix.value;
 // VIX: 12 = calm, 30 = elevated, 50+ = panic
 const stress = clamp((vix - 12) * (100 / 38));
 return {
 stress,
 dataPoints: [{ label: 'VIX', value: vix, source: 'CBOE' }],
 };
 },
  },
  {
 id: 'bank-stress',
 label: 'Bank Stress',
 compute(data) {
 const fsi = data.indicators.fsi.value;
 // FSI: 0 = normal, 5+ = extreme stress
 const stress = clamp(fsi * 20);
 return {
 stress,
 dataPoints: [{ label: 'Financial Stress Index', value: fsi, source: 'FRED' }],
 };
 },
  },
  {
 id: 'commodity-shock',
 label: 'Commodity Shock',
 compute(data) {
 // Proxy via supply chain pressure
 const sc = data.indicators.supplyChain.value;
 // Supply chain: 0 SD = normal; 2+ SD = stressed
 const stress = clamp(sc * 33);
 return {
 stress,
 dataPoints: [{ label: 'Supply Chain Pressure', value: sc, source: 'FRED' }],
 };
 },
  },
  {
 id: 'currency-crisis',
 label: 'Currency Crisis',
 compute(data) {
 // Combine VIX + FSI as proxy for currency instability
 const vix = data.indicators.vix.value;
 const fsi = data.indicators.fsi.value;
 const stress = clamp(((vix - 12) / 38) * 50 + fsi * 10);
 return {
 stress,
 dataPoints: [
 { label: 'VIX component', value: vix, source: 'CBOE' },
 { label: 'FSI component', value: fsi, source: 'FRED' },
 ],
 };
 },
  },
  {
 id: 'sovereign-debt',
 label: 'Sovereign Debt Stress',
 compute(data) {
 // Yield curve inversion + bank spread as sovereign pressure proxy
 const spread = data.indicators.yieldCurve.value;
 const bank = data.indicators.bankSpread.value;
 const stress = clamp((spread <= 0 ? 40 + Math.abs(spread) * 30 : 20 - spread * 10) + bank * 15);
 return {
 stress,
 dataPoints: [
 { label: '10Y-2Y Spread', value: spread, source: 'FRED' },
 { label: 'Bank Spread', value: bank, source: 'FRED' },
 ],
 };
 },
  },
  {
 id: 'supply-chain',
 label: 'Supply Chain Disruption',
 compute(data) {
 const sc = data.indicators.supplyChain.value;
 const stress = clamp(sc * 40);
 return {
 stress,
 dataPoints: [{ label: 'Supply Chain Pressure Index', value: sc, source: 'FRED' }],
 };
 },
  },
];

// ── Trend tracking ───────────────────────────────────────────────────────────

const HISTORY_KEY = 'crystalball-contagion-history';
const MAX_HISTORY = 10;

interface HistoryEntry {
  ts: number;
  levels: Record<string, number>;
}

function loadHistory(): HistoryEntry[] {
  try {
 const raw = localStorage.getItem(HISTORY_KEY);
 return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
 return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-MAX_HISTORY)));
}

function computeTrend(channel: string, current: number, history: HistoryEntry[]): ContagionTrend {
  if (history.length < 2) return 'stable';
  const prevEntry = history[history.length - 1];
  const prevLevel = prevEntry?.levels[channel];
  if (prevLevel === undefined) return 'stable';
  if (current > prevLevel + 3) return 'rising';
  if (current < prevLevel - 3) return 'falling';
  return 'stable';
}

// ── Cascade modelling ────────────────────────────────────────────────────────

interface CascadeEdge {
  from: string;
  to: string;
  weight: number;
  label: string;
}

const CASCADE_EDGES: CascadeEdge[] = [
  { from: 'bank-stress', to: 'credit-spread', weight: 0.85, label: 'Credit freeze likely' },
  { from: 'credit-spread', to: 'consumer-decline',  weight: 0.70, label: 'Consumer spending decline' },
  { from: 'consumer-decline', to: 'employment-risk', weight: 0.60, label: 'Unemployment rise' },
  { from: 'yield-curve', to: 'bank-stress', weight: 0.75, label: 'Banking sector pressure' },
  { from: 'yield-curve', to: 'sovereign-debt', weight: 0.65, label: 'Sovereign borrowing stress' },
  { from: 'vix-spike', to: 'credit-spread', weight: 0.70, label: 'Risk repricing' },
  { from: 'vix-spike', to: 'currency-crisis', weight: 0.55, label: 'Capital flight risk' },
  { from: 'commodity-shock',  to: 'supply-chain', weight: 0.80, label: 'Supply disruption' },
  { from: 'commodity-shock',  to: 'consumer-decline', weight: 0.60, label: 'Cost-of-living shock' },
  { from: 'supply-chain', to: 'commodity-shock', weight: 0.50, label: 'Feedback loop' },
  { from: 'currency-crisis',  to: 'sovereign-debt', weight: 0.70, label: 'Debt servicing crisis' },
  { from: 'sovereign-debt', to: 'bank-stress', weight: 0.75, label: 'Bank exposure to sovereign' },
];

/** Synthetic channels that exist only as cascade targets, not measured directly. */
const SYNTHETIC_STRESS: Record<string, (channels: Map<string, number>) => number> = {
  'consumer-decline': (ch) => {
 const credit = ch.get('credit-spread') ?? 0;
 const commodity = ch.get('commodity-shock') ?? 0;
 return clamp(credit * 0.6 + commodity * 0.4);
  },
  'employment-risk': (ch) => {
 const consumer = ch.get('consumer-decline') ?? 0;
 const bank = ch.get('bank-stress') ?? 0;
 return clamp(consumer * 0.7 + bank * 0.3);
  },
};

/** Dampening factor for feedback loops (return edges get 0.5x weight). */
const FEEDBACK_DAMPENING = 0.5;

function buildCascadePaths(stressMap: Map<string, number>): CascadePath[] {
  const paths: CascadePath[] = [];
  const HIGH_THRESHOLD = 60;

  // Find all high-stress channels as potential triggers
  for (const [channelId, stress] of stressMap) {
 if (stress < HIGH_THRESHOLD) continue;

 // BFS from this trigger along cascade edges.
 // Track visit count: allow revisiting a node exactly once (feedback loop)
 // but with dampened weight.
 const visitCount = new Map<string, number>();
 visitCount.set(channelId, 1);
 const steps: CascadeStep[] = [];
 let frontier = [channelId];
 let cumulativeProb = 1.0;

 while (frontier.length > 0) {
 const nextFrontier: string[] = [];
 for (const node of frontier) {
 const outEdges = CASCADE_EDGES.filter(e => e.from === node);
 for (const edge of outEdges) {
 const visits = visitCount.get(edge.to) ?? 0;
 if (visits >= 2) continue; // Max 2 visits (initial + 1 feedback)

 const isFeedback = visits === 1;
 visitCount.set(edge.to, visits + 1);

 const nodeStress = stressMap.get(edge.to) ?? 0;
 const sourceStress = stressMap.get(node) ?? 0;
 const baseWeight = edge.weight;
 const effectiveWeight = isFeedback ? baseWeight * FEEDBACK_DAMPENING : baseWeight;
 const prob = Math.min(0.99, (sourceStress / 100) * effectiveWeight);
 cumulativeProb *= prob;

 steps.push({
 label: isFeedback ? `${edge.label} (feedback)` : edge.label,
 probability: Math.round(prob * 100),
 stressLevel: Math.round(nodeStress),
 });
 nextFrontier.push(edge.to);
 }
 }
 frontier = nextFrontier;
 }

 if (steps.length > 0) {
 const def = CHANNEL_DEFS.find(d => d.id === channelId);
 paths.push({
 trigger: `${def?.label ?? channelId} (${Math.round(stress)})`,
 steps,
 overallProbability: Math.round(cumulativeProb * 100),
 });
 }
  }

  // Sort by overall probability descending
  paths.sort((a, b) => b.overallProbability - a.overallProbability);
  return paths.slice(0, 5);
}

// ── AI narrative ─────────────────────────────────────────────────────────────

const AI_CACHE_KEY = 'crystalball-contagion-ai-narrative';
const AI_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface AiCache {
  narrative: string;
  ts: number;
}

function getCachedNarrative(): string | null {
  try {
 const raw = localStorage.getItem(AI_CACHE_KEY);
 if (!raw) return null;
 const cache = JSON.parse(raw) as AiCache;
 if (Date.now() - cache.ts > AI_CACHE_TTL_MS) return null;
 return cache.narrative;
  } catch {
 return null;
  }
}

function cacheNarrative(narrative: string): void {
  const entry: AiCache = { narrative, ts: Date.now() };
  localStorage.setItem(AI_CACHE_KEY, JSON.stringify(entry));
}

async function generateNarrative(channels: ChannelStress[], paths: CascadePath[], score: number): Promise<string | null> {
  const cached = getCachedNarrative();
  if (cached) return cached;

  const channelSummary = channels
 .map(c => `${c.channel}: ${c.stressLevel}/100 (${c.trend})`)
 .join('\n');

  const pathSummary = paths
 .map(p => `${p.trigger} → ${p.steps.map(s => `${s.label} (${s.probability}%)`).join(' → ')} [overall: ${p.overallProbability}%]`)
 .join('\n');

  const query = `You are a financial contagion analyst. The systemic risk score is ${score}/100. Here are the current channel stress levels:\n\n${channelSummary}\n\nActive cascade paths:\n${pathSummary}\n\nProvide a 2-3 sentence assessment of the current financial contagion risk landscape. Focus on which cascade paths are most dangerous and what to watch for. Be specific and data-driven.`;

  try {
 const result = await runClaudeAgent(query);
 const narrative = result.response;
 cacheNarrative(narrative);
 return narrative;
  } catch {
 // AI unavailable — non-critical
 return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

let _lastModel: ContagionModel | null = null;

export async function getContagionModel(): Promise<ContagionModel> {
  let ecoData: EconomicStressData;
  try {
 ecoData = await fetchEconomicStress();
  } catch {
 if (_lastModel) return _lastModel;
 throw new Error('Economic stress data unavailable');
  }

  const history = loadHistory();
  const channels: ChannelStress[] = [];
  const stressMap = new Map<string, number>();

  // Compute measured channels
  for (const def of CHANNEL_DEFS) {
 try {
 const { stress, dataPoints } = def.compute(ecoData);
 const trend = computeTrend(def.id, stress, history);
 channels.push({ channel: def.label, stressLevel: Math.round(stress), trend, dataPoints });
 stressMap.set(def.id, stress);
 } catch {
 channels.push({ channel: def.label, stressLevel: 0, trend: 'stable' as const, dataPoints: [] });
 stressMap.set(def.id, 0);
 }
  }

  // Compute synthetic channels
  for (const [id, fn] of Object.entries(SYNTHETIC_STRESS)) {
 stressMap.set(id, fn(stressMap));
  }

  // Record history
  const histEntry: HistoryEntry = { ts: Date.now(), levels: {} };
  for (const [id, val] of stressMap) {
 histEntry.levels[id] = Math.round(val);
  }
  history.push(histEntry);
  saveHistory(history);

  // Cascade paths
  const cascadePaths = buildCascadePaths(stressMap);

  // Systemic risk score: weighted average of all channel stresses
  const allStresses = [...stressMap.values()];
  const systemicRiskScore = Math.round(allStresses.reduce((a, b) => a + b, 0) / allStresses.length);

  // AI narrative (non-blocking)
  const aiNarrative = await generateNarrative(channels, cascadePaths, systemicRiskScore);

  const model: ContagionModel = {
 channels,
 cascadePaths,
 systemicRiskScore,
 aiNarrative,
 updatedAt: new Date().toISOString(),
  };
  _lastModel = model;
  return model;
}

export function getChannelStress(): ChannelStress[] {
  return _lastModel?.channels ?? [];
}

export function getCascadePaths(): CascadePath[] {
  return _lastModel?.cascadePaths ?? [];
}

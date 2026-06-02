/**
 * Cross-Domain Threat Synthesis Service
 *
 * Bridges the gap between rule-based signal correlation (situation-correlator.ts)
 * and causal reasoning. Groups concurrent signals across domains (military,
 * economic, cyber, disaster) in the same region, then uses Claude Agent to
 * reason about WHY they are connected and what they mean together.
 *
 * Falls back to template-based synthesis using causal chain templates from
 * situation-forecaster.ts when AI is unavailable.
 */

import { situationEngine } from './situation-engine';
import { detectCompoundThreats } from './compound-threat';
import type { CompoundThreat, HazardSignal } from './compound-threat';
import type { Situation, SituationDomain, CausalTemplate } from './situation-types';
import { CAUSAL_TEMPLATES } from './situation-forecaster';
import { runClaudeAgent } from './claude-agent';
import { isFeatureAvailable } from './runtime-config';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EscalationRisk = 'low' | 'moderate' | 'high' | 'critical';

export interface CrossDomainCluster {
  /** Unique identifier for this cluster */
  id: string;
  /** Geographic region label */
  region: string;
  /** ISO country codes involved */
  countries: string[];
  /** Domains represented in this cluster */
  domains: SituationDomain[];
  /** Situation IDs contributing to this cluster */
  situationIds: string[];
  /** Compound threat IDs overlapping this cluster */
  compoundThreatIds: string[];
  /** Signal summaries grouped by domain */
  signalsByDomain: Record<string, string[]>;
  /** AI or template-generated causal hypothesis */
  causalHypothesis: string;
  /** Confidence in the causal link (0-1) */
  confidence: number;
  /** Cluster-level escalation risk */
  escalationRisk: EscalationRisk;
  /** Matched causal chain template, if any */
  matchedTemplate: string | null;
}

export interface SynthesisReport {
  /** Unique report ID */
  id: string;
  /** When this report was generated */
  timestamp: number;
  /** Cross-domain clusters identified */
  clusters: CrossDomainCluster[];
  /** Overall narrative assessment */
  overallAssessment: string;
  /** Aggregate escalation risk */
  escalationRisk: EscalationRisk;
  /** Hypothesized causal relationships */
  causalHypotheses: string[];
  /** Recommended actions for the user */
  recommendedActions: string[];
  /** Whether AI was used or template fallback */
  aiPowered: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_KEY = 'wm-threat-synthesis-v1';
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

const DOMAIN_LABELS: Record<SituationDomain, string> = {
  military: 'Military',
  economic: 'Economic',
  natural_hazard: 'Natural Hazard',
  cyber: 'Cyber',
  infrastructure: 'Infrastructure',
  health: 'Health',
  civil_unrest: 'Civil Unrest',
  compound: 'Compound',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
}

function maxRisk(...risks: EscalationRisk[]): EscalationRisk {
  const order: EscalationRisk[] = ['low', 'moderate', 'high', 'critical'];
  let max = 0;
  for (const r of risks) {
 const idx = order.indexOf(r);
 if (idx > max) max = idx;
  }
  return order[max] ?? 'low';
}

function confidenceToRisk(confidence: number, domainCount: number): EscalationRisk {
  const adjusted = confidence + (domainCount - 1) * 0.1;
  if (adjusted >= 0.8) return 'critical';
  if (adjusted >= 0.6) return 'high';
  if (adjusted >= 0.35) return 'moderate';
  return 'low';
}

function confidenceToSeverity(confidence: number): HazardSignal['severity'] {
  if (confidence >= 0.8) return 'critical';
  if (confidence >= 0.6) return 'high';
  if (confidence >= 0.35) return 'medium';
  return 'low';
}

// ── Region Grouping ──────────────────────────────────────────────────────────

/**
 * Group situations into region buckets by country overlap.
 *
 * When a situation carries ISO country codes, those are the bucket key so
 * mergeOverlappingRegions can join buckets that share a code.
 *
 * When geo.countries is empty (happens for many NWS / air-quality / local
 * situations that come in without ISO codes), fall back to a 5° spatial
 * grid key (≈ 550 km cells). This lets nearby situations without ISO codes
 * land in the same bucket and form cross-domain clusters — previously they
 * each got their own unique geo.label key and could never cluster together.
 */
function groupByRegion(situations: Situation[]): Map<string, Situation[]> {
  const regionMap = new Map<string, Situation[]>();
  for (const sit of situations) {
 if (sit.phase === 'resolved') continue;
 let key: string;
 if (sit.geo.countries.length > 0) {
 key = [...sit.geo.countries].sort((a, b) => a.localeCompare(b)).join(',');
 } else {
 // Snap to 5° grid so nearby country-codeless situations share a bucket
 const gridLat = Math.round(sit.geo.lat / 5) * 5;
 const gridLon = Math.round(sit.geo.lon / 5) * 5;
 key = `grid:${gridLat},${gridLon}`;
 }
 const bucket = regionMap.get(key);
 if (bucket) {
 bucket.push(sit);
 } else {
 regionMap.set(key, [sit]);
 }
  }
  return regionMap;
}

/** Merge region buckets that share any country code */
function mergeOverlappingRegions(regionMap: Map<string, Situation[]>): Situation[][] {
  const mergedGroups: Situation[][] = [];
  const processed = new Set<string>();

  for (const [key, sits] of regionMap) {
 if (processed.has(key)) continue;
 processed.add(key);
 const merged = [...sits];
 const countries = new Set(sits.flatMap(s => s.geo.countries));

 for (const [otherKey, otherSits] of regionMap) {
 if (processed.has(otherKey)) continue;
 const otherCountries = otherSits.flatMap(s => s.geo.countries);
 if (otherCountries.some(c => countries.has(c))) {
 merged.push(...otherSits);
 for (const c of otherCountries) countries.add(c);
 processed.add(otherKey);
 }
 }

 mergedGroups.push(merged);
  }
  return mergedGroups;
}

function sanitizeForPrompt(text: string): string {
  return text
    .replace(/[\n\r]/g, ' ')
    .replace(/`/g, "'")
    .replace(/\b(SYSTEM|ASSISTANT|USER|HUMAN|TOOL):/gi, '$1 -')
    .slice(0, 150);
}

/** Build the signal-by-domain summary map for a group of situations */
function buildSignalsByDomain(group: Situation[]): Record<string, string[]> {
  const signalsByDomain: Record<string, string[]> = {};
  for (const sit of group) {
 const domainLabel = DOMAIN_LABELS[sit.domain] ?? sit.domain;
 signalsByDomain[domainLabel] ??= [];
 signalsByDomain[domainLabel].push(sanitizeForPrompt(sit.title));
  }
  return signalsByDomain;
}

/** Build a single cluster from a group of situations */
function buildCluster(
  group: Situation[],
  compoundThreats: CompoundThreat[],
): CrossDomainCluster | null {
  const domains = [...new Set(group.map(s => s.domain))];
  if (domains.length < 2) return null;

  const countries = [...new Set(group.flatMap(s => s.geo.countries))];
  const region = group[0]?.geo.label ?? countries.join(', ') ?? 'Global';
  const signalsByDomain = buildSignalsByDomain(group);

  const compoundIds = compoundThreats
 .filter(ct => ct.hazardCategories.some(hc => domains.includes(hazardCategoryToDomain(hc))))
 .map(ct => ct.id);

  const avgConfidence = group.reduce((s, g) => s + g.confidence, 0) / group.length;
  const allSignalTypes = new Set(group.flatMap(s => s.signals.map(sig => sig.type)));
  const matchedTemplate = findBestTemplate(allSignalTypes);

  return {
 id: genId('cdc'),
 region,
 countries,
 domains,
 situationIds: group.map(s => s.id),
 compoundThreatIds: compoundIds,
 signalsByDomain,
 causalHypothesis: '', // filled by AI or template
 confidence: avgConfidence,
 escalationRisk: confidenceToRisk(avgConfidence, domains.length),
 matchedTemplate: matchedTemplate?.id ?? null,
  };
}

// ── Cluster Builder ───────────────────────────────────────────────────────────

/**
 * Group situations by geographic proximity into cross-domain clusters.
 * Only clusters with 2+ distinct domains are interesting for synthesis.
 */
function buildCrossDomainClusters(
  situations: Situation[],
  compoundThreats: CompoundThreat[],
): CrossDomainCluster[] {
  const regionMap = groupByRegion(situations);
  const mergedGroups = mergeOverlappingRegions(regionMap);

  const clusters: CrossDomainCluster[] = [];
  for (const group of mergedGroups) {
 const cluster = buildCluster(group, compoundThreats);
 if (cluster) clusters.push(cluster);
  }

  return clusters.sort((a, b) => {
 const riskOrder: EscalationRisk[] = ['critical', 'high', 'moderate', 'low'];
 return riskOrder.indexOf(a.escalationRisk) - riskOrder.indexOf(b.escalationRisk);
  });
}

function hazardCategoryToDomain(category: string): SituationDomain {
  const map: Record<string, SituationDomain> = {
 weather: 'natural_hazard',
 seismic: 'natural_hazard',
 wildfire: 'natural_hazard',
 flood: 'natural_hazard',
 industrial: 'infrastructure',
 nuclear: 'infrastructure',
 grid: 'infrastructure',
 cyber: 'cyber',
 disease: 'health',
 conflict: 'military',
 food: 'compound',
 maritime: 'infrastructure',
 air_quality: 'natural_hazard',
  };
  return map[category] ?? 'compound';
}

function findBestTemplate(signalTypes: Set<string>): CausalTemplate | null {
  let best: CausalTemplate | null = null;
  let bestScore = 0;

  for (const template of CAUSAL_TEMPLATES) {
 const chainTypes = template.links.map(l => l.triggerType);
 const matched = chainTypes.filter(t => signalTypes.has(t)).length;
 const coverage = matched / chainTypes.length;
 if (coverage > bestScore && coverage >= 0.3) {
 bestScore = coverage;
 best = template;
 }
  }
  return best;
}

// ── AI Synthesis ──────────────────────────────────────────────────────────────

function buildAIPrompt(clusters: CrossDomainCluster[]): string {
  const clusterDescriptions = clusters.map((c, i) => {
 const domainLines = Object.entries(c.signalsByDomain)
 .map(([domain, signals]) => `  ${domain}: ${signals.join('; ')}`)
 .join('\n');
 return `Cluster ${i + 1} — ${c.region} (${c.domains.join(', ')}):
${domainLines}
  Confidence: ${(c.confidence * 100).toFixed(0)}%
  Matched template: ${c.matchedTemplate ?? 'none'}`;
  }).join('\n\n');

  return `Analyze these concurrent cross-domain signal clusters detected by Crystal Ball. Identify causal relationships, assess whether this represents coordinated activity, and rate the combined threat level.

${clusterDescriptions}

For each cluster, provide:
1. A causal hypothesis explaining WHY these signals across different domains might be connected
2. Whether this looks like coordinated activity or coincidence
3. Escalation risk rating (low/moderate/high/critical)

Then provide:
- An overall assessment paragraph
- A list of recommended actions for a global risk analyst

Be concise and analytical. Focus on actionable insight.`;
}

interface AIAnalysis {
  clusterHypotheses: string[];
  overallAssessment: string;
  escalationRisk: EscalationRisk;
  causalHypotheses: string[];
  recommendedActions: string[];
}

async function runAISynthesis(clusters: CrossDomainCluster[]): Promise<AIAnalysis | null> {
  if (!isFeatureAvailable('aiClaude')) return null;
  if (clusters.length === 0) return null;

  try {
 const prompt = buildAIPrompt(clusters);
 const result = await runClaudeAgent(prompt);
 return parseAIResponse(result.response, clusters.length);
  } catch {
 return null;
  }
}

/** Extract per-cluster hypotheses from AI response text */
function extractClusterHypotheses(text: string, clusterCount: number): string[] {
  const hypotheses: string[] = [];
  const lower = text.toLowerCase();
  for (let i = 1; i <= clusterCount; i++) {
 const marker = `cluster ${i}`;
 const start = lower.indexOf(marker);
 if (start === -1) { hypotheses.push(''); continue; }
 const nextMarker = i < clusterCount ? `cluster ${i + 1}` : 'overall';
 const end = lower.indexOf(nextMarker, start + marker.length);
 const slice = end === -1 ? text.slice(start + marker.length) : text.slice(start + marker.length, end);
 hypotheses.push(slice.trim().slice(0, 500));
  }
  return hypotheses;
}

/** Extract overall assessment section from AI response */
function extractOverallAssessment(text: string): string {
  const lower = text.toLowerCase();
  const start = lower.indexOf('overall');
  if (start === -1) return text.slice(0, 500);
  const recIdx = lower.indexOf('recommend', start);
  const actIdx = lower.indexOf('action', start);
  const end = Math.min(
 recIdx === -1 ? text.length : recIdx,
 actIdx === -1 ? text.length : actIdx,
  );
  return text.slice(start + 'overall'.length, end).trim().slice(0, 1000);
}

/** Extract recommended actions list from AI response */
function extractActions(text: string): string[] {
  const lower = text.toLowerCase();
  const start = lower.indexOf('recommend');
  const actionsText = start === -1 ? '' : text.slice(start + 'recommend'.length);
  return actionsText
 .split(/\n/)
 .map(l => l.replace(/^[-*\d.)\s]+/, '').trim())
 .filter(l => l.length > 10)
 .slice(0, 8);
}

function parseAIResponse(text: string, clusterCount: number): AIAnalysis {
  const clusterHypotheses = extractClusterHypotheses(text, clusterCount);
  const overallAssessment = extractOverallAssessment(text);
  const recommendedActions = extractActions(text);

  // Determine risk from text
  const riskMatch = /\b(critical|high|moderate|low)\b/i.exec(text);
  const escalationRisk = (riskMatch?.[1]?.toLowerCase() as EscalationRisk) ?? 'moderate';

  // Extract causal hypotheses
  const causalHypotheses = text
 .split(/[.\n]/)
 .filter(s => /because|due to|suggests|indicates|driven by|caused by|linked to|coordinated/i.test(s))
 .map(s => s.trim())
 .filter(s => s.length > 20 && s.length < 300)
 .slice(0, 6);

  return {
 clusterHypotheses,
 overallAssessment,
 escalationRisk,
 causalHypotheses: causalHypotheses.length > 0 ? causalHypotheses : ['No clear causal links identified by AI'],
 recommendedActions: recommendedActions.length > 0 ? recommendedActions : ['Continue monitoring cross-domain signal convergence'],
  };
}

// ── Template Fallback ─────────────────────────────────────────────────────────

function synthesizeClusterFromTemplate(cluster: CrossDomainCluster): {
  hypothesis: string;
  causal: string;
  actions: string[];
} {
  const template = cluster.matchedTemplate
 ? CAUSAL_TEMPLATES.find(t => t.id === cluster.matchedTemplate)
 : null;

  if (template) {
 const chainDesc = template.links.map(l => l.label).join(' \u2192 ');
 return {
 hypothesis: `${cluster.region}: Matches "${template.name}" pattern \u2014 ${chainDesc}.`,
 causal: `${template.name} chain detected in ${cluster.region}`,
 actions: template.actionTemplates.map(a => a.headline),
 };
  }

  const domainList = cluster.domains.join(', ');
  return {
 hypothesis:
 `${cluster.region}: Concurrent ${domainList} signals detected. ` +
 `Cross-domain convergence at ${(cluster.confidence * 100).toFixed(0)}% confidence ` +
 `may indicate interconnected developments requiring monitoring.`,
 causal: `Unclassified cross-domain convergence (${domainList}) in ${cluster.region}`,
 actions: [],
  };
}

function buildTemplateAssessment(clusters: CrossDomainCluster[]): string {
  if (clusters.length === 0) {
 return 'No cross-domain threat clusters detected. Individual domain situations are tracked in the Situation Awareness panel.';
  }
  const clusterSummaries = clusters.map(c =>
 `${c.region} (${c.domains.join('+')}): ${c.escalationRisk} risk`
  ).join('; ');
  const plural = clusters.length === 1 ? '' : 's';
  return (
 `Template-based analysis identified ${clusters.length} cross-domain cluster${plural}: ${clusterSummaries}. ` +
 `AI synthesis unavailable \u2014 causal reasoning is based on historical chain templates. ` +
 `Enable Claude API for deeper analysis.`
  );
}

function templateSynthesis(clusters: CrossDomainCluster[]): AIAnalysis {
  const clusterHypotheses: string[] = [];
  const allCausal: string[] = [];
  const allActions: string[] = [];
  let worstRisk: EscalationRisk = 'low';

  for (const cluster of clusters) {
 const result = synthesizeClusterFromTemplate(cluster);
 clusterHypotheses.push(result.hypothesis);
 allCausal.push(result.causal);
 allActions.push(...result.actions);
 worstRisk = maxRisk(worstRisk, cluster.escalationRisk);
  }

  if (allActions.length === 0) {
 allActions.push('Monitor cross-domain convergence for escalation patterns');
  }

  return {
 clusterHypotheses,
 overallAssessment: buildTemplateAssessment(clusters),
 escalationRisk: worstRisk,
 causalHypotheses: allCausal.length > 0 ? allCausal : ['No known causal patterns matched'],
 recommendedActions: [...new Set(allActions)].slice(0, 8),
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function cacheReport(report: SynthesisReport): void {
  try {
 localStorage.setItem(CACHE_KEY, JSON.stringify(report));
  } catch { /* quota or private mode */ }
}

export function getCachedSynthesis(): SynthesisReport | null {
  try {
 const raw = localStorage.getItem(CACHE_KEY);
 if (!raw) return null;
 const report = JSON.parse(raw) as SynthesisReport;
 if (Date.now() - report.timestamp > CACHE_TTL_MS) {
 localStorage.removeItem(CACHE_KEY);
 return null;
 }
 return report;
  } catch {
 return null;
  }
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Collect hazard signals from current situations for compound threat detection.
 * This bridges situation-engine data into the compound-threat detector format.
 */
function situationsToHazardSignals(situations: Situation[]): HazardSignal[] {
  const signals: HazardSignal[] = [];
  const domainToCategory: Record<string, HazardSignal['category']> = {
 military: 'conflict',
 natural_hazard: 'weather',
 cyber: 'cyber',
 infrastructure: 'grid',
 health: 'disease',
 civil_unrest: 'conflict',
  };

  for (const sit of situations) {
 if (sit.phase === 'resolved') continue;
 const category = domainToCategory[sit.domain];
 if (!category) continue;

 signals.push({
 id: `sit-${sit.id}`,
 category,
 severity: confidenceToSeverity(sit.confidence),
 lat: sit.geo.lat,
 lon: sit.geo.lon,
 label: sit.title,
 sourceService: 'situation-engine',
 });
  }

  return signals;
}

/**
 * Run full cross-domain threat synthesis.
 *
 * 1. Collects active situations from the situation engine
 * 2. Detects compound threats from hazard signals
 * 3. Groups cross-domain clusters by geography
 * 4. Sends to Claude Agent for causal analysis (or falls back to templates)
 * 5. Returns a SynthesisReport with clusters, hypotheses, and actions
 */
export async function synthesizeThreats(): Promise<SynthesisReport> {
  const situations = situationEngine.getSituations();
  const hazardSignals = situationsToHazardSignals(situations);
  const compoundThreats = detectCompoundThreats(hazardSignals);

  // Build cross-domain clusters
  const clusters = buildCrossDomainClusters(situations, compoundThreats);

  // Try AI synthesis, fall back to templates
  let analysis = await runAISynthesis(clusters);
  const aiPowered = analysis !== null;

  analysis ??= templateSynthesis(clusters);

  // Enrich clusters with hypotheses
  for (const [i, cluster] of clusters.entries()) {
 if (!cluster) continue;
 cluster.causalHypothesis = analysis.clusterHypotheses[i] ?? '';

 // AI may override risk assessment
 if (aiPowered && analysis.escalationRisk) {
 cluster.escalationRisk = maxRisk(cluster.escalationRisk, analysis.escalationRisk);
 }
  }

  const report: SynthesisReport = {
 id: genId('syn'),
 timestamp: Date.now(),
 clusters,
 overallAssessment: analysis.overallAssessment,
 escalationRisk: analysis.escalationRisk,
 causalHypotheses: analysis.causalHypotheses,
 recommendedActions: analysis.recommendedActions,
 aiPowered,
  };

  cacheReport(report);
  return report;
}

// ── Space-time clustering + warm-up baseline (additive helpers) ─────────────
//
// These complement the existing country-set merge in buildCrossDomainClusters
// without replacing it. They surface clusters that don't share country tags
// (open-ocean cyclones, global IP-range cyber, etc.) by grouping situations
// that fall within a temporal × spatial window. The baseline tracker tells
// callers whether the per-region anomaly ratio has accumulated enough
// observations to be trustworthy ("warm").

export const THEATER_TEMPORAL_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h
export const THEATER_SPATIAL_MAX_KM = 500;
export const BASELINE_WARMUP_THRESHOLD = 5;

const BASELINE_KEY = 'crystalball-threat-synthesis-baseline-v1';
const BASELINE_CYCLES_KEY = 'crystalball-threat-synthesis-baseline-cycles-v1';
const BASELINE_HALFLIFE_MS = 24 * 60 * 60 * 1000;
const EARTH_RADIUS_KM = 6371;

export interface TheaterClusterOptions {
  temporalWindowMs?: number;
  spatialMaxKm?: number;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shareTheater(a: Situation, b: Situation, opts: Required<TheaterClusterOptions>): boolean {
  if (a.geo.countries.some(c => b.geo.countries.includes(c))) return true;

  const dt = Math.abs((a.lastUpdated ?? a.firstSeen) - (b.lastUpdated ?? b.firstSeen));
  if (dt > opts.temporalWindowMs) return false;

  if (
 typeof a.geo.lat !== 'number' || typeof a.geo.lon !== 'number'
 || typeof b.geo.lat !== 'number' || typeof b.geo.lon !== 'number'
  ) return false;

  return haversineKm(a.geo.lat, a.geo.lon, b.geo.lat, b.geo.lon) <= opts.spatialMaxKm;
}

/**
 * Union-find clustering of situations that fall in the same theater.
 * Two situations share a theater when they share a country code, OR are
 * within {@link THEATER_SPATIAL_MAX_KM} of each other AND their last-updated
 * timestamps fall within {@link THEATER_TEMPORAL_WINDOW_MS}. The temporal
 * window prevents stale archive items from dragging fresh incidents into a
 * giant catch-all cluster.
 *
 * Resolved situations are excluded.
 */
export function clusterByTimeSpace(
  situations: Situation[],
  options: TheaterClusterOptions = {},
): Situation[][] {
  const opts: Required<TheaterClusterOptions> = {
 temporalWindowMs: options.temporalWindowMs ?? THEATER_TEMPORAL_WINDOW_MS,
 spatialMaxKm: options.spatialMaxKm ?? THEATER_SPATIAL_MAX_KM,
  };
  const active = situations.filter(s => s.phase !== 'resolved');
  const parent = active.map((_, i) => i);
  const find = (i: number): number => {
 let root = i;
 while (parent[root] !== root) root = parent[root]!;
 while (parent[i] !== root) {
 const next = parent[i]!;
 parent[i] = root;
 i = next;
 }
 return root;
  };
  const union = (i: number, j: number): void => {
 const ri = find(i);
 const rj = find(j);
 if (ri !== rj) parent[ri] = rj;
  };

  for (let i = 0; i < active.length; i++) {
 for (let j = i + 1; j < active.length; j++) {
 const a = active[i];
 const b = active[j];
 if (!a || !b) continue;
 if (shareTheater(a, b, opts)) union(i, j);
 }
  }

  const groupsByRoot = new Map<number, Situation[]>();
  for (const [i, sit] of active.entries()) {
 if (!sit) continue;
 const root = find(i);
 const bucket = groupsByRoot.get(root);
 if (bucket) bucket.push(sit);
 else groupsByRoot.set(root, [sit]);
  }
  return [...groupsByRoot.values()];
}

/**
 * Public-facing alias for {@link clusterByTimeSpace}. Reads naturally at
 * call sites: `groupByTheater(situationEngine.getSituations())`.
 */
export function groupByTheater(
  situations: Situation[],
  options: TheaterClusterOptions = {},
): Situation[][] {
  return clusterByTimeSpace(situations, options);
}

// ── Counterfactual baseline (signal-density warm-up tracker) ──────────────

interface BaselineEntry {
  rollingCount: number;
  lastUpdated: number;
}
type BaselineMap = Record<string, BaselineEntry>;

function loadBaseline(): BaselineMap {
  try {
 const raw = localStorage.getItem(BASELINE_KEY);
 if (!raw) return {};
 return JSON.parse(raw) as BaselineMap;
  } catch {
 return {};
  }
}

function saveBaseline(map: BaselineMap): void {
  try {
 localStorage.setItem(BASELINE_KEY, JSON.stringify(map));
  } catch { /* quota or private mode */ }
}

function regionKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
}

function readBaselineCycles(): number {
  try {
 const raw = localStorage.getItem(BASELINE_CYCLES_KEY);
 const parsed = raw ? Number.parseInt(raw, 10) : 0;
 return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
 return 0;
  }
}

function incrementBaselineCycles(): void {
  try {
 localStorage.setItem(BASELINE_CYCLES_KEY, String(readBaselineCycles() + 1));
  } catch { /* quota or private mode */ }
}

/**
 * Decay-adjusted observed/baseline ratio for a region. Returns 1 when the
 * baseline has too few samples to compare against (caller treats 1 as "no
 * amplification"). Use {@link warmupStatus} to gate on warm baselines.
 */
export function threatBaselineAnomaly(region: string, count: number): number {
  const map = loadBaseline();
  const entry = map[regionKey(region)];
  if (!entry || entry.rollingCount <= 0.5) return 1;
  const decay = Math.exp(-(Date.now() - entry.lastUpdated) / BASELINE_HALFLIFE_MS);
  const decayed = entry.rollingCount * decay;
  return decayed > 0 ? count / decayed : 1;
}

/**
 * Update the baseline tracker with the current cycle's groups. Each group's
 * region key gets an EMA-smoothed rolling count (α = 0.3, decayed by 1-day
 * half-life). Increments the cycle counter so {@link warmupStatus} can
 * surface progress toward {@link BASELINE_WARMUP_THRESHOLD}.
 */
export function recordThreatBaseline(groups: Situation[][]): void {
  const map = loadBaseline();
  const now = Date.now();
  for (const group of groups) {
 const first = group[0];
 if (!first) continue;
 const region = first.geo.label || first.geo.countries.join(',') || 'global';
 const key = regionKey(region);
 const prev = map[key];
 if (prev) {
 const decay = Math.exp(-(now - prev.lastUpdated) / BASELINE_HALFLIFE_MS);
 map[key] = {
 rollingCount: prev.rollingCount * decay * 0.7 + group.length * 0.3,
 lastUpdated: now,
 };
 } else {
 map[key] = { rollingCount: group.length, lastUpdated: now };
 }
  }
  saveBaseline(map);
  if (groups.length > 0) incrementBaselineCycles();
}

export interface WarmupStatus {
  cycles: number;
  threshold: number;
  warm: boolean;
}

/**
 * Whether the counterfactual baseline has accumulated enough observations
 * to produce reliable anomaly ratios. UIs gate "anomaly" badges on `warm`
 * and surface `cycles / threshold` while the baseline calibrates.
 */
export function warmupStatus(): WarmupStatus {
  const cycles = readBaselineCycles();
  return {
 cycles,
 threshold: BASELINE_WARMUP_THRESHOLD,
 warm: cycles >= BASELINE_WARMUP_THRESHOLD,
  };
}

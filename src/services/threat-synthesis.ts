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

/** Group situations into region buckets by country overlap */
function groupByRegion(situations: Situation[]): Map<string, Situation[]> {
  const regionMap = new Map<string, Situation[]>();
  for (const sit of situations) {
 if (sit.phase === 'resolved') continue;
 const key = sit.geo.countries.length > 0
 ? [...sit.geo.countries].sort((a, b) => a.localeCompare(b)).join(',')
 : sit.geo.label ?? 'global';
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

/** Build the signal-by-domain summary map for a group of situations */
function buildSignalsByDomain(group: Situation[]): Record<string, string[]> {
  const signalsByDomain: Record<string, string[]> = {};
  for (const sit of group) {
 const domainLabel = DOMAIN_LABELS[sit.domain] ?? sit.domain;
 signalsByDomain[domainLabel] ??= [];
 signalsByDomain[domainLabel].push(sit.title);
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

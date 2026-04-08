/**
 * Situation Correlator — Clusters weak signals into named Situations
 *
 * Clustering strategy:
 * 1. Geographic proximity (signals in the same ~500km region)
 * 2. Temporal proximity (signals within 6h window)
 * 3. Domain affinity (same domain signals cluster, cross-domain elevates)
 * 4. Entity overlap (shared countries, keywords, or actors)
 * 5. Causal chain matching (known escalation patterns)
 */

import type { CorrelationSignalCore } from './analysis-core';
import type {
  Situation,
  SituationDomain,
  SituationGeo,
  SituationPhase,
  SituationSignalSnapshot,
  SituationEngineConfig,
  CausalTemplate,
} from './situation-types';
import { SIGNAL_DOMAIN_MAP, DEFAULT_ENGINE_CONFIG } from './situation-types';
import { CAUSAL_TEMPLATES } from './situation-forecaster';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
const genId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;

// ── Signal → Domain ──────────────────────────────────────────────────────────

export function classifyDomain(signalType: string): SituationDomain {
  return SIGNAL_DOMAIN_MAP[signalType] ?? 'compound';
}

// ── Signal → Geo ─────────────────────────────────────────────────────────────

interface SignalGeo {
  lat: number;
  lon: number;
  countries: string[];
  label: string;
}

export function extractSignalGeo(signal: CorrelationSignalCore): SignalGeo | null {
  const d = signal.data;

  // Try placeIds → country codes
  const countries = d.placeIds?.filter((p: string) => /^[A-Z]{3}$/.test(p)) ?? [];
  const label = d.placeSummary ?? countries.join(', ') ?? '';

  // Some signals carry lat/lon directly via correlatedEntities or placeIds
  // For now, return country-level info; geo-convergence signals carry cell coords
  if (countries.length > 0) {
 return { lat: 0, lon: 0, countries, label };
  }
  return null;
}

// ── Affinity Scoring ─────────────────────────────────────────────────────────

interface AffinityResult {
  score: number;
  geoMatch: boolean;
  domainMatch: boolean;
  entityOverlap: number;
  temporalProximity: number;
}

function computeAffinity(
  signal: CorrelationSignalCore,
  situation: Situation,
  config: SituationEngineConfig,
): AffinityResult {
  let score = 0;

  // 1. Geographic proximity
  const geo = extractSignalGeo(signal);
  let geoMatch = false;
  if (geo && geo.countries.length > 0) {
 const countryOverlap = geo.countries.filter(c => situation.geo.countries.includes(c));
 if (countryOverlap.length > 0) {
 geoMatch = true;
 score += 0.35;
 }
  }

  // 2. Temporal proximity (exponential decay over cluster window)
  const signalTs = signal.timestamp instanceof Date ? signal.timestamp.getTime() : signal.timestamp;
  const age = Math.abs(signalTs - situation.lastUpdated);
  const temporalProximity = Math.max(0, 1 - age / config.clusterWindowMs);
  score += temporalProximity * 0.25;

  // 3. Domain affinity
  const signalDomain = classifyDomain(signal.type);
  const domainMatch = signalDomain === situation.domain || signalDomain === 'compound';
  if (domainMatch) {
 score += 0.2;
  } else {
 // Cross-domain signals are weaker match but more significant if they match
 score += 0.05;
  }

  // 4. Entity/keyword overlap
  const signalEntities = new Set([
 ...(signal.data.relatedTopics ?? []),
 ...(signal.data.correlatedEntities ?? []),
 ...(signal.data.placeIds ?? []),
  ].map((s: string) => s.toLowerCase()));

  const situationEntities = new Set(
 situation.signals.flatMap(s => [s.type, ...situation.geo.countries])
 .map(s => s.toLowerCase()),
  );

  let entityOverlap = 0;
  for (const e of signalEntities) {
 if (situationEntities.has(e)) entityOverlap++;
  }
  if (entityOverlap > 0) {
 score += Math.min(0.2, entityOverlap * 0.07);
  }

  return { score, geoMatch, domainMatch, entityOverlap, temporalProximity };
}

// ── Situation Title Generation ───────────────────────────────────────────────

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

function generateTitle(domain: SituationDomain, geo: SituationGeo, signals: SituationSignalSnapshot[]): string {
  const location = geo.label || 'Global';
  const domainLabel = DOMAIN_LABELS[domain];

  // Use the highest-confidence signal's title as a hint
  const top = signals.sort((a, b) => b.confidence - a.confidence)[0];
  if (top && top.title.length < 80) {
 return top.title;
  }
  return `${domainLabel} Situation — ${location}`;
}

function generateSummary(signals: SituationSignalSnapshot[], domain: SituationDomain): string {
  const types = [...new Set(signals.map(s => s.type))];
  const count = signals.length;
  return `${count} correlated ${DOMAIN_LABELS[domain].toLowerCase()} signal${count === 1 ? '' : 's'} detected: ${types.slice(0, 3).join(', ')}${types.length > 3 ? ` (+${types.length - 3} more)` : ''}.`;
}

// ── Situation Phase Logic ────────────────────────────────────────────────────

export function computePhase(
  situation: Situation,
  config: SituationEngineConfig,
  now: number,
): SituationPhase {
  const timeSinceUpdate = now - situation.lastUpdated;

  // Resolution: been de-escalating long enough
  if (situation.phase === 'de-escalating' && timeSinceUpdate > config.resolutionTimeoutMs) {
 return 'resolved';
  }

  // De-escalation: no new signals for timeout period
  if (timeSinceUpdate > config.deescalationTimeoutMs && situation.phase !== 'resolved') {
 return 'de-escalating';
  }

  // Active: high confidence
  if (situation.confidence >= config.activeThreshold) {
 return 'active';
  }

  // Developing: moderate confidence
  if (situation.confidence >= config.developingThreshold) {
 return 'developing';
  }

  return 'emerging';
}

// ── Confidence Computation ───────────────────────────────────────────────────

export function computeSituationConfidence(signals: SituationSignalSnapshot[]): number {
  if (signals.length === 0) return 0;

  // Base: weighted average of signal confidences
  const totalWeight = signals.reduce((sum, s) => sum + s.confidence, 0);
  const avgConfidence = totalWeight / signals.length;

  // Source diversity bonus: more distinct signal types = higher confidence
  const uniqueTypes = new Set(signals.map(s => s.type)).size;
  const diversityBonus = Math.min(0.2, (uniqueTypes - 1) * 0.05);

  // Domain diversity bonus: cross-domain corroboration is very strong
  const uniqueDomains = new Set(signals.map(s => s.domain)).size;
  const crossDomainBonus = uniqueDomains >= 2 ? 0.15 : 0;

  // Volume bonus: more signals = slightly more confident (diminishing returns)
  const volumeBonus = Math.min(0.1, Math.log2(signals.length) * 0.03);

  return Math.min(1, avgConfidence + diversityBonus + crossDomainBonus + volumeBonus);
}

// ── Causal Chain Matching ────────────────────────────────────────────────────

export function matchCausalChain(signals: SituationSignalSnapshot[]): CausalTemplate | null {
  const signalTypes = new Set(signals.map(s => s.type));

  let bestMatch: CausalTemplate | null = null;
  let bestScore = 0;

  for (const template of CAUSAL_TEMPLATES) {
 const chainTypes = template.links.map(l => l.triggerType);
 const matched = chainTypes.filter(t => signalTypes.has(t)).length;
 const coverage = matched / chainTypes.length;
 if (coverage > bestScore && coverage >= 0.4) {
 bestScore = coverage;
 bestMatch = template;
 }
  }
  return bestMatch;
}

// ── Main Correlator API ──────────────────────────────────────────────────────

export function correlateSignalToSituation(
  signal: CorrelationSignalCore,
  existingSituations: Situation[],
  config: SituationEngineConfig = DEFAULT_ENGINE_CONFIG,
): { situationId: string; isNew: boolean } {
  const now = Date.now();
  const signalTs = signal.timestamp instanceof Date ? signal.timestamp.getTime() : Number(signal.timestamp);
  const signalDomain = classifyDomain(signal.type);
  const signalGeo = extractSignalGeo(signal);

  // Find best matching active situation
  let bestSituation: Situation | null = null;
  let bestAffinity = 0;

  for (const sit of existingSituations) {
 if (sit.phase === 'resolved') continue;
 const affinity = computeAffinity(signal, sit, config);
 if (affinity.score > bestAffinity && affinity.score >= 0.3) {
 bestAffinity = affinity.score;
 bestSituation = sit;
 }
  }

  const snapshot: SituationSignalSnapshot = {
 id: signal.id,
 type: signal.type,
 title: signal.data.explanation ?? `${signal.type} signal`,
 confidence: signal.confidence,
 timestamp: signalTs,
 domain: signalDomain,
  };

  if (bestSituation) {
 // Merge into existing situation
 if (!bestSituation.signalIds.includes(signal.id)) {
 bestSituation.signalIds.push(signal.id);
 bestSituation.signals.push(snapshot);
 }
 bestSituation.lastUpdated = now;

 // Recompute
 bestSituation.confidence = computeSituationConfidence(bestSituation.signals);
 bestSituation.domainDiversity = new Set(bestSituation.signals.map(s => s.domain)).size;
 bestSituation.phase = computePhase(bestSituation, config, now);
 bestSituation.summary = generateSummary(bestSituation.signals, bestSituation.domain);

 // Update geo if new countries discovered
 if (signalGeo) {
 for (const c of signalGeo.countries) {
 if (!bestSituation.geo.countries.includes(c)) {
 bestSituation.geo.countries.push(c);
 }
 }
 if (!bestSituation.geo.label && signalGeo.label) {
 bestSituation.geo.label = signalGeo.label;
 }
 }

 // Check causal chain match
 const chain = matchCausalChain(bestSituation.signals);
 if (chain) bestSituation.causalChainId = chain.id;

 bestSituation.reassessmentCount++;
 return { situationId: bestSituation.id, isNew: false };
  }

  // Create new situation
  const geo: SituationGeo = signalGeo
 ? { lat: signalGeo.lat, lon: signalGeo.lon, label: signalGeo.label, countries: signalGeo.countries, radiusKm: config.clusterRadiusKm }
 : { lat: 0, lon: 0, label: 'Global', countries: [], radiusKm: config.clusterRadiusKm };

  const domain = signalDomain === 'compound' ? 'compound' : signalDomain;
  const newSituation: Situation = {
 id: genId('sit'),
 title: generateTitle(domain, geo, [snapshot]),
 summary: generateSummary([snapshot], domain),
 phase: 'emerging',
 domain,
 confidence: signal.confidence,
 geo,
 signalIds: [signal.id],
 signals: [snapshot],
 domainDiversity: 1,
 evidence: null,
 scenarios: [],
 actions: [],
 causalChainId: null,
 firstSeen: now,
 lastUpdated: now,
 reassessmentCount: 0,
  };

  const chain = matchCausalChain([snapshot]);
  if (chain) newSituation.causalChainId = chain.id;

  existingSituations.push(newSituation);

  // Prune if over max
  if (existingSituations.length > config.maxSituations) {
 // Remove oldest resolved, then oldest de-escalating
 const prunable = existingSituations
 .filter(s => s.phase === 'resolved' || s.phase === 'de-escalating')
 .sort((a, b) => a.lastUpdated - b.lastUpdated);
 const toPrune = prunable[0];
 if (toPrune) {
 const idx = existingSituations.indexOf(toPrune);
 if (idx >= 0) existingSituations.splice(idx, 1);
 }
  }

  return { situationId: newSituation.id, isNew: true };
}

/**
 * Reassess all situations: update phases, prune resolved.
 * Called on the reassessment interval.
 */
export function reassessSituations(
  situations: Situation[],
  config: SituationEngineConfig = DEFAULT_ENGINE_CONFIG,
): Situation[] {
  const now = Date.now();
  for (const sit of situations) {
 sit.phase = computePhase(sit, config, now);
 sit.reassessmentCount++;
  }
  // Remove long-resolved situations (resolved > 1h ago)
  return situations.filter(
 s => s.phase !== 'resolved' || (now - s.lastUpdated) < 60 * 60 * 1000,
  );
}

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
import { SIGNAL_DOMAIN_MAP, DEFAULT_ENGINE_CONFIG, situationReportedPoint, validSituationPoint } from './situation-types';
import { CAUSAL_TEMPLATES } from './situation-forecaster';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
export const newSituationId = (prefix = 'sit') => `${prefix}-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;

// ── Signal → Domain ──────────────────────────────────────────────────────────

export function classifyDomain(signalType: string): SituationDomain {
  return SIGNAL_DOMAIN_MAP[signalType] ?? 'compound';
}

// ── Signal → Geo ─────────────────────────────────────────────────────────────

const SITUATION_DOMAINS: ReadonlySet<string> = new Set<SituationDomain>([
  'military', 'economic', 'natural_hazard', 'cyber',
  'infrastructure', 'health', 'civil_unrest', 'compound',
]);

export function signalDomainOf(signal: CorrelationSignalCore): SituationDomain {
  const hint = signal.data.domainHint;
  return hint && SITUATION_DOMAINS.has(hint) ? hint as SituationDomain : classifyDomain(signal.type);
}

export function extractSignalGeo(signal: CorrelationSignalCore): SituationGeo {
  const supplied = signal.data.geo;
  if (supplied) return supplied;
  const countries = signal.data.placeIds?.filter(p => /^[A-Z]{3}$/.test(p)) ?? [];
  return { kind: countries.length ? 'country' : 'unknown', countries,
    label: signal.data.placeSummary ?? countries.join(', '), radiusKm: 0 };
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

const NON_ENTITY_TOKENS = new Set([...SITUATION_DOMAINS, ...Object.keys(SIGNAL_DOMAIN_MAP), 'global', 'unknown']);

function signalEntities(signal: CorrelationSignalCore): string[] {
  return [...new Set([...(signal.data.relatedTopics ?? []), ...(signal.data.correlatedEntities ?? []),
    ...(signal.data.placeIds ?? [])].map(e => e.trim().toLowerCase()))]
    .filter(e => e.length > 0 && !NON_ENTITY_TOKENS.has(e));
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
  const signalPoint = situationReportedPoint(geo);
  const situationPoint = situationReportedPoint(situation.geo);
  if (signalPoint && situationPoint) {
    geoMatch = distanceKm(signalPoint, situationPoint) <= config.clusterRadiusKm;
  } else if (geo.kind === 'country' && situation.geo.kind === 'country') {
    geoMatch = geo.countries.some(c => situation.geo.countries.includes(c));
  }
  if (geoMatch) score += 0.35;

  // 2. Temporal proximity (exponential decay over cluster window)
  const signalTs = signal.timestamp instanceof Date ? signal.timestamp.getTime() : signal.timestamp;
  const age = situation.latestEventAt === null ? Infinity : Math.abs(signalTs - situation.latestEventAt);
  const temporalProximity = Number.isFinite(age) ? Math.max(0, 1 - age / config.clusterWindowMs) : 0;
  score += temporalProximity * 0.25;

  // 3. Domain affinity
  const signalDomain = signalDomainOf(signal);
  const domainMatch = signalDomain === situation.domain || signalDomain === 'compound';
  score += domainMatch ? 0.2 : 0.05;

  // 4. Entity/keyword overlap
  const incomingEntities = new Set(signalEntities(signal));

  const situationEntities = new Set(
 situation.signals.flatMap(s => s.entities ?? [])
 .map(s => s.toLowerCase()),
  );

  let entityOverlap = 0;
  for (const e of incomingEntities) {
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
  const top = [...signals].sort((a, b) => b.confidence - a.confidence)[0];
  if (top && top.title.length < 80) {
 return top.title;
  }
  return `${domainLabel} Situation — ${location}`;
}

function generateSummary(signals: SituationSignalSnapshot[], domain: SituationDomain): string {
  const types = [...new Set(signals.map(s => s.type))];
  const count = signals.length;
  const more = types.length > 3 ? ` (+${types.length - 3} more)` : '';
  return `${count} correlated ${DOMAIN_LABELS[domain].toLowerCase()} signal${count === 1 ? '' : 's'} detected: ${types.slice(0, 3).join(', ')}${more}.`;
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

  if (situation.legacyUnverified) return 'emerging';

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

  // Majority domain of the signal set — used to penalise cross-domain template matches.
  const domainCounts: Partial<Record<SituationDomain, number>> = {};
  for (const s of signals) {
    const d = s.domain ?? classifyDomain(s.type);
    domainCounts[d] = (domainCounts[d] ?? 0) + 1;
  }
  let majorityDomain: SituationDomain = 'compound';
  let maxCount = 0;
  for (const [d, n] of Object.entries(domainCounts) as [SituationDomain, number][]) {
    if (n > maxCount) { maxCount = n; majorityDomain = d; }
  }

  let bestMatch: CausalTemplate | null = null;
  let bestScore = 0;

  for (const template of CAUSAL_TEMPLATES) {
    const chainTypes = template.links.map(l => l.triggerType);
    const matched = chainTypes.filter(t => signalTypes.has(t)).length;
    let coverage = matched / chainTypes.length;
    // Penalise templates whose domain conflicts with the signal majority
    if (template.domain !== 'compound' && template.domain !== majorityDomain && majorityDomain !== 'compound') {
      coverage *= 0.3;
    }
    if (coverage > bestScore && coverage >= 0.4) {
      bestScore = coverage;
      bestMatch = template;
    }
  }
  return bestMatch;
}

// ── Main Correlator API ──────────────────────────────────────────────────────

function snapshotFor(signal: CorrelationSignalCore): SituationSignalSnapshot {
  return {
    id: signal.id, type: signal.type, title: signal.data.explanation ?? signal.title,
    confidence: signal.confidence, timestamp: signal.timestamp.getTime(), domain: signalDomainOf(signal),
    identity: signal.data.identity, source: signal.data.source,
    entities: signalEntities(signal),
    geo: structuredClone(extractSignalGeo(signal)),
  };
}

export function currentSituationGeo(signals: SituationSignalSnapshot[]): SituationGeo {
  let selected: SituationSignalSnapshot | undefined;
  let selectedKey = '';
  for (const signal of signals) {
    if (!signal.geo || signal.geo.kind === 'unknown') continue;
    const key = signal.identity?.key ?? JSON.stringify([signal.type, signal.id]);
    if (!selected || signal.timestamp > selected.timestamp
      || (signal.timestamp === selected.timestamp && key < selectedKey)) {
      selected = signal;
      selectedKey = key;
    }
  }
  return selected?.geo ? structuredClone(selected.geo)
    : { kind: 'unknown', label: '', countries: [], radiusKm: 0 };
}

export function findSituationForSignal(signal: CorrelationSignalCore, situations: Situation[], config: SituationEngineConfig): Situation | null {
  let best: Situation | null = null;
  let bestAffinity = 0;
  for (const sit of situations) {
    if (sit.phase === 'resolved' || sit.legacyUnverified) continue;
    const sameSourceDistinctIdentity = signal.data.source && sit.signals.some(s =>
      s.source === signal.data.source && s.identity?.key !== signal.data.identity?.key);
    if (sameSourceDistinctIdentity) continue;
    const affinity = computeAffinity(signal, sit, config);
    if (affinity.temporalProximity <= 0 || (!affinity.geoMatch && affinity.entityOverlap === 0)) continue;
    if (affinity.score > bestAffinity && affinity.score >= 0.3) {
      bestAffinity = affinity.score;
      best = sit;
    }
  }
  return best;
}

function updateSituation(situation: Situation, snapshot: SituationSignalSnapshot, config: SituationEngineConfig, now: number): void {
  const index = situation.signals.findIndex(s => snapshot.identity
    ? s.identity?.key === snapshot.identity.key : s.id === snapshot.id);
  if (index === -1) situation.signals.push(snapshot);
  else situation.signals[index] = snapshot;
  situation.signalIds = situation.signals.map(s => s.id);
  situation.lastUpdated = now;
  situation.latestEventAt = Math.max(...situation.signals.map(s => s.timestamp).filter(time => Number.isFinite(time)));
  if (!Number.isFinite(situation.latestEventAt)) situation.latestEventAt = null;
  situation.confidence = computeSituationConfidence(situation.signals);
  situation.domainDiversity = new Set(situation.signals.map(s => s.domain)).size;
  situation.phase = computePhase(situation, config, now);
  situation.summary = generateSummary(situation.signals, situation.domain);
  situation.geo = currentSituationGeo(situation.signals);
  const chain = matchCausalChain(situation.signals);
  situation.causalChainId = chain?.id ?? null;
  situation.reassessmentCount++;
}

export function correlateSignalToSituation(
  signal: CorrelationSignalCore,
  existingSituations: Situation[],
  config: SituationEngineConfig = DEFAULT_ENGINE_CONFIG,
  options: { situationId?: string; allowCreate?: boolean } = {},
): { situationId: string | null; isNew: boolean; changed: boolean } {
  const now = Date.now();
  const signalTs = signal.timestamp.getTime();
  const signalDomain = signalDomainOf(signal);
  const signalGeo = extractSignalGeo(signal);
  if (!Number.isFinite(signalTs)) return { situationId: null, isNew: false, changed: false };
  if (signalGeo.kind === 'point' && !validSituationPoint(signalGeo)) return { situationId: null, isNew: false, changed: false };
  const bestSituation = options.situationId
    ? existingSituations.find(s => s.id === options.situationId)
    : findSituationForSignal(signal, existingSituations, config);
  const snapshot = snapshotFor(signal);
  if (bestSituation) {
    const previous = bestSituation.signals.find(s => snapshot.identity ? s.identity?.key === snapshot.identity.key : s.id === snapshot.id);
    if (previous && (snapshot.identity ? previous.identity?.revision === snapshot.identity.revision : previous.timestamp === snapshot.timestamp)) {
      return { situationId: bestSituation.id, isNew: false, changed: false };
    }
    updateSituation(bestSituation, snapshot, config, now);
    return { situationId: bestSituation.id, isNew: false, changed: true };
  }
  if (options.allowCreate === false) return { situationId: null, isNew: false, changed: false };
  const newSituation: Situation = {
    id: options.situationId ?? newSituationId(), title: generateTitle(signalDomain, signalGeo, [snapshot]),
    summary: generateSummary([snapshot], signalDomain), phase: 'emerging', domain: signalDomain,
    confidence: signal.confidence, geo: signalGeo, signalIds: [signal.id], signals: [snapshot],
    domainDiversity: 1, evidence: null, scenarios: [], actions: [], causalChainId: matchCausalChain([snapshot])?.id ?? null,
    firstSeen: now, lastUpdated: now, latestEventAt: signalTs, reassessmentCount: 0,
  };
  existingSituations.push(newSituation);
  if (existingSituations.length > config.maxSituations) {
    const prunable = existingSituations.filter(s => s.phase === 'resolved' || s.phase === 'de-escalating')
      .sort((a, b) => a.lastUpdated - b.lastUpdated);
    const toPrune = prunable[0];
    if (toPrune) existingSituations.splice(existingSituations.indexOf(toPrune), 1);
  }
  return { situationId: newSituation.id, isNew: true, changed: true };
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

/**
 * Situation Awareness Engine — OODA Loop Orchestrator
 *
 * Core loop: Observe → Verify → Correlate → Forecast → Personalize → Recommend → Reassess
 *
 * This is the top-level API that data-loader.ts calls. It:
 * 1. Ingests raw CorrelationSignals and UnifiedAlerts
 * 2. Clusters them into Situations via the correlator
 * 3. Projects scenarios via the forecaster
 * 4. Generates user-specific action cards via the personalizer
 * 5. Periodically reassesses all active situations
 * 6. Notifies subscribers of changes
 */

import type { CorrelationSignalCore, SignalType } from './analysis-core';
import type { EvidencePack } from './evidence-pack';
import type { UnifiedAlert } from './unified-alerts';
import { identifyAlert, identifySignal, createIdentityLedger, hydrateIdentityLedger, validObservationIdentity } from './alert-identity';
import type { IdentityLedger, IdentityLimits } from './alert-identity';
import type {
  Situation,
  SituationDomain,
  SituationGeo,
  SituationEngineConfig,
  SituationSignalSnapshot,
  VerificationVerdict,
} from './situation-types';
import { DEFAULT_ENGINE_CONFIG, validSituationPoint } from './situation-types';
import {
  correlateSignalToSituation,
  reassessSituations,
  findSituationForSignal,
  newSituationId,
  currentSituationGeo,
} from './situation-correlator';
import { projectScenarios } from './situation-forecaster';
import { personalizeSituation } from './situation-personalizer';

// ── Subscriber Pattern ───────────────────────────────────────────────────────

type SituationListener = (situations: Situation[]) => void;

// ── Engine ────────────────────────────────────────────────────────────────────

export function domainHintForAlertSource(source: string): SituationDomain | undefined {
  switch (source) {
    case 'nws': case 'spc': case 'cyclone': case 'gdacs': case 'tsunami': case 'volcano':
    case 'earthquake': case 'fire': case 'hazard': case 'space-weather': { return 'natural_hazard';
 }
    case 'cyber': case 'local-ids': { return 'cyber';
 }
    case 'power-grid': case 'comms-health': case 'resource': case 'aviation-hazard': case 'maritime': { return 'infrastructure';
 }
    case 'disease': case 'air-quality': case 'radiation': { return 'health';
 }
    case 'oref': { return 'military';
    }
    default: { return undefined;
    }
  }
}

function alertGeo(alert: UnifiedAlert): SituationGeo {
  const common = { label: alert.location?.label ?? '', countries: [], radiusKm: 0 };
  const scope = alert.spatialScope;
  if (scope?.kind === 'point' && validSituationPoint(alert.location)) {
    return { ...common, kind: 'point', basis: scope.basis, lat: alert.location.lat, lon: alert.location.lon };
  }
  if (scope?.kind === 'area') {
    return { ...common, kind: 'area', basis: scope.basis,
      ...(validSituationPoint(alert.location) ? { centroid: { lat: alert.location.lat, lon: alert.location.lon } } : {}) };
  }
  return { ...common, kind: scope?.kind === 'global' ? 'global' : 'unknown' };
}

interface SituationIdentityValue { situationId: string }
function validIdentityValue(value: unknown): value is SituationIdentityValue {
  return !!value && typeof value === 'object' && typeof (value as SituationIdentityValue).situationId === 'string'
    && (value as SituationIdentityValue).situationId.length > 0;
}

function validPersistedSignal(sig: SituationSignalSnapshot): boolean {
  if (!sig || typeof sig !== 'object'
    || (sig.identity !== undefined && !validObservationIdentity(sig.identity))) return false;
  return identifySignal({ id: sig.id, type: sig.type, title: sig.title, description: '',
    confidence: sig.confidence, timestamp: new Date(sig.timestamp),
    data: { relatedTopics: sig.entities, source: sig.source, domainHint: sig.domain, geo: sig.geo },
  }) !== null && typeof sig.domain === 'string' && Number.isSafeInteger(sig.timestamp) && sig.timestamp >= 0;
}

function restoreSituation(value: unknown, legacy: boolean): Situation | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Situation;
  if (typeof s.id !== 'string' || !s.id || typeof s.title !== 'string' || typeof s.summary !== 'string'
    || !Number.isFinite(s.firstSeen) || !Number.isFinite(s.lastUpdated) || !Number.isFinite(s.confidence)
    || !['emerging', 'developing', 'active', 'de-escalating', 'resolved'].includes(s.phase)
    || !['military', 'economic', 'natural_hazard', 'cyber', 'infrastructure', 'health', 'civil_unrest', 'compound'].includes(s.domain)
    || !Array.isArray(s.signals) || !Array.isArray(s.signalIds) || !s.signalIds.every(id => typeof id === 'string')
    || !Array.isArray(s.scenarios) || !Array.isArray(s.actions) || !s.geo || !Array.isArray(s.geo.countries)
    || !s.geo.countries.every(c => typeof c === 'string') || typeof s.geo.label !== 'string') return null;
  if (!s.signals.every(sig => validPersistedSignal(sig))) return null;
  const eventTimes = s.signals.map(sig => sig.timestamp).filter(time => Number.isFinite(time));
  s.latestEventAt = eventTimes.length ? Math.max(...eventTimes) : null;
  if (legacy) {
    s.geo = { kind: s.geo.countries.length ? 'country' : 'unknown', countries: s.geo.countries,
      label: s.geo.label, radiusKm: Number.isFinite(s.geo.radiusKm) ? s.geo.radiusKm : 0 };
    if (s.signalIds.some(id => id.startsWith('ua-')) || s.signals.some(sig => sig.id.startsWith('ua-'))) s.legacyUnverified = true;
  } else if (!validPersistedGeo(s.geo)) return null;
  if (!legacy) s.geo = currentSituationGeo(s.signals);
  return s;
}

function validPersistedGeo(geo: SituationGeo): boolean {
  if (typeof geo.label !== 'string' || !Array.isArray(geo.countries)
    || !geo.countries.every(country => typeof country === 'string')
    || !Number.isFinite(geo.radiusKm) || geo.radiusKm < 0) return false;
  switch (geo.kind) {
    case 'point': { return validSituationPoint(geo) && ['reported-event', 'centroid', 'regional-centroid'].includes(geo.basis);
    }
    case 'area': { return geo.basis === 'nws-geometry' && (geo.centroid === undefined || validSituationPoint(geo.centroid));
    }
    case 'country': case 'global': case 'unknown': { return true;
 }
    default: { return false;
    }
  }
}

export class SituationEngine {
  private situations: Situation[] = [];
  private listeners = new Set<SituationListener>();
  private config: SituationEngineConfig;
  private reassessTimer: ReturnType<typeof setInterval> | null = null;
  private _signalBuffer: CorrelationSignalCore[] = [];
  private identities: IdentityLedger<SituationIdentityValue>;
  private identityLimits: IdentityLimits | undefined;
  private admissionFailures = 0;
  private persistenceFailures = 0;
  private restartProtected = true;

  constructor(config: SituationEngineConfig = DEFAULT_ENGINE_CONFIG, options: { identityLimits?: IdentityLimits } = {}) {
 this.config = config;
 this.identityLimits = options.identityLimits;
 this.identities = createIdentityLedger(validIdentityValue, this.identityLimits);
 this.restore();
  }

  // ── 1. OBSERVE — Ingest raw signals ──────────────────────────────────────

  /**
 * Ingest correlation signals. This is the primary entry point called by
 * data-loader after analyzeCorrelations() completes.
 */
  observeSignals(signals: CorrelationSignalCore[]): void {
 if (signals.length === 0) return;

 for (const signal of signals) {
   const identity = identifySignal(signal);
   if (!identity) { this.admissionFailures++; continue; }
   this._signalBuffer.push({ ...signal, data: { ...signal.data, identity } });
 }
 this.processBuffer();
  }

  /**
 * Ingest unified alerts (from NWS, GDACS, etc.) as supplementary signals.
 * These provide additional domain color but don't directly create situations
 * unless they're high severity.
 */
  observeAlerts(alerts: UnifiedAlert[]): void {
 const highSeverityAlerts = alerts.filter(
 a => a.source !== 'correlation' && (a.severity === 'critical' || a.severity === 'high'),
 );

 for (const alert of highSeverityAlerts) {
 const identity = identifyAlert(alert);
 if (!identity) { this.admissionFailures++; continue; }
 const pseudoSignal = SituationEngine.alertToPseudoSignal(alert);
 pseudoSignal.data.identity = identity;
 this._signalBuffer.push(pseudoSignal);
 }

 if (this._signalBuffer.length > 0) {
 this.processBuffer();
 }
  }

  /** Convert a high-severity unified alert into a pseudo correlation signal */
  private static alertToPseudoSignal(alert: UnifiedAlert): CorrelationSignalCore {
 const type = SituationEngine.alertSourceToSignalType(alert.source);
 return {
 id: `ua-${alert.id}`,
 type,
 title: alert.title,
 description: alert.body,
 confidence: alert.severity === 'critical' ? 0.85 : 0.6,
 timestamp: new Date(alert.timestamp),
 data: {
 explanation: alert.title,
 domainHint: domainHintForAlertSource(alert.source),
 geo: alertGeo(alert),
 source: alert.source,
 placeIds: [],
 placeSummary: alert.location?.label ?? undefined,
 },
 };
  }

  /** Map alert source to correlation signal type */
  private static alertSourceToSignalType(source: string): SignalType {
 if (source === 'nws') return 'keyword_spike';
 if (source === 'gdacs') return 'geo_convergence';
 if (source === 'cyber') return 'keyword_spike';
 return 'convergence';
  }

  // ── 2. VERIFY — Multi-factor evidence verification ──────────────────────

  /**
 * Maps signal types to coarse source categories for independence checks.
 * Signals originating from distinct source types count as independent.
 */
  private static readonly SOURCE_TYPE_MAP: Record<string, string> = {
 // Pseudo-signals from UnifiedAlerts carry prefixed ids
 keyword_spike: 'RSS',
 geo_convergence: 'GDACS',
 convergence: 'correlation-signal',
 velocity_spike: 'RSS',
 // Correlation-engine native types
 hotspot_escalation: 'ACLED',
 military_surge: 'ACLED',
 news_leads_markets: 'correlation-signal',
 silent_divergence: 'correlation-signal',
 flow_price_divergence: 'correlation-signal',
 explained_market_move: 'correlation-signal',
 sector_cascade: 'correlation-signal',
 prediction_leads_news: 'prediction',
 flow_drop: 'correlation-signal',
 triangulation: 'correlation-signal',
  };

  /** Coarse severity bucket for contradiction detection */
  private static severityBucket(confidence: number): 'low' | 'medium' | 'high' | 'critical' {
 if (confidence >= 0.85) return 'critical';
 if (confidence >= 0.6) return 'high';
 if (confidence >= 0.35) return 'medium';
 return 'low';
  }

  private verify(situation: Situation): void {
 const now = Date.now();
 const signals = situation.signals;

 const independentSources = SituationEngine.countIndependentSources(signals);
 const temporalCorroboration = SituationEngine.checkTemporalCorroboration(signals);
 const crossDomainVerified = new Set(signals.map(s => s.domain)).size >= 2;
 const hasContradictions = SituationEngine.detectContradictions(signals);
 const freshnessScore = SituationEngine.computeFreshness(signals, now);

 // Compute adjusted confidence
 const stalenessPenalty = (1 - freshnessScore) / 4; // reverse the freshness scaling
 situation.confidence = SituationEngine.adjustConfidence(
 situation.confidence, temporalCorroboration, crossDomainVerified, hasContradictions, stalenessPenalty,
 );

 const overallVerdict = SituationEngine.determineVerdict(
 independentSources, temporalCorroboration, crossDomainVerified, hasContradictions,
 );

 situation.verificationDetails = {
 independentSources, temporalCorroboration, crossDomainVerified,
 hasContradictions, freshnessScore, overallVerdict,
 };

 this.updateEvidencePack(situation, independentSources, overallVerdict, temporalCorroboration, hasContradictions, now);
  }

  /** Count distinct source types contributing to a situation */
  private static countIndependentSources(signals: SituationSignalSnapshot[]): number {
 const sourceTypes = new Set(
 signals.map(s => SituationEngine.resolveSourceType(s)),
 );
 return sourceTypes.size;
  }

  /** Resolve a signal snapshot to its coarse source category */
  private static resolveSourceType(s: SituationSignalSnapshot): string {
 if (s.source) return s.source;
 if (!s.id.startsWith('ua-')) {
 return SituationEngine.SOURCE_TYPE_MAP[s.type] ?? s.type;
 }
 // Pseudo-signals from unified alerts
 if (s.type === 'keyword_spike' && s.id.includes('nws')) return 'NWS';
 if (s.type === 'keyword_spike' && s.id.includes('cyber')) return 'cyber';
 if (s.type === 'geo_convergence') return 'GDACS';
 return 'unified-alert';
  }

  /** Check if signals from different source types arrived within 30 min */
  private static checkTemporalCorroboration(signals: SituationSignalSnapshot[]): boolean {
 const WINDOW_MS = 30 * 60 * 1000;
 if (signals.length < 2) return false;
 for (let i = 0; i < signals.length; i++) {
 for (let j = i + 1; j < signals.length; j++) {
 const si = signals[i]!;
 const sj = signals[j]!;
 const withinWindow = Math.abs(si.timestamp - sj.timestamp) < WINDOW_MS;
 if (SituationEngine.resolveSourceType(si) !== SituationEngine.resolveSourceType(sj) && withinWindow) return true;
 }
 }
 return false;
  }

  /** Detect contradictions: critical vs low severity in same situation */
  private static detectContradictions(signals: SituationSignalSnapshot[]): boolean {
 const buckets = new Set(signals.map(s => SituationEngine.severityBucket(s.confidence)));
 return buckets.has('critical') && buckets.has('low');
  }

  /** Compute freshness score (0-1) based on most recent signal age */
  private static computeFreshness(signals: SituationSignalSnapshot[], now: number): number {
 const mostRecentTs = Math.max(...signals.map(s => s.timestamp));
 const hoursSince = (now - mostRecentTs) / 3_600_000;
 const penalty = Math.min(0.25, Math.max(0, hoursSince - 2) * 0.05);
 return Math.max(0, 1 - penalty * 4);
  }

  /** Apply verification-based adjustments to confidence */
  private static adjustConfidence(
 base: number, temporal: boolean, crossDomain: boolean, contradictions: boolean, stalenessPenalty: number,
  ): number {
 let c = base;
 if (temporal) c += 0.15;
 if (crossDomain) c += 0.1;
 if (contradictions) c -= 0.2;
 c -= stalenessPenalty;
 return Math.min(1, Math.max(0, c));
  }

  /** Determine overall verification verdict */
  private static determineVerdict(
 sources: number, temporal: boolean, crossDomain: boolean, contradictions: boolean,
  ): VerificationVerdict {
 if (contradictions) return 'contradicted';
 if (sources >= 3 && temporal) return 'verified';
 if (sources >= 2 || crossDomain) return 'likely';
 return 'unverified';
  }

  /** Update the legacy evidence pack with verification-aware metadata */
  private updateEvidencePack(
 situation: Situation, independentSources: number, verdict: VerificationVerdict,
 temporalCorroboration: boolean, hasContradictions: boolean, now: number,
  ): void {
 const evidenceSources = situation.signals.filter(s => s.confidence > 0.5);
 const sourceCount = evidenceSources.length;
 if (sourceCount < 2) return;

 const avgConfidence = evidenceSources.reduce((s, e) => s + e.confidence, 0) / sourceCount;
 const evidenceVerdict = SituationEngine.classifyEvidenceVerdict(avgConfidence, sourceCount);
 const freshness = SituationEngine.classifyFreshness(now - situation.lastUpdated);
 const actionThreshold = SituationEngine.classifyActionThreshold(avgConfidence);
 const domainCount = situation.domainDiversity;
 const sourcePlural = independentSources === 1 ? '' : 's';
 const domainPlural = domainCount === 1 ? '' : 's';
 const corrobNote = temporalCorroboration ? ', temporally corroborated' : '';
 const contradNote = hasContradictions ? ', CONTRADICTIONS DETECTED' : '';

 situation.evidence = {
 claim: situation.title,
 verdict: evidenceVerdict,
 freshness,
 supportingSources: [],
 conflictingSources: [],
 corroborationCount: sourceCount,
 trustedSourceCount: evidenceSources.filter(s => s.confidence > 0.7).length,
 sourceDiversity: independentSources,
 confidenceReason: `${verdict}: ${independentSources} independent source${sourcePlural}, ${domainCount} domain${domainPlural}${corrobNote}${contradNote}`,
 actionThreshold,
 firstSeen: new Date(situation.firstSeen),
 lastUpdated: new Date(situation.lastUpdated),
 } as EvidencePack;
  }

  private static classifyEvidenceVerdict(avg: number, count: number): string {
 if (avg > 0.7 && count >= 3) return 'actionable';
 if (avg > 0.5) return 'corroborated';
 return 'reported';
  }

  private static classifyFreshness(ageMs: number): string {
 if (ageMs < 6 * 3_600_000) return 'fresh';
 if (ageMs < 24 * 3_600_000) return 'recent';
 return 'stale';
  }

  private static classifyActionThreshold(avg: number): string {
 if (avg > 0.7) return 'act';
 if (avg > 0.4) return 'verify';
 return 'monitor';
  }

  // ── 3–6. CORRELATE → FORECAST → PERSONALIZE → RECOMMEND ─────────────────

  private processSignal(signal: CorrelationSignalCore, protectedKeys: Set<string>): boolean {
    if (signal.data.source === 'correlation') return false;
    const identity = signal.data.identity ?? identifySignal(signal);
    if (!identity) { this.admissionFailures++; return false; }
    const previous = this.identities.get(identity.key);
    if (previous?.revisions.includes(identity.revision)) return false;
    const targetId = previous?.value.situationId
      ?? findSituationForSignal(signal, this.situations, this.config)?.id ?? newSituationId();
    const admitted = this.identities.admit(identity, { situationId: targetId }, Date.now(), protectedKeys);
    if (admitted === 'duplicate') return false;
    if (admitted !== 'accepted') {
      this.admissionFailures++;
      if (!previous || !this.situations.some(s => s.id === previous.value.situationId)) return false;
    }
    const result = correlateSignalToSituation(signal, this.situations, this.config, {
      situationId: targetId, allowCreate: admitted === 'accepted',
    });
    if (!result.situationId) return false;
    protectedKeys.add(identity.key);
    if (!result.changed) return false;
    const situation = this.situations.find(s => s.id === result.situationId);
    if (!situation) return false;
    this.verify(situation);
    situation.scenarios = projectScenarios(situation);
    situation.actions = personalizeSituation(situation);
    return true;
  }

  private processBuffer(): void {
    if (this._signalBuffer.length === 0) return;
    const signals = this._signalBuffer.splice(0);
    this.identities.expire(Date.now());
    const protectedKeys = new Set(this.situations.flatMap(s => s.signals.flatMap(sig => sig.identity ? [sig.identity.key] : [])));
    let changed = false;
    for (const signal of signals) if (this.processSignal(signal, protectedKeys)) changed = true;
    if (changed) {
      this.persist();
      this.notify();
    }
  }

  // ── 7. REASSESS — Periodic lifecycle update ──────────────────────────────

  private reassess(): void {
 const before = this.situations.length;
 this.situations = reassessSituations(this.situations, this.config);

 // Re-forecast active situations (scenarios may shift as time passes)
 for (const sit of this.situations) {
 if (sit.phase === 'active' || sit.phase === 'developing') {
 sit.scenarios = projectScenarios(sit);
 sit.actions = personalizeSituation(sit);
 }
 }

 if (this.situations.length !== before) {
 this.persist();
 }
 this.notify();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
 if (this.reassessTimer) return;
 this.reassessTimer = setInterval(() => this.reassess(), this.config.reassessIntervalMs);
  }

  stop(): void {
 if (this.reassessTimer) {
 clearInterval(this.reassessTimer);
 this.reassessTimer = null;
 }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Get all situations sorted by phase priority then confidence */
  getSituations(): Situation[] {
 const phaseOrder: Record<string, number> = {
 active: 0,
 developing: 1,
 emerging: 2,
 'de-escalating': 3,
 resolved: 4,
 };
 return [...this.situations].sort((a, b) => {
 const phaseDiff = (phaseOrder[a.phase] ?? 9) - (phaseOrder[b.phase] ?? 9);
 if (phaseDiff !== 0) return phaseDiff;
 return b.confidence - a.confidence;
 });
  }

  /** Get only actionable situations (developing or active) */
  getActionableSituations(): Situation[] {
 return this.getSituations().filter(
 s => !s.legacyUnverified && (s.phase === 'active' || s.phase === 'developing'),
 );
  }

  /** Get count of active + developing situations */
  getActiveCount(): number {
 return this.situations.filter(
 s => !s.legacyUnverified && (s.phase === 'active' || s.phase === 'developing'),
 ).length;
  }

  /** Subscribe to situation changes */
  subscribe(listener: SituationListener): () => void {
 this.listeners.add(listener);
 return () => this.listeners.delete(listener);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  getIdentityDiagnostics(): { size: number; byteLength: number; admissionFailures: number; persistenceFailures: number; restartProtected: boolean } {
    return { size: this.identities.size, byteLength: this.identities.byteLength,
      admissionFailures: this.admissionFailures, persistenceFailures: this.persistenceFailures, restartProtected: this.restartProtected };
  }

  private persist(): void {
    try {
      const situations = this.situations.filter(s => s.phase !== 'resolved').slice(0, this.config.maxSituations);
      const encoded = JSON.stringify({ version: 2, situations, identities: this.identities.snapshot() });
      localStorage.setItem('wm-situations-v2', encoded);
      if (localStorage.getItem('wm-situations-v2') !== encoded) throw new Error('Situation persistence verification failed');
      this.restartProtected = true;
    } catch {
      this.persistenceFailures++;
      this.restartProtected = false;
    }
  }

  private restore(): void {
    try {
      const current = localStorage.getItem('wm-situations-v2');
      const raw = current ?? localStorage.getItem('wm-situations-v1');
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      const envelope = parsed as { version?: unknown; situations?: unknown; identities?: unknown };
      const legacy = !current;
      const currentEntries = envelope.version === 2 ? envelope.situations : null;
      const entries = legacy ? parsed : currentEntries;
      if (!Array.isArray(entries)) { this.restartProtected = false; this.persistenceFailures++; return; }
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const restored = entries.map(s => restoreSituation(s, legacy));
      if (restored.includes(null)) {
        this.persistenceFailures++;
        this.restartProtected = false;
      }
      this.situations = restored.filter((s): s is Situation =>
        s !== null && s.lastUpdated > cutoff && s.phase !== 'resolved').slice(0, this.config.maxSituations);
      if (!legacy) this.identities = hydrateIdentityLedger(envelope.identities, Date.now(), validIdentityValue, this.identityLimits, () => {
        this.persistenceFailures++;
        this.restartProtected = false;
      });
      if (legacy) this.persist();
    } catch {
      this.persistenceFailures++;
      this.restartProtected = false;
    }
  }

  private notify(): void {
 const snapshot = this.getSituations();
 for (const listener of this.listeners) {
 try { listener(snapshot); } catch { /* listener error */ }
 }

 // Also dispatch a DOM event for other components
 document.dispatchEvent(new CustomEvent('wm:situations-updated', {
 detail: {
 total: snapshot.length,
 active: snapshot.filter(s => s.phase === 'active').length,
 developing: snapshot.filter(s => s.phase === 'developing').length,
 },
 }));
  }

  /** Reset all situations (for testing or user action) */
  reset(): void {
 this.situations = [];
 this.persist();
 this.notify();
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const situationEngine = new SituationEngine();

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
import type {
  Situation,
  SituationEngineConfig,
  SituationSignalSnapshot,
  VerificationVerdict,
} from './situation-types';
import { DEFAULT_ENGINE_CONFIG } from './situation-types';
import {
  correlateSignalToSituation,
  reassessSituations,
} from './situation-correlator';
import { projectScenarios } from './situation-forecaster';
import { personalizeSituation } from './situation-personalizer';

// ── Subscriber Pattern ───────────────────────────────────────────────────────

type SituationListener = (situations: Situation[]) => void;

// ── Engine ────────────────────────────────────────────────────────────────────

export class SituationEngine {
  private situations: Situation[] = [];
  private listeners = new Set<SituationListener>();
  private config: SituationEngineConfig;
  private reassessTimer: ReturnType<typeof setInterval> | null = null;
  private _signalBuffer: CorrelationSignalCore[] = [];

  constructor(config: SituationEngineConfig = DEFAULT_ENGINE_CONFIG) {
 this.config = config;
 this.restore();
  }

  // ── 1. OBSERVE — Ingest raw signals ──────────────────────────────────────

  /**
 * Ingest correlation signals. This is the primary entry point called by
 * data-loader after analyzeCorrelations() completes.
 */
  observeSignals(signals: CorrelationSignalCore[]): void {
 if (signals.length === 0) return;

 this._signalBuffer.push(...signals);
 this.processBuffer();
  }

  /**
 * Ingest unified alerts (from NWS, GDACS, etc.) as supplementary signals.
 * These provide additional domain color but don't directly create situations
 * unless they're high severity.
 */
  observeAlerts(alerts: UnifiedAlert[]): void {
 const highSeverityAlerts = alerts.filter(
 a => a.severity === 'critical' || a.severity === 'high',
 );

 for (const alert of highSeverityAlerts) {
 const pseudoSignal = SituationEngine.alertToPseudoSignal(alert);
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
 placeIds: alert.location ? [alert.location.label ?? ''] : [],
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
 if (si.type !== sj.type && withinWindow) return true;
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

  private processBuffer(): void {
 if (this._signalBuffer.length === 0) return;

 const signals = this._signalBuffer.splice(0);
 let changed = false;

 for (const signal of signals) {
 // CORRELATE: cluster into situation
 const result = correlateSignalToSituation(signal, this.situations, this.config);
 changed = true;

 // Get the affected situation
 const situation = this.situations.find(s => s.id === result.situationId);
 if (!situation) continue;

 // VERIFY: cross-check evidence
 this.verify(situation);

 // FORECAST: project scenarios
 situation.scenarios = projectScenarios(situation);

 // PERSONALIZE + RECOMMEND: generate action cards
 situation.actions = personalizeSituation(situation);
 }

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
 s => s.phase === 'active' || s.phase === 'developing',
 );
  }

  /** Get count of active + developing situations */
  getActiveCount(): number {
 return this.situations.filter(
 s => s.phase === 'active' || s.phase === 'developing',
 ).length;
  }

  /** Subscribe to situation changes */
  subscribe(listener: SituationListener): () => void {
 this.listeners.add(listener);
 return () => this.listeners.delete(listener);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private persist(): void {
 try {
 // Only persist non-resolved situations, max 20
 const toStore = this.situations
 .filter(s => s.phase !== 'resolved')
 .slice(0, 20);
 localStorage.setItem('wm-situations-v1', JSON.stringify(toStore));
 } catch { /* quota or private mode */ }
  }

  private restore(): void {
 try {
 const raw = localStorage.getItem('wm-situations-v1');
 if (!raw) return;
 const parsed: unknown = JSON.parse(raw);
 if (Array.isArray(parsed)) {
 // Rehydrate — filter out stale situations (>24h old)
 const cutoff = Date.now() - 24 * 60 * 60 * 1000;
 this.situations = (parsed as Situation[]).filter(
 (s: Situation) => s.lastUpdated > cutoff && s.phase !== 'resolved',
 );
 }
 } catch { /* corrupt data */ }
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

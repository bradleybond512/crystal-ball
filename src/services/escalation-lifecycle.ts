 
/**
 * Situation Escalation Lifecycle
 *
 * Tracks the evolution of situations through lifecycle phases and fires
 * notifications when situations escalate (e.g. GDACS Orange -> Red) or
 * auto-resolves situations that have been quiet for 12+ hours.
 *
 * Companion to situation-engine.ts, which already tracks phases
 * (emerging/developing/active/de-escalating/resolved). This module adds
 * a finer-grained computePhase (including 'peak'), auto-resolution,
 * escalation notifications, and a subscription + reassessment loop.
 */

import type { UnifiedAlert, AlertSeverity } from './unified-alerts';
import type { Situation } from './situation-types';
import { situationEngine } from './situation-engine';
import { notificationDispatcher, actionForSeverity } from './notification-dispatcher';

export type LifecyclePhase = 'emerging' | 'active' | 'peak' | 'de-escalating' | 'resolved';

export interface LifecycleEvent {
  situationId: string;
  phase: LifecyclePhase;
  previousPhase?: LifecyclePhase;
  severity: AlertSeverity;
  previousSeverity?: AlertSeverity;
  timestamp: number;
  reason: string;
}

const HOUR_MS = 60 * 60 * 1000;
const STALE_THRESHOLD_MS = 12 * HOUR_MS;
const REASSESS_INTERVAL_MS = 15 * 60 * 1000;
const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
};

const listeners = new Set<(event: LifecycleEvent) => void>();
const lastKnownSeverity = new Map<string, AlertSeverity>();
const lastKnownPhase = new Map<string, LifecyclePhase>();
let tracker: ReturnType<typeof setInterval> | null = null;

export function computePhase(situation: {
  firstSeen: number; lastUpdate: number;
  alertCountLastHour: number; alertCountPrevHour: number;
  severity: AlertSeverity;
}): LifecyclePhase {
  const now = Date.now();
  const ageMs = now - situation.firstSeen;
  if (now - situation.lastUpdate >= STALE_THRESHOLD_MS) return 'resolved';
  const { alertCountLastHour: curr, alertCountPrevHour: prev, severity } = situation;
  if (curr >= 2 * prev && prev > 0 && severity === 'critical') return 'peak';
  if (ageMs < HOUR_MS || (prev === 0 ? curr > 0 : curr > 3 * prev)) return 'emerging';
  if (curr > 0 && curr < 0.5 * prev) return 'de-escalating';
  if (ageMs <= 6 * HOUR_MS && curr > 0) return 'active';
  if (curr === 0 && prev > 0) return 'de-escalating';
  return 'active';
}

function severityFromConfidence(c: number): AlertSeverity {
  if (c >= 0.85) return 'critical';
  if (c >= 0.6) return 'high';
  if (c >= 0.35) return 'medium';
  if (c >= 0.15) return 'low';
  return 'info';
}

function snapshot(situation: Situation): {
  firstSeen: number; lastUpdate: number;
  alertCountLastHour: number; alertCountPrevHour: number; severity: AlertSeverity;
} {
  const now = Date.now();
  const inWindow = (from: number, to: number): number =>
    situation.signals.filter(s => s.timestamp >= from && s.timestamp < to).length;
  return {
    firstSeen: situation.firstSeen,
    lastUpdate: situation.lastUpdated,
    alertCountLastHour: inWindow(now - HOUR_MS, now),
    alertCountPrevHour: inWindow(now - 2 * HOUR_MS, now - HOUR_MS),
    severity: severityFromConfidence(situation.confidence),
  };
}

export function autoResolveStaleSituations(olderThanMs: number = STALE_THRESHOLD_MS): number {
  const cutoff = Date.now() - olderThanMs;
  let count = 0;
  for (const sit of situationEngine.getSituations()) {
    if (sit.phase === 'resolved' || sit.lastUpdated >= cutoff) continue;
    const prevPhase = lastKnownPhase.get(sit.id);
    (sit as { phase: string }).phase = 'resolved';
    emit({
      situationId: sit.id, phase: 'resolved', previousPhase: prevPhase,
      severity: severityFromConfidence(sit.confidence), timestamp: Date.now(),
      reason: `No new signals for ${Math.round(olderThanMs / HOUR_MS)}h`,
    });
    lastKnownPhase.set(sit.id, 'resolved');
    count++;
  }
  return count;
}

export function handleEscalation(
  situationId: string, previousSeverity: AlertSeverity, newSeverity: AlertSeverity,
  label: string, lat: number, lon: number,
): void {
  if (SEVERITY_RANK[newSeverity] <= SEVERITY_RANK[previousSeverity]) return;
  const alert: UnifiedAlert = {
    // Content-stable id: an escalation to a given severity for a situation is a
    // single event. Keying on situation + new severity (instead of Date.now())
    // stops repeated detections of the same escalation from re-notifying; a
    // further rise produces a new id because newSeverity changes.
    id: `escalation-${situationId}-${newSeverity}`,
    source: 'correlation',
    severity: newSeverity,
    title: `Situation Escalated: ${label}`,
    body: `Severity rose from ${previousSeverity} to ${newSeverity}.`,
    timestamp: Date.now(),
    location: { lat, lon, label },
    relevanceScore: SEVERITY_RANK[newSeverity] * 20,
    acknowledged: false,
    pinned: false,
  };
  notificationDispatcher.dispatchNotification(alert, actionForSeverity(newSeverity));
  emit({
    situationId, phase: lastKnownPhase.get(situationId) ?? 'active',
    severity: newSeverity, previousSeverity, timestamp: Date.now(),
    reason: `Escalated ${previousSeverity} -> ${newSeverity}`,
  });
}

export function subscribeLifecycle(cb: (event: LifecycleEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(event: LifecycleEvent): void {
  for (const cb of listeners) { try { cb(event); } catch { /* listener error */ } }
  try { document.dispatchEvent(new CustomEvent('cb:situation-lifecycle', { detail: event })); }
  catch { /* non-DOM env */ }
}

function reassess(): void {
  autoResolveStaleSituations();
  for (const sit of situationEngine.getSituations()) {
    const snap = snapshot(sit);
    const newPhase = computePhase(snap);
    const prevSeverity = lastKnownSeverity.get(sit.id);
    const prevPhase = lastKnownPhase.get(sit.id);
    if (prevSeverity && prevSeverity !== snap.severity) {
      handleEscalation(sit.id, prevSeverity, snap.severity, sit.geo.label, sit.geo.lat, sit.geo.lon);
    }
    if (prevPhase !== newPhase) {
      emit({
        situationId: sit.id, phase: newPhase, previousPhase: prevPhase,
        severity: snap.severity, previousSeverity: prevSeverity,
        timestamp: Date.now(), reason: `Phase ${prevPhase ?? 'new'} -> ${newPhase}`,
      });
    }
    lastKnownSeverity.set(sit.id, snap.severity);
    lastKnownPhase.set(sit.id, newPhase);
  }
}

export function startEscalationTracking(): void {
  if (tracker) return;
  for (const sit of situationEngine.getSituations()) {
    const snap = snapshot(sit);
    lastKnownSeverity.set(sit.id, snap.severity);
    lastKnownPhase.set(sit.id, computePhase(snap));
  }
  tracker = setInterval(reassess, REASSESS_INTERVAL_MS);
}

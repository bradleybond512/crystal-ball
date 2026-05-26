/**
 * Threat-convergence bridge — decouples `ThreatConvergencePanel` from
 * the in-flight `claude/threat-convergence-detector` branch.
 *
 * The detector module is being built in parallel and is not yet on
 * `main`. Importing it statically would fail typecheck on this branch.
 * Instead, the panel imports this bridge; the detector module (when it
 * lands) calls `registerThreatConvergenceDetector()` once at module
 * load and the panel finds it via a `Symbol.for` slot on `globalThis`.
 *
 * The symbol slot is shared across module copies + isolated TS worlds,
 * so dev-hot-reload + the eventual production bundle both see the same
 * registration without an extra import.
 *
 * Type shapes mirror the detector branch's exports verbatim — they're
 * stable by contract. The bridge is pure (no DOM, no fetch).
 */

// ── Mirrored types (see threat-convergence-detector.ts on its branch) ──

export interface DomainElevation {
  domain: string;
  severity: number;
  timestamp: number;
}

export interface ConvergenceEvent {
  id: string;
  detectedAt: number;
  domains: string[];
  minSeverity: number;
  windowMs: number;
  /** 0-1; see formula in detector docstring. */
  score: number;
  label: string;
}

/** Minimal surface the panel needs. The real detector class implements
 *  this and additional internal-only methods. */
export interface ThreatConvergenceDetectorBridge {
  recordElevation(domain: string, severity: number, timestamp?: number): DomainElevation;
  detect(windowMs?: number, minSeverity?: number, minDomains?: number): ConvergenceEvent | null;
  getElevations(): DomainElevation[];
  getHistory(limit?: number): ConvergenceEvent[];
}

// ── Registration ──────────────────────────────────────────────────────

const SLOT = Symbol.for('crystalball.threatConvergenceDetector');

interface SlotHolder {
  [SLOT]?: ThreatConvergenceDetectorBridge | null;
}

function holder(): SlotHolder {
  return globalThis as unknown as SlotHolder;
}

/** Called once by the detector module on load. Idempotent — repeated
 *  calls overwrite the slot so HMR / test resets stay sane. */
export function registerThreatConvergenceDetector(impl: ThreatConvergenceDetectorBridge | null): void {
  holder()[SLOT] = impl;
}

/** Returns the registered detector, or `null` when the detector branch
 *  hasn't landed yet (or has been explicitly cleared for tests). */
export function getThreatConvergenceDetector(): ThreatConvergenceDetectorBridge | null {
  return holder()[SLOT] ?? null;
}

// ── Score → label / color helpers (used by both panel + tests) ────────

export const CRITICAL_FLOOR = 0.7;
export const THREAT_FLOOR = 0.4;

export function labelForScore(score: number): string {
  if (score > CRITICAL_FLOOR) return 'CRITICAL CONVERGENCE';
  if (score > THREAT_FLOOR) return 'THREAT CONVERGENCE';
  return 'ELEVATED CONVERGENCE';
}

export function colorForScore(score: number): string {
  if (score > CRITICAL_FLOOR) return '#ef4444'; // red-500
  if (score > THREAT_FLOOR) return '#f59e0b';   // amber-500
  return '#3b82f6';                             // blue-500
}

/** monitor / elevate / crisis recommendation derived from the score. */
export type ConvergenceRecommendation = 'monitor' | 'elevate' | 'crisis';

export function recommendationForScore(score: number): ConvergenceRecommendation {
  if (score > CRITICAL_FLOOR) return 'crisis';
  if (score > THREAT_FLOOR) return 'elevate';
  return 'monitor';
}

// ── Severity rendering ────────────────────────────────────────────────

export function severityLabel(severity: number): string {
  if (severity >= 4) return 'CRITICAL';
  if (severity >= 3) return 'HIGH';
  if (severity >= 2) return 'MEDIUM';
  if (severity >= 1) return 'LOW';
  return 'INFO';
}

export function severityColor(severity: number): string {
  if (severity >= 4) return '#ef4444';
  if (severity >= 3) return '#f59e0b';
  if (severity >= 2) return '#3b82f6';
  if (severity >= 1) return '#64748b';
  return '#94a3b8';
}

// ── ageMs → human label ───────────────────────────────────────────────

export function ageLabel(timestamp: number, now: number = Date.now()): string {
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

// ── Active-window stats ───────────────────────────────────────────────

export interface ActiveWindowStats {
  elevatedDomains: number;
  peakSeverity: number;
  msSinceLastElevation: number | null;
  /** Optional — present when an AlertFatigueDetector is reachable. */
  fatigueScore?: number;
}

export function computeActiveWindowStats(
  elevations: readonly DomainElevation[],
  windowMs: number,
  now: number = Date.now(),
): ActiveWindowStats {
  const cutoff = now - windowMs;
  const recent = elevations.filter((e) => e.timestamp >= cutoff);
  const domains = new Set<string>();
  let peak = 0;
  let mostRecent = -Infinity;
  for (const e of recent) {
    domains.add(e.domain);
    if (e.severity > peak) peak = e.severity;
    if (e.timestamp > mostRecent) mostRecent = e.timestamp;
  }
  return {
    elevatedDomains: domains.size,
    peakSeverity: peak,
    msSinceLastElevation: mostRecent === -Infinity ? null : Math.max(0, now - mostRecent),
  };
}

// ── Test seam ─────────────────────────────────────────────────────────

/** Reset the global slot. Tests-only — production code must not call. */
export function __resetThreatConvergenceBridgeForTests(): void {
  holder()[SLOT] = undefined;
}

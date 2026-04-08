/**
 * Threat Reactor — pure scoring + tiny event emitter. Evaluates incoming
 * normalized cyber threats against the user's DeviceFingerprint and emits
 * ReactorAlert events for relevant matches. Dedupes via an in-memory map
 * with a 24h window.
 */

import type { DeviceFingerprint } from './device-identity';

export type RelevanceReason =
  | 'asn_match'
  | 'country_critical'
  | 'platform_targeted'
  | 'high_severity';

export interface RelevanceScore {
  score: number;
  reason: RelevanceReason;
  explanation: string;
}

export interface NormalizedThreat {
  id: string;
  source: string;
  indicator: string;
  indicatorType: 'ip' | 'domain' | 'url' | 'cve' | 'asn';
  severity: 'low' | 'medium' | 'high' | 'critical';
  country?: string;
  asn?: number;
  malwareFamily?: string;
  tags?: string[];
  lat?: number;
  lon?: number;
  title: string;
  body: string;
  firstSeen?: number;
  lastSeen?: number;
}

export interface ReactorAlert {
  threat: NormalizedThreat;
  relevance: RelevanceScore;
  alertId: string;
  createdAt: number;
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MACOS_MARKERS = ['macos', 'osx', 'apple', 'ios'];
const HIGH_SET = new Set(['high', 'critical']);

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
 hash = Math.trunc((hash << 5) + hash + (input.codePointAt(i) ?? 0));
  }
  return (hash >>> 0).toString(36);
}

function hasMacosMarker(threat: NormalizedThreat): boolean {
  const tags = new Set((threat.tags ?? []).map((t) => t.toLowerCase()));
  const fam = (threat.malwareFamily ?? '').toLowerCase();
  return MACOS_MARKERS.some((m) => tags.has(m) || fam.includes(m));
}

export function evaluateThreat(
  threat: NormalizedThreat,
  device: DeviceFingerprint,
): RelevanceScore | null {
  if (
 device.asn != null &&
 typeof threat.asn === 'number' &&
 threat.asn === device.asn
  ) {
 return {
 score: 100,
 reason: 'asn_match',
 explanation: `Threat targets your network (AS${device.asn})`,
 };
  }
  if (device.os === 'macos' && hasMacosMarker(threat)) {
 return {
 score: 60,
 reason: 'platform_targeted',
 explanation: 'Threat targets macOS',
 };
  }
  if (
 device.country &&
 threat.country &&
 threat.country === device.country &&
 HIGH_SET.has(threat.severity)
  ) {
 return {
 score: 40,
 reason: 'country_critical',
 explanation: `${threat.severity} threat in your country (${device.country})`,
 };
  }
  if (HIGH_SET.has(threat.severity)) {
 return {
 score: 30,
 reason: 'high_severity',
 explanation: `${threat.severity} severity threat`,
 };
  }
  return null;
}

type AlertHandler = (alert: ReactorAlert) => void;

const subscribers = new Set<AlertHandler>();
const dedupe = new Map<string, number>();
let clock: () => number = Date.now;

export function onAlert(handler: AlertHandler): () => void {
  subscribers.add(handler);
  return () => {
 subscribers.delete(handler);
  };
}

function pruneDedupe(nowMs: number): void {
  for (const [key, ts] of dedupe) {
 if (nowMs - ts > DEDUPE_WINDOW_MS) dedupe.delete(key);
  }
}

async function defaultFingerprintProvider(): Promise<DeviceFingerprint> {
  const override = (
 globalThis as unknown as {
 __wmReactorFingerprint?: () => Promise<DeviceFingerprint>;
 }
  ).__wmReactorFingerprint;
  if (typeof override === 'function') return override();
  const mod = await import('./device-identity');
  return mod.getDeviceFingerprint();
}

export async function ingest(
  threats: NormalizedThreat[],
  fingerprintProvider: () => Promise<DeviceFingerprint> = defaultFingerprintProvider,
): Promise<ReactorAlert[]> {
  const device = await fingerprintProvider();
  const nowMs = clock();
  pruneDedupe(nowMs);
  const emitted: ReactorAlert[] = [];
  for (const threat of threats) {
 let relevance: RelevanceScore | null;
 try {
 relevance = evaluateThreat(threat, device);
 } catch {
 continue;
 }
 if (!relevance) continue;
 const alertId = djb2(`${threat.source}:${threat.indicator}`);
 const last = dedupe.get(alertId);
 if (last != null && nowMs - last <= DEDUPE_WINDOW_MS) continue;
 dedupe.set(alertId, nowMs);
 const alert: ReactorAlert = {
 threat,
 relevance,
 alertId,
 createdAt: nowMs,
 };
 emitted.push(alert);
 for (const sub of subscribers) {
 try {
 sub(alert);
 } catch {
 // isolate subscriber failures
 }
 }
  }
  return emitted;
}

export function __setClockForTesting(fn: () => number): void {
  clock = fn;
}

export function __resetForTesting(): void {
  subscribers.clear();
  dedupe.clear();
}

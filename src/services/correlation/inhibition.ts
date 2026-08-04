import type { InhibitoryLeadLagEdge } from './lead-lag';

export const INHIBITION_REFRESH_INTERVAL_MS = 60 * 60_000;
export const INHIBITION_TTL_MS = 2 * INHIBITION_REFRESH_INTERVAL_MS;
export const MAX_INHIBITORY_EVIDENCE = 12;
export const MAX_INHIBITION_SHADOW_EVENTS = 1000;
export const INHIBITION_SETTING_KEY = 'wm-correlation-inhibition-enabled';

export interface InhibitoryEvidence extends InhibitoryLeadLagEdge {
  criticalAbsZ: number;
}

export interface InhibitorySnapshot {
  readonly evidence: readonly Readonly<InhibitoryEvidence>[];
  readonly publishedAt: number;
  readonly expiresAt: number;
}

export interface InhibitionShadowEvent {
  domain: string;
  at: number;
}

export interface InhibitionShadowSummary {
  evidenceEvaluated: number;
  confirmed: number;
  refuted: number;
  pending: number;
}

export interface InhibitionShadowDiagnostics extends InhibitionShadowSummary {
  status: 'unavailable' | 'fresh' | 'stale' | 'disabled' | 'error';
  evaluatedAt: number | null;
  snapshotPublishedAt: number | null;
}

let activeSnapshot: InhibitorySnapshot | null = null;
let shadowDiagnostics = emptyShadowDiagnostics();
const NEUTRAL_SNAPSHOT: InhibitorySnapshot = Object.freeze({
  evidence: Object.freeze([]),
  publishedAt: 0,
  expiresAt: 0,
});

export function replaceInhibitorySnapshot(
  edges: readonly InhibitoryLeadLagEdge[],
  criticalAbsZ: number,
  publishedAt: number = Date.now(),
): InhibitorySnapshot {
  if (!Number.isFinite(publishedAt)) {
    invalidateInhibitorySnapshot();
    return NEUTRAL_SNAPSHOT;
  }
  const evidence = validEvidence(edges, criticalAbsZ)
    .sort(compareEvidence)
    .slice(0, MAX_INHIBITORY_EVIDENCE)
    .map((item) => Object.freeze(item));
  if (evidence.length === 0) {
    invalidateInhibitorySnapshot();
    return NEUTRAL_SNAPSHOT;
  }
  const snapshot = Object.freeze({
    evidence: Object.freeze(evidence),
    publishedAt,
    expiresAt: publishedAt + INHIBITION_TTL_MS,
  });
  activeSnapshot = snapshot;
  return snapshot;
}

export function clearInhibitorySnapshot(): void {
  activeSnapshot = null;
}

export function invalidateInhibitorySnapshot(): void {
  activeSnapshot = null;
  shadowDiagnostics = emptyShadowDiagnostics();
}

export function getInhibitorySnapshot(
  now: number = Date.now(),
  enabled: boolean = readInhibitionEnabled(),
): InhibitorySnapshot | null {
  if (!enabled) {
    clearInhibitorySnapshot();
    return null;
  }
  if (!activeSnapshot || !Number.isFinite(now) || now > activeSnapshot.expiresAt) return null;
  return activeSnapshot;
}

export function readInhibitionEnabled(
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): boolean {
  try {
    return storage?.getItem(INHIBITION_SETTING_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function evaluateInhibitionShadow(
  events: readonly InhibitionShadowEvent[],
  snapshot: InhibitorySnapshot | null,
  now: number,
): InhibitionShadowSummary {
  if (!validSnapshot(snapshot)
    || !Number.isFinite(now)
    || now < snapshot.publishedAt
    || now > snapshot.expiresAt) {
    return emptyShadowSummary();
  }

  const valid = snapshot.evidence.filter((evidence) => validPublishedEvidence(evidence));
  if (valid.length === 0) return emptyShadowSummary();
  const byDomain = boundedEventsByDomain(events, valid, snapshot.publishedAt, now);
  let confirmed = 0;
  let refuted = 0;
  let pending = 0;
  for (const evidence of valid) {
    const consequents = byDomain.get(evidence.to) ?? [];
    for (const antecedentAt of byDomain.get(evidence.from) ?? []) {
      const windowEnd = antecedentAt + evidence.windowMs;
      if (hasFollowingWithin(consequents, antecedentAt, windowEnd)) refuted += 1;
      else if (now < windowEnd) pending += 1;
      else confirmed += 1;
    }
  }
  return { evidenceEvaluated: valid.length, confirmed, refuted, pending };
}

export function evaluateActiveInhibitionShadow(
  events: readonly InhibitionShadowEvent[],
  now: number,
  enabled: boolean,
): InhibitionShadowDiagnostics {
  if (!enabled) return setShadowStatus('disabled', now, null);
  if (!activeSnapshot) return setShadowStatus('unavailable', now, null);
  if (!Number.isFinite(now) || !validSnapshot(activeSnapshot) || now < activeSnapshot.publishedAt) {
    return setShadowStatus('error', now, activeSnapshot);
  }
  if (now > activeSnapshot.expiresAt) return setShadowStatus('stale', now, activeSnapshot);
  const summary = evaluateInhibitionShadow(events, activeSnapshot, now);
  shadowDiagnostics = Object.freeze({
    status: 'fresh',
    evaluatedAt: now,
    snapshotPublishedAt: activeSnapshot.publishedAt,
    ...summary,
  });
  return shadowDiagnostics;
}

export function recordInhibitionShadowError(now: number): void {
  setShadowStatus('error', now, activeSnapshot);
}

export function getInhibitionShadowDiagnostics(): InhibitionShadowDiagnostics {
  return shadowDiagnostics;
}

export function __resetInhibitionShadowDiagnosticsForTests(): void {
  shadowDiagnostics = emptyShadowDiagnostics();
}

function validEvidence(
  edges: readonly InhibitoryLeadLagEdge[],
  criticalAbsZ: number,
): InhibitoryEvidence[] {
  if (!Number.isFinite(criticalAbsZ) || criticalAbsZ <= 0) return [];
  const deduped = new Map<string, InhibitoryEvidence>();
  for (const edge of edges) {
    if (!validEdge(edge)) continue;
    const item = { ...edge, criticalAbsZ };
    if (!validPublishedEvidence(item)) continue;
    const key = `${edge.from}\u0000${edge.to}`;
    const existing = deduped.get(key);
    if (!existing || compareEvidence(item, existing) < 0) deduped.set(key, item);
  }
  return [...deduped.values()];
}

function validEdge(edge: InhibitoryLeadLagEdge): boolean {
  return edge?.effect === 'inhibitory'
    && validDomain(edge.from)
    && validDomain(edge.to)
    && edge.from !== edge.to
    && Number.isFinite(edge.windowMs)
    && edge.windowMs > 0
    && Number.isInteger(edge.support)
    && edge.support >= 0
    && Number.isInteger(edge.antecedents)
    && edge.antecedents > 0
    && edge.support <= edge.antecedents
    && finiteUnit(edge.followRate)
    && finiteUnit(edge.expectedRate)
    && Number.isFinite(edge.lift)
    && edge.lift >= 0
    && Number.isFinite(edge.zScore)
    && edge.zScore < 0
    && finiteUnit(edge.strength)
    && typeof edge.explanation === 'string'
    && edge.explanation.length > 0;
}

function validPublishedEvidence(evidence: Readonly<InhibitoryEvidence>): boolean {
  return validEdge(evidence)
    && Number.isFinite(evidence.criticalAbsZ)
    && evidence.criticalAbsZ > 0
    && evidence.antecedents >= 5
    && evidence.expectedRate >= 0.2
    && evidence.lift <= 0.5
    && evidence.zScore <= -Math.max(2, evidence.criticalAbsZ);
}

function validSnapshot(snapshot: InhibitorySnapshot | null): snapshot is InhibitorySnapshot {
  return snapshot !== null
    && Number.isFinite(snapshot.publishedAt)
    && Number.isFinite(snapshot.expiresAt)
    && snapshot.expiresAt >= snapshot.publishedAt;
}

function validDomain(domain: string): boolean {
  return typeof domain === 'string' && domain.length > 0;
}

function compareEvidence(a: InhibitoryEvidence, b: InhibitoryEvidence): number {
  return Math.abs(b.zScore) - Math.abs(a.zScore)
    || a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
    || a.windowMs - b.windowMs;
}

function boundedEventsByDomain(
  events: readonly InhibitionShadowEvent[],
  evidence: readonly Readonly<InhibitoryEvidence>[],
  publishedAt: number,
  now: number,
): Map<string, number[]> {
  const domains = [...new Set(evidence.flatMap((item) => [item.from, item.to]))]
    .sort((a, b) => a.localeCompare(b));
  const baseBudget = Math.floor(MAX_INHIBITION_SHADOW_EVENTS / domains.length);
  const remainder = MAX_INHIBITION_SHADOW_EVENTS % domains.length;
  const budgets = new Map(domains.map((domain, index) => [
    domain,
    baseBudget + (index < remainder ? 1 : 0),
  ]));
  const byDomain = new Map(domains.map((domain) => [domain, [] as number[]]));
  let retained = 0;
  for (const event of events) {
    const budget = budgets.get(event.domain);
    if (!budget
      || !Number.isFinite(event.at)
      || event.at < publishedAt
      || event.at > now) continue;
    const times = byDomain.get(event.domain)!;
    if (retained < MAX_INHIBITION_SHADOW_EVENTS) {
      pushTime(times, event.at);
      retained += 1;
      continue;
    }
    const underBudget = times.length < budget;
    const evictionDomain = oldestEvictableDomain(domains, byDomain, budgets, event.domain, underBudget);
    if (!evictionDomain) continue;
    const evictionTimes = byDomain.get(evictionDomain)!;
    const oldest = evictionTimes[0]!;
    if (!underBudget && compareShadowEvent(event.domain, event.at, evictionDomain, oldest) <= 0) continue;
    popOldestTime(evictionTimes);
    pushTime(times, event.at);
  }
  for (const times of byDomain.values()) times.sort((a, b) => a - b);
  return byDomain;
}

function oldestEvictableDomain(
  domains: readonly string[],
  byDomain: ReadonlyMap<string, number[]>,
  budgets: ReadonlyMap<string, number>,
  incomingDomain: string,
  incomingUnderBudget: boolean,
): string | null {
  let oldestDomain: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const domain of domains) {
    const times = byDomain.get(domain)!;
    const overBudget = times.length > budgets.get(domain)!;
    if (!overBudget && (incomingUnderBudget || domain !== incomingDomain)) continue;
    const at = times[0];
    if (at === undefined) continue;
    if (compareShadowEvent(domain, at, oldestDomain, oldestAt) < 0) {
      oldestDomain = domain;
      oldestAt = at;
    }
  }
  return oldestDomain;
}

function compareShadowEvent(
  domain: string,
  at: number,
  otherDomain: string | null,
  otherAt: number,
): number {
  return at - otherAt || (otherDomain === null ? -1 : domain.localeCompare(otherDomain));
}

function pushTime(times: number[], at: number): void {
  times.push(at);
  let child = times.length - 1;
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2);
    if (times[parent]! <= times[child]!) break;
    [times[parent], times[child]] = [times[child]!, times[parent]!];
    child = parent;
  }
}

function popOldestTime(times: number[]): void {
  const last = times.pop();
  if (times.length === 0 || last === undefined) return;
  times[0] = last;
  let parent = 0;
  while (true) {
    const left = parent * 2 + 1;
    if (left >= times.length) return;
    const right = left + 1;
    const child = right < times.length && times[right]! < times[left]! ? right : left;
    if (times[parent]! <= times[child]!) return;
    [times[parent], times[child]] = [times[child]!, times[parent]!];
    parent = child;
  }
}

function hasFollowingWithin(
  consequents: readonly number[],
  antecedentAt: number,
  windowEnd: number,
): boolean {
  let low = 0;
  let high = consequents.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (consequents[mid]! <= antecedentAt) low = mid + 1;
    else high = mid;
  }
  return low < consequents.length && consequents[low]! <= windowEnd;
}

function emptyShadowSummary(): InhibitionShadowSummary {
  return { evidenceEvaluated: 0, confirmed: 0, refuted: 0, pending: 0 };
}

function emptyShadowDiagnostics(): InhibitionShadowDiagnostics {
  return Object.freeze({
    status: 'unavailable',
    evaluatedAt: null,
    snapshotPublishedAt: null,
    ...emptyShadowSummary(),
  });
}

function setShadowStatus(
  status: Exclude<InhibitionShadowDiagnostics['status'], 'fresh'>,
  now: number,
  snapshot: InhibitorySnapshot | null,
): InhibitionShadowDiagnostics {
  shadowDiagnostics = Object.freeze({
    status,
    evaluatedAt: Number.isFinite(now) ? now : null,
    snapshotPublishedAt: snapshot && Number.isFinite(snapshot.publishedAt)
      ? snapshot.publishedAt
      : null,
    ...emptyShadowSummary(),
  });
  return shadowDiagnostics;
}

function safeStorage(): Pick<Storage, 'getItem'> | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function finiteUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

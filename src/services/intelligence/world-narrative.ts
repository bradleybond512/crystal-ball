/**
 * WorldNarrativeEngine — generate plain-English "state of the world"
 * synthesis paragraphs from the current intelligence picture without
 * requiring an LLM. Per-domain templates slot in real entity names,
 * counts, and severity labels from the supplied observations.
 *
 * Pure deterministic; no DOM, no fetch.
 */

import type { ObservationEvent } from './observation-adapters';
import type { Situation } from './situation-store-v2';

// ── Public types ─────────────────────────────────────────────────────

export type PulseLabel = 'nominal' | 'elevated' | 'stressed' | 'critical';

export interface NarrativeSection {
  title: string;
  body: string;
  severity: string;
  domain: string;
  confidence: number;
}

export interface WorldNarrative {
  generatedAt: number;
  headline: string;
  executiveSummary: string;
  sections: NarrativeSection[];
  dominantTheme: string;
  outlookSentence: string;
  situationCount: number;
  criticalAlertCount: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WorldNarrativeEngineOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

const DEFAULT_CAPACITY = 100;
const DEFAULT_HISTORY_LIMIT = 10;
const MAX_SECTIONS = 3;
export const STORAGE_KEY = 'wm-world-narrative';

// ── Pulse-like scoring (mirrors CivilizationPulse intent without
//     importing the singleton, so tests stay hermetic) ──────────────

const SEVERITY_PENALTY: Record<string, number> = {
  CRITICAL: 15, HIGH: 8, MEDIUM: 3, LOW: 1, INFO: 0,
};

function pulseScoreFor(observations: readonly ObservationEvent[]): number {
  const byDomain = new Map<string, number>();
  for (const obs of observations) {
    const prior = byDomain.get(obs.domain) ?? 0;
    byDomain.set(obs.domain, prior + (SEVERITY_PENALTY[obs.severity] ?? 0));
  }
  if (byDomain.size === 0) return 100;
  let totalScore = 0;
  for (const penalty of byDomain.values()) totalScore += Math.max(0, 100 - penalty);
  return Math.round(totalScore / byDomain.size);
}

function labelFor(score: number): PulseLabel {
  if (score >= 75) return 'nominal';
  if (score >= 50) return 'elevated';
  if (score >= 25) return 'stressed';
  return 'critical';
}

// ── Per-domain templates ─────────────────────────────────────────────

interface DomainTemplate {
  title: string;
  buildBody(stress: DomainStress, region: string): string;
}

interface DomainStress {
  domain: string;
  severity: string;
  count: number;
  observations: ObservationEvent[];
  entityIds: string[];
  topTitle: string;
}

const TEMPLATES: Record<string, DomainTemplate> = {
  earthquake: {
    title: 'Seismic activity',
    buildBody: (s, region) =>
      `Seismic activity is ${labelLowerCase(s.severity)} in ${region}, with ${s.count} ` +
      `event${s.count === 1 ? '' : 's'} recorded in the last hour. ` +
      `${describeEntity(s, 'The strongest signal was')} (${s.topTitle}). ` +
      `Magnitude trends and depth distribution suggest aftershock probability remains a watch item.`,
  },
  weather: {
    title: 'Severe weather',
    buildBody: (s, region) =>
      `Weather conditions over ${region} are ${labelLowerCase(s.severity)} with ${s.count} ` +
      `active alert${s.count === 1 ? '' : 's'}. ` +
      `${describeEntity(s, 'Forecasters are tracking')} (${s.topTitle}). ` +
      `Wind and precipitation intensity remain the dominant escalation drivers.`,
  },
  biosurveillance: {
    title: 'Biosurveillance',
    buildBody: (s, region) =>
      `Biosurveillance signals across ${region} are ${labelLowerCase(s.severity)} with ${s.count} ` +
      `outbreak-class observation${s.count === 1 ? '' : 's'} in the window. ` +
      `${describeEntity(s, 'Latest disease intelligence flagged')} (${s.topTitle}). ` +
      `Wastewater and case-count divergence remains the primary R0-amplification watch.`,
  },
  cyber: {
    title: 'Cyber posture',
    buildBody: (s, region) =>
      `Cyber posture is ${labelLowerCase(s.severity)} with ${s.count} ` +
      `CVE / threat-actor signal${s.count === 1 ? '' : 's'} in flight across ${region}. ` +
      `${describeEntity(s, 'Notable vulnerability or campaign:')} (${s.topTitle}). ` +
      `KEV listings and exploited-vulnerability flags drive prioritization.`,
  },
  maritime: {
    title: 'Maritime activity',
    buildBody: (s, region) =>
      `Maritime activity is ${labelLowerCase(s.severity)} with ${s.count} ` +
      `vessel or AIS signal${s.count === 1 ? '' : 's'} in ${region}. ` +
      `${describeEntity(s, 'Tracked vessel of interest:')} (${s.topTitle}). ` +
      `Chokepoint density and AIS-spoofing risk remain the primary watch items.`,
  },
  aviation: {
    title: 'Aviation operations',
    buildBody: (s, region) =>
      `Aviation operations show ${labelLowerCase(s.severity)} activity with ${s.count} ` +
      `aircraft or airspace signal${s.count === 1 ? '' : 's'} across ${region}. ` +
      `${describeEntity(s, 'Active flight focus:')} (${s.topTitle}). ` +
      `Airspace-closure cascades and squawk anomalies remain the primary watch.`,
  },
  'space-weather': {
    title: 'Space weather',
    buildBody: (s) =>
      `Space weather is ${labelLowerCase(s.severity)} with ${s.count} ` +
      `geomagnetic or coronal signal${s.count === 1 ? '' : 's'} active. ` +
      `${describeEntity(s, 'Latest SWPC product:')} (${s.topTitle}). ` +
      `Kp index trend and X-ray flux class drive infrastructure-anomaly risk.`,
  },
  geopolitical: {
    title: 'Geopolitical pressure',
    buildBody: (s, region) =>
      `Geopolitical pressure is ${labelLowerCase(s.severity)} across ${region} with ${s.count} ` +
      `diplomatic or conflict-related signal${s.count === 1 ? '' : 's'}. ` +
      `${describeEntity(s, 'Most prominent driver:')} (${s.topTitle}). ` +
      `Sanctions activity and force-posture changes remain the watch frame.`,
  },
};

const GENERIC_TEMPLATE: DomainTemplate = {
  title: 'Domain activity',
  buildBody: (s, region) =>
    `${capitalize(s.domain)} activity is ${labelLowerCase(s.severity)} with ${s.count} ` +
    `signal${s.count === 1 ? '' : 's'} across ${region}. ` +
    `${describeEntity(s, 'Most prominent signal:')} (${s.topTitle}).`,
};

function describeEntity(s: DomainStress, prefix: string): string {
  if (s.entityIds.length > 0) return `${prefix} ${s.entityIds.slice(0, 2).join(', ')}`;
  return `${prefix} the lead observation`;
}

function capitalize(word: string): string {
  if (word.length === 0) return word;
  return word[0]!.toUpperCase() + word.slice(1);
}

function labelLowerCase(severity: string): string {
  return severity.toLowerCase();
}

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedState {
  history: WorldNarrative[];
  priorScore: number | null;
}

export class WorldNarrativeEngine {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly history: WorldNarrative[] = [];
  private priorScore: number | null = null;
  private readonly subscribers = new Set<(n: WorldNarrative) => void>();

  constructor(opts: WorldNarrativeEngineOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  generate(observations: readonly ObservationEvent[], situations: readonly Situation[]): WorldNarrative {
    const generatedAt = this.clock();
    const stresses = collectDomainStress(observations);
    const score = pulseScoreFor(observations);
    const label = labelFor(score);
    const sections = stresses.slice(0, MAX_SECTIONS).map((s) => buildSection(s));
    const criticalAlertCount = observations.filter((o) => o.severity === 'CRITICAL').length;
    const dominantTheme = stresses[0]?.domain ?? 'global posture';

    const narrative: WorldNarrative = {
      generatedAt,
      headline: buildHeadline(stresses, label, generatedAt),
      executiveSummary: buildExecutiveSummary(stresses, situations, label, criticalAlertCount),
      sections,
      dominantTheme: dominantTheme === 'global posture'
        ? 'Global posture is quiet — no domain dominating activity'
        : `${capitalize(dominantTheme)} is the dominant theme this cycle`,
      outlookSentence: buildOutlook(this.priorScore, score),
      situationCount: situations.length,
      criticalAlertCount,
    };

    this.history.push(narrative);
    while (this.history.length > this.capacity) this.history.shift();
    this.priorScore = score;
    this.persist();
    for (const cb of this.subscribers) cb(narrative);
    return narrative;
  }

  getLatestNarrative(): WorldNarrative | undefined {
    return this.history.length === 0 ? undefined : this.history[this.history.length - 1];
  }

  getHistory(limit: number = DEFAULT_HISTORY_LIMIT): WorldNarrative[] {
    if (limit >= this.history.length) return [...this.history];
    return this.history.slice(this.history.length - limit);
  }

  subscribe(cb: (n: WorldNarrative) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: (n: WorldNarrative) => void): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.history.length = 0;
    this.priorScore = null;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed || !Array.isArray(parsed.history)) return;
      for (const n of parsed.history) this.history.push(n);
      while (this.history.length > this.capacity) this.history.shift();
      this.priorScore = parsed.priorScore ?? null;
    } catch {
      this.history.length = 0;
      this.priorScore = null;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedState = { history: this.history, priorScore: this.priorScore };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: WorldNarrativeEngine | undefined;

export function getWorldNarrativeEngine(): WorldNarrativeEngine {
  singleton ??= new WorldNarrativeEngine();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Stress aggregation ─────────────────────────────────────────────

function collectDomainStress(observations: readonly ObservationEvent[]): DomainStress[] {
  const byDomain = new Map<string, ObservationEvent[]>();
  for (const obs of observations) {
    const list = byDomain.get(obs.domain);
    if (list) list.push(obs);
    else byDomain.set(obs.domain, [obs]);
  }
  const out: DomainStress[] = [];
  for (const [domain, obs] of byDomain) {
    // The total penalty is reflected via (severity rank × count) in
    // the sort below, so we only need to pick the top observation here.
    let topPenalty = -1;
    let top: ObservationEvent | null = null;
    const entityIds = new Set<string>();
    for (const o of obs) {
      const penalty = SEVERITY_PENALTY[o.severity] ?? 0;
      if (penalty > topPenalty) {
        topPenalty = penalty;
        top = o;
      }
      for (const eid of o.entityIds) entityIds.add(eid);
    }
    out.push({
      domain,
      severity: top?.severity ?? 'INFO',
      count: obs.length,
      observations: obs,
      entityIds: [...entityIds],
      topTitle: top?.title ?? 'untitled observation',
    });
  }
  out.sort((a, b) => {
    const aPenalty = severityRank(a.severity) * 10 + Math.min(9, a.count);
    const bPenalty = severityRank(b.severity) * 10 + Math.min(9, b.count);
    return bPenalty - aPenalty;
  });
  return out;
}

function severityRank(severity: string): number {
  switch (severity) {
    case 'CRITICAL': { return 4;
    }
    case 'HIGH': {     return 3;
    }
    case 'MEDIUM': {   return 2;
    }
    case 'LOW': {      return 1;
    }
    default: {         return 0;
    }
  }
}

// ── Section / headline / summary / outlook builders ────────────────

function buildSection(stress: DomainStress): NarrativeSection {
  const template = TEMPLATES[stress.domain] ?? GENERIC_TEMPLATE;
  const region = inferRegion(stress);
  return {
    title: template.title,
    body: template.buildBody(stress, region),
    severity: stress.severity,
    domain: stress.domain,
    confidence: confidenceFor(stress),
  };
}

function confidenceFor(stress: DomainStress): number {
  // More observations → higher confidence we're characterizing the
  // domain accurately. Caps at 0.95 because we never have full ground
  // truth from observations alone.
  const c = 0.55 + Math.min(0.4, stress.count * 0.05);
  return Number(c.toFixed(2));
}

function inferRegion(stress: DomainStress): string {
  if (stress.entityIds.length > 0) {
    // Treat the first entity id prefix as a region hint (e.g. "JP-04" → "JP").
    const first = stress.entityIds[0]!;
    const prefix = first.split('-')[0] ?? first;
    if (prefix.length <= 3) return prefix;
  }
  return 'the affected region';
}

function buildHeadline(stresses: readonly DomainStress[], label: PulseLabel, generatedAt: number): string {
  const time = new Date(generatedAt).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
  if (stresses.length === 0) {
    return `Global picture is quiet and nominal as of ${time}.`;
  }
  const topDomains = stresses.slice(0, 2).map((s) => s.domain).join(' + ');
  return `Activity in ${topDomains} elevated global posture to ${label} as of ${time}.`;
}

function buildExecutiveSummary(
  stresses: readonly DomainStress[],
  situations: readonly Situation[],
  label: PulseLabel,
  criticalAlertCount: number,
): string {
  if (stresses.length === 0 && situations.length === 0) {
    return 'No notable domain activity in the current window. Pulse is nominal. ' +
      'Standard watchlist monitoring continues; no escalation drivers detected.';
  }
  const parts: string[] = [ `Global pulse is ${label} with ${stresses.length} active domain${stresses.length === 1 ? '' : 's'} in play.`];
  if (criticalAlertCount > 0) {
    parts.push(`${criticalAlertCount} critical-severity observation${criticalAlertCount === 1 ? '' : 's'} drove the elevation.`);
  }
  if (situations.length > 0) {
    parts.push(`${situations.length} tracked situation${situations.length === 1 ? '' : 's'} remain under active monitoring.`);
  }
  if (stresses.length > 0) {
    const top = stresses[0]!;
    parts.push(`Top stressor: ${top.domain} (${top.count} observation${top.count === 1 ? '' : 's'} at ${top.severity}).`);
  }
  return parts.join(' ');
}

function buildOutlook(prior: number | null, current: number): string {
  if (prior === null) {
    return current >= 75
      ? 'Outlook is stable; conditions are holding steady at nominal levels.'
      : 'Outlook reflects current conditions; no prior baseline yet to compare trajectory.';
  }
  const delta = current - prior;
  if (delta > 5) {
    return 'Outlook is improving — pulse score has recovered relative to the prior reading.';
  }
  if (delta < -5) {
    return 'Outlook is deteriorating — pulse score has declined relative to the prior reading.';
  }
  return 'Outlook is stable — pulse score is holding within ±5 of the prior reading.';
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

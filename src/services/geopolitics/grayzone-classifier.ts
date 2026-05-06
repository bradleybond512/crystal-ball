/**
 * Gray Zone Classifier — per Batch 2 of the cyber/geo plan.
 *
 * Classifies sub-kinetic great-power conflict from existing data
 * streams: sanctions, cyber attacks, proxy warfare, disinformation,
 * economic coercion, infrastructure sabotage. No new data ingestion —
 * the engine accepts pre-normalised inputs from existing handlers
 * (OpenSanctions, CISA, ACLED, GDELT) and emits typed events.
 *
 * Pure deterministic. No DOM, no fetch, no globals. Static great-power
 * "interest map" for proxy-warfare attribution. JSON-serializable
 * outputs. Pattern detection groups same-actor sequences within a
 * 30-day window into GrayZonePatterns.
 */

// ── Public types ───────────────────────────────────────────────────────

export type GrayZoneEventType =
  | 'sanctions'
  | 'cyber_attack'
  | 'proxy_warfare'
  | 'disinformation'
  | 'economic_coercion'
  | 'infrastructure_sabotage';

export type GreatPowerActor = 'Russia' | 'China' | 'Iran' | 'North Korea' | 'United States' | 'Unknown';

export type GrayZoneSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface GrayZoneEvent {
  /** Stable id — the engine generates `gz-<hash>` from the inputs. */
  id: string;
  type: GrayZoneEventType;
  /** ISO 8601. */
  date: string;
  suspectedActor: GreatPowerActor;
  /** ISO country / region label of the affected target. */
  targetCountry: string;
  /** [0, 1]; combines source-confidence with attribution-strength. */
  confidence: number;
  /** Free-text evidence references the analyst can verify. */
  evidence: readonly string[];
  severity: GrayZoneSeverity;
  /** Free-text summary for the timeline cell. */
  summary: string;
}

export interface GrayZonePattern {
  /** Stable id derived from the participant set. */
  id: string;
  actors: readonly GreatPowerActor[];
  /** Ordered (oldest first) event ids in the sequence. */
  eventSequence: readonly string[];
  /** Earliest event ISO date. */
  startDate: string;
  /** Latest event ISO date. */
  endDate: string;
  interpretation: string;
}

// ── Static great-power interest map ────────────────────────────────────

/** Where each great power has clear current proxy/operational interests.
 *  Used for proxy-warfare attribution: an ACLED non-state event in one
 *  of these countries gets routed to the corresponding actor. Static
 *  on purpose — geopolitics changes slowly enough that hardcoding the
 *  map (and reviewing in PR) is safer than a dynamic feed that could
 *  silently drift.
 *
 *  Reviewed/updated 2026-05-05; future shifts (e.g. new theatres) get
 *  added via PR review. Multi-actor countries are listed under every
 *  power that has skin in the game. */
export const GREAT_POWER_INTERESTS: Readonly<Record<Exclude<GreatPowerActor, 'Unknown'>, readonly string[]>> = {
  Russia: ['Ukraine', 'Syria', 'Mali', 'Central African Republic', 'Libya', 'Sudan', 'Belarus', 'Georgia'],
  China: ['Taiwan', 'South China Sea', 'Philippines', 'Vietnam', 'Solomon Islands', 'Ethiopia', 'Djibouti', 'Pakistan', 'Myanmar', 'Nepal'],
  Iran: ['Yemen', 'Lebanon', 'Iraq', 'Syria', 'Bahrain', 'Saudi Arabia', 'Israel'],
  'North Korea': ['South Korea', 'Japan'],
  'United States': ['Ukraine', 'Taiwan', 'Israel', 'Saudi Arabia', 'Philippines', 'Japan', 'South Korea', 'Iraq'],
};

/** Reverse map: country → set of actors with stated interest. */
function buildCountryInterestMap(): Map<string, Set<GreatPowerActor>> {
  const out = new Map<string, Set<GreatPowerActor>>();
  for (const [actor, countries] of Object.entries(GREAT_POWER_INTERESTS) as [GreatPowerActor, readonly string[]][]) {
    for (const c of countries) {
      if (!out.has(c)) out.set(c, new Set());
      out.get(c)!.add(actor);
    }
  }
  return out;
}
const COUNTRY_TO_ACTORS = buildCountryInterestMap();

// ── Inputs ──────────────────────────────────────────────────────────────

export interface SanctionsEntry {
  date: string;
  /** Sanctioning party (e.g. "United States", "EU"). */
  sender: string;
  /** Targeted country / entity. */
  target: string;
  summary: string;
}

export interface CyberIncident {
  date: string;
  /** Suspected attribution if any (free text). */
  attribution?: string;
  /** Targeted country / sector. */
  target: string;
  summary: string;
  severity: GrayZoneSeverity;
}

export interface AcledLikeEvent {
  date: string;
  country: string;
  actor1?: string;
  actor2?: string;
  /** Whether either actor is a non-state entity. */
  hasNonStateActor: boolean;
  summary: string;
}

export interface GdeltLikeArticle {
  date: string;
  /** CAMEO root code as a string (e.g. "172", "045"). */
  cameoCode?: string;
  /** Article country (location of event, not source). */
  country?: string;
  /** 7-day baseline volume on the same CAMEO code, in articles/day. */
  baselineVolumePerDay?: number;
  /** Today's volume on the same CAMEO code. */
  observedVolumePerDay?: number;
  title: string;
  url?: string;
}

export interface InfrastructureKeywordHit {
  date: string;
  country: string;
  /** Keyword that triggered the match (cable, pipeline, grid, etc.). */
  keyword: string;
  title: string;
  url?: string;
  /** Suspected attribution if the article names one. */
  attribution?: string;
}

// ── Classifiers ────────────────────────────────────────────────────────

export function classifySanctions(entry: SanctionsEntry): GrayZoneEvent {
  const actor = normalizeActor(entry.sender);
  return {
    id: hashId('sanctions', entry.date, entry.sender, entry.target),
    type: 'sanctions',
    date: entry.date,
    suspectedActor: actor,
    targetCountry: entry.target,
    confidence: 0.95, // sanctions are formally announced — high confidence on the fact + actor
    evidence: [entry.summary],
    severity: 'medium',
    summary: `${entry.sender} sanctioned ${entry.target}`,
  };
}

export function classifyCyber(incident: CyberIncident): GrayZoneEvent {
  const actor = normalizeActor(incident.attribution ?? 'Unknown');
  // Confidence depends on whether attribution is named explicitly.
  const confidence = actor === 'Unknown' ? 0.4 : 0.75;
  return {
    id: hashId('cyber', incident.date, incident.attribution ?? '', incident.target),
    type: 'cyber_attack',
    date: incident.date,
    suspectedActor: actor,
    targetCountry: incident.target,
    confidence,
    evidence: [incident.summary],
    severity: incident.severity,
    summary: actor === 'Unknown'
      ? `Cyber incident vs ${incident.target}`
      : `Cyber incident vs ${incident.target} (suspected ${actor})`,
  };
}

/** Map an ACLED event with a non-state actor to a great-power proxy
 *  attribution via the interest map. Returns null when neither the
 *  country nor the actors point to a great-power link. */
export function classifyProxy(event: AcledLikeEvent): GrayZoneEvent | null {
  if (!event.hasNonStateActor) return null;
  const actors = COUNTRY_TO_ACTORS.get(event.country);
  if (!actors || actors.size === 0) return null;
  // Pick the first actor — when multiple powers contest the same
  // country, the panel can split events by also filtering on actor1
  // text. For attribution accuracy in this engine, we surface the
  // first match and let downstream review tighten it.
  const [actor] = actors;
  return {
    id: hashId('proxy', event.date, event.country, event.actor1 ?? '', event.actor2 ?? ''),
    type: 'proxy_warfare',
    date: event.date,
    suspectedActor: actor!,
    targetCountry: event.country,
    confidence: 0.55, // attribution by interest map is heuristic — moderate confidence
    evidence: [event.summary],
    severity: 'medium',
    summary: `Proxy-warfare event in ${event.country} (non-state actor; ${actor} interest)`,
  };
}

/** GDELT CAMEO 17x = COERCE (sanctions, threats, …) and 18x = ASSAULT.
 *  We treat 17x volume spikes >2σ above baseline as disinformation
 *  signals. Returns null when no spike. */
export function classifyDisinformation(article: GdeltLikeArticle): GrayZoneEvent | null {
  const cameoRoot = (article.cameoCode ?? '').slice(0, 2);
  if (cameoRoot !== '17') return null;
  const baseline = article.baselineVolumePerDay ?? 0;
  const observed = article.observedVolumePerDay ?? 0;
  // 2σ proxy: assume Poisson; std ≈ sqrt(baseline). Trigger when
  // observed >= baseline + 2*sqrt(baseline) and baseline >= 4 (so the
  // sqrt isn't dominated by sampling noise).
  if (baseline < 4) return null;
  if (observed < baseline + 2 * Math.sqrt(baseline)) return null;
  return {
    id: hashId('disinfo', article.date, article.country ?? '', article.title),
    type: 'disinformation',
    date: article.date,
    suspectedActor: 'Unknown',
    targetCountry: article.country ?? 'Unknown',
    confidence: 0.5,
    evidence: article.url ? [article.title, article.url] : [article.title],
    severity: 'medium',
    summary: `Disinfo volume spike (${observed}/${baseline} baseline): ${article.title}`,
  };
}

/** Detect economic-coercion mentions in news. Looks for trade
 *  restriction terms in the article title. Returns null when no terms
 *  match. */
export function classifyEconomicCoercion(article: GdeltLikeArticle): GrayZoneEvent | null {
  const title = article.title.toLowerCase();
  const terms = ['export ban', 'export curb', 'tariff', 'trade restriction', 'rare earth ban', 'commodity ban', 'embargo'];
  if (!terms.some((t) => title.includes(t))) return null;
  return {
    id: hashId('econ', article.date, article.country ?? '', article.title),
    type: 'economic_coercion',
    date: article.date,
    suspectedActor: 'Unknown',
    targetCountry: article.country ?? 'Unknown',
    confidence: 0.6,
    evidence: article.url ? [article.title, article.url] : [article.title],
    severity: 'medium',
    summary: `Economic coercion signal: ${article.title}`,
  };
}

export function classifyInfrastructure(hit: InfrastructureKeywordHit): GrayZoneEvent {
  const actor = normalizeActor(hit.attribution ?? 'Unknown');
  return {
    id: hashId('infra', hit.date, hit.country, hit.keyword, hit.title),
    type: 'infrastructure_sabotage',
    date: hit.date,
    suspectedActor: actor,
    targetCountry: hit.country,
    confidence: actor === 'Unknown' ? 0.4 : 0.65,
    evidence: hit.url ? [hit.title, hit.url] : [hit.title],
    severity: 'high',
    summary: `Infrastructure event (${hit.keyword}) in ${hit.country}: ${hit.title}`,
  };
}

// ── Pattern detection ──────────────────────────────────────────────────

const PATTERN_WINDOW_DAYS = 30;
const PATTERN_MIN_EVENTS = 3;

function groupEventsByActor(events: readonly GrayZoneEvent[]): Map<GreatPowerActor, GrayZoneEvent[]> {
  const byActor = new Map<GreatPowerActor, GrayZoneEvent[]>();
  for (const e of events) {
    if (e.suspectedActor === 'Unknown') continue;
    if (!byActor.has(e.suspectedActor)) byActor.set(e.suspectedActor, []);
    byActor.get(e.suspectedActor)!.push(e);
  }
  return byActor;
}

function collectWindow(list: readonly GrayZoneEvent[], i: number): GrayZoneEvent[] {
  const start = Date.parse(list[i]!.date);
  const window: GrayZoneEvent[] = [];
  for (let j = i; j < list.length; j += 1) {
    const ageDays = (Date.parse(list[j]!.date) - start) / 86_400_000;
    if (ageDays > PATTERN_WINDOW_DAYS) break;
    window.push(list[j]!);
  }
  return window;
}

function buildPattern(actor: GreatPowerActor, window: GrayZoneEvent[], anchorId: string): GrayZonePattern {
  const types = new Set(window.map((e) => e.type));
  const actorSlug = actor.split(' ').join('-').toLowerCase();
  return {
    id: `pattern-${actorSlug}-${anchorId}`,
    actors: [actor],
    eventSequence: window.map((e) => e.id),
    startDate: window[0]!.date,
    endDate: window[window.length - 1]!.date,
    interpretation: interpretPattern(actor, [...types]),
  };
}

/** Group same-actor events within a 30-day rolling window. Returns one
 *  GrayZonePattern per actor when ≥3 events fit the window. */
export function detectPatterns(events: readonly GrayZoneEvent[]): GrayZonePattern[] {
  const byActor = groupEventsByActor(events);
  const patterns: GrayZonePattern[] = [];
  for (const [actor, list] of byActor) {
    list.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    let i = 0;
    while (i < list.length) {
      const window = collectWindow(list, i);
      if (window.length >= PATTERN_MIN_EVENTS) {
        patterns.push(buildPattern(actor, window, list[i]!.id));
        i += window.length; // skip ahead — no overlapping windows
      } else {
        i += 1;
      }
    }
  }
  return patterns;
}

function interpretPattern(actor: GreatPowerActor, types: readonly GrayZoneEventType[]): string {
  if (types.includes('cyber_attack') && types.includes('disinformation')) {
    return `${actor}: combined cyber + influence ops within 30 days — typical hybrid playbook.`;
  }
  if (types.includes('sanctions') && types.includes('economic_coercion')) {
    return `${actor}: sanctions + economic coercion sequence — sustained pressure campaign.`;
  }
  if (types.includes('proxy_warfare') && types.includes('infrastructure_sabotage')) {
    return `${actor}: proxy + infrastructure — escalating sub-kinetic posture.`;
  }
  return `${actor}: ${types.length} activity types in 30 days — sustained gray-zone tempo.`;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizeActor(raw: string): GreatPowerActor {
  const s = raw.trim().toLowerCase();
  if (s.includes('russia') || s.includes('kremlin')) return 'Russia';
  if (s.includes('china') || s.includes('prc') || s === 'pla') return 'China';
  if (s.includes('iran') || s.includes('irgc')) return 'Iran';
  if (s.includes('north korea') || s.includes('dprk')) return 'North Korea';
  if (s.includes('united states') || s === 'us' || s === 'u.s.' || s === 'usa') return 'United States';
  return 'Unknown';
}

/** Tiny deterministic id from a tuple of strings. Not cryptographic;
 *  just enough to dedupe the same event from two ingestion paths. */
function hashId(...parts: string[]): string {
  let h = 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i += 1) {
      h = Math.trunc(h * 31 + (p.codePointAt(i) ?? 0));
    }
  }
  return `gz-${(h >>> 0).toString(36)}`;
}

// ── Top-level summary helper ────────────────────────────────────────────

export interface ActorSummary {
  actor: GreatPowerActor;
  eventCount: number;
  byType: Record<GrayZoneEventType, number>;
  earliestDate: string | null;
  latestDate: string | null;
  topTargets: string[];
}

/** Roll up events for a specific actor for the /api/grayzone-summary
 *  endpoint. Pure. */
export function summarizeActor(actor: GreatPowerActor, events: readonly GrayZoneEvent[]): ActorSummary {
  const filtered = events.filter((e) => e.suspectedActor === actor);
  const byType: Record<GrayZoneEventType, number> = {
    sanctions: 0, cyber_attack: 0, proxy_warfare: 0,
    disinformation: 0, economic_coercion: 0, infrastructure_sabotage: 0,
  };
  const targetCounts = new Map<string, number>();
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const e of filtered) {
    byType[e.type] += 1;
    targetCounts.set(e.targetCountry, (targetCounts.get(e.targetCountry) ?? 0) + 1);
    const ms = Date.parse(e.date);
    if (Number.isFinite(ms)) {
      if (ms < earliestMs) earliestMs = ms;
      if (ms > latestMs) latestMs = ms;
    }
  }
  const topTargets = [...targetCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
  return {
    actor,
    eventCount: filtered.length,
    byType,
    earliestDate: Number.isFinite(earliestMs) ? new Date(earliestMs).toISOString() : null,
    latestDate: Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : null,
    topTargets,
  };
}

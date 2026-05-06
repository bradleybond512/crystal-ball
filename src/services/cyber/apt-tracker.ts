/**
 * APT Group Activity Tracker — per Batch 2 of the cyber/geo plan.
 *
 * Pure deterministic engine. Ingests MITRE ATT&CK STIX bundles + OTX
 * pulses + CISA KEV/advisory feeds, normalises to AptGroup +
 * AptActivityEvent, and scores recency-weighted activity per group.
 *
 * Plan invariants:
 *   - Pure functions are unit-testable on static fixtures.
 *   - Activity score gives more weight to events in the last few days
 *     and decays exponentially to zero past the 30-day window.
 *   - "Alert" is just a filter — score > 60 in the last 7 days. Any
 *     consumer (panel, notification ladder) can call it independently.
 *   - JSON-serializable outputs.
 */

// ── Public types ───────────────────────────────────────────────────────

export interface AptGroup {
  /** Stable id — MITRE G-code (e.g. "G0007"). */
  id: string;
  name: string;
  aliases: readonly string[];
  /** Suspected nation-state, when MITRE attributes one. Free text
   *  ("Russia", "China", "Iran", "North Korea", "Unknown"). */
  country: string;
  targetSectors: readonly string[];
  /** MITRE T-codes the group is known to use. */
  recentTechniques: readonly string[];
  /** ISO date of the most recent observed activity event for this
   *  group, when one exists. */
  lastActiveDate?: string;
  /** Recency-weighted score in [0, 100]. Computed by `scoreActivity`. */
  activityScore: number;
}

export interface AptActivityEvent {
  groupId: string;
  /** ISO 8601. */
  date: string;
  description: string;
  /** Sector hit ("energy", "healthcare", …). Empty when unknown. */
  targetSector: string;
  iocs: readonly string[];
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  source: 'otx' | 'cisa-advisory' | 'cisa-kev' | 'fixture';
}

export interface AptScoringOptions {
  /** Days of look-back for the score window. Default 30. */
  windowDays?: number;
  /** Half-life in days for the exponential decay. Default 7 — events
   *  one week old contribute half as much as today's. */
  halfLifeDays?: number;
  /** Per-source weight before decay. */
  sourceWeights?: Partial<Record<AptActivityEvent['source'], number>>;
  /** Per-severity weight. */
  severityWeights?: Partial<Record<AptActivityEvent['severity'], number>>;
}

export interface AptAlertFilter {
  /** Minimum activity score for an alert. Default 60. */
  minScore?: number;
  /** Look-back window for "active" filter, in days. Default 7. */
  windowDays?: number;
}

// ── ATT&CK STIX bundle parsing ─────────────────────────────────────────

/** Minimal STIX 2.1 bundle shape used by enterprise-attack.json.
 *  Only the fields we read; everything else is `unknown`. */
export interface StixBundle {
  type: 'bundle';
  id?: string;
  objects: readonly StixObject[];
}
export interface StixObject {
  type: string;
  id: string;
  name?: string;
  description?: string;
  aliases?: readonly string[];
  external_references?: readonly { source_name: string; external_id?: string; url?: string }[];
  /** Set on `intrusion-set` objects MITRE uses for groups. */
  x_mitre_attributed_to?: string;
  /** Set on `intrusion-set` objects when the group is deprecated. */
  revoked?: boolean;
  /** STIX relationship fields. */
  source_ref?: string;
  target_ref?: string;
  relationship_type?: string;
}

function readString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' ? v : undefined;
}

function readBool(o: Record<string, unknown>, key: string): boolean {
  return o[key] === true;
}

function readStringArray(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function readObjectArray(o: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = o[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) as Record<string, unknown>[];
}

function extractMitreId(refs: Record<string, unknown>[], source: string): string | null {
  for (const ref of refs) {
    if (readString(ref, 'source_name') === source) {
      const id = readString(ref, 'external_id');
      if (id) return id;
    }
  }
  return null;
}

/** Parse a MITRE ATT&CK enterprise STIX bundle into AptGroup[].
 *  Pulls `intrusion-set` objects, dedupes aliases, extracts G-codes
 *  from external_references. Returns the groups with empty
 *  `recentTechniques` / `targetSectors` / `lastActiveDate` /
 *  `activityScore=0` — those get filled in by `decorateGroups()` once
 *  we have OTX/CISA events. Accepts `unknown` so callers can pass
 *  freshly-parsed JSON without a cast. */
export function parseAttackBundle(bundle: unknown): AptGroup[] {
  if (typeof bundle !== 'object' || bundle === null) return [];
  const b = bundle as Record<string, unknown>;
  if (b.type !== 'bundle') return [];
  const objects = readObjectArray(b, 'objects');
  const groups: AptGroup[] = [];
  for (const obj of objects) {
    if (obj.type !== 'intrusion-set') continue;
    if (readBool(obj, 'revoked')) continue;
    const refs = readObjectArray(obj, 'external_references');
    const gcode = extractMitreId(refs, 'mitre-attack');
    if (!gcode?.startsWith('G')) continue;
    const name = readString(obj, 'name') ?? gcode;
    const aliases = [...new Set(readStringArray(obj, 'aliases'))].filter((a) => a !== name);
    groups.push({
      id: gcode,
      name,
      aliases,
      country: readString(obj, 'x_mitre_attributed_to') ?? 'Unknown',
      targetSectors: [],
      recentTechniques: [],
      activityScore: 0,
    });
  }
  return groups;
}

// ── OTX pulse → activity event ─────────────────────────────────────────

/** Subset of OTX pulse JSON shape. Only fields we read. */
export interface OtxPulse {
  id?: string;
  name?: string;
  description?: string;
  created?: string;
  modified?: string;
  /** Free-text adversary name (e.g. "APT28", "Lazarus"). */
  adversary?: string;
  /** Tags include nation-state group references. */
  tags?: readonly string[];
  /** Target industry list. */
  industries?: readonly string[];
  /** Indicators of compromise. */
  indicators?: readonly { indicator?: string; type?: string }[];
  /** Severity tier OTX assigns; not all pulses carry one. */
  TLP?: string;
}

/** Match a pulse to a known APT group via:
 *   1) explicit `adversary` field equality (case-insensitive) against
 *      group name or aliases;
 *   2) tag match against group name/aliases.
 *  Returns null when no group matches. */
export function matchPulseToGroup(pulse: OtxPulse, groups: readonly AptGroup[]): AptGroup | null {
  const candidates: string[] = [];
  if (typeof pulse.adversary === 'string' && pulse.adversary.length > 0) candidates.push(pulse.adversary);
  if (Array.isArray(pulse.tags)) candidates.push(...pulse.tags.filter((t) => typeof t === 'string'));
  if (candidates.length === 0) return null;
  const lowerCandidates = candidates.map((c) => c.toLowerCase().trim());
  for (const group of groups) {
    const names = new Set([group.name, ...group.aliases].map((n) => n.toLowerCase()));
    if (lowerCandidates.some((c) => names.has(c))) return group;
  }
  return null;
}

/** Convert a matched pulse into an AptActivityEvent. */
export function pulseToActivityEvent(pulse: OtxPulse, group: AptGroup): AptActivityEvent | null {
  const date = pulse.modified ?? pulse.created ?? '';
  if (!date) return null;
  const firstIndustry = pulse.industries?.[0];
  const targetSector = typeof firstIndustry === 'string' ? firstIndustry : '';
  const indicators = pulse.indicators ?? [];
  const iocs: string[] = [];
  for (const ind of indicators) {
    if (typeof ind?.indicator === 'string' && ind.indicator.length > 0) iocs.push(ind.indicator);
  }
  const description = pulse.name ?? pulse.description ?? 'OTX pulse';
  return {
    groupId: group.id,
    date,
    description,
    targetSector,
    iocs,
    severity: severityFromTLP(pulse.TLP ?? ''),
    source: 'otx',
  };
}

function severityFromTLP(tlp: string): AptActivityEvent['severity'] {
  switch (tlp.toLowerCase()) {
    case 'red':    { return 'critical'; }
    case 'amber':  { return 'high'; }
    case 'green':  { return 'medium'; }
    case 'white':  { return 'low'; }
    default:       { return 'info'; }
  }
}

// ── CISA KEV + advisories cross-reference ─────────────────────────────

export interface CisaKevEntry {
  cveID?: string;
  vendorProject?: string;
  product?: string;
  vulnerabilityName?: string;
  dateAdded?: string;          // YYYY-MM-DD
  shortDescription?: string;
  /** CISA includes a knownRansomwareCampaignUse marker — typically
   *  "Known" or "Unknown" but free-text by spec. */
  knownRansomwareCampaignUse?: string;
}

export interface CisaAdvisoryItem {
  title?: string;
  pubDate?: string;
  link?: string;
  description?: string;
}

/** Cross-reference a KEV entry against an APT group. KEV entries don't
 *  carry attribution, so this only matches when a group's name/alias
 *  appears verbatim in `vendorProject`, `product`, or
 *  `vulnerabilityName`. Conservative by design — false positives here
 *  inflate activity scores. */
export function kevToActivityEvents(
  kev: readonly CisaKevEntry[],
  groups: readonly AptGroup[],
): AptActivityEvent[] {
  const out: AptActivityEvent[] = [];
  for (const entry of kev) {
    const haystack = [entry.vendorProject, entry.product, entry.vulnerabilityName]
      .filter((s): s is string => typeof s === 'string')
      .join(' ').toLowerCase();
    if (!haystack || !entry.dateAdded || !entry.cveID) continue;
    for (const group of groups) {
      const names = [group.name, ...group.aliases].map((n) => n.toLowerCase());
      if (!names.some((n) => n.length >= 3 && haystack.includes(n))) continue;
      out.push({
        groupId: group.id,
        date: new Date(entry.dateAdded + 'T00:00:00Z').toISOString(),
        description: `KEV: ${entry.vulnerabilityName ?? entry.cveID}`,
        targetSector: '',
        iocs: [entry.cveID],
        severity: entry.knownRansomwareCampaignUse === 'Known' ? 'high' : 'medium',
        source: 'cisa-kev',
      });
    }
  }
  return out;
}

/** Cross-reference a CISA advisory against an APT group. Same
 *  conservative substring rule. */
export function advisoryToActivityEvents(
  advisories: readonly CisaAdvisoryItem[],
  groups: readonly AptGroup[],
): AptActivityEvent[] {
  const out: AptActivityEvent[] = [];
  for (const adv of advisories) {
    const haystack = [adv.title, adv.description].filter((s): s is string => typeof s === 'string').join(' ').toLowerCase();
    if (!haystack || !adv.pubDate) continue;
    const date = new Date(adv.pubDate);
    if (Number.isNaN(date.valueOf())) continue;
    for (const group of groups) {
      const names = [group.name, ...group.aliases].map((n) => n.toLowerCase());
      if (!names.some((n) => n.length >= 3 && haystack.includes(n))) continue;
      out.push({
        groupId: group.id,
        date: date.toISOString(),
        description: adv.title ?? 'CISA advisory',
        targetSector: '',
        iocs: [],
        severity: 'medium',
        source: 'cisa-advisory',
      });
    }
  }
  return out;
}

// ── Activity score ─────────────────────────────────────────────────────

const DEFAULT_SOURCE_WEIGHTS: Required<NonNullable<AptScoringOptions['sourceWeights']>> = {
  otx: 12,
  'cisa-advisory': 18,
  'cisa-kev': 22,
  fixture: 10,
};
const DEFAULT_SEVERITY_WEIGHTS: Required<NonNullable<AptScoringOptions['severityWeights']>> = {
  info: 0.5,
  low: 0.7,
  medium: 1,
  high: 1.3,
  critical: 1.6,
};

/** Compute a per-group activity score in [0, 100]. Recency-weighted
 *  exponential decay; clamps the upper end so a deluge of pulses
 *  doesn't peg every group at 100. */
export function scoreActivity(
  group: AptGroup,
  events: readonly AptActivityEvent[],
  nowMs: number = Date.now(),
  options: AptScoringOptions = {},
): number {
  const windowDays = options.windowDays ?? 30;
  const halfLifeDays = options.halfLifeDays ?? 7;
  const sourceWeights = { ...DEFAULT_SOURCE_WEIGHTS, ...options.sourceWeights };
  const severityWeights = { ...DEFAULT_SEVERITY_WEIGHTS, ...options.severityWeights };
  const cutoffMs = nowMs - windowDays * 86_400_000;
  const ln2 = Math.log(2);
  let raw = 0;
  for (const event of events) {
    if (event.groupId !== group.id) continue;
    const eventMs = Date.parse(event.date);
    if (!Number.isFinite(eventMs) || eventMs < cutoffMs || eventMs > nowMs) continue;
    const ageDays = (nowMs - eventMs) / 86_400_000;
    const decay = Math.exp(-ln2 * ageDays / halfLifeDays);
    const w = (sourceWeights[event.source] ?? 0) * (severityWeights[event.severity] ?? 1);
    raw += w * decay;
  }
  // Saturate gently — log-curve so the top end is reachable without
  // 10× more events than mid-range.
  const score = 100 * (1 - Math.exp(-raw / 50));
  return Math.max(0, Math.min(100, score));
}

/** Decorate a list of groups with activity score + lastActiveDate +
 *  inferred targetSectors (top-3 by frequency in events). */
export function decorateGroups(
  groups: readonly AptGroup[],
  events: readonly AptActivityEvent[],
  nowMs: number = Date.now(),
  options: AptScoringOptions = {},
): AptGroup[] {
  return groups.map((g) => {
    const groupEvents = events.filter((e) => e.groupId === g.id);
    const sortedByDate = [...groupEvents].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const lastActive = sortedByDate.length > 0 ? sortedByDate[0]!.date : undefined;
    const sectorCounts = new Map<string, number>();
    for (const e of groupEvents) {
      if (!e.targetSector) continue;
      sectorCounts.set(e.targetSector, (sectorCounts.get(e.targetSector) ?? 0) + 1);
    }
    const targetSectors = [...sectorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s]) => s);
    return {
      ...g,
      activityScore: scoreActivity(g, groupEvents, nowMs, options),
      ...(lastActive ? { lastActiveDate: lastActive } : {}),
      targetSectors: targetSectors.length > 0 ? targetSectors : g.targetSectors,
    };
  });
}

/** Filter groups for the alerts feed — score above floor + active in
 *  the last `windowDays` days. */
export function findActiveAlerts(
  groups: readonly AptGroup[],
  events: readonly AptActivityEvent[],
  nowMs: number = Date.now(),
  filter: AptAlertFilter = {},
): AptGroup[] {
  const minScore = filter.minScore ?? 60;
  const windowDays = filter.windowDays ?? 7;
  const cutoffMs = nowMs - windowDays * 86_400_000;
  return groups.filter((g) => {
    if (g.activityScore < minScore) return false;
    return events.some((e) => e.groupId === g.id && Date.parse(e.date) >= cutoffMs);
  }).sort((a, b) => b.activityScore - a.activityScore);
}

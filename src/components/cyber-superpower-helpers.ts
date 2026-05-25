/**
 * Pure helpers for CyberSuperpowerPanel. No DOM, no fetch, no globals —
 * each function takes plain input data and returns the section's view
 * model. Keeping helpers pure means the panel logic is testable in
 * isolation without spinning up the singletons.
 *
 * Five sections:
 *   - Threat Level Gauge      → posture summary from severity stats
 *   - Active Campaign Tracker → ranked active cyber situations
 *   - Infrastructure Exposure → BGP / DNS / target anomalies (tag-driven)
 *   - Zero-Day Watch          → CVE / KEV-flavored observations
 *   - Attribution Signals     → threat-actor entities + targeted sectors
 */

import type {
  ObservationEvent,
  ObservationSeverity,
  Situation,
} from '@/types/intelligence';
import { escapeHtml } from '@/utils/sanitize';
import type { Entity } from '@/services/intelligence/entity-registry';

// ── Severity helpers (shared) ──────────────────────────────────────

const OBS_SEVERITY_SCORE: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 2, MEDIUM: 5, HIGH: 7, CRITICAL: 9,
};
const SITUATION_SEVERITY_SCORE: Record<Situation['severity'], number> = {
  info: 0, low: 2, moderate: 5, high: 7, critical: 9,
};

export function obsSeverityScore(s: ObservationSeverity): number {
  return OBS_SEVERITY_SCORE[s] ?? 0;
}
export function situationSeverityScore(s: Situation['severity']): number {
  return SITUATION_SEVERITY_SCORE[s] ?? 0;
}

// ── Threat Level Gauge ─────────────────────────────────────────────

export type ThreatLevel = 'low' | 'elevated' | 'high' | 'critical';

export interface ThreatLevelSummary {
  level: ThreatLevel;
  score: number;             // 0–100
  eventCount: number;
  maxSeverity: ObservationSeverity;
  meanScore: number;         // 0–10
}

export function computeThreatLevel(events: readonly ObservationEvent[]): ThreatLevelSummary {
  if (events.length === 0) {
    return { level: 'low', score: 0, eventCount: 0, maxSeverity: 'INFO', meanScore: 0 };
  }
  let maxScore = 0;
  let maxLabel: ObservationSeverity = 'INFO';
  let sum = 0;
  for (const e of events) {
    const s = obsSeverityScore(e.severity);
    if (s > maxScore) { maxScore = s; maxLabel = e.severity; }
    sum += s;
  }
  const mean = sum / events.length;
  const score = clamp(Math.round((maxScore * 0.6 + mean * 0.4) * 10), 0, 100);
  const level: ThreatLevel =
    score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'elevated' : 'low';
  return {
    level,
    score,
    eventCount: events.length,
    maxSeverity: maxLabel,
    meanScore: round1(mean),
  };
}

// ── Active Campaign Tracker ────────────────────────────────────────

export interface CampaignEntry {
  id: string;
  title: string;
  domain: string;
  severityLabel: Situation['severity'];
  severityScore: number;
  startedAt: number;
  observationCount: number;
  region?: string;
}

export function buildActiveCampaigns(
  situations: readonly Situation[],
  limit = 8,
): CampaignEntry[] {
  return situations
    .filter((s) => s.status === 'active')
    .map((s): CampaignEntry => ({
      id: s.id,
      title: s.name || s.id,
      domain: s.domain,
      severityLabel: s.severity,
      severityScore: situationSeverityScore(s.severity),
      startedAt: s.startedAt,
      observationCount: s.observationIds?.length ?? 0,
      region: deriveRegion(s.location?.lat, s.location?.lon),
    }))
    .sort((a, b) => b.severityScore - a.severityScore || b.startedAt - a.startedAt)
    .slice(0, limit);
}

// ── Infrastructure Exposure Map ────────────────────────────────────

export interface InfrastructureSignal {
  kind: 'bgp-hijack' | 'dns-anomaly' | 'target-hit';
  title: string;
  severity: ObservationSeverity;
  timestamp: number;
  entityIds: string[];
}

export interface InfrastructureExposure {
  bgpHijackCount: number;
  dnsAnomalyCount: number;
  targetedAssetCount: number;
  signals: InfrastructureSignal[];
  topTargets: { entity: string; count: number }[];
}

const TAG_TO_KIND: Record<string, InfrastructureSignal['kind']> = {
  'bgp-hijack': 'bgp-hijack',
  'bgp-anomaly': 'bgp-hijack',
  'dns-anomaly': 'dns-anomaly',
  'dns-tunneling': 'dns-anomaly',
  'infrastructure-target': 'target-hit',
  'critical-infra-target': 'target-hit',
};

function classifyInfrastructure(ev: ObservationEvent): InfrastructureSignal['kind'] | null {
  for (const t of ev.tags) {
    const hit = TAG_TO_KIND[t];
    if (hit) return hit;
  }
  return null;
}

export function buildInfrastructureExposure(
  events: readonly ObservationEvent[],
  limit = 10,
): InfrastructureExposure {
  const matched: { event: ObservationEvent; kind: InfrastructureSignal['kind'] }[] = [];
  for (const ev of events) {
    const kind = classifyInfrastructure(ev);
    if (kind) matched.push({ event: ev, kind });
  }

  const bgpHijackCount = matched.filter((m) => m.kind === 'bgp-hijack').length;
  const dnsAnomalyCount = matched.filter((m) => m.kind === 'dns-anomaly').length;
  const targetedAssetCount = matched.filter((m) => m.kind === 'target-hit').length;

  const signals: InfrastructureSignal[] = matched
    .slice()
    .sort((a, b) =>
      obsSeverityScore(b.event.severity) - obsSeverityScore(a.event.severity)
      || b.event.timestamp - a.event.timestamp,
    )
    .slice(0, limit)
    .map(({ event, kind }) => ({
      kind,
      title: event.title,
      severity: event.severity,
      timestamp: event.timestamp,
      entityIds: [...event.entityIds],
    }));

  const targetCount = new Map<string, number>();
  for (const { event, kind } of matched) {
    if (kind !== 'target-hit') continue;
    for (const ent of event.entityIds) {
      targetCount.set(ent, (targetCount.get(ent) ?? 0) + 1);
    }
  }
  const topTargets = [...targetCount.entries()]
    .map(([entity, count]) => ({ entity, count }))
    .sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity))
    .slice(0, 5);

  return { bgpHijackCount, dnsAnomalyCount, targetedAssetCount, signals, topTargets };
}

// ── Zero-Day Watch ─────────────────────────────────────────────────

export interface ZeroDayEntry {
  id: string;
  cveId?: string;
  title: string;
  severity: ObservationSeverity;
  cvss?: number;
  timestamp: number;
  inKev: boolean;
  affectedProducts: string[];
}

const CVE_ID_PATTERN = /CVE-\d{4}-\d{4,}/i;
const KEV_TAG_HINTS = ['kev', 'cisa-kev', 'known-exploited', 'itw'];
const ZERO_DAY_TAG_HINTS = ['cve', 'vulnerability', 'zero-day', 'zeroday'];

function looksLikeCve(ev: ObservationEvent): boolean {
  const tagsLc = ev.tags.map((t) => t.toLowerCase());
  if (tagsLc.some((t) => ZERO_DAY_TAG_HINTS.includes(t))) return true;
  if (tagsLc.some((t) => KEV_TAG_HINTS.includes(t))) return true;
  if (ev.entityIds.some((x) => CVE_ID_PATTERN.test(x))) return true;
  return CVE_ID_PATTERN.test(ev.title);
}

export function buildZeroDayWatch(
  events: readonly ObservationEvent[],
  limit = 10,
): ZeroDayEntry[] {
  const cveLike = events.filter((e) => looksLikeCve(e));

  return cveLike
    .slice()
    .sort((a, b) =>
      obsSeverityScore(b.severity) - obsSeverityScore(a.severity)
      || b.timestamp - a.timestamp,
    )
    .slice(0, limit)
    .map((e): ZeroDayEntry => {
      const fromEntity = e.entityIds.find((x) => CVE_ID_PATTERN.test(x));
      const titleMatch = e.title.match(CVE_ID_PATTERN);
      const cveMatch = fromEntity ?? titleMatch?.[0];
      const tagsLc = e.tags.map((t) => t.toLowerCase());
      const inKev = tagsLc.some((t) => KEV_TAG_HINTS.includes(t))
        || e.entityIds.some((x) => x.toLowerCase().startsWith('cisa-kev'));
      const affectedProducts = e.entityIds.filter((x) =>
        !CVE_ID_PATTERN.test(x) && !/^cisa-kev/i.test(x),
      );
      const score = obsSeverityScore(e.severity);
      return {
        id: e.id,
        cveId: cveMatch?.toUpperCase(),
        title: e.title,
        severity: e.severity,
        cvss: score >= 1 ? score : undefined,
        timestamp: e.timestamp,
        inKev,
        affectedProducts,
      };
    });
}

// ── Attribution Signals ────────────────────────────────────────────

export interface ActorAttribution {
  id: string;
  name: string;
  aliases: string[];
  campaignCount: number;
  targetedSectors: string[];
  confidence: number;
  lastSeenAt: number;
}

export interface AttributionSummary {
  actors: ActorAttribution[];
  totalTrackedCampaigns: number;
  topSectors: { sector: string; count: number }[];
}

const ACTOR_NAME_PATTERN = /^(APT|FIN|UNC|TA)\d+/i;

export function buildAttributionSignals(
  entities: readonly Entity[],
  events: readonly ObservationEvent[],
  limit = 6,
): AttributionSummary {
  const actors = entities.filter((e) => {
    const attrs = e.attributes as Record<string, unknown> | undefined;
    if (attrs?.actor === true) return true;
    if (attrs?.threatActor === true) return true;
    if (typeof attrs?.actorKind === 'string') return true;
    if (e.identifiers && typeof e.identifiers['mitre-attack-group'] === 'string') return true;
    return ACTOR_NAME_PATTERN.test(e.canonicalName);
  });

  const eventsByEntity = new Map<string, ObservationEvent[]>();
  for (const ev of events) {
    if (ev.domain !== 'cyber') continue;
    for (const ent of ev.entityIds) {
      const key = ent.toLowerCase();
      const arr = eventsByEntity.get(key);
      if (arr) arr.push(ev);
      else eventsByEntity.set(key, [ev]);
    }
  }

  const sectorCount = new Map<string, number>();
  const out: ActorAttribution[] = actors.map((a) => {
    const aliasesRaw = (a.aliases ?? []) as string[];
    const matchKeys = [a.id, a.canonicalName, ...aliasesRaw]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .map((s) => s.toLowerCase());

    const seenEvents = new Set<ObservationEvent>();
    for (const key of matchKeys) {
      for (const ev of eventsByEntity.get(key) ?? []) seenEvents.add(ev);
    }

    const sectors = collectSectors(a, [...seenEvents]);
    for (const s of sectors) sectorCount.set(s, (sectorCount.get(s) ?? 0) + 1);

    const lastSeenAt = seenEvents.size === 0
      ? a.lastSeen ?? 0
      : Math.max(...[...seenEvents].map((ev) => ev.timestamp));

    return {
      id: a.id,
      name: a.canonicalName,
      aliases: aliasesRaw,
      campaignCount: seenEvents.size,
      targetedSectors: sectors,
      confidence: round1(readNumber(a.attributes, 'confidence') ?? 0.5),
      lastSeenAt,
    };
  });

  out.sort((a, b) =>
    b.campaignCount - a.campaignCount
    || b.lastSeenAt - a.lastSeenAt
    || a.name.localeCompare(b.name),
  );

  const topSectors = [...sectorCount.entries()]
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector))
    .slice(0, 5);

  return {
    actors: out.slice(0, limit),
    totalTrackedCampaigns: out.reduce((s, a) => s + a.campaignCount, 0),
    topSectors,
  };
}

// ── Internals ──────────────────────────────────────────────────────

function collectSectors(actor: Entity, events: readonly ObservationEvent[]): string[] {
  const fromActor = (actor.attributes as Record<string, unknown> | undefined)?.targetedSectors;
  const seed = Array.isArray(fromActor)
    ? (fromActor as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const fromEvents: string[] = [];
  for (const ev of events) {
    for (const t of ev.tags) {
      if (t.startsWith('sector:')) fromEvents.push(t.slice('sector:'.length));
    }
  }
  return [...new Set([...seed, ...fromEvents])].sort();
}

function deriveRegion(lat?: number, lon?: number): string | undefined {
  if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;
  if (lat > 35 && lon > -25 && lon < 65) return 'Europe';
  if (lat > 0 && lon >= 65 && lon < 150) return 'Asia';
  if (lat < 0 && lon >= 110 && lon < 180) return 'Oceania';
  if (lat >= 15 && lon >= -170 && lon < -50) return 'North America';
  if (lat < 15 && lon >= -90 && lon < -30) return 'South America';
  if (lat < 35 && lon > -20 && lon < 55) return 'Africa';
  return 'Other';
}

function readNumber(attrs: unknown, key: string): number | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const v = (attrs as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Renderer (pure HTML, callable without DOM) ─────────────────────

export interface CyberPanelState {
  threat: ThreatLevelSummary;
  campaigns: CampaignEntry[];
  exposure: InfrastructureExposure;
  zeroDays: ZeroDayEntry[];
  attribution: AttributionSummary;
  generatedAt: number;
}

export function renderCyberSuperpowerHtml(state: CyberPanelState, nowFn: () => number = Date.now): string {
  return `<div class="cyber-superpower">
    ${renderThreatGauge(state.threat)}
    ${renderCampaigns(state.campaigns)}
    ${renderExposure(state.exposure)}
    ${renderZeroDays(state.zeroDays)}
    ${renderAttribution(state.attribution)}
    <div class="cyber-sp-footer" style="margin-top:8px;font-size:11px;opacity:0.6">Updated ${escapeHtml(timeAgo(state.generatedAt, nowFn()))}</div>
  </div>`;
}

function renderThreatGauge(s: ThreatLevelSummary): string {
  return `<section class="cyber-sp-section" data-section="threat-level">
    <h3 style="margin:0 0 6px 0;font-size:13px">Threat Level Gauge</h3>
    <div class="cyber-sp-gauge" style="display:flex;gap:12px;align-items:baseline;padding:8px;border-radius:6px;background:${levelBg(s.level)}">
      <span style="font-size:20px;font-weight:600;text-transform:uppercase">${escapeHtml(s.level)}</span>
      <span style="font-size:14px;opacity:0.85">score ${s.score}</span>
      <span style="font-size:11px;opacity:0.7">${s.eventCount} events · peak ${escapeHtml(s.maxSeverity)} · mean ${s.meanScore}</span>
    </div>
  </section>`;
}

function renderCampaigns(items: CampaignEntry[]): string {
  if (items.length === 0) {
    return `<section class="cyber-sp-section" data-section="active-campaigns">
      <h3 style="margin:8px 0 6px 0;font-size:13px">Active Campaign Tracker</h3>
      <div class="cyber-sp-empty" style="opacity:0.6;font-size:12px">No active cyber campaigns.</div>
    </section>`;
  }
  const rows = items.map((c) => `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:64px;font-weight:600">${escapeHtml(c.severityLabel)}</span>
    <strong>${escapeHtml(c.title)}</strong>
    <span style="opacity:0.6">· ${escapeHtml(c.region ?? 'unknown')} · ${c.observationCount} obs</span>
  </li>`).join('');
  return `<section class="cyber-sp-section" data-section="active-campaigns">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Active Campaign Tracker</h3>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
  </section>`;
}

function renderExposure(e: InfrastructureExposure): string {
  const targetsHtml = e.topTargets.length === 0
    ? '<span style="opacity:0.6">no targeted assets</span>'
    : e.topTargets.map((t) => `<span style="margin-right:8px"><code>${escapeHtml(t.entity)}</code> ×${t.count}</span>`).join('');
  return `<section class="cyber-sp-section" data-section="infrastructure-exposure">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Infrastructure Exposure Map</h3>
    <div style="font-size:12px;opacity:0.85">BGP ${e.bgpHijackCount} · DNS ${e.dnsAnomalyCount} · target hits ${e.targetedAssetCount}</div>
    <div style="margin-top:4px;font-size:11px">${targetsHtml}</div>
  </section>`;
}

function renderZeroDays(items: ZeroDayEntry[]): string {
  if (items.length === 0) {
    return `<section class="cyber-sp-section" data-section="zero-days">
      <h3 style="margin:8px 0 6px 0;font-size:13px">Zero-Day Watch</h3>
      <div class="cyber-sp-empty" style="opacity:0.6;font-size:12px">No tracked CVEs in the last window.</div>
    </section>`;
  }
  const rows = items.map((z) => `<li style="padding:4px 0;font-size:12px;${z.inKev ? 'border-left:3px solid #ef4444;padding-left:6px' : ''}">
    ${z.inKev ? '<strong style="color:#ef4444">KEV</strong> ' : ''}
    ${z.cveId ? `<code>${escapeHtml(z.cveId)}</code> ` : ''}
    ${escapeHtml(z.title)}
    ${z.cvss !== undefined ? `<span style="opacity:0.6">· CVSS ${z.cvss}</span>` : ''}
  </li>`).join('');
  return `<section class="cyber-sp-section" data-section="zero-days">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Zero-Day Watch</h3>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
  </section>`;
}

function renderAttribution(a: AttributionSummary): string {
  if (a.actors.length === 0) {
    return `<section class="cyber-sp-section" data-section="attribution">
      <h3 style="margin:8px 0 6px 0;font-size:13px">Attribution Signals</h3>
      <div class="cyber-sp-empty" style="opacity:0.6;font-size:12px">No tracked threat actors.</div>
    </section>`;
  }
  const rows = a.actors.map((act) => `<li style="padding:4px 0;font-size:12px">
    <strong>${escapeHtml(act.name)}</strong>
    <span style="opacity:0.65">· ${act.campaignCount} campaign${act.campaignCount === 1 ? '' : 's'} · conf ${act.confidence}</span>
    ${act.targetedSectors.length > 0 ? `<div style="opacity:0.65;margin-top:2px">sectors: ${act.targetedSectors.map((s) => escapeHtml(s)).join(', ')}</div>` : ''}
  </li>`).join('');
  return `<section class="cyber-sp-section" data-section="attribution">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Attribution Signals</h3>
    <div style="font-size:11px;opacity:0.7;margin-bottom:4px">Tracking ${a.actors.length} actor${a.actors.length === 1 ? '' : 's'} · ${a.totalTrackedCampaigns} campaign${a.totalTrackedCampaigns === 1 ? '' : 's'}</div>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
  </section>`;
}

function levelBg(level: ThreatLevel): string {
  switch (level) {
    case 'critical': return 'rgba(239, 68, 68, 0.18)';
    case 'high': return 'rgba(249, 115, 22, 0.16)';
    case 'elevated': return 'rgba(234, 179, 8, 0.14)';
    case 'low':
    default: return 'rgba(34, 197, 94, 0.12)';
  }
}

function timeAgo(ts: number, now: number): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

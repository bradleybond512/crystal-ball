/**
 * Intelligence Briefing Export — produces a polished, self-contained
 * HTML briefing document by querying CivilizationPulse, WorldNarrative,
 * active situations, ThreatHorizon, GeopoliticalEventCalendar, and the
 * IntelligenceHealthMonitor. Unlike the OperatorShiftReport (shift
 * handoff for internal continuity), this is an external-facing briefing
 * that can be printed or downloaded as a single HTML file.
 *
 * Pure store: injectable Storage + clock + providers. Each provider is
 * optional and called in a try/catch so a misbehaving upstream cannot
 * break briefing generation. Generated briefings persist in a 50-record
 * ring buffer under `wm-intelligence-briefings`.
 */

import { escapeHtml } from '@/utils/sanitize';
import type { Situation } from '@/types/intelligence';

// ── Public types ─────────────────────────────────────────────────────────

export type BriefingClassification = 'unclassified' | 'internal' | 'sensitive';

export interface BriefingSection {
  title: string;
  content: string;
  priority: number;
}

export interface IntelligenceBriefing {
  id: string;
  title: string;
  classification: BriefingClassification;
  generatedAt: number;
  periodLabel: string;
  sections: BriefingSection[];
  htmlContent: string;
  wordCount: number;
}

export interface BriefingGenerateOptions {
  classification?: BriefingClassification;
  title?: string;
}

export interface PulseSnapshot {
  overallScore: number;
  label: string;
  dominantStressor: string | null;
}

export interface NarrativeSnapshot {
  headline: string;
  outlookSentence: string;
}

export interface HorizonThreatLite {
  id: string;
  domain: string;
  region: string;
  currentSeverity: string;
  projectedSeverity: string;
  horizon: string;
  probability: number;
}

export interface CalendarEventLite {
  id: string;
  title: string;
  country: string;
  scheduledAt: number;
  riskLevel: string;
  type: string;
}

export interface HealthSnapshot {
  overallScore: number;
  overallStatus: string;
}

export interface IntelligenceBriefingProviders {
  civilizationPulse?: () => PulseSnapshot;
  worldNarrative?: () => NarrativeSnapshot;
  activeSituations?: () => readonly Situation[];
  threatHorizon?: () => readonly HorizonThreatLite[];
  upcomingEvents?: () => readonly CalendarEventLite[];
  systemHealth?: () => HealthSnapshot;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface IntelligenceBriefingExportOptions {
  storage?: StorageLike | null;
  now?: () => number;
  providers?: IntelligenceBriefingProviders;
}

export interface IntelligenceBriefingExportService {
  generate(opts?: BriefingGenerateOptions): IntelligenceBriefing;
  getBriefings(limit?: number): IntelligenceBriefing[];
  getLatest(): IntelligenceBriefing | null;
  subscribe(cb: (briefing: IntelligenceBriefing) => void): void;
  unsubscribe(cb: (briefing: IntelligenceBriefing) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-intelligence-briefings';
export const MAX_BRIEFINGS = 50;
const ACTIVE_SITUATION_CAP = 5;
const THREAT_HORIZON_CAP = 3;
const UPCOMING_EVENTS_CAP = 3;

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  CRITICAL: 4,
  high: 3,
  HIGH: 3,
  medium: 2,
  MEDIUM: 2,
  low: 1,
  LOW: 1,
  info: 0,
  INFO: 0,
};

const CLASSIFICATION_BG: Record<BriefingClassification, string> = {
  unclassified: '#2ec27e',
  internal: '#f5a524',
  sensitive: '#e94f37',
};

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(nowMs: number): string {
  _idCounter += 1;
  return `brief-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

function tryCall<T>(fn: (() => T) | undefined, fallback: T): T {
  if (!fn) return fallback;
  try { return fn(); } catch { return fallback; }
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function severityRank(s: string): number {
  return SEVERITY_RANK[s] ?? 0;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function periodLabel(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}

function countWords(text: string): number {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(' ').length;
}

function daysFromNow(nowMs: number, futureMs: number): number {
  return Math.max(0, Math.round((futureMs - nowMs) / (24 * 60 * 60_000)));
}

// ── Section builders ─────────────────────────────────────────────────────

function buildExecutiveSummary(
  pulse: PulseSnapshot | null,
  narrative: NarrativeSnapshot | null,
): BriefingSection {
  const lines: string[] = [];
  if (pulse) {
    const stressor = pulse.dominantStressor ? ` Dominant stressor: ${pulse.dominantStressor}.` : '';
    lines.push(`Civilization pulse reads ${pulse.overallScore.toFixed(0)} (${pulse.label}).${stressor}`);
  } else {
    lines.push('Civilization pulse data unavailable.');
  }
  if (narrative) {
    if (narrative.headline) lines.push(narrative.headline);
    if (narrative.outlookSentence) lines.push(narrative.outlookSentence);
  } else {
    lines.push('Global narrative summary unavailable.');
  }
  return { title: 'Executive Summary', content: lines.join(' '), priority: 1 };
}

function buildActiveSituations(situations: readonly Situation[]): BriefingSection {
  if (situations.length === 0) {
    return { title: 'Active Situations', content: 'No active situations detected.', priority: 2 };
  }
  const ranked = [...situations]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, ACTIVE_SITUATION_CAP);
  const lines = ranked.map((s) =>
    `- [${s.id}] ${s.domain}/${s.severity}: ${s.name}`);
  return { title: 'Active Situations', content: lines.join('\n'), priority: 2 };
}

function buildThreatHorizon(threats: readonly HorizonThreatLite[]): BriefingSection {
  if (threats.length === 0) {
    return { title: 'Threat Horizon', content: 'No imminent threats projected.', priority: 3 };
  }
  const top = [...threats]
    .sort((a, b) => severityRank(b.projectedSeverity) - severityRank(a.projectedSeverity)
      || b.probability - a.probability)
    .slice(0, THREAT_HORIZON_CAP);
  const lines = top.map((t) =>
    `- ${t.domain} · ${t.region} · ${t.currentSeverity}→${t.projectedSeverity} within ${t.horizon} (p=${t.probability.toFixed(2)})`);
  return { title: 'Threat Horizon', content: lines.join('\n'), priority: 3 };
}

function buildUpcomingEvents(events: readonly CalendarEventLite[], nowMs: number): BriefingSection {
  if (events.length === 0) {
    return { title: 'Upcoming Events', content: 'No scheduled events in the briefing window.', priority: 4 };
  }
  const top = [...events]
    .sort((a, b) => a.scheduledAt - b.scheduledAt)
    .slice(0, UPCOMING_EVENTS_CAP);
  const lines = top.map((e) =>
    `- ${e.title} (${e.type}) · ${e.country} · risk ${e.riskLevel} · in ${daysFromNow(nowMs, e.scheduledAt)}d`);
  return { title: 'Upcoming Events', content: lines.join('\n'), priority: 4 };
}

function buildSystemHealth(health: HealthSnapshot | null): BriefingSection {
  if (!health) {
    return { title: 'System Health', content: 'System health telemetry unavailable.', priority: 5 };
  }
  const pct = Math.round(health.overallScore * 100);
  return {
    title: 'System Health',
    content: `Overall ${pct}% (status: ${health.overallStatus}).`,
    priority: 5,
  };
}

// ── HTML rendering ───────────────────────────────────────────────────────

function renderHtml(briefing: Omit<IntelligenceBriefing, 'htmlContent' | 'wordCount'>): string {
  const classificationBg = CLASSIFICATION_BG[briefing.classification];
  const classificationLabel = escapeHtml(briefing.classification.toUpperCase());
  const sectionsHtml = [...briefing.sections]
    .sort((a, b) => a.priority - b.priority)
    .map((s, idx) => renderSection(s, idx + 1))
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(briefing.title)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; color:#1f2937; background:#f8fafc; margin:0; padding:0; }
  .briefing { max-width:760px; margin:0 auto; padding:32px 28px; background:#fff; }
  .classification-banner { background:${classificationBg}; color:#fff; font-weight:700; text-align:center; padding:6px 12px; letter-spacing:0.06em; border-radius:3px; font-size:11px; text-transform:uppercase; }
  h1 { font-size:22px; margin:18px 0 6px; }
  .meta { font-size:11px; color:#64748b; margin-bottom:18px; }
  h2 { font-size:14px; margin:18px 0 6px; padding-bottom:3px; border-bottom:1px solid #e2e8f0; color:#111827; }
  .section-body { font-size:12px; line-height:1.55; white-space:pre-wrap; color:#1f2937; }
  footer { margin-top:24px; font-size:10px; color:#94a3b8; text-align:center; }
</style>
</head>
<body>
  <div class="briefing">
    <div class="classification-banner">${classificationLabel}</div>
    <h1>${escapeHtml(briefing.title)}</h1>
    <div class="meta">Generated ${escapeHtml(briefing.periodLabel)} · Briefing ID ${escapeHtml(briefing.id)}</div>
    ${sectionsHtml}
    <footer>Crystal Ball — Intelligence Briefing · ${classificationLabel}</footer>
  </div>
</body>
</html>`;
}

function renderSection(section: BriefingSection, index: number): string {
  return `<section>
    <h2>${index}. ${escapeHtml(section.title)}</h2>
    <div class="section-body">${escapeHtml(section.content)}</div>
  </section>`;
}

// ── Persistence ──────────────────────────────────────────────────────────

function deserialize(raw: unknown): IntelligenceBriefing | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  if (typeof r.title !== 'string') return null;
  if (typeof r.htmlContent !== 'string') return null;
  if (typeof r.generatedAt !== 'number') return null;
  const classification: BriefingClassification =
    r.classification === 'unclassified' || r.classification === 'internal' || r.classification === 'sensitive'
      ? r.classification : 'unclassified';
  const sections = Array.isArray(r.sections)
    ? r.sections
        .map((s) => deserializeSection(s))
        .filter((s): s is BriefingSection => s !== null)
    : [];
  return {
    id: r.id,
    title: r.title,
    classification,
    generatedAt: r.generatedAt,
    periodLabel: typeof r.periodLabel === 'string' ? r.periodLabel : '',
    sections,
    htmlContent: r.htmlContent,
    wordCount: typeof r.wordCount === 'number' ? r.wordCount : 0,
  };
}

function deserializeSection(raw: unknown): BriefingSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== 'string' || typeof r.content !== 'string') return null;
  return {
    title: r.title,
    content: r.content,
    priority: typeof r.priority === 'number' ? r.priority : 99,
  };
}

function rehydrate(storage: StorageLike | null): IntelligenceBriefing[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: IntelligenceBriefing[] = [];
  for (const p of parsed) {
    const d = deserialize(p);
    if (d) out.push(d);
  }
  return out;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createIntelligenceBriefingExportService(
  options: IntelligenceBriefingExportOptions = {},
): IntelligenceBriefingExportService {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const providers = options.providers ?? {};
  const briefings: IntelligenceBriefing[] = rehydrate(storage);
  const listeners = new Set<(briefing: IntelligenceBriefing) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(briefings));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function capRingBuffer(): void {
    if (briefings.length > MAX_BRIEFINGS) {
      briefings.splice(MAX_BRIEFINGS);
    }
  }

  function notify(b: IntelligenceBriefing): void {
    for (const cb of listeners) {
      try { cb(b); } catch { /* listener crash isolation */ }
    }
  }

  return {
    generate(opts): IntelligenceBriefing {
      const nowMs = clock();
      const classification: BriefingClassification = opts?.classification ?? 'unclassified';
      const title = opts?.title ?? 'Crystal Ball Intelligence Briefing';
      const pulse = tryCall<PulseSnapshot | null>(providers.civilizationPulse, null);
      const narrative = tryCall<NarrativeSnapshot | null>(providers.worldNarrative, null);
      const situations = tryCall<readonly Situation[]>(providers.activeSituations, []);
      const horizon = tryCall<readonly HorizonThreatLite[]>(providers.threatHorizon, []);
      const events = tryCall<readonly CalendarEventLite[]>(providers.upcomingEvents, []);
      const health = tryCall<HealthSnapshot | null>(providers.systemHealth, null);

      const sections: BriefingSection[] = [
        buildExecutiveSummary(pulse, narrative),
        buildActiveSituations(situations),
        buildThreatHorizon(horizon),
        buildUpcomingEvents(events, nowMs),
        buildSystemHealth(health),
      ];

      const id = nextId(nowMs);
      const skeleton = {
        id,
        title,
        classification,
        generatedAt: nowMs,
        periodLabel: periodLabel(nowMs),
        sections,
      };
      const htmlContent = renderHtml(skeleton);
      const wordCount = sections.reduce((acc, s) => acc + countWords(s.content), 0);
      const briefing: IntelligenceBriefing = { ...skeleton, htmlContent, wordCount };

      briefings.unshift(briefing);
      capRingBuffer();
      persist();
      notify(briefing);
      return briefing;
    },

    getBriefings(limit): IntelligenceBriefing[] {
      const out = briefings.map((b) => ({ ...b, sections: b.sections.map((s) => ({ ...s })) }));
      return limit === undefined ? out : out.slice(0, limit);
    },

    getLatest(): IntelligenceBriefing | null {
      const first = briefings[0];
      if (!first) return null;
      return { ...first, sections: first.sections.map((s) => ({ ...s })) };
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Singleton ────────────────────────────────────────────────────────────

let _singleton: IntelligenceBriefingExportService | null = null;

export function getIntelligenceBriefingExportService(): IntelligenceBriefingExportService {
  _singleton ??= createIntelligenceBriefingExportService();
  return _singleton;
}

export function resetIntelligenceBriefingExportServiceForTests(): void {
  _singleton = null;
}

/**
 * OperatorShiftReportService — generates structured end-of-shift
 * intelligence summaries. Pulls from CivilizationPulse, WorldNarrative,
 * top active Situations, anomaly count, and feed health into a single
 * human-readable report with machine-readable metadata.
 *
 * Pure deterministic; no DOM, no fetch. Upstream services are read
 * via an injectable `ShiftReportSources` adapter so production wires
 * the live engines and tests pass a deterministic stub.
 */

// ── Public types ─────────────────────────────────────────────────────

export type ShiftPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ShiftReportSituationSummary {
  id: string;
  domain: string;
  severity: string;
  title: string;
}

export interface ShiftReportPulseSnapshot {
  overallScore: number;
  label: string;
}

export interface ShiftReportNarrativeSnapshot {
  headline: string;
  executiveSummary: string;
}

export interface ShiftReport {
  id: string;
  period: ShiftPeriod;
  generatedAt: number;
  civilizationScore: number | null;
  civilizationLabel: string | null;
  topSituations: ShiftReportSituationSummary[];
  anomalyCount: number;
  feedHealthSummary: string;
  worldNarrativeSummary: string;
  keyDevelopments: string[];
  recommendedActions: string[];
  handoffNotes: string;
  reportText: string;
}

export interface ShiftReportSources {
  getPulse(): ShiftReportPulseSnapshot | null;
  getNarrative(): ShiftReportNarrativeSnapshot | null;
  getTopSituations(): readonly ShiftReportSituationSummary[];
  getRecentAnomalyCount(): number;
  getFeedHealthSummary(): string;
}

export type ShiftReportListener = (report: ShiftReport) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OperatorShiftReportServiceOptions {
  sources: ShiftReportSources;
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_CAPACITY = 100;
export const STORAGE_KEY = 'wm-shift-reports';
const TOP_SITUATIONS_LIMIT = 5;
const NARRATIVE_SUMMARY_MAX = 300;
const KEY_DEVELOPMENTS_MIN = 1;
const KEY_DEVELOPMENTS_MAX = 5;

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedState {
  reports: ShiftReport[];
}

export class OperatorShiftReportService {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly sources: ShiftReportSources;
  private readonly reports: ShiftReport[] = [];
  private readonly subscribers = new Set<ShiftReportListener>();
  private idCounter = 0;

  constructor(opts: OperatorShiftReportServiceOptions) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.sources = opts.sources;
    this.hydrate();
  }

  generate(handoffNotes = ''): ShiftReport {
    const generatedAt = this.clock();
    const period = periodForHour(new Date(generatedAt).getUTCHours());

    const pulse = safe(() => this.sources.getPulse()) ?? null;
    const narrative = safe(() => this.sources.getNarrative()) ?? null;
    const rawSituations = safe(() => this.sources.getTopSituations()) ?? [];
    const topSituations = [...rawSituations].slice(0, TOP_SITUATIONS_LIMIT);
    const anomalyCount = safe(() => this.sources.getRecentAnomalyCount()) ?? 0;
    const feedHealthSummary = safe(() => this.sources.getFeedHealthSummary()) ?? '';

    const worldNarrativeSummary = narrative
      ? truncate(`${narrative.headline} ${narrative.executiveSummary}`.trim(), NARRATIVE_SUMMARY_MAX)
      : '';

    this.idCounter++;
    const id = `shift-${generatedAt}-${this.idCounter}`;
    const keyDevelopments = buildKeyDevelopments(pulse, topSituations, anomalyCount);
    const recommendedActions = buildRecommendedActions(pulse, topSituations, anomalyCount);

    const partial: Omit<ShiftReport, 'reportText'> = {
      id,
      period,
      generatedAt,
      civilizationScore: pulse?.overallScore ?? null,
      civilizationLabel: pulse?.label ?? null,
      topSituations,
      anomalyCount,
      feedHealthSummary,
      worldNarrativeSummary,
      keyDevelopments,
      recommendedActions,
      handoffNotes,
    };
    const reportText = renderReportText(partial);
    const report: ShiftReport = { ...partial, reportText };

    this.reports.push(report);
    while (this.reports.length > this.capacity) this.reports.shift();
    this.persist();
    for (const cb of this.subscribers) cb(report);
    return report;
  }

  getLatest(): ShiftReport | null {
    if (this.reports.length === 0) return null;
    return this.reports[this.reports.length - 1] ?? null;
  }

  getReports(limit?: number): ShiftReport[] {
    const reversed: ShiftReport[] = [];
    for (let i = this.reports.length - 1; i >= 0; i--) {
      reversed.push(this.reports[i]!);
      if (limit && reversed.length >= limit) break;
    }
    return reversed;
  }

  subscribe(cb: ShiftReportListener): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: ShiftReportListener): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.reports.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed || !Array.isArray(parsed.reports)) return;
      for (const r of parsed.reports) this.reports.push(r);
      while (this.reports.length > this.capacity) this.reports.shift();
    } catch {
      this.reports.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedState = { reports: this.reports };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: OperatorShiftReportService | undefined;

export function getOperatorShiftReportService(sources: ShiftReportSources): OperatorShiftReportService {
  singleton ??= new OperatorShiftReportService({ sources });
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function periodForHour(hour: number): ShiftPeriod {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 24) return 'evening';
  return 'night';
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function buildKeyDevelopments(
  pulse: ShiftReportPulseSnapshot | null,
  situations: readonly ShiftReportSituationSummary[],
  anomalyCount: number,
): string[] {
  const out: string[] = [];
  if (pulse) {
    out.push(`Civilization pulse is ${pulse.label} at ${pulse.overallScore}/100`);
  }
  const criticals = situations.filter((s) => s.severity === 'critical');
  for (const s of criticals.slice(0, 2)) {
    out.push(`Critical situation: ${s.title} (${s.domain})`);
  }
  const highs = situations.filter((s) => s.severity === 'high' && !criticals.includes(s));
  for (const s of highs.slice(0, 2)) {
    out.push(`High-severity situation: ${s.title} (${s.domain})`);
  }
  if (anomalyCount > 0) {
    out.push(`${anomalyCount} recent anomal${anomalyCount === 1 ? 'y' : 'ies'} flagged`);
  }
  if (out.length === 0) {
    out.push('Shift was quiet — no notable developments to flag');
  }
  return out.slice(0, KEY_DEVELOPMENTS_MAX).slice(0, Math.max(KEY_DEVELOPMENTS_MIN, out.length));
}

function buildRecommendedActions(
  pulse: ShiftReportPulseSnapshot | null,
  situations: readonly ShiftReportSituationSummary[],
  anomalyCount: number,
): string[] {
  const out: string[] = [];
  if (pulse && pulse.overallScore < 50) {
    out.push('Maintain elevated watch posture — pulse is stressed/critical');
  }
  const criticals = situations.filter((s) => s.severity === 'critical');
  if (criticals.length > 0) {
    out.push(`Re-confirm action plans for ${criticals.length} critical situation${criticals.length === 1 ? '' : 's'}`);
  }
  if (anomalyCount >= 5) {
    out.push('Triage anomaly backlog before shift-end');
  }
  if (out.length === 0) {
    out.push('Continue routine monitoring; no immediate action required');
  }
  return out.slice(0, 3);
}

function renderReportText(partial: Omit<ShiftReport, 'reportText'>): string {
  const generatedAtIso = new Date(partial.generatedAt).toISOString();
  const pulseLine = partial.civilizationScore !== null && partial.civilizationLabel !== null
    ? `Civilization pulse: ${partial.civilizationScore}/100 (${partial.civilizationLabel})`
    : 'Civilization pulse: unavailable';
  const narrativeLine = partial.worldNarrativeSummary === ''
    ? 'World narrative: unavailable'
    : `World narrative: ${partial.worldNarrativeSummary}`;
  const situationsLines = partial.topSituations.length === 0
    ? '  (no active situations)'
    : partial.topSituations.map((s) => `  • [${s.severity}] ${s.title} — ${s.domain} (${s.id})`).join('\n');

  const keyDevLines = partial.keyDevelopments.map((d) => `  • ${d}`).join('\n');
  const actionLines = partial.recommendedActions.map((a) => `  • ${a}`).join('\n');
  const handoffSection = partial.handoffNotes.trim() === ''
    ? '  (no handoff notes supplied by outgoing operator)'
    : partial.handoffNotes;

  return `=== Operator Shift Report — ${partial.period.toUpperCase()} ===
Generated: ${generatedAtIso}

== Overview ==
${pulseLine}
Anomalies in window: ${partial.anomalyCount}
Feed health: ${partial.feedHealthSummary}
${narrativeLine}

== Top Situations ==
${situationsLines}

== Key Developments ==
${keyDevLines}

== Recommended Actions ==
${actionLines}

== Handoff Notes ==
${handoffSection}
`;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

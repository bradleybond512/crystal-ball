/**
 * Diagnostics Export Bundle — per
 * docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md PR 8 (lines 536-544).
 *
 * Single JSON blob the user can copy/paste into a GitHub issue or the
 * Claude debug panel. Joins:
 *
 *   - SystemHealthReport          (PR 4)
 *   - NotificationTraceSummary    (PR 5)
 *   - DiagnosticEvent ring        (PR 1)
 *   - SelfTestReport              (PR 7) — optional
 *   - app metadata                (variant, version, runtime, build hash)
 *   - environment hints           (locale, timezone, NOT identifying)
 *
 * Pure deterministic. No DOM, no fetch, no globals. The host wires
 * each input as a snapshot and the bundle just composes + redacts.
 *
 * Plan invariants:
 *   - No PII in the output: API keys, bearer tokens, lat/lng of saved
 *     places, free-text user messages — all redacted by name pattern
 *     and by structural rules
 *   - Bundle is JSON-serializable (string round-trip = identity)
 *   - Bundle is small enough to paste into a GitHub issue (~256 KB cap;
 *     truncation is explicit and reported in metadata)
 */

import type {
  DiagnosticEvent,
  DiagnosticEventBus,
} from './diagnostic-events';
import type {
  NotificationTraceEntry,
  NotificationTraceRegistry,
} from './notification-trace';
import type {
  NotificationTraceSummary,
  SystemHealthReport,
} from './system-health-types';
import type { PredictedRiskReport } from './failure-prediction';
import type { DebtItem } from '@/services/quality/quality-debt';
import type { ImprovementReport } from '@/services/quality/self-improvement-scheduler';
import type { TrustBudgetReport } from '@/services/ops/trust-budget';
import type { ScenarioCoverage } from '@/services/scenarios/scenario-library';
import type { MissionState } from './mission-state-service';

// Imported from PR 7 self-test runner. Kept as a structural type so
// this module doesn't hard-depend on self-test.ts when self-test
// hasn't been built yet.
export interface SelfTestReportShape {
  generatedAt: number;
  status: string;
  results: readonly {
    id: string;
    label: string;
    status: string;
    reason: string;
    durationMs: number;
    at: number;
  }[];
  counts: Record<string, number>;
  totalDurationMs: number;
  summary: string;
}

// ── New field types (Phase 2: diagnostic completeness) ──────────────────

export interface AlgorithmCalibrationSummary {
  algorithmId: string;
  domain: string;
  graded: number;
  hitRate: number;
  weightedHitRate: number;
  meanDurationMs: number;
}

export interface MissionStateSummary {
  state: MissionState;
  staleFeedCount: number;
  criticalStaleFeedCount: number;
}

export interface FeedHealthEntry {
  id: string;
  name: string;
  status: string;
  lastUpdateIso: string | null;
  /** Nominal poll interval in ms from FEED_CATALOG (a.k.a. TTL). */
  ttlMs?: number;
  /** Observed gap between the two most recent updates in ms. Lets a
   *  triager compare TTL to reality at a glance. */
  actualFrequencyMs?: number;
}

/** Snapshot of a tunable algorithm parameter — used to debug "why did the
 *  app fire / not fire" by capturing the thresholds and time windows the
 *  algorithm was running with at the moment the bundle was generated. */
export interface AlgorithmParameterSummary {
  algorithmId: string;
  label: string;
  domain: string;
  /** Lower bound on the weighted hit rate before the algorithm is flagged.
   *  Maps to AlgorithmDefinition.minWeightedHitRate. */
  minWeightedHitRate?: number;
  /** Minimum graded sample count before the verdict is believed. */
  minGradedSamples?: number;
  /** Latency upper bound (ms). */
  maxMeanDurationMs?: number;
  /** Free-form extra parameters (other thresholds, time windows, etc.).
   *  Kept as a record so callers can extend without growing the schema. */
  extras?: Record<string, number | string | boolean>;
}

/** Richer mission-state output from `mission-state-mapper.ts` — the
 *  4-level + per-domain breakdown. Distinct from the simpler
 *  MissionStateSummary which is the 3-state menubar rollup. */
export interface MissionMappingSummary {
  global: string;
  domains: Record<string, string>;
  degradedFeeds: readonly string[];
  lastUpdated: number;
}

export interface SystemInfo {
  appVersion: string;
  buildHash?: string;
  /** ms since page load (performance.now()). */
  uptimeMs?: number;
  /** JS heap used bytes if available. */
  memoryUsedBytes?: number;
}

// ── Phase 2 enhancements: situation / correlation / panel-health / trace ──

/** Compact PanelHealth row shipped in the export. Mirrors the registry
 *  shape but keeps only fields that survive redaction + paste-cap. */
export interface PanelHealthEntry {
  panelId: string;
  label?: string;
  status: string;
  lastRenderAt?: number;
  lastErrorAt?: number;
  reason?: string;
}

/** Panel health rollup — counts plus a capped list of entries.
 *  Lets a triager answer "which panels are actually rendering?" in one
 *  glance without joining the full SystemHealthReport panel list. */
export interface PanelHealthSummary {
  total: number;
  rendered: number;
  degraded: number;
  errored: number;
  entries: readonly PanelHealthEntry[];
}

/** Active situation snapshot — id, name, severity, confidence + the
 *  IDs of the evidence the situation was built from. Cross-references
 *  with `correlations` and `recentEvents` so a triager can reconstruct
 *  the cascade without joining other tables. */
export interface SituationSummary {
  id: string;
  name: string;
  status: string;
  severity: string;
  domain: string;
  startedAt: number;
  updatedAt: number;
  observationIds: readonly string[];
  correlationIds: readonly string[];
  confidence: number;
  tags: readonly string[];
  summary?: string;
}

/** Correlation chain summary from correlator-v2. Confidence + chainType
 *  let a triager see "is the engine actually finding cross-domain
 *  links?" at a glance. */
export interface CorrelationSummary {
  id: string;
  chainType: string;
  title: string;
  confidence: number;
  detectedAt: number;
  eventIds: readonly string[];
}

/** Per-situation algorithm trace — answers "which algorithm produced
 *  this and on what evidence?". Confidence is the algorithm's reported
 *  confidence; evidenceChain is the ordered list of observations and
 *  correlations the algorithm consumed. */
export interface AlgorithmTraceEvidence {
  kind: 'observation' | 'correlation';
  id: string;
  summary?: string;
}

export interface AlgorithmTraceEntry {
  situationId: string;
  algorithmId: string;
  confidence: number;
  evidenceChain: readonly AlgorithmTraceEvidence[];
}

// ── Public API ──────────────────────────────────────────────────────────

export interface ExportBundleAppMeta {
  /** Free-form variant: 'full' / 'tech' / 'finance' / 'web'. */
  variant: string;
  /** package.json version. */
  version: string;
  /** Optional git short hash. */
  buildHash?: string;
  /** 'desktop' (Tauri) or 'web' (browser only). */
  runtime: 'desktop' | 'web';
  /** Optional sidecar version when known. */
  sidecarVersion?: string;
}

export interface ExportBundleEnvHints {
  /** Browser / Tauri locale string. */
  locale?: string;
  /** Time zone identifier (IANA). */
  timezone?: string;
  /** Whether the platform is macOS. The plan does not require deeper
   *  fingerprinting. */
  isMacOs?: boolean;
}

export interface DiagnosticsExportBundle {
  /** Schema version for the bundle itself. Bumped on shape changes. */
  schemaVersion: 2;
  generatedAt: number;
  app: ExportBundleAppMeta;
  env: ExportBundleEnvHints;
  systemHealth: SystemHealthReport;
  notificationSummary: NotificationTraceSummary;
  /** Last-N notification trace entries (events redacted). */
  notificationTraces: readonly NotificationTraceEntry[];
  /** Last-N diagnostic events (already small / structured by PR 1). */
  recentEvents: readonly DiagnosticEvent[];
  /** Optional self-test report from PR 7. */
  selfTest?: SelfTestReportShape;
  // ── Strategic self-improvement layer (post-PR197 integration pass) ──
  /** Per-capability failure-risk predictions. */
  failurePrediction?: PredictedRiskReport;
  /** Active intelligence-quality debt items (non-resolved), capped. */
  qualityDebt?: readonly DebtItem[];
  /** Trust budget per mission domain. */
  trustBudget?: TrustBudgetReport;
  /** Top improvement candidates this week + handoff outline. */
  improvementPlan?: ImprovementReport;
  /** Scenario library coverage by domain + category. */
  scenarioCoverage?: ScenarioCoverage;
  /** Per-algorithm calibration summaries from the evaluation ledger. */
  algorithmState?: readonly AlgorithmCalibrationSummary[];
  /** Overall mission state computed from feed-staleness rules. */
  missionState?: MissionStateSummary;
  /** Per-feed freshness snapshot (id, name, status, last update). */
  feedHealth?: readonly FeedHealthEntry[];
  /** Algorithm thresholds + time windows in use at bundle-time. */
  algorithmParameters?: readonly AlgorithmParameterSummary[];
  /** 4-level + per-domain mission-state mapping (companion to the
   *  3-level `missionState` rollup above). */
  missionMapping?: MissionMappingSummary;
  /** System runtime info: version, uptime, memory. */
  systemInfo?: SystemInfo;
  /** Phase 2: panel rendered/degraded/errored rollup + capped entries. */
  panelHealthSummary?: PanelHealthSummary;
  /** Phase 2: active situations with evidence cross-references. */
  situations?: readonly SituationSummary[];
  /** Phase 2: active correlation chains from correlator-v2. */
  correlations?: readonly CorrelationSummary[];
  /** Phase 2: per-situation algorithm trace + evidence chain. */
  algorithmTrace?: readonly AlgorithmTraceEntry[];
  /** Anything truncated for size, recorded so the consumer knows what
   *  was dropped. */
  truncations: ExportTruncationNote[];
}

export interface ExportTruncationNote {
  field: string;
  /** Original count before truncation. */
  originalCount: number;
  /** Number kept in the bundle. */
  keptCount: number;
  reason: string;
}

export interface BuildExportBundleInput {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
  app: ExportBundleAppMeta;
  env?: ExportBundleEnvHints;
  systemHealth: SystemHealthReport;
  /** Either the registry OR the snapshot+summary. The registry path
   *  is more convenient for desktop callers; the snapshot path is
   *  what the web build (which doesn't expose registries directly)
   *  uses. */
  notifications:
    | { registry: NotificationTraceRegistry; windowMs?: number }
    | { summary: NotificationTraceSummary; entries: readonly NotificationTraceEntry[] };
  events: DiagnosticEventBus | { snapshot: readonly DiagnosticEvent[] };
  selfTest?: SelfTestReportShape;
  // ── Strategic self-improvement layer (post-PR197 integration) ──
  failurePrediction?: PredictedRiskReport;
  /** Caller passes the live registry's `active()` snapshot. */
  qualityDebt?: readonly DebtItem[];
  trustBudget?: TrustBudgetReport;
  improvementPlan?: ImprovementReport;
  scenarioCoverage?: ScenarioCoverage;
  algorithmState?: readonly AlgorithmCalibrationSummary[];
  missionState?: MissionStateSummary;
  feedHealth?: readonly FeedHealthEntry[];
  algorithmParameters?: readonly AlgorithmParameterSummary[];
  missionMapping?: MissionMappingSummary;
  systemInfo?: SystemInfo;
  panelHealthSummary?: PanelHealthSummary;
  situations?: readonly SituationSummary[];
  correlations?: readonly CorrelationSummary[];
  algorithmTrace?: readonly AlgorithmTraceEntry[];
  /** Caps; see DEFAULTS below. */
  caps?: Partial<{
    maxNotificationTraces: number;
    maxRecentEvents: number;
    maxBundleBytes: number;
    maxQualityDebt: number;
    maxSituations: number;
    maxCorrelations: number;
    maxAlgorithmTrace: number;
    maxPanelHealthEntries: number;
  }>;
}

const DEFAULT_MAX_NOTIFICATION_TRACES = 50;
const DEFAULT_MAX_RECENT_EVENTS = 200;
const DEFAULT_MAX_BUNDLE_BYTES = 256 * 1024; // 256 KB
const DEFAULT_MAX_QUALITY_DEBT = 25;
const DEFAULT_MAX_SITUATIONS = 50;
const DEFAULT_MAX_CORRELATIONS = 50;
const DEFAULT_MAX_ALGORITHM_TRACE = 100;
const DEFAULT_MAX_PANEL_HEALTH_ENTRIES = 100;

export function buildExportBundle(input: BuildExportBundleInput): DiagnosticsExportBundle {
  const now = input.now ?? (() => Date.now());
  const truncations: ExportTruncationNote[] = [];
  const caps = {
    maxNotificationTraces: input.caps?.maxNotificationTraces ?? DEFAULT_MAX_NOTIFICATION_TRACES,
    maxRecentEvents: input.caps?.maxRecentEvents ?? DEFAULT_MAX_RECENT_EVENTS,
    maxBundleBytes: input.caps?.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES,
    maxQualityDebt: input.caps?.maxQualityDebt ?? DEFAULT_MAX_QUALITY_DEBT,
    maxSituations: input.caps?.maxSituations ?? DEFAULT_MAX_SITUATIONS,
    maxCorrelations: input.caps?.maxCorrelations ?? DEFAULT_MAX_CORRELATIONS,
    maxAlgorithmTrace: input.caps?.maxAlgorithmTrace ?? DEFAULT_MAX_ALGORITHM_TRACE,
    maxPanelHealthEntries: input.caps?.maxPanelHealthEntries ?? DEFAULT_MAX_PANEL_HEALTH_ENTRIES,
  };

  const { summary: notificationSummary, entries: notificationTracesRaw, totalCount } =
    resolveNotifications(input.notifications);
  const redactedTraces = notificationTracesRaw.map((e) => redactTraceEntry(e));
  const cappedTraces = redactedTraces.slice(
    Math.max(0, redactedTraces.length - caps.maxNotificationTraces),
  );
  if (totalCount > caps.maxNotificationTraces) {
    truncations.push({
      field: 'notificationTraces',
      originalCount: totalCount,
      keptCount: cappedTraces.length,
      reason: 'paste-friendly cap',
    });
  }
  const notificationTraces = cappedTraces;

  const allEvents = 'snapshot' in input.events ? input.events.snapshot : input.events.query();
  const redactedEvents = allEvents.map((e) => redactEvent(e));
  const recentEvents = redactedEvents.slice(
    Math.max(0, redactedEvents.length - caps.maxRecentEvents),
  );
  if (redactedEvents.length > caps.maxRecentEvents) {
    truncations.push({
      field: 'recentEvents',
      originalCount: redactedEvents.length,
      keptCount: recentEvents.length,
      reason: 'paste-friendly cap',
    });
  }

  const env: ExportBundleEnvHints = {
    locale: input.env?.locale,
    timezone: input.env?.timezone,
    isMacOs: input.env?.isMacOs,
  };

  // Cap the active quality debt list so the bundle stays paste-friendly.
  let qualityDebt: readonly DebtItem[] | undefined;
  if (input.qualityDebt) {
    if (input.qualityDebt.length > caps.maxQualityDebt) {
      qualityDebt = input.qualityDebt.slice(0, caps.maxQualityDebt);
      truncations.push({
        field: 'qualityDebt',
        originalCount: input.qualityDebt.length,
        keptCount: qualityDebt.length,
        reason: 'paste-friendly cap',
      });
    } else {
      qualityDebt = input.qualityDebt;
    }
  }

  const panelHealthSummary = redactPanelHealthSummary(
    input.panelHealthSummary,
    caps.maxPanelHealthEntries,
    truncations,
  );
  const situations = capAndRedact(
    input.situations,
    caps.maxSituations,
    'situations',
    truncations,
    redactSituation,
  );
  const correlations = capAndRedact(
    input.correlations,
    caps.maxCorrelations,
    'correlations',
    truncations,
    redactCorrelation,
  );
  const algorithmTrace = capAndRedact(
    input.algorithmTrace,
    caps.maxAlgorithmTrace,
    'algorithmTrace',
    truncations,
    redactAlgorithmTrace,
  );

  const bundle: DiagnosticsExportBundle = {
    schemaVersion: 2,
    generatedAt: now(),
    app: { ...input.app },
    env,
    systemHealth: redactSystemHealth(input.systemHealth),
    notificationSummary: { ...notificationSummary },
    notificationTraces,
    recentEvents,
    selfTest: input.selfTest ? cloneSelfTest(input.selfTest) : undefined,
    // Strategic sections — pass through redactStrategicSection so any
    // user-supplied free text (reasons, recommendations, handoff
    // outline, evidence detail) gets the same email/phone/bearer/coord
    // scrub the rest of the bundle gets.
    failurePrediction: redactStrategicSection(input.failurePrediction),
    qualityDebt: redactStrategicSection(qualityDebt),
    trustBudget: redactStrategicSection(input.trustBudget),
    improvementPlan: redactStrategicSection(input.improvementPlan),
    scenarioCoverage: redactStrategicSection(input.scenarioCoverage),
    algorithmState: input.algorithmState ? [...input.algorithmState] : undefined,
    missionState: input.missionState ? { ...input.missionState } : undefined,
    feedHealth: input.feedHealth ? [...input.feedHealth] : undefined,
    algorithmParameters: input.algorithmParameters ? [...input.algorithmParameters] : undefined,
    missionMapping: input.missionMapping
      ? {
          global: input.missionMapping.global,
          domains: { ...input.missionMapping.domains },
          degradedFeeds: [...input.missionMapping.degradedFeeds],
          lastUpdated: input.missionMapping.lastUpdated,
        }
      : undefined,
    systemInfo: input.systemInfo ? { ...input.systemInfo } : undefined,
    panelHealthSummary,
    situations,
    correlations,
    algorithmTrace,
    truncations,
  };

  return enforceByteCap(bundle, caps.maxBundleBytes);
}

function capAndRedact<T>(
  source: readonly T[] | undefined,
  cap: number,
  field: string,
  truncations: ExportTruncationNote[],
  redactor: (item: T) => T,
): readonly T[] | undefined {
  if (source === undefined) return undefined;
  const kept = source.length > cap ? source.slice(0, cap) : source;
  if (source.length > cap) {
    truncations.push({
      field,
      originalCount: source.length,
      keptCount: kept.length,
      reason: 'paste-friendly cap',
    });
  }
  return kept.map((item) => redactor(item));
}

function redactPanelHealthSummary(
  summary: PanelHealthSummary | undefined,
  cap: number,
  truncations: ExportTruncationNote[],
): PanelHealthSummary | undefined {
  if (summary === undefined) return undefined;
  const entries = summary.entries.length > cap ? summary.entries.slice(0, cap) : summary.entries;
  if (summary.entries.length > cap) {
    truncations.push({
      field: 'panelHealthSummary.entries',
      originalCount: summary.entries.length,
      keptCount: entries.length,
      reason: 'paste-friendly cap',
    });
  }
  return {
    total: summary.total,
    rendered: summary.rendered,
    degraded: summary.degraded,
    errored: summary.errored,
    entries: entries.map((e) => ({
      panelId: e.panelId,
      label: e.label,
      status: e.status,
      lastRenderAt: e.lastRenderAt,
      lastErrorAt: e.lastErrorAt,
      reason: e.reason ? redactString(e.reason) : e.reason,
    })),
  };
}

function redactSituation(s: SituationSummary): SituationSummary {
  return {
    ...s,
    name: s.name ? redactString(s.name) : s.name,
    observationIds: [...s.observationIds],
    correlationIds: [...s.correlationIds],
    // tags propagate from event.tags (event-derived content), so scrub them
    // with the same PII pattern redaction as name/summary rather than copying raw.
    tags: s.tags.map((t) => redactString(t)),
    summary: s.summary ? redactString(s.summary) : s.summary,
  };
}

function redactCorrelation(c: CorrelationSummary): CorrelationSummary {
  return {
    ...c,
    title: redactString(c.title),
    eventIds: [...c.eventIds],
  };
}

function redactAlgorithmTrace(t: AlgorithmTraceEntry): AlgorithmTraceEntry {
  return {
    ...t,
    evidenceChain: t.evidenceChain.map((e) => ({
      kind: e.kind,
      id: e.id,
      summary: e.summary ? redactString(e.summary) : e.summary,
    })),
  };
}

/** Structural-clone redactor for strategic-self-improvement export
 *  sections. These types come from upstream services that don't
 *  guarantee absence of free-text user input, so we pass them through
 *  the same pipeline that scrubs the rest of the bundle. Returns
 *  undefined when input is undefined so callers can keep the field
 *  optional. */
function redactStrategicSection<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  return redactDetail(value) as T;
}

/** Convenience: serialize the bundle to JSON. */
export function exportBundleToJson(bundle: DiagnosticsExportBundle): string {
  return JSON.stringify(bundle, undefined, 2);
}

/** Convenience: render the bundle as a markdown block fenced for
 *  pasting into a GitHub issue. */
export function exportBundleToMarkdown(bundle: DiagnosticsExportBundle): string {
  const json = exportBundleToJson(bundle);
  const sections: string[] = [
    `### Crystal Ball diagnostics bundle`,
    ``,
    `Generated: ${new Date(bundle.generatedAt).toISOString()}  `,
    `App: ${bundle.app.variant} v${bundle.app.version} (${bundle.app.runtime})`,
  ];

  if (bundle.panelHealthSummary) {
    const p = bundle.panelHealthSummary;
    sections.push(
      ``,
      `#### Panel health`,
      ``,
      `${p.total} total · ${p.rendered} rendered · ${p.degraded} degraded · ${p.errored} errored`,
    );
  }

  if (bundle.situations && bundle.situations.length > 0) {
    sections.push(``, `#### Active situations`, ``);
    for (const s of bundle.situations) {
      sections.push(
        `- **${s.name}** (\`${s.id}\`) — ${s.severity} · ${s.domain} · confidence ${s.confidence.toFixed(2)}`,
      );
    }
  }

  if (bundle.correlations && bundle.correlations.length > 0) {
    sections.push(``, `#### Correlation chains`, ``);
    for (const c of bundle.correlations) {
      sections.push(
        `- \`${c.chainType}\` — ${c.title} (confidence ${c.confidence.toFixed(2)}, ${c.eventIds.length} events)`,
      );
    }
  }

  if (bundle.algorithmTrace && bundle.algorithmTrace.length > 0) {
    sections.push(``, `#### Algorithm trace`, ``);
    for (const t of bundle.algorithmTrace) {
      sections.push(
        `- \`${t.algorithmId}\` → situation \`${t.situationId}\` (confidence ${t.confidence.toFixed(2)}, ${t.evidenceChain.length} evidence)`,
      );
    }
  }

  sections.push(``, `\`\`\`json`, json, `\`\`\``, ``);
  return sections.join('\n');
}

// ── Resolution helpers ─────────────────────────────────────────────────

function resolveNotifications(
  notifications: BuildExportBundleInput['notifications'],
): {
  summary: NotificationTraceSummary;
  entries: readonly NotificationTraceEntry[];
  totalCount: number;
} {
  if ('registry' in notifications) {
    const summary = notifications.registry.summary(notifications.windowMs);
    const all = notifications.registry.all();
    return { summary, entries: all, totalCount: all.length };
  }
  return {
    summary: notifications.summary,
    entries: notifications.entries,
    totalCount: notifications.entries.length,
  };
}

// ── Redaction ──────────────────────────────────────────────────────────

const REDACTED = '[redacted]';

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|secret|token|password|bearer|cookie|session|email|phone|ssn|account[_-]?number|credit[_-]?card)/i;

// Matches exact coordinate keys AND camelCase compound suffixes (savedPlaceLat,
// homeLng, etc.) plus GeoJSON-adjacent keys (coord, coordinates, position, gps, geo).
const COORDINATE_KEY_PATTERN =
  /^(?:lat|lng|long|latitude|longitude|coord|coordinates|position|gps|geo)$|(?:lat|lng|lon(?:g)?)$/i;

// Recursively blur numeric coordinates inside a GeoJSON coordinates array
// (e.g. [lng, lat] or [[lng, lat], ...]).  Non-number elements pass through.
function blurGeoJsonCoords(v: unknown): unknown {
  if (typeof v === 'number') return Math.round(v * 10) / 10;
  if (Array.isArray(v)) return v.map((el) => blurGeoJsonCoords(el));
  return v;
}

/** Redact a single object entry by key + value (extracted from redactDetail
 *  to keep that function's branching flat). */
function redactDetailEntry(key: string, val: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
  if (COORDINATE_KEY_PATTERN.test(key)) {
    // Round to ~10 km grid so the bundle reflects "user is near here" without
    // exact location; GeoJSON coordinate arrays are blurred member-wise.
    if (typeof val === 'number') return Math.round(val * 10) / 10;
    if (Array.isArray(val)) return blurGeoJsonCoords(val);
  }
  return redactDetail(val);
}

/** Strip API keys, bearer tokens, e-mails, phone numbers, exact lat/lng,
 *  and free-text user messages from a structural detail object. The
 *  redaction is conservative — when in doubt, replace the value. */
export function redactDetail(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactDetail(v));
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(source)) {
      out[key] = redactDetailEntry(key, val);
    }
    return out;
  }
  if (typeof value === 'string') return redactString(value);
  return value;
}

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_PATTERN = /\b\+?\d{1,3}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const BEARER_PATTERN = /\bBearer\s[A-Za-z0-9._\-+/=]{8,}\b/g;
const LONG_HEX_PATTERN = /\b[a-f0-9]{32,}\b/gi;
// Common credential-leak shapes inside free-text reason / lastError /
// log lines. Catches "password=...", "pwd:...", "key=...", "secret:..."
// and the OpenAI / similar "sk-..." prefix tokens. The structural
// key-name redaction handles {password: '...'} object literals; this
// regex set covers the path where credentials appear inside concatenated
// strings, log lines, and URL query params.
// Two simpler patterns — split to keep regex complexity below the
// SonarJS threshold while covering the same lexicons.
const CRED_PHRASE_WORD_PATTERN = /\b(?:password|passwd|pwd|secret)\s*[:=]\s*\S+/gi;
const CRED_PHRASE_TOKEN_PATTERN = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token)\s*[:=]\s*\S+/gi;
const SK_TOKEN_PATTERN = /\bsk-[A-Za-z0-9_\-]{16,}\b/g;
const URL_CRED_QUERY_PATTERN = /([?&](?:access_token|api_key|apikey|key|token|secret|password)=)([^&\s]+)/gi;
// Home-directory paths leak the OS username (e.g. via stack traces / log file
// paths). Keep the structural prefix, redact the username segment.
const HOME_PATH_PATTERN = /(\/(?:Users|home)\/)[^/\s]+/g;
const WINDOWS_HOME_PATH_PATTERN = /([A-Za-z]:\\Users\\)[^\\\s]+/g;
// High-precision decimal coordinates (4+ decimal places) reveal exact
// locations. Match pairs like "41.6105,-86.7234" or standalone values
// in the range ±180 with 4+ fractional digits.
const COORDINATE_PATTERN = /\b-?\d{1,3}\.\d{4,}\b/g;

function redactCredPhrase(match: string): string {
  const sep = match.includes('=') ? '=' : ':';
  const key = match.split(/[:=]/)[0] ?? match;
  return `${key}${sep}${REDACTED}`;
}

export function redactString(s: string): string {
  return s
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(CRED_PHRASE_WORD_PATTERN, redactCredPhrase)
    .replace(CRED_PHRASE_TOKEN_PATTERN, redactCredPhrase)
    .replace(SK_TOKEN_PATTERN, REDACTED)
    .replace(URL_CRED_QUERY_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(HOME_PATH_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(WINDOWS_HOME_PATH_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(LONG_HEX_PATTERN, REDACTED)
    .replace(COORDINATE_PATTERN, REDACTED);
}

function redactEvent(event: DiagnosticEvent): DiagnosticEvent {
  // DiagnosticEvent shape comes from PR 1; it has free-text fields.
  // Use a structural copy so we don't mutate the original.
  const copy = { ...event } as DiagnosticEvent & { detail?: unknown; message?: unknown };
  if (typeof copy.message === 'string') copy.message = redactString(copy.message);
  if (copy.detail) copy.detail = redactDetail(copy.detail) as DiagnosticEvent['detail'];
  return copy as DiagnosticEvent;
}

function redactTraceEntry(entry: NotificationTraceEntry): NotificationTraceEntry {
  return {
    candidate: {
      ...entry.candidate,
      headline: entry.candidate.headline ? redactString(entry.candidate.headline) : entry.candidate.headline,
    },
    events: entry.events.map((ev) => ({
      ...ev,
      reason: redactString(ev.reason),
      detail: ev.detail ? (redactDetail(ev.detail) as Record<string, unknown>) : ev.detail,
    })),
    decision: entry.decision,
    decisionReason: entry.decisionReason ? redactString(entry.decisionReason) : entry.decisionReason,
    rung: entry.rung,
    nativeResult: entry.nativeResult ? { ...entry.nativeResult } : entry.nativeResult,
    userAction: entry.userAction
      ? {
          ...entry.userAction,
          detail: entry.userAction.detail
            ? (redactDetail(entry.userAction.detail) as Record<string, unknown>)
            : entry.userAction.detail,
        }
      : entry.userAction,
  };
}

function redactSystemHealth(report: SystemHealthReport): SystemHealthReport {
  // The aggregator output is already structured + free of PII by design.
  // We still pass the free-text strings through redactString so any
  // user-supplied text in `reason` / `userImpact` doesn't leak.
  return {
    ...report,
    summary: redactString(report.summary),
    features: report.features.map((f) => ({
      ...f,
      reason: redactString(f.reason),
      userImpact: redactString(f.userImpact),
      recommendedAction: redactString(f.recommendedAction),
    })),
    // PanelHealth.lastError is a free-text error message that can carry a leaked
    // URL / token / PII from whatever threw inside the panel — redact it.
    panels: report.panels.map((p) => ({
      ...p,
      lastError: p.lastError ? redactString(p.lastError) : p.lastError,
    })),
    sources: report.sources.map((s) => ({ ...s, reason: redactString(s.reason) })),
    // The unsafe-suppression reasons are free-text and surface in the bundle.
    notifications: {
      ...report.notifications,
      unsafeSuppressions: report.notifications.unsafeSuppressions.map((u) => ({
        ...u,
        reason: redactString(u.reason),
      })),
    },
    sidecar: { ...report.sidecar, reason: redactString(report.sidecar.reason) },
    recommendations: report.recommendations.map((r) => redactString(r)),
  };
}

// ── Truncation + size cap ──────────────────────────────────────────────

function enforceByteCap(
  bundle: DiagnosticsExportBundle,
  maxBytes: number,
): DiagnosticsExportBundle {
  const json = JSON.stringify(bundle);
  if (textByteLength(json) <= maxBytes) return bundle;

  // Drop notification traces first (they're the largest), then events,
  // then self-test detail. Each drop adds a truncation note.
  const out: DiagnosticsExportBundle = { ...bundle };
  const truncations = [...out.truncations];

  if (out.notificationTraces.length > 0) {
    truncations.push({
      field: 'notificationTraces',
      originalCount: out.notificationTraces.length,
      keptCount: 0,
      reason: `bundle exceeded ${maxBytes} bytes`,
    });
    out.notificationTraces = [];
  }
  if (textByteLength(JSON.stringify(out)) <= maxBytes) {
    return { ...out, truncations };
  }

  if (out.recentEvents.length > 0) {
    truncations.push({
      field: 'recentEvents',
      originalCount: out.recentEvents.length,
      keptCount: 0,
      reason: `bundle exceeded ${maxBytes} bytes`,
    });
    out.recentEvents = [];
  }
  return { ...out, truncations };
}

function textByteLength(s: string): number {
  if (typeof TextEncoder === 'undefined') return s.length;
  return new TextEncoder().encode(s).length;
}

function cloneSelfTest(report: SelfTestReportShape): SelfTestReportShape {
  return {
    ...report,
    results: report.results.map((r) => ({ ...r })),
    counts: { ...report.counts },
  };
}

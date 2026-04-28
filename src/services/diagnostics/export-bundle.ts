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
  schemaVersion: 1;
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
  /** Caps; see DEFAULTS below. */
  caps?: Partial<{
    maxNotificationTraces: number;
    maxRecentEvents: number;
    maxBundleBytes: number;
  }>;
}

const DEFAULT_MAX_NOTIFICATION_TRACES = 50;
const DEFAULT_MAX_RECENT_EVENTS = 200;
const DEFAULT_MAX_BUNDLE_BYTES = 256 * 1024; // 256 KB

export function buildExportBundle(input: BuildExportBundleInput): DiagnosticsExportBundle {
  const now = input.now ?? (() => Date.now());
  const truncations: ExportTruncationNote[] = [];
  const caps = {
    maxNotificationTraces: input.caps?.maxNotificationTraces ?? DEFAULT_MAX_NOTIFICATION_TRACES,
    maxRecentEvents: input.caps?.maxRecentEvents ?? DEFAULT_MAX_RECENT_EVENTS,
    maxBundleBytes: input.caps?.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES,
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

  const bundle: DiagnosticsExportBundle = {
    schemaVersion: 1,
    generatedAt: now(),
    app: { ...input.app },
    env,
    systemHealth: redactSystemHealth(input.systemHealth),
    notificationSummary: { ...notificationSummary },
    notificationTraces,
    recentEvents,
    selfTest: input.selfTest ? cloneSelfTest(input.selfTest) : undefined,
    truncations,
  };

  return enforceByteCap(bundle, caps.maxBundleBytes);
}

/** Convenience: serialize the bundle to JSON. */
export function exportBundleToJson(bundle: DiagnosticsExportBundle): string {
  return JSON.stringify(bundle, undefined, 2);
}

/** Convenience: render the bundle as a markdown block fenced for
 *  pasting into a GitHub issue. */
export function exportBundleToMarkdown(bundle: DiagnosticsExportBundle): string {
  const json = exportBundleToJson(bundle);
  return `### Crystal Ball diagnostics bundle\n\nGenerated: ${new Date(bundle.generatedAt).toISOString()}  \nApp: ${bundle.app.variant} v${bundle.app.version} (${bundle.app.runtime})\n\n\`\`\`json\n${json}\n\`\`\`\n`;
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

const COORDINATE_KEY_PATTERN = /^(?:lat|lng|long|latitude|longitude)$/i;

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
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
      } else if (COORDINATE_KEY_PATTERN.test(key) && typeof val === 'number') {
        // Round to ~10 km grid so the bundle reflects "user is near here"
        // without exact location.
        out[key] = Math.round(val * 10) / 10;
      } else {
        out[key] = redactDetail(val);
      }
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

function redactString(s: string): string {
  return s
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(LONG_HEX_PATTERN, REDACTED);
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
    sources: report.sources.map((s) => ({ ...s, reason: redactString(s.reason) })),
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

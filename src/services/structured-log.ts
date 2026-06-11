/**
 * Structured logging façade.
 *
 * Emits one JSON-shaped record per call, fans out to console,
 * breadcrumb ring buffer, and (for warn/error) the desktop log.
 * Wraps log-bridge.ts — does NOT replace it.
 *
 * Invariants:
 *  - formatRecord() is pure and unit-testable without any browser API.
 *  - slog() guards debug output behind import.meta.env.DEV.
 *  - No throws from slog() — caller must not handle logging errors.
 */

import { recordBreadcrumb, logToDesktop } from './log-bridge';

// ── Public types ────────────────────────────────────────────────────────

export type SlogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SlogRecord {
  at: number;
  level: SlogLevel;
  category: string;       // e.g. 'pipeline', 'feed', 'notification'
  message: string;
  traceId?: string;       // ties a fact through the pipeline (Phase 3)
  fields?: Record<string, string | number | boolean | null>;
}

// ── Pure core ────────────────────────────────────────────────────────────

/** Serialize a SlogRecord to a single-line JSON string with stable key order. */
export function formatRecord(r: SlogRecord): string {
  // Stable key order: at, level, cat, msg, trace (optional), then spread fields.
  const base: Record<string, unknown> = {
    at: r.at,
    level: r.level,
    cat: r.category,
    msg: r.message,
  };
  if (r.traceId !== undefined) {
    base.trace = r.traceId;
  }
  return JSON.stringify({ ...base, ...r.fields });
}

// ── Impure emit ──────────────────────────────────────────────────────────

const LEVEL_TO_BREADCRUMB = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
} as const satisfies Record<SlogLevel, 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'>;

const LEVEL_TO_DESKTOP = {
  warn: 'WARN',
  error: 'ERROR',
} as const;

/**
 * Emit a structured log record. Fans out to:
 *   - console (debug only in DEV; info/warn/error always)
 *   - breadcrumb ring buffer
 *   - logToDesktop for warn/error (fires async Tauri IPC, noop in browser)
 */
export function slog(
  level: SlogLevel,
  category: string,
  message: string,
  opts?: {
    traceId?: string;
    fields?: SlogRecord['fields'];
    now?: () => number;
  },
): void {
  const at = (opts?.now ?? (() => Date.now()))();
  const record: SlogRecord = { at, level, category, message, traceId: opts?.traceId, fields: opts?.fields };
  const line = formatRecord(record);

  // Console fan-out — debug only in DEV
  /* eslint-disable no-console */
  if (level === 'debug') {
    if (import.meta.env.DEV) {
      console.debug(line);
    }
  } else if (level === 'info') {
    console.info(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.error(line);
  }
  /* eslint-enable no-console */

  // Breadcrumb ring buffer
  recordBreadcrumb(
    LEVEL_TO_BREADCRUMB[level],
    category,
    message.slice(0, 200),
    opts?.fields as Record<string, unknown> | undefined,
  );

  // Desktop log (warn + error only)
  if (level in LEVEL_TO_DESKTOP) {
    const desktopLevel = LEVEL_TO_DESKTOP[level as keyof typeof LEVEL_TO_DESKTOP];
    logToDesktop(desktopLevel, message, opts?.fields as Record<string, unknown> | undefined);
  }
}

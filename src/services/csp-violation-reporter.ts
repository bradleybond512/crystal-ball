/**
 * R3-SEC-004: CSP breakage must be visible in the desktop log, not silent.
 *
 * Each violation is reported once per (directive, blocked origin) per window,
 * with only the ORIGIN of the blocked resource — never its path or query,
 * which can carry user data (a coordinate, a search term) — plus the path of
 * the script that triggered it. A distinct-key cap stops a broken page from
 * flooding the log.
 */
import { logToDesktop } from './log-bridge';

export interface CspViolationLike {
  effectiveDirective?: string;
  violatedDirective?: string;
  blockedURI?: string;
  sourceFile?: string;
  lineNumber?: number;
  disposition?: string;
}

export interface CspViolationSummary {
  key: string;
  directive: string;
  blocked: string;
  source: string;
}

const KEYWORD_SOURCES = new Set(['inline', 'eval', 'wasm-eval', 'self', 'trusted-types-policy', 'trusted-types-sink']);
const MAX_DISTINCT_REPORTS = 50;

function blockedOrigin(uri: string | undefined): string {
  if (!uri) return 'unknown';
  if (KEYWORD_SOURCES.has(uri)) return uri;
  try {
    const url = new URL(uri);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol.slice(0, -1);
    // Non-special schemes (tauri:, asset:) report origin "null"; rebuild it.
    return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
  } catch {
    return 'unknown';
  }
}

function sourcePath(file: string | undefined): string {
  if (!file) return 'unknown';
  try {
    const url = new URL(file);
    const origin = url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
    return `${origin}${url.pathname}`;
  } catch {
    return 'unknown';
  }
}

function firstToken(value: string | undefined): string | undefined {
  const token = value?.trim().split(/\s+/)[0];
  return token === undefined || token === '' ? undefined : token;
}

export function summarizeViolation(event: CspViolationLike): CspViolationSummary {
  // An empty effectiveDirective falls through to violatedDirective.
  const directive = firstToken(event.effectiveDirective) ?? firstToken(event.violatedDirective) ?? 'unknown';
  const blocked = blockedOrigin(event.blockedURI);
  return { key: `${directive} ${blocked}`, directive, blocked, source: sourcePath(event.sourceFile) };
}

export type CspLog = (message: string, context: Record<string, unknown>) => void;

/** Returns a handler that reports each distinct violation once; true when it logged. */
export function createCspViolationReporter(log: CspLog, maxDistinct = MAX_DISTINCT_REPORTS): (event: CspViolationLike) => boolean {
  const seen = new Set<string>();
  return (event) => {
    const summary = summarizeViolation(event);
    if (seen.has(summary.key) || seen.size >= maxDistinct) return false;
    seen.add(summary.key);
    log(`CSP blocked ${summary.directive}: ${summary.blocked}`, {
      directive: summary.directive,
      blocked: summary.blocked,
      source: summary.source,
      line: typeof event.lineNumber === 'number' ? event.lineNumber : null,
      disposition: event.disposition ?? 'enforce',
    });
    return true;
  };
}

/** Install on a window's document; returns an uninstall function. */
export function installCspViolationReporter(
  target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document,
  log: CspLog = (message, context) => logToDesktop('WARN', message, context),
): () => void {
  const report = createCspViolationReporter(log);
  const listener = (event: Event) => { report(event as unknown as CspViolationLike); };
  target.addEventListener('securitypolicyviolation', listener);
  return () => target.removeEventListener('securitypolicyviolation', listener);
}

/**
 * Evidence journal client (R4-LOW-008).
 *
 * Keeps the sidecar's append-only evidence journal (`evidence.db`) in step
 * with the renderer's calibration ledgers, which stay the fast working copies:
 *
 *   - Reconcile (boot, every 15 min, and 2 s after any ledger change): send
 *     the working set's `(kind, id, digest)` triples, then append only the
 *     entries the journal lacks. The local ledger is the outbox, so anything
 *     written while the sidecar was down catches up on the next run.
 *   - Rebuild (once per session, at first contact): when a ledger is empty or
 *     holds fewer records than the journal, fold the newest journal entries
 *     back in.
 *   - Export: a JSONL copy of the whole journal for the user's own backup.
 *
 * Every request goes to a loopback sidecar on an `/api/local-` path. The
 * desktop fetch patch never retries those against the cloud API, and this
 * client refuses any non-loopback base URL as a second line of defence.
 *
 * Dependencies are injected so tests run with fakes; the app wiring lives in
 * `evidence-journal-wiring.ts`.
 */

import type { EvidenceSourceKind } from './evidence-bus';
import { foldLatest, type EvidenceEntry, type EvidenceKind, type JournalEntry } from './evidence-projection';

export const EVIDENCE_ROUTES = Object.freeze({
  append: '/api/local-evidence/append',
  missing: '/api/local-evidence/missing',
  records: '/api/local-evidence/records',
  summary: '/api/local-evidence/summary',
  export: '/api/local-evidence/export',
});

export const RECONCILE_INTERVAL_MS = 15 * 60_000;
export const FIRST_RUN_DELAY_MS = 20_000;
export const CHANGE_DEBOUNCE_MS = 2000;
export const RETRY_BASE_MS = 30_000;
export const MISSING_CHUNK = 2000;
export const APPEND_CHUNK = 200;
const RECORDS_PAGE = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]']);

export interface EvidenceSourceAdapter {
  kind: EvidenceSourceKind;
  /** The ledger's working-set size. */
  capacity: number;
  /** Journal kinds this source rebuilds from (the first is its primary kind). */
  rebuildKinds: readonly EvidenceKind[];
  /** Scored entries for the current working set. */
  collect(): Promise<EvidenceEntry[]>;
  localCount(): number;
  /** Merge folded journal entries; returns how many records were added. */
  mergeRebuilt(byKind: Partial<Record<EvidenceKind, JournalEntry[]>>): number;
}

interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface EvidenceJournalDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  baseUrl: () => string;
  /** False outside the desktop runtime: no request is ever made. */
  available: () => boolean;
  sources: readonly EvidenceSourceAdapter[];
  timers?: TimerApi;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface EvidenceChainStatus {
  ok: boolean;
  count: number;
  brokenAtSeq?: number | null;
  reason?: string;
}

export interface EvidenceSummary {
  total: number;
  byKind: Record<string, number>;
  sizeBytes: number;
  maxBytes: number;
  chain: EvidenceChainStatus;
  lastAppendedAt: number | null;
}

export interface ReconcileReport {
  checked: number;
  sent: number;
  appended: number;
  rejected: number;
}

export interface RebuildReport {
  added: Partial<Record<EvidenceSourceKind, number>>;
}

export interface EvidenceJournal {
  reconcile(): Promise<ReconcileReport>;
  rebuild(): Promise<RebuildReport>;
  summary(): Promise<EvidenceSummary | null>;
  exportJsonl(): Promise<string>;
  /** Schedule a debounced reconcile after a ledger change. */
  noteChanged(): void;
  start(): void;
  stop(): void;
}

export class EvidenceJournalError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'EvidenceJournalError';
  }
}

/** Only an http loopback origin may receive evidence. */
export function isLoopbackBase(base: string): boolean {
  try {
    const url = new URL(base);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function entryKey(entry: { kind: string; id: string }): string {
  return `${entry.kind}|${entry.id}`;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.seq === 'number' && typeof entry.kind === 'string' && typeof entry.recordId === 'string'
    && typeof entry.digest === 'string' && !!entry.payload && typeof entry.payload === 'object';
}

export function createEvidenceJournal(deps: EvidenceJournalDeps): EvidenceJournal {
  const timers: TimerApi = deps.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  };
  const log = deps.log ?? (() => undefined);
  /** Digests the journal is known to hold, per `kind|id`. */
  const confirmed = new Map<string, string>();
  /** Digests the sidecar rejected this session; not resent until they change. */
  const rejected = new Map<string, string>();
  let rebuilt = false;
  let chain: Promise<unknown> = Promise.resolve();
  let failures = 0;
  let started = false;
  let intervalHandle: unknown = null;
  let pendingHandle: unknown = null;

  function url(route: string): string {
    if (!deps.available()) throw new EvidenceJournalError('evidence journal is only available in the desktop app');
    const base = deps.baseUrl();
    if (!isLoopbackBase(base)) throw new EvidenceJournalError('evidence journal requires a loopback sidecar');
    return `${base}${route}`;
  }

  async function request(route: string, init?: RequestInit): Promise<Response> {
    const response = await deps.fetch(url(route), { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new EvidenceJournalError(`evidence journal answered ${response.status}`, response.status);
    return response;
  }

  async function postJson(route: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object') throw new EvidenceJournalError('evidence journal returned an invalid response');
    return parsed as Record<string, unknown>;
  }

  async function reconcile(): Promise<ReconcileReport> {
    const perSource = await Promise.all(deps.sources.map((source) => source.collect()));
    const entries = perSource.flat();
    const live = new Set(entries.map((entry) => entryKey(entry)));
    for (const key of confirmed.keys()) if (!live.has(key)) confirmed.delete(key);
    for (const key of rejected.keys()) if (!live.has(key)) rejected.delete(key);

    const pending = entries.filter((entry) => {
      const key = entryKey(entry);
      return confirmed.get(key) !== entry.digest && rejected.get(key) !== entry.digest;
    });
    const report: ReconcileReport = { checked: entries.length, sent: 0, appended: 0, rejected: 0 };
    if (pending.length === 0) return report;

    const missing: EvidenceEntry[] = [];
    for (const chunk of chunks(pending, MISSING_CHUNK)) {
      const result = await postJson(EVIDENCE_ROUTES.missing, {
        entries: chunk.map((entry) => ({ kind: entry.kind, id: entry.id, digest: entry.digest })),
      });
      const absent = new Set(Array.isArray(result.missing)
        ? result.missing.filter((index): index is number => Number.isInteger(index))
        : chunk.map((_, index) => index));
      chunk.forEach((entry, index) => {
        if (absent.has(index)) missing.push(entry);
        else confirmed.set(entryKey(entry), entry.digest);
      });
    }

    for (const chunk of chunks(missing, APPEND_CHUNK)) {
      const result = await postJson(EVIDENCE_ROUTES.append, {
        entries: chunk.map((entry) => ({ kind: entry.kind, payload: entry.payload })),
      });
      const results = Array.isArray(result.results) ? result.results : [];
      report.sent += chunk.length;
      chunk.forEach((entry, index) => {
        const status = (results[index] as { status?: unknown } | undefined)?.status;
        if (status === 'appended' || status === 'duplicate') {
          confirmed.set(entryKey(entry), entry.digest);
          if (status === 'appended') report.appended += 1;
        } else if (status === 'rejected') {
          rejected.set(entryKey(entry), entry.digest);
          report.rejected += 1;
        }
      });
    }
    if (report.rejected > 0) {
      log('evidence journal rejected entries', { rejected: report.rejected });
    }
    return report;
  }

  async function fetchFolded(kind: EvidenceKind, wanted: number): Promise<JournalEntry[]> {
    const rows: JournalEntry[] = [];
    let before: number | null = null;
    // Each record has at most a few rows (pending then resolved), so four
    // pages' worth per wanted record bounds the walk.
    const ceiling = Math.max(RECORDS_PAGE, wanted * 4);
    for (;;) {
      const params = new URLSearchParams({ kind, limit: String(RECORDS_PAGE) });
      if (before !== null) params.set('before_seq', String(before));
      const response = await request(`${EVIDENCE_ROUTES.records}?${params.toString()}`);
      const page = (await response.json()) as { entries?: unknown; nextBeforeSeq?: unknown };
      const entries = Array.isArray(page.entries)
        ? page.entries.filter((entry): entry is JournalEntry => isJournalEntry(entry))
        : [];
      rows.push(...entries.filter((entry) => entry.kind === kind));
      const next = typeof page.nextBeforeSeq === 'number' ? page.nextBeforeSeq : null;
      if (next === null || rows.length >= ceiling || foldLatest(rows).length >= wanted) break;
      before = next;
    }
    return foldLatest(rows);
  }

  async function rebuild(): Promise<RebuildReport> {
    const summary = await fetchSummary();
    const report: RebuildReport = { added: {} };
    for (const source of deps.sources) {
      const [primary] = source.rebuildKinds;
      if (!primary) continue;
      const journalRows = summary.byKind[primary] ?? 0;
      const local = source.localCount();
      const shouldRebuild = journalRows > 0 && (local === 0 || (local < source.capacity && journalRows > local));
      if (!shouldRebuild) continue;
      const byKind: Partial<Record<EvidenceKind, JournalEntry[]>> = {};
      for (const kind of source.rebuildKinds) {
        byKind[kind] = await fetchFolded(kind, kind === primary ? source.capacity : 1);
      }
      const added = source.mergeRebuilt(byKind);
      if (added > 0) report.added[source.kind] = added;
    }
    if (Object.keys(report.added).length > 0) log('evidence journal rebuilt ledgers', { ...report.added });
    return report;
  }

  async function fetchSummary(): Promise<EvidenceSummary> {
    const response = await request(EVIDENCE_ROUTES.summary);
    const raw = (await response.json()) as Partial<EvidenceSummary>;
    if (typeof raw.total !== 'number' || !raw.byKind || typeof raw.byKind !== 'object' || !raw.chain) {
      throw new EvidenceJournalError('evidence journal returned an invalid summary');
    }
    return {
      total: raw.total,
      byKind: raw.byKind,
      sizeBytes: typeof raw.sizeBytes === 'number' ? raw.sizeBytes : 0,
      maxBytes: typeof raw.maxBytes === 'number' ? raw.maxBytes : 0,
      chain: {
        ok: raw.chain.ok === true,
        count: typeof raw.chain.count === 'number' ? raw.chain.count : 0,
        brokenAtSeq: typeof raw.chain.brokenAtSeq === 'number' ? raw.chain.brokenAtSeq : null,
        reason: typeof raw.chain.reason === 'string' ? raw.chain.reason : undefined,
      },
      lastAppendedAt: typeof raw.lastAppendedAt === 'number' ? raw.lastAppendedAt : null,
    };
  }

  /** Serialize cycles so two reconciles never interleave. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  }

  async function cycle(): Promise<void> {
    if (!rebuilt) {
      await rebuild();
      rebuilt = true;
    }
    await reconcile();
  }

  function schedule(ms: number): void {
    if (pendingHandle !== null) timers.clearTimeout(pendingHandle);
    pendingHandle = timers.setTimeout(() => {
      pendingHandle = null;
      void runScheduled();
    }, ms);
  }

  async function runScheduled(): Promise<void> {
    if (!deps.available()) return;
    try {
      await enqueue(cycle);
      failures = 0;
    } catch (error) {
      failures += 1;
      const delay = Math.min(RECONCILE_INTERVAL_MS, RETRY_BASE_MS * 2 ** (failures - 1));
      log('evidence journal sync failed; retrying', {
        error: error instanceof Error ? error.message : String(error),
        retryInMs: delay,
      });
      if (started) schedule(delay);
    }
  }

  return {
    reconcile: () => enqueue(reconcile),
    rebuild: () => enqueue(rebuild),
    async summary() {
      if (!deps.available()) return null;
      try {
        return await fetchSummary();
      } catch {
        return null;
      }
    },
    async exportJsonl() {
      await enqueue(cycle);
      const response = await request(EVIDENCE_ROUTES.export);
      return response.text();
    },
    noteChanged() {
      if (started) schedule(CHANGE_DEBOUNCE_MS);
    },
    start() {
      if (started || !deps.available()) return;
      started = true;
      schedule(FIRST_RUN_DELAY_MS);
      intervalHandle = timers.setInterval(() => { void runScheduled(); }, RECONCILE_INTERVAL_MS);
    },
    stop() {
      started = false;
      if (pendingHandle !== null) timers.clearTimeout(pendingHandle);
      if (intervalHandle !== null) timers.clearInterval(intervalHandle);
      pendingHandle = null;
      intervalHandle = null;
    },
  };
}

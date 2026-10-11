/**
 * Evidence journal client (R4-LOW-008).
 *
 * Keeps the sidecar's append-only evidence journal (`evidence.db`) in step
 * with the renderer's calibration ledgers, which stay the fast working copies:
 *
 *   - Reconcile (boot, every 15 min, and 2 s after any ledger change): send
 *     the working set's `(kind, id, digest)` triples, then append only the
 *     entries the journal lacks. A separate bounded scored outbox captures
 *     each mutation before the working ledgers apply their rolling caps.
 *   - Capture drain: replay saved scored states in admission order and remove
 *     only receipts with an exact known acknowledgement. Refusals stay visible.
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

import type { EvidenceOutbox } from './evidence-outbox';
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
  outbox?: EvidenceOutbox;
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
  return JSON.stringify([entry.kind, entry.id, (entry as EvidenceEntry).digest]);
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

interface AppendResult { status: 'appended' | 'duplicate' | 'rejected' }
function appendResults(result: Record<string, unknown>, count: number): AppendResult[] {
  if (!Array.isArray(result.results) || result.results.length !== count) throw new EvidenceJournalError('evidence journal returned invalid append results');
  const rows: AppendResult[] = [];
  for (const value of result.results as unknown[]) {
    if (!value || typeof value !== 'object') throw new EvidenceJournalError('evidence journal returned invalid append results');
    const row = value as Record<string, unknown>;
    if ((row.status !== 'appended' && row.status !== 'duplicate' && row.status !== 'rejected')
      || Object.keys(row).some(k => k !== 'status' && k !== 'reason')
      || (row.reason !== undefined && typeof row.reason !== 'string')) throw new EvidenceJournalError('evidence journal returned invalid append results');
    rows.push({ status: row.status });
  }
  return rows;
}

export function createEvidenceJournal(deps: EvidenceJournalDeps): EvidenceJournal {
  const timers: TimerApi = deps.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  };
  const log = deps.log ?? (() => undefined);
  /** Exact current-working-state identities known to be committed. */
  const confirmed = new Map<string, string>();
  /** Digests the sidecar rejected this session; not resent until they change. */
  const rejected = new Map<string, string>();
  let rebuilt = false;
  let chain: Promise<unknown> = Promise.resolve();
  let failures = 0;
  let started = false;
  let generation = 0;
  let intervalHandle: unknown = null;
  let pendingHandle: unknown = null;
  let pendingRetry = false;
  let scheduledRunning = false;
  let unsubscribe: (() => void) | null = null;

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

  async function reconcileWorking(): Promise<ReconcileReport> {
    const perSource = await Promise.all(deps.sources.map((source) => source.collect()));
    const entries = perSource.flat().filter(entry => !deps.outbox?.hasPendingIdentity(entry.kind, entry.id));
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
      if (!Array.isArray(result.missing) || result.missing.some(index => !Number.isInteger(index) || index < 0 || index >= chunk.length)
        || new Set(result.missing).size !== result.missing.length) throw new EvidenceJournalError('evidence journal returned invalid missing indexes');
      const absent = new Set<number>(result.missing);
      chunk.forEach((entry, index) => {
        if (absent.has(index)) missing.push(entry);
        else confirmed.set(entryKey(entry), entry.digest);
      });
    }

    for (const chunk of chunks(missing, APPEND_CHUNK)) {
      const result = await postJson(EVIDENCE_ROUTES.append, {
        entries: chunk.map((entry) => ({ kind: entry.kind, payload: entry.payload })),
      });
      const results = appendResults(result, chunk.length);
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

  async function drain(watermark: number): Promise<ReconcileReport> {
    const report: ReconcileReport = { checked: 0, sent: 0, appended: 0, rejected: 0 };
    const outbox = deps.outbox;
    if (!outbox) return report;
    const owner = generation;
    await outbox.materializeThrough(watermark);
    if (owner !== generation) throw new EvidenceJournalError('evidence sync stopped before acknowledgement');
    const receipts = outbox.readyThrough(watermark);
    report.checked = receipts.length;
    for (const chunk of chunks(receipts, APPEND_CHUNK)) {
      let result: Record<string, unknown>;
      try { result = await postJson(EVIDENCE_ROUTES.append, { entries: chunk.map(entry => ({ kind: entry.kind, payload: entry.payload })) }); }
      catch (error) {
        if (owner === generation) { outbox.setJournalFull(error instanceof EvidenceJournalError && error.status === 507); }
        throw error;
      }
      const results = appendResults(result, chunk.length);
      if (owner !== generation) throw new EvidenceJournalError('evidence sync stopped before acknowledgement');
      outbox.setJournalFull(false);
      report.sent += chunk.length;
      chunk.forEach((receipt, index) => {
        const status = results[index]!.status;
        if (status === 'rejected') {
          outbox.reject(receipt); rejected.set(entryKey(receipt), receipt.digest); report.rejected += 1;
        } else {
          outbox.ack(receipt); confirmed.set(entryKey(receipt), receipt.digest);
          if (status === 'appended') report.appended += 1;
        }
      });
    }
    const diagnostic = outbox.diagnostics();
    if (diagnostic.blocked || diagnostic.awaitingStorage > 0 || diagnostic.terminalBlocked > 0 || outbox.readyThrough(watermark).length > 0) {
      throw new EvidenceJournalError('scored evidence remains pending in local storage');
    }
    return report;
  }

  async function reconcile(watermark = deps.outbox?.watermark() ?? 0): Promise<ReconcileReport> {
    const captured = await drain(watermark);
    const working = await reconcileWorking();
    return { checked: captured.checked + working.checked, sent: captured.sent + working.sent,
      appended: captured.appended + working.appended, rejected: captured.rejected + working.rejected };
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
    const owner = generation;
    const guarded = () => {
      if (owner !== generation) throw new EvidenceJournalError('evidence sync stopped before execution');
      return task();
    };
    const run = chain.then(guarded, guarded);
    chain = run.catch(() => undefined);
    return run;
  }

  async function cycle(watermark = deps.outbox?.watermark() ?? 0): Promise<void> {
    await drain(watermark);
    if (!rebuilt) {
      await rebuild();
      rebuilt = true;
    }
    await reconcileWorking();
    if (started && (deps.outbox?.watermark() ?? 0) > watermark) schedule(CHANGE_DEBOUNCE_MS);
  }

  function schedule(ms: number, retry = false): void {
    if (pendingHandle !== null) {
      if (!retry || pendingRetry) return;
      timers.clearTimeout(pendingHandle);
    }
    pendingRetry = retry;
    pendingHandle = timers.setTimeout(() => {
      pendingHandle = null;
      pendingRetry = false;
      void runScheduled();
    }, ms);
  }

  async function runScheduled(): Promise<void> {
    if (!started || !deps.available() || scheduledRunning) return;
    scheduledRunning = true;
    const owner = generation;
    try {
      await enqueue(cycle);
      failures = 0;
    } catch (error) {
      failures += 1;
      const delay = Math.min(RECONCILE_INTERVAL_MS, RETRY_BASE_MS * 2 ** (failures - 1));
      log('evidence journal sync failed; retrying', {
        error: error instanceof EvidenceJournalError && error.status ? `status-${error.status}` : 'local-sync-failed',
        retryInMs: delay,
      });
      if (started && owner === generation) schedule(delay, true);
    } finally { scheduledRunning = false; }
  }

  return {
    reconcile: () => { const watermark = deps.outbox?.watermark() ?? 0; return enqueue(() => reconcile(watermark)); },
    rebuild: () => { const watermark = deps.outbox?.watermark() ?? 0; return enqueue(async () => { await drain(watermark); return rebuild(); }); },
    async summary() {
      if (!deps.available()) return null;
      try {
        return await fetchSummary();
      } catch {
        return null;
      }
    },
    async exportJsonl() {
      const watermark = deps.outbox?.watermark() ?? 0;
      return enqueue(async () => {
        await cycle(watermark);
        const response = await request(EVIDENCE_ROUTES.export);
        return response.text();
      });
    },
    noteChanged() {
      if (started) schedule(CHANGE_DEBOUNCE_MS);
    },
    start() {
      if (started || !deps.available()) return;
      started = true;
      let notifiedWatermark = deps.outbox?.watermark() ?? 0;
      unsubscribe = deps.outbox?.subscribe(() => {
        const next = deps.outbox!.watermark();
        if (next > notifiedWatermark) { notifiedWatermark = next; if (started) schedule(CHANGE_DEBOUNCE_MS); }
      }) ?? null;
      schedule(FIRST_RUN_DELAY_MS);
      intervalHandle = timers.setInterval(() => { void runScheduled(); }, RECONCILE_INTERVAL_MS);
    },
    stop() {
      started = false;
      generation += 1;
      unsubscribe?.(); unsubscribe = null;
      if (pendingHandle !== null) timers.clearTimeout(pendingHandle);
      if (intervalHandle !== null) timers.clearInterval(intervalHandle);
      pendingHandle = null;
      intervalHandle = null;
    },
  };
}

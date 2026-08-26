import type {
  ListUcdpEventsRequest,
  ListUcdpEventsResponse,
  ServerContext,
  UcdpViolenceEvent,
  UcdpViolenceType,
} from '../../../../src/generated/server/crystalball/conflict/v1/service_server';
import { CHROME_UA } from '../../../_shared/constants';

const UCDP_VERSION = '26.1';
const WINDOW_START = '2025-09-02';
const WINDOW_END = '2025-12-31';
const WINDOW_START_MS = Date.parse(`${WINDOW_START}T00:00:00.000Z`);
const WINDOW_END_MS = Date.parse(`${WINDOW_END}T23:59:59.999Z`);
const UPSTREAM_PAGE_SIZE = 1000;
const MAX_UPSTREAM_PAGES = 10;
const MAX_UPSTREAM_ROWS = 10_000;
const MAX_CONCURRENCY = 4;
const DEFAULT_DISPLAY_LIMIT = 100;
const MAX_DISPLAY_LIMIT = 100;
const DEFAULT_DEADLINE_MS = 30_000;
const DEFAULT_PAGE_BYTES = 3 * 1024 * 1024;
const DEFAULT_AGGREGATE_BYTES = 24 * 1024 * 1024;
const POSITIVE_CACHE_MS = 6 * 60 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 30 * 60 * 1000;

const VIOLENCE_TYPES: Readonly<Record<number, UcdpViolenceType>> = {
  1: 'UCDP_VIOLENCE_TYPE_STATE_BASED',
  2: 'UCDP_VIOLENCE_TYPE_NON_STATE',
  3: 'UCDP_VIOLENCE_TYPE_ONE_SIDED',
};

interface CredentialSnapshot { token: string; fingerprint: string; generation: number }
interface UcdpEnvelope { Result: unknown[]; TotalCount: number; TotalPages: number }
interface CacheEntry {
  events: UcdpViolenceEvent[];
  expiresAt: number;
  fingerprint: string;
  generation: number;
  cacheId: string;
}
interface RefreshState {
  fingerprint: string;
  generation: number;
  controller: AbortController;
  promise: Promise<UcdpViolenceEvent[]>;
}
interface CooldownState { fingerprint: string; generation: number; until: number }
interface TestRuntime { now: () => number; deadlineMs: number; maxPageBytes: number; maxAggregateBytes: number }

class UcdpHttpError extends Error {
  readonly body = '';
  constructor(readonly statusCode: number, message: string, readonly retryAfter?: number) {
    super(message);
    this.name = 'UcdpHttpError';
  }
}

const defaultRuntime: TestRuntime = {
  now: Date.now,
  deadlineMs: DEFAULT_DEADLINE_MS,
  maxPageBytes: DEFAULT_PAGE_BYTES,
  maxAggregateBytes: DEFAULT_AGGREGATE_BYTES,
};
let runtime = { ...defaultRuntime };
let credentialState: CredentialSnapshot | null = null;
let credentialGeneration = 0;
let credentialTransition: Promise<void> | null = null;
let corpusCache: CacheEntry | null = null;
let currentRefresh: RefreshState | null = null;
let quotaCooldown: CooldownState | null = null;

function httpError(statusCode: number, message: string, retryAfter?: number): UcdpHttpError {
  return new UcdpHttpError(statusCode, message, retryAfter);
}

function isLoopbackRequest(request: Request): boolean {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

async function credentialFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 16), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function clearOldGeneration(): Promise<void> {
  const old = currentRefresh;
  old?.controller.abort(httpError(503, 'UCDP credential changed during request'));
  await old?.promise.catch(() => undefined);
  corpusCache = null;
  quotaCooldown = null;
  if (currentRefresh === old) currentRefresh = null;
}

async function transitionCredential(token: string): Promise<void> {
  const fingerprint = token ? await credentialFingerprint(token) : '';
  if ((process.env.UCDP_API_TOKEN?.trim() ?? '') !== token) return;
  if ((credentialState?.token ?? '') === token) return;
  await clearOldGeneration();
  if ((process.env.UCDP_API_TOKEN?.trim() ?? '') !== token) return;
  credentialGeneration++;
  credentialState = token ? { token, fingerprint, generation: credentialGeneration } : null;
}

async function snapshotCredential(): Promise<CredentialSnapshot> {
  for (;;) {
    const token = process.env.UCDP_API_TOKEN?.trim() ?? '';
    if (token && credentialState?.token === token) return credentialState;
    if (!token && !credentialState && !credentialTransition) {
      throw httpError(503, 'UCDP credential is not configured');
    }
    if (!credentialTransition) {
      const transition = transitionCredential(token);
      const tracked = transition.finally(() => {
        if (credentialTransition === tracked) credentialTransition = null;
      });
      credentialTransition = tracked;
    }
    await credentialTransition;
  }
}

function credentialMatches(snapshot: CredentialSnapshot): boolean {
  return credentialState?.generation === snapshot.generation
    && credentialState.fingerprint === snapshot.fingerprint
    && (process.env.UCDP_API_TOKEN?.trim() ?? '') === snapshot.token;
}

function validateRequest(req: ListUcdpEventsRequest): { limit: number; cursor: string } {
  if (req.country.trim()) throw httpError(400, 'UCDP country filtering is not supported');
  if (req.start !== 0 || req.end !== 0) throw httpError(400, 'UCDP date filtering is not supported');
  const limit = req.pageSize === 0 ? DEFAULT_DISPLAY_LIMIT : req.pageSize;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DISPLAY_LIMIT) {
    throw httpError(400, 'Invalid UCDP page size');
  }
  const cursor = req.cursor.trim();
  if (cursor.length > 128 || (cursor && !/^[A-Za-z0-9_-]+$/.test(cursor))) {
    throw httpError(400, 'Invalid UCDP cursor');
  }
  return { limit, cursor };
}

function encodeCursor(cacheId: string, offset: number): string {
  return btoa(`${cacheId}:${offset}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeCursor(cursor: string): { cacheId: string; offset: number } {
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(cursor.length / 4) * 4, '=');
    const match = /^(?<cacheId>[0-9a-f-]{36}):(?<offset>[1-9]\d*)$/u.exec(atob(padded));
    const offset = Number(match?.groups?.offset);
    if (!match?.groups?.cacheId || !Number.isSafeInteger(offset)) throw new Error('invalid');
    return { cacheId: match.groups.cacheId, offset };
  } catch {
    throw httpError(400, 'Invalid UCDP cursor');
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseEnvelope(value: unknown): UcdpEnvelope {
  if (!isObject(value) || !Array.isArray(value.Result)
    || !Number.isSafeInteger(value.TotalCount) || !Number.isSafeInteger(value.TotalPages)
    || !Object.prototype.hasOwnProperty.call(value, 'NextPageUrl')
    || !Object.prototype.hasOwnProperty.call(value, 'PreviousPageUrl')) {
    throw httpError(502, 'UCDP returned a malformed response');
  }
  const totalCount = value.TotalCount as number;
  const totalPages = value.TotalPages as number;
  if (totalCount < 1 || totalCount > MAX_UPSTREAM_ROWS || totalPages < 1 || totalPages > MAX_UPSTREAM_PAGES
    || totalPages !== Math.ceil(totalCount / UPSTREAM_PAGE_SIZE)) {
    throw httpError(502, 'UCDP returned invalid pagination metadata');
  }
  return value as unknown as UcdpEnvelope;
}

function abortError(signal: AbortSignal): UcdpHttpError {
  return signal.reason instanceof UcdpHttpError ? signal.reason : httpError(503, 'UCDP request timed out');
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<{ body: unknown; bytes: number }> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > runtime.maxPageBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw httpError(502, 'UCDP response exceeded byte limit');
  }
  if (!response.body) throw httpError(502, 'UCDP returned a malformed response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
    rejectAbort(abortError(signal));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), aborted]);
      } catch (error) {
        if (signal.aborted) throw abortError(signal);
        throw error;
      }
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > runtime.maxPageBytes) {
        await reader.cancel();
        throw httpError(502, 'UCDP response exceeded byte limit');
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { body: JSON.parse(new TextDecoder().decode(combined)), bytes };
  } catch {
    throw httpError(502, 'UCDP returned a malformed response');
  }
}

function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) ? Math.min(seconds, QUOTA_COOLDOWN_MS / 1000) : undefined;
}

async function cancelUnusedBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function fetchPage(page: number, credential: CredentialSnapshot, signal: AbortSignal) {
  if (signal.aborted) throw abortError(signal);
  const url = new URL(`https://ucdpapi.pcr.uu.se/api/gedevents/${UCDP_VERSION}`);
  url.searchParams.set('pagesize', String(UPSTREAM_PAGE_SIZE));
  url.searchParams.set('page', String(page));
  url.searchParams.set('StartDate', WINDOW_START);
  url.searchParams.set('EndDate', WINDOW_END);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': CHROME_UA, 'x-ucdp-access-token': credential.token },
      redirect: 'error',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw httpError(503, 'UCDP request timed out');
    }
    throw httpError(502, 'UCDP upstream unavailable');
  }
  if (response.status === 401 || response.status === 403) {
    await cancelUnusedBody(response);
    throw httpError(response.status, 'UCDP authentication failed');
  }
  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response);
    await cancelUnusedBody(response);
    throw httpError(429, 'UCDP rate limited', retryAfter);
  }
  if (!response.ok) {
    await cancelUnusedBody(response);
    throw httpError(502, 'UCDP upstream unavailable');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await cancelUnusedBody(response);
    throw httpError(502, 'UCDP returned a malformed response');
  }
  const { body, bytes } = await readBoundedJson(response, signal);
  return { envelope: parseEnvelope(body), bytes };
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function dateMs(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}
function text(value: unknown, max: number, required: boolean): string | null {
  if (value === null || value === undefined) return required ? null : '';
  if (typeof value !== 'string') return null;
  const result = value.trim().slice(0, max);
  return required && !result ? null : result;
}
function normalizeEvent(raw: unknown): UcdpViolenceEvent | null {
  if (!isObject(raw)) return null;
  const id = finiteNumber(raw.id);
  const start = dateMs(raw.date_start);
  const end = dateMs(raw.date_end);
  const latitude = finiteNumber(raw.latitude);
  const longitude = finiteNumber(raw.longitude);
  const low = finiteNumber(raw.low);
  const best = finiteNumber(raw.best);
  const high = finiteNumber(raw.high);
  const violence = finiteNumber(raw.type_of_violence);
  const country = text(raw.country, 120, true);
  const sideA = text(raw.side_a, 200, true);
  const sideB = text(raw.side_b, 200, true);
  const source = text(raw.source_original, 300, false);
  const violenceType = violence === null ? undefined : VIOLENCE_TYPES[violence];
  if (!Number.isSafeInteger(id) || (id as number) <= 0 || start === null || end === null || end < start
    || start < WINDOW_START_MS || start > WINDOW_END_MS
    || latitude === null || latitude < -90 || latitude > 90
    || longitude === null || longitude < -180 || longitude > 180
    || !Number.isSafeInteger(low) || !Number.isSafeInteger(best) || !Number.isSafeInteger(high)
    || (low as number) < 0 || (low as number) > (best as number) || (best as number) > (high as number)
    || !violenceType || !country || !sideA || !sideB || source === null) return null;
  return {
    id: String(id), dateStart: start, dateEnd: end, location: { latitude, longitude }, country,
    sideA, sideB, deathsBest: best as number, deathsLow: low as number, deathsHigh: high as number,
    violenceType, sourceOriginal: source,
  };
}

function expectedPageLength(page: number, totalCount: number, totalPages: number): number {
  return page < totalPages - 1 ? UPSTREAM_PAGE_SIZE : totalCount - (UPSTREAM_PAGE_SIZE * (totalPages - 1));
}

async function fetchCompleteCorpus(credential: CredentialSnapshot, controller: AbortController): Promise<UcdpViolenceEvent[]> {
  const timeout = setTimeout(() => controller.abort(httpError(503, 'UCDP request timed out')), runtime.deadlineMs);
  try {
    const first = await fetchPage(0, credential, controller.signal);
    const { TotalCount: totalCount, TotalPages: totalPages } = first.envelope;
    if (first.envelope.Result.length !== expectedPageLength(0, totalCount, totalPages)) {
      throw httpError(502, 'UCDP returned an incomplete page');
    }
    const pages = new Map<number, unknown[]>([[0, first.envelope.Result]]);
    let aggregateBytes = first.bytes;
    if (aggregateBytes > runtime.maxAggregateBytes) throw httpError(502, 'UCDP response exceeded aggregate byte limit');
    let nextPage = 1;
    let terminalError: unknown;
    const worker = async () => {
      for (;;) {
        if (terminalError || controller.signal.aborted) return;
        const pageIndex = nextPage++;
        if (pageIndex >= totalPages) return;
        try {
          const current = await fetchPage(pageIndex, credential, controller.signal);
          if (current.envelope.TotalCount !== totalCount || current.envelope.TotalPages !== totalPages) {
            throw httpError(502, 'UCDP returned inconsistent pagination metadata');
          }
          if (current.envelope.Result.length !== expectedPageLength(pageIndex, totalCount, totalPages)) {
            throw httpError(502, 'UCDP returned an incomplete page');
          }
          aggregateBytes += current.bytes;
          if (aggregateBytes > runtime.maxAggregateBytes) throw httpError(502, 'UCDP response exceeded aggregate byte limit');
          pages.set(pageIndex, current.envelope.Result);
        } catch (error) {
          if (!terminalError) terminalError = error;
          controller.abort(error);
          return;
        }
      }
    };
    await Promise.allSettled(Array.from({ length: Math.min(MAX_CONCURRENCY, totalPages - 1) }, worker));
    if (terminalError) throw terminalError;
    if (controller.signal.aborted) throw abortError(controller.signal);
    const rows = Array.from({ length: totalPages }, (_, page) => pages.get(page) ?? []).flat();
    if (rows.length !== totalCount) throw httpError(502, 'UCDP row count mismatch');
    const ids = new Set<string>();
    for (const raw of rows) {
      const id = isObject(raw) ? finiteNumber(raw.id) : null;
      if (!Number.isSafeInteger(id) || (id as number) <= 0) continue;
      const key = String(id);
      if (ids.has(key)) throw httpError(502, 'UCDP duplicate event ID');
      ids.add(key);
    }
    const events = rows.flatMap((raw) => {
      const event = normalizeEvent(raw);
      return event ? [event] : [];
    });
    if (events.length === 0) throw httpError(502, 'UCDP returned zero usable observations');
    events.sort((a, b) => b.dateStart - a.dateStart || Number(b.id) - Number(a.id));
    if (!credentialMatches(credential)) throw httpError(503, 'UCDP credential changed during request');
    return events;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCorpus(credential: CredentialSnapshot): Promise<UcdpViolenceEvent[]> {
  const now = runtime.now();
  if (corpusCache?.expiresAt && corpusCache.expiresAt > now
    && corpusCache.fingerprint === credential.fingerprint && corpusCache.generation === credential.generation) return corpusCache.events;
  corpusCache = null;
  if (quotaCooldown?.until && quotaCooldown.until > now
    && quotaCooldown.fingerprint === credential.fingerprint && quotaCooldown.generation === credential.generation) {
    const remaining = Math.max(1, Math.min(1800, Math.ceil((quotaCooldown.until - now) / 1000)));
    throw httpError(429, 'UCDP rate limited', remaining);
  }
  quotaCooldown = null;
  if (currentRefresh?.fingerprint === credential.fingerprint && currentRefresh.generation === credential.generation) {
    return currentRefresh.promise;
  }
  const controller = new AbortController();
  const refresh = {} as RefreshState;
  refresh.fingerprint = credential.fingerprint;
  refresh.generation = credential.generation;
  refresh.controller = controller;
  refresh.promise = fetchCompleteCorpus(credential, controller)
    .then((events) => {
      if (!credentialMatches(credential)) throw httpError(503, 'UCDP credential changed during request');
      corpusCache = {
        events,
        expiresAt: runtime.now() + POSITIVE_CACHE_MS,
        fingerprint: credential.fingerprint,
        generation: credential.generation,
        cacheId: crypto.randomUUID(),
      };
      return events;
    })
    .catch((error) => {
      if (error instanceof UcdpHttpError && error.statusCode === 429 && credentialMatches(credential)) {
        quotaCooldown = { fingerprint: credential.fingerprint, generation: credential.generation, until: runtime.now() + QUOTA_COOLDOWN_MS };
      }
      throw error;
    })
    .finally(() => { if (currentRefresh === refresh) currentRefresh = null; });
  currentRefresh = refresh;
  return refresh.promise;
}

export async function listUcdpEvents(ctx: ServerContext, req: ListUcdpEventsRequest): Promise<ListUcdpEventsResponse> {
  if (!isLoopbackRequest(ctx.request)) throw httpError(503, 'UCDP is available only through the desktop sidecar');
  const { limit, cursor } = validateRequest(req);
  if (cursor) {
    const active = corpusCache;
    const parsed = decodeCursor(cursor);
    if (!active || active.expiresAt <= runtime.now() || parsed.cacheId !== active.cacheId
      || parsed.offset >= active.events.length
      || credentialState?.token !== (process.env.UCDP_API_TOKEN?.trim() ?? '')
      || credentialState.generation !== active.generation || credentialState.fingerprint !== active.fingerprint) {
      throw httpError(400, 'Invalid UCDP cursor');
    }
    const end = Math.min(active.events.length, parsed.offset + limit);
    return {
      events: active.events.slice(parsed.offset, end),
      pagination: {
        nextCursor: end < active.events.length ? encodeCursor(active.cacheId, end) : '',
        totalCount: active.events.length,
      },
    };
  }
  const credential = await snapshotCredential();
  const corpus = await getCorpus(credential);
  const active = corpusCache;
  if (!active || active.events !== corpus || !credentialMatches(credential)) {
    throw httpError(503, 'UCDP credential changed during request');
  }
  return {
    events: corpus.slice(0, limit),
    pagination: { nextCursor: corpus.length > limit ? encodeCursor(active.cacheId, limit) : '', totalCount: corpus.length },
  };
}

export function __setUcdpTestRuntime(overrides: Partial<TestRuntime>): void { runtime = { ...runtime, ...overrides }; }
export function __getUcdpStateForTests() {
  return { cache: corpusCache ? 1 : 0, inflight: currentRefresh ? 1 : 0, cooldown: quotaCooldown ? 1 : 0 };
}
export function __resetUcdpStateForTests(): void {
  currentRefresh?.controller.abort(httpError(503, 'UCDP test reset'));
  credentialState = null;
  credentialGeneration = 0;
  credentialTransition = null;
  corpusCache = null;
  currentRefresh = null;
  quotaCooldown = null;
  runtime = { ...defaultRuntime };
}

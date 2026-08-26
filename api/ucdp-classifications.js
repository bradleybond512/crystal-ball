import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const VERSION = '26.1';
const YEAR = 2025;
const PAGE_SIZE = 1000;
const CACHE_MS = 6 * 60 * 60 * 1000;
const DEADLINE_MS = 30_000;
const MAX_BYTES = 3 * 1024 * 1024;
const SENTINELS = new Set([0, 1]);
const QUOTA_COOLDOWN_MS = 30 * 60 * 1000;
const defaultRuntime = { now: Date.now, deadlineMs: DEADLINE_MS };

let cache = null;
let inflight = null;
let credential = null;
let generation = 0;
let credentialTransition = null;
let quotaCooldown = null;
let runtime = { ...defaultRuntime };

function response(payload, status, cors) {
  return Response.json(payload, {
    status,
    headers: { ...cors, 'cache-control': 'no-store' },
  });
}

function failure(status, cors, retryAfter) {
  const headers = retryAfter === undefined ? cors : { ...cors, 'retry-after': String(retryAfter) };
  return response({ error: 'UCDP classifications unavailable', degraded: true }, status, headers);
}

function isLoopback(req) {
  try {
    const hostname = new URL(req.url).hostname.toLowerCase();
    return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

async function fingerprint(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function transitionCredential(token) {
  const nextFingerprint = token ? await fingerprint(token) : '';
  if ((process.env.UCDP_API_TOKEN?.trim() ?? '') !== token) return;
  if ((credential?.token ?? '') === token) return;
  const old = inflight;
  old?.controller.abort();
  await old?.promise.catch(() => undefined);
  if ((process.env.UCDP_API_TOKEN?.trim() ?? '') !== token) return;
  cache = null;
  quotaCooldown = null;
  if (inflight === old) inflight = null;
  credential = token ? { token, fingerprint: nextFingerprint, generation: ++generation } : null;
  if (!token) generation++;
}

async function syncCredential(token) {
  for (;;) {
    if (token && credential?.token === token) return credential;
    if (!token && !credential && !credentialTransition) return null;
    if (!credentialTransition) {
      const transition = transitionCredential(token);
      const tracked = transition.finally(() => {
        if (credentialTransition === tracked) credentialTransition = null;
      });
      credentialTransition = tracked;
    }
    await credentialTransition;
    token = process.env.UCDP_API_TOKEN?.trim() ?? '';
  }
}

function parseRetryAfter(response) {
  const value = response.headers.get('retry-after');
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? Math.min(seconds, 1800) : undefined;
}

async function cancelUnusedBody(upstream) {
  await upstream.body?.cancel().catch(() => undefined);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readBoundedJson(upstream, signal) {
  const declared = upstream.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_BYTES) {
    await upstream.body?.cancel().catch(() => undefined);
    throw new Error('malformed');
  }
  if (!upstream.body) throw new Error('malformed');
  const reader = upstream.body.getReader();
  if (signal.aborted) {
    await reader.cancel().catch(() => undefined);
    throw new DOMException('aborted', 'AbortError');
  }
  const chunks = [];
  let bytes = 0;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
    rejectAbort(new DOMException('aborted', 'AbortError'));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('malformed');
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(combined)); } catch { throw new Error('malformed'); }
}

function normalize(body) {
  if (!isObject(body) || !Array.isArray(body.Result)
    || !Number.isSafeInteger(body.TotalCount) || !Number.isSafeInteger(body.TotalPages)
    || !Object.prototype.hasOwnProperty.call(body, 'NextPageUrl')
    || !Object.prototype.hasOwnProperty.call(body, 'PreviousPageUrl')
    || body.TotalCount < 1 || body.TotalCount > PAGE_SIZE || body.TotalPages !== 1
    || body.Result.length !== body.TotalCount) throw new Error('malformed');
  const countries = new Set();
  const countryIds = new Set();
  const classifications = [];
  for (const raw of body.Result) {
    if (!isObject(raw) || typeof raw.country !== 'string' || !raw.country.trim()
      || !Number.isSafeInteger(raw.country_id) || raw.country_id <= 0 || raw.year !== YEAR
      || !SENTINELS.has(raw.sb_exist) || !SENTINELS.has(raw.ns_exist) || !SENTINELS.has(raw.os_exist)) {
      throw new Error('malformed');
    }
    const country = raw.country.trim();
    if (countries.has(country) || countryIds.has(raw.country_id)) throw new Error('malformed');
    countries.add(country);
    countryIds.add(raw.country_id);
    classifications.push({
      country,
      countryId: raw.country_id,
      year: YEAR,
      stateBased: raw.sb_exist === 1,
      nonState: raw.ns_exist === 1,
      oneSided: raw.os_exist === 1,
    });
  }
  return { classifications, totalCount: classifications.length, version: VERSION };
}

async function load(snapshot, controller) {
  const url = new URL(`https://ucdpapi.pcr.uu.se/api/organizedviolencecy/${VERSION}`);
  url.searchParams.set('Year', String(YEAR));
  url.searchParams.set('pagesize', String(PAGE_SIZE));
  url.searchParams.set('page', '0');
  const upstream = await fetch(url, {
    headers: { Accept: 'application/json', 'x-ucdp-access-token': snapshot.token },
    redirect: 'error',
    signal: controller.signal,
  });
  if (upstream.status === 401 || upstream.status === 403 || upstream.status === 429) {
    const error = new Error('upstream');
    error.status = upstream.status;
    error.retryAfter = upstream.status === 429 ? parseRetryAfter(upstream) : undefined;
    await cancelUnusedBody(upstream);
    throw error;
  }
  if (!upstream.ok || !upstream.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await cancelUnusedBody(upstream);
    throw new Error('upstream');
  }
  const normalized = normalize(await readBoundedJson(upstream, controller.signal));
  if ((process.env.UCDP_API_TOKEN?.trim() ?? '') !== snapshot.token || credential?.generation !== snapshot.generation) {
    throw new Error('credential changed');
  }
  return normalized;
}

async function getClassifications(snapshot) {
  const now = runtime.now();
  if (cache?.expiresAt > now && cache.fingerprint === snapshot.fingerprint && cache.generation === snapshot.generation) {
    return cache.payload;
  }
  cache = null;
  if (quotaCooldown?.until > now && quotaCooldown.fingerprint === snapshot.fingerprint
    && quotaCooldown.generation === snapshot.generation) {
    const error = new Error('quota cooldown');
    error.status = 429;
    error.retryAfter = Math.max(1, Math.min(1800, Math.ceil((quotaCooldown.until - now) / 1000)));
    throw error;
  }
  quotaCooldown = null;
  if (inflight?.fingerprint === snapshot.fingerprint && inflight.generation === snapshot.generation) return inflight.promise;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.deadlineMs);
  const state = { fingerprint: snapshot.fingerprint, generation: snapshot.generation, controller, promise: null };
  state.promise = load(snapshot, controller).then((payload) => {
    if ((process.env.UCDP_API_TOKEN?.trim() ?? '') !== snapshot.token || credential?.generation !== snapshot.generation) {
      throw new Error('credential changed');
    }
    cache = { payload, expiresAt: runtime.now() + CACHE_MS, fingerprint: snapshot.fingerprint, generation: snapshot.generation };
    return payload;
  }).catch((error) => {
    if (error?.status === 429 && (process.env.UCDP_API_TOKEN?.trim() ?? '') === snapshot.token
      && credential?.generation === snapshot.generation) {
      quotaCooldown = {
        fingerprint: snapshot.fingerprint,
        generation: snapshot.generation,
        until: runtime.now() + QUOTA_COOLDOWN_MS,
      };
    }
    throw error;
  }).finally(() => {
    clearTimeout(timer);
    if (inflight === state) inflight = null;
  });
  inflight = state;
  return state.promise;
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return response({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return response({ error: 'Method not allowed' }, 405, cors);
  if (!isLoopback(req)) return failure(503, cors);
  const token = process.env.UCDP_API_TOKEN?.trim() ?? '';
  if (!token) {
    await syncCredential('');
    return failure(503, cors);
  }
  try {
    const snapshot = await syncCredential(token);
    if (!snapshot) return failure(503, cors);
    return response(await getClassifications(snapshot), 200, cors);
  } catch (error) {
    if (error?.status === 401 || error?.status === 403 || error?.status === 429) {
      return failure(error.status, cors, error.retryAfter);
    }
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      return failure(503, cors);
    }
    if (error?.message === 'credential changed') return failure(503, cors);
    return failure(502, cors);
  }
}

export function __setUcdpClassificationsRuntimeForTests(overrides) {
  runtime = { ...runtime, ...overrides };
}

export function __resetUcdpClassificationsForTests() {
  inflight?.controller.abort();
  cache = null;
  inflight = null;
  credential = null;
  generation = 0;
  credentialTransition = null;
  quotaCooldown = null;
  runtime = { ...defaultRuntime };
}

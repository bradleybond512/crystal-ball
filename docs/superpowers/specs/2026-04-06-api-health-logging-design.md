# API Health Logging — Design

**Goal:** Make it possible to answer "which APIs are working right now?" from `/api/diag` and the Cmd+Shift+D diagnostic bundle.

**Problem:** The existing `wmRecordHostFailure` is wired to the sidecar dispatch error path, so the `host` it records is always `127.0.0.1` (the sidecar itself). It captures nothing useful about real outbound APIs. We also don't track successes, last-success timestamps, or missing API keys.

## Scope

Three additions, all in `src-tauri/sidecar/local-api-server.mjs`. No frontend changes, no Rust changes — the Rust `copy_diagnostics` command already bundles `/api/diag` output verbatim, so new fields ride along automatically.

1. **Outbound fetch instrumentation.** Wrap `globalThis.fetch` once at top of file. Every call records hostname, success/failure, HTTP status, duration into a single `wmHostStats` map. Sidecar-internal routes (127.0.0.1) are skipped.
2. **Richer host record shape.** Replace `wmHostFailures` (`{count, lastError, lastAt}`) with `wmHostStats` (`{ok, fail, lastStatus, lastOkAt, lastFailAt, lastError}`).
3. **Missing keys detection.** At `/api/diag` response time, read the keys already loaded into `process.env` by Rust (via the existing secrets bootstrap). Compare against a static `EXPECTED_API_KEYS` list. Report `missing_keys: string[]`.

## Architecture

### Fetch wrapper

```js
const wmHostStats = new Map(); // host → { ok, fail, lastStatus, lastOkAt, lastFailAt, lastError }

function wmRecordHostCall(host, ok, status, errorMsg) {
  const entry = wmHostStats.get(host) || {
 ok: 0, fail: 0, lastStatus: 0, lastOkAt: 0, lastFailAt: 0, lastError: '',
  };
  if (ok) { entry.ok += 1; entry.lastOkAt = Date.now(); }
  else { entry.fail += 1; entry.lastFailAt = Date.now();
 entry.lastError = String(errorMsg || '').slice(0, 200); }
  entry.lastStatus = status;
  wmHostStats.set(host, entry);
}

const wmOriginalFetch = globalThis.fetch;
globalThis.fetch = async function wmInstrumentedFetch(input, init) {
  let host = 'unknown';
  try {
 const url = typeof input === 'string' ? input : (input?.url ?? '');
 host = new URL(url).host;
  } catch { /* relative / opaque — skip */ }

  // Skip sidecar-internal and loopback calls — they'd just drown the real signal.
  if (host === '' || host === 'unknown' || host.startsWith('127.0.0.1') || host.startsWith('localhost')) {
 return wmOriginalFetch(input, init);
  }

  try {
 const res = await wmOriginalFetch(input, init);
 wmRecordHostCall(host, res.ok, res.status, res.ok ? '' : `HTTP ${res.status}`);
 return res;
  } catch (err) {
 wmRecordHostCall(host, false, 0, err?.message || String(err));
 throw err;
  }
};
```

The wrapper is transparent — existing callers don't change. It captures both HTTP-level failures (4xx/5xx) and network-level failures (DNS, timeout, connection refused).

### Missing keys

A hardcoded list of keys the app expects to have. When a key is absent from `process.env` OR present but empty/whitespace, report it as missing:

```js
const EXPECTED_API_KEYS = [
  'ACLED_ACCESS_TOKEN', 'ACLED_EMAIL', 'FRED_API_KEY', 'EIA_API_KEY',
  'NEWSDATA_API_KEY', 'NASA_API_KEY', 'NASA_FIRMS_API_KEY',
  'OWM_API_KEY', 'FINNHUB_API_KEY', 'NEWSAPI_KEY', 'AVIATIONSTACK_API',
  'OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET', 'AISSTREAM_API_KEY',
  'CESIUM_ION_TOKEN', 'GROQ_API_KEY', 'OPENROUTER_API_KEY',
  'GEONAMES_USERNAME', 'THREATFOX_API_KEY', 'URLHAUS_AUTH_KEY',
  'OTX_API_KEY', 'ABUSEIPDB_API_KEY', 'VIRUSTOTAL_API_KEY',
  'SHODAN_API_KEY', 'GREYNOISE_API_KEY', 'URLSCAN_API_KEY',
  'ANTHROPIC_API_KEY',
];

function wmMissingKeys() {
  return EXPECTED_API_KEYS.filter(k => {
 const v = process.env[k];
 return !v || !v.trim();
  });
}
```

Not driven from the Rust `SUPPORTED_SECRET_KEYS` list on purpose: that list contains config strings and keys we don't strictly require. This JS list is "keys that unlock visible features." Kept short and maintained alongside panel additions.

### `/api/diag` output changes

Replace:

```js
host_failures: Object.fromEntries(wmHostFailures),
```

With:

```js
host_stats: Object.fromEntries(wmHostStats),
missing_keys: wmMissingKeys(),
```

## Edge Cases

- **Frontend fetches don't flow through this.** The wrapper only catches fetches initiated by the sidecar process. Panels that fetch directly from the renderer (rare — most go through the sidecar proxy) are invisible here. That's fine; those already surface errors via the frontend log bridge.
- **Auth failures (401/403)** count as failures. That's desirable — a wrong API key looks like a broken API in the diagnostic, which is what the user cares about.
- **Rate limit (429)** counts as a failure. Also desirable.
- **High-cardinality risk.** If a call hits `tiles-1.basemaps.example.com`, `tiles-2.basemaps.example.com`, …, the map could balloon. Cap at 100 distinct hosts — after that, new hosts bump the least-recently-used one out.
- **Renaming breaks backward compat.** Nothing external reads `host_failures` — it's only consumed by the clipboard bundle and humans looking at raw JSON. Rename freely.
- **The old error-path call site** at line ~5891 (`wmRecordHostFailure(host, ...)` in the dispatch catch) becomes dead code for useful data, but removing it risks hiding sidecar-internal 500s. Replace it with a direct log line instead: `context.logger.error('[local-api] dispatch 500', error)` — already logged above it, so the call just becomes redundant and can be deleted.

## LRU cap implementation

```js
const WM_HOST_STATS_CAP = 100;
function wmRecordHostCall(host, ok, status, errorMsg) {
  let entry = wmHostStats.get(host);
  if (!entry) {
 if (wmHostStats.size >= WM_HOST_STATS_CAP) {
 // Evict the host with the oldest lastOkAt|lastFailAt.
 let oldestKey = null, oldestTs = Infinity;
 for (const [k, v] of wmHostStats) {
 const ts = Math.max(v.lastOkAt, v.lastFailAt);
 if (ts < oldestTs) { oldestTs = ts; oldestKey = k; }
 }
 if (oldestKey) wmHostStats.delete(oldestKey);
 }
 entry = { ok: 0, fail: 0, lastStatus: 0, lastOkAt: 0, lastFailAt: 0, lastError: '' };
  }
  if (ok) { entry.ok += 1; entry.lastOkAt = Date.now(); }
  else { entry.fail += 1; entry.lastFailAt = Date.now();
 entry.lastError = String(errorMsg || '').slice(0, 200); }
  entry.lastStatus = status;
  wmHostStats.set(host, entry);
}
```

## Out of Scope

- Panel → host mapping. (A panel-name dimension would be nicer but requires plumbing panel identity into every fetch call site.)
- Historical time-series. Current design keeps only rolling totals.
- Success/failure rate visualization in the UI.
- Moving `EXPECTED_API_KEYS` into shared config with Rust.

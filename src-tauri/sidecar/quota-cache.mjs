// Persisted TTL cache for quota-limited providers (R4-BUG-005 step 1).
//
// The sidecar's normal cache is in memory, so every sidecar restart and app
// relaunch refetched everything. For providers with small daily/weekly quotas
// (GreyNoise 50/week, AbuseIPDB blacklist 5/day, NewsAPI 100/day, PurpleAir's
// one-time point grant) that alone exhausted the quota. This cache keeps the
// last good response on disk (0600, atomic replace) so a TTL survives
// restarts. It is deliberately small and strict:
// - only regular files are read (no symlinks), bounded in size;
// - malformed files or entries are ignored, never trusted;
// - an entry stamped in the future is dropped, so a clock change or a
//   tampered file cannot pin a response forever;
// - write failures never break a request (the in-memory copy still serves).

import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';

export const QUOTA_CACHE_FILE = 'quota-cache.json';
export const QUOTA_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const QUOTA_CACHE_MAX_ENTRIES = 64;
const FUTURE_SKEW_MS = 60_000;

function isEntry(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Number.isSafeInteger(value.ts) && value.ts > 0 && 'data' in value;
}

export function createQuotaCache({ filePath, now = () => Date.now(), maxBytes = QUOTA_CACHE_MAX_BYTES, maxEntries = QUOTA_CACHE_MAX_ENTRIES, logger = console } = {}) {
  const entries = new Map();
  let loaded = false;

  function load() {
    loaded = true;
    if (!filePath) return;
    let text;
    try {
      const stat = lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
        logger.warn?.('[quota-cache] ignoring unsafe or oversized cache file');
        return;
      }
      text = readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') logger.warn?.(`[quota-cache] read failed: ${error?.code ?? error}`);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      logger.warn?.('[quota-cache] ignoring malformed cache file');
      return;
    }
    if (!parsed || parsed.version !== 1 || typeof parsed.entries !== 'object' || parsed.entries === null) return;
    const limit = now() + FUTURE_SKEW_MS;
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (typeof key === 'string' && isEntry(entry) && entry.ts <= limit) entries.set(key, { ts: entry.ts, data: entry.data });
    }
  }

  function ensureLoaded() {
    if (!loaded) load();
  }

  function persist() {
    if (!filePath) return;
    const body = JSON.stringify({ version: 1, entries: Object.fromEntries(entries) });
    if (Buffer.byteLength(body) > maxBytes) {
      logger.warn?.('[quota-cache] cache exceeds size cap; keeping it in memory only');
      return;
    }
    const tmp = `${filePath}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = openSync(tmp, 'wx', 0o600);
      writeSync(fd, body);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(tmp, filePath);
    } catch (error) {
      logger.warn?.(`[quota-cache] write failed: ${error?.code ?? error}`);
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* already closed */ }
      }
      try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    }
  }

  return {
    /** Fresh data for `key` within `ttlMs`, else null. */
    get(key, ttlMs) {
      ensureLoaded();
      const entry = entries.get(key);
      if (!entry) return null;
      const age = now() - entry.ts;
      return age >= -FUTURE_SKEW_MS && age < ttlMs ? entry.data : null;
    },
    /** Last good data regardless of age (for serve-stale-on-error), else null. */
    getStale(key) {
      ensureLoaded();
      return entries.get(key)?.data ?? null;
    },
    set(key, data) {
      ensureLoaded();
      entries.delete(key);
      entries.set(key, { ts: now(), data });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      persist();
    },
  };
}

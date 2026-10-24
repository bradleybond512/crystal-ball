import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_DATA_DIR = join(
  homedir(),
  'Library',
  'Logs',
  'com.bradleybond.crystalball',
);

const REQUEST_TIMEOUT_MS = 15_000;

// Consumers only read the native app's published runtime files. Discovery
// never scans listeners, writes files, or guesses the preferred launch port.
export class SidecarRuntimeFiles {
  static discoverPort(dataDir = DEFAULT_DATA_DIR) {
    try {
      const raw = readFileSync(join(dataDir, 'sidecar.port'), 'utf8').trim();
      if (!/^\d{1,5}$/.test(raw)) return null;
      const port = Number(raw);
      return port >= 1 && port <= 65535 ? port : null;
    } catch {
      return null;
    }
  }

  static discoverToken(dataDir = DEFAULT_DATA_DIR) {
    try {
      return readFileSync(join(dataDir, 'sidecar.token'), 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  static healthRequest(dataDir = DEFAULT_DATA_DIR) {
    const port = SidecarRuntimeFiles.discoverPort(dataDir);
    if (port === null) return null;
    const token = SidecarRuntimeFiles.discoverToken(dataDir);
    return {
      url: `http://127.0.0.1:${port}/api/health`,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    };
  }
}

export function createSidecarClient(dataDir = DEFAULT_DATA_DIR) {
  const discoverPort = () => SidecarRuntimeFiles.discoverPort(dataDir);
  const discoverToken = () => SidecarRuntimeFiles.discoverToken(dataDir);

  function buildUrl(route, params) {
    const port = discoverPort();
    if (!port) return null;
    // `route` is agent-/caller-supplied (query_raw / chain_query /
    // compare_snapshots pass it through verbatim). It MUST be a leading-slash
    // relative path. Without this, a route like `@169.254.169.254/...` turns
    // `127.0.0.1:<port>` into URL userinfo and the attacker segment into the
    // host — an SSRF that ships the sidecar bearer token (attached by get/post)
    // to an arbitrary host. Reject non-relative routes, then assert the resolved
    // host is still the loopback target (defense in depth against parser quirks).
    if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) {
      return null;
    }
    const expectedHost = `127.0.0.1:${port}`;
    const url = new URL(`http://${expectedHost}${route}`);
    if (url.host !== expectedHost) return null;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async function checkHealth() {
    const port = discoverPort();
    const token = discoverToken();
    if (!port || !token) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  // Single-attempt fetch helper — used by get/post with a once-on-401 retry
  // so a sidecar restart that rotated the token doesn't 401 the in-flight call.
  async function fetchOnce(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function get(route, params) {
    const url = buildUrl(route, params);
    let token = discoverToken();
    if (!url || !token) {
      return { error: 'Crystal Ball is not running. Launch the app to enable data access.', healthy: false };
    }
    try {
      let res = await fetchOnce(url, { headers: { Authorization: `Bearer ${token}` } });
      // Sidecar restarts rotate the token; re-read the file once and retry.
      if (res.status === 401) {
        const fresh = discoverToken();
        if (fresh && fresh !== token) {
          token = fresh;
          res = await fetchOnce(url, { headers: { Authorization: `Bearer ${token}` } });
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { error: `Sidecar returned ${res.status}: ${text}`, status: res.status };
      }
      return await res.json();
    } catch (err) {
      return { error: `Request failed: ${err.message}` };
    }
  }

  async function post(route, body) {
    let token = discoverToken();
    if (!token) {
      return { error: 'Crystal Ball is not running. Launch the app to enable data access.', healthy: false };
    }
    const url = buildUrl(route);
    if (!url) {
      return { error: 'Crystal Ball is not running. Launch the app to enable data access.', healthy: false };
    }
    const buildInit = (tok) => ({
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    try {
      let res = await fetchOnce(url, buildInit(token));
      if (res.status === 401) {
        const fresh = discoverToken();
        if (fresh && fresh !== token) {
          token = fresh;
          res = await fetchOnce(url, buildInit(token));
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { error: `Sidecar returned ${res.status}: ${text}`, status: res.status };
      }
      return await res.json();
    } catch (err) {
      return { error: `Request failed: ${err.message}` };
    }
  }

  async function getAll(routes) {
    const results = new Map();
    const promises = routes.map(async (route) => {
      const data = await get(route);
      results.set(route, data);
    });
    await Promise.allSettled(promises);
    return results;
  }

  return { discoverPort, discoverToken, buildUrl, checkHealth, get, post, getAll };
}

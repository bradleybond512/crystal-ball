import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_DATA_DIR = join(
  homedir(),
  'Library',
  'Application Support',
  'com.bradleybond.crystalball',
);

const REQUEST_TIMEOUT_MS = 15_000;

export function createSidecarClient(dataDir = DEFAULT_DATA_DIR) {
  function discoverPort() {
    try {
      const raw = readFileSync(join(dataDir, 'sidecar.port'), 'utf8').trim();
      const port = parseInt(raw, 10);
      return Number.isFinite(port) ? port : null;
    } catch {
      return null;
    }
  }

  function discoverToken() {
    try {
      return readFileSync(join(dataDir, 'sidecar.token'), 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  function buildUrl(route, params) {
    const port = discoverPort();
    if (!port) return null;
    const url = new URL(`http://127.0.0.1:${port}${route}`);
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

  async function get(route, params) {
    const url = buildUrl(route, params);
    const token = discoverToken();
    if (!url || !token) {
      return { error: 'Crystal Ball is not running. Launch the app to enable data access.', healthy: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { error: `Sidecar returned ${res.status}: ${text}`, status: res.status };
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      return { error: `Request failed: ${err.message}` };
    }
  }

  async function post(route, body) {
    const port = discoverPort();
    const token = discoverToken();
    if (!port || !token) {
      return { error: 'Crystal Ball is not running. Launch the app to enable data access.', healthy: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { error: `Sidecar returned ${res.status}: ${text}`, status: res.status };
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
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

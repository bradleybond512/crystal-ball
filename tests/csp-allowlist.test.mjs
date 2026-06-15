// Guards the Tauri CSP connect-src against regressing to a scheme-only wildcard.
// The renderer talks directly to ~50 public data/map/analytics origins; the old
// policy allowed `connect-src ... https:` which lets a compromised renderer
// exfiltrate to ANY https host. This test asserts the directive is an explicit
// allowlist (no bare `https:` / `http:` / `ws:` / `wss:` tokens) and still
// contains the load-bearing origins so a future edit can't silently drop them.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const confPath = fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url));
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
const csp = conf.app.security.csp;

function directive(name) {
  const part = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `) || s === name);
  return part ? part.slice(name.length).trim().split(/\s+/).filter(Boolean) : [];
}

const connectSrc = directive('connect-src');

test('connect-src is present and non-empty', () => {
  assert.ok(connectSrc.length > 0, 'connect-src directive missing');
});

test('connect-src contains no scheme-only wildcard (the exfiltration hole)', () => {
  for (const bad of ['https:', 'http:', 'ws:', 'wss:', '*']) {
    assert.ok(!connectSrc.includes(bad), `connect-src must not contain bare "${bad}"`);
  }
});

test('connect-src keeps self + the local sidecar origin', () => {
  assert.ok(connectSrc.includes("'self'"), "connect-src must include 'self'");
  assert.ok(connectSrc.includes('http://127.0.0.1:46123'), 'connect-src must include the sidecar origin');
});

test('connect-src retains load-bearing direct-connect origins', () => {
  // A representative slice across the feature surface: weather, globe imagery,
  // basemaps, analytics. Dropping any of these silently breaks a feature.
  const required = [
    'https://api.weather.gov',
    'https://*.cesium.com',
    'https://*.virtualearth.net',
    'https://*.basemaps.cartocdn.com',
    'https://gibs.earthdata.nasa.gov',
    'https://*.posthog.com',
    'https://nominatim.openstreetmap.org',
    'https://eonet.gsfc.nasa.gov',
    'https://www.fema.gov',
    'https://*.crystalball.app',
    'https://api.github.com',
  ];
  for (const origin of required) {
    assert.ok(connectSrc.includes(origin), `connect-src must include ${origin}`);
  }
});

test('every connect-src host entry is scheme-qualified (no accidental bare host)', () => {
  for (const entry of connectSrc) {
    if (entry === "'self'") continue;
    assert.match(entry, /^(https?|wss?):\/\//, `connect-src entry "${entry}" must be scheme-qualified`);
  }
});

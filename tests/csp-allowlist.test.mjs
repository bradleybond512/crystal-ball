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
    'https://api.github.com',
    // OWM weather-tile overlays (getOwmTileUrl) fetch from this host; without it
    // the Temperature/Precipitation/Clouds/Wind overlays are CSP-blocked.
    'https://tile.openweathermap.org',
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

// ── index.html meta CSP (the GitHub Pages web build) ──────────────────────────
// The web build has no Tauri runtime CSP, so its only policy is the <meta> tag.
// `default-src` does NOT fall back for base-uri/form-action, so these must be
// declared explicitly or the web build has an unrestricted <base> + form-action.
const indexPath = fileURLToPath(new URL('../index.html', import.meta.url));
const indexHtml = readFileSync(indexPath, 'utf8');
// The content attribute is double-quoted and contains single quotes ('self',
// 'none'), so the capture must exclude only the double-quote delimiter.
const metaCspMatch = indexHtml.match(
  /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i,
);
const metaCsp = metaCspMatch ? metaCspMatch[1] : '';

function metaDirective(name) {
  const part = metaCsp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `) || s === name);
  return part ? part.slice(name.length).trim().split(/\s+/).filter(Boolean) : [];
}

test('index.html declares a Content-Security-Policy meta tag', () => {
  assert.ok(metaCsp.length > 0, 'index.html meta CSP missing');
});

test('index.html meta CSP locks down object-src / base-uri / form-action', () => {
  // Parity with the desktop tauri.conf.json CSP. Without these the web build
  // allows arbitrary plugins, a hijacked <base href>, and cross-origin form posts.
  assert.deepEqual(metaDirective('object-src'), ["'none'"], "object-src must be 'none'");
  assert.deepEqual(metaDirective('base-uri'), ["'self'"], "base-uri must be 'self'");
  assert.deepEqual(metaDirective('form-action'), ["'self'"], "form-action must be 'self'");
});

const metaConnectSrc = metaDirective('connect-src');

test('index.html meta CSP connect-src has no scheme-only wildcard (the exfiltration hole)', () => {
  // The web build has no sidecar, so the renderer connects directly — a bare
  // `https:`/`ws:`/`wss:` would let a compromised renderer exfiltrate anywhere.
  for (const bad of ['https:', 'http:', 'ws:', 'wss:', '*']) {
    assert.ok(!metaConnectSrc.includes(bad), `index.html connect-src must not contain bare "${bad}"`);
  }
});

test('index.html meta CSP connect-src keeps self + load-bearing web origins', () => {
  assert.ok(metaConnectSrc.includes("'self'"), "connect-src must include 'self'");
  // The web build talks to its relay over https + wss and reaches the same
  // direct-connect CDNs/providers as desktop. Dropping any silently breaks it.
  const required = [
    'https://*.cesium.com',
    'https://*.basemaps.cartocdn.com',
    'https://api.anthropic.com',
    'https://*.posthog.com',
    'wss://stream.aisstream.io',
    'https://*.sentry.io',
  ];
  for (const origin of required) {
    assert.ok(metaConnectSrc.includes(origin), `index.html connect-src must include ${origin}`);
  }
});

test('every index.html connect-src entry is scheme-qualified or a safe keyword', () => {
  const keywords = new Set(["'self'", 'blob:', 'data:']);
  for (const entry of metaConnectSrc) {
    if (keywords.has(entry)) continue;
    assert.match(entry, /^(https?|wss?):\/\//, `connect-src entry "${entry}" must be scheme-qualified`);
  }
});


test('web and desktop connect/frame policies grant no retired-domain permission', () => {
  for (const name of ['connect-src', 'frame-src']) {
    assert.doesNotMatch(directive(name).join(' '), /crystalball[.]app/i, `desktop ${name}`);
    assert.doesNotMatch(metaDirective(name).join(' '), /crystalball[.]app/i, `web ${name}`);
  }
});

const expectedSidecarOrigins = Array.from({ length: 11 }, (_, offset) => `http://127.0.0.1:${46123 + offset}`);
for (const [name, extra] of [['connect-src', ['http://127.0.0.1:11434', 'http://127.0.0.1:1234']], ['frame-src', []]]) {
  test(`native ${name} permits exactly the bounded sidecar range and relevant local models`, () => {
    const actual = directive(name).filter(source => /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(source));
    assert.deepEqual(actual.sort(), [...expectedSidecarOrigins, ...extra].sort());
  });
}

async function productionPages(desktop) {
  const { loadConfigFromFile } = await import('vite');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const previous = process.env.VITE_DESKTOP_RUNTIME;
  try {
    process.env.VITE_DESKTOP_RUNTIME = desktop ? '1' : '0';
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, `${root}vite.config.ts`, root, 'silent');
    const plugin = loaded?.config.plugins.flat(Infinity).find(entry => entry?.name === 'html-variant');
    assert.ok(plugin, 'production HTML transform must run');
    const transform = plugin.transformIndexHtml;
    const pages = {};
    for (const file of ['index.html', 'settings.html', 'live-channels.html']) {
      const input = readFileSync(`${root}${file}`, 'utf8');
      const output = await transform(input, { filename: `${root}${file}`, path: `/${file}` });
      const extract = html => html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1] ?? null;
      pages[file] = { original: extract(input), built: extract(output) };
    }
    return pages;
  } finally {
    if (previous === undefined) delete process.env.VITE_DESKTOP_RUNTIME;
    else process.env.VITE_DESKTOP_RUNTIME = previous;
  }
}

function localOrigins(policy, name) {
  const part = policy?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name} `));
  return (part ?? '').split(/\s+/).filter(s => /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(s)).sort();
}

test('production desktop HTML transform gives the main window the exact connect and frame origins', async () => {
  const pages = await productionPages(true);
  assert.deepEqual(localOrigins(pages['index.html'].built, 'connect-src'),
    [...expectedSidecarOrigins, 'http://127.0.0.1:1234', 'http://127.0.0.1:11434'].sort());
  assert.deepEqual(localOrigins(pages['index.html'].built, 'frame-src'), [...expectedSidecarOrigins].sort());
  for (const name of ['settings.html', 'live-channels.html']) assert.equal(pages[name].built, pages[name].original);
});

test('production web pages gain no local services and retain auxiliary window restrictions', async () => {
  const pages = await productionPages(false);
  assert.ok(pages['index.html'].built, 'main page must still ship a CSP');
  for (const page of Object.values(pages)) {
    assert.doesNotMatch(page.built ?? '', /(?:[\w+.-]+):\/\/(?:127\.0\.0\.1|localhost|\[::1\])/i);
  }
  for (const name of ['settings.html', 'live-channels.html']) assert.equal(pages[name].built, pages[name].original);
});

/**
 * Parity test: the renderer-side solar imagery catalog
 * (`src/services/spaceweather/solar-imagery.ts`) and the sidecar
 * catalog must agree on slugs, labels, descriptions, and upstream
 * URLs. Drift between the two surfaces would mean the panel ships an
 * <img src> the proxy refuses, or vice versa — silent breakage.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-imagery-parity';

import { SOLAR_IMAGERY_CATALOG as SIDECAR_CATALOG } from '../local-api-server.mjs';
import { SOLAR_IMAGERY_CATALOG as RENDERER_CATALOG } from '../../../src/services/spaceweather/solar-imagery.ts';

test('catalog parity: identical entry count', () => {
  assert.equal(SIDECAR_CATALOG.length, RENDERER_CATALOG.length);
});

test('catalog parity: same slug ordering', () => {
  const sidecar = SIDECAR_CATALOG.map((e) => e.slug);
  const renderer = RENDERER_CATALOG.map((e) => e.slug);
  assert.deepEqual(sidecar, renderer);
});

test('catalog parity: every entry matches on every field', () => {
  for (const [i, sideEntry] of SIDECAR_CATALOG.entries()) {
    const rendEntry = RENDERER_CATALOG[i];
    assert.equal(sideEntry.slug, rendEntry.slug, `slug at index ${i}`);
    assert.equal(sideEntry.label, rendEntry.label, `${sideEntry.slug} label`);
    assert.equal(sideEntry.description, rendEntry.description, `${sideEntry.slug} description`);
    assert.equal(sideEntry.upstreamUrl, rendEntry.upstreamUrl, `${sideEntry.slug} upstreamUrl`);
  }
});

test('catalog parity: sidecar entries are frozen (no accidental mutation)', () => {
  for (const entry of SIDECAR_CATALOG) {
    assert.ok(Object.isFrozen(entry), `${entry.slug} should be frozen`);
  }
  assert.ok(Object.isFrozen(SIDECAR_CATALOG), 'top-level catalog frozen');
});

test('catalog parity: every upstream URL is on the NASA host allowlist', () => {
  const allowed = new Set(['sdo.gsfc.nasa.gov', 'soho.nascom.nasa.gov']);
  for (const entry of SIDECAR_CATALOG) {
    const host = new URL(entry.upstreamUrl).hostname;
    assert.ok(allowed.has(host), `${entry.slug} upstream host ${host}`);
  }
});

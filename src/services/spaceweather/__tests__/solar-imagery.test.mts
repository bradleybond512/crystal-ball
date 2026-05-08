import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOLAR_IMAGERY_CATALOG,
  buildDefaultImageryResponse,
  findSolarImageryEntry,
  formatLastUpdated,
  isSolarImagerySlug,
  isSolarImageryResponse,
  proxyPathForSlug,
  type SolarImageryStatus,
} from '../solar-imagery.ts';

// ── Catalog shape ─────────────────────────────────────────────────────

test('catalog: has the five required wavelengths/instruments', () => {
  const slugs = SOLAR_IMAGERY_CATALOG.map((e) => e.slug).sort();
  assert.deepEqual(slugs, [
    'lasco-c2',
    'lasco-c3',
    'sdo-aia-171',
    'sdo-aia-304',
    'sdo-hmi-magnetogram',
  ]);
});

test('catalog: every entry has a non-empty label, description, and https upstream URL', () => {
  for (const entry of SOLAR_IMAGERY_CATALOG) {
    assert.ok(entry.label.length > 0, `${entry.slug} label`);
    assert.ok(entry.description.length > 0, `${entry.slug} description`);
    assert.ok(/^https:\/\//.test(entry.upstreamUrl), `${entry.slug} upstream is https`);
  }
});

test('catalog: upstream URLs only point at NASA hosts (SSRF guard)', () => {
  const allowed = new Set(['sdo.gsfc.nasa.gov', 'soho.nascom.nasa.gov']);
  for (const entry of SOLAR_IMAGERY_CATALOG) {
    const host = new URL(entry.upstreamUrl).hostname;
    assert.ok(allowed.has(host), `${entry.slug} host ${host} not in allowlist`);
  }
});

// ── Slug validation ───────────────────────────────────────────────────

test('isSolarImagerySlug: accepts every catalog slug', () => {
  for (const e of SOLAR_IMAGERY_CATALOG) assert.equal(isSolarImagerySlug(e.slug), true);
});

test('isSolarImagerySlug: rejects unknown / non-string input', () => {
  assert.equal(isSolarImagerySlug('not-a-slug'), false);
  assert.equal(isSolarImagerySlug(''), false);
  assert.equal(isSolarImagerySlug(null), false);
  assert.equal(isSolarImagerySlug(undefined), false);
  assert.equal(isSolarImagerySlug(42), false);
  // Path-traversal probe — must be rejected by the validator before
  // it is ever concatenated into a sidecar fetch URL.
  assert.equal(isSolarImagerySlug('../etc/passwd'), false);
});

test('findSolarImageryEntry: returns the entry by slug, null when missing', () => {
  assert.equal(findSolarImageryEntry('sdo-aia-171')?.label, 'SDO AIA 171Å');
  assert.equal(findSolarImageryEntry('does-not-exist'), null);
});

// ── Proxy path ────────────────────────────────────────────────────────

test('proxyPathForSlug: returns a sidecar-relative path for every slug', () => {
  for (const e of SOLAR_IMAGERY_CATALOG) {
    const path = proxyPathForSlug(e.slug);
    assert.ok(path.startsWith('/api/spaceweather/imagery/'));
    assert.ok(path.endsWith('.jpg'));
    assert.ok(path.includes(e.slug));
  }
});

// ── formatLastUpdated ─────────────────────────────────────────────────

test('formatLastUpdated: null timestamp falls back to "unknown"', () => {
  assert.equal(formatLastUpdated(null, 1_745_000_000_000), 'updated time unknown');
});

test('formatLastUpdated: <30 s reads as "just now"', () => {
  const now = 1_745_000_000_000;
  assert.equal(formatLastUpdated(now - 5_000, now), 'updated just now');
  assert.equal(formatLastUpdated(now - 29_000, now), 'updated just now');
});

test('formatLastUpdated: minutes and hours bucket correctly', () => {
  const now = 1_745_000_000_000;
  assert.equal(formatLastUpdated(now - 60_000, now), 'updated 1 min ago');
  assert.equal(formatLastUpdated(now - 14 * 60_000, now), 'updated 14 min ago');
  assert.equal(formatLastUpdated(now - 60 * 60_000, now), 'updated 1 hr ago');
  assert.equal(formatLastUpdated(now - 5 * 60 * 60_000, now), 'updated 5 hr ago');
});

test('formatLastUpdated: clock skew (negative delta) reads as "just now"', () => {
  const now = 1_745_000_000_000;
  assert.equal(formatLastUpdated(now + 60_000, now), 'updated just now');
});

test('formatLastUpdated: days threshold', () => {
  const now = 1_745_000_000_000;
  assert.equal(formatLastUpdated(now - 24 * 60 * 60_000, now), 'updated 1 day ago');
  assert.equal(formatLastUpdated(now - 3 * 24 * 60 * 60_000, now), 'updated 3 days ago');
});

// ── Response shape validator ──────────────────────────────────────────

test('isSolarImageryResponse: accepts a well-formed response', () => {
  const response = buildDefaultImageryResponse(new Date(1_745_000_000_000).toISOString());
  assert.equal(isSolarImageryResponse(response), true);
});

test('isSolarImageryResponse: rejects malformed payloads', () => {
  assert.equal(isSolarImageryResponse(null), false);
  assert.equal(isSolarImageryResponse({}), false);
  assert.equal(isSolarImageryResponse({ asOf: '2026-05-08', images: 'not-array' }), false);
  // bad slug inside an entry
  const bad = buildDefaultImageryResponse('2026-05-08T00:00:00Z');
  (bad.images[0] as unknown as { slug: string }).slug = 'invented';
  assert.equal(isSolarImageryResponse(bad), false);
});

test('buildDefaultImageryResponse: every image starts with null lastModified + unknown status', () => {
  const r = buildDefaultImageryResponse('2026-05-08T00:00:00Z');
  assert.equal(r.images.length, SOLAR_IMAGERY_CATALOG.length);
  for (const img of r.images) {
    assert.equal(img.lastModified, null);
    assert.equal(img.upstreamStatus, 'unknown');
    assert.ok(img.proxyUrl.startsWith('/api/spaceweather/imagery/'));
  }
});

test('buildDefaultImageryResponse: round-trips through JSON', () => {
  const r = buildDefaultImageryResponse('2026-05-08T00:00:00Z');
  const round = JSON.parse(JSON.stringify(r)) as unknown;
  assert.equal(isSolarImageryResponse(round), true);
});

// ── Status type smoke (catches accidental drift) ──────────────────────

test('SolarImageryStatus: width matches the catalog (no extra/missing fields)', () => {
  const r = buildDefaultImageryResponse('2026-05-08T00:00:00Z');
  const sample: SolarImageryStatus = r.images[0]!;
  const keys = Object.keys(sample).sort();
  assert.deepEqual(keys, [
    'description',
    'label',
    'lastModified',
    'proxyUrl',
    'slug',
    'upstreamStatus',
  ]);
});

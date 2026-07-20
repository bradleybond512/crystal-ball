/**
 * IMF PortWatch — parser parity tests.
 *
 * All assertions run against the committed fixture file (no live fetch).
 * The parser is exported from local-api-server.mjs.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { join, dirname } = path;
import { parsePortwatchChokepoints } from '../local-api-server.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dir, 'fixtures');

function loadFixture() {
  return JSON.parse(readFileSync(join(fixtureDir, 'imf-portwatch-chokepoints.sample.json'), 'utf8'));
}

// ── fixture round-trip ────────────────────────────────────────────────────────

test('parsePortwatchChokepoints: fixture produces 3 chokepoints', () => {
  const result = parsePortwatchChokepoints(loadFixture());
  assert.equal(result.length, 3);
});

test('parsePortwatchChokepoints: all 3 portids are distinct', () => {
  const result = parsePortwatchChokepoints(loadFixture());
  const ids = result.map(c => c.id);
  assert.equal(new Set(ids).size, 3);
});

test('parsePortwatchChokepoints: Suez Canal is present with correct fields', () => {
  const result = parsePortwatchChokepoints(loadFixture());
  const suez = result.find(c => c.id === 'chokepoint1');
  assert.ok(suez, 'chokepoint1 (Suez Canal) must be present');
  assert.equal(suez.name, 'Suez Canal');
  assert.equal(suez.date, '2026-06-21');
  assert.equal(suez.vessels.total, 44);
  assert.equal(suez.capacityTons.total, 1_676_894);
});

test('parsePortwatchChokepoints: vessel sub-object is fully populated for Suez', () => {
  const result = parsePortwatchChokepoints(loadFixture());
  const suez = result.find(c => c.id === 'chokepoint1');
  assert.equal(suez.vessels.container, 10);
  assert.equal(suez.vessels.dryBulk, 15);
  assert.equal(suez.vessels.generalCargo, 0);
  assert.equal(suez.vessels.roro, 3);
  assert.equal(suez.vessels.tanker, 16);
  assert.equal(suez.vessels.cargo, 28);
});

test('parsePortwatchChokepoints: capacityTons sub-object is fully populated for Suez', () => {
  const result = parsePortwatchChokepoints(loadFixture());
  const suez = result.find(c => c.id === 'chokepoint1');
  assert.equal(suez.capacityTons.container, 242_486);
  assert.equal(suez.capacityTons.dryBulk, 927_088);
  assert.equal(suez.capacityTons.generalCargo, 0);
  assert.equal(suez.capacityTons.roro, 20_033);
  assert.equal(suez.capacityTons.tanker, 487_286);
  assert.equal(suez.capacityTons.cargo, 1_189_608);
});

test('parsePortwatchChokepoints: Panama Canal is present', () => {
  const result = parsePortwatchChokepoints(loadFixture());
  const panama = result.find(c => c.id === 'chokepoint2');
  assert.ok(panama, 'chokepoint2 (Panama Canal) must be present');
  assert.equal(panama.name, 'Panama Canal');
  assert.equal(panama.vessels.total, 34);
});

test('parsePortwatchChokepoints: Strait of Hormuz is present', () => {
  const result = parsePortwatchChokepoints(loadFixture());
  const hormuz = result.find(c => c.id === 'chokepoint6');
  assert.ok(hormuz, 'chokepoint6 (Strait of Hormuz) must be present');
  assert.equal(hormuz.name, 'Strait of Hormuz');
  assert.equal(hormuz.vessels.total, 5);
});

// ── dedup: newest date wins ───────────────────────────────────────────────────

test('parsePortwatchChokepoints: dedup keeps first (newest) row per portid', () => {
  // Inject an older duplicate for chokepoint1 after the fixture's entry.
  const raw = loadFixture();
  const olderDupe = {
    attributes: {
      ...raw.features[0].attributes,
      date: '2026-06-20', // one day older
      n_total: 999,       // sentinel value — must NOT appear in output
      capacity: 9_999_999,
    },
  };
  const withDupe = { ...raw, features: [...raw.features, olderDupe] };
  const result = parsePortwatchChokepoints(withDupe);
  // Still 3 unique chokepoints (dupe collapsed)
  assert.equal(result.length, 3);
  const suez = result.find(c => c.id === 'chokepoint1');
  // The newer row (44 total) must win, not the sentinel 999
  assert.equal(suez.vessels.total, 44);
  assert.equal(suez.date, '2026-06-21');
});

// ── defensive cases ───────────────────────────────────────────────────────────

test('parsePortwatchChokepoints: drops features missing portid', () => {
  const raw = {
    features: [
      { attributes: { portid: '', portname: 'Ghost', date: '2026-01-01', n_total: 1, capacity: 1 } },
      { attributes: { portname: 'NoPid', date: '2026-01-01', n_total: 2, capacity: 2 } },
      { attributes: { portid: 'chokepoint1', portname: 'Suez Canal', date: '2026-01-01', n_total: 3, capacity: 3 } },
    ],
  };
  const result = parsePortwatchChokepoints(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'chokepoint1');
});

test('parsePortwatchChokepoints: returns empty array for missing features array', () => {
  assert.deepEqual(parsePortwatchChokepoints({}), []);
  assert.deepEqual(parsePortwatchChokepoints(null), []);
  assert.deepEqual(parsePortwatchChokepoints({ features: null }), []);
});

test('parsePortwatchChokepoints: returns empty array for empty features', () => {
  assert.deepEqual(parsePortwatchChokepoints({ features: [] }), []);
});

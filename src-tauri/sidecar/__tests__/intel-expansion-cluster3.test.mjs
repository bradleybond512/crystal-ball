/**
 * Intel Expansion Cluster 3 — parser parity tests.
 *
 * All assertions run against committed fixture files (no live fetch).
 * Parsers are exported from local-api-server.mjs and tested here.
 *
 * Sources covered:
 *   - IODA internet outage alerts (parseIodaAlerts)
 *   - openFDA drug shortages (parseFdaShortages)
 *   - openFDA enforcement recalls (parseFdaRecalls)
 *   - ORNL ODIN power outages (parseOdinOutages)
 *   - Copernicus EMS activations (parseCopernicusActivations)
 *   - GLEIF LEI entity lookup (parseGleifLeiRecords)
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { join, dirname } = path;
import {
  parseIodaAlerts,
  parseFdaShortages,
  parseFdaRecalls,
  parseOdinOutages,
  parseCopernicusActivations,
  parseGleifLeiRecords,
} from '../local-api-server.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dir, 'fixtures');

// ── IODA internet outages ─────────────────────────────────────────────────────

test('parseIodaAlerts: fixture produces 4 alerts', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ioda-outages.sample.json'), 'utf8'));
  const result = parseIodaAlerts(raw);
  assert.equal(result.length, 4);
});

test('parseIodaAlerts: first alert has correct shape', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ioda-outages.sample.json'), 'utf8'));
  const result = parseIodaAlerts(raw);
  const first = result[0];
  assert.equal(first.entityType, 'region');
  assert.equal(first.entityCode, '639');
  assert.equal(first.entityName, 'Ningxia');
  assert.equal(first.level, 'critical');
  assert.equal(first.score, 344);
  assert.equal(first.historyValue, 431);
  assert.equal(first.datasource, 'ping-slash24');
  assert.equal(first.method, 'median');
  assert.equal(first.from, 1_782_828_000);
});

test('parseIodaAlerts: critical alerts present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ioda-outages.sample.json'), 'utf8'));
  const result = parseIodaAlerts(raw);
  const critical = result.filter(a => a.level === 'critical');
  assert.ok(critical.length >= 2, 'fixture should have at least 2 critical alerts');
});

test('parseIodaAlerts: ASN entity type is parsed correctly', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ioda-outages.sample.json'), 'utf8'));
  const result = parseIodaAlerts(raw);
  const asn = result.find(a => a.entityType === 'asn');
  assert.ok(asn, 'should have at least one ASN-type alert');
  assert.ok(asn.entityCode.length > 0, 'ASN code must be non-empty');
});

test('parseIodaAlerts: returns empty for missing data array', () => {
  assert.deepEqual(parseIodaAlerts(null), []);
  assert.deepEqual(parseIodaAlerts({}), []);
  assert.deepEqual(parseIodaAlerts({ data: null }), []);
  assert.deepEqual(parseIodaAlerts({ data: [] }), []);
});

// ── openFDA drug shortages ────────────────────────────────────────────────────

test('parseFdaShortages: fixture produces 3 shortages', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-shortages.sample.json'), 'utf8'));
  const result = parseFdaShortages(raw);
  assert.equal(result.length, 3);
});

test('parseFdaShortages: first entry has correct genericName and status', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-shortages.sample.json'), 'utf8'));
  const result = parseFdaShortages(raw);
  const first = result[0];
  assert.equal(first.genericName, 'Ropivacaine Hydrochloride Injection');
  assert.equal(first.status, 'Available');
  assert.equal(first.packageNdc, '63323-287-21');
  assert.equal(first.initialPostingDate, '03/23/2018');
});

test('parseFdaShortages: unavailable entry is present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-shortages.sample.json'), 'utf8'));
  const result = parseFdaShortages(raw);
  const unavailable = result.find(r => r.status === 'Unavailable');
  assert.ok(unavailable, 'fixture should have at least one Unavailable entry');
  assert.equal(unavailable.genericName, 'Sodium Chloride 0.9% Injection');
});

test('parseFdaShortages: returns empty for missing results', () => {
  assert.deepEqual(parseFdaShortages(null), []);
  assert.deepEqual(parseFdaShortages({}), []);
  assert.deepEqual(parseFdaShortages({ results: [] }), []);
});

// ── openFDA enforcement recalls ───────────────────────────────────────────────

test('parseFdaRecalls: fixture produces 3 recalls', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-drug-recalls.sample.json'), 'utf8'));
  const result = parseFdaRecalls(raw);
  assert.equal(result.length, 3);
});

test('parseFdaRecalls: first recall has correct shape', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-drug-recalls.sample.json'), 'utf8'));
  const result = parseFdaRecalls(raw);
  const first = result[0];
  assert.ok(first.product.includes('Progesterone'), 'product should mention Progesterone');
  assert.equal(first.classification, 'Class II');
  assert.equal(first.state, 'IL');
  assert.equal(first.distributionPattern, 'Nationwide');
  assert.equal(first.status, 'Terminated');
  assert.equal(first.recallDate, '20150903');
  assert.ok(first.voluntaryMandated.includes('Voluntary'));
});

test('parseFdaRecalls: Class I recall is present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-drug-recalls.sample.json'), 'utf8'));
  const result = parseFdaRecalls(raw);
  const classI = result.find(r => r.classification === 'Class I');
  assert.ok(classI, 'fixture should have at least one Class I recall');
});

test('parseFdaRecalls: returns empty for missing results', () => {
  assert.deepEqual(parseFdaRecalls(null), []);
  assert.deepEqual(parseFdaRecalls({}), []);
  assert.deepEqual(parseFdaRecalls({ results: [] }), []);
});

// ── ORNL ODIN power outages ───────────────────────────────────────────────────

test('parseOdinOutages: fixture produces 3 outage records', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ornl-odin-outages.sample.json'), 'utf8'));
  const result = parseOdinOutages(raw);
  assert.equal(result.length, 3);
});

test('parseOdinOutages: first record has correct county and state', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ornl-odin-outages.sample.json'), 'utf8'));
  const result = parseOdinOutages(raw);
  const first = result[0];
  assert.equal(first.county, 'Ashe');
  assert.equal(first.state, 'North Carolina');
  assert.equal(first.fips, '37009');
  assert.equal(first.customersOut, 3);
  assert.equal(first.utilityId, '1889');
  assert.ok(first.utilityName.includes('BLUE RIDGE'));
});

test('parseOdinOutages: large outage entry is present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ornl-odin-outages.sample.json'), 'utf8'));
  const result = parseOdinOutages(raw);
  const large = result.find(r => r.customersOut > 100);
  assert.ok(large, 'fixture should have at least one large outage');
  assert.equal(large.customersOut, 324);
  assert.equal(large.county, 'Beaver');
  assert.equal(large.state, 'Pennsylvania');
});

test('parseOdinOutages: returns empty for missing results', () => {
  assert.deepEqual(parseOdinOutages(null), []);
  assert.deepEqual(parseOdinOutages({}), []);
  assert.deepEqual(parseOdinOutages({ results: [] }), []);
});

// ── Copernicus EMS activations ────────────────────────────────────────────────

test('parseCopernicusActivations: fixture produces 3 activations', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'copernicus-ems-activations.sample.json'), 'utf8'));
  const result = parseCopernicusActivations(raw);
  assert.equal(result.length, 3);
});

test('parseCopernicusActivations: first activation is the German wildfire', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'copernicus-ems-activations.sample.json'), 'utf8'));
  const result = parseCopernicusActivations(raw);
  const first = result[0];
  assert.equal(first.code, 'EMSR886');
  assert.equal(first.category, 'fire');
  assert.equal(first.categoryName, 'Wildfire');
  assert.equal(first.country, 'Germany');
  assert.equal(first.activationTime, '2026-06-27T15:51:00');
  assert.equal(first.closed, true);
  assert.equal(first.drmPhase, 'response');
  assert.ok(first.centroid.includes('POINT'));
});

test('parseCopernicusActivations: Venezuela earthquake is category earthquake', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'copernicus-ems-activations.sample.json'), 'utf8'));
  const result = parseCopernicusActivations(raw);
  const eq = result.find(a => a.code === 'EMSR884');
  assert.ok(eq, 'EMSR884 (Venezuela earthquake) must be present');
  assert.equal(eq.category, 'earthquake');
  assert.equal(eq.country, 'Venezuela');
  assert.equal(eq.closed, false);
});

test('parseCopernicusActivations: all codes distinct', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'copernicus-ems-activations.sample.json'), 'utf8'));
  const result = parseCopernicusActivations(raw);
  const codes = result.map(a => a.code);
  assert.equal(new Set(codes).size, 3, 'all EMSR codes must be distinct');
});

test('parseCopernicusActivations: returns empty for missing results', () => {
  assert.deepEqual(parseCopernicusActivations(null), []);
  assert.deepEqual(parseCopernicusActivations({}), []);
  assert.deepEqual(parseCopernicusActivations({ results: [] }), []);
});

// ── GLEIF LEI entity lookup ───────────────────────────────────────────────────

test('parseGleifLeiRecords: fixture produces 3 entity records', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gleif-lei-apple.sample.json'), 'utf8'));
  const result = parseGleifLeiRecords(raw);
  assert.equal(result.length, 3);
});

test('parseGleifLeiRecords: Apple Inc. is the primary result', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gleif-lei-apple.sample.json'), 'utf8'));
  const result = parseGleifLeiRecords(raw);
  const apple = result[0];
  assert.equal(apple.lei, 'HWUPKR0MPOU8FGXBT394');
  assert.equal(apple.name, 'Apple Inc.');
  assert.equal(apple.country, 'US');
  assert.equal(apple.jurisdiction, 'US-CA');
  assert.equal(apple.status, 'ACTIVE');
  assert.equal(apple.legalForm, 'H1UM');
});

test('parseGleifLeiRecords: Panama entity has PA country', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gleif-lei-apple.sample.json'), 'utf8'));
  const result = parseGleifLeiRecords(raw);
  const pa = result.find(r => r.jurisdiction === 'PA');
  assert.ok(pa, 'Panama-jurisdiction entity must be present');
  assert.equal(pa.country, 'PA');
  assert.equal(pa.lei, '254900TWD71M3MX9I453');
});

test('parseGleifLeiRecords: all LEIs are distinct strings', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gleif-lei-apple.sample.json'), 'utf8'));
  const result = parseGleifLeiRecords(raw);
  const leis = result.map(r => r.lei);
  assert.equal(new Set(leis).size, 3, 'all LEI codes must be distinct');
  for (const lei of leis) {
    assert.ok(typeof lei === 'string' && lei.length === 20, `LEI ${lei} must be a 20-char string`);
  }
});

test('parseGleifLeiRecords: returns empty for missing data array', () => {
  assert.deepEqual(parseGleifLeiRecords(null), []);
  assert.deepEqual(parseGleifLeiRecords({}), []);
  assert.deepEqual(parseGleifLeiRecords({ data: [] }), []);
});

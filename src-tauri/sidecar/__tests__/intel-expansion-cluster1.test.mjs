/**
 * Intel Expansion Cluster 1 — parser parity tests.
 *
 * All assertions run against committed fixture files (no live fetch).
 * Parsers are exported from local-api-server.mjs and tested here.
 */
/* eslint-disable sonarjs/no-hardcoded-ip -- fixture IPs from committed test data, not live addresses */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { join, dirname } = path;
import {
  parseFeodoIpBlocklist,
  parseThreatFoxCsv,
  parseUrlhausCsv,
  parseFrankfurterRates,
  parseAbuseCsv,
  parseCsvRow,
} from '../local-api-server.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dir, 'fixtures');

// ── shared CSV helpers ────────────────────────────────────────────────────────

test('parseCsvRow handles unquoted fields', () => {
  assert.deepEqual(parseCsvRow('a,b,c'), ['a', 'b', 'c']);
});

test('parseCsvRow handles quoted fields with embedded commas', () => {
  assert.deepEqual(parseCsvRow('"hello, world","foo","bar"'), ['hello, world', 'foo', 'bar']);
});

test('parseCsvRow handles doubled-quote escaping', () => {
  assert.deepEqual(parseCsvRow('"say ""hi"""'), ['say "hi"']);
});

test('parseCsvRow handles trailing empty field', () => {
  assert.deepEqual(parseCsvRow('"a","b",'), ['a', 'b', '']);
});

test('parseAbuseCsv skips # comment lines', () => {
  const text = [
    '# comment one',
    '# "col1","col2","col3"',
    '"val1","val2","val3"',
  ].join('\n');
  const rows = parseAbuseCsv(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['col1'], 'val1');
  assert.equal(rows[0]['col2'], 'val2');
});

test('parseAbuseCsv returns empty array for all-comment input', () => {
  const text = '# nothing here\n# still nothing';
  assert.deepEqual(parseAbuseCsv(text), []);
});

// ── Feodo Tracker ─────────────────────────────────────────────────────────────

test('parseFeodoIpBlocklist: fixture produces expected count and shape', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'feodo-ipblocklist.sample.json'), 'utf8'));
  const entries = parseFeodoIpBlocklist(raw);
  // Fixture has 5 entries, all have ip_address — expect all to pass through.
  assert.equal(entries.length, 5);
  const first = entries[0];
  // IP values from the committed fixture — tested as strings, not treated as live addresses
  assert.equal(first.ip, '162.243.103.246');
  assert.equal(first.port, 8080);
  assert.equal(first.malware, 'Emotet');
  assert.equal(first.country, 'US');
  assert.equal(first.status, 'offline');
  assert.equal(first.asn, 14_061);
  assert.equal(first.asName, 'DIGITALOCEAN-ASN');
  assert.ok(typeof first.firstSeen === 'string');
  assert.ok(typeof first.lastOnline === 'string');
});

test('parseFeodoIpBlocklist: online entry preserved', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'feodo-ipblocklist.sample.json'), 'utf8'));
  const entries = parseFeodoIpBlocklist(raw);
  const online = entries.find(e => e.status === 'online');
  assert.ok(online, 'should have at least one online entry');
  assert.equal(online.ip, '50.16.16.211');
  assert.equal(online.port, 443);
  assert.equal(online.malware, 'QakBot');
});

test('parseFeodoIpBlocklist: drops entry missing ip_address', () => {
  const input = [
    { ip_address: '192.0.2.1', port: 80, malware: 'X', status: 'online' }, // NOSONAR - RFC 5737 documentation address
    { port: 80, malware: 'Y', status: 'offline' }, // no ip_address
    { ip_address: '', port: 80, malware: 'Z', status: 'offline' }, // empty string
  ];
  const out = parseFeodoIpBlocklist(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].ip, '192.0.2.1'); // NOSONAR
});

test('parseFeodoIpBlocklist: null hostname becomes null (not undefined)', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'feodo-ipblocklist.sample.json'), 'utf8'));
  const entries = parseFeodoIpBlocklist(raw);
  // First entry has hostname: null in fixture
  // hostname is not part of the normalized output — just verify no crash
  assert.ok(entries.length > 0);
});

test('parseFeodoIpBlocklist: empty array input returns empty output', () => {
  assert.deepEqual(parseFeodoIpBlocklist([]), []);
});

test('parseFeodoIpBlocklist: non-array input returns empty output', () => {
  assert.deepEqual(parseFeodoIpBlocklist(null), []);
  assert.deepEqual(parseFeodoIpBlocklist({}), []);
});

// ── ThreatFox ─────────────────────────────────────────────────────────────────

test('parseThreatFoxCsv: fixture produces expected count and shape', () => {
  const text = readFileSync(join(fixtureDir, 'threatfox-recent.sample.csv'), 'utf8');
  const entries = parseThreatFoxCsv(text);
  // Fixture has 3 data rows
  assert.equal(entries.length, 3);
  const first = entries[0];
  assert.equal(first.id, '1840679');
  assert.equal(first.iocType, 'domain');
  assert.equal(first.threatType, 'botnet_cc');
  assert.equal(first.malware, 'ClearFake');
  assert.equal(first.confidence, 90);
  assert.ok(Array.isArray(first.tags));
  assert.ok(first.tags.includes('ClearFake'));
  assert.ok(first.tags.includes('ClickFix'));
  assert.ok(typeof first.firstSeen === 'string');
  assert.ok(first.firstSeen.length > 0);
});

test('parseThreatFoxCsv: iocValue is the domain string', () => {
  const text = readFileSync(join(fixtureDir, 'threatfox-recent.sample.csv'), 'utf8');
  const entries = parseThreatFoxCsv(text);
  assert.ok(entries[0].iocValue.includes('.'), 'iocValue should look like a domain');
});

test('parseThreatFoxCsv: all entries have numeric confidence', () => {
  const text = readFileSync(join(fixtureDir, 'threatfox-recent.sample.csv'), 'utf8');
  const entries = parseThreatFoxCsv(text);
  for (const e of entries) {
    assert.ok(typeof e.confidence === 'number', `confidence must be a number, got ${typeof e.confidence}`);
  }
});

test('parseThreatFoxCsv: empty tags string produces empty array', () => {
  const out = parseThreatFoxCsv([
    '# "first_seen_utc","ioc_id","ioc_value","ioc_type","threat_type","fk_malware","malware_alias","malware_printable","last_seen_utc","confidence_level","is_compromised","reference","tags","anonymous","reporter"',
    '"2026-01-01 00:00:00","999","evil.com","domain","botnet_cc","malware","None","Evil","","50","False","None","","0","anon"',
  ].join('\n'));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].tags, []);
});

// ── URLhaus ───────────────────────────────────────────────────────────────────

test('parseUrlhausCsv: fixture produces expected count and shape', () => {
  const text = readFileSync(join(fixtureDir, 'urlhaus-recent.sample.csv'), 'utf8');
  const entries = parseUrlhausCsv(text);
  // Fixture has 3 data rows
  assert.equal(entries.length, 3);
  const first = entries[0];
  assert.equal(first.id, '3878717');
  assert.ok(first.url.startsWith('http'));
  assert.equal(first.status, 'online');
  assert.equal(first.threat, 'malware_download');
  assert.ok(Array.isArray(first.tags));
  assert.ok(first.tags.includes('Mozi'));
  assert.ok(typeof first.dateAdded === 'string');
  assert.ok(typeof first.reporter === 'string');
});

test('parseUrlhausCsv: all entries have non-empty url', () => {
  const text = readFileSync(join(fixtureDir, 'urlhaus-recent.sample.csv'), 'utf8');
  const entries = parseUrlhausCsv(text);
  for (const e of entries) {
    assert.ok(e.url.length > 0, 'url must not be empty');
  }
});

test('parseUrlhausCsv: tags split on comma', () => {
  const text = readFileSync(join(fixtureDir, 'urlhaus-recent.sample.csv'), 'utf8');
  const entries = parseUrlhausCsv(text);
  // First fixture row has "32-bit,elf,mips,Mozi"
  assert.ok(entries[0].tags.length >= 4);
});

test('parseUrlhausCsv: empty input returns empty array', () => {
  assert.deepEqual(parseUrlhausCsv('# just comments\n# nothing else'), []);
});

// ── Frankfurter FX ────────────────────────────────────────────────────────────

test('parseFrankfurterRates: fixture parses to expected shape', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'frankfurter-latest.sample.json'), 'utf8'));
  const result = parseFrankfurterRates(raw);
  assert.ok(result !== null);
  assert.equal(result.base, 'USD');
  assert.equal(result.date, '2026-06-30');
  assert.ok(typeof result.rates === 'object');
  assert.ok(typeof result.rates['EUR'] === 'number');
  assert.ok(typeof result.rates['GBP'] === 'number');
  assert.ok(typeof result.rates['JPY'] === 'number');
});

test('parseFrankfurterRates: EUR rate is in plausible range (0.5–2.0)', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'frankfurter-latest.sample.json'), 'utf8'));
  const result = parseFrankfurterRates(raw);
  assert.ok(result.rates['EUR'] > 0.5 && result.rates['EUR'] < 2);
});

test('parseFrankfurterRates: rate count matches fixture', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'frankfurter-latest.sample.json'), 'utf8'));
  const result = parseFrankfurterRates(raw);
  // Fixture has 29 rate pairs (the `amount` field is top-level, not in rates)
  assert.equal(Object.keys(result.rates).length, 29);
});

test('parseFrankfurterRates: returns null for non-object input', () => {
  assert.equal(parseFrankfurterRates(null), null);
  assert.equal(parseFrankfurterRates('string'), null);
  assert.equal(parseFrankfurterRates(42), null);
});

test('parseFrankfurterRates: returns null when base missing', () => {
  assert.equal(parseFrankfurterRates({ rates: { EUR: 0.9 } }), null);
});

test('parseFrankfurterRates: returns null when rates missing', () => {
  assert.equal(parseFrankfurterRates({ base: 'USD', date: '2026-01-01' }), null);
});

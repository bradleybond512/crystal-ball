import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup, encodeBackup, decodeBackup, validateDestination } from '../src/services/local-backup/schema.ts';
import { backup, destination, store, place, entity, ids, canonical, freeze } from './fixtures/local-backup/fixtures.mts';

const invalid = value => assert.throws(() => validateBackup(value));
const one = (id, records) => backup([store(id, records)]);

test('canonical round trip preserves zero, empty names, optional absence, duplicates and array order', () => {
  const input = freeze(backup());
  const validated = validateBackup(input), encoded = encodeBackup(input);
  assert.deepEqual(validated, input); assert.notEqual(validated.stores[0].records[0], input.stores[0].records[0]);
  assert.equal(new TextDecoder().decode(encoded), canonical(input));
  assert.deepEqual(decodeBackup(encoded), input);
  assert.equal(Object.hasOwn(validated.stores[1].records[0], 'lat'), false);
  validated.stores[0].records[0].name = 'copy only';
  assert.equal(input.stores[0].records[0].name, '');
});

test('manifest requires exact keys, versions, counts, known stores and catalog order', () => {
  for (const value of [null, [], {}, { ...backup(), version: 2 }, { ...backup(), createdAtMs: -1 }, { ...backup(), createdAtMs: -0 }, { ...backup(), createdAtMs: 1.5 }, { ...backup(), extra: 1 }, backup([]), backup([...backup().stores].reverse()), backup([store(ids[0], []), store(ids[0], [])]), backup([store('secret-vault', [])])]) invalid(value);
  for (const changes of [{ schemaVersion: 2 }, { count: 99 }, { count: -0 }, { extra: 1 }, { records: null }]) invalid(backup([{ ...store(ids[0], []), ...changes }]));
  for (const field of ['version', 'createdAtMs', 'stores']) { const value = backup(); delete value[field]; invalid(value); }
  for (const id of ids) assert.deepEqual(validateBackup(one(id, [])).stores[0].records, []);
});

test('saved places enforce required fields, exact types, numeric boundaries and temporal order', () => {
  for (const key of Object.keys(place())) { const value = place(); delete value[key]; invalid(one(ids[0], [value])); }
  const rejected = { id: ['', 'x'.repeat(257), null], name: ['x'.repeat(513), null], notes: ['x'.repeat(8193), null], lat: [-90.01, 90.01, NaN, Infinity, -0, '0'], lon: [-180.01, 180.01, -0], radiusKm: [0, 3001, 1.5, -0], priority: [1.5, Number.MAX_SAFE_INTEGER + 1, -0], sortIndex: [-1, 1.5, -0], createdAt: [-1, 1.5, -0], updatedAt: [-1, 1.5, -0], primary: [1, 'true', null], offlinePinned: [0, null], source: ['unknown', null] };
  for (const [field, values] of Object.entries(rejected)) for (const value of values) invalid(one(ids[0], [place({ [field]: value })]));
  invalid(one(ids[0], [place({ secret: 'no' })])); invalid(one(ids[0], [place({ createdAt: 2, updatedAt: 1 })]));
  for (const changes of [{ lat: -90, lon: -180 }, { lat: 90, lon: 180, radiusKm: 3000 }, { priority: -Number.MAX_SAFE_INTEGER, sortIndex: Number.MAX_SAFE_INTEGER }, { createdAt: Number.MAX_SAFE_INTEGER, updatedAt: Number.MAX_SAFE_INTEGER }, { name: 'x'.repeat(512), notes: 'x'.repeat(8192), id: 'x'.repeat(256) }]) assert.doesNotThrow(() => validateBackup(one(ids[0], [place(changes)])));
});

test('saved places require one primary and unique IDs/tags from the fixed allowlist', () => {
  for (const records of [[place({ primary: false })], [place(), place({ id: 'second' })], [place(), place({ primary: false })]]) invalid(one(ids[0], records));
  for (const tags of [['home', 'home'], ['unknown'], [null], Array(13).fill('home'), null]) invalid(one(ids[0], [place({ tags })]));
  const tags = ['home', 'work', 'family', 'bugout', 'travel', 'medical', 'supply', 'concern', 'school', 'shelter', 'critical', 'data_center'];
  assert.doesNotThrow(() => validateBackup(one(ids[0], [place({ tags }), place({ id: 'second', primary: false })])));
});

test('watchlist preserves independent optional fields and enforces exact scalar and keyword bounds', () => {
  for (const changes of [{ lat: 0 }, { lon: 0 }, { radiusKm: 0 }, { radiusKm: Number.MAX_SAFE_INTEGER }, { label: 'x'.repeat(512), keywords: Array(64).fill('x'.repeat(256)) }]) assert.deepEqual(validateBackup(one(ids[1], [entity(changes)])).stores[0].records, [entity(changes)]);
  const rejected = { id: ['', 'x'.repeat(257)], label: [null, 'x'.repeat(513)], keywords: [null, [null], ['x'.repeat(257)], Array(65).fill('')], lat: [undefined, null, -0, 91], lon: [undefined, -0, -181], radiusKm: [undefined, -0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1] };
  for (const [key, values] of Object.entries(rejected)) for (const value of values) invalid(one(ids[1], [entity({ [key]: value })]));
  for (const key of ['id', 'label', 'keywords']) { const row = entity(); delete row[key]; invalid(one(ids[1], [row])); }
  invalid(one(ids[1], [entity(), entity()])); invalid(one(ids[1], [entity({ secret: true })]));
});

test('webcam pins enforce distinct nonempty UTF8 IDs and preserve whitespace', () => {
  for (const records of [[''], ['x', 'x'], [null], [3], ['x'.repeat(257)]]) invalid(one(ids[2], records));
  assert.deepEqual(validateBackup(one(ids[2], [' x ', 'x', 'é'.repeat(128)])).stores[0].records, [' x ', 'x', 'é'.repeat(128)]);
});

test('all strings reject lone surrogates and use UTF8 byte limits without normalization', () => {
  for (const broken of ['\ud800', '\udfff', 'a\ud800b']) {
    for (const key of ['id', 'name', 'notes']) invalid(one(ids[0], [place({ [key]: broken })]));
    for (const key of ['id', 'label']) invalid(one(ids[1], [entity({ [key]: broken })]));
    invalid(one(ids[1], [entity({ keywords: [broken] })])); invalid(one(ids[2], [broken]));
  }
  invalid(one(ids[2], ['😀'.repeat(65)]));
  assert.deepEqual(validateBackup(one(ids[2], ['é', 'e\u0301', '😀'.repeat(64)])).stores[0].records, ['é', 'e\u0301', '😀'.repeat(64)]);
});

test('record counts and cumulative byte budget reject rather than truncate', () => {
  for (const id of ids) {
    const rows = Array.from({ length: 1000 }, (_, i) => id === ids[0] ? place({ id: `${i}`, primary: i === 0 }) : id === ids[1] ? entity({ id: `${i}` }) : `${i}`);
    assert.equal(validateBackup(one(id, rows)).stores[0].count, 1000);
    invalid(one(id, [...rows, id === ids[2] ? '1000' : { ...rows[0], id: '1000', ...(id === ids[0] ? { primary: false } : {}) }]));
  }
  invalid(one(ids[0], Array.from({ length: 150 }, (_, i) => place({ id: `${i}`, primary: i === 0, notes: 'x'.repeat(8192) }))));
});

test('decoder rejects duplicate keys, noncanonical encodings, invalid UTF8 and oversize bytes', () => {
  const text = canonical(backup());
  for (const raw of [' ' + text, text + '\n', text.replace('"version":1', '"version":1,"version":1'), text.replace('"createdAtMs":123', '"createdAtMs":1.23e2'), '{}', 'null']) assert.throws(() => decodeBackup(Buffer.from(raw)));
  assert.throws(() => decodeBackup(Uint8Array.from([0xc3, 0x28])));
  assert.throws(() => decodeBackup(new Uint8Array(1_048_577)));
});

test('schema rejects non-data objects without invoking accessors or accepting sparse arrays', () => {
  let reads = 0; const value = backup(); Object.defineProperty(value, 'version', { enumerable: true, get() { reads++; return 1; } }); invalid(value); assert.equal(reads, 0);
  invalid({ ...backup(), [Symbol('extra')]: true }); invalid(Object.assign(Object.create({ inherited: true }), backup()));
  const sparse = new Array(1); invalid(one(ids[2], sparse));
  const extended = ['x']; extended.extra = true; invalid(one(ids[2], extended));
});

test('destination requires explicit selected entries, validates supplied entries and clones', () => {
  for (const value of [null, {}, { stores: null }, destination([]), destination([store(ids[1], [])]), { ...destination(), extra: 1 }]) assert.throws(() => validateDestination(value, [ids[0]]));
  const input = freeze(destination()); const result = validateDestination(input, [ids[0]]);
  assert.ok(Array.isArray(result)); assert.notEqual(result[0].records[0], input.stores[0].records[0]);
  assert.doesNotThrow(() => validateDestination(destination([store(ids[0], [])]), [ids[0]]));
  assert.throws(() => validateDestination(destination([store(ids[0], []), store(ids[1], [entity({ radiusKm: -1 })])]), [ids[0]]));
});


test('exact one-MiB canonical payload is accepted and one byte over rejects', () => {
  const value = one(ids[0], Array.from({ length: 130 }, (_, i) => place({ id: `${i}`, primary: i === 0 })));
  let remaining = 1_048_576 - Buffer.byteLength(canonical(value));
  for (const row of value.stores[0].records) { const size = Math.min(8192, remaining); row.notes = 'x'.repeat(size); remaining -= size; }
  assert.equal(remaining, 0); assert.equal(encodeBackup(value).byteLength, 1_048_576);
  value.stores[0].records.at(-1).notes += 'x';
  assert.equal(Buffer.byteLength(canonical(value)), 1_048_577); invalid(value);
});

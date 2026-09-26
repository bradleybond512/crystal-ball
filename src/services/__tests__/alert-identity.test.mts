import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdentityLedger, hydrateIdentityLedger, identifyAlert, identifySignal, canonicalStormReportId } from '../alert-identity.ts';
const now = 1_800_000_000_000;
const valid = (v: unknown): v is { considered: boolean } => !!v && typeof v === 'object' && typeof (v as { considered?: unknown }).considered === 'boolean';
const value = { considered: false };
const identity = (key = 'key', revision = 'revision') => ({ key, revision, eventTime: now - 1000 });
const alert = (overrides = {}) => ({ source: 'nws', id: 'report', timestamp: now - 1000, severity: 'high', title: 'Warning', body: 'Details', ...overrides });

test('alert keys preserve full namespaced report IDs without delimiter collisions', () => {
  assert.notEqual(identifyAlert(alert({ id: 'a:b' }))?.key, identifyAlert(alert({ source: 'gdacs', id: 'a:b' }))?.key);
  assert.notEqual(identifyAlert(alert({ id: 'report2' }))?.key, identifyAlert(alert())?.key);
  assert.equal(identifyAlert(alert({ id: 'é'.repeat(3000) })), null);
});
test('material alert revisions exclude user state and retrieval state', () => {
  assert.deepEqual(identifyAlert(alert()), identifyAlert(alert({ acknowledged: true, pinned: true, raw: { fetchedAt: now } })));
  for (const change of [{ title: 'New' }, { body: 'Changed' }, { severity: 'critical' }, { timestamp: now }, { link: 'https://example.com' }]) assert.notEqual(identifyAlert(alert(change))?.revision, identifyAlert(alert())?.revision);
});
test('valid zero geography is retained and invalid geography fails closed', () => {
  assert.ok(identifyAlert(alert({ location: { lat: 0, lon: 0 } })));
  for (const location of [{ lat: NaN, lon: 0 }, { lat: 91, lon: 0 }, { lat: 1 }, { lat: 0, lon: Infinity }]) assert.equal(identifyAlert(alert({ location })), null);
  assert.equal(identifyAlert(alert({ spatialScope: { kind: 'planet' } })), null);
});
test('invalid sources, timestamps, and oversized revisions are rejected', () => {
  for (const change of [{ source: 'unknown' }, { timestamp: NaN }, { timestamp: Infinity }, { timestamp: -1 }, { title: 'a'.repeat(17000) }, { id: '' }]) assert.equal(identifyAlert(alert(change)), null);
});
test('signal identity excludes unstable evidence freshness but includes material changes', () => {
  const signal = { id: 's1', type: 'convergence', title: 'Signal', description: 'Details', confidence: 0.8, timestamp: new Date(now), data: { placeIds: ['a'] } };
  assert.ok(identifySignal(signal));
  assert.notEqual(identifySignal(signal)?.revision, identifySignal({ ...signal, confidence: 0.9 })?.revision);
  assert.deepEqual(identifySignal({ ...signal, evidence: { freshness: 'fresh' } }), identifySignal({ ...signal, evidence: { freshness: 'stale' } }));
  assert.equal(identifySignal({ ...signal, confidence: NaN }), null);
  assert.equal(identifySignal({ ...signal, timestamp: new Date(NaN) }), null);
});
test('storm identity ignores row ID and preserves distinct precise reports', () => {
  const report = { reportedAt: new Date(now), lat: 0, lon: 0, type: 'hail', magnitude: '1', location: 'A', county: 'B', state: 'C', remarks: 'D' };
  assert.ok(canonicalStormReportId(report));
  assert.equal(canonicalStormReportId({ ...report, id: 'one' }), canonicalStormReportId({ ...report, id: 'two' }));
  for (const delta of [{ lat: 0.000001 }, { remarks: 'E' }, { reportedAt: new Date(now - 1) }, { magnitude: '2' }]) assert.notEqual(canonicalStormReportId(report), canonicalStormReportId({ ...report, ...delta }));
  assert.equal(canonicalStormReportId({ ...report, lon: NaN }), null);
  assert.equal(canonicalStormReportId({ ...report, remarks: 'é'.repeat(3000) }), null);
});
test('ledger tracks revisions and repeated revisions do not slide receipt TTL', () => {
  const ledger = createIdentityLedger(valid);
  assert.equal(ledger.admit(identity(), value, now), 'accepted');
  assert.equal(ledger.admit(identity(), value, now + 10), 'duplicate');
  assert.equal(ledger.admit(identity('key', 'changed'), value, now + 20), 'accepted');
  assert.equal(ledger.admit(identity(), value, now + 30), 'duplicate');
  assert.deepEqual(ledger.get('key')?.revisions, ['revision', 'changed']);
  assert.equal(ledger.get('key')?.firstReceivedAt, now);
  ledger.expire(now + 7 * 86400000);
  assert.equal(ledger.size, 0);
});
test('ledger rejects invalid values, clocks, and oversized strings', () => {
  const ledger = createIdentityLedger(valid);
  assert.equal(ledger.admit(identity(), {} as typeof value, now), 'invalid');
  assert.equal(ledger.admit(identity(), value, NaN), 'invalid');
  assert.equal(ledger.admit(identity('x'.repeat(4097)), value, now), 'invalid');
  assert.equal(ledger.admit(identity('key', 'x'.repeat(16385)), value, now), 'invalid');
  assert.equal(ledger.size, 0);
});
test('capacity uses oldest unprotected identity and does not evict protected entries', () => {
  const ledger = createIdentityLedger(valid, { maxEntries: 2 });
  ledger.admit(identity('a'), value, now);
  ledger.admit(identity('b'), value, now + 1);
  assert.equal(ledger.admit(identity('c'), value, now + 2, new Set(['a'])), 'accepted');
  assert.equal(ledger.get('b'), undefined);
  const before = ledger.snapshot();
  assert.equal(ledger.admit(identity('d'), value, now + 3, new Set(['a', 'c'])), 'capacity');
  assert.deepEqual(ledger.snapshot(), before);
});
test('byte budget counts complete UTF8 snapshot and failed revisions preserve existing entry', () => {
  const ledger = createIdentityLedger(valid, { maxBytes: 300 });
  assert.equal(ledger.admit(identity(), value, now), 'accepted');
  assert.equal(ledger.byteLength, Buffer.byteLength(JSON.stringify(ledger.snapshot())));
  const before = ledger.snapshot();
  assert.equal(ledger.admit(identity('key', 'é'.repeat(120)), value, now + 1), 'capacity');
  assert.deepEqual(ledger.snapshot(), before);
});
test('updateValue preserves original on failed validation or capacity', () => {
  const validate = (v: unknown): v is string => typeof v === 'string';
  const ledger = createIdentityLedger(validate, { maxBytes: 220 });
  ledger.admit(identity(), 'old', now);
  assert.equal(ledger.updateValue('key', 'é'.repeat(200)), false);
  assert.equal(ledger.get('key')?.value, 'old');
  assert.equal(ledger.updateValue('key', 'new'), true);
  assert.equal(ledger.byteLength, Buffer.byteLength(JSON.stringify(ledger.snapshot())));
});
test('values returned by get and snapshot cannot mutate ledger budget or state', () => {
  const ledger = createIdentityLedger(valid);
  ledger.admit(identity(), value, now);
  ledger.get('key')!.value.considered = true;
  ledger.snapshot().entries[0]!.revisions.push('new');
  assert.equal(ledger.get('key')?.value.considered, false);
  assert.deepEqual(ledger.get('key')?.revisions, ['revision']);
});
test('hydration preserves admitted revisions and original receipt, rejects malformed envelopes', () => {
  const ledger = createIdentityLedger(valid);
  ledger.admit(identity(), value, now);
  const hydrated = hydrateIdentityLedger(ledger.snapshot(), now + 100, valid);
  assert.deepEqual(hydrated.snapshot(), ledger.snapshot());
  assert.equal(hydrated.admit(identity(), value, now + 101), 'duplicate');
  for (const bad of [{ version: 2, entries: [] }, { version: 1, entries: [{ ...ledger.snapshot().entries[0], firstReceivedAt: now + 1000 }] }, { version: 1, entries: [ledger.snapshot().entries[0], ledger.snapshot().entries[0]] }]) assert.equal(hydrateIdentityLedger(bad, now, valid).size, 0);
  assert.equal(hydrateIdentityLedger(ledger.snapshot(), now + 7 * 86400000, valid).size, 0);
});
test('overlarge hydration cannot bypass configured hard bounds', () => {
  const ledger = createIdentityLedger(valid);
  ledger.admit(identity('a'), value, now);
  ledger.admit(identity('b'), value, now);
  assert.equal(hydrateIdentityLedger(ledger.snapshot(), now, valid, { maxEntries: 1 }).size, 0);
  assert.equal(hydrateIdentityLedger(ledger.snapshot(), now, valid, { maxBytes: 100 }).size, 0);
});

test('hard count ceiling remains 4096 even when caller requests a larger limit', () => {
  const ledger = createIdentityLedger(valid, { maxEntries: 10000 });
  const protectedKeys = new Set<string>();
  for (let i = 0; i < 4096; i++) {
    const key = `key-${i}`;
    assert.equal(ledger.admit(identity(key), value, now, protectedKeys), 'accepted');
    protectedKeys.add(key);
  }
  assert.equal(ledger.admit(identity('overflow'), value, now, protectedKeys), 'capacity');
  assert.equal(ledger.size, 4096);
  assert.equal(ledger.byteLength, Buffer.byteLength(JSON.stringify(ledger.snapshot())));
});
test('hard byte ceiling remains 2MiB and failed admissions preserve protected state', () => {
  const ledger = createIdentityLedger((v: unknown): v is string => typeof v === 'string', { maxBytes: 10000000 });
  const protectedKeys = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const key = `large-${i}`;
    const result = ledger.admit(identity(key), 'x'.repeat(50000), now, protectedKeys);
    if (result === 'capacity') break;
    assert.equal(result, 'accepted');
    protectedKeys.add(key);
  }
  assert.ok(ledger.byteLength > 2000000);
  assert.ok(ledger.byteLength <= 2 * 1024 * 1024);
  assert.equal(ledger.byteLength, Buffer.byteLength(JSON.stringify(ledger.snapshot())));
  const before = ledger.snapshot();
  assert.equal(ledger.admit(identity('overflow'), 'x'.repeat(50000), now, protectedKeys), 'capacity');
  assert.deepEqual(ledger.snapshot(), before);
});
test('expiry precedes protection and oldest receipt/key ordering is deterministic', () => {
  const ledger = createIdentityLedger(valid, { maxEntries: 2, maxAgeMs: 10 });
  ledger.admit(identity('b'), value, now);
  ledger.admit(identity('a'), value, now);
  ledger.admit(identity('c'), value, now + 1);
  assert.equal(ledger.get('a'), undefined);
  assert.equal(ledger.admit(identity('d'), value, now + 11, new Set(['b', 'c'])), 'accepted');
  assert.equal(ledger.size, 1);
});
test('unsafe persisted revision history and values fail closed', () => {
  const ledger = createIdentityLedger(valid);
  ledger.admit(identity(), value, now);
  const entry = ledger.snapshot().entries[0]!;
  for (const change of [{ revisions: [] }, { revisions: ['revision', 'revision'] }, { revisions: ['x'.repeat(16385)] }, { firstReceivedAt: Number.NaN }, { value: {} }]) {
    assert.equal(hydrateIdentityLedger({ version: 1, entries: [{ ...entry, ...change }] }, now, valid).size, 0);
  }
});
test('canonical material data is stable across object property order and rejects nonfinite evidence', () => {
  const signal = { id: 's1', type: 'convergence', title: 'Signal', description: 'Details', confidence: 0.8, timestamp: new Date(now) };
  assert.deepEqual(identifySignal({ ...signal, data: { term: 't', baseline: 1 } }), identifySignal({ ...signal, data: { baseline: 1, term: 't' } }));
  assert.equal(identifySignal({ ...signal, data: { baseline: Number.NaN } }), null);
});

test('signal source, domain, and validated geography are material identity context', () => {
  const signal = { id: 's1', type: 'convergence', title: 'Signal', description: 'Details', confidence: 0.8, timestamp: new Date(now) };
  const geo = { kind: 'point', basis: 'reported-event', lat: 0, lon: 0, label: '', countries: [], radiusKm: 0 };
  const revised = identifySignal({ ...signal, data: { source: 'nws', domainHint: 'natural_hazard', geo } });
  assert.ok(revised);
  assert.notEqual(revised?.revision, identifySignal(signal)?.revision);
  assert.equal(identifySignal({ ...signal, data: { geo: { ...geo, lat: 91 } } }), null);
  assert.equal(identifySignal({ ...signal, data: { domainHint: 'invalid' } }), null);
  assert.equal(identifySignal({ ...signal, data: { source: '' } }), null);
});

test('hydration invalid callback distinguishes corrupt snapshots from valid empty or expired state', () => {
  let invalid = 0;
  const rejected = hydrateIdentityLedger({ version: 9, entries: [] }, now, valid, undefined, () => invalid++);
  assert.equal(rejected.size, 0);
  assert.equal(invalid, 1);
  hydrateIdentityLedger({ version: 1, entries: [{}] }, now, valid, undefined, () => invalid++);
  assert.equal(invalid, 2);
  hydrateIdentityLedger({ version: 1, entries: [] }, now, valid, undefined, () => invalid++);
  const ledger = createIdentityLedger(valid);
  ledger.admit(identity(), value, now);
  const expired = hydrateIdentityLedger(ledger.snapshot(), now + 7 * 86_400_000, valid, undefined, () => invalid++);
  assert.equal(expired.size, 0);
  assert.equal(invalid, 2);
});

test('nested material objects preserve identity when their property insertion order changes', () => {
  const signal = { id: 'nested-canonical', type: 'convergence', title: 'Signal', description: 'Details', confidence: 0.8, timestamp: new Date(now) };
  const first = identifySignal({ ...signal, data: { geo: { kind: 'point', basis: 'reported-event', lat: 0, lon: 0, label: 'Point', countries: [], radiusKm: 0 } } });
  const reordered = identifySignal({ ...signal, data: { geo: { radiusKm: 0, countries: [], label: 'Point', lon: 0, lat: 0, basis: 'reported-event', kind: 'point' } } });
  assert.ok(first);
  assert.deepEqual(reordered, first);
});

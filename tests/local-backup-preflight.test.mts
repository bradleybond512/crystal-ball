import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { preflightRestore } from '../src/services/local-backup/preflight.ts';
import { backup, destination, store, place, entity, ids, fingerprint, freeze, withGlobal } from './fixtures/local-backup/fixtures.mts';

const pins = records => backup([store(ids[2], records)]);
const destPins = records => destination([store(ids[2], records)]);

test('identical backups produce a deterministic read-only no-op with an independent fingerprint', async () => {
  const input = freeze(backup()), dest = freeze(destination());
  const preview = await preflightRestore(input, dest, 'merge');
  assert.equal(preview.readOnly, true); assert.equal(preview.writes, 0); assert.equal(preview.status, 'no-op'); assert.equal(preview.requiresReplacementAuthorization, false);
  assert.match(preview.destinationFingerprint, /^[a-f0-9]{64}$/); assert.equal(preview.destinationFingerprint, fingerprint(dest.stores));
  assert.deepEqual(await preflightRestore(input, dest, 'merge'), preview);
  assert.deepEqual(preview.stores.map(s => s.id), ids);
  for (const s of preview.stores) { assert.deepEqual(s.additions, []); assert.deepEqual(s.removals, []); assert.deepEqual(s.conflicts, []); assert.equal(s.orderChanged, false); }
  preview.stores[0].proposed.records[0].name = 'preview only'; assert.equal(dest.stores[0].records[0].name, ''); assert.equal(input.stores[0].records[0].name, '');
});

test('merge appends new records in incoming order and preserves destination order', async () => {
  const preview = await preflightRestore(pins(['b', 'new2', 'new1']), destPins(['b', 'a']), 'merge');
  const s = preview.stores[0]; assert.equal(preview.status, 'review'); assert.equal(preview.requiresReplacementAuthorization, false);
  assert.deepEqual(s.additions, ['new2', 'new1']); assert.deepEqual(s.noops, ['b']); assert.deepEqual(s.removals, []);
  assert.deepEqual(s.destinationOrder, ['b', 'a']); assert.deepEqual(s.proposedOrder, ['b', 'a', 'new2', 'new1']); assert.deepEqual(s.proposed.records, s.proposedOrder);
  assert.equal(s.proposed.count, 4);
});

test('same-ID changes block both modes even when incoming timestamps are newer', async () => {
  const existing = place(), changed = place({ updatedAt: 999, notes: 'newer' });
  for (const mode of ['merge', 'replace']) {
    const preview = await preflightRestore(backup([store(ids[0], [changed])]), destination([store(ids[0], [existing])]), mode);
    assert.equal(preview.status, 'blocked'); assert.equal(preview.requiresReplacementAuthorization, false); assert.equal(preview.stores[0].proposed, null);
    assert.deepEqual(preview.stores[0].conflicts, [{ kind: 'record-mismatch', ids: ['home'] }]);
  }
  const input = backup([store(ids[1], [entity({ label: 'incoming' })])]), dest = destination([store(ids[1], [entity()])]);
  for (const mode of ['merge', 'replace']) assert.equal((await preflightRestore(input, dest, mode)).status, 'blocked');
});

test('merge rejects incompatible primary selections without automatic demotion', async () => {
  const input = backup([store(ids[0], [place({ id: 'incoming-primary' })])]), dest = destination([store(ids[0], [place({ id: 'existing-primary' })])]);
  const preview = await preflightRestore(input, dest, 'merge'); assert.equal(preview.status, 'blocked'); assert.equal(preview.stores[0].proposed, null);
  assert.deepEqual(preview.stores[0].conflicts, [{ kind: 'primary-selection', ids: ['existing-primary', 'incoming-primary'] }]);
  assert.equal(input.stores[0].records[0].primary, true); assert.equal(dest.stores[0].records[0].primary, true);
});

test('replacement changes require separate authorization and enumerate removals/additions/order', async () => {
  const preview = await preflightRestore(pins(['b', 'c']), destPins(['a', 'b']), 'replace'); const s = preview.stores[0];
  assert.equal(preview.status, 'replacement-authorization-required'); assert.equal(preview.requiresReplacementAuthorization, true); assert.equal(preview.writes, 0);
  assert.deepEqual(s.additions, ['c']); assert.deepEqual(s.removals, ['a']); assert.deepEqual(s.noops, ['b']); assert.deepEqual(s.proposed.records, ['b', 'c']);
  const ordered = await preflightRestore(pins(['b', 'a']), destPins(['a', 'b']), 'replace'); assert.equal(ordered.stores[0].orderChanged, true); assert.equal(ordered.status, 'replacement-authorization-required');
  assert.equal((await preflightRestore(pins(['a', 'b']), destPins(['a', 'b']), 'replace')).status, 'no-op');
  const emptied = await preflightRestore(pins([]), destPins(['a']), 'replace'); assert.deepEqual(emptied.stores[0].removals, ['a']); assert.equal(emptied.requiresReplacementAuthorization, true);
});

test('blocking conflicts outrank replacement authorization across all stores', async () => {
  const input = backup([store(ids[1], [entity({ label: 'conflict' })]), store(ids[2], ['new'])]);
  const dest = destination([store(ids[1], [entity()]), store(ids[2], ['old'])]);
  const preview = await preflightRestore(input, dest, 'replace'); assert.equal(preview.status, 'blocked'); assert.equal(preview.requiresReplacementAuthorization, false); assert.equal(preview.writes, 0);
});

test('selected destination absence is invalid while an explicit empty store is valid', async () => {
  for (const dest of [null, {}, destination([]), destination([store(ids[1], [])]), { stores: [null] }]) await assert.rejects(preflightRestore(pins(['a']), dest, 'merge'));
  assert.equal((await preflightRestore(pins(['a']), destPins([]), 'merge')).status, 'review');
  for (const mode of ['auto', '', undefined, { replace: true }]) await assert.rejects(preflightRestore(pins([]), destPins([]), mode));
});

test('fingerprints include only selected canonical destinations and preserve ordering sensitivity', async () => {
  const selected = store(ids[2], ['a', 'b']);
  const base = await preflightRestore(pins([]), destination([store(ids[1], []), selected]), 'merge');
  assert.equal(base.destinationFingerprint, fingerprint([selected]));
  const unselected = await preflightRestore({ ...pins([]), createdAtMs: 999 }, destination([store(ids[1], [entity()]), selected]), 'replace');
  assert.equal(unselected.destinationFingerprint, base.destinationFingerprint); assert.deepEqual(unselected.stores.map(s => s.id), [ids[2]]);
  for (const records of [['b', 'a'], ['a', 'b', 'c'], []]) assert.notEqual((await preflightRestore(pins([]), destPins(records), 'merge')).destinationFingerprint, base.destinationFingerprint);
  const original = destination([store(ids[1], [entity()])]);
  const one = await preflightRestore(backup([store(ids[1], [])]), original, 'merge'); original.stores[0].records[0].label = 'edited';
  assert.notEqual((await preflightRestore(backup([store(ids[1], [])]), original, 'merge')).destinationFingerprint, one.destinationFingerprint);
});

test('preflight takes independent snapshots before asynchronous digest completes', async () => {
  const input = pins(['new']), dest = destPins(['old']); let changed = false;
  const crypto = { subtle: new Proxy(webcrypto.subtle, { get(target, key) {
    if (key === 'digest') return (...args) => { input.stores[0].records[0] = 'changed-incoming'; dest.stores[0].records[0] = 'changed-dest'; changed = true; return target.digest(...args); };
    return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
  } }), getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const result = await withGlobal('crypto', crypto, () => preflightRestore(input, dest, 'merge'));
  assert.equal(changed, true); assert.equal(result.destinationFingerprint, fingerprint([store(ids[2], ['old'])])); assert.deepEqual(result.stores[0].proposed.records, ['old', 'new']);
});

test('merge rejects combined record and byte limits rather than returning a truncated preview', async () => {
  await assert.rejects(preflightRestore(pins(['new']), destPins(Array.from({ length: 1000 }, (_, i) => `${i}`)), 'merge'));
  const rows = prefix => Array.from({ length: 70 }, (_, i) => entity({ id: prefix + i, keywords: Array(64).fill('x'.repeat(120)) }));
  await assert.rejects(preflightRestore(backup([store(ids[1], rows('new'))]), destination([store(ids[1], rows('old'))]), 'merge'));
});

test('preflight exposes no apply or I/O API and fails closed without crypto', async () => {
  await withGlobal('crypto', undefined, async () => assert.rejects(preflightRestore(pins([]), destPins([]), 'merge')));
  const result = await preflightRestore(pins(['a']), destPins([]), 'merge'); assert.equal(Object.hasOwn(result, 'apply'), false);
  const source = readFileSync(new URL('../src/services/local-backup/preflight.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:localStorage|indexedDB|fetch|invoke|writeFile)\s*[.(]/);
});

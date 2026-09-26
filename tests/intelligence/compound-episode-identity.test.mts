import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { UnifiedAlert } from '../../src/services/unified-alerts.ts';

const storage = new Map<string, string>();
let now = 1_790_000_000_000;
let failWrites = false;
Object.assign(globalThis, {
  window: {}, document: { addEventListener: () => {}, hidden: false },
  localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failWrites) throw new Error('quota'); storage.set(key, value); },
    removeItem: (key: string) => storage.delete(key) },
});
const { CompoundEpisodeRegistry } = await import('../../src/services/compound-alert-bridge.ts');
beforeEach(t => { storage.clear(); now = 1_790_000_000_000; failWrites = false; t.mock.method(Date, 'now', () => now); });
function member(id: string, source: UnifiedAlert['source'] = 'cyber'): UnifiedAlert {
  return { id, source, severity: 'high', title: 'Same title', body: id, timestamp: now,
    relevanceScore: 80, acknowledged: false, pinned: false };
}

test('compound report episode survives scan gaps, empty observations and restart', () => {
  const members = [member('cyber-1'), member('grid-1', 'power-grid')];
  const first = new CompoundEpisodeRegistry().consider('cyber-infrastructure', members)!;
  now += 60 * 60_000;
  const restarted = new CompoundEpisodeRegistry();
  assert.equal(restarted.consider('cyber-infrastructure', []), null);
  const second = restarted.consider('cyber-infrastructure', [...members].reverse())!;
  assert.equal(second.id, first.id);
  assert.equal(second.startedAt, first.startedAt);
  assert.deepEqual(second.memberIds, ['cyber-1', 'grid-1']);
});

test('overlapping members retain identity and wholly new members form a distinct report episode', () => {
  const registry = new CompoundEpisodeRegistry();
  const first = registry.consider('cyber-infrastructure', [member('a'), member('b', 'power-grid')])!;
  const overlap = registry.consider('cyber-infrastructure', [member('a'), member('c', 'power-grid')])!;
  assert.equal(overlap.id, first.id);
  assert.deepEqual(overlap.memberIds, ['a', 'b', 'c']);
  const distinct = registry.consider('cyber-infrastructure', [member('d'), member('e', 'power-grid')])!;
  assert.notEqual(distinct.id, first.id);
  const spanning = registry.consider('cyber-infrastructure', [member('a'), member('d')])!;
  assert.equal(spanning.id, first.id);
  assert.equal(registry.diagnostics().size, 2, 'overlap never deletes an existing episode');
});

test('unverifiable source members suppress a new derived episode', () => {
  const registry = new CompoundEpisodeRegistry();
  assert.equal(registry.consider('cyber-infrastructure', [member('loop', 'correlation')]), null);
  assert.equal(registry.consider('cyber-infrastructure', [member('x'.repeat(5000))]), null);
  assert.equal(registry.diagnostics().size, 0);
  assert.equal(registry.diagnostics().admissionFailures, 2);
});

test('persistence failure retains admitted in-memory identity and signals loss of restart guarantee', () => {
  const registry = new CompoundEpisodeRegistry(); failWrites = true;
  const first = registry.consider('cyber-infrastructure', [member('a')])!;
  now += 60_000;
  const repeat = registry.consider('cyber-infrastructure', [member('a')])!;
  assert.equal(first.id, repeat.id);
  assert.equal(registry.diagnostics().persistenceFailures, 1);
  assert.equal(registry.diagnostics().size, 1);
});

test('compound registry enforces bytes and count without refreshing the first-observed horizon', () => {
  const registry = new CompoundEpisodeRegistry({ maxEntries: 2, maxBytes: 5000 });
  const first = registry.consider('cyber-infrastructure', [member('a')])!;
  for (let i = 0; i < 20; i++) registry.consider('cyber-infrastructure', [member(`other-${i}`)]);
  assert.ok(registry.diagnostics().size <= 2);
  assert.ok(registry.diagnostics().byteLength <= 5000);
  storage.clear();
  const retained = new CompoundEpisodeRegistry();
  const members = [member('persistent')];
  const original = retained.consider('cyber-infrastructure', members)!;
  now += 7 * 86_400_000 - 1;
  assert.equal(retained.consider('cyber-infrastructure', members)!.id, original.id);
  now += 1;
  assert.notEqual(retained.consider('cyber-infrastructure', members)!.id, original.id);
  assert.ok(first.id);
});

test('invalid persisted compound identity snapshots report degraded hydration', () => {
  for (const snapshot of [{ version: 9, entries: [] }, { version: 1, entries: [{}] }]) {
    storage.set('wm-compound-episodes-v1', JSON.stringify(snapshot));
    const registry = new CompoundEpisodeRegistry();
    assert.equal(registry.diagnostics().size, 0);
    assert.equal(registry.diagnostics().persistenceFailures, 1);
  }
});

test('ordinary compound episode expiry during hydration is not corruption', () => {
  new CompoundEpisodeRegistry().consider('cyber-infrastructure', [member('a')]);
  now += 7 * 86_400_000;
  const registry = new CompoundEpisodeRegistry();
  assert.equal(registry.diagnostics().size, 0);
  assert.equal(registry.diagnostics().persistenceFailures, 0);
});

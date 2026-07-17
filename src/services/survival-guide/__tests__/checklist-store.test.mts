import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory localStorage shim for node test runtime.
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
(globalThis as Record<string, unknown>).localStorage = new MemStorage();

const {
  isChecked, setChecked, toggle, getCheckedIds, subscribe, _resetForTest, _hydrateForTest,
} = await import('../checklist-store.ts');

beforeEach(() => {
  (globalThis.localStorage as unknown as MemStorage).clear();
  _resetForTest();
});

test('toggle round-trips through storage', () => {
  assert.equal(isChecked('tornado.safe_room'), false);
  toggle('tornado.safe_room');
  assert.equal(isChecked('tornado.safe_room'), true);
  // A fresh hydrate reads persisted state.
  _resetForTest();
  _hydrateForTest();
  assert.equal(isChecked('tornado.safe_room'), true);
});

test('setChecked(false) removes', () => {
  setChecked('a.b', true);
  setChecked('a.b', false);
  assert.equal(getCheckedIds().has('a.b'), false);
});

test('subscribers fire on change', () => {
  let calls = 0;
  const un = subscribe(() => { calls += 1; });
  toggle('x.y');
  assert.equal(calls, 1);
  un();
  toggle('x.z');
  assert.equal(calls, 1);
});

test('pruneUnknown drops ids not in the valid set', async () => {
  const { pruneUnknown } = await import('../checklist-store.ts');
  setChecked('keep.a', true);
  setChecked('drop.b', true);
  pruneUnknown(new Set(['keep.a']));
  assert.equal(isChecked('keep.a'), true);
  assert.equal(isChecked('drop.b'), false);
});

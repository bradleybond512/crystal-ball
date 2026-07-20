import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

const mem = new MemoryStorage();
(globalThis as Record<string, unknown>).localStorage = mem;

const { getPinnedIds, isPinned, pinFeed, unpinFeed, togglePin, onPinnedChange } = await import(
  '../pinned-store.ts'
);

test('starts empty', () => {
  mem.clear();
  assert.deepEqual(getPinnedIds(), []);
  assert.equal(isPinned('faa-xyz'), false);
});

test('pin/unpin/isPinned round-trip for a non-Windy id', () => {
  mem.clear();
  pinFeed('faa-xyz');
  assert.equal(isPinned('faa-xyz'), true);
  assert.deepEqual(getPinnedIds(), ['faa-xyz']);
  unpinFeed('faa-xyz');
  assert.equal(isPinned('faa-xyz'), false);
  assert.deepEqual(getPinnedIds(), []);
});

test('pinFeed is idempotent', () => {
  mem.clear();
  pinFeed('a');
  pinFeed('a');
  assert.deepEqual(getPinnedIds(), ['a']);
});

test('togglePin flips state and returns the new value', () => {
  mem.clear();
  assert.equal(togglePin('faa-xyz'), true);
  assert.equal(isPinned('faa-xyz'), true);
  assert.equal(togglePin('faa-xyz'), false);
  assert.equal(isPinned('faa-xyz'), false);
});

test('onPinnedChange fires on mutation and unsubscribe stops it', () => {
  mem.clear();
  let count = 0;
  const off = onPinnedChange(() => {
    count += 1;
  });
  pinFeed('a');
  assert.equal(count, 1);
  togglePin('b');
  assert.equal(count, 2);
  off();
  pinFeed('c');
  assert.equal(count, 2);
});

test('getPinnedIds tolerates corrupt storage', () => {
  mem.setItem('crystalball-pinned-webcams', 'not json');
  assert.deepEqual(getPinnedIds(), []);
});

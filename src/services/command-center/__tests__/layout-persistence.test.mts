import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAYOUT_KEY,
  clearLayout,
  defaultLayout,
  loadLayout,
  reconcileLayout,
  reorderLayout,
  saveLayout,
  setTileVisibility,
  sortLayout,
  type TileConfig,
} from '../layout-persistence.ts';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  raw(): Map<string, string> { return this.map; }
}

test('defaultLayout: empty saved places still includes core tiles', () => {
  const layout = defaultLayout([]);
  const ids = layout.map((t) => t.id);
  assert.deepEqual(ids, ['situations', 'alerts', 'feed-health']);
  assert.equal(layout.every((t) => t.visible), true);
});

test('defaultLayout: saved places appear before core tiles with stable ordering', () => {
  const layout = defaultLayout([{ id: 'home' }, { id: 'work' }]);
  assert.equal(layout[0].id, 'saved-place:home');
  assert.equal(layout[0].type, 'saved-place');
  assert.equal(layout[0].placeId, 'home');
  assert.equal(layout[1].id, 'saved-place:work');
  assert.equal(layout[2].id, 'situations');
  for (let i = 0; i < layout.length; i++) assert.equal(layout[i].order, i);
});

test('saveLayout / loadLayout round-trip preserves type + visibility + placeId', () => {
  const storage = new MemoryStorage();
  const original: TileConfig[] = [
    { id: 'saved-place:home', type: 'saved-place', order: 0, visible: true, placeId: 'home' },
    { id: 'situations', type: 'situation', order: 1, visible: false },
  ];
  saveLayout(original, storage);
  const loaded = loadLayout(storage);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].id, 'saved-place:home');
  assert.equal(loaded[0].placeId, 'home');
  assert.equal(loaded[1].visible, false);
});

test('saveLayout normalizes order numbers by position', () => {
  const storage = new MemoryStorage();
  const messy: TileConfig[] = [
    { id: 'a', type: 'alert', order: 99, visible: true },
    { id: 'b', type: 'situation', order: 12, visible: true },
  ];
  saveLayout(messy, storage);
  const persisted = JSON.parse(storage.raw().get(LAYOUT_KEY) ?? '[]') as TileConfig[];
  // sorted: b(12) then a(99), then renumbered 0/1
  assert.equal(persisted[0].id, 'b');
  assert.equal(persisted[0].order, 0);
  assert.equal(persisted[1].id, 'a');
  assert.equal(persisted[1].order, 1);
});

test('loadLayout: returns [] when nothing is saved', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadLayout(storage), []);
});

test('loadLayout: tolerates malformed JSON without throwing', () => {
  const storage = new MemoryStorage();
  storage.setItem(LAYOUT_KEY, 'not json');
  assert.deepEqual(loadLayout(storage), []);
});

test('loadLayout: drops tiles with invalid type / missing id', () => {
  const storage = new MemoryStorage();
  storage.setItem(LAYOUT_KEY, JSON.stringify([
    { id: 'good', type: 'alert', order: 0, visible: true },
    { id: '', type: 'alert', order: 1, visible: true },
    { id: 'bad-type', type: 'wat', order: 2, visible: true },
    { type: 'alert', order: 3, visible: true },
  ]));
  const loaded = loadLayout(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'good');
});

test('loadLayout: returns [] when localStorage is absent', () => {
  assert.deepEqual(loadLayout(null), []);
});

test('saveLayout: noop when storage is null', () => {
  saveLayout([{ id: 'x', type: 'alert', order: 0, visible: true }], null);
});

test('clearLayout removes the key from storage', () => {
  const storage = new MemoryStorage();
  saveLayout([{ id: 'x', type: 'alert', order: 0, visible: true }], storage);
  assert.notEqual(storage.getItem(LAYOUT_KEY), null);
  clearLayout(storage);
  assert.equal(storage.getItem(LAYOUT_KEY), null);
});

test('reorderLayout: moves tile to new slot and renumbers', () => {
  const layout: TileConfig[] = [
    { id: 'a', type: 'situation', order: 0, visible: true },
    { id: 'b', type: 'alert', order: 1, visible: true },
    { id: 'c', type: 'feed-health', order: 2, visible: true },
  ];
  const next = reorderLayout(layout, 'c', 'a');
  assert.deepEqual(next.map((t) => t.id), ['c', 'a', 'b']);
  assert.deepEqual(next.map((t) => t.order), [0, 1, 2]);
});

test('reorderLayout: drag-onto-self returns identical order', () => {
  const layout: TileConfig[] = [
    { id: 'a', type: 'situation', order: 0, visible: true },
    { id: 'b', type: 'alert', order: 1, visible: true },
  ];
  const next = reorderLayout(layout, 'a', 'a');
  assert.deepEqual(next.map((t) => t.id), ['a', 'b']);
});

test('reorderLayout: unknown tile ids return sorted input unchanged', () => {
  const layout: TileConfig[] = [
    { id: 'a', type: 'situation', order: 0, visible: true },
    { id: 'b', type: 'alert', order: 1, visible: true },
  ];
  const next = reorderLayout(layout, 'missing', 'b');
  assert.deepEqual(next.map((t) => t.id), ['a', 'b']);
});

test('setTileVisibility flips a single tile without mutating siblings', () => {
  const layout: TileConfig[] = [
    { id: 'a', type: 'situation', order: 0, visible: true },
    { id: 'b', type: 'alert', order: 1, visible: true },
  ];
  const next = setTileVisibility(layout, 'b', false);
  assert.equal(next[0].visible, true);
  assert.equal(next[1].visible, false);
  // input untouched
  assert.equal(layout[1].visible, true);
});

test('reconcileLayout: drops tiles for removed places + appends tiles for new places', () => {
  const stored: TileConfig[] = [
    { id: 'saved-place:home', type: 'saved-place', order: 0, visible: true, placeId: 'home' },
    { id: 'saved-place:work', type: 'saved-place', order: 1, visible: true, placeId: 'work' },
    { id: 'situations', type: 'situation', order: 2, visible: true },
  ];
  const reconciled = reconcileLayout(stored, [{ id: 'home' }, { id: 'cabin' }]);
  const ids = reconciled.map((t) => t.id);
  assert.equal(ids.includes('saved-place:home'), true);
  assert.equal(ids.includes('saved-place:work'), false);
  assert.equal(ids.includes('saved-place:cabin'), true);
  assert.equal(ids.includes('situations'), true);
});

test('reconcileLayout: keeps custom tile order when places do not change', () => {
  const stored: TileConfig[] = [
    { id: 'situations', type: 'situation', order: 0, visible: true },
    { id: 'saved-place:home', type: 'saved-place', order: 1, visible: true, placeId: 'home' },
  ];
  const reconciled = reconcileLayout(stored, [{ id: 'home' }]);
  assert.deepEqual(reconciled.map((t) => t.id), ['situations', 'saved-place:home']);
});

test('sortLayout: ties broken by id for stable serialization', () => {
  const layout: TileConfig[] = [
    { id: 'b', type: 'alert', order: 0, visible: true },
    { id: 'a', type: 'situation', order: 0, visible: true },
  ];
  const sorted = sortLayout(layout);
  assert.deepEqual(sorted.map((t) => t.id), ['a', 'b']);
});

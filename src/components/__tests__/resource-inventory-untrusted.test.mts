// R4-SEC-005: a crafted inventory row (stored or imported) can neither run
// script in the main window nor crash the panel. IndexedDB is faked.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../../../tests/panels/register-hook.mjs';
import { happyWindow } from '../../../tests/panels/setup-dom.mts';

// ── Minimal in-memory IndexedDB (only what the panel uses) ───────────────
const rows = new Map<unknown, unknown>();

class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  succeed(value: T): this {
    this.result = value;
    queueMicrotask(() => {
      const event = { type: 'success', target: this };
      for (const fn of this.listeners.get('success') ?? []) fn(event);
      this.onsuccess?.(event);
    });
    return this;
  }
}

const store = {
  getAll: (_query: unknown, count?: number) => new FakeRequest<unknown[]>().succeed([...rows.values()].slice(0, count ?? Infinity).map((r) => structuredClone(r))),
  put: (item: { id: unknown }) => { rows.set(item.id, structuredClone(item)); return new FakeRequest<undefined>().succeed(undefined); },
  delete: (key: unknown) => { rows.delete(key); return new FakeRequest<undefined>().succeed(undefined); },
};
const db = {
  version: 1,
  objectStoreNames: { contains: (name: string) => name === 'items' },
  transaction: () => ({ objectStore: () => store }),
  addEventListener: () => {},
  close: () => {},
};
(globalThis as Record<string, unknown>).indexedDB = { open: () => new FakeRequest<typeof db>().succeed(db) };
// The panel reads imports with FileReader; use happy-dom's (setup-dom does not install it).
(globalThis as Record<string, unknown>).FileReader ??= happyWindow.FileReader;

const { ResourceInventoryPanel } = await import('../ResourceInventoryPanel.ts');

const VALID = { id: 'water-1', name: 'Water', quantity: 20, unit: 'L', dailyRate: 4, category: 'Water', lastUpdated: 1 };
const POISONED = { id: '"><img src=x onerror=window.pwned=1>', name: 'x', quantity: 1, unit: 'u', dailyRate: 1, category: 'c', lastUpdated: 1 };
const CRASHER = { id: 'crash', name: 'Fuel', quantity: 'lots', unit: 'L', dailyRate: 1, category: 'Fuel', lastUpdated: 1 };

const wait = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));

function mount(t: test.TestContext) {
  const panel = new ResourceInventoryPanel();
  document.body.append(panel.getElement());
  t.after(() => panel.destroy());
  return panel;
}

test('poisoned and malformed stored rows are hidden, not executed and not crashing the panel', async (t) => {
  rows.clear();
  for (const row of [VALID, POISONED, CRASHER]) rows.set(row.id, row);
  const panel = mount(t);
  await wait();
  const el = panel.getContentElement();
  assert.equal(el.querySelector('img'), null, 'no injected element');
  assert.equal((happyWindow as unknown as { pwned?: number }).pwned, undefined);
  assert.equal(el.querySelectorAll('tbody tr').length, 1, 'only the valid row renders');
  assert.match(el.textContent ?? '', /Water/);
  assert.match(el.querySelector('.ri-hidden-rows')?.textContent ?? '', /2 stored items are unreadable and hidden/);
  assert.deepEqual([...el.querySelectorAll<HTMLButtonElement>('button[data-id]')].map((b) => b.dataset.id), ['water-1', 'water-1', 'water-1', 'water-1']);

  el.querySelector<HTMLButtonElement>('#riRemoveHiddenBtn')?.click();
  await wait();
  assert.deepEqual([...rows.keys()], ['water-1'], 'Remove deletes exactly the hidden rows');
  assert.equal(panel.getContentElement().querySelector('.ri-hidden-rows'), null);
});

async function importText(panel: InstanceType<typeof ResourceInventoryPanel>, text: string) {
  const input = panel.getContentElement().querySelector<HTMLInputElement>('#riImportFile');
  assert.ok(input);
  const file = new happyWindow.File([text], 'inventory.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new happyWindow.Event('change'));
  await wait(300);
}

test('an import with one crafted row stores nothing and says why', async (t) => {
  rows.clear();
  const panel = mount(t);
  await wait();
  await importText(panel, JSON.stringify([VALID, POISONED]));
  assert.equal(rows.size, 0, 'nothing imported');
  const notice = panel.getContentElement().querySelector('.ri-notice')?.textContent ?? '';
  assert.match(notice, /Import rejected: 1 of 2 items are invalid \(first: item 2, id\)\. Nothing was imported\./);
  assert.equal(panel.getContentElement().querySelector('img'), null);
});

test('a clean import is stored and reported', async (t) => {
  rows.clear();
  const panel = mount(t);
  await wait();
  await importText(panel, JSON.stringify([VALID, { ...VALID, id: 'rice-1', name: 'Rice <b>bulk</b>', unit: 'kg' }]));
  assert.deepEqual([...rows.keys()].sort(), ['rice-1', 'water-1']);
  const el = panel.getContentElement();
  assert.match(el.querySelector('.ri-notice')?.textContent ?? '', /Imported 2 items\./);
  assert.equal(el.querySelector('b'), null, 'names render as text');
  assert.match(el.textContent ?? '', /Rice <b>bulk<\/b>/);
});

test('the edit form escapes every value it echoes', async (t) => {
  rows.clear();
  rows.set('q-1', { ...VALID, id: 'q-1', name: `Tea "' onfocus="x`, unit: '<i>', category: "a'b" });
  const panel = mount(t);
  await wait();
  panel.getContentElement().querySelector<HTMLButtonElement>('.ri-edit-btn')?.click();
  await wait();
  const form = panel.getContentElement().querySelector('form');
  assert.ok(form);
  assert.equal(form.querySelector('i'), null);
  assert.equal(form.querySelector<HTMLInputElement>('input[name="name"]')?.value, `Tea "' onfocus="x`);
  assert.equal(form.querySelector<HTMLInputElement>('input[name="name"]')?.getAttribute('onfocus'), null);
  assert.equal(form.querySelector<HTMLInputElement>('input[name="category"]')?.value, "a'b");
});

test('every attribute and cell is escaped even if validation were bypassed (defense in depth)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../ResourceInventoryPanel.ts', import.meta.url), 'utf8');
  assert.match(source, /const id = escapeHtml\(item\.id\);/);
  assert.equal((source.match(/data-id="\$\{id\}"/g) ?? []).length, 4);
  assert.doesNotMatch(source, /data-id="\$\{item\.id\}"|_esc\(/);
  assert.match(source, /const est = escapeHtml\(formatAmount\(item\.dailyRate\)\);/);
  assert.match(source, /escapeHtml\(formatAmount\(existing\.quantity\)\)/);
  assert.match(source, /escapeHtml\(formatAmount\(existing\.dailyRate\)\)/);
  assert.doesNotMatch(source, /\$\{existing\.(?:quantity|dailyRate)\}/, 'numbers are formatted and escaped');
});

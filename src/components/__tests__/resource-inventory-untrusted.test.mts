// R4-SEC-005: a crafted inventory row (stored or imported) can neither run
// script in the main window nor crash the panel. IndexedDB is faked.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import '../../../tests/panels/register-hook.mjs';
import { happyWindow, POST_MOUNT_ERRORS, getFetchCalls, clearFetchCalls } from '../../../tests/panels/setup-dom.mts';

// Stub only the AI provider before the component/advisor import; context stays real.
register(`data:text/javascript,${encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('/src/services/claude-agent.ts')) return {
    format: 'module', shortCircuit: true,
    source: "export const AGENT_PRESET_QUERIES = []; export const toolLabel = name => name; export async function runClaudeAgent(prompt) { return globalThis.__inventoryFakeAI(prompt); }"
  };
  return nextLoad(url, context);
}`)}`);
const aiPrompts: string[] = [];
(globalThis as Record<string, unknown>).__inventoryFakeAI = async (prompt: string) => {
  aiPrompts.push(prompt);
  return { response: JSON.stringify({ items: [{ priority: 'low', action: 'Test advice', rationale: 'Disposable fixture', category: 'resource-management' }] }) };
};

// A bounded fixture for the exact IDB surface under test: raw value-equal keys,
// staged writes, request success before commit, rollback, and serialized writers.
type Key = string | number | Date | ArrayBuffer | ArrayBufferView | Key[];
function keyParts(key: Key): { rank: number; value: number | string | number[] | Key[] } {
  if (typeof key === 'number' && Number.isFinite(key)) return { rank: 0, value: key };
  if (key instanceof Date && Number.isFinite(key.getTime())) return { rank: 1, value: key.getTime() };
  if (typeof key === 'string') return { rank: 2, value: key };
  if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) {
    const bytes = key instanceof ArrayBuffer ? new Uint8Array(key) : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
    return { rank: 3, value: [...bytes] };
  }
  if (Array.isArray(key) && Array.from({ length: key.length }, (_, index) => index).every(index => index in key && !!keyParts(key[index]!))) return { rank: 4, value: key };
  throw new Error('Invalid fixture IndexedDB key');
}
function compareKeys(left: Key, right: Key): number {
  const a = keyParts(left); const b = keyParts(right);
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (Array.isArray(a.value) && Array.isArray(b.value)) {
    for (let index = 0; index < Math.min(a.value.length, b.value.length); index++) {
      const comparison = a.rank === 4 ? compareKeys(a.value[index] as Key, b.value[index] as Key)
        : Number(a.value[index]) - Number(b.value[index]);
      if (comparison !== 0) return comparison;
    }
    return a.value.length - b.value.length;
  }
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}
class KeyRows {
  private entries: [Key, unknown][] = [];
  get size(): number { return this.entries.length; }
  clear(): void { this.entries = []; }
  set(key: Key, value: unknown): void {
    keyParts(key);
    const index = this.entries.findIndex(([other]) => compareKeys(key, other) === 0);
    const entry: [Key, unknown] = [structuredClone(key), structuredClone(value)];
    if (index < 0) this.entries.push(entry); else this.entries[index] = entry;
  }
  get(key: Key): unknown { return structuredClone(this.entries.find(([other]) => compareKeys(key, other) === 0)?.[1]); }
  delete(key: Key): void { this.entries = this.entries.filter(([other]) => compareKeys(key, other) !== 0); }
  keys(): Key[] { return this.entries.map(([key]) => structuredClone(key)); }
  values(): unknown[] { return this.entries.map(([, value]) => structuredClone(value)); }
  snapshot(): [Key, unknown][] { return structuredClone(this.entries).sort(([a], [b]) => compareKeys(a, b)); }
  clone(): KeyRows { const copy = new KeyRows(); for (const [key, value] of this.entries) copy.set(key, value); return copy; }
  replace(copy: KeyRows): void { this.entries = copy.snapshot(); }
}
const rows = new KeyRows();
class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string): void {
    const event = { type, target: this };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    if (type === 'success') this.onsuccess?.(event); else this.onerror?.(event);
  }
  succeed(value: T): this { this.result = value; queueMicrotask(() => this.emit('success')); return this; }
}
type FailurePlan = { kind: 'request' | 'abort' | 'throw'; after: number; delay?: number };
let nextWrite: FailurePlan | null = null;
let nextReadDelay = 0;
let nextReadFailure = false;
let mutations = 0;
let writerActive = false;
const waitingWriters: (() => void)[] = [];
class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: Error | null = null;
  private pending = 0;
  private started = false;
  private aborted = false;
  private finished = false;
  private staged!: KeyRows;
  private jobs: (() => void)[] = [];
  private writes = 0;
  private issuedWrites = 0;
  private readonly readFailure: boolean;
  private readonly plan: FailurePlan | null;
  private readonly delay: number;
  constructor(private readonly mode: string) {
    this.plan = mode === 'readwrite' ? nextWrite : null;
    this.readFailure = mode !== 'readwrite' && nextReadFailure;
    if (mode !== 'readwrite') nextReadFailure = false;
    this.delay = mode === 'readwrite' ? this.plan?.delay ?? 0 : nextReadDelay;
    if (mode === 'readwrite') nextWrite = null; else nextReadDelay = 0;
    const start = () => {
      if (mode === 'readwrite') writerActive = true;
      this.started = true; this.staged = rows.clone();
      for (const job of this.jobs) queueMicrotask(job);
      this.jobs = [];
      this.maybeComplete();
    };
    if (mode === 'readwrite' && writerActive) waitingWriters.push(start);
    else { if (mode === 'readwrite') writerActive = true; queueMicrotask(start); }
  }
  private release(): void {
    if (this.mode === 'readwrite') { writerActive = false; waitingWriters.shift()?.(); }
  }
  abort(): void {
    if (this.finished || this.aborted) return;
    this.aborted = true; this.error = new Error('Fixture transaction aborted');
    queueMicrotask(() => { this.finished = true; this.onabort?.(); this.release(); });
  }
  private maybeComplete(): void {
    if (!this.started || this.pending || this.aborted || this.finished) return;
    setTimeout(() => {
      if (this.pending || this.aborted || this.finished) return;
      if (this.plan?.kind === 'abort' && this.writes >= this.plan.after) { this.abort(); return; }
      this.finished = true;
      if (this.mode === 'readwrite') rows.replace(this.staged);
      this.oncomplete?.(); this.release();
    }, this.delay);
  }
  private request<T>(read: () => T, write = false): FakeRequest<T> {
    if (write) this.issuedWrites += 1;
    if (write && this.plan?.kind === 'throw' && this.issuedWrites >= this.plan.after) throw new Error('Fixture synchronous failure');
    const req = new FakeRequest<T>(); this.pending += 1;
    const job = () => {
      if (this.aborted) return;
      if (write) { this.writes += 1; mutations += 1; }
      if (write && this.plan?.kind === 'request' && this.writes >= this.plan.after) {
        req.error = new Error('Fixture request failure'); req.emit('error'); this.abort(); return;
      }
      req.result = read(); req.emit('success'); this.pending -= 1; this.maybeComplete();
    };
    if (this.started) queueMicrotask(job); else this.jobs.push(job);
    return req;
  }
  objectStore(): unknown {
    return {
      get: (key: Key) => this.request(() => this.staged.get(key)),
      getAll: (_query: unknown, count: number) => this.request(() => this.staged.snapshot().slice(0, count).map(([, value]) => value)),
      put: (item: { id: Key }) => { const copy = structuredClone(item); return this.request(() => { this.staged.set(copy.id, copy); return copy.id; }, true); },
      delete: (key: Key) => this.request(() => { this.staged.delete(key); return undefined; }, true),
      openCursor: () => {
        let index = 0;
        let entries: [Key, unknown][] | null = null;
        const req = new FakeRequest<unknown>();
        const advance = () => {
          this.pending += 1;
          const job = () => {
            if (this.aborted) return;
            if (this.readFailure) { req.error = new Error('Fixture cursor failure'); req.emit('error'); this.abort(); return; }
            const entry = (entries ??= this.staged.snapshot())[index++];
            req.result = entry ? { primaryKey: entry[0], value: entry[1], continue: advance } : null;
            req.emit('success'); this.pending -= 1; this.maybeComplete();
          };
          if (this.started) queueMicrotask(job); else this.jobs.push(job);
        };
        advance(); return req;
      },
    };
  }
}
const db = {
  version: 1,
  objectStoreNames: { contains: (name: string) => name === 'items' },
  transaction: (_name: string, mode: string) => new FakeTransaction(mode),
  addEventListener: () => {}, close: () => {},
};
(globalThis as Record<string, unknown>).indexedDB = { open: () => new FakeRequest<typeof db>().succeed(db) };
(globalThis as Record<string, unknown>).FileReader = happyWindow.FileReader;
(globalThis as Record<string, unknown>).FormData = happyWindow.FormData;

const { ResourceInventoryPanel } = await import('../ResourceInventoryPanel.ts');
const { generateSurvivalAdvice } = await import('../../services/survival-advisor.ts');
const { validateResourceItem } = await import('../../services/resource-inventory/schema.ts');

const VALID = { id: 'water-1', name: 'Water', quantity: 20, unit: 'L', dailyRate: 4, category: 'Water', lastUpdated: 1 };
const POISONED = { id: '"><img src=x onerror=window.pwned=1>', name: 'x', quantity: 1, unit: 'u', dailyRate: 1, category: 'c', lastUpdated: 1 };
const CRASHER = { id: 'crash', name: 'Fuel', quantity: 'lots', unit: 'L', dailyRate: 1, category: 'Fuel', lastUpdated: 1 };

const wait = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHiddenRows(panel: InstanceType<typeof ResourceInventoryPanel>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!panel.getContentElement().querySelector('.ri-hidden-rows')) {
    assert.ok(Date.now() < deadline, 'inventory hidden-row banner did not render within 3 seconds');
    await wait(10);
  }
}

function mount(t: test.TestContext) {
  const panel = new ResourceInventoryPanel();
  document.body.append(panel.getElement());
  const errorsBefore = POST_MOUNT_ERRORS.length;
  clearFetchCalls();
  t.after(() => {
    panel.destroy(); panel.getElement().remove();
    assert.deepEqual(POST_MOUNT_ERRORS.slice(errorsBefore), [], 'no swallowed async errors');
    assert.deepEqual(getFetchCalls(), [], 'inventory fixtures must not fetch');
  });
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
  input.dispatchEvent(new Event('change'));
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
  assert.match(source, /escapeHtml\(String\(existing\.quantity\)\)/);
  assert.match(source, /escapeHtml\(String\(existing\.dailyRate\)\)/);
  assert.doesNotMatch(source, /\$\{existing\.(?:quantity|dailyRate)\}/, 'numbers are formatted and escaped');
});

// Private access only observes memory / awaits the queue; all mutations use real DOM.
type PanelState = { _items: unknown[]; _load: () => Promise<void>; _tail: Promise<void> };
const state = (panel: InstanceType<typeof ResourceInventoryPanel>) => panel as unknown as PanelState;
const log = (count: number) => Array.from({ length: count }, (_, index) => ({ timestamp: Date.now() - index, amount: index % 2 ? -0.5 : 0.5 }));
const steady = { ...VALID, dailyRate: 0, alertedThresholds: [] };
async function clickAction(panel: InstanceType<typeof ResourceInventoryPanel>, selector: string, input: string | null): Promise<void> {
  const original = globalThis.prompt;
  globalThis.prompt = () => input;
  try {
    const button = panel.getContentElement().querySelector<HTMLButtonElement>(selector);
    assert.ok(button, selector); button.click();
    await state(panel)._tail; await wait();
  } finally { globalThis.prompt = original; }
}
async function editLabel(panel: InstanceType<typeof ResourceInventoryPanel>, name = 'Renamed'): Promise<void> {
  panel.getContentElement().querySelector<HTMLButtonElement>('.ri-edit-btn')?.click(); await wait();
  const form = panel.getContentElement().querySelector<HTMLFormElement>('#riForm'); assert.ok(form);
  const input = form.querySelector<HTMLInputElement>('[name="name"]'); assert.ok(input); input.value = name;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await state(panel)._tail; await wait();
}

test('fake keys compare by IndexedDB value and writes publish only at completion; abort rolls back', async () => {
  rows.clear(); const key: Key = [new Date(7), new Uint8Array([1, 2]).buffer, ['x', 3]];
  rows.set(key, { id: key, name: 'bad' }); assert.equal(rows.size, 1);
  assert.deepEqual(rows.get(structuredClone(key)), { id: key, name: 'bad' });
  nextWrite = { kind: 'abort', after: 1, delay: 30 };
  const tx = db.transaction('items', 'readwrite');
  const aborted = new Promise<void>(resolve => { tx.onabort = resolve; });
  const store = tx.objectStore() as { delete: (key: Key) => FakeRequest<unknown> };
  const req = store.delete(structuredClone(key));
  await new Promise<void>(resolve => { req.onsuccess = () => { assert.equal(rows.size, 1, 'request success is not commit'); resolve(); }; });
  await aborted; assert.equal(rows.size, 1, 'abort preserves raw key and value');
});

for (const selector of ['.ri-use-btn', '.ri-resupply-btn']) {
  test(`${selector}: 9,999 history events accept one; 10,000 reject without changing evidence`, async (t) => {
    rows.clear(); rows.set(steady.id, { ...steady, quantity: 100, dailyRate: 1, consumptionLog: log(9999), alertedThresholds: ['7-day'] });
    const panel = mount(t); await wait();
    await clickAction(panel, selector, '0.0004');
    const accepted = rows.get(steady.id) as typeof steady & { consumptionLog: { timestamp: number; amount: number }[] };
    assert.equal(accepted.consumptionLog.length, 10000);
    assert.equal(accepted.consumptionLog[accepted.consumptionLog.length - 1]?.amount, selector === '.ri-use-btn' ? 0.0004 : -0.0004);
    assert.equal(accepted.quantity, selector === '.ri-use-btn' ? 100 - 0.0004 : 100 + 0.0004);
    assert.equal(panel.getContentElement().querySelectorAll('tbody tr').length, 1);
    assert.ok(validateResourceItem(accepted).ok);
    localStorage.removeItem('wm-survival-advice-v1'); const advice = await generateSurvivalAdvice();
    assert.equal(advice.source, 'ai'); assert.ok(advice.resourceSummary.some(row => row.name === accepted.name));
    const snapshot = structuredClone(accepted); const memory = structuredClone(state(panel)._items); const before = mutations;
    await clickAction(panel, selector, '1');
    assert.deepEqual(rows.get(steady.id), snapshot);
    assert.deepEqual(state(panel)._items, memory, 'rejection preserves live memory');
    assert.equal(mutations, before, 'rejected action does not write');
    assert.match(panel.getContentElement().textContent ?? '', /10,000 history entries/);
  });
  test(`${selector}: invalid full-string inputs never consume or resupply`, async (t) => {
    rows.clear(); rows.set(steady.id, steady); const panel = mount(t); await wait();
    const snapshot = rows.get(steady.id); const before = mutations;
    for (const input of [null, '', ' ', '0', '-1', '1junk', 'NaN', 'Infinity', '1e309', '1000000001']) await clickAction(panel, selector, input);
    assert.deepEqual(rows.get(steady.id), snapshot); assert.equal(mutations, before);
    await clickAction(panel, selector, '1e-6');
    assert.equal((rows.get(steady.id) as typeof steady).quantity, selector === '.ri-use-btn' ? 20 - 1e-6 : 20 + 1e-6);
  });
  for (const kind of ['request', 'abort', 'throw'] as const) {
    test(`${selector}: ${kind} storage failure preserves memory/history and next job recovers`, async (t) => {
      rows.clear(); rows.set(steady.id, { ...steady, consumptionLog: log(2) }); const panel = mount(t); await wait();
      const snapshot = rows.get(steady.id); const memory = structuredClone(state(panel)._items);
      nextWrite = { kind, after: 1 };
      await clickAction(panel, selector, '2');
      assert.deepEqual(rows.get(steady.id), snapshot); assert.deepEqual(state(panel)._items, memory);
      assert.match(panel.getContentElement().textContent ?? '', /Unable to save/);
      await clickAction(panel, selector, '2');
      assert.equal((rows.get(steady.id) as { consumptionLog: unknown[] }).consumptionLog.length, 3);
    });
  }
}

test('resupply overflow rejects; maximum accepted consumption remains schema-valid', async (t) => {
  rows.clear(); rows.set(steady.id, { ...steady, quantity: 1e9 }); const panel = mount(t); await wait();
  const snapshot = rows.get(steady.id); await clickAction(panel, '.ri-resupply-btn', '1'); assert.deepEqual(rows.get(steady.id), snapshot);
  await clickAction(panel, '.ri-use-btn', '1e9'); assert.equal((rows.get(steady.id) as typeof steady).quantity, 0);
});

test('actual name-only submit round-trips precise, tiny, exponent and maximum numbers with evidence intact', async (t) => {
  for (const amount of [0.0004, 1.23456, 1e-15, 1e9]) {
    rows.clear(); rows.set(steady.id, { ...steady, quantity: amount, dailyRate: amount, consumptionLog: [], alertedThresholds: ['1-day'] });
    const panel = mount(t); await wait();
    panel.getContentElement().querySelector<HTMLButtonElement>('.ri-edit-btn')?.click(); await wait();
    const form = panel.getContentElement().querySelector<HTMLFormElement>('#riForm'); assert.ok(form);
    for (const field of ['quantity', 'dailyRate']) assert.equal(form.querySelector<HTMLInputElement>(`[name="${field}"]`)?.value, String(amount));
    form.querySelector<HTMLInputElement>('[name="name"]')!.value = 'Tea <bulk> "quoted"';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await state(panel)._tail; await wait();
    const saved = rows.get(steady.id) as typeof steady;
    assert.equal(saved.quantity, amount); assert.equal(saved.dailyRate, amount);
    assert.deepEqual(saved.alertedThresholds, ['1-day']); assert.equal(panel.getContentElement().querySelector('bulk'), null);
    localStorage.removeItem('wm-survival-advice-v1'); const advice = await generateSurvivalAdvice();
    assert.equal(advice.source, 'ai'); assert.equal(advice.resourceSummary.find(row => row.name === saved.name)?.daysLeft, 1);
    panel.destroy(); panel.getElement().remove();
  }
});

for (const kind of ['request', 'abort', 'throw'] as const) {
  test(`form ${kind} failure retains original row and reports failure`, async (t) => {
    rows.clear(); rows.set(steady.id, steady); const panel = mount(t); await wait(); const snapshot = rows.get(steady.id);
    nextWrite = { kind, after: 1 }; await editLabel(panel);
    assert.deepEqual(rows.get(steady.id), snapshot); assert.equal((state(panel)._items[0] as typeof steady).name, steady.name);
    assert.equal(panel.getContentElement().querySelector<HTMLInputElement>('[name="name"]')?.value, 'Renamed', 'failure retains entered text');
    assert.match(panel.getContentElement().textContent ?? '', /Unable to save/);
  });
  test(`valid import ${kind} failure is atomic for overwritten and new rows`, async (t) => {
    rows.clear(); rows.set(steady.id, steady); const panel = mount(t); await wait(); const snapshot = rows.snapshot();
    nextWrite = { kind, after: 2 };
    await importText(panel, JSON.stringify([{ ...steady, name: 'Changed' }, { ...steady, id: 'new-item' }]));
    assert.deepEqual(rows.snapshot(), snapshot); assert.equal((state(panel)._items[0] as typeof steady).name, steady.name);
    assert.match(panel.getContentElement().textContent ?? '', /Import failed\. Nothing was imported/);
    await importText(panel, JSON.stringify([{ ...steady, id: 'new-item' }])); assert.equal(rows.size, 2);
  });
}

test('serialized actions reread latest storage and retain both events under delayed completion', async (t) => {
  rows.clear(); rows.set(steady.id, steady); const panel = mount(t); await wait();
  rows.set(steady.id, { ...steady, quantity: 40 });
  nextWrite = { kind: 'abort', after: 999, delay: 50 };
  const original = globalThis.prompt; globalThis.prompt = () => '2';
  try { panel.getContentElement().querySelector<HTMLButtonElement>('.ri-use-btn')!.click(); panel.getContentElement().querySelector<HTMLButtonElement>('.ri-use-btn')!.click(); }
  finally { globalThis.prompt = original; }
  await state(panel)._tail; await wait();
  const saved = rows.get(steady.id) as typeof steady & { consumptionLog: unknown[] };
  assert.equal(saved.quantity, 36); assert.equal(saved.consumptionLog.length, 2);
});

test('stale form cannot overwrite a concurrent repaired row', async (t) => {
  rows.clear(); rows.set(steady.id, steady); const panel = mount(t); await wait();
  panel.getContentElement().querySelector<HTMLButtonElement>('.ri-edit-btn')!.click(); await wait();
  rows.set(steady.id, { ...steady, quantity: 77, consumptionLog: log(2) }); const snapshot = rows.get(steady.id);
  const form = panel.getContentElement().querySelector<HTMLFormElement>('#riForm')!;
  form.querySelector<HTMLInputElement>('[name="name"]')!.value = 'Stale'; form.dispatchEvent(new Event('submit', { cancelable: true }));
  await state(panel)._tail; await wait(); assert.deepEqual(rows.get(steady.id), snapshot);
  assert.match(panel.getContentElement().textContent ?? '', /Item changed\. Reopen it before saving/);
});

test('old delayed readonly load cannot replace newer committed action memory', async (t) => {
  rows.clear(); rows.set(steady.id, steady); const panel = mount(t); await wait();
  nextReadDelay = 700; const old = state(panel)._load(); await wait(20);
  await clickAction(panel, '.ri-use-btn', '2'); await old;
  assert.equal((state(panel)._items[0] as typeof steady).quantity, 18);
});

test('all raw legal keys count; Remove keeps repaired and unselected rows', async (t) => {
  rows.clear(); rows.set(steady.id, steady);
  const keys: Key[] = ['bad', 4, new Date(8), new Uint8Array([4, 5]).buffer, [new Date(9), ['nested', 2]]];
  for (const key of keys) rows.set(key, { ...steady, id: key, quantity: 'bad' });
  const panel = mount(t); await wait(); assert.match(panel.getContentElement().textContent ?? '', /5 stored items are unreadable/);
  assert.equal(rows.size, 6, 'loading deletes nothing');
  rows.set('bad', { ...steady, id: 'bad' }); rows.set('later', { ...steady, id: 'later', quantity: 'bad' });
  panel.getContentElement().querySelector<HTMLButtonElement>('#riRemoveHiddenBtn')!.click(); await state(panel)._tail; await wait();
  assert.deepEqual(rows.keys().sort(), ['bad', 'later', steady.id].sort());
  assert.match(panel.getContentElement().textContent ?? '', /1 stored item is unreadable/);
});

test('invalid-only Date/binary/array rows offer Remove and abort preserves all selected evidence', async (t) => {
  rows.clear(); for (const key of [new Date(8), new Uint8Array([4]).buffer, [1, 'nested']] as Key[]) rows.set(key, { id: key });
  const panel = mount(t); await wait(); const snapshot = rows.snapshot(); assert.match(panel.getContentElement().textContent ?? '', /3 stored items are unreadable/);
  nextWrite = { kind: 'abort', after: 2 };
  panel.getContentElement().querySelector<HTMLButtonElement>('#riRemoveHiddenBtn')!.click(); await state(panel)._tail; await wait();
  assert.deepEqual(rows.snapshot(), snapshot); assert.match(panel.getContentElement().textContent ?? '', /Unable to remove/);
  panel.getContentElement().querySelector<HTMLButtonElement>('#riRemoveHiddenBtn')!.click(); await state(panel)._tail; await wait(); assert.equal(rows.size, 0);
});

test('threshold markers dispatch only after committed validated persistence; aborted markers retry', async (t) => {
  rows.clear(); rows.set(VALID.id, { ...VALID, quantity: 4, alertedThresholds: [] });
  const events: unknown[] = []; const listener = (event: Event) => events.push((event as CustomEvent).detail);
  document.addEventListener('wm:resource-alert', listener); t.after(() => document.removeEventListener('wm:resource-alert', listener));
  nextWrite = { kind: 'abort', after: 1, delay: 40 }; const panel = mount(t); await wait();
  assert.equal(events.length, 0); assert.deepEqual((rows.get(VALID.id) as typeof steady).alertedThresholds, []);
  assert.deepEqual((state(panel)._items[0] as typeof steady).alertedThresholds, []);
  await state(panel)._load(); await state(panel)._tail; await wait();
  assert.equal(events.length, 1); assert.deepEqual((rows.get(VALID.id) as typeof steady).alertedThresholds, ['1-day']);
  await state(panel)._load(); await state(panel)._tail; assert.equal(events.length, 1);
});

test('fresh advisor reads only validated rows into summary and fake AI prompt', async (t) => {
  rows.clear(); rows.set(steady.id, { ...steady, quantity: 100, dailyRate: 1 }); rows.set('bad-advisor', { ...steady, id: 'bad-advisor', name: 'UNTRUSTED_SENTINEL', quantity: 'lots' });
  const panel = mount(t); await wait();
  assert.equal(panel.getContentElement().querySelectorAll('tbody tr').length, 1, 'panel shows only the same safe row that advisor reads');
  assert.match(panel.getContentElement().querySelector('.ri-hidden-rows')?.textContent ?? '', /1 stored item is unreadable/);
  aiPrompts.length = 0; localStorage.removeItem('wm-survival-advice-v1');
  const advice = await generateSurvivalAdvice(); assert.equal(advice.source, 'ai');
  assert.deepEqual(advice.resourceSummary.map(item => item.name), ['Water']); assert.equal(aiPrompts.length, 1);
  assert.match(aiPrompts[0]!, /Water/); assert.doesNotMatch(aiPrompts[0]!, /UNTRUSTED_SENTINEL/);
});

test('readonly cursor stops at the existing 5,000 loaded-row boundary without deleting storage', async (t) => {
  rows.clear(); for (let index = 0; index < 5001; index++) rows.set(index, { id: index });
  const panel = mount(t); await waitForHiddenRows(panel); assert.match(panel.getContentElement().textContent ?? '', /5000 stored items are unreadable/);
  assert.equal(rows.size, 5001);
});

for (const kind of ['request', 'throw'] as const) {
  test(`threshold ${kind} failure never dispatches or records delivery`, async (t) => {
    rows.clear(); rows.set(VALID.id, { ...VALID, quantity: 4, alertedThresholds: [] });
    let count = 0; const listener = () => { count += 1; }; document.addEventListener('wm:resource-alert', listener);
    t.after(() => document.removeEventListener('wm:resource-alert', listener));
    nextWrite = { kind, after: 1 }; const panel = mount(t); await wait();
    assert.equal(count, 0); assert.deepEqual((rows.get(VALID.id) as typeof steady).alertedThresholds, []);
    assert.deepEqual((state(panel)._items[0] as typeof steady).alertedThresholds, []);
    assert.match(panel.getContentElement().textContent ?? '', /Unable to save depletion alert/);
    await state(panel)._load(); await state(panel)._tail; await wait(); assert.equal(count, 1);
  });
}

test('threshold event and live marker stay absent until transaction completion', async (t) => {
  rows.clear(); rows.set(VALID.id, { ...VALID, quantity: 4, alertedThresholds: [] });
  let count = 0; const listener = () => { count += 1; }; document.addEventListener('wm:resource-alert', listener);
  t.after(() => document.removeEventListener('wm:resource-alert', listener));
  nextWrite = { kind: 'abort', after: 99, delay: 300 }; const panel = mount(t); await wait(80);
  assert.equal(count, 0); assert.deepEqual((rows.get(VALID.id) as typeof steady).alertedThresholds, []);
  assert.deepEqual((state(panel)._items[0] as typeof steady).alertedThresholds, []);
  await state(panel)._tail; await wait(); assert.equal(count, 1);
});

test('writer entry points independently reject nonfinite and over-bound amounts', async (t) => {
  rows.clear(); rows.set(steady.id, steady); const panel = mount(t); await wait(); const snapshot = rows.get(steady.id);
  const writers = panel as unknown as { _logConsumption: (item: typeof steady, amount: number) => Promise<void>; _resupply: (item: typeof steady, amount: number) => Promise<void> };
  for (const amount of [NaN, Infinity, -1, 0, 1e9 + 1]) {
    await writers._logConsumption(steady, amount); await writers._resupply(steady, amount);
  }
  assert.deepEqual(rows.get(steady.id), snapshot); assert.deepEqual(state(panel)._items, [snapshot]);
});

test('a failed readonly refresh preserves the last safe memory snapshot', async (t) => {
  rows.clear(); rows.set(steady.id, steady); const panel = mount(t); await wait(); const snapshot = structuredClone(state(panel)._items);
  rows.set(steady.id, { ...steady, quantity: 99 }); nextReadFailure = true;
  await state(panel)._load(); await wait(); assert.deepEqual(state(panel)._items, snapshot);
  assert.match(panel.getContentElement().textContent ?? '', /Unable to refresh inventory/);
  await state(panel)._load(); await wait(); assert.equal((state(panel)._items[0] as typeof steady).quantity, 99);
});

test('successful commit followed by failed refresh retains committed state and reports refresh failure', async (t) => {
  rows.clear(); rows.set(steady.id, steady); const panel = mount(t); await wait(); nextReadFailure = true;
  await clickAction(panel, '.ri-use-btn', '2'); assert.equal((rows.get(steady.id) as typeof steady).quantity, 18);
  assert.equal((state(panel)._items[0] as typeof steady).quantity, 18);
  assert.match(panel.getContentElement().textContent ?? '', /Unable to refresh inventory/);
});

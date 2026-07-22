/**
 * Resource Inventory Panel
 *
 * Tracks survival supplies with days-remaining estimates.
 * Data persists via IndexedDB (`crystalball-resources` store).
 *
 * Color coding:
 *  - Green  (>7 days)
 *  - Yellow (3–7 days)
 *  - Red (<3 days)  → triggers Tauri desktop notification
 *  - Black  (depleted)
 *
 * Features:
 *  - Consumption tracking with "Use" button (logs each usage event)
 *  - Actual vs estimated burn-rate comparison
 *  - Depletion countdown with color-coded thresholds
 *  - Depletion alerts via `wm:resource-alert` custom event
 *  - Resupply button for restocking
 *  - Inline SVG sparkline of consumption over last 7 days
 *
 * Supports JSON import/export for offline backup.
 */

import { Panel } from '@/components/Panel';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import { isDesktopRuntime } from '@/services/runtime';

const DB_NAME = 'crystalball-resources';
const STORE_NAME = 'items';

/** Single consumption event logged when user clicks "Use" or "Resupply". */
export interface ConsumptionEvent {
  timestamp: number;  // Unix ms
  amount: number; // positive = consumed, negative = resupplied
}

export interface ResourceItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  dailyRate: number; // consumption per day
  category: string;
  lastUpdated: number; // Unix ms
  /** Consumption log — added in consumption-tracking feature.
 *  Not present on items created before the feature was added. */
  consumptionLog?: ConsumptionEvent[];
  /** Thresholds already alerted for, to avoid duplicate alerts per item. */
  alertedThresholds?: string[];
}

// ── IndexedDB helpers ──────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;
/** Deduplicates concurrent openDB() calls before _db is set.
 *  Without this a burst of getAllItems() calls on first render each start their
 *  own indexedDB.open() probe, racing to set _db and leaking the losers. */
let _dbOpenPromise: Promise<IDBDatabase> | null = null;

function attachConn(conn: IDBDatabase, resolve: (db: IDBDatabase) => void): void {
  _db = conn;
  conn.addEventListener('close', () => { _db = null; });
  // Another opener fires versionchange first — close so the upgrade is not blocked.
  conn.addEventListener('versionchange', () => { conn.close(); _db = null; });
  resolve(conn);
}

function openWithUpgradeRI(currentVersion: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, currentVersion + 1);
    req.addEventListener('error', () => reject(req.error ?? new Error('[resource-db] upgrade failed')));
    req.addEventListener('blocked', () => reject(new Error('[resource-db] upgrade blocked')));
    req.addEventListener('upgradeneeded', () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    });
    req.addEventListener('success', () => attachConn(req.result, resolve));
  });
}

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_dbOpenPromise) return _dbOpenPromise;

  _dbOpenPromise = new Promise((resolve, reject) => {
    // Open without a version first — never request a version lower than what
    // survival-advisor may have already bumped crystalball-resources to.
    const probe = indexedDB.open(DB_NAME);
    probe.addEventListener('error', () => reject(probe.error ?? new Error('[resource-db] probe failed')));
    probe.addEventListener('upgradeneeded', () => {
      if (!probe.result.objectStoreNames.contains(STORE_NAME)) {
        probe.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    });
    probe.addEventListener('success', () => {
      const conn = probe.result;
      if (conn.objectStoreNames.contains(STORE_NAME)) {
        attachConn(conn, resolve);
        return;
      }
      const version = conn.version;
      conn.close();
      openWithUpgradeRI(version).then(resolve, reject);
    });
  });
  // Clear the in-flight promise on rejection so the next openDB() retries.
  _dbOpenPromise.finally(() => { _dbOpenPromise = null; }).catch(() => { /* handled by callers */ });
  return _dbOpenPromise;
}

const MAX_ITEMS = 5000; // hard cap — prevents OOM on runaway imports

async function getAllItems(): Promise<ResourceItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    // Pass undefined as the key query (no filter) and MAX_ITEMS as count cap.
    // IDBObjectStore.getAll(query?, count?) — count prevents unbounded memory load.
    const req = tx.objectStore(STORE_NAME).getAll(undefined, MAX_ITEMS);
    req.onsuccess = () => resolve(req.result as ResourceItem[]);
    req.onerror = () => reject(req.error ?? new Error('[resource-db] getAll failed'));
    tx.addEventListener('error', () => reject(tx.error ?? new Error('[resource-db] getAll tx failed')));
  });
}

async function putItem(item: ResourceItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    // Resolve on tx.oncomplete (durable commit), not req.onsuccess (engine-buffered accept).
    // A browser crash between req.onsuccess and tx.oncomplete would silently lose the write.
    tx.addEventListener('complete', () => resolve());
    tx.addEventListener('error', () => reject(tx.error ?? new Error('[resource-db] put failed')));
    tx.addEventListener('abort', () => reject(new Error('[resource-db] put aborted')));
  });
}

async function deleteItem(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    // Same durability fix: resolve on tx.oncomplete, not req.onsuccess.
    tx.addEventListener('complete', () => resolve());
    tx.addEventListener('error', () => reject(tx.error ?? new Error('[resource-db] delete failed')));
    tx.addEventListener('abort', () => reject(new Error('[resource-db] delete aborted')));
  });
}

// ── Consumption helpers ───────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute actual daily burn rate from logged consumption events.
 * Returns undefined if fewer than 2 days of data.
 */
function actualBurnRate(log: ConsumptionEvent[] | undefined): number | undefined {
  if (!log || log.length === 0) return undefined;
  const consumptions = log.filter(e => e.amount > 0);
  if (consumptions.length === 0) return undefined;

  const earliest = Math.min(...consumptions.map(e => e.timestamp));
  const spanDays = (Date.now() - earliest) / DAY_MS;
  // Need at least ~0.5 day span for a meaningful rate
  if (spanDays < 0.5) return undefined;

  const totalConsumed = consumptions.reduce((s, e) => s + e.amount, 0);
  return totalConsumed / spanDays;
}

/**
 * Effective daily burn rate: actual if enough data, else estimated.
 */
function effectiveBurnRate(item: ResourceItem): number {
  const actual = actualBurnRate(item.consumptionLog);
  if (actual !== undefined && actual > 0) return actual;
  return item.dailyRate;
}

/**
 * Build daily consumption buckets for last 7 days for sparkline.
 * Returns array of 7 numbers (index 0 = 6 days ago, index 6 = today).
 */
function dailyBuckets(log: ConsumptionEvent[] | undefined): number[] {
  const buckets: number[] = [0, 0, 0, 0, 0, 0, 0];
  if (!log) return buckets;
  const now = Date.now();
  for (const e of log) {
 if (e.amount <= 0) continue;
 const daysAgo = Math.floor((now - e.timestamp) / DAY_MS);
 const idx = 6 - daysAgo;
 if (idx >= 0 && idx < buckets.length) {
 const prev = buckets[idx];
 if (prev !== undefined) {
 buckets[idx] = prev + e.amount;
 }
 }
  }
  return buckets;
}

/** SVG sparkline (inline) for 7-day consumption. */
function sparklineSvg(buckets: number[]): string {
  const W = 70;
  const H = 20;
  const max = Math.max(...buckets, 0.001); // avoid div-by-zero
  const points = buckets.map((v, i) => {
 const x = (i / 6) * W;
 const y = H - (v / max) * (H - 2) - 1;
 return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // area fill
  const areaPoints = `0,${H} ${points} ${W},${H}`;
  return `<svg class="ri-sparkline" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
 <polygon points="${areaPoints}" fill="rgba(96,165,250,0.15)" />
 <polyline points="${points}" fill="none" stroke="#60a5fa" stroke-width="1.2" stroke-linejoin="round" />
  </svg>`;
}

// ── Alert thresholds ──────────────────────────────────────────────────────

type DepletionThreshold = 'depleted' | '1-day' | '3-day' | '7-day';

function depletionIcon(days: number): string {
  if (days <= 0) return '\u26AB'; // ⚫
  if (days < 3) return '\uD83D\uDD34'; // 🔴
  if (days <= 7) return '\uD83D\uDFE1'; // 🟡
  return '\uD83D\uDFE2'; // 🟢
}

function depletionClass(days: number): string {
  if (days <= 0) return 'ri-depletion-dead';
  if (days < 3) return 'ri-depletion-crit';
  if (days <= 7) return 'ri-depletion-warn';
  return 'ri-depletion-ok';
}

/** Determine which threshold boundary was crossed (if any, not yet alerted). */
function crossedThreshold(daysLeft: number, alreadyAlerted: string[]): DepletionThreshold | null {
  if (daysLeft <= 0 && !alreadyAlerted.includes('depleted')) return 'depleted';
  if (daysLeft > 0 && daysLeft <= 1 && !alreadyAlerted.includes('1-day')) return '1-day';
  if (daysLeft > 1 && daysLeft <= 3 && !alreadyAlerted.includes('3-day')) return '3-day';
  if (daysLeft > 3 && daysLeft <= 7 && !alreadyAlerted.includes('7-day')) return '7-day';
  return null;
}

// ── Panel ──────────────────────────────────────────────────────────────────

export class ResourceInventoryPanel extends Panel {
  private _items: ResourceItem[] = [];
  private _editingId: string | null = null;

  constructor() {
 super({
 id: 'resource-inventory',
 title: '\uD83C\uDF92 Resource Inventory',
 infoTooltip: 'Track survival supplies. Estimates days remaining based on daily consumption rate. Color-coded: green >7d, yellow 3\u20137d, red <3d. Log consumption and resupply events.',
 });
 void this._load();
  }

  private async _load(): Promise<void> {
 try {
 this._items = await getAllItems();
 this._items.sort((a, b) => this._daysLeft(a) - this._daysLeft(b));
 this._render();
 this._checkDepletionAlerts();
 if (isDesktopRuntime()) void this._notifyLowStock();
 } catch {
 this.showError('Unable to load inventory. Storage may be unavailable.');
 }
  }

  private _daysLeft(item: ResourceItem): number {
 const rate = effectiveBurnRate(item);
 if (rate <= 0) return Infinity;
 return item.quantity / rate;
  }

  private _daysClass(days: number): string {
 if (days <= 0) return 'ri-days-crit';
 if (days === Infinity || days > 7) return 'ri-days-ok';
 if (days >= 3) return 'ri-days-warn';
 return 'ri-days-crit';
  }

  private _daysLabel(days: number): string {
 if (days === Infinity) return '\u221E';
 if (days <= 0) return '0d';
 return `${days.toFixed(1)}d`;
  }

  /** Build the "Actual: X/day (est: Y/day)" label, or just the estimate if no actual data. */
  private _burnRateLabel(item: ResourceItem): string {
 if (item.dailyRate <= 0 && !actualBurnRate(item.consumptionLog)) return '\u2014';

 const actual = actualBurnRate(item.consumptionLog);
 const est = item.dailyRate;
 const unit = this._esc(item.unit);

 if (actual !== undefined && actual > 0 && est > 0) {
 return `<span class="ri-actual-rate">Actual: ${actual.toFixed(1)}${unit}/d <span class="ri-est-rate">(est: ${est}${unit}/d)</span></span>`;
 }
 if (actual !== undefined && actual > 0) {
 return `<span class="ri-actual-rate">${actual.toFixed(1)}${unit}/d</span>`;
 }
 return `${est}/${unit}/d`;
  }

  private _render(): void {
 if (this._editingId !== null) {
 this._renderForm(this._editingId);
 return;
 }

 const rows = this._items.map(item => {
 const days = this._daysLeft(item);
 const cls = this._daysClass(days);
 const dCls = depletionClass(days);
 const icon = depletionIcon(days);
 const buckets = dailyBuckets(item.consumptionLog);
 const hasBucketData = buckets.some(v => v > 0);
 return `
 <tr>
 <td>${this._esc(item.name)}</td>
 <td>${item.quantity.toFixed(1)} ${this._esc(item.unit)}</td>
 <td>${this._burnRateLabel(item)}</td>
 <td class="${cls} ${dCls}"><span title="${days <= 0 ? 'DEPLETED' : days.toFixed(1) + ' days remaining'}">${icon} ${this._daysLabel(days)}</span></td>
 <td>${this._esc(item.category)}</td>
 <td>${hasBucketData ? sparklineSvg(buckets) : ''}</td>
 <td class="ri-actions">
 <button class="ri-use-btn" data-id="${item.id}" title="Log consumption">Use</button>
 <button class="ri-resupply-btn" data-id="${item.id}" title="Add stock">+</button>
 <button class="ri-edit-btn" data-id="${item.id}" title="Edit">\u270F</button>
 <button class="ri-del-btn" data-id="${item.id}" title="Delete">\uD83D\uDDD1</button>
 </td>
 </tr>
 `;
 }).join('');

 const html = `
 <div class="ri-wrap">
 <div class="ri-toolbar">
 <button class="ri-btn ri-btn-add" id="riAddBtn">+ Add Item</button>
 <button class="ri-btn ri-btn-export" id="riExportBtn">Export JSON</button>
 <label class="ri-btn" style="cursor:pointer">
 Import JSON
 <input type="file" accept=".json" id="riImportFile" style="display:none">
 </label>
 </div>
 ${this._items.length === 0
 ? '<div class="ri-empty">No items yet. Add water, food, medication and other supplies.</div>'
 : `<table class="ri-table">
 <thead><tr>
 <th>Item</th><th>Qty</th><th>Rate</th><th>Days</th><th>Category</th><th>7d</th><th></th>
 </tr></thead>
 <tbody>${rows}</tbody>
 </table>`
 }
 </div>
 `;
 this.setContent(html);
 this._attachListeners();
  }

  private _renderForm(id: string | null): void {
 const existing = id ? this._items.find(i => i.id === id) : null;
 const html = `
 <div class="ri-wrap">
 <form id="riForm" class="rdp-inputs">
 <label class="rdp-label">Name
 <input class="rdp-input" style="width:100%" name="name" required value="${existing ? this._esc(existing.name) : ''}">
 </label>
 <label class="rdp-label">Quantity
 <input class="rdp-input" name="quantity" type="number" min="0" step="any" value="${existing ? existing.quantity : ''}">
 </label>
 <label class="rdp-label">Unit (e.g. L, kg, tablets)
 <input class="rdp-input" name="unit" value="${existing ? this._esc(existing.unit) : ''}">
 </label>
 <label class="rdp-label">Daily consumption rate (same unit/day)
 <input class="rdp-input" name="dailyRate" type="number" min="0" step="any" value="${existing ? existing.dailyRate : ''}">
 </label>
 <label class="rdp-label">Category
 <input class="rdp-input" name="category" value="${existing ? this._esc(existing.category) : 'Food'}">
 </label>
 <div style="display:flex;gap:6px;margin-top:4px">
 <button type="submit" class="ri-btn ri-btn-add">Save</button>
 <button type="button" class="ri-btn" id="riCancelBtn">Cancel</button>
 </div>
 </form>
 </div>
 `;
 this.setContent(html);

 const el = this.getContentElement();
 if (!el) return;

 el.querySelector('#riCancelBtn')?.addEventListener('click', () => {
 this._editingId = null;
 this._render();
 });

 el.querySelector<HTMLFormElement>('#riForm')?.addEventListener('submit', (e) => {
 e.preventDefault();
 const form = e.target as HTMLFormElement;
 const data = new FormData(form);
 const item: ResourceItem = {
 id: existing?.id ?? crypto.randomUUID(),
 name: (data.get('name') as string).trim(),
 quantity: Number.parseFloat(data.get('quantity') as string) || 0,
 unit: (data.get('unit') as string).trim() || 'units',
 dailyRate: Number.parseFloat(data.get('dailyRate') as string) || 0,
 category: (data.get('category') as string).trim() || 'Misc',
 lastUpdated: Date.now(),
 // Preserve existing consumption log and alerted thresholds
 consumptionLog: existing?.consumptionLog ?? [],
 alertedThresholds: existing?.alertedThresholds ?? [],
 };
 void putItem(item).then(() => {
 this._editingId = null;
 void this._load();
 });
 });
  }

  private _attachListeners(): void {
 const el = this.getContentElement();
 if (!el) return;

 el.querySelector('#riAddBtn')?.addEventListener('click', () => {
 this._editingId = 'new';
 this._renderForm(null);
 });

 el.querySelector('#riExportBtn')?.addEventListener('click', () => {
 const json = JSON.stringify(this._items, null, 2);
 const blob = new Blob([json], { type: 'application/json' });
 const a = document.createElement('a');
 a.href = URL.createObjectURL(blob);
 a.download = `crystalball-resources-${new Date().toISOString().slice(0, 10)}.json`;
 a.click();
 URL.revokeObjectURL(a.href);
 });

 el.querySelector<HTMLInputElement>('#riImportFile')?.addEventListener('change', (e) => {
 const file = (e.target as HTMLInputElement).files?.[0];
 if (!file) return;
 const reader = new FileReader();
 reader.addEventListener('load', async () => {
 try {
 const parsed = JSON.parse(reader.result as string) as ResourceItem[];
 for (const item of parsed) {
 if (item.id && item.name) await putItem(item);
 }
 void this._load();
 } catch { /* malformed JSON */ }
 });
 reader.readAsText(file);
 });

 el.querySelectorAll<HTMLButtonElement>('.ri-edit-btn').forEach(btn => {
 btn.addEventListener('click', () => {
 this._editingId = btn.dataset.id ?? null;
 this._renderForm(this._editingId);
 });
 });

 el.querySelectorAll<HTMLButtonElement>('.ri-del-btn').forEach(btn => {
 btn.addEventListener('click', () => {
 const id = btn.dataset.id;
 if (id) void deleteItem(id).then(() => void this._load());
 });
 });

 // Use button — log consumption
 el.querySelectorAll<HTMLButtonElement>('.ri-use-btn').forEach(btn => {
 btn.addEventListener('click', () => {
 const id = btn.dataset.id;
 if (!id) return;
 const item = this._items.find(i => i.id === id);
 if (!item) return;

 const defaultAmt = item.dailyRate > 0 ? item.dailyRate : 1;
 const input = prompt(`Consume how much ${item.unit}? (default: ${defaultAmt})`, String(defaultAmt));
 if (input === null) return; // cancelled
 const amount = Number.parseFloat(input) || defaultAmt;
 if (amount <= 0) return;

 void this._logConsumption(item, amount);
 });
 });

 // Resupply button — add stock
 el.querySelectorAll<HTMLButtonElement>('.ri-resupply-btn').forEach(btn => {
 btn.addEventListener('click', () => {
 const id = btn.dataset.id;
 if (!id) return;
 const item = this._items.find(i => i.id === id);
 if (!item) return;

 const input = prompt(`Resupply how much ${item.unit}?`, '');
 if (input === null) return; // cancelled
 const amount = Number.parseFloat(input);
 if (!amount || amount <= 0) return;

 void this._resupply(item, amount);
 });
 });
  }

  /** Log a consumption event: reduce quantity, record in log. */
  private async _logConsumption(item: ResourceItem, amount: number): Promise<void> {
 const log = item.consumptionLog ?? [];
 log.push({ timestamp: Date.now(), amount });
 item.consumptionLog = log;
 item.quantity = Math.max(0, item.quantity - amount);
 item.lastUpdated = Date.now();
 await putItem(item);
 void this._load();
  }

  /** Resupply: add quantity, log a negative consumption event, reset alert thresholds. */
  private async _resupply(item: ResourceItem, amount: number): Promise<void> {
 const log = item.consumptionLog ?? [];
 log.push({ timestamp: Date.now(), amount: -amount }); // negative = resupply
 item.consumptionLog = log;
 item.quantity += amount;
 item.lastUpdated = Date.now();
 // Reset alerted thresholds since stock was replenished
 item.alertedThresholds = [];
 await putItem(item);
 void this._load();
  }

  /** Check each item for threshold crossings and dispatch wm:resource-alert. */
  private _checkDepletionAlerts(): void {
 for (const item of this._items) {
 const days = this._daysLeft(item);
 if (days === Infinity) continue;
 const alerted = item.alertedThresholds ?? [];
 const threshold = crossedThreshold(days, alerted);
 if (!threshold) continue;

 // Record that we alerted for this threshold
 item.alertedThresholds = [...alerted, threshold];
 void putItem(item); // persist (fire-and-forget)

 // Dispatch event for unified alert system
 document.dispatchEvent(new CustomEvent('wm:resource-alert', {
 detail: {
 itemId: item.id,
 name: item.name,
 daysLeft: days,
 quantity: item.quantity,
 unit: item.unit,
 threshold,
 },
 }));
 }
  }

  private async _notifyLowStock(): Promise<void> {
 const low = this._items.filter(i => {
 const d = this._daysLeft(i);
 return d !== Infinity && d < 3;
 });
 if (low.length === 0) return;
 const names = low.slice(0, 3).map(i => i.name).join(', ');
 await tryInvokeTauri<void>('send_notification', {
 title: '\u26A0 Crystal Ball \u2014 Low Stock Alert',
 body: `${low.length} item(s) have <3 days remaining: ${names}`,
 sound: 'Ping',
 }).catch(() => {});
  }

  private _esc(s: string): string {
 return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

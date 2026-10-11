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
 * Supports JSON import/export for offline backup. Imports and stored rows are
 * validated field by field (R4-SEC-005): a crafted file can neither run script
 * in the main window nor crash the panel.
 */

import { notifyNative } from '@/services/native-notify';
import { Panel } from '@/components/Panel';
import { isDesktopRuntime } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';
import {
  MAX_AMOUNT,
  MAX_LOG_ENTRIES,
  MAX_IMPORT_BYTES,
  MAX_LABEL_LENGTH,
  MAX_NAME_LENGTH,
  describeImportResult,
  parseInventoryImport,
  partitionStoredItems,
  validateResourceItem,
  type ConsumptionEvent,
  type DepletionThreshold,
  type ResourceItem,
} from '@/services/resource-inventory/schema';

export type { ConsumptionEvent, ResourceItem } from '@/services/resource-inventory/schema';

const DB_NAME = 'crystalball-resources';
const STORE_NAME = 'items';

// ── IndexedDB helpers ──────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

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

async function openDB(): Promise<IDBDatabase> {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
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
}

const MAX_ITEMS = 5000; // hard cap — prevents OOM on runaway imports

interface StoredRow { primaryKey: IDBValidKey; value: unknown }

/** Capture authoritative keys and values in the same bounded readonly snapshot. */
async function getAllRows(): Promise<StoredRow[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const rows: StoredRow[] = [];
    tx.oncomplete = () => resolve(rows);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Inventory read failed'));
    const req = tx.objectStore(STORE_NAME).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || rows.length >= MAX_ITEMS) return;
      rows.push({ primaryKey: cursor.primaryKey, value: cursor.value });
      if (rows.length < MAX_ITEMS) cursor.continue();
    };
  });
}

/** Complete means committed, even when individual requests succeeded earlier. */
async function writeTransaction<T>(work: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    let result: T;
    let failure: unknown;
    const fail = (error: unknown): void => {
      failure = error;
      try { tx.abort(); } catch { reject(error); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Inventory write failed'));
    try {
      // Catch callback failures too: request callbacks must synchronously enqueue writes.
      const store = tx.objectStore(STORE_NAME);
      work(store, value => { result = value; }, fail);
    } catch (error) { fail(error); }
  });
}

function checkedCandidate(raw: unknown): ResourceItem {
  const checked = validateResourceItem(raw);
  if (!checked.ok) throw new InventoryRejection(`Not saved: the ${checked.field} value is not valid.`);
  return checked.item;
}

async function mutateItem(id: string, build: (current: ResourceItem | null) => ResourceItem | null): Promise<ResourceItem | null> {
  return writeTransaction((store, done, fail) => {
    const req = store.get(id);
    req.onsuccess = () => {
      try {
        const current = req.result === undefined ? null : checkedCandidate(req.result);
        const candidate = build(current);
        if (candidate === null) { done(null); return; }
        const safe = checkedCandidate(candidate);
        store.put(safe);
        done(safe);
      } catch (error) {
        // Rejected candidates abort without ever modifying persisted or live rows.
        fail(error);
      }
    };
  });
}

function actionAmount(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT ? amount : null;
}

const FULL_HISTORY_NOTICE = 'Not saved: this item already has 10,000 history entries. Its quantity and history were left unchanged.';

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
function crossedThreshold(daysLeft: number, alreadyAlerted: readonly DepletionThreshold[]): DepletionThreshold | null {
  if (daysLeft <= 0 && !alreadyAlerted.includes('depleted')) return 'depleted';
  if (daysLeft > 0 && daysLeft <= 1 && !alreadyAlerted.includes('1-day')) return '1-day';
  if (daysLeft > 1 && daysLeft <= 3 && !alreadyAlerted.includes('3-day')) return '3-day';
  if (daysLeft > 3 && daysLeft <= 7 && !alreadyAlerted.includes('7-day')) return '7-day';
  return null;
}

// ── Panel ──────────────────────────────────────────────────────────────────

export class ResourceInventoryPanel extends Panel {
  private _items: ResourceItem[] = [];
  /** IndexedDB keys of stored rows that failed validation (hidden, never rendered). */
  private _hiddenKeys: IDBValidKey[] = [];
  /** Plain-text outcome of the last import (escaped when rendered). */
  private _notice: string | null = null;
  private _editingId: string | null = null;
  private _hiddenCount = 0;
  private _tail: Promise<void> = Promise.resolve();
  private _loadGeneration = 0;
  private _thresholdPending = false;
  private _thresholdAgain = false;
  private _disposed = false;

  public override destroy(): void {
    this._disposed = true;
    this._loadGeneration += 1;
    super.destroy();
  }

  /** Failed jobs are handled locally and never poison subsequent mutations. */
  private _enqueue(job: () => Promise<void>, failure: string): Promise<void> {
    const run = this._tail.then(async () => {
      this._loadGeneration += 1;
      try { await job(); }
      catch (error) {
        if (this._disposed) return;
        this._showNotice(error instanceof InventoryRejection ? error.message : failure);
      }
    });
    this._tail = run.catch(() => {});
    return run;
  }

  private _showNotice(message: string): void {
    this._notice = message;
    const content = this.getContentElement();
    const form = content.querySelector('#riForm');
    if (!form) { this._render(); return; }
    let notice = content.querySelector<HTMLElement>('.ri-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'ri-notice';
      notice.setAttribute('role', 'status');
      form.before(notice);
    }
    notice.textContent = message;
  }

  private _publish(item: ResourceItem): void {
    const index = this._items.findIndex(row => row.id === item.id);
    if (index === -1) this._items.push(item);
    else this._items[index] = item;
  }

  constructor() {
 super({
 id: 'resource-inventory',
 title: '\uD83C\uDF92 Resource Inventory',
 infoTooltip: 'Track survival supplies. Estimates days remaining based on daily consumption rate. Color-coded: green >7d, yellow 3\u20137d, red <3d. Log consumption and resupply events.',
 });
 void this._load();
  }

  private async _load(): Promise<void> {
    const generation = ++this._loadGeneration;
    try {
      const rows = await getAllRows();
      if (this._disposed || generation !== this._loadGeneration) return;
      const { items, invalidCount } = partitionStoredItems(rows.map(row => row.value));
      this._items = items;
      this._hiddenCount = invalidCount;
      this._hiddenKeys = rows.filter(row => !validateResourceItem(row.value).ok).map(row => row.primaryKey);
      this._items.sort((a, b) => this._daysLeft(a) - this._daysLeft(b));
      this._render();
      this._checkDepletionAlerts();
      if (isDesktopRuntime()) void this._notifyLowStock();
    } catch {
      if (this._disposed || generation !== this._loadGeneration) return;
      this._notice = 'Unable to refresh inventory. Storage may be unavailable.';
      this._render();
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
 const est = escapeHtml(formatAmount(item.dailyRate));
 const unit = escapeHtml(item.unit);

 if (actual !== undefined && actual > 0 && item.dailyRate > 0) {
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
 const id = escapeHtml(item.id);
 return `
 <tr>
 <td>${escapeHtml(item.name)}</td>
 <td>${item.quantity.toFixed(1)} ${escapeHtml(item.unit)}</td>
 <td>${this._burnRateLabel(item)}</td>
 <td class="${cls} ${dCls}"><span title="${days <= 0 ? 'DEPLETED' : days.toFixed(1) + ' days remaining'}">${icon} ${this._daysLabel(days)}</span></td>
 <td>${escapeHtml(item.category)}</td>
 <td>${hasBucketData ? sparklineSvg(buckets) : ''}</td>
 <td class="ri-actions">
 <button class="ri-use-btn" data-id="${id}" title="Log consumption">Use</button>
 <button class="ri-resupply-btn" data-id="${id}" title="Add stock">+</button>
 <button class="ri-edit-btn" data-id="${id}" title="Edit">\u270F</button>
 <button class="ri-del-btn" data-id="${id}" title="Delete">\uD83D\uDDD1</button>
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
 ${this._notice ? `<div class="ri-notice" role="status">${escapeHtml(this._notice)}</div>` : ''}
 ${this._hiddenCount > 0 ? `<div class="ri-notice ri-hidden-rows" role="status">${this._hiddenCount} stored item${this._hiddenCount === 1 ? ' is' : 's are'} unreadable and hidden. <button class="ri-btn" id="riRemoveHiddenBtn">Remove them</button></div>` : ''}
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
 // setContent is debounced: wire handlers once the new DOM exists, or
 // they bind to the previous content and every button is dead.
 this.setContent(html, () => this._attachListeners());
  }

  private _renderForm(id: string | null): void {
 const existing = id ? this._items.find(i => i.id === id) : null;
 const html = `
 <div class="ri-wrap">
 ${this._notice ? `<div class="ri-notice" role="status">${escapeHtml(this._notice)}</div>` : ''}
 <form id="riForm" class="rdp-inputs">
 <label class="rdp-label">Name
 <input class="rdp-input" style="width:100%" name="name" required maxlength="${MAX_NAME_LENGTH}" value="${existing ? escapeHtml(existing.name) : ''}">
 </label>
 <label class="rdp-label">Quantity
 <input class="rdp-input" name="quantity" type="number" min="0" step="any" value="${existing ? escapeHtml(String(existing.quantity)) : ''}">
 </label>
 <label class="rdp-label">Unit (e.g. L, kg, tablets)
 <input class="rdp-input" name="unit" maxlength="${MAX_LABEL_LENGTH}" value="${existing ? escapeHtml(existing.unit) : ''}">
 </label>
 <label class="rdp-label">Daily consumption rate (same unit/day)
 <input class="rdp-input" name="dailyRate" type="number" min="0" step="any" value="${existing ? escapeHtml(String(existing.dailyRate)) : ''}">
 </label>
 <label class="rdp-label">Category
 <input class="rdp-input" name="category" maxlength="${MAX_LABEL_LENGTH}" value="${existing ? escapeHtml(existing.category) : 'Food'}">
 </label>
 <div style="display:flex;gap:6px;margin-top:4px">
 <button type="submit" class="ri-btn ri-btn-add">Save</button>
 <button type="button" class="ri-btn" id="riCancelBtn">Cancel</button>
 </div>
 </form>
 </div>
 `;
 this.setContent(html, () => this._attachFormListeners(existing ?? null));
  }

  private _attachFormListeners(existing: ResourceItem | null): void {
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
 quantity: Number(data.get('quantity')),
 unit: (data.get('unit') as string).trim() || 'units',
 dailyRate: Number(data.get('dailyRate')),
 category: (data.get('category') as string).trim() || 'Misc',
 lastUpdated: Date.now(),
 // Preserve existing consumption log and alerted thresholds
 consumptionLog: existing?.consumptionLog ?? [],
 alertedThresholds: existing?.alertedThresholds ?? [],
 };
 // Same rules as imports: what the form saves must render safely later.
 const checked = validateResourceItem(item);
 if (!checked.ok) {
 this._showNotice(`Not saved: the ${checked.field} value is not valid.`);
 return;
 }
 void this._enqueue(async () => {
   const saved = await mutateItem(item.id, current => {
     if (existing ? !current || JSON.stringify(current) !== JSON.stringify(existing) : current !== null) {
       throw new InventoryRejection('Item changed. Reopen it before saving.');
     }
     return { ...checked.item, consumptionLog: current?.consumptionLog ?? [], alertedThresholds: current?.alertedThresholds ?? [] };
   });
   if (saved) this._publish(saved);
   this._editingId = null;
   this._notice = 'Item saved.';
   await this._load();
 }, 'Unable to save inventory. Nothing was changed.');
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
 if (file.size > MAX_IMPORT_BYTES) {
 this._notice = describeImportResult({ ok: false, reason: 'too-large' });
 this._render();
 return;
 }
 const reader = new FileReader();
 reader.addEventListener('load', () => {
 void this._importText(typeof reader.result === 'string' ? reader.result : '');
 });
 reader.readAsText(file);
 });

 el.querySelector('#riRemoveHiddenBtn')?.addEventListener('click', () => {
 void this._removeHidden();
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
 if (id) void this._enqueue(async () => {
   await writeTransaction<void>((store, done) => { store.delete(id); done(); });
   this._items = this._items.filter(item => item.id !== id);
   this._notice = 'Item deleted.';
   await this._load();
 }, 'Unable to delete inventory. Nothing was changed.');
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
 const amount = actionAmount(input);
 if (amount === null) { this._notice = 'Not saved: enter a positive finite amount no greater than 1,000,000,000.'; this._render(); return; }

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
 const amount = actionAmount(input);
 if (amount === null) { this._notice = 'Not saved: enter a positive finite amount no greater than 1,000,000,000.'; this._render(); return; }

 void this._resupply(item, amount);
 });
 });
  }

  /** Validate before starting one atomic transaction; completion precedes success. */
  private async _importText(text: string): Promise<void> {
    const result = parseInventoryImport(text);
    if (!result.ok) { this._notice = describeImportResult(result); this._render(); return; }
    await this._enqueue(async () => {
      await writeTransaction<void>((store, done) => {
        for (const item of result.items) store.put(checkedCandidate(item));
        done();
      });
      for (const item of result.items) this._publish(item);
      this._notice = describeImportResult(result);
      await this._load();
    }, 'Import failed. Nothing was imported.');
  }

  /** Revalidate only keys selected by the explicit click, in the deletion transaction. */
  private async _removeHidden(): Promise<void> {
    const keys = [...this._hiddenKeys];
    await this._enqueue(async () => {
      await writeTransaction<void>((store, done, fail) => {
        for (const key of keys) {
          const req = store.get(key);
          req.onsuccess = () => {
            try {
              if (req.result !== undefined && !validateResourceItem(req.result).ok) store.delete(key);
            } catch (error) { fail(error); }
          };
        }
        done();
      });
      this._notice = 'Unreadable items removed; repaired items were kept.';
      await this._load();
    }, 'Unable to remove unreadable items. Nothing was changed.');
  }

  private async _recordAction(id: string, amount: number, resupply: boolean): Promise<void> {
    await this._enqueue(async () => {
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
        throw new InventoryRejection('Not saved: enter a positive finite amount no greater than 1,000,000,000.');
      }
      const saved = await mutateItem(id, current => {
        if (!current) throw new InventoryRejection('Item changed. Reopen it before saving.');
        if ((current.consumptionLog?.length ?? 0) >= MAX_LOG_ENTRIES) throw new InventoryRejection(FULL_HISTORY_NOTICE);
        const quantity = resupply ? current.quantity + amount : Math.max(0, current.quantity - amount);
        if (!Number.isFinite(quantity) || quantity > MAX_AMOUNT) throw new InventoryRejection('Not saved: the resulting quantity exceeds 1,000,000,000.');
        const now = Date.now();
        return {
          ...current, quantity, lastUpdated: now,
          consumptionLog: [...(current.consumptionLog ?? []), { timestamp: now, amount: resupply ? -amount : amount }],
          alertedThresholds: resupply ? [] : current.alertedThresholds,
        };
      });
      if (saved) this._publish(saved);
      this._notice = resupply ? 'Resupply saved.' : 'Consumption saved.';
      await this._load();
    }, 'Unable to save inventory. Nothing was changed.');
  }

  private _logConsumption(item: ResourceItem, amount: number): Promise<void> {
    return this._recordAction(item.id, amount, false);
  }

  private _resupply(item: ResourceItem, amount: number): Promise<void> {
    return this._recordAction(item.id, amount, true);
  }

  /** Mark and dispatch only committed crossings; do not reload recursively. */
  private _checkDepletionAlerts(): void {
    if (this._disposed) return;
    if (this._thresholdPending) { this._thresholdAgain = true; return; }
    const ids = this._items.filter(item => {
      const days = this._daysLeft(item);
      return days !== Infinity && crossedThreshold(days, item.alertedThresholds ?? []) !== null;
    }).map(item => item.id);
    if (ids.length === 0) return;
    this._thresholdPending = true;
    void this._enqueue(async () => {
      try {
        for (const id of ids) {
          let threshold: DepletionThreshold | null = null;
          const saved = await mutateItem(id, current => {
            if (!current) return null;
            const days = this._daysLeft(current);
            threshold = crossedThreshold(days, current.alertedThresholds ?? []);
            if (days === Infinity || !threshold) return null;
            return { ...current, alertedThresholds: [...(current.alertedThresholds ?? []), threshold] };
          });
          if (!saved || !threshold) continue;
          this._publish(saved);
          if (!this._disposed) document.dispatchEvent(new CustomEvent('wm:resource-alert', {
            detail: { itemId: saved.id, name: saved.name, daysLeft: this._daysLeft(saved), quantity: saved.quantity, unit: saved.unit, threshold },
          }));
        }
        if (!this._disposed) this._render();
      } finally {
        this._thresholdPending = false;
        if (this._thresholdAgain) { this._thresholdAgain = false; this._checkDepletionAlerts(); }
      }
    }, 'Unable to save depletion alert. It will be retried on the next refresh.');
  }

  private async _notifyLowStock(): Promise<void> {
 const low = this._items.filter(i => {
 const d = this._daysLeft(i);
 return d !== Infinity && d < 3;
 });
 if (low.length === 0) return;
 const names = low.slice(0, 3).map(i => i.name).join(', ');
 await notifyNative({
 title: '\u26A0 Crystal Ball \u2014 Low Stock Alert',
 body: `${low.length} item(s) have <3 days remaining: ${names}`,
 sound: 'Ping',
 priority: 'normal',
 });
  }
}

/** Up to 3 decimals, no exponent noise; validated amounts are finite. */
function formatAmount(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

/** Only fixed, user-facing rejections may be displayed; storage exceptions stay private. */
class InventoryRejection extends Error {}

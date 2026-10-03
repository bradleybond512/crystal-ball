/**
 * Resource inventory row validation (R4-SEC-005).
 *
 * Inventory rows reach the main window's HTML and the Survival Advisor's AI
 * prompt, and they can come from an imported JSON file (for example a shared
 * "prepper template"). Nothing from that file or from IndexedDB is trusted:
 * every row is rebuilt field by field from an allowlist, and a row that does
 * not fit is rejected rather than repaired.
 */

export interface ConsumptionEvent {
  timestamp: number; // Unix ms
  amount: number; // positive = consumed, negative = resupplied
}

export const DEPLETION_THRESHOLDS = ['depleted', '1-day', '3-day', '7-day'] as const;
export type DepletionThreshold = (typeof DEPLETION_THRESHOLDS)[number];

export interface ResourceItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  dailyRate: number; // consumption per day
  category: string;
  lastUpdated: number; // Unix ms
  /** Not present on items created before consumption tracking. */
  consumptionLog?: ConsumptionEvent[];
  /** Thresholds already alerted for, to avoid duplicate alerts per item. */
  alertedThresholds?: DepletionThreshold[];
}

export const RESOURCE_ID_RE = /^[\w-]{1,64}$/;
export const MAX_NAME_LENGTH = 120;
export const MAX_LABEL_LENGTH = 40;
export const MAX_AMOUNT = 1e9;
export const MAX_LOG_ENTRIES = 10_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ITEMS = 5000;

const THRESHOLD_SET: ReadonlySet<string> = new Set(DEPLETION_THRESHOLDS);
// C0/C1 controls and bidi overrides: never useful in a label, and a way to
// make a name render differently from what it is.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

export type FieldProblem = 'not-an-object' | 'id' | 'name' | 'quantity' | 'unit' | 'dailyRate' | 'category'
  | 'lastUpdated' | 'consumptionLog' | 'alertedThresholds';

export type ItemResult = { ok: true; item: ResourceItem } | { ok: false; field: FieldProblem };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function label(value: unknown, max: number, fallback?: string): string | null {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') return null;
  const clean = value.replace(CONTROL_CHARS, '').trim();
  if (clean.length === 0) return fallback ?? null;
  return clean.length <= max ? clean : null;
}

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT ? value : null;
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? value : null;
}

function consumptionLog(value: unknown): ConsumptionEvent[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_LOG_ENTRIES) return null;
  const out: ConsumptionEvent[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const ts = timestamp(entry.timestamp);
    const amt = entry.amount;
    if (ts === null || typeof amt !== 'number' || !Number.isFinite(amt) || Math.abs(amt) > MAX_AMOUNT) return null;
    out.push({ timestamp: ts, amount: amt });
  }
  return out;
}

function thresholds(value: unknown): DepletionThreshold[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > DEPLETION_THRESHOLDS.length) return null;
  if (!value.every((t) => typeof t === 'string' && THRESHOLD_SET.has(t))) return null;
  return [...new Set(value as DepletionThreshold[])];
}

/** Rebuild one row from an allowlist; the first failing field is reported. */
export function validateResourceItem(raw: unknown): ItemResult {
  if (!isRecord(raw)) return { ok: false, field: 'not-an-object' };
  if (typeof raw.id !== 'string' || !RESOURCE_ID_RE.test(raw.id)) return { ok: false, field: 'id' };
  const name = label(raw.name, MAX_NAME_LENGTH);
  if (name === null) return { ok: false, field: 'name' };
  const quantity = amount(raw.quantity);
  if (quantity === null) return { ok: false, field: 'quantity' };
  const unit = label(raw.unit, MAX_LABEL_LENGTH, 'units');
  if (unit === null) return { ok: false, field: 'unit' };
  const dailyRate = amount(raw.dailyRate ?? 0);
  if (dailyRate === null) return { ok: false, field: 'dailyRate' };
  const category = label(raw.category, MAX_LABEL_LENGTH, 'Misc');
  if (category === null) return { ok: false, field: 'category' };
  const lastUpdated = timestamp(raw.lastUpdated ?? 0);
  if (lastUpdated === null) return { ok: false, field: 'lastUpdated' };
  const log = consumptionLog(raw.consumptionLog);
  if (log === null) return { ok: false, field: 'consumptionLog' };
  const alerted = thresholds(raw.alertedThresholds);
  if (alerted === null) return { ok: false, field: 'alertedThresholds' };
  return {
    ok: true,
    item: {
      id: raw.id,
      name,
      quantity,
      unit,
      dailyRate,
      category,
      lastUpdated,
      ...(log && { consumptionLog: log }),
      ...(alerted && { alertedThresholds: alerted }),
    },
  };
}

/** Split stored rows into ones safe to show and the ids of ones to hide. */
export function partitionStoredItems(rows: readonly unknown[]): { items: ResourceItem[]; hiddenKeys: unknown[] } {
  const items: ResourceItem[] = [];
  const hiddenKeys: unknown[] = [];
  for (const row of rows) {
    const result = validateResourceItem(row);
    if (result.ok) items.push(result.item);
    // The IndexedDB key is the raw `id`, whatever its type, so the Remove
    // button can delete exactly the hidden rows.
    else hiddenKeys.push(isRecord(row) ? row.id : undefined);
  }
  return { items, hiddenKeys };
}

export type ImportResult =
  | { ok: true; items: ResourceItem[] }
  | { ok: false; reason: 'too-large' | 'not-json' | 'not-a-list' | 'too-many' | 'empty' }
  | { ok: false; reason: 'invalid-items'; invalidCount: number; total: number; firstIndex: number; firstField: FieldProblem }
  | { ok: false; reason: 'duplicate-id'; id: string };

/** Parse an inventory file; any invalid row rejects the whole file (Bradley's decision). */
export function parseInventoryImport(text: string): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, reason: 'too-large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: 'not-a-list' };
  if (parsed.length === 0) return { ok: false, reason: 'empty' };
  if (parsed.length > MAX_IMPORT_ITEMS) return { ok: false, reason: 'too-many' };
  const items: ResourceItem[] = [];
  let invalidCount = 0;
  let firstIndex = -1;
  let firstField: FieldProblem = 'not-an-object';
  for (const [index, raw] of parsed.entries()) {
    const result = validateResourceItem(raw);
    if (result.ok) {
      items.push(result.item);
      continue;
    }
    invalidCount += 1;
    if (firstIndex === -1) {
      firstIndex = index;
      firstField = result.field;
    }
  }
  if (invalidCount > 0) return { ok: false, reason: 'invalid-items', invalidCount, total: parsed.length, firstIndex, firstField };
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) return { ok: false, reason: 'duplicate-id', id: item.id };
    seen.add(item.id);
  }
  return { ok: true, items };
}

/** One plain-text sentence for the import result (escape before putting it in HTML). */
export function describeImportResult(result: ImportResult): string {
  if (result.ok) return `Imported ${result.items.length} item${result.items.length === 1 ? '' : 's'}.`;
  switch (result.reason) {
    case 'too-large': {
      return 'Import rejected: the file is larger than 5 MB.';
    }
    case 'not-json': {
      return 'Import rejected: the file is not valid JSON.';
    }
    case 'not-a-list': {
      return 'Import rejected: expected a list of items.';
    }
    case 'empty': {
      return 'Import rejected: the file has no items.';
    }
    case 'too-many': {
      return `Import rejected: more than ${MAX_IMPORT_ITEMS} items.`;
    }
    case 'duplicate-id': {
      return 'Import rejected: two items share the same id.';
    }
    case 'invalid-items': {
      return `Import rejected: ${result.invalidCount} of ${result.total} items are invalid (first: item ${result.firstIndex + 1}, ${result.firstField}). Nothing was imported.`;
    }
  }
}

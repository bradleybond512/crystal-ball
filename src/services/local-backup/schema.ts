export const STORE_IDS = ['saved-places', 'entity-watchlist', 'webcam-pins'] as const;
export type StoreId = typeof STORE_IDS[number];
export const MAX_PLAINTEXT_BYTES = 1_048_576;
export const MAX_RECORDS = 1000;

export type BackupErrorCode = 'invalid-schema' | 'limit-exceeded' | 'invalid-passphrase' | 'invalid-archive' | 'unsupported-format' | 'authentication-failed' | 'crypto-unavailable';
const ERROR_MESSAGES: Record<BackupErrorCode, string> = {
  'invalid-schema': 'Backup data is invalid.',
  'limit-exceeded': 'Backup limits exceeded.',
  'invalid-passphrase': 'Passphrase does not meet the format requirements.',
  'invalid-archive': 'Backup archive is invalid.',
  'unsupported-format': 'Backup format is unsupported.',
  'authentication-failed': 'Backup authentication failed.',
  'crypto-unavailable': 'Required cryptography is unavailable.',
};
export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'BackupError';
    this.code = code;
  }
}

export interface SavedPlaceRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  tags: string[];
  priority: number;
  notes: string;
  offlinePinned: boolean;
  primary: boolean;
  source: 'manual' | 'gps' | 'search' | 'migrated-proximity';
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
}
export interface EntityWatchlistRecord {
  id: string;
  label: string;
  keywords: string[];
  lat?: number;
  lon?: number;
  radiusKm?: number;
}
export type BackupRecord = SavedPlaceRecord | EntityWatchlistRecord | string;
export type StoreSnapshot =
  | { id: 'saved-places'; schemaVersion: 1; count: number; records: SavedPlaceRecord[] }
  | { id: 'entity-watchlist'; schemaVersion: 1; count: number; records: EntityWatchlistRecord[] }
  | { id: 'webcam-pins'; schemaVersion: 1; count: number; records: string[] };
export interface Backup {
  version: 1;
  createdAtMs: number;
  stores: StoreSnapshot[];
}
export interface DestinationSnapshot { stores: StoreSnapshot[] }

const TAGS = new Set(['home', 'work', 'family', 'bugout', 'travel', 'medical', 'supply', 'concern', 'school', 'shelter', 'critical', 'data_center']);
const SOURCES = new Set(['manual', 'gps', 'search', 'migrated-proximity']);
const SAVED_KEYS = ['createdAt', 'id', 'lat', 'lon', 'name', 'notes', 'offlinePinned', 'primary', 'priority', 'radiusKm', 'sortIndex', 'source', 'tags', 'updatedAt'];
const WATCH_KEYS = ['id', 'keywords', 'label'];
const OPTIONAL_WATCH_KEYS = ['lat', 'lon', 'radiusKm'];

function requireValue(condition: unknown, code: BackupErrorCode = 'invalid-schema'): asserts condition {
  if (!condition) throw new BackupError(code);
}
function bounded<T>(action: () => T, code: BackupErrorCode = 'invalid-schema'): T {
  try { return action(); } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError(code);
  }
}

export function utf8Size(value: string, maxBytes = MAX_PLAINTEXT_BYTES): number {
  requireValue(typeof value === 'string');
  let bytes = 0;
  for (let index = 0; index < value.length;) {
    const point = value.codePointAt(index);
    requireValue(point !== undefined && (point < 0xD8_00 || point > 0xDF_FF));
    let width = 4;
    if (point < 0x80) width = 1;
    else if (point < 0x8_00) width = 2;
    else if (point < 0x1_00_00) width = 3;
    bytes += width;
    index += point > 0xFF_FF ? 2 : 1;
    requireValue(bytes <= maxBytes, 'limit-exceeded');
  }
  return bytes;
}
function text(value: unknown, min: number, max: number): string {
  requireValue(typeof value === 'string');
  requireValue(utf8Size(value, max) >= min);
  return value;
}
function number(value: unknown, min: number, max: number, integer = false): number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0));
  requireValue(value >= min && value <= max && (!integer || Number.isSafeInteger(value)));
  return value;
}
function boolean(value: unknown): boolean {
  requireValue(typeof value === 'boolean');
  return value;
}
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  const prototype: unknown = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null);
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  requireValue(keys.length >= required.length && keys.length <= required.length + optional.length);
  requireValue(keys.every(key => typeof key === 'string' && (required.includes(key) || optional.includes(key))));
  requireValue(required.every(key => Object.prototype.hasOwnProperty.call(fields, key)));
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    requireValue(typeof key === 'string');
    const field = fields[key];
    requireValue(field && Object.prototype.hasOwnProperty.call(field, 'value'));
    result[key] = field.value as unknown;
  }
  return result;
}
function array(value: unknown, maximum: number): unknown[] {
  requireValue(Array.isArray(value));
  requireValue(value.length <= maximum, 'limit-exceeded');
  const keys = Reflect.ownKeys(value);
  requireValue(keys.length === value.length + 1 && Object.getPrototypeOf(value) === Array.prototype);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    requireValue(field && Object.prototype.hasOwnProperty.call(field, 'value'));
    result.push(field.value as unknown);
  }
  return result;
}
function savedPlace(value: unknown): SavedPlaceRecord {
  const row = object(value, SAVED_KEYS);
  const createdAt = number(row.createdAt, 0, Number.MAX_SAFE_INTEGER, true);
  const updatedAt = number(row.updatedAt, createdAt, Number.MAX_SAFE_INTEGER, true);
  const tags = array(row.tags, 12).map(value => text(value, 1, 32));
  requireValue(tags.every(tag => TAGS.has(tag)) && new Set(tags).size === tags.length);
  const source = text(row.source, 1, 32);
  requireValue(SOURCES.has(source));
  return {
    createdAt,
    id: text(row.id, 1, 256),
    lat: number(row.lat, -90, 90),
    lon: number(row.lon, -180, 180),
    name: text(row.name, 0, 512),
    notes: text(row.notes, 0, 8192),
    offlinePinned: boolean(row.offlinePinned),
    primary: boolean(row.primary),
    priority: number(row.priority, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true),
    radiusKm: number(row.radiusKm, 1, 3000, true),
    sortIndex: number(row.sortIndex, 0, Number.MAX_SAFE_INTEGER, true),
    source: source as SavedPlaceRecord['source'],
    tags,
    updatedAt,
  };
}
function watchedEntity(value: unknown): EntityWatchlistRecord {
  const row = object(value, WATCH_KEYS, OPTIONAL_WATCH_KEYS);
  const result: EntityWatchlistRecord = {
    id: text(row.id, 1, 256),
    keywords: array(row.keywords, 64).map(value => text(value, 0, 256)),
    label: text(row.label, 0, 512),
  };
  if (Object.prototype.hasOwnProperty.call(row, 'lat')) result.lat = number(row.lat, -90, 90);
  if (Object.prototype.hasOwnProperty.call(row, 'lon')) result.lon = number(row.lon, -180, 180);
  if (Object.prototype.hasOwnProperty.call(row, 'radiusKm')) result.radiusKm = number(row.radiusKm, 0, Number.MAX_SAFE_INTEGER);
  return result;
}
class EncodingBudget {
  private bytes = 0;
  add(bytes: number): void {
    this.bytes += bytes;
    requireValue(this.bytes <= MAX_PLAINTEXT_BYTES, 'limit-exceeded');
  }
  json(value: unknown): void {
    this.add(utf8Size(JSON.stringify(value)));
  }
}
function store(value: unknown, budget: EncodingBudget): StoreSnapshot {
  const row = object(value, ['id', 'schemaVersion', 'count', 'records']);
  requireValue(row.schemaVersion === 1, 'unsupported-format');
  requireValue(typeof row.id === 'string' && (STORE_IDS as readonly unknown[]).includes(row.id));
  const id = row.id as StoreId;
  const input = array(row.records, MAX_RECORDS);
  const count = number(row.count, 0, MAX_RECORDS, true);
  requireValue(count === input.length);
  budget.json({ count, id, records: [], schemaVersion: 1 });
  budget.add(Math.max(0, input.length - 1));
  const ids = new Set<string>();
  const records: BackupRecord[] = [];
  for (const value of input) {
    let record: BackupRecord;
    if (id === 'saved-places') record = savedPlace(value);
    else if (id === 'entity-watchlist') record = watchedEntity(value);
    else record = text(value, 1, 256);
    const recordId = typeof record === 'string' ? record : record.id;
    requireValue(!ids.has(recordId));
    ids.add(recordId);
    budget.json(record);
    records.push(record);
  }
  if (id === 'saved-places') {
    const places = records as SavedPlaceRecord[];
    requireValue(places.length === 0 || places.filter(record => record.primary).length === 1);
  }
  return { count, id, records, schemaVersion: 1 } as StoreSnapshot;
}
function stores(value: unknown, budget: EncodingBudget, allowEmpty: boolean): StoreSnapshot[] {
  const input = array(value, 3);
  requireValue(allowEmpty || input.length > 0);
  budget.add(Math.max(0, input.length - 1));
  const result: StoreSnapshot[] = [];
  let previous = -1;
  for (const entry of input) {
    const validated = store(entry, budget);
    const position = STORE_IDS.indexOf(validated.id);
    requireValue(position > previous);
    previous = position;
    result.push(validated);
  }
  return result;
}
export function validateBackup(value: unknown): Backup {
  return bounded(() => {
    const row = object(value, ['version', 'createdAtMs', 'stores']);
    requireValue(row.version === 1, 'unsupported-format');
    const createdAtMs = number(row.createdAtMs, 0, Number.MAX_SAFE_INTEGER, true);
    const budget = new EncodingBudget();
    budget.json({ createdAtMs, stores: [], version: 1 });
    return { createdAtMs, stores: stores(row.stores, budget, false), version: 1 };
  });
}
export function encodeBackup(value: unknown): Uint8Array<ArrayBuffer> {
  const validated = validateBackup(value);
  return new TextEncoder().encode(JSON.stringify(validated));
}
export function decodeBackup(bytes: Uint8Array): Backup {
  return bounded(() => {
    requireValue(bytes instanceof Uint8Array, 'invalid-archive');
    requireValue(bytes.byteLength <= MAX_PLAINTEXT_BYTES, 'limit-exceeded');
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const validated = validateBackup(parsed);
    const canonical = new TextEncoder().encode(JSON.stringify(validated));
    requireValue(canonical.length === bytes.length && canonical.every((byte, index) => byte === bytes[index]), 'invalid-archive');
    return validated;
  }, 'invalid-archive');
}
export function validateDestination(value: unknown, selectedIds: readonly StoreId[]): StoreSnapshot[] {
  return bounded(() => {
    const requested = array(selectedIds, 3);
    requireValue(requested.length > 0 && new Set(requested).size === requested.length);
    requireValue(requested.every(value => (STORE_IDS as readonly unknown[]).includes(value)));
    const row = object(value, ['stores']);
    const budget = new EncodingBudget();
    budget.add(2);
    const validated = stores(row.stores, budget, true);
    requireValue(requested.every(id => validated.some(store => store.id === id)));
    return validated.filter(store => requested.includes(store.id));
  });
}

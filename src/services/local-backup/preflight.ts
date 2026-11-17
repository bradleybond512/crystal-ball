import { BackupError, MAX_RECORDS, validateBackup, validateDestination } from './schema';
import type { BackupRecord, SavedPlaceRecord, StoreId, StoreSnapshot } from './schema';

export type RestoreMode = 'merge' | 'replace';
export type RestoreStatus = 'no-op' | 'review' | 'blocked' | 'replacement-authorization-required';
export interface RestoreConflict { kind: 'record-mismatch' | 'primary-selection'; ids: string[] }
export interface StorePreview {
  id: StoreId;
  additions: string[];
  noops: string[];
  removals: string[];
  orderChanged: boolean;
  destinationOrder: string[];
  proposedOrder: string[];
  conflicts: RestoreConflict[];
  proposed: StoreSnapshot | null;
}
export interface RestorePreview {
  readOnly: true;
  writes: 0;
  mode: RestoreMode;
  status: RestoreStatus;
  requiresReplacementAuthorization: boolean;
  destinationFingerprint: string;
  stores: StorePreview[];
}
const FINGERPRINT_DOMAIN = 'crystalball-local-backup-destination-v1\0';
const recordId = (record: BackupRecord): string => typeof record === 'string' ? record : record.id;

function previewStore(incoming: StoreSnapshot, destination: StoreSnapshot, mode: RestoreMode): StorePreview {
  const existing = new Map(destination.records.map(record => [recordId(record), record]));
  const incomingIds = new Set(incoming.records.map(record => recordId(record)));
  const additions: string[] = [], noops: string[] = [], conflicts: RestoreConflict[] = [];
  for (const record of incoming.records) {
    const id = recordId(record);
    const previous = existing.get(id);
    if (previous === undefined) additions.push(id);
    else if (JSON.stringify(previous) === JSON.stringify(record)) noops.push(id);
    else conflicts.push({ kind: 'record-mismatch', ids: [id] });
  }
  const records: BackupRecord[] = mode === 'replace'
    ? [...incoming.records]
    : [...destination.records, ...incoming.records.filter(record => !existing.has(recordId(record)))];
  if (records.length > MAX_RECORDS) throw new BackupError('limit-exceeded');
  if (mode === 'merge' && incoming.id === 'saved-places') {
    const primaries = (records as SavedPlaceRecord[]).filter(record => record.primary).map(record => record.id);
    if (primaries.length > 1) conflicts.push({ kind: 'primary-selection', ids: primaries });
  }
  const destinationOrder = destination.records.map(record => recordId(record));
  const proposedOrder = records.map(record => recordId(record));
  return {
    id: incoming.id,
    additions,
    noops,
    removals: mode === 'replace' ? destinationOrder.filter(id => !incomingIds.has(id)) : [],
    orderChanged: JSON.stringify(destinationOrder) !== JSON.stringify(proposedOrder),
    destinationOrder,
    proposedOrder,
    conflicts,
    proposed: conflicts.length > 0 ? null : { count: records.length, id: incoming.id, records, schemaVersion: 1 } as StoreSnapshot,
  };
}
async function fingerprint(stores: StoreSnapshot[]): Promise<string> {
  const bytes = new TextEncoder().encode(FINGERPRINT_DOMAIN + JSON.stringify(stores));
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== 'function') throw new BackupError('crypto-unavailable');
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    if (digest.length !== 32) throw new BackupError('crypto-unavailable');
    return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { throw new BackupError('crypto-unavailable'); }
}
export async function preflightRestore(backup: unknown, destination: unknown, mode: RestoreMode): Promise<RestorePreview> {
  if (mode !== 'merge' && mode !== 'replace') throw new BackupError('invalid-schema');
  const incoming = validateBackup(backup);
  const selected = validateDestination(destination, incoming.stores.map(store => store.id));
  const previews = incoming.stores.map((store, index) => {
    const current = selected[index];
    if (current?.id !== store.id) throw new BackupError('invalid-schema');
    return previewStore(store, current, mode);
  });
  const blocked = previews.some(preview => preview.conflicts.length > 0);
  if (!blocked) {
    validateBackup({ version: 1, createdAtMs: incoming.createdAtMs, stores: previews.map(preview => preview.proposed) });
  }
  const changed = previews.some(preview => preview.additions.length > 0 || preview.removals.length > 0 || preview.orderChanged);
  const requiresReplacementAuthorization = !blocked && changed && mode === 'replace';
  let status: RestoreStatus = 'no-op';
  if (blocked) status = 'blocked';
  else if (requiresReplacementAuthorization) status = 'replacement-authorization-required';
  else if (changed) status = 'review';
  return {
    readOnly: true,
    writes: 0,
    mode,
    status,
    requiresReplacementAuthorization,
    destinationFingerprint: await fingerprint(selected),
    stores: previews,
  };
}

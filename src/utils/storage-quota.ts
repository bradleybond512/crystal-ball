/**
 * Session-scoped storage-quota state + classifier.
 *
 * Kept in its own dependency-free module (no DOM, no i18n, no barrel) so the
 * quota-safe storage layer and its unit tests can import it under plain Node.
 *
 * localStorage (~5 MB) and IndexedDB (hundreds of MB) have INDEPENDENT quotas,
 * so they get independent latches. Conflating them lets a full localStorage
 * disable otherwise-healthy IndexedDB writes — exactly the failure
 * `setPersistentCache` must avoid when it decides whether to skip IndexedDB.
 */

let _localStorageQuotaExceeded = false;
let _indexedDbQuotaExceeded = false;

/** True once a localStorage write has exhausted quota even after eviction. */
export function isStorageQuotaExceeded(): boolean {
  return _localStorageQuotaExceeded;
}

/** True once an IndexedDB write has thrown QuotaExceededError. */
export function isIndexedDbQuotaExceeded(): boolean {
  return _indexedDbQuotaExceeded;
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'QuotaExceededError';
}

export function markStorageQuotaExceeded(): void {
  _localStorageQuotaExceeded = true;
}

export function markIndexedDbQuotaExceeded(): void {
  _indexedDbQuotaExceeded = true;
}

/** Test-only: clear both session quota latches between cases. */
export function _resetStorageQuotaForTest(): void {
  _localStorageQuotaExceeded = false;
  _indexedDbQuotaExceeded = false;
}

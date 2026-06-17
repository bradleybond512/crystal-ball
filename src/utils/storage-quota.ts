/**
 * Session-scoped localStorage quota state + classifier.
 *
 * Kept in its own dependency-free module (no DOM, no i18n, no barrel) so the
 * quota-safe storage layer and its unit tests can import it under plain Node.
 */

let _storageQuotaExceeded = false;

export function isStorageQuotaExceeded(): boolean {
  return _storageQuotaExceeded;
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'QuotaExceededError';
}

export function markStorageQuotaExceeded(): void {
  _storageQuotaExceeded = true;
}

/** Test-only: clear the session quota latch between cases. */
export function _resetStorageQuotaForTest(): void {
  _storageQuotaExceeded = false;
}

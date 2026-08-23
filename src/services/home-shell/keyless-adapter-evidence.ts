export interface GdeltNewsAdapterEvidence {
  itemCount: number;
}

interface GdeltEventLike {
  title?: unknown;
  url?: unknown;
  source?: unknown;
  tone?: unknown;
  country?: unknown;
  timestamp?: unknown;
}

/**
 * Validate the existing `/api/gdelt-intel` adapter contract before it can
 * contribute first-run freshness. A valid zero-row response remains useful
 * evidence; stale/error/fallback or malformed payloads do not.
 */
export function getGdeltNewsAdapterEvidence(payload: unknown): GdeltNewsAdapterEvidence | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { events?: unknown; updatedAt?: unknown; stale?: unknown; error?: unknown };
  if (!Array.isArray(candidate.events) || candidate.stale === true) return null;
  if (candidate.error !== undefined && candidate.error !== null) return null;
  if (typeof candidate.updatedAt !== 'number'
    || !Number.isFinite(candidate.updatedAt)
    || candidate.updatedAt <= 0) return null;
  const valid = candidate.events.every((event: GdeltEventLike) => (
    event !== null
    && typeof event === 'object'
    && typeof event.title === 'string'
    && typeof event.url === 'string'
    && typeof event.source === 'string'
    && typeof event.tone === 'number'
    && Number.isFinite(event.tone)
    && typeof event.country === 'string'
    && typeof event.timestamp === 'number'
    && Number.isFinite(event.timestamp)
  ));
  return valid ? { itemCount: candidate.events.length } : null;
}

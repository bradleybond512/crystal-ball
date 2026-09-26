export type AlertObservationContext =
  | { kind: 'verified-response'; observedAt: number }
  | { kind: 'replay'; observedAt?: number }
  | { kind: 'unknown' };

export type AlertRetentionEvidence =
  | { kind: 'nws-expiry'; observedAt: number; issuedAt: number; expiresAt: number }
  | { kind: 'gdacs-observation'; observedAt: number };

const SOURCE_AGE_MS = 48 * 60 * 60 * 1000;

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 0 && value <= 8_640_000_000_000_000;
}

export function validateAlertRetentionEvidence(
  source: string, value: unknown, now = Date.now(),
): AlertRetentionEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const evidence = value as Record<string, unknown>;
  if (!validTime(evidence.observedAt) || evidence.observedAt > now) return undefined;
  if (source === 'gdacs' && evidence.kind === 'gdacs-observation') {
    return { kind: 'gdacs-observation', observedAt: evidence.observedAt };
  }
  if (source === 'nws' && evidence.kind === 'nws-expiry'
    && validTime(evidence.issuedAt) && evidence.issuedAt <= evidence.observedAt
    && validTime(evidence.expiresAt) && evidence.expiresAt > evidence.issuedAt) {
    return { kind: 'nws-expiry', observedAt: evidence.observedAt,
      issuedAt: evidence.issuedAt, expiresAt: evidence.expiresAt };
  }
  return undefined;
}

export function mergeAlertRetentionEvidence(
  source: string, previous: unknown, incoming: unknown, materialUnchanged: boolean, now = Date.now(),
): AlertRetentionEvidence | undefined {
  const prior = validateAlertRetentionEvidence(source, previous, now);
  const next = validateAlertRetentionEvidence(source, incoming, now);
  if (!next) return materialUnchanged ? prior : undefined;
  if (!prior) return next;
  if (prior.kind === 'gdacs-observation' && next.kind === 'gdacs-observation') {
    return next.observedAt > prior.observedAt ? next : prior;
  }
  if (prior.kind === 'nws-expiry' && next.kind === 'nws-expiry') {
    return mergeNWSEvidence(prior, next);
  }
  return next;
}

function mergeNWSEvidence(
  prior: Extract<AlertRetentionEvidence, { kind: 'nws-expiry' }>,
  next: Extract<AlertRetentionEvidence, { kind: 'nws-expiry' }>,
): AlertRetentionEvidence {
  if (next.issuedAt !== prior.issuedAt) return next.issuedAt > prior.issuedAt ? next : prior;
  // A conflicting replay cannot establish a new expiry for the same issuance.
  return next.expiresAt === prior.expiresAt && next.observedAt > prior.observedAt ? next : prior;
}

export function shouldRetainAlert(
  alert: { source: string; timestamp: number; pinned: boolean; retentionEvidence?: unknown },
  now = Date.now(),
): boolean {
  if (alert.pinned || now - alert.timestamp <= SOURCE_AGE_MS) return true;
  const evidence = validateAlertRetentionEvidence(alert.source, alert.retentionEvidence, now);
  if (evidence?.kind === 'nws-expiry') return evidence.expiresAt > now;
  return evidence?.kind === 'gdacs-observation' && now - evidence.observedAt <= SOURCE_AGE_MS;
}

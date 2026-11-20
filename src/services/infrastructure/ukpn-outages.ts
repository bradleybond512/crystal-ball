export const UKPN_MAX_PUBLICATION_AGE_MS = 15 * 60_000;

const REASON_CODES = [
  'publication_stale', 'publication_future', 'incomplete_snapshot', 'malformed_response',
  'version_changed', 'rate_limited', 'upstream_unavailable', 'timeout',
] as const;

type UkpnReasonCode = typeof REASON_CODES[number];

export interface UkpnOutageSummary {
  schemaVersion: 1;
  provider: 'ukpn';
  scope: 'ukpn-regional';
  coverage: 'partial';
  state: 'reported' | 'empty' | 'stale' | 'unavailable';
  apiConsistency: 'verified' | 'unverified';
  publishedAt: string | null;
  retrievedAt: string;
  expiresAt: string | null;
  counts: { raw: number; accepted: number; excluded: number; invalid: number };
  exclusions: { restored: number; planned: number; multiple: number; unknown: number };
  incidents: { id: string; customersAffected: number; operatingZone?: string }[];
  reasonCode: UkpnReasonCode | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.length !== 24) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 && new Date(parsed).toISOString() === value ? parsed : null;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100;
}

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 80
    && !/[\u0000-\u001F\u007F]/.test(value);
}

export function unavailableUkpnOutages(
  now = Date.now(),
  reasonCode: UkpnReasonCode = 'upstream_unavailable',
): UkpnOutageSummary {
  return {
    schemaVersion: 1, provider: 'ukpn', scope: 'ukpn-regional', coverage: 'partial',
    state: 'unavailable', apiConsistency: 'unverified',
    publishedAt: null, retrievedAt: new Date(now).toISOString(), expiresAt: null,
    counts: { raw: 0, accepted: 0, excluded: 0, invalid: 0 },
    exclusions: { restored: 0, planned: 0, multiple: 0, unknown: 0 },
    incidents: [], reasonCode,
  };
}

export function ageUkpnOutages(summary: UkpnOutageSummary, now: number): UkpnOutageSummary {
  if (summary.state !== 'reported' && summary.state !== 'empty') return summary;
  const publishedAt = timestamp(summary.publishedAt);
  const expiresAt = timestamp(summary.expiresAt);
  if (publishedAt !== null && expiresAt !== null && publishedAt <= now && now < expiresAt) return summary;
  const future = publishedAt !== null && publishedAt > now;
  return {
    ...unavailableUkpnOutages(now, future ? 'publication_future' : 'publication_stale'),
    state: future ? 'unavailable' : 'stale',
    publishedAt: summary.publishedAt, retrievedAt: summary.retrievedAt, expiresAt: summary.expiresAt,
  };
}

function parseIncidents(rows: unknown[]): UkpnOutageSummary['incidents'] | null {
  const ids = new Set<string>();
  const incidents: UkpnOutageSummary['incidents'] = [];
  for (const incident of rows) {
    if (!isRecord(incident) || !boundedText(incident.id) || ids.has(incident.id)
      || typeof incident.customersAffected !== 'number' || !Number.isSafeInteger(incident.customersAffected)
      || incident.customersAffected < 0
      || (incident.operatingZone !== undefined && !boundedText(incident.operatingZone))) return null;
    ids.add(incident.id);
    incidents.push({
      id: incident.id, customersAffected: incident.customersAffected,
      ...(incident.operatingZone === undefined ? {} : { operatingZone: incident.operatingZone }),
    });
  }
  return incidents;
}

export function parseUkpnOutages(value: unknown, now: number): UkpnOutageSummary {
  const invalid = () => unavailableUkpnOutages(now, 'malformed_response');
  if (!isRecord(value) || value.schemaVersion !== 1 || value.provider !== 'ukpn'
    || value.scope !== 'ukpn-regional' || value.coverage !== 'partial'
    || !isRecord(value.counts) || !isRecord(value.exclusions) || !Array.isArray(value.incidents)) return invalid();
  const { raw, accepted, excluded, invalid: invalidRows } = value.counts;
  const { restored, planned, multiple, unknown } = value.exclusions;
  if (!count(raw) || !count(accepted) || !count(excluded) || !count(invalidRows)
    || !count(restored) || !count(planned) || !count(multiple) || !count(unknown)
    || raw !== accepted + excluded + invalidRows || excluded !== restored + planned + multiple + unknown
    || accepted !== value.incidents.length) return invalid();
  const retrievedAt = timestamp(value.retrievedAt);
  const publishedAt = timestamp(value.publishedAt);
  const expiresAt = timestamp(value.expiresAt);
  if (retrievedAt === null || retrievedAt > now
    || (value.publishedAt !== null && publishedAt === null)
    || (value.expiresAt !== null && expiresAt === null)
    || ((publishedAt === null) !== (expiresAt === null))
    || (publishedAt !== null && expiresAt !== publishedAt + UKPN_MAX_PUBLICATION_AGE_MS)) return invalid();
  const { state, apiConsistency, reasonCode } = value;
  if (state === 'reported' || state === 'empty') {
    if (apiConsistency !== 'verified' || reasonCode !== null || publishedAt === null
      || publishedAt > retrievedAt || (state === 'reported') !== (accepted > 0)) return invalid();
  } else if (state === 'stale' || state === 'unavailable') {
    if (apiConsistency !== 'unverified' || raw !== 0 || typeof reasonCode !== 'string'
      || !REASON_CODES.includes(reasonCode as UkpnReasonCode)
      || (state === 'stale' && (reasonCode !== 'publication_stale' || publishedAt === null
        || publishedAt > now || now < publishedAt + UKPN_MAX_PUBLICATION_AGE_MS))) return invalid();
  } else return invalid();

  const incidents = parseIncidents(value.incidents);
  if (incidents === null) return invalid();
  return ageUkpnOutages({
    schemaVersion: 1, provider: 'ukpn', scope: 'ukpn-regional', coverage: 'partial', state,
    apiConsistency: apiConsistency as UkpnOutageSummary['apiConsistency'],
    publishedAt: value.publishedAt as string | null, retrievedAt: value.retrievedAt as string,
    expiresAt: value.expiresAt as string | null,
    counts: { raw, accepted, excluded, invalid: invalidRows },
    exclusions: { restored, planned, multiple, unknown }, incidents,
    reasonCode: reasonCode as UkpnReasonCode | null,
  }, now);
}

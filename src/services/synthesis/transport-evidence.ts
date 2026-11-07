import { AVIATION_CACHE_MS, SIGMET_HAZARDS } from '../aviation/aviation-intel-types';
import { zoneForPosition } from '../maritime/vessel-classifier';
import {
  computeAviationThreat, computeMaritimeThreat, threatEvidence,
  type AviationGroundStop, type AviationSigmetMinimal,
  type ThreatReceipt,
} from './threat-aggregator';

const AIS_MAX_AGE_MS = 15 * 60_000; // /api/maritime/vessels default position horizon.
const hazards = new Set<string>(SIGMET_HAZARDS);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

interface TimedRow<T> { row: T; until: number }
type TimedReport<T> = { id: string } & TimedRow<T>;

function aviationReceipt<T>(
  body: unknown, source: string, now: number,
  admit: (raw: Record<string, unknown>, cutoff: number) => TimedReport<T> | null,
  score: (rows: T[], at: number) => ReturnType<typeof computeAviationThreat>,
): ThreatReceipt | null {
  if (!record(body) || body.source !== source || typeof body.degraded !== 'boolean' || !Array.isArray(body.data)) return null;
  const at = body.fetchedAt;
  if (!stamp(at) || at > now || at + AVIATION_CACHE_MS <= now) return null;
  const rows = new Map<string, TimedRow<T>>();
  let expiresAtMs = 0;
  for (const raw of body.data) {
    const item = record(raw) ? admit(raw, at + AVIATION_CACHE_MS) : null;
    if (!item || item.until <= now) continue;
    rows.set(item.id, item);
    expiresAtMs = Math.max(expiresAtMs, item.until);
  }
  if (rows.size === 0) return null;
  return {
    evidenceAtMs: at, expiresAtMs, ageKind: 'fetched', scope: 'partial', degraded: body.degraded,
    evaluate: (t) => score([...rows.values()].filter((item) => item.until > t).map((item) => item.row), t),
  };
}

export function sigmetReceipt(body: unknown, now: number): ThreatReceipt | null {
  return aviationReceipt<AviationSigmetMinimal>(body, 'aviationweather.gov', now, (s, cutoff) => {
    if (s.isAirmet !== false || typeof s.id !== 'string' || !s.id.trim()
      || typeof s.hazard !== 'string' || !hazards.has(s.hazard)
      || !stamp(s.validFrom) || s.validFrom > now || !stamp(s.validTo)) return null;
    return { id: s.id, until: Math.min(s.validTo, cutoff), row: { hazard: s.hazard } };
  }, (sigmets, nowMs) => computeAviationThreat({ sigmets, groundStops: [], nowMs }));
}

export function faaReceipt(body: unknown, now: number): ThreatReceipt | null {
  return aviationReceipt<AviationGroundStop>(body, 'nasstatus.faa.gov', now, (s, cutoff) => {
    if (s.programType !== 'ground_stop' || typeof s.airport !== 'string' || !/^[A-Z0-9]{3,4}$/.test(s.airport)
      || (s.startedAt !== null && (!stamp(s.startedAt) || s.startedAt > now))
      || (s.endsAt !== null && !stamp(s.endsAt))) return null;
    return { id: s.airport, until: Math.min(s.endsAt ?? cutoff, cutoff), row: { airport: s.airport } };
  }, (groundStops, nowMs) => computeAviationThreat({ sigmets: [], groundStops, nowMs }));
}

export function aisReceipt(body: unknown, now: number): ThreatReceipt | null {
  if (!record(body) || !Array.isArray(body.vessels)
    || typeof body.sampleSize !== 'number' || !Number.isSafeInteger(body.sampleSize) || body.sampleSize < 1) return null;
  const latest = new Map<string, { at: number; row: { mmsi: string; name?: string } }>();
  let newest = 0;
  for (const v of body.vessels) {
    if (!record(v) || typeof v.mmsi !== 'string' || !/^[2-7]\d{8}$/.test(v.mmsi)
      || typeof v.lat !== 'number' || typeof v.lon !== 'number' || typeof v.zoneId !== 'string'
      || zoneForPosition(v.lat, v.lon)?.id !== v.zoneId
      || !stamp(v.observedAt) || v.observedAt > now || v.observedAt + AIS_MAX_AGE_MS <= now) continue;
    if ((latest.get(v.mmsi)?.at ?? 0) >= v.observedAt) continue;
    const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : undefined;
    latest.set(v.mmsi, { at: v.observedAt, row: { mmsi: v.mmsi, name } });
    newest = Math.max(newest, v.observedAt);
  }
  if (!latest.size) return null;
  const revisionAtMs = typeof body.asOf === 'string' ? Date.parse(body.asOf) : Number.NaN;
  if (!stamp(revisionAtMs) || revisionAtMs < newest || revisionAtMs > now
    || new Date(revisionAtMs).toISOString() !== body.asOf) return null;
  const positions = [...latest.values()].sort((a, b) => b.at - a.at || a.row.mmsi.localeCompare(b.row.mmsi));
  // Sidecar snapshot time orders zone membership changes; only a position report can renew its age.
  const revisionKey = JSON.stringify(positions.map(({ at, row }) => [row.mmsi, at, row.name]));
  return {
    revisionAtMs, revisionKey, snapshotMembership: true,
    evidenceAtMs: newest, expiresAtMs: newest + AIS_MAX_AGE_MS, ageKind: 'received', scope: 'partial',
    evaluate: (nowMs) => computeMaritimeThreat({
      vesselsInRedZone: positions.filter((v) => v.at + AIS_MAX_AGE_MS > nowMs).map((v) => v.row), nowMs,
    }),
  };
}

const transportSources = {
  sigmets: { domain: 'aviation', label: 'AWC SIGMETs', receipt: sigmetReceipt },
  stops: { domain: 'aviation', label: 'FAA ground stops', receipt: faaReceipt },
  vessels: { domain: 'maritime', label: 'Four-zone AIS', receipt: aisReceipt },
} as const;

export async function trackTransportFetch<T>(
  source: keyof typeof transportSources, fetchData: () => Promise<T>, signal: AbortSignal,
): Promise<T> {
  const { domain, label, receipt } = transportSources[source];
  const attempt = threatEvidence.begin(domain, label);
  signal.addEventListener('abort', attempt.cancel, { once: true });
  try {
    const data = await fetchData();
    if (!signal.aborted) {
      const result = receipt(data, Date.now());
      if (result) attempt.report(result);
      else attempt.fail();
    }
    return data;
  } catch (error) {
    if (!signal.aborted) attempt.fail();
    throw error;
  } finally {
    signal.removeEventListener('abort', attempt.cancel);
  }
}

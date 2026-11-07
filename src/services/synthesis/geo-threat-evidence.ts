import type { UsgsFusionSnapshot } from '@/services/earthquake/usgs-fusion-fetch';
import { getProviderDefinition } from '@/services/providers/provider-registry';
import { KP_BIN_MS, type KpVote } from '@/services/spaceweather/kp-fusion-observations';
import { computeSeismicThreat, computeSpaceWeatherThreat, type SeismicQuake, type ThreatReceipt } from './threat-aggregator';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEISMIC_TTL_MS = getProviderDefinition('usgs-earthquakes')!.freshnessTtlMs;
const MAX_RETAINED_QUAKES = 4096;

export class SeismicThreatHistory {
  private quakes = new Map<string, SeismicQuake>();
  private generation = 0;
  private receipt: ThreatReceipt | null = null;

  admit(snapshot: UsgsFusionSnapshot, receivedAtMs: number): ThreatReceipt | null {
    const { generatedAtMs, originNowMs, dashboardEvents } = snapshot;
    if (generatedAtMs < this.generation) return null;
    if (generatedAtMs === this.generation) return this.receipt;
    const cutoff = generatedAtMs - DAY_MS;
    const valid = dashboardEvents.filter((e) => e.time > 0 && e.time >= cutoff && e.time <= generatedAtMs
      && Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180);
    if (valid.length === 0) return null;

    for (const [id, quake] of this.quakes) {
      if (quake.timeMs < cutoff) this.quakes.delete(id);
    }
    for (const event of valid) {
      this.quakes.set(event.id, { timeMs: event.time, magnitude: event.magnitude, place: event.place });
    }
    if (this.quakes.size > MAX_RETAINED_QUAKES) {
      const strongest = [...this.quakes].sort(([, a], [, b]) => b.magnitude - a.magnitude || b.timeMs - a.timeMs);
      this.quakes = new Map(strongest.slice(0, MAX_RETAINED_QUAKES));
    }
    const quakes = [...this.quakes.values()];
    // Date has only second precision. A subsecond negative age already passed the origin skew guard.
    const sourceNow = Math.max(generatedAtMs, originNowMs);
    const evidenceAtMs = receivedAtMs - (sourceNow - generatedAtMs);
    this.generation = generatedAtMs;
    this.receipt = {
      evidenceAtMs, expiresAtMs: evidenceAtMs + SEISMIC_TTL_MS,
      ageKind: 'fetched', scope: 'partial',
      degraded: snapshot.degraded || valid.length < dashboardEvents.length,
      evaluate: (nowMs) => computeSeismicThreat({ quakes, nowMs: sourceNow + (nowMs - receivedAtMs) }),
    };
    return this.receipt;
  }
}

export function kpThreatReceipt(vote: KpVote, nowMs: number, fetchedAtMs?: number): ThreatReceipt | null {
  if (!vote.ok) return null;
  const bins = vote.observations.filter(({ occurredAt }) => occurredAt <= nowMs && occurredAt % KP_BIN_MS === 0);
  if (bins.length === 0) return null;
  const latest = bins.reduce((a, b) => b.occurredAt > a.occurredAt ? b : a, bins[0]!);
  if (bins.some((sample) => sample.occurredAt === latest.occurredAt && sample.value !== latest.value)) return null;
  return {
    evidenceAtMs: latest.occurredAt, expiresAtMs: latest.occurredAt + KP_BIN_MS,
    revisionKey: String(latest.value),
    revisionAtMs: fetchedAtMs !== undefined && Number.isSafeInteger(fetchedAtMs)
      && fetchedAtMs >= latest.occurredAt && fetchedAtMs <= nowMs ? fetchedAtMs : undefined,
    ageKind: 'observed', scope: 'partial',
    evaluate: (t) => computeSpaceWeatherThreat({ kpIndex: latest.value, recentFlareClass: null, nowMs: t }),
  };
}

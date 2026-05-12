/**
 * Alert Trace — "Why did/didn't I get warned?" pipeline tracer.
 *
 * Pure deterministic — no DOM, no fetch, no globals. Given an
 * ObservationEvent + a NotificationSettings snapshot + the user's saved
 * places, replays the six decision stages the notification pipeline runs
 * and records pass/fail/skip + reason per stage. The final outcome is one
 * of `delivered` / `suppressed` / `not-evaluated`.
 *
 * The stage names + order are stable contract — the panel renders them
 * top-to-bottom and the sidecar exposes the same payload over HTTP. Adding
 * a new stage means bumping the SCHEMA_VERSION and updating the panel.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import type {
  NotificationSettings,
  NotificationSeverity,
  NotificationDomain,
  DomainSettings,
} from './notification-settings-service';
import type { SavedPlace } from '@/services/saved-places';
import { haversineKm } from '@/services/proximity-filter';

export const ALERT_TRACE_SCHEMA_VERSION = 1;

export type AlertTraceStageName =
  | 'source-receipt'
  | 'normalization'
  | 'relevance-scoring'
  | 'quiet-hours'
  | 'threshold-check'
  | 'delivery';

export type AlertTraceStageStatus = 'pass' | 'fail' | 'skip';

export type AlertTraceOutcome = 'delivered' | 'suppressed' | 'not-evaluated';

export type AlertTraceChannel = 'push' | 'sms' | 'email' | 'in_app' | 'native';

export interface AlertTraceStage {
  name: AlertTraceStageName;
  status: AlertTraceStageStatus;
  /** One-line plain-English explanation of what happened at this stage. */
  detail: string;
  /** Optional numeric or string artefact (score, distance, threshold…). */
  value?: number | string;
}

export interface AlertTrace {
  eventId: string;
  domain: string;
  severity: ObservationSeverity;
  title: string;
  /** Stages in execution order. */
  stages: AlertTraceStage[];
  outcome: AlertTraceOutcome;
  /** Channels the user would have received this on. Empty when suppressed. */
  channels: AlertTraceChannel[];
  /** Plain-English summary the panel banner uses. */
  summary: string;
  /** ms since epoch the trace was generated. Useful for the sidecar mirror. */
  generatedAt: number;
}

export interface AlertTraceOptions {
  /** Override "now" for deterministic testing. */
  nowMs?: number;
  /** Override the local-time hour used by the quiet-hours stage. Useful
   *  for replaying historical events from a fixed wall clock. */
  hourOverride?: number;
  /** Override the local-time minute. Same rationale as hourOverride. */
  minuteOverride?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const OBS_TO_NOTIFICATION_SEVERITY: Record<ObservationSeverity, NotificationSeverity> = {
  INFO: 'info',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

const SEVERITY_ORDER: NotificationSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

/** Map a raw ObservationEvent.domain string to the NotificationSettings
 *  domain key. Many observation adapters use their own taxonomy (the
 *  `usgs-earthquake` adapter emits domain "seismic", the NWS adapter emits
 *  "weather", etc.) — this map is the single point of truth for which
 *  settings row applies. Unknown domains fall through to a `null` return
 *  so the threshold stage records SKIP + reason. */
const DOMAIN_ALIASES: Record<string, NotificationDomain> = {
  earthquake: 'earthquakes',
  earthquakes: 'earthquakes',
  seismic: 'earthquakes',
  shakealert: 'earthquakes',
  wildfire: 'wildfire',
  fire: 'wildfire',
  aviation: 'aviation',
  air_traffic: 'aviation',
  maritime: 'maritime',
  ais: 'maritime',
  vessel: 'maritime',
  biosurveillance: 'biosurveillance',
  outbreak: 'biosurveillance',
  health: 'biosurveillance',
  space_weather: 'space_weather',
  geomagnetic: 'space_weather',
  solar_flare: 'space_weather',
  infrastructure: 'infrastructure',
  power: 'infrastructure',
  bgp: 'infrastructure',
  geopolitical: 'geopolitical',
  conflict: 'geopolitical',
  acled: 'geopolitical',
  weather: 'weather',
  cap: 'weather',
  cyber: 'cyber',
  vulnerability: 'cyber',
  supply: 'supply',
  shortage: 'supply',
  commodity: 'supply',
};

function classifyDomain(rawDomain: string): NotificationDomain | null {
  const key = rawDomain.toLowerCase();
  return DOMAIN_ALIASES[key] ?? null;
}

function severityIndex(s: NotificationSeverity): number {
  return SEVERITY_ORDER.indexOf(s);
}

function nearestPlaceKm(event: ObservationEvent, places: SavedPlace[]): { km: number; place: SavedPlace } | null {
  if (!event.location || places.length === 0) return null;
  let best: { km: number; place: SavedPlace } | null = null;
  for (const place of places) {
    const km = haversineKm(event.location.lat, event.location.lon, place.lat, place.lon);
    if (!best || km < best.km) best = { km, place };
  }
  return best;
}

function proximityScore(km: number | null): number {
  if (km === null) return 0;
  if (km <= 50) return 50;
  if (km <= 250) return 30;
  if (km <= 1000) return 15;
  return 0;
}

function recencyScore(ageMs: number): number {
  if (ageMs <= 5 * 60_000) return 20;
  if (ageMs <= 30 * 60_000) return 10;
  if (ageMs <= 2 * 60 * 60_000) return 5;
  return 0;
}

function severityScoreFor(s: ObservationSeverity): number {
  switch (s) {
    case 'CRITICAL': { return 30; }
    case 'HIGH': { return 20; }
    case 'MEDIUM': { return 10; }
    case 'LOW': { return 5; }
    default: { return 0; }
  }
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':');
  const hi = Number.parseInt(h ?? '', 10);
  const mi = Number.parseInt(m ?? '', 10);
  return {
    h: Number.isFinite(hi) ? hi : 0,
    m: Number.isFinite(mi) ? mi : 0,
  };
}

function isWithinQuietWindow(currentMinutes: number, start: string, end: string): boolean {
  const s = parseHm(start);
  const e = parseHm(end);
  const startMinutes = s.h * 60 + s.m;
  const endMinutes = e.h * 60 + e.m;
  if (startMinutes === endMinutes) return true;
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

function channelsFor(domainSettings: DomainSettings): AlertTraceChannel[] {
  if (domainSettings.channel === 'in_app') return ['in_app'];
  if (domainSettings.channel === 'native') return ['native'];
  return ['in_app', 'native'];
}

// ── Stage helpers ────────────────────────────────────────────────────────

function stageSourceReceipt(event: ObservationEvent): AlertTraceStage {
  if (!event.id || !event.sourceId) {
    return {
      name: 'source-receipt',
      status: 'fail',
      detail: 'Event missing required id or sourceId — cannot trace upstream provenance.',
    };
  }
  const when = new Date(event.timestamp).toISOString();
  return {
    name: 'source-receipt',
    status: 'pass',
    detail: `Received from "${event.sourceId}" at ${when}.`,
    value: event.sourceId,
  };
}

function stageNormalization(event: ObservationEvent, classified: NotificationDomain | null): AlertTraceStage {
  if (!classified) {
    return {
      name: 'normalization',
      status: 'fail',
      detail: `Domain "${event.domain}" does not map to any notification settings row. Falls through without delivery.`,
      value: event.domain,
    };
  }
  const mapped = OBS_TO_NOTIFICATION_SEVERITY[event.severity];
  return {
    name: 'normalization',
    status: 'pass',
    detail: `Severity ${event.severity} → "${mapped}", domain "${event.domain}" → "${classified}".`,
    value: `${mapped}/${classified}`,
  };
}

function stageRelevanceScoring(
  event: ObservationEvent,
  places: SavedPlace[],
  nowMs: number,
): { stage: AlertTraceStage; score: number; proxKm: number | null } {
  const nearest = nearestPlaceKm(event, places);
  const proxKm = nearest ? nearest.km : null;
  const prox = proximityScore(proxKm);
  const sev = severityScoreFor(event.severity);
  const ageMs = Math.max(0, nowMs - event.timestamp);
  const rec = recencyScore(ageMs);
  const score = Math.min(100, prox + sev + rec);

  const proxStr = proxKm === null
    ? 'no saved-place / no event location'
    : `${proxKm.toFixed(0)}km from ${nearest?.place.name ?? 'nearest place'}`;
  const detail = `proximity ${prox} (${proxStr}) + severity ${sev} + recency ${rec} = ${score}.`;
  return {
    stage: { name: 'relevance-scoring', status: 'pass', detail, value: score },
    score,
    proxKm,
  };
}

function stageQuietHours(
  settings: NotificationSettings,
  domain: NotificationDomain | null,
  severity: NotificationSeverity,
  nowMs: number,
  hourOverride: number | undefined,
  minuteOverride: number | undefined,
): AlertTraceStage {
  if (!domain) {
    return {
      name: 'quiet-hours',
      status: 'skip',
      detail: 'Skipped — no domain classification.',
    };
  }
  const domainSettings = settings.domains[domain];
  if (!domainSettings.quietHoursEnabled) {
    return {
      name: 'quiet-hours',
      status: 'pass',
      detail: `Quiet hours disabled for "${domain}".`,
    };
  }
  if (severity === 'critical') {
    return {
      name: 'quiet-hours',
      status: 'pass',
      detail: 'Critical severity always bypasses quiet hours.',
    };
  }
  const now = new Date(nowMs);
  const hour = hourOverride ?? now.getHours();
  const minute = minuteOverride ?? now.getMinutes();
  const currentMinutes = hour * 60 + minute;
  const inQuiet = isWithinQuietWindow(currentMinutes, settings.global.quietHoursStart, settings.global.quietHoursEnd);
  if (inQuiet) {
    return {
      name: 'quiet-hours',
      status: 'fail',
      detail: `Currently ${pad2(hour)}:${pad2(minute)} — inside quiet window ${settings.global.quietHoursStart}–${settings.global.quietHoursEnd}.`,
      value: `${pad2(hour)}:${pad2(minute)}`,
    };
  }
  return {
    name: 'quiet-hours',
    status: 'pass',
    detail: `Currently ${pad2(hour)}:${pad2(minute)} — outside quiet window ${settings.global.quietHoursStart}–${settings.global.quietHoursEnd}.`,
    value: `${pad2(hour)}:${pad2(minute)}`,
  };
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function stageThreshold(
  settings: NotificationSettings,
  domain: NotificationDomain | null,
  severity: NotificationSeverity,
): AlertTraceStage {
  if (!domain) {
    return {
      name: 'threshold-check',
      status: 'skip',
      detail: 'Skipped — no domain classification.',
    };
  }
  if (settings.global.masterMute) {
    return {
      name: 'threshold-check',
      status: 'fail',
      detail: 'Master mute is on — every domain is suppressed regardless of threshold.',
    };
  }
  const domainSettings = settings.domains[domain];
  if (!domainSettings.enabled) {
    return {
      name: 'threshold-check',
      status: 'fail',
      detail: `Domain "${domain}" is disabled.`,
    };
  }
  const want = severityIndex(severity);
  const need = severityIndex(domainSettings.threshold);
  if (want < need) {
    return {
      name: 'threshold-check',
      status: 'fail',
      detail: `Severity "${severity}" is below configured threshold "${domainSettings.threshold}".`,
      value: `${severity} < ${domainSettings.threshold}`,
    };
  }
  return {
    name: 'threshold-check',
    status: 'pass',
    detail: `Severity "${severity}" meets configured threshold "${domainSettings.threshold}".`,
    value: `${severity} ≥ ${domainSettings.threshold}`,
  };
}

function stageDelivery(
  earlierStages: AlertTraceStage[],
  domain: NotificationDomain | null,
  settings: NotificationSettings,
): { stage: AlertTraceStage; channels: AlertTraceChannel[] } {
  const blocker = earlierStages.find((s) => s.status === 'fail');
  if (blocker) {
    return {
      stage: {
        name: 'delivery',
        status: 'skip',
        detail: `Suppressed at "${blocker.name}" stage — no channels invoked.`,
      },
      channels: [],
    };
  }
  if (!domain) {
    return {
      stage: { name: 'delivery', status: 'skip', detail: 'No domain — delivery skipped.' },
      channels: [],
    };
  }
  const channels = channelsFor(settings.domains[domain]);
  return {
    stage: {
      name: 'delivery',
      status: 'pass',
      detail: `Delivered via [${channels.join(', ')}].`,
      value: channels.join(','),
    },
    channels,
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Run an event through the six-stage notification pipeline and produce a
 * deterministic trace. The trace is intentionally cheap — every stage is
 * pure computation and no settings are mutated. Safe to call on the UI
 * thread without throttling.
 */
export function traceAlert(
  event: ObservationEvent,
  settings: NotificationSettings,
  savedPlaces: SavedPlace[],
  options: AlertTraceOptions = {},
): AlertTrace {
  const nowMs = options.nowMs ?? Date.now();
  const stages: AlertTraceStage[] = [];

  const classified = classifyDomain(event.domain);
  const notificationSeverity = OBS_TO_NOTIFICATION_SEVERITY[event.severity];

  const s1 = stageSourceReceipt(event);
  const s2 = stageNormalization(event, classified);
  const { stage: s3 } = stageRelevanceScoring(event, savedPlaces, nowMs);
  const s4 = stageQuietHours(
    settings,
    classified,
    notificationSeverity,
    nowMs,
    options.hourOverride,
    options.minuteOverride,
  );
  const s5 = stageThreshold(settings, classified, notificationSeverity);
  stages.push(s1, s2, s3, s4, s5);

  const { stage: s6, channels } = stageDelivery(stages, classified, settings);
  stages.push(s6);

  const outcome = computeOutcome(s1.status, s6.status);

  return {
    eventId: event.id,
    domain: event.domain,
    severity: event.severity,
    title: event.title,
    stages,
    outcome,
    channels,
    summary: buildSummary(stages, outcome, channels),
    generatedAt: nowMs,
  };
}

function computeOutcome(
  sourceReceiptStatus: AlertTraceStageStatus,
  deliveryStatus: AlertTraceStageStatus,
): AlertTraceOutcome {
  if (sourceReceiptStatus === 'fail') return 'not-evaluated';
  if (deliveryStatus === 'pass') return 'delivered';
  return 'suppressed';
}

function buildSummary(
  stages: AlertTraceStage[],
  outcome: AlertTraceOutcome,
  channels: AlertTraceChannel[],
): string {
  if (outcome === 'delivered') {
    return `Delivered via ${channels.join(' + ')}.`;
  }
  if (outcome === 'not-evaluated') {
    return 'Event missing required identifiers — pipeline did not evaluate.';
  }
  const blocker = stages.find((s) => s.status === 'fail');
  if (!blocker) return 'Suppressed (reason unknown).';
  return `Suppressed at "${blocker.name}" — ${blocker.detail}`;
}

/** Exposed for the panel + sidecar so they can label/dedupe stages. */
export const STAGE_ORDER: AlertTraceStageName[] = [
  'source-receipt',
  'normalization',
  'relevance-scoring',
  'quiet-hours',
  'threshold-check',
  'delivery',
];

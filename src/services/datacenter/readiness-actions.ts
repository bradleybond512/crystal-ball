import type { DcLevel, PowerPosture, ReadinessAction, WeatherPosture, ActionUrgency, ActionAudience } from './datacenter-types.ts';
import { dcLevelRank } from './datacenter-types.ts';
import type { WeatherHazardKind } from '../weather/weather-threat-types.ts';

export interface ReadinessContext {
  now: number;
  overall: DcLevel;
}

const AUDIENCE_RANK: Record<ActionAudience, number> = {
  onsite_safety: 0, commute_staffing: 1, facility_ops: 2, escalation: 3,
};
const URGENCY_RANK: Record<ActionUrgency, number> = {
  now: 0, soon: 1, be_ready: 2, monitor: 3,
};

const SAFETY_NOW_HAZARDS = new Set<WeatherHazardKind>(['tornado', 'high_wind', 'tropical', 'storm_surge']);
const OUTDOOR_STOP_HAZARDS = new Set<WeatherHazardKind>(['severe_thunderstorm', 'flash_flood', 'fire_weather', 'dust_storm']);
const COMMUTE_HAZARDS = new Set<WeatherHazardKind>(['ice_storm', 'winter_storm', 'blizzard', 'flood', 'flash_flood']);

function urgencyForArrival(mins: number | null): ActionUrgency {
  if (mins === null) return 'be_ready';
  if (mins <= 20) return 'now';
  if (mins <= 60) return 'soon';
  return 'be_ready';
}

export function buildReadinessActions(
  power: PowerPosture,
  weather: WeatherPosture,
  ctx: ReadinessContext,
): ReadinessAction[] {
  const out: ReadinessAction[] = [];
  const arrival = weather.arrivalWindowMins;
  const arrivalTrigger = arrival === null ? '' : `, ETA ${arrival} min`;

  // On-site personal safety
  if (weather.activeHazards.some((h) => SAFETY_NOW_HAZARDS.has(h))) {
    out.push({
      id: 'safety-shelter',
      audience: 'onsite_safety',
      urgency: 'now',
      title: 'Move staff to interior shelter, away from windows',
      detail: 'Destructive-wind or tornado threat over the site.',
      trigger: `${weather.activeHazards.find((h) => SAFETY_NOW_HAZARDS.has(h))} warning polygon${arrivalTrigger}`,
      expiresAt: null,
    });
  }
  if (weather.activeHazards.some((h) => OUTDOOR_STOP_HAZARDS.has(h))) {
    out.push({
      id: 'safety-outdoor-stop',
      audience: 'onsite_safety',
      urgency: urgencyForArrival(arrival),
      title: 'Stop all rooftop and outdoor work',
      detail: 'Lightning / severe weather risk to anyone working outside.',
      trigger: `${weather.activeHazards.find((h) => OUTDOOR_STOP_HAZARDS.has(h))} threat near the site${arrivalTrigger}`,
      expiresAt: null,
    });
  }

  // Commute & staffing
  if (weather.activeHazards.some((h) => COMMUTE_HAZARDS.has(h))) {
    out.push({
      id: 'staffing-travel',
      audience: 'commute_staffing',
      urgency: urgencyForArrival(arrival),
      title: 'Hold incoming shift / delay non-essential travel',
      detail: 'Ice, snow, or flooding will make the commute hazardous.',
      trigger: `${weather.activeHazards.find((h) => COMMUTE_HAZARDS.has(h))} in the area${arrivalTrigger}`,
      expiresAt: null,
    });
  }

  // Facility ops readiness
  if (weather.activeHazards.includes('extreme_heat')) {
    out.push({
      id: 'ops-precool',
      audience: 'facility_ops',
      urgency: 'be_ready',
      title: 'Pre-cool / verify HVAC headroom ahead of peak cooling load',
      detail: 'Active heat alert will push cooling demand up.',
      trigger: 'Heat alert over the site',
      expiresAt: null,
    });
  }
  const multiDaySevere = weather.activeHazards.some((h) => ['winter_storm', 'blizzard', 'ice_storm', 'tropical'].includes(h));
  if (dcLevelRank(power.level) >= dcLevelRank('advisory') || multiDaySevere) {
    out.push({
      id: 'ops-fuel',
      audience: 'facility_ops',
      urgency: 'soon',
      title: 'Confirm generator fuel; schedule refuel before the window',
      detail: power.drivers[0] ?? 'Sustained grid stress or a multi-day severe event.',
      trigger: power.drivers[0] ?? 'Multi-day severe weather window',
      expiresAt: null,
    });
  }
  if (power.gridAlerts.some((a) => a.severity === 'emergency')) {
    out.push({
      id: 'ops-transfer',
      audience: 'facility_ops',
      urgency: 'soon',
      title: 'Verify clean transfer to backup is ready',
      detail: 'A grid emergency alert is active for the region.',
      trigger: 'Grid emergency alert',
      expiresAt: null,
    });
  }

  // Escalation (only when overall >= warning)
  if (dcLevelRank(ctx.overall) >= dcLevelRank('warning')) {
    out.push({
      id: 'escalation-notify',
      audience: 'escalation',
      urgency: 'now',
      title: 'Notify facilities manager / on-call now',
      detail: 'Combined posture has reached warning — get a human in the loop.',
      trigger: `Overall posture: ${ctx.overall}`,
      expiresAt: null,
    });
  }

  return sortActions(out);
}

function sortActions(actions: ReadinessAction[]): ReadinessAction[] {
  return [...actions].sort((a, b) => {
    if (URGENCY_RANK[a.urgency] !== URGENCY_RANK[b.urgency]) return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    return AUDIENCE_RANK[a.audience] - AUDIENCE_RANK[b.audience];
  });
}

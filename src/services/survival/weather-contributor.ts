// src/services/survival/weather-contributor.ts
import type { NwsAlertMinimal, SavedPlace } from '../weather/weather-threat-types.ts';
import { projectWeatherThreats } from './threat-projection.ts';
import type { PostureContributor } from './posture-contributor.ts';

/** Wraps the weather threat projection as a posture contributor (physical_safety axis). */
export function makeWeatherContributor(
  alerts: readonly NwsAlertMinimal[],
  places: readonly SavedPlace[],
): PostureContributor {
  return { id: 'weather', contribute: (now) => projectWeatherThreats(alerts, places, { now }) };
}

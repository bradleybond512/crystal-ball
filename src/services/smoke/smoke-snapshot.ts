/**
 * Pure snapshot composer — joins the engine modules into one SmokeSnapshot.
 * No @/ imports so it fixture-tests under tsx; the singleton runtime
 * (smoke-state.ts) supplies fetched data + persistence.
 */
import type { CompassPoint, SmokeSnapshot } from './smoke-types';
import { categorizeUsAqi } from './aqi-category';
import { computeSafeWindows, computeDaySummaries } from './safe-windows';
import { rankCompass } from './clean-air-compass';
import { adviseActivities } from './activity-guidance';
import { applyDoneState, scoreCleanRoom } from './clean-room-checklist';
import { avgNext6h, hasAqData, type ParsedAq } from './smoke-parse';

export interface BuildInputs {
  place: { id: string; name: string; lat: number; lon: number };
  home: ParsedAq;
  compassParsed: { point: CompassPoint; parsed: ParsedAq | null }[];
  doneChecklistIds: string[];
  sensitiveGroup: boolean;
  now: number;
}

export function buildSnapshot(inputs: BuildInputs): SmokeSnapshot {
  const { place, home, compassParsed, doneChecklistIds, sensitiveGroup, now } = inputs;
  const category = categorizeUsAqi(home.current.usAqi);
  const hourly48 = home.hourly.slice(0, 48);
  const { safeWindows, worstWindow } = computeSafeWindows(hourly48);
  const compassSamples = compassParsed.map(({ point, parsed }) => ({
    ...point,
    avgAqi6h: parsed ? avgNext6h(parsed.hourly) : null,
    deltaPctVsHome: null,
    placeName: null,
  }));
  return {
    placeId: place.id,
    placeName: place.name,
    lat: place.lat,
    lon: place.lon,
    current: { ...home.current, category },
    hourly48,
    safeWindows,
    worstWindow,
    days: computeDaySummaries(home.hourly),
    compass: rankCompass(compassSamples, home.current.usAqi),
    activities: adviseActivities(category, sensitiveGroup),
    checklist: applyDoneState(doneChecklistIds),
    cleanRoomScore: scoreCleanRoom(doneChecklistIds),
    sources: [(() => {
      // Same rule as the fetcher: rows whose AQI values are all null are
      // structure without data — the source must not read as OK.
      const ok = hasAqData(home);
      return {
        id: 'smoke_forecast' as const,
        label: 'Open-Meteo air quality (satellite/model)',
        ok,
        detail: ok ? null : 'No forecast data returned',
        updatedAt: now,
      };
    })()],
    generatedAt: now,
  };
}

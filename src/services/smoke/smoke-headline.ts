/**
 * Smoke callout headline — pure. Decides IF the app should call out smoke
 * conditions unprompted and with what words/severity (PR 3 of the Smoke &
 * Air program). Consumed by the callout bridge, which publishes into
 * insights-state (Home Shell critical band + Command Center) and fires the
 * edge-triggered native notification.
 */
import type { SmokeSnapshot, AqiCategory } from './smoke-types';

export interface SmokeHeadline {
  /** Stable id — one smoke callout per place; replaces the previous one. */
  eventId: string;
  description: string;
  /** 0–100, aligned with the briefing band floors (70 critical band, 85 critical tone). */
  severity: number;
  category: AqiCategory;
}

/** Severity per category, tuned to the Home Shell floors: USG qualifies for
 *  the critical band (≥70); Unhealthy+ reads as serious; VU/Hazardous cross
 *  the critical-tone floor (≥85). */
const CATEGORY_SEVERITY: Partial<Record<AqiCategory, number>> = {
  usg: 72,
  unhealthy: 80,
  very_unhealthy: 88,
  hazardous: 96,
};

const CATEGORY_PHRASE: Partial<Record<AqiCategory, string>> = {
  usg: 'Unhealthy air for sensitive groups',
  unhealthy: 'Unhealthy smoke levels',
  very_unhealthy: 'Very unhealthy smoke levels',
  hazardous: 'Hazardous smoke levels',
};

/**
 * Null below the callout floor (AQI < 101, no active smoke alerts, and no
 * confident incoming-smoke estimate). With an active smoke alert but sub-USG
 * AQI, emits an advisory-grade headline at the band floor so the alert
 * itself is still surfaced; likewise for a medium/high-confidence
 * wind-advection arrival estimate ("smoke may reach you tonight").
 */
export function buildSmokeHeadline(
  snap: SmokeSnapshot,
  activeSmokeAlerts: number,
): SmokeHeadline | null {
  const aqi = snap.current.usAqi;
  const sev = CATEGORY_SEVERITY[snap.current.category];

  if (sev !== undefined && aqi !== null) {
    const phrase = CATEGORY_PHRASE[snap.current.category] ?? 'Elevated smoke levels';
    const improving = snap.safeWindows[0] ? ` — improving ${snap.safeWindows[0].label}` : '';
    return {
      eventId: `smoke-${snap.placeId}`,
      description: `${phrase} near ${snap.placeName} — AQI ${Math.round(aqi)}${improving}`,
      severity: sev,
      category: snap.current.category,
    };
  }

  if (activeSmokeAlerts > 0) {
    const aqiTxt = aqi === null ? '' : ` (AQI ${Math.round(aqi)})`;
    const plural = activeSmokeAlerts === 1 ? 'advisory' : 'advisories';
    return {
      eventId: `smoke-${snap.placeId}`,
      description: `Wildfire smoke ${plural} active near ${snap.placeName}${aqiTxt}`,
      severity: 70,
      category: snap.current.category,
    };
  }

  // Predictive advisory: air is still fine but the wind-advection estimator
  // sees smoke coming. Low-confidence estimates never make a headline.
  const arrival = snap.arrivals?.find((a) => a.status === 'incoming' && a.confidence !== 'low');
  if (arrival?.etaLabel) {
    return {
      eventId: `smoke-${snap.placeId}`,
      description:
        `Wildfire smoke may reach ${snap.placeName} ${arrival.etaLabel} — ` +
        `${arrival.label} ${arrival.distanceMi} mi ${arrival.direction}`,
      severity: 70,
      category: snap.current.category,
    };
  }

  return null;
}

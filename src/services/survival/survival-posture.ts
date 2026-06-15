// src/services/survival/survival-posture.ts
import type { NwsAlertMinimal, SavedPlace } from '../weather/weather-threat-types.ts';
import type { ConfidenceBreakdown, AlgorithmExplanation } from '../intelligence/types.ts';
import type {
  AxisState, DomainFreshness, PostureThreat, SurvivalAxis, SurvivalPosture,
} from './survival-types.ts';
import { SURVIVAL_AXES, axisLabel, bandForLevel, buildHeadline } from './survival-types.ts';
import type { PostureContributor } from './posture-contributor.ts';
import { makeWeatherContributor } from './weather-contributor.ts';

/** Structural subset of WorldSnapshot that posture computation needs.
 *  A full WorldSnapshot satisfies this. */
export interface PostureInput {
  weatherAlerts: readonly NwsAlertMinimal[];
  savedPlaces: readonly SavedPlace[];
  freshness: readonly DomainFreshness[];
  capturedAtMs: number;
}

export interface PostureOptions {
  now?: number;
}

export interface MultiAxisInput {
  contributors: readonly PostureContributor[];
  freshness: readonly DomainFreshness[];
  capturedAtMs: number;
}

/** Generalized posture: aggregate threats from all contributors across all axes. */
export function computeMultiAxisPosture(input: MultiAxisInput, options: PostureOptions = {}): SurvivalPosture {
  const now = options.now ?? input.capturedAtMs;
  const threats = input.contributors.flatMap((c) => c.contribute(now));

  const byAxis = new Map<SurvivalAxis, PostureThreat[]>();
  for (const t of threats) {
    const arr = byAxis.get(t.axis) ?? [];
    arr.push(t);
    byAxis.set(t.axis, arr);
  }
  // Strongest-first within each axis so buildAxisState's dominant-threat logic holds
  // even when multiple contributors feed the same axis.
  for (const arr of byAxis.values()) arr.sort((a, b) => b.severity - a.severity);

  const staleInputs = input.freshness
    .filter((f) => !f.ok)
    .map((f) => `${f.domain} feed stale (${Math.round(f.ageMs / 60_000)} min old)`);

  const axes = SURVIVAL_AXES.map((axis) => buildAxisState(axis, byAxis.get(axis) ?? [], staleInputs));
  const worst = axes.reduce((w, a) => (a.level > w.level ? a : w), axes[0]!);

  return {
    axes,
    overallLevel: worst.level,
    overallBand: bandForLevel(worst.level),
    worstAxis: worst.axis,
    headline: buildHeadline(worst),
    capturedAtMs: now,
    staleInputs,
  };
}

export function computePosture(inputData: PostureInput, options: PostureOptions = {}): SurvivalPosture {
  return computeMultiAxisPosture(
    {
      contributors: [makeWeatherContributor(inputData.weatherAlerts, inputData.savedPlaces)],
      freshness: inputData.freshness,
      capturedAtMs: inputData.capturedAtMs,
    },
    options,
  );
}

function buildAxisState(axis: SurvivalAxis, threats: PostureThreat[], staleInputs: string[]): AxisState {
  const level = threats.reduce((m, t) => Math.max(m, t.severity), 0);
  const band = bandForLevel(level);
  const drivers = threats.map((t) => `${t.hazardLabel} — ${t.why}`);

  const confidence: ConfidenceBreakdown = threats.length
    ? { total: level, max: 100, items: [{ label: threats[0]!.hazardLabel, value: level, max: 100, polarity: 'negative' as const }] }
    : { total: 0, max: 100, items: [{ label: 'No active threats', value: 0, max: 100, polarity: 'positive' as const }] };

  const explanation: AlgorithmExplanation = {
    headline: threats.length ? `${axisLabel(axis)}: ${band}` : `${axisLabel(axis)}: secure`,
    lines: threats.map((t) => ({
      text: `${t.hazardLabel} (${t.why})`,
      polarity: 'negative' as const,
      weight: t.severity,
    })),
    missingConfirmation: staleInputs,
  };

  return { axis, level, band, trend: 'steady', threats, confidence, explanation, drivers };
}

/**
 * Per-activity guidance from EPA AQI category guidance. Verdicts follow the
 * EPA activity tables (no invented medicine); `sensitive` = children,
 * older adults, heart/lung conditions — escalates one step where EPA does.
 */
import type { AqiCategory, ActivityId, ActivityAdvice } from './smoke-types';

export const ACTIVITY_LABELS: Record<ActivityId, string> = {
  exercise_outdoors: 'Exercise / run outdoors',
  kids_outdoors: 'Kids playing outside',
  windows_open: 'Windows open',
  commute: 'Commute / errands',
  outdoor_work: 'Extended outdoor work',
  pets_outdoors: 'Pets outside',
};

type Verdict = ActivityAdvice['verdict'];

// Base verdict by category for the general population.
const BASE: Record<AqiCategory, Record<ActivityId, Verdict>> = {
  good: { exercise_outdoors: 'ok', kids_outdoors: 'ok', windows_open: 'ok', commute: 'ok', outdoor_work: 'ok', pets_outdoors: 'ok' },
  moderate: { exercise_outdoors: 'ok', kids_outdoors: 'ok', windows_open: 'ok', commute: 'ok', outdoor_work: 'ok', pets_outdoors: 'ok' },
  usg: { exercise_outdoors: 'caution', kids_outdoors: 'caution', windows_open: 'caution', commute: 'ok', outdoor_work: 'caution', pets_outdoors: 'caution' },
  unhealthy: { exercise_outdoors: 'avoid', kids_outdoors: 'avoid', windows_open: 'avoid', commute: 'caution', outdoor_work: 'avoid', pets_outdoors: 'caution' },
  very_unhealthy: { exercise_outdoors: 'avoid', kids_outdoors: 'avoid', windows_open: 'avoid', commute: 'caution', outdoor_work: 'avoid', pets_outdoors: 'avoid' },
  hazardous: { exercise_outdoors: 'avoid', kids_outdoors: 'avoid', windows_open: 'avoid', commute: 'avoid', outdoor_work: 'avoid', pets_outdoors: 'avoid' },
  unknown: { exercise_outdoors: 'caution', kids_outdoors: 'caution', windows_open: 'caution', commute: 'caution', outdoor_work: 'caution', pets_outdoors: 'caution' },
};

const REASONS: Record<Verdict, Partial<Record<AqiCategory, string>>> = {
  ok: {
    good: 'Air quality is good — no restrictions.',
    moderate: 'Acceptable for most people.',
    usg: 'Short, low-exertion exposure is acceptable for the general population.',
  },
  caution: {
    moderate: 'Unusually sensitive people should watch for symptoms.',
    usg: 'Reduce prolonged or heavy exertion; take more breaks.',
    unhealthy: 'Keep it brief; N95 recommended if prolonged.',
    very_unhealthy: 'Only if necessary; keep exposure minimal, N95 strongly recommended.',
    unknown: 'Air data unavailable — treat conditions as degraded until data returns.',
  },
  avoid: {
    usg: 'Sensitive groups should move activity indoors or reschedule.',
    unhealthy: 'Everyone should avoid prolonged outdoor exposure.',
    very_unhealthy: 'Health-alert conditions — stay indoors with filtered air.',
    hazardous: 'Emergency conditions — remain indoors; seal and filter your air.',
  },
};

const ESCALATE: Record<Verdict, Verdict> = { ok: 'caution', caution: 'avoid', avoid: 'avoid' };

export function adviseActivities(category: AqiCategory, sensitive: boolean): ActivityAdvice[] {
  return (Object.keys(ACTIVITY_LABELS) as ActivityId[]).map((activity) => {
    const base = BASE[category][activity];
    // EPA escalates for sensitive groups from 'moderate' upward; good stays ok.
    const verdict = sensitive && category !== 'good' ? ESCALATE[base] : base;
    const reason = REASONS[verdict][category] ?? REASONS[base][category] ??
      'Follow the stricter of local guidance and this category advice.';
    return { activity, label: ACTIVITY_LABELS[activity], verdict, reason };
  });
}

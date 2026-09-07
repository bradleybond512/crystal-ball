/**
 * Briefing view-model — composes the home shell's three bands
 * (personal / what changed / critical worldwide) from inputs the
 * caller has already captured from insights-state and the
 * command-center what-changed store.
 *
 * Pure deterministic: no DOM, no fetch, no globals; `now` is always
 * caller-supplied so this stays fixture-testable.
 */

import type { ImpactSeverity, PersonalImpact, PersonalImpactReport } from '../personal/personal-impact.ts';
import { formatDelta } from '../command-center/what-changed.ts';
import type { WhatChangedEvent } from '../command-center/what-changed.ts';
import type { SituationDescriptor } from '../insights/action-briefs.ts';

export type BandTone = 'info' | 'elevated' | 'critical';

export interface BriefingLineView {
  text: string;
  /** Present on personal- and critical-band rows — opens the situation dossier. */
  situationId?: string;
}

export interface BriefingBandView {
  kind: 'personal' | 'changed' | 'critical';
  label: string;
  tone: BandTone;
  headline: string;
  /** ≤ 4 short entries below the headline. */
  entries: readonly BriefingLineView[];
  /** Scope and limits of the evidence behind this band. */
  evidenceNote: string;
}

export interface HighSeverityEvent {
  eventId: string;
  description: string;
  domain: string;
  /** 0–100 */
  severity: number;
}

export interface BriefingInput {
  /** undefined = personal impact could not be computed. */
  personal?: PersonalImpactReport;
  savedPlacesCount?: number;
  /** undefined = digest unavailable; [] = nothing changed. */
  changed?: readonly WhatChangedEvent[];
  situation?: SituationDescriptor;
  recentEvents?: readonly HighSeverityEvent[];
}

export interface BriefingView {
  bands: readonly BriefingBandView[];
  generatedAt: number;
}

/** Events at or above this severity qualify for the critical band. */
export const CRITICAL_EVENT_FLOOR = 70;
/** At or above this severity the critical band turns 'critical'. */
export const CRITICAL_TONE_FLOOR = 85;
const MAX_LINES = 4;
const COVERAGE_NOTE = 'Available reports only · coverage unverified · evidence age unknown.';
const DIGEST_NOTE = 'Recorded changes only · source coverage and evidence age unverified.';
const SOURCE_NEXT_STEP = 'Review source status before relying on this summary.';

type ActiveSeverity = Exclude<ImpactSeverity, 'low' | 'none'>;
type ActiveImpact = PersonalImpact & { severity: ActiveSeverity };

const SEVERITY_GLYPH: Record<ActiveSeverity, string> = {
  critical: '●',
  elevated: '▲',
  watch: '○',
};

export function buildBriefingView(input: BriefingInput, now: number): BriefingView {
  const bands: BriefingBandView[] = [
    buildPersonalBand(input),
    buildChangedBand(input),
    buildCriticalBand(input),
  ];
  return { bands, generatedAt: now };
}

function buildPersonalBand(input: BriefingInput): BriefingBandView {
  const { personal } = input;
  if (!personal) {
    return {
      kind: 'personal',
      label: 'Personal',
      tone: 'info',
      headline: 'Personal status unavailable.',
      entries: [],
      evidenceNote: `${COVERAGE_NOTE} ${SOURCE_NEXT_STEP}`,
    };
  }
  const active = personal.impacts.filter((i): i is ActiveImpact => isActiveImpact(i));
  if (active.length === 0 && input.savedPlacesCount === 0) {
    return {
      kind: 'personal',
      label: 'Personal',
      tone: 'info',
      headline: 'No saved places for a local assessment.',
      entries: [{ text: 'Add a place in Settings.' }],
      evidenceNote: COVERAGE_NOTE,
    };
  }
  const tone = personalTone(active);
  const impactWord = active.length === 1 ? 'impact' : 'impacts';
  const headline = active.length === 0
    ? 'No personal impacts identified in available reports.'
    : `${active.length} personal ${impactWord} near you`;
  const entries = active
    .slice(0, MAX_LINES)
    .map((i) => ({ text: `${SEVERITY_GLYPH[i.severity]} ${i.description} — ${i.recommendedAction}`, situationId: i.eventId }));
  return { kind: 'personal', label: 'Personal', tone, headline, entries, evidenceNote: `${COVERAGE_NOTE} ${SOURCE_NEXT_STEP}` };
}

/** Personally-relevant: meaningful severity AND at least one real
 *  exposure match. Impacts with zero exposures are upstream noise
 *  (e.g. nationwide alerts miscategorized as immediate_risk) and must
 *  not count toward the personal band. */
function isActiveImpact(i: PersonalImpact): i is ActiveImpact {
  return i.severity !== 'none' && i.severity !== 'low' && i.exposures.length > 0;
}

function personalTone(active: readonly ActiveImpact[]): BandTone {
  if (active.some((i) => i.severity === 'critical')) return 'critical';
  if (active.some((i) => i.severity === 'elevated')) return 'elevated';
  return 'info';
}

function buildChangedBand(input: BriefingInput): BriefingBandView {
  const { changed } = input;
  if (!changed) {
    return {
      kind: 'changed',
      label: 'What changed',
      tone: 'info',
      headline: 'Change digest unavailable',
      entries: [],
      evidenceNote: `${DIGEST_NOTE} ${SOURCE_NEXT_STEP}`,
    };
  }
  if (changed.length === 0) {
    return {
      kind: 'changed',
      label: 'What changed',
      tone: 'info',
      headline: 'No changes recorded in the available digest.',
      entries: [],
      evidenceNote: `${DIGEST_NOTE} ${SOURCE_NEXT_STEP}`,
    };
  }
  const tone: BandTone = changed.some((e) => e.type === 'escalated' || e.type === 'feed-degraded')
    ? 'elevated'
    : 'info';
  const headline = `${changed.length} change${changed.length === 1 ? '' : 's'} since last check`;
  const entries = changed.slice(0, MAX_LINES).map((e) => ({ text: formatDelta(e) }));
  return { kind: 'changed', label: 'What changed', tone, headline, entries, evidenceNote: `${DIGEST_NOTE} ${SOURCE_NEXT_STEP}` };
}

function buildCriticalBand(input: BriefingInput): BriefingBandView {
  const situationId = input.situation?.id;
  const events = [...(input.recentEvents ?? [])]
    .filter((e) => e.severity >= CRITICAL_EVENT_FLOOR && e.eventId !== situationId)
    .sort((a, b) => b.severity - a.severity);
  const entries: BriefingLineView[] = [];
  if (input.situation) {
    entries.push({
      text: `● ${input.situation.title} (${input.situation.severityScore})`,
      situationId: input.situation.id,
    });
  }
  for (const e of events) {
    if (entries.length >= MAX_LINES) break;
    entries.push({
      text: `${e.severity >= CRITICAL_TONE_FLOOR ? '●' : '▲'} ${e.description} (${e.severity})`,
      situationId: e.eventId,
    });
  }
  const worst = Math.max(input.situation?.severityScore ?? 0, events[0]?.severity ?? 0);
  const tone = criticalTone(entries.length > 0, worst);
  const count = (input.situation ? 1 : 0) + events.length;
  const situationWord = count === 1 ? 'situation' : 'situations';
  let headline = input.recentEvents === undefined
    ? 'Critical reports unavailable.'
    : 'No critical items in available reports.';
  if (count > 0) headline = `${count} ${situationWord} worldwide`;
  const missingReports = input.recentEvents === undefined && count > 0
    ? ' Other critical reports unavailable.'
    : '';
  const evidenceNote = `${COVERAGE_NOTE}${missingReports} ${SOURCE_NEXT_STEP}`;
  return { kind: 'critical', label: 'Critical worldwide', tone, headline, entries, evidenceNote };
}

function criticalTone(hasLines: boolean, worstSeverity: number): BandTone {
  if (!hasLines) return 'info';
  return worstSeverity >= CRITICAL_TONE_FLOOR ? 'critical' : 'elevated';
}

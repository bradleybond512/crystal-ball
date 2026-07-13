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

export type BandTone = 'clear' | 'info' | 'elevated' | 'critical';

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
  /** Honest-staleness line, e.g. "unavailable · last good 14:20". */
  staleness?: string;
}

export interface HighSeverityEvent {
  eventId: string;
  description: string;
  domain: string;
  /** 0–100 */
  severity: number;
}

export interface BriefingInput {
  /** undefined = personal impact could not be computed (stale). */
  personal?: PersonalImpactReport;
  lastGoodPersonalAt?: number;
  monitoredPlacesCount?: number;
  /** undefined = digest unavailable; [] = nothing changed. */
  changed?: readonly WhatChangedEvent[];
  lastGoodChangedAt?: number;
  situation?: SituationDescriptor;
  recentEvents?: readonly HighSeverityEvent[];
}

export interface BriefingView {
  allClear: boolean;
  allClearText: string;
  bands: readonly BriefingBandView[];
  generatedAt: number;
}

/** Events at or above this severity qualify for the critical band. */
export const CRITICAL_EVENT_FLOOR = 70;
/** At or above this severity the critical band turns 'critical'. */
export const CRITICAL_TONE_FLOOR = 85;
const MAX_LINES = 4;

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
  const allClear = bands.every((b) => b.tone === 'clear');
  const places = input.monitoredPlacesCount ?? 0;
  const allClearText = `All clear · ${places} place${places === 1 ? '' : 's'} monitored · nothing critical worldwide`;
  return { allClear, allClearText, bands, generatedAt: now };
}

function buildPersonalBand(input: BriefingInput): BriefingBandView {
  const { personal } = input;
  if (!personal) {
    return {
      kind: 'personal',
      label: 'PERSONAL',
      tone: 'info',
      headline: 'Personal status unavailable',
      entries: [],
      staleness: staleLine(input.lastGoodPersonalAt),
    };
  }
  const active = personal.impacts.filter((i): i is ActiveImpact => isActiveImpact(i));
  const tone = personalTone(active);
  const impactWord = active.length === 1 ? 'impact' : 'impacts';
  const headline = active.length === 0
    ? 'All clear near your places'
    : `${active.length} personal ${impactWord} near you`;
  const entries = active
    .slice(0, MAX_LINES)
    .map((i) => ({ text: `${SEVERITY_GLYPH[i.severity]} ${i.description} — ${i.recommendedAction}`, situationId: i.eventId }));
  return { kind: 'personal', label: 'PERSONAL', tone, headline, entries };
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
  if (active.length > 0) return 'info';
  return 'clear';
}

function buildChangedBand(input: BriefingInput): BriefingBandView {
  const { changed } = input;
  if (!changed) {
    return {
      kind: 'changed',
      label: 'WHAT CHANGED',
      tone: 'info',
      headline: 'Change digest unavailable',
      entries: [],
      staleness: staleLine(input.lastGoodChangedAt),
    };
  }
  if (changed.length === 0) {
    return {
      kind: 'changed',
      label: 'WHAT CHANGED',
      tone: 'clear',
      headline: 'Nothing changed recently',
      entries: [],
    };
  }
  const tone: BandTone = changed.some((e) => e.type === 'escalated' || e.type === 'feed-degraded')
    ? 'elevated'
    : 'info';
  const headline = `${changed.length} change${changed.length === 1 ? '' : 's'} since last check`;
  const entries = changed.slice(0, MAX_LINES).map((e) => ({ text: formatDelta(e) }));
  return { kind: 'changed', label: 'WHAT CHANGED', tone, headline, entries };
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
  const headline = count === 0 ? 'Nothing critical worldwide' : `${count} ${situationWord} worldwide`;
  return { kind: 'critical', label: 'CRITICAL WORLDWIDE', tone, headline, entries };
}

function criticalTone(hasLines: boolean, worstSeverity: number): BandTone {
  if (!hasLines) return 'clear';
  return worstSeverity >= CRITICAL_TONE_FLOOR ? 'critical' : 'elevated';
}

function staleLine(lastGoodAt: number | undefined): string {
  if (lastGoodAt === undefined) return 'unavailable · no successful update yet';
  return `unavailable · last good ${formatClock(lastGoodAt)}`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

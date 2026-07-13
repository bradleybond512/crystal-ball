/**
 * Dossier view-model — composes the situation drawer's header badge,
 * honest why-surfaced lines (from stored pipeline/notification traces;
 * BigEvent trigger rationales are discarded upstream and are NOT
 * fabricated here), ranked evidence cards, and a merged trace timeline.
 *
 * Pure deterministic: no DOM, no fetch, no globals; `now` caller-supplied.
 */

import type { PanelMeta } from '../../config/panel-metadata.ts';
import type { SituationDescriptor } from '../insights/action-briefs.ts';
import { classifyUrgency } from '../insights/confidence-urgency-matrix.ts';
import { buildDeckCards } from './deck-view.ts';
import type { DeckCardView, PanelHealthLike } from './deck-view.ts';

export interface TraceEventLike {
  at: number;
  stage?: string;
  kind?: string;
  reason?: string;
}

export interface DossierInputs {
  situation: SituationDescriptor;
  location?: { latitude: number; longitude: number };
  metadata: Readonly<Record<string, PanelMeta>>;
  /** DEFAULT_PANELS-shaped lookup; doubles as the variant gate. */
  names: Readonly<Record<string, { name: string } | undefined>>;
  health: readonly PanelHealthLike[];
  narratives: Readonly<Record<string, string | undefined>>;
  pipelineEvents?: readonly TraceEventLike[];
  notificationEvents?: readonly TraceEventLike[];
}

export interface EvidenceCardView extends DeckCardView {
  /** Why this panel is here ("featured severe_weather evidence"). */
  reason: string;
}

export interface TimelineRow {
  at: number;
  label: string;
}

export interface DossierView {
  title: string;
  badge: { text: string; tone: 'critical' | 'elevated' | 'info' };
  subline: string;
  whySurfaced: readonly string[];
  evidence: readonly EvidenceCardView[];
  runnersUp: readonly EvidenceCardView[];
  timeline: readonly TimelineRow[];
}

const EVIDENCE_CAP = 6;
const RUNNERS_UP_CAP = 4;

const URGENCY_LABEL = { high: 'ACT SOON', medium: 'WATCH', low: 'MONITOR' } as const;
const URGENCY_TONE = { high: 'critical', medium: 'elevated', low: 'info' } as const;
const CONF_LABEL = { high: 'HIGH CONF', medium: 'MED CONF', low: 'LOW CONF' } as const;

export function buildDossierView(inputs: DossierInputs, now: number): DossierView {
  const { situation } = inputs;
  const urgency = classifyUrgency(situation.severityScore);
  const badge = {
    text: `${URGENCY_LABEL[urgency]} · ${CONF_LABEL[situation.confidence]}`,
    tone: URGENCY_TONE[urgency],
  };
  const sublineParts = [`severity ${situation.severityScore}`, `${situation.confidence} confidence`];
  if (situation.minutesUntilImpact !== undefined) {
    sublineParts.push(`~${situation.minutesUntilImpact} min`);
  }

  const { evidence, runnersUp } = composeEvidence(inputs, now);

  return {
    title: situation.title,
    badge,
    subline: sublineParts.join(' · '),
    whySurfaced: buildWhySurfaced(inputs),
    evidence,
    runnersUp,
    timeline: buildTimeline(inputs),
  };
}

function composeEvidence(
  inputs: DossierInputs,
  now: number,
): { evidence: EvidenceCardView[]; runnersUp: EvidenceCardView[] } {
  const category = inputs.situation.category;
  const healthById = new Map(inputs.health.map((h) => [h.panelId, h]));
  const candidates = Object.entries(inputs.metadata)
    .filter(([panelId, meta]) => {
      if (!meta.evidenceFor?.includes(category)) return false;
      // Variant gate: no name entry means the panel is not in this variant.
      return inputs.names[panelId] !== undefined;
    })
    .map(([panelId, meta]) => ({ panelId, meta }));

  candidates.sort((a, b) => rankScore(b, healthById) - rankScore(a, healthById) || a.panelId.localeCompare(b.panelId));

  const ranked = candidates.slice(0, EVIDENCE_CAP + RUNNERS_UP_CAP);
  const cards = buildDeckCards(
    ranked.map((c) => c.panelId),
    { names: inputs.names, health: inputs.health, narratives: inputs.narratives },
    now,
  );
  const withReason: EvidenceCardView[] = cards.map((card, i) => {
    const meta = ranked[i]!.meta;
    const parts: string[] = [];
    if (meta.featured) parts.push('featured');
    parts.push(`${category} evidence`);
    return { ...card, reason: parts.join(' ') };
  });
  return {
    evidence: withReason.slice(0, EVIDENCE_CAP),
    runnersUp: withReason.slice(EVIDENCE_CAP),
  };
}

function rankScore(
  candidate: { panelId: string; meta: PanelMeta },
  healthById: ReadonlyMap<string, PanelHealthLike>,
): number {
  let score = 0;
  if (candidate.meta.featured) score += 4;
  if (candidate.meta.tier === 'library') score += 2;
  const h = healthById.get(candidate.panelId);
  if (h?.status === 'healthy') score += 1;
  return score;
}

function buildWhySurfaced(inputs: DossierInputs): string[] {
  const lines: string[] = [];
  for (const e of inputs.pipelineEvents ?? []) {
    if (e.stage === 'evaluated' || e.stage === 'routed' || e.stage === 'dropped') {
      lines.push(e.reason ? `${e.stage} — ${e.reason}` : `${e.stage}`);
    }
  }
  for (const e of inputs.notificationEvents ?? []) {
    if (e.kind && e.reason) lines.push(`${e.kind} — ${e.reason}`);
  }
  if (lines.length === 0) {
    lines.push('no pipeline trace recorded for this situation — surfaced via the active-situation bridge');
  }
  return lines;
}

function buildTimeline(inputs: DossierInputs): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const e of inputs.pipelineEvents ?? []) {
    rows.push({ at: e.at, label: e.reason ? `${e.stage ?? 'event'} — ${e.reason}` : (e.stage ?? 'event') });
  }
  for (const e of inputs.notificationEvents ?? []) {
    rows.push({ at: e.at, label: e.reason ? `${e.kind ?? 'event'} — ${e.reason}` : (e.kind ?? 'event') });
  }
  rows.sort((a, b) => a.at - b.at);
  return rows;
}

export { formatAge } from './deck-view.ts';
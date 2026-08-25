import type { PanelMeta } from '../../config/panel-metadata.ts';
import type { PlaybookCategory } from '../insights/reaction-playbooks.ts';
import { projectView } from '../survival/world-snapshot.ts';
import {
  SURVIVAL_AXES,
  axisLabel,
  bandRank,
} from '../survival/survival-types.ts';
import type {
  AxisState,
  SurvivalAxis,
  SurvivalBand,
  WorldSnapshot,
} from '../survival/survival-types.ts';
import { formatAge } from './deck-view.ts';

export const GUIDANCE_LEVEL = 40;
export const MAX_CONTEXTUAL_PANELS = 6;

export type ContextualPanelRule =
  | { panelId: string; kind: 'direct' }
  | { panelId: string; kind: 'category'; category: PlaybookCategory };

export type ContextualPanelRules = Readonly<Record<SurvivalAxis, readonly ContextualPanelRule[]>>;

const direct = (panelId: string): ContextualPanelRule => ({ panelId, kind: 'direct' });
const category = (panelId: string, value: PlaybookCategory): ContextualPanelRule => ({
  panelId,
  kind: 'category',
  category: value,
});

export const CONTEXTUAL_PANEL_RULES: ContextualPanelRules = {
  physical_safety: [
    direct('local-logistics'),
    category('nws-alerts', 'severe_weather'),
    category('survival-guide', 'severe_weather'),
    category('evacuation', 'severe_weather'),
    category('saved-places', 'severe_weather'),
  ],
  supply: [
    direct('local-logistics'),
    category('shortage-radar', 'food_shortage'),
    category('supply-chain', 'food_shortage'),
    category('humanitarian-crisis', 'food_shortage'),
    direct('survival-guide'),
  ],
  financial: [
    category('markets', 'banking_outage'),
    category('macro-signals', 'banking_outage'),
    category('stablecoins', 'banking_outage'),
    category('threat-intel-hub', 'banking_outage'),
  ],
  mobility: [
    direct('local-logistics'),
    category('travel-safety', 'travel_disruption'),
    category('air-traffic', 'travel_disruption'),
    category('amtrak-alerts', 'travel_disruption'),
    category('security-advisories', 'travel_disruption'),
  ],
  comms: [
    category('internet-disruptions', 'grid_outage'),
    category('grid-intelligence', 'grid_outage'),
    direct('comms-health'),
    category('cyber-threats', 'cyber_campaign'),
    category('threat-intel-hub', 'cyber_campaign'),
  ],
  health: [
    direct('local-logistics'),
    category('disease-intel', 'disease_outbreak'),
    category('air-quality', 'disease_outbreak'),
    category('disease-outbreaks', 'disease_outbreak'),
    category('pandemic-preparedness', 'disease_outbreak'),
  ],
  energy_water: [
    direct('local-logistics'),
    category('power-grid', 'grid_outage'),
    category('grid-intelligence', 'grid_outage'),
    direct('water-quality'),
    category('infrastructure', 'grid_outage'),
  ],
  security: [
    category('threat-intel-hub', 'cyber_campaign'),
    category('threat-inbox', 'cyber_campaign'),
    category('live-news', 'conflict_escalation'),
    category('security-advisories', 'travel_disruption'),
    category('survival-guide', 'conflict_escalation'),
  ],
};

export type ContextualDeckState = 'checking' | 'unavailable' | 'quiet' | 'active' | 'stale';

export interface ContextualPanelCardView {
  panelId: string;
  title: string;
  axes: readonly ContextualAxisContribution[];
  reason: string;
  semanticKey: string;
}

export interface ContextualAxisContribution {
  axis: SurvivalAxis;
  band: SurvivalBand;
  level: number;
}

export interface ContextualDeckView {
  state: ContextualDeckState;
  headline: string;
  summary: string;
  cards: readonly ContextualPanelCardView[];
  semanticKey: string;
}

interface ActivePanelLike {
  name: string;
  enabled: boolean;
}

interface ContextualCardDraft {
  panelId: string;
  title: string;
  axes: ContextualAxisContribution[];
}

interface ContextualCandidate {
  panelId: string;
  title: string;
  contribution: ContextualAxisContribution;
}

export interface ContextualDeckInputs {
  /** undefined while first hydration is unsettled; null once it settles empty. */
  snapshot: WorldSnapshot | null | undefined;
  pins: readonly string[];
  panels: Readonly<Record<string, ActivePanelLike | undefined>>;
  metadata: Readonly<Record<string, PanelMeta | undefined>>;
  rules?: ContextualPanelRules;
}

export function buildContextualDeckView(inputs: ContextualDeckInputs, now: number): ContextualDeckView {
  if (inputs.snapshot === undefined) {
    return stateView('checking', 'Contextual panels', 'Checking the latest saved posture…');
  }
  if (inputs.snapshot === null) {
    return stateView(
      'unavailable',
      'Contextual panels unavailable',
      'No posture snapshot yet. Suggestions appear when an axis reaches elevated.',
    );
  }

  const axes = qualifyingAxes(inputs.snapshot.posture.axes);
  if (axes.length === 0) {
    return stateView(
      'quiet',
      'No contextual panels needed',
      'No posture axis is elevated; no contextual panels are needed.',
    );
  }

  const rules = inputs.rules ?? CONTEXTUAL_PANEL_RULES;
  const excluded = canonicalPinIds(inputs.pins, inputs.metadata);
  const cards = collectContextualCards(axes, rules, excluded, inputs.panels, inputs.metadata);

  if (cards.length === 0) {
    return stateView(
      'quiet',
      'No contextual panels available',
      'Elevated posture has no available contextual panel in this variant.',
    );
  }

  return populatedView(inputs.snapshot, cards, now);
}

function canonicalPinIds(
  pins: readonly string[],
  metadata: Readonly<Record<string, PanelMeta | undefined>>,
): Set<string> {
  const ids = new Set<string>();
  for (const pin of pins) {
    const canonical = canonicalPanelId(pin, metadata);
    if (canonical) ids.add(canonical);
  }
  return ids;
}

function collectContextualCards(
  axes: readonly AxisState[],
  rules: ContextualPanelRules,
  excluded: ReadonlySet<string>,
  panels: Readonly<Record<string, ActivePanelLike | undefined>>,
  metadata: Readonly<Record<string, PanelMeta | undefined>>,
): ContextualCardDraft[] {
  const cards: ContextualCardDraft[] = [];
  const cardsById = new Map<string, ContextualCardDraft>();
  const maxSlots = Math.max(0, ...axes.map((axis) => rules[axis.axis]?.length ?? 0));
  for (let slot = 0; slot < maxSlots; slot += 1) {
    for (const axis of axes) {
      const rule = rules[axis.axis]?.[slot];
      const candidate = rule
        ? contextualCandidate(rule, axis, excluded, panels, metadata)
        : null;
      if (candidate) addContextualCandidate(cards, cardsById, candidate);
    }
  }
  return cards;
}

function contextualCandidate(
  rule: ContextualPanelRule,
  axis: AxisState,
  excluded: ReadonlySet<string>,
  panels: Readonly<Record<string, ActivePanelLike | undefined>>,
  metadata: Readonly<Record<string, PanelMeta | undefined>>,
): ContextualCandidate | null {
  const panelId = canonicalPanelId(rule.panelId, metadata);
  if (!panelId || excluded.has(panelId)) return null;
  const meta = metadata[panelId];
  const panel = panels[panelId];
  if (!meta || !panel?.enabled) return null;
  if (rule.kind === 'category' && !meta.evidenceFor?.includes(rule.category)) return null;
  return {
    panelId,
    title: panel.name,
    contribution: {
      axis: axis.axis,
      band: axis.band,
      level: Math.round(axis.level),
    },
  };
}

function addContextualCandidate(
  cards: ContextualCardDraft[],
  cardsById: Map<string, ContextualCardDraft>,
  candidate: ContextualCandidate,
): void {
  const existing = cardsById.get(candidate.panelId);
  if (existing) {
    if (!existing.axes.some((item) => item.axis === candidate.contribution.axis)) {
      existing.axes.push(candidate.contribution);
    }
    return;
  }
  if (cards.length === MAX_CONTEXTUAL_PANELS) return;
  const card = {
    panelId: candidate.panelId,
    title: candidate.title,
    axes: [candidate.contribution],
  };
  cards.push(card);
  cardsById.set(candidate.panelId, card);
}

function populatedView(
  snapshot: WorldSnapshot,
  cards: readonly ContextualCardDraft[],
  now: number,
): ContextualDeckView {
  const projected = projectView(snapshot, { now });
  const stale = projected.isStale || projected.posture.staleInputs.length > 0;
  const state: ContextualDeckState = stale ? 'stale' : 'active';
  const headline = stale ? 'Suggestions from last known posture' : 'Suggested for this posture';
  const panelLabel = cards.length === 1 ? 'panel' : 'panels';
  const summary = stale
    ? `Snapshot captured ${formatAge(Math.max(0, now - snapshot.capturedAtMs))} ago · verify current conditions before acting.`
    : `${cards.length} relevant ${panelLabel} for elevated posture axes.`;
  const cardViews = cards.map((card) => formatContextualCard(card));
  return {
    state,
    headline,
    summary,
    cards: cardViews,
    semanticKey: `${state}|${headline}|${summary}|${cardViews.map((card) => card.semanticKey).join('|')}`,
  };
}

function formatContextualCard(card: ContextualCardDraft): ContextualPanelCardView {
  const reason = `${card.axes.map((axis) => (
    `${axisLabel(axis.axis)} ${axis.band} (${axis.level})`
  )).join(' · ')}.`;
  return {
    ...card,
    reason,
    semanticKey: `${card.panelId}:${card.axes.map((axis) => (
      `${axis.axis}:${axis.band}:${axis.level}`
    )).join('|')}`,
  };
}

function qualifyingAxes(axes: readonly AxisState[]): AxisState[] {
  const order = new Map(SURVIVAL_AXES.map((axis, index) => [axis, index]));
  return SURVIVAL_AXES
    .flatMap((axisName) => {
      const axis = axes.find((candidate) => candidate.axis === axisName);
      return axis && Number.isFinite(axis.level) && axis.level >= GUIDANCE_LEVEL ? [axis] : [];
    })
    .sort((a, b) => (
      bandRank(b.band) - bandRank(a.band)
      || b.level - a.level
      || (order.get(a.axis) ?? SURVIVAL_AXES.length) - (order.get(b.axis) ?? SURVIVAL_AXES.length)
    ));
}

function canonicalPanelId(
  panelId: string,
  metadata: Readonly<Record<string, PanelMeta | undefined>>,
): string | null {
  const seen = new Set<string>();
  let current = panelId;
  while (true) {
    if (seen.has(current)) return null;
    seen.add(current);
    const meta = metadata[current];
    if (!meta) return null;
    if (!meta.aliasOf) return current;
    current = meta.aliasOf;
  }
}

function stateView(state: ContextualDeckState, headline: string, summary: string): ContextualDeckView {
  return { state, headline, summary, cards: [], semanticKey: `${state}|${headline}|${summary}` };
}

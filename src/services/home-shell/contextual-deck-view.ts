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
import { isModeForecastThreatSourceEventId } from '../survival/mode-forecast-threats.ts';
import { formatAge } from './deck-view.ts';

export const GUIDANCE_LEVEL = 40;
export const MAX_CONTEXTUAL_PANELS = 6;

export type ContextualPanelRule = readonly [panelId: string, category?: PlaybookCategory];

export type ContextualPanelRules = Readonly<Record<SurvivalAxis, readonly ContextualPanelRule[]>>;

export const CONTEXTUAL_PANEL_RULES = {
  physical_safety: [
    ['local-logistics'],
    ['nws-alerts', 'severe_weather'],
    ['survival-guide', 'severe_weather'],
    ['evacuation', 'severe_weather'],
    ['saved-places', 'severe_weather'],
  ],
  supply: [
    ['local-logistics'],
    ['shortage-radar', 'food_shortage'],
    ['supply-chain', 'food_shortage'],
    ['humanitarian-crisis', 'food_shortage'],
    ['survival-guide'],
  ],
  financial: [
    ['markets', 'banking_outage'],
    ['macro-signals', 'banking_outage'],
    ['stablecoins', 'banking_outage'],
    ['threat-intel-hub', 'banking_outage'],
  ],
  mobility: [
    ['local-logistics'],
    ['travel-safety', 'travel_disruption'],
    ['air-traffic', 'travel_disruption'],
    ['amtrak-alerts', 'travel_disruption'],
    ['security-advisories', 'travel_disruption'],
  ],
  comms: [
    ['internet-disruptions', 'grid_outage'],
    ['grid-intelligence', 'grid_outage'],
    ['comms-health'],
    ['cyber-threats', 'cyber_campaign'],
    ['threat-intel-hub', 'cyber_campaign'],
  ],
  health: [
    ['local-logistics'],
    ['disease-intel', 'disease_outbreak'],
    ['air-quality', 'disease_outbreak'],
    ['disease-outbreaks', 'disease_outbreak'],
    ['pandemic-preparedness', 'disease_outbreak'],
  ],
  energy_water: [
    ['local-logistics'],
    ['power-grid', 'grid_outage'],
    ['grid-intelligence', 'grid_outage'],
    ['water-quality'],
    ['infrastructure', 'grid_outage'],
  ],
  security: [
    ['threat-intel-hub', 'cyber_campaign'],
    ['threat-inbox', 'cyber_campaign'],
    ['live-news', 'conflict_escalation'],
    ['security-advisories', 'travel_disruption'],
    ['survival-guide', 'conflict_escalation'],
  ],
} as const satisfies ContextualPanelRules;

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

interface SnapshotStatus {
  stale: boolean;
  warning: string | null;
}

interface AxisSelection {
  axes: AxisState[];
  forecastWithheld: number;
  unsupportedWithheld: number;
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
    return stateView('checking', 'Contextual panels', 'Checking saved posture…');
  }
  if (inputs.snapshot === null) {
    return stateView(
      'unavailable',
      'Contextual panels',
      'No posture snapshot yet; suggestions begin at elevated.',
    );
  }

  const status = snapshotStatus(inputs.snapshot, now);
  const selection = qualifyingAxes(inputs.snapshot.posture.axes);
  const { axes, forecastWithheld, unsupportedWithheld } = selection;
  if (axes.length === 0) {
    return emptyAxesView(status, forecastWithheld, unsupportedWithheld);
  }

  const rules = inputs.rules ?? CONTEXTUAL_PANEL_RULES;
  const excluded = canonicalPinIds(inputs.pins, inputs.metadata);
  const cards = collectContextualCards(axes, rules, excluded, inputs.panels, inputs.metadata);

  if (cards.length === 0) {
    return emptyCardsView(status, forecastWithheld, unsupportedWithheld);
  }

  return populatedView(cards, status, forecastWithheld, unsupportedWithheld);
}

function emptyAxesView(
  status: SnapshotStatus,
  forecastWithheld: number,
  unsupportedWithheld: number,
): ContextualDeckView {
  if (status.stale || forecastWithheld > 0) {
    return stateView(
      'stale',
      forecastWithheld > 0 ? 'Forecast-derived posture withheld' : 'Last known posture—verify now',
      degradedSummary(
        status,
        forecastWithheld,
        unsupportedWithheld,
        forecastWithheld > 0
          ? 'Verify source freshness before acting.'
          : 'no elevated axes then; verify current conditions.',
      ),
    );
  }
  if (unsupportedWithheld > 0) {
    return stateView(
      'quiet',
      'No supported elevated posture axes',
      unsupportedAxesWarning(unsupportedWithheld),
    );
  }
  return stateView(
    'quiet',
    'No elevated posture axes',
    'Suggestions appear when an axis reaches elevated.',
  );
}

function emptyCardsView(
  status: SnapshotStatus,
  forecastWithheld: number,
  unsupportedWithheld: number,
): ContextualDeckView {
  if (status.stale || forecastWithheld > 0) {
    return stateView(
      'stale',
      'Last known suggestions unavailable',
      degradedSummary(
        status,
        forecastWithheld,
        unsupportedWithheld,
        'elevated axes had no available panel; verify current conditions.',
      ),
    );
  }
  return stateView(
    'quiet',
    'No contextual panels',
    joinSummary([
      'Elevated posture has no available panel in this variant.',
      unsupportedWithheld > 0 ? unsupportedAxesWarning(unsupportedWithheld) : null,
    ]),
  );
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
  const maxSlots = Math.max(...axes.map((axis) => rules[axis.axis].length));
  for (let slot = 0; slot < maxSlots; slot += 1) {
    for (const axis of axes) {
      const rule = rules[axis.axis][slot];
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
  const [requestedPanelId, category] = rule;
  const panelId = canonicalPanelId(requestedPanelId, metadata);
  if (!panelId || excluded.has(panelId)) return null;
  const meta = metadata[panelId];
  const panel = panels[panelId];
  if (!meta || !panel?.enabled) return null;
  if (category && !meta.evidenceFor?.includes(category)) return null;
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
  cards: readonly ContextualCardDraft[],
  status: SnapshotStatus,
  forecastWithheld: number,
  unsupportedWithheld: number,
): ContextualDeckView {
  const state: ContextualDeckState = status.stale || forecastWithheld > 0 ? 'stale' : 'active';
  const headline = populatedHeadline(status, forecastWithheld);
  const panelLabel = cards.length === 1 ? 'panel' : 'panels';
  const summary = joinSummary([
    `${cards.length} relevant ${panelLabel} for elevated axes.`,
    status.warning,
    forecastWithheld > 0 ? forecastAxesWarning(forecastWithheld) : null,
    unsupportedWithheld > 0 ? unsupportedAxesWarning(unsupportedWithheld) : null,
    state === 'stale' ? 'Verify current conditions before acting.' : null,
  ]);
  const cardViews = cards.map((card) => formatContextualCard(card));
  return {
    state,
    headline,
    summary,
    cards: cardViews,
    semanticKey: `${state}|${summary}|${cardViews.map((card) => card.semanticKey).join('|')}`,
  };
}

function populatedHeadline(status: SnapshotStatus, forecastWithheld: number): string {
  if (status.stale) return 'Suggestions from last known posture';
  if (forecastWithheld > 0) return 'Suggested panels with withheld posture';
  return 'Suggested panels';
}

function snapshotStatus(snapshot: WorldSnapshot, now: number): SnapshotStatus {
  const projected = projectView(snapshot, { now });
  const warnings = [
    projected.isStale
      ? `Weather data ${formatAge(Math.max(0, projected.weatherAgeMs))} old`
      : null,
    snapshot.posture.staleInputs.length > 0 ? 'Posture contains stale inputs' : null,
  ];
  return {
    stale: warnings.some(Boolean),
    warning: joinSummary(warnings),
  };
}

function degradedSummary(
  status: SnapshotStatus,
  forecastWithheld: number,
  unsupportedWithheld: number,
  detail: string,
): string {
  return joinSummary([
    status.warning,
    forecastWithheld > 0 ? forecastAxesWarning(forecastWithheld) : null,
    unsupportedWithheld > 0 ? unsupportedAxesWarning(unsupportedWithheld) : null,
    detail,
  ]);
}

function forecastAxesWarning(count: number): string {
  return `${count} forecast-derived posture ${count === 1 ? 'axis' : 'axes'} withheld because source age is unknown.`;
}

function unsupportedAxesWarning(count: number): string {
  return `${count} elevated posture ${count === 1 ? 'axis' : 'axes'} withheld without a supporting threat.`;
}

function joinSummary(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part.length > 0).join(' · ');
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

function qualifyingAxes(axes: readonly AxisState[]): AxisSelection {
  let forecastWithheld = 0;
  let unsupportedWithheld = 0;
  const qualified = SURVIVAL_AXES
    .flatMap((axisName) => {
      const axis = axes.find((candidate) => candidate.axis === axisName);
      if (!axis || !Number.isFinite(axis.level) || axis.level < GUIDANCE_LEVEL) return [];
      if (axis.threats.length === 0) {
        unsupportedWithheld += 1;
        return [];
      }
      if (axis.threats.some((threat) => isModeForecastThreatSourceEventId(threat.sourceEventId))) {
        forecastWithheld += 1;
        return [];
      }
      return [axis];
    })
    .sort((a, b) => (
      bandRank(b.band) - bandRank(a.band)
      || b.level - a.level
      || SURVIVAL_AXES.indexOf(a.axis) - SURVIVAL_AXES.indexOf(b.axis)
    ));
  return { axes: qualified, forecastWithheld, unsupportedWithheld };
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
  return { state, headline, summary, cards: [], semanticKey: `${state}|${summary}` };
}

import type { DeckCardView } from './deck-view';
import { OPTIONAL_ONBOARDING_SOURCES } from './onboarding-sources';
import { READINESS_FRESH_UPDATE_MS } from './readiness-constants';

export const KEYLESS_SOURCE_IDS = ['usgs', 'gdacs', 'open-meteo', 'gdelt-news'] as const;
export type KeylessSourceId = typeof KEYLESS_SOURCE_IDS[number];

export interface KeylessSourceStateLike {
  id: KeylessSourceId;
  status: 'fresh' | 'stale' | 'very_stale' | 'no_data' | 'disabled' | 'error';
  lastUpdateAt: number | null;
  lastError: string | null;
  latestItemCount: number;
  unknownReason: string | null;
}

export type KeylessSourceReadinessState = 'loading' | 'working' | 'degraded' | 'unknown';

export interface KeylessSourceReadiness {
  id: KeylessSourceId;
  name: string;
  state: KeylessSourceReadinessState;
  statusLabel: string;
  nextStep: string;
  canRetryAllData: boolean;
}

export type HomeShellReadinessState = 'loading' | 'ready' | 'attention' | 'empty';

export interface HomeShellReadinessView {
  state: HomeShellReadinessState;
  label: string;
  headline: string;
  summary: string;
  setupNote: string;
  sources: readonly KeylessSourceReadiness[];
  showRetryAll: boolean;
}

const SOURCE_METADATA: Readonly<Record<KeylessSourceId, { name: string; nextStep: string }>> = {
  usgs: { name: 'USGS Earthquakes', nextStep: 'Retry all data or open Earthquakes.' },
  gdacs: { name: 'GDACS Disasters', nextStep: 'Retry all data or open GDACS Disaster Alerts.' },
  'open-meteo': { name: 'Open-Meteo Weather', nextStep: 'Add a saved place or retry all data.' },
  'gdelt-news': { name: 'GDELT News', nextStep: 'Retry all data or open Live Intelligence.' },
};

const STARTUP_BUDGET_MS = 30_000;

const OPTIONAL_UNLOCKS = OPTIONAL_ONBOARDING_SOURCES
  .map((source) => `${source.name}: ${source.unlocks}`)
  .join(' ');

const SETUP_NOTE = 'These core public-source adapters do not require configured credentials; '
  + 'working now is shown only after a successful fresh adapter update. '
  + `Network and upstream availability still apply. Optional setup unlocks ${OPTIONAL_UNLOCKS}`;

/** Project runtime data-freshness evidence for the four first-run sources. */
export function buildKeylessSourceReadiness(
  snapshots: readonly KeylessSourceStateLike[],
  now: number,
  startupStartedAt: number,
): KeylessSourceReadiness[] {
  const byId = new Map(snapshots.map((source) => [source.id, source]));
  const withinBudget = Math.max(0, now - startupStartedAt) < STARTUP_BUDGET_MS;
  return KEYLESS_SOURCE_IDS.map((id) => {
    const meta = SOURCE_METADATA[id];
    const source = byId.get(id) ?? {
      id, status: 'no_data' as const, lastUpdateAt: null, lastError: null,
      latestItemCount: 0, unknownReason: null,
    };
    const successfulFresh = source.status === 'fresh'
      && source.lastUpdateAt !== null
      && now - source.lastUpdateAt >= 0
      && now - source.lastUpdateAt < READINESS_FRESH_UPDATE_MS
      && !source.lastError;
    if (successfulFresh) {
      const count = Math.max(0, source.latestItemCount);
      const itemWord = count === 1 ? 'item' : 'items';
      const countCopy = count === 0
        ? '0 items in latest update; not an all-clear signal'
        : `${count} ${itemWord} in latest update`;
      return {
        id, name: meta.name, state: 'working',
        statusLabel: `working now · ${countCopy}`,
        nextStep: 'Open the related panel to inspect the data.',
        canRetryAllData: false,
      };
    }
    if (withinBudget) {
      return {
        id, name: meta.name, state: 'loading',
        statusLabel: 'loading · waiting for a successful fresh update',
        nextStep: meta.nextStep,
        canRetryAllData: false,
      };
    }
    if (source.status === 'error' || source.status === 'stale' || source.status === 'very_stale') {
      let statusLabel = 'degraded · last successful update is stale';
      if (source.status === 'error') statusLabel = 'degraded · latest refresh failed';
      return {
        id, name: meta.name, state: 'degraded',
        statusLabel,
        nextStep: meta.nextStep,
        canRetryAllData: true,
      };
    }
    return {
      id, name: meta.name, state: 'unknown',
      statusLabel: source.unknownReason ?? 'unknown · no successful fresh update yet',
      nextStep: source.unknownReason ?? meta.nextStep,
      canRetryAllData: false,
    };
  });
}

export function buildHomeShellReadinessView(
  cards: readonly DeckCardView[],
  sources: readonly KeylessSourceReadiness[],
): HomeShellReadinessView {
  if (cards.length === 0 && sources.length === 0) {
    return {
      state: 'empty',
      label: 'First-run data readiness',
      headline: 'No Deck panels are pinned',
      summary: 'Pin a panel to inspect its data usefulness.',
      setupNote: SETUP_NOTE,
      sources,
      showRetryAll: false,
    };
  }

  const useful = cards.filter((card) => card.readiness === 'useful').length;
  const loading = cards.filter((card) => card.readiness === 'loading').length;
  const attention = cards.filter((card) => card.readiness === 'attention').length;
  const sourceLoading = sources.some((source) => source.state === 'loading');
  const sourceAttention = sources.some((source) => source.state === 'degraded' || source.state === 'unknown');

  let state: HomeShellReadinessState = 'ready';
  if (attention > 0 || sourceAttention) state = 'attention';
  else if (loading > 0 || sourceLoading) state = 'loading';

  let headline = 'Useful keyless coverage is working now';
  if (state === 'attention') headline = 'Some first-run coverage needs attention';
  else if (state === 'loading') headline = 'Keyless coverage is still loading';

  return {
    state,
    label: 'First-run data readiness',
    headline,
    summary: `${useful} useful Deck card${useful === 1 ? '' : 's'} · ${loading} loading · ${attention} need attention`,
    setupNote: SETUP_NOTE,
    sources,
    showRetryAll: cards.some((card) => card.canRetryAllData)
      || sources.some((source) => source.canRetryAllData),
  };
}

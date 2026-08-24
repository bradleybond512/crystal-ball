/**
 * Deck view-model — pure pin-list operations + adapter card
 * derivation for the home shell's pinned panel grid.
 *
 * Pure deterministic: no DOM, no fetch, no globals; `now` is always
 * caller-supplied so this stays fixture-testable.
 */

import { READINESS_FRESH_UPDATE_MS } from './readiness-constants';

export const DEFAULT_DECK_PINS: readonly string[] = [
  'live-news',
  'markets',
  'nws-alerts',
  'shortage-radar',
  'air-quality',
  'cyber-threats',
  'space-weather',
  'earthquakes',
  'crypto',
  'economic',
  'command-center',
  'watchlist',
];

/** A cold card has this long to publish its first panel-health report. */
export const DECK_STARTUP_BUDGET_MS = 30_000;

/** Explicit data contributors for default Deck cards; unmapped cards never infer usefulness. */
export const DECK_CONTRIBUTOR_SOURCE_IDS: Readonly<Record<string, readonly string[]>> = {
  'live-news': ['rss'],
  'nws-alerts': ['weather'],
  'air-quality': ['air-quality'],
  'cyber-threats': ['cyber_threats'],
  'space-weather': ['space-weather'],
  earthquakes: ['usgs'],
  economic: ['economic'],
};

export function parseDeckPins(raw: string | null | undefined, validIds: ReadonlySet<string>): string[] {
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const pins = parsed.filter((p): p is string => typeof p === 'string' && validIds.has(p));
        const deduped = [...new Set(pins)];
        if (deduped.length > 0) return deduped;
      }
    } catch {
      // corrupt storage → defaults
    }
  }
  return DEFAULT_DECK_PINS.filter((id) => validIds.has(id));
}

export function serializeDeckPins(pins: readonly string[]): string {
  return JSON.stringify(pins);
}

export function togglePin(pins: readonly string[], panelId: string): string[] {
  return pins.includes(panelId) ? pins.filter((p) => p !== panelId) : [...pins, panelId];
}

export function movePin(pins: readonly string[], panelId: string, direction: -1 | 1): string[] {
  const from = pins.indexOf(panelId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= pins.length) return [...pins];
  const next = [...pins];
  next.splice(from, 1);
  next.splice(to, 0, panelId);
  return next;
}

export type DeckCardTone = 'ok' | 'stale' | 'error' | 'unknown';

export interface DeckCardView {
  panelId: string;
  title: string;
  tone: DeckCardTone;
  /** Evidence from the panel registry only; never provider or data usability. */
  readiness: 'loading' | 'useful' | 'attention';
  hasRenderReport: boolean;
  /** True only when the existing global loadAllData wave could plausibly help. */
  canRetryAllData: boolean;
  statusLabel: string;
  narrative?: string;
}

/**
 * Structural subset of diagnostics' PanelHealth — keeps this module
 * decoupled from the registry's full type.
 */
export interface PanelHealthLike {
  panelId: string;
  status: string;
  lastRenderAt?: number;
  lastError?: string;
}

export interface ContributorEvidenceLike {
  sourceId: string;
  name: string;
  status: 'fresh' | 'stale' | 'very_stale' | 'no_data' | 'disabled' | 'error';
  lastUpdateAt: number | null;
  latestItemCount: number;
  lastError?: string | null;
}

export interface DeckCardInputs {
  /** DEFAULT_PANELS-shaped name lookup. */
  names: Readonly<Record<string, { name: string } | undefined>>;
  health: readonly PanelHealthLike[];
  narratives: Readonly<Record<string, string | undefined>>;
  contributors?: Readonly<Record<string, readonly ContributorEvidenceLike[] | undefined>>;
}

function isFreshContributor(source: ContributorEvidenceLike, now: number): boolean {
  if (source.status !== 'fresh' || source.lastUpdateAt === null || source.lastError) return false;
  const age = now - source.lastUpdateAt;
  return age >= 0 && age < READINESS_FRESH_UPDATE_MS;
}

function buildHealthyDeckCard(
  panelId: string,
  title: string,
  narrative: string | undefined,
  contributors: readonly ContributorEvidenceLike[],
  now: number,
  startupStartedAt: number,
): DeckCardView {
  const positive = contributors.find((source) => (
    isFreshContributor(source, now) && source.latestItemCount > 0
  ));
  if (positive) {
    const itemWord = positive.latestItemCount === 1 ? 'item' : 'items';
    return {
      panelId, title, tone: 'ok', readiness: 'useful',
      hasRenderReport: true, canRetryAllData: false,
      statusLabel: `data contributor working now · ${positive.name} · ${positive.latestItemCount} ${itemWord} in latest update`,
      narrative,
    };
  }
  const empty = contributors.find((source) => (
    isFreshContributor(source, now) && source.latestItemCount === 0
  ));
  if (empty) {
    return {
      panelId, title, tone: 'stale', readiness: 'attention',
      hasRenderReport: true, canRetryAllData: false,
      statusLabel: `panel rendered; ${empty.name} latest update returned 0 items · open panel`,
      narrative,
    };
  }
  const startupAge = Math.max(0, now - startupStartedAt);
  if (startupAge < DECK_STARTUP_BUDGET_MS) {
    return {
      panelId, title, tone: 'unknown', readiness: 'loading',
      hasRenderReport: true, canRetryAllData: false,
      statusLabel: `panel rendered; checking data contributors · ${formatAge(startupAge)} of ${formatAge(DECK_STARTUP_BUDGET_MS)}`,
      narrative,
    };
  }
  const canRetryAllData = contributors.some((source) => (
    source.status === 'error' || source.status === 'stale' || source.status === 'very_stale'
  ));
  return {
    panelId, title, tone: canRetryAllData ? 'stale' : 'unknown',
    readiness: 'attention', hasRenderReport: true, canRetryAllData,
    statusLabel: canRetryAllData
      ? 'panel rendered; contributor data unavailable · open panel'
      : 'panel rendered; data usefulness unverified · open panel',
    narrative,
  };
}

export function buildDeckCards(
  pins: readonly string[],
  inputs: DeckCardInputs,
  now: number,
  startupStartedAt = now,
): DeckCardView[] {
  const healthById = new Map(inputs.health.map((h) => [h.panelId, h]));
  return pins.map((panelId) => {
    const title = inputs.names[panelId]?.name ?? panelId;
    const narrative = inputs.narratives[panelId] ?? undefined;
    const h = healthById.get(panelId);
    if (h?.lastRenderAt === undefined) {
      const startupAge = Math.max(0, now - startupStartedAt);
      if (startupAge < DECK_STARTUP_BUDGET_MS) {
        return {
          panelId,
          title,
          tone: 'unknown' as const,
          readiness: 'loading' as const,
          hasRenderReport: false,
          canRetryAllData: false,
          statusLabel: `waiting for first panel render · ${formatAge(startupAge)} of ${formatAge(DECK_STARTUP_BUDGET_MS)}`,
          narrative,
        };
      }
      return {
        panelId,
        title,
        tone: 'unknown' as const,
        readiness: 'attention' as const,
        hasRenderReport: false,
        canRetryAllData: false,
        statusLabel: `no recent panel render after ${formatAge(DECK_STARTUP_BUDGET_MS)} · open panel`,
        narrative,
      };
    }
    const age = formatAge(now - h.lastRenderAt);
    if (h.status === 'failing' || h.status === 'unsafe') {
      const detail = h.lastError ? `panel-reported error · ${h.lastError}` : `panel-reported error · ${age} ago`;
      return {
        panelId, title, tone: 'error' as const, readiness: 'attention' as const,
        hasRenderReport: true, canRetryAllData: false, statusLabel: detail, narrative,
      };
    }
    if (h.status === 'healthy') {
      const contributors = inputs.contributors?.[panelId] ?? [];
      return buildHealthyDeckCard(panelId, title, narrative, contributors, now, startupStartedAt);
    }
    return {
      panelId, title, tone: 'stale' as const, readiness: 'attention' as const,
      hasRenderReport: true, canRetryAllData: false,
      statusLabel: `panel report ${h.status} · ${age} ago`, narrative,
    };
  });
}

export function formatAge(ms: number): string {
  if (ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

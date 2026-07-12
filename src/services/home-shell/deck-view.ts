/**
 * Deck view-model — pure pin-list operations + adapter card
 * derivation for the home shell's pinned panel grid.
 *
 * Pure deterministic: no DOM, no fetch, no globals; `now` is always
 * caller-supplied so this stays fixture-testable.
 */

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

export interface DeckCardInputs {
  /** DEFAULT_PANELS-shaped name lookup. */
  names: Readonly<Record<string, { name: string } | undefined>>;
  health: readonly PanelHealthLike[];
  narratives: Readonly<Record<string, string | undefined>>;
}

export function buildDeckCards(pins: readonly string[], inputs: DeckCardInputs, now: number): DeckCardView[] {
  const healthById = new Map(inputs.health.map((h) => [h.panelId, h]));
  return pins.map((panelId) => {
    const title = inputs.names[panelId]?.name ?? panelId;
    const narrative = inputs.narratives[panelId] ?? undefined;
    const h = healthById.get(panelId);
    if (h?.lastRenderAt === undefined) {
      return { panelId, title, tone: 'unknown' as const, statusLabel: 'not loaded', narrative };
    }
    const age = formatAge(now - h.lastRenderAt);
    if (h.status === 'failing' || h.status === 'unsafe') {
      const detail = h.lastError ? `error · ${h.lastError}` : `error · ${age}`;
      return { panelId, title, tone: 'error' as const, statusLabel: detail, narrative };
    }
    if (h.status === 'healthy') {
      return { panelId, title, tone: 'ok' as const, statusLabel: `live · ${age}`, narrative };
    }
    return { panelId, title, tone: 'stale' as const, statusLabel: `${h.status} · ${age}`, narrative };
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

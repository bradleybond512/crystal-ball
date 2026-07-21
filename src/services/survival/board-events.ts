// src/services/survival/board-events.ts
/**
 * Shared identity + adapter layer between the God's Vision board's rendered
 * markers and the personal lens (Grand-Strategy Survival OS, E4). The lens scores
 * `IncomingEvent`s; the globe renders Cesium/DeckGL entities. For lens tinting to
 * reach a marker, BOTH sides must agree on one stable id — `boardEntityId`.
 *
 * PR1 (this module) is the prerequisite for per-event styling: it gives every
 * survival-relevant board record a deterministic id (stamped on the Cesium entity
 * at creation) and a `toBoardIncomingEvent` adapter that feeds the SAME id into
 * the lens, so `buildLensStyleIndex(applyPersonalLens(...))` lookups hit.
 *
 * Pure: no Cesium/DOM/state.
 */
import type { IncomingEvent } from '../personal/personal-impact.ts';

/** Survival-relevant board record kinds the lens can score + style. */
export type BoardEventKind =
  | 'weather' | 'earthquake' | 'conflict' | 'gdacs' | 'disease'
  | 'wildfire' | 'outage' | 'cyber' | 'flight' | 'vessel';

/** Board kind → the lens domain string (which drives `axisForDomain`). */
export const BOARD_EVENT_DOMAINS: Record<BoardEventKind, string> = {
  weather: 'weather',
  earthquake: 'weather', // physical_safety axis
  conflict: 'conflict',
  gdacs: 'disaster',
  disease: 'disease',
  wildfire: 'wildfire',
  outage: 'grid',
  cyber: 'cyber',
  flight: 'aviation',
  vessel: 'maritime',
};

const SEP = ':';

/**
 * Stable board id for an entity/event: `<kind>:<encodeURIComponent(rawId)>`.
 * Deterministic AND injective — the raw id is percent-encoded, so the only bare
 * `:` is the kind separator and distinct raw ids never collapse to the same id
 * (which would throw on `entities.add` and mis-key lens styling). The same record
 * always maps to the same id, so the Cesium entity and the lens view line up.
 */
export function boardEntityId(kind: BoardEventKind, rawId: string | number): string {
  return `${kind}${SEP}${encodeURIComponent(String(rawId).trim())}`;
}

/** Reverse of `boardEntityId` (lossless round-trip), or null if not a board id. */
export function parseBoardEntityId(id: string): { kind: BoardEventKind; rawId: string } | null {
  const idx = id.indexOf(SEP);
  if (idx <= 0) return null;
  const kind = id.slice(0, idx);
  if (!(kind in BOARD_EVENT_DOMAINS)) return null;
  let rawId: string;
  try {
    rawId = decodeURIComponent(id.slice(idx + 1));
  } catch {
    return null; // malformed percent-encoding is not a valid board id
  }
  return { kind: kind as BoardEventKind, rawId };
}

export function isBoardEntityId(id: string): boolean {
  return parseBoardEntityId(id) !== null;
}

export interface BoardEventInput {
  /** Per-record unique id (e.g. USGS quake id, ACLED event id). */
  rawId: string | number;
  severity: number;
  at: number;
  description?: string;
  location?: { latitude: number; longitude: number; radiusKm?: number };
  affectedSymbols?: readonly string[];
  affectedEntities?: readonly string[];
}

/**
 * Adapt a survival-relevant board record into an `IncomingEvent` the lens scores,
 * keyed by the SAME `boardEntityId` stamped on the globe entity. Feed the result
 * into `setRecentEvents` so `applyPersonalLens` produces a `LensView` whose
 * eventId matches the marker's id.
 */
export function toBoardIncomingEvent(kind: BoardEventKind, input: BoardEventInput): IncomingEvent {
  return {
    eventId: boardEntityId(kind, input.rawId),
    description: input.description ?? kind,
    domain: BOARD_EVENT_DOMAINS[kind],
    severity: input.severity,
    at: input.at,
    location: input.location,
    affectedSymbols: input.affectedSymbols,
    affectedEntities: input.affectedEntities,
  };
}

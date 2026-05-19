/**
 * Seven-Layer Observability Model — tracks Crystal Ball's ability to
 * observe each of the 7 planetary intelligence domains: physical,
 * political, economic, social, cyber, biological, space.
 *
 * Observability score (0–1) reflects how many feeds are active,
 * how fresh the data is, and how broad the regional coverage is.
 * Scores below 0.5 surface in getCoverageGaps() so operators know
 * where the blind spots are before relying on downstream scores.
 *
 * Pure store with injectable Storage and clock — no DOM, no fetch.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type Layer =
  | 'physical'
  | 'political'
  | 'economic'
  | 'social'
  | 'cyber'
  | 'biological'
  | 'space';

export const LAYERS: Layer[] = [
  'physical',
  'political',
  'economic',
  'social',
  'cyber',
  'biological',
  'space',
];

export interface LayerState {
  layer: Layer;
  observabilityScore: number;
  feedCount: number;
  freshnessScore: number;
  coverageRegions: string[];
  alertsLast24h: number;
  lastUpdated: number;
}

export interface ObservabilitySnapshot {
  timestamp: number;
  layers: LayerState[];
  overallScore: number;
  weakestLayer: string;
  strongestLayer: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SevenLayerOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-seven-layer-obs';
export const MAX_SNAPSHOTS = 500;
const MAX_HISTORY_PER_LAYER = 100;

// ── Seed data ────────────────────────────────────────────────────────────

type SeedEntry = Omit<LayerState, 'layer' | 'lastUpdated'>;

const SEED: Record<Layer, SeedEntry> = {
  physical: {
    observabilityScore: 0.75,
    feedCount: 48,
    freshnessScore: 0.88,
    coverageRegions: ['North America', 'Europe', 'Asia Pacific', 'Middle East'],
    alertsLast24h: 12,
  },
  political: {
    observabilityScore: 0.65,
    feedCount: 31,
    freshnessScore: 0.72,
    coverageRegions: ['North America', 'Europe', 'Asia Pacific', 'Latin America'],
    alertsLast24h: 8,
  },
  economic: {
    observabilityScore: 0.7,
    feedCount: 38,
    freshnessScore: 0.81,
    coverageRegions: ['G7', 'BRICS', 'ASEAN', 'Middle East'],
    alertsLast24h: 15,
  },
  social: {
    observabilityScore: 0.45,
    feedCount: 19,
    freshnessScore: 0.61,
    coverageRegions: ['North America', 'Europe'],
    alertsLast24h: 4,
  },
  cyber: {
    observabilityScore: 0.6,
    feedCount: 27,
    freshnessScore: 0.79,
    coverageRegions: ['North America', 'Europe', 'Asia Pacific'],
    alertsLast24h: 22,
  },
  biological: {
    observabilityScore: 0.55,
    feedCount: 23,
    freshnessScore: 0.68,
    coverageRegions: ['North America', 'Europe', 'Asia Pacific', 'Africa'],
    alertsLast24h: 3,
  },
  space: {
    observabilityScore: 0.4,
    feedCount: 11,
    freshnessScore: 0.55,
    coverageRegions: ['Low Earth Orbit', 'Geostationary Belt'],
    alertsLast24h: 1,
  },
};

// Which regions we expect each layer to cover — gaps below coverage threshold
// surface in getCoverageGaps().
const EXPECTED_REGIONS: Record<Layer, string[]> = {
  physical: ['North America', 'Europe', 'Asia Pacific', 'Middle East', 'Africa', 'Latin America'],
  political: ['North America', 'Europe', 'Asia Pacific', 'Middle East', 'Africa', 'Latin America'],
  economic: ['G7', 'BRICS', 'ASEAN', 'Middle East', 'Africa', 'Latin America'],
  social: ['North America', 'Europe', 'Asia Pacific', 'Middle East', 'Africa', 'Latin America'],
  cyber: ['North America', 'Europe', 'Asia Pacific', 'Russia', 'China', 'Middle East'],
  biological: ['North America', 'Europe', 'Asia Pacific', 'Africa', 'Latin America', 'South Asia'],
  space: ['Low Earth Orbit', 'Geostationary Belt', 'Lunar Space', 'Deep Space'],
};

// ── Persistence helpers ──────────────────────────────────────────────────

interface PersistedStore {
  states: Record<string, LayerState>;
  history: Record<string, LayerState[]>;
  snapshots: ObservabilitySnapshot[];
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneState(s: LayerState): LayerState {
  return { ...s, coverageRegions: [...s.coverageRegions] };
}

function cloneSnapshot(s: ObservabilitySnapshot): ObservabilitySnapshot {
  return { ...s, layers: s.layers.map((l) => cloneState(l)) };
}

function deserializeLayerState(raw: unknown): LayerState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!LAYERS.includes(r.layer as Layer)) return null;
  if (typeof r.observabilityScore !== 'number') return null;
  if (typeof r.feedCount !== 'number') return null;
  if (typeof r.freshnessScore !== 'number') return null;
  if (!Array.isArray(r.coverageRegions)) return null;
  if (typeof r.alertsLast24h !== 'number') return null;
  if (typeof r.lastUpdated !== 'number') return null;
  return {
    layer: r.layer as Layer,
    observabilityScore: r.observabilityScore,
    feedCount: r.feedCount,
    freshnessScore: r.freshnessScore,
    coverageRegions: (r.coverageRegions as unknown[]).filter((v): v is string => typeof v === 'string'),
    alertsLast24h: r.alertsLast24h,
    lastUpdated: r.lastUpdated,
  };
}

function parseStates(raw: unknown): Map<Layer, LayerState> {
  const out = new Map<Layer, LayerState>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!LAYERS.includes(k as Layer)) continue;
    const s = deserializeLayerState(v);
    if (s) out.set(k as Layer, s);
  }
  return out;
}

function parseHistory(raw: unknown): Map<Layer, LayerState[]> {
  const out = new Map<Layer, LayerState[]>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!LAYERS.includes(k as Layer) || !Array.isArray(v)) continue;
    const entries = (v as unknown[])
      .map((e) => deserializeLayerState(e))
      .filter((e): e is LayerState => e !== null);
    out.set(k as Layer, entries);
  }
  return out;
}

function parseSnapshot(sn: unknown): ObservabilitySnapshot | null {
  if (!sn || typeof sn !== 'object' || Array.isArray(sn)) return null;
  const s = sn as Record<string, unknown>;
  if (typeof s.timestamp !== 'number') return null;
  if (!Array.isArray(s.layers)) return null;
  if (typeof s.overallScore !== 'number') return null;
  if (typeof s.weakestLayer !== 'string') return null;
  if (typeof s.strongestLayer !== 'string') return null;
  const layers = (s.layers as unknown[])
    .map((l) => deserializeLayerState(l))
    .filter((l): l is LayerState => l !== null);
  if (layers.length !== LAYERS.length) return null;
  return { timestamp: s.timestamp, layers, overallScore: s.overallScore, weakestLayer: s.weakestLayer, strongestLayer: s.strongestLayer };
}

function parseSnapshots(raw: unknown): ObservabilitySnapshot[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((sn) => parseSnapshot(sn)).filter((s): s is ObservabilitySnapshot => s !== null);
}

function rehydrate(storage: StorageLike | null): {
  states: Map<Layer, LayerState>;
  history: Map<Layer, LayerState[]>;
  snapshots: ObservabilitySnapshot[];
} {
  const empty = {
    states: new Map<Layer, LayerState>(),
    history: new Map<Layer, LayerState[]>(),
    snapshots: [] as ObservabilitySnapshot[],
  };
  if (!storage) return empty;
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return empty; }
  if (!raw) return empty;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return empty; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const p = parsed as Record<string, unknown>;
  return {
    states: parseStates(p.states),
    history: parseHistory(p.history),
    snapshots: parseSnapshots(p.snapshots),
  };
}

// ── Class ────────────────────────────────────────────────────────────────

export class SevenLayerObservabilityModel {
  private static _instance: SevenLayerObservabilityModel | null = null;

  static getInstance(): SevenLayerObservabilityModel {
    SevenLayerObservabilityModel._instance ??= new SevenLayerObservabilityModel();
    return SevenLayerObservabilityModel._instance;
  }

  static _resetSingletonForTests(): void {
    SevenLayerObservabilityModel._instance = null;
  }

  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly states: Map<Layer, LayerState>;
  private readonly history: Map<Layer, LayerState[]>;
  private readonly snapshots: ObservabilitySnapshot[];

  constructor(options: SevenLayerOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.clock = options.now ?? (() => Date.now());
    const persisted = rehydrate(this.storage);
    this.states = persisted.states;
    this.history = persisted.history;
    this.snapshots = persisted.snapshots;
    const now = this.clock();
    for (const layer of LAYERS) {
      if (!this.states.has(layer)) {
        this.states.set(layer, { layer, lastUpdated: now, ...SEED[layer] });
      }
      if (!this.history.has(layer)) {
        this.history.set(layer, []);
      }
    }
  }

  updateLayer(layer: Layer, update: Partial<LayerState>): void {
    const current = this.states.get(layer)!;
    // Spread update first; then force layer + lastUpdated so callers can't override them.
    const next: LayerState = { ...current, ...update, layer, lastUpdated: this.clock() };
    next.observabilityScore = Math.max(0, Math.min(1, next.observabilityScore));
    next.freshnessScore = Math.max(0, Math.min(1, next.freshnessScore));
    if (next.coverageRegions) next.coverageRegions = [...next.coverageRegions];
    const layerHistory = this.history.get(layer)!;
    layerHistory.push(cloneState(current));
    if (layerHistory.length > MAX_HISTORY_PER_LAYER) {
      layerHistory.splice(0, layerHistory.length - MAX_HISTORY_PER_LAYER);
    }
    this.states.set(layer, next);
    this.persist();
  }

  getSnapshot(): ObservabilitySnapshot {
    const layers = LAYERS.map((l) => cloneState(this.states.get(l)!));
    const scores = layers.map((l) => l.observabilityScore);
    const overallScore = scores.reduce((s, v) => s + v, 0) / scores.length;

    // LAYERS always has 7 entries seeded in the constructor — this is unreachable
    if (layers.length === 0) throw new Error('layer map is empty');
    let weakestLayer: string = layers[0]!.layer;
    let strongestLayer: string = layers[0]!.layer;
    let minScore = layers[0]!.observabilityScore;
    let maxScore = layers[0]!.observabilityScore;
    for (const ls of layers) {
      if (ls.observabilityScore < minScore) {
        minScore = ls.observabilityScore;
        weakestLayer = ls.layer;
      }
      if (ls.observabilityScore > maxScore) {
        maxScore = ls.observabilityScore;
        strongestLayer = ls.layer;
      }
    }

    const snapshot: ObservabilitySnapshot = {
      timestamp: this.clock(),
      layers,
      overallScore,
      weakestLayer,
      strongestLayer,
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots.splice(0, this.snapshots.length - MAX_SNAPSHOTS);
    }
    this.persist();
    return cloneSnapshot(snapshot);
  }

  getLayerHistory(layer: Layer, limit = 20): LayerState[] {
    const hist = this.history.get(layer) ?? [];
    const start = Math.max(0, hist.length - limit);
    return hist.slice(start).map((s) => cloneState(s));
  }

  getCoverageGaps(): { layer: string; missingRegions: string[] }[] {
    const result: { layer: string; missingRegions: string[] }[] = [];
    for (const layer of LAYERS) {
      const state = this.states.get(layer)!;
      if (state.observabilityScore < 0.5) {
        const covered = new Set(state.coverageRegions);
        const missing = EXPECTED_REGIONS[layer].filter((r) => !covered.has(r));
        result.push({ layer, missingRegions: missing });
      }
    }
    return result;
  }

  private persist(): void {
    if (!this.storage) return;
    const store: PersistedStore = {
      states: Object.fromEntries(this.states.entries()) as Record<string, LayerState>,
      history: Object.fromEntries(
        [...this.history.entries()].map(([k, v]) => [k, v]),
      ) as Record<string, LayerState[]>,
      snapshots: this.snapshots,
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch { /* quota / private-mode — non-critical */ }
  }
}

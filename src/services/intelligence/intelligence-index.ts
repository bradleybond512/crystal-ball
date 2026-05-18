/**
 * Intelligence Index — unified searchable catalog of intelligence
 * artifacts (situations, observations, hypotheses, counterfactuals,
 * analyst notes, calendar events, compound events). Producers call
 * `index(...)` whenever an artifact is created or updated; consumers
 * call `search(...)` to discover related artifacts across types.
 *
 * Pure store: injectable Storage + clock. Entries persist in a
 * 5000-record ring buffer under `wm-intelligence-index`. Search is a
 * deterministic weighted-substring match across title (3pts), tags
 * (2pts), and summary (1pt); ties break on `indexedAt` desc.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type ArtifactType =
  | 'situation'
  | 'observation'
  | 'hypothesis'
  | 'counterfactual'
  | 'note'
  | 'calendar-event'
  | 'compound-event';

export interface IndexedArtifact {
  id: string;
  artifactId: string;
  artifactType: ArtifactType;
  title: string;
  summary: string;
  domain: string;
  tags: string[];
  indexedAt: number;
  relevanceScore?: number;
}

export interface SearchFilter {
  artifactType?: ArtifactType;
  domain?: string;
}

export interface SearchResult {
  artifact: IndexedArtifact;
  score: number;
  matchedFields: string[];
}

export interface IndexStats {
  total: number;
  byType: Record<ArtifactType, number>;
  lastIndexedAt: number | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface IntelligenceIndexOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface IntelligenceIndexService {
  index(artifact: Omit<IndexedArtifact, 'id' | 'indexedAt'>): IndexedArtifact;
  search(query: string, filter?: SearchFilter, limit?: number): SearchResult[];
  getByType(artifactType: ArtifactType, limit?: number): IndexedArtifact[];
  getByDomain(domain: string, limit?: number): IndexedArtifact[];
  remove(artifactId: string, artifactType: ArtifactType): void;
  getStats(): IndexStats;
  subscribe(cb: (entries: IndexedArtifact[]) => void): void;
  unsubscribe(cb: (entries: IndexedArtifact[]) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-intelligence-index';
export const MAX_ENTRIES = 5000;
export const DEFAULT_SEARCH_LIMIT = 20;
export const TITLE_MATCH_SCORE = 3;
export const TAG_MATCH_SCORE = 2;
export const SUMMARY_MATCH_SCORE = 1;

const ALL_TYPES: readonly ArtifactType[] = [
  'situation',
  'observation',
  'hypothesis',
  'counterfactual',
  'note',
  'calendar-event',
  'compound-event',
];

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(nowMs: number): string {
  _idCounter += 1;
  return `idx-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function isArtifactType(t: unknown): t is ArtifactType {
  return typeof t === 'string' && (ALL_TYPES as readonly string[]).includes(t);
}

function cloneArtifact(a: IndexedArtifact): IndexedArtifact {
  return { ...a, tags: [...a.tags] };
}

function emptyByType(): Record<ArtifactType, number> {
  const out = {} as Record<ArtifactType, number>;
  for (const t of ALL_TYPES) out[t] = 0;
  return out;
}

function entryKey(artifactId: string, artifactType: ArtifactType): string {
  return `${artifactType}|${artifactId}`;
}

function deserialize(raw: unknown): IndexedArtifact | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.artifactId !== 'string') return null;
  if (!isArtifactType(r.artifactType)) return null;
  if (typeof r.indexedAt !== 'number') return null;
  const tags = Array.isArray(r.tags)
    ? r.tags.filter((t): t is string => typeof t === 'string')
    : [];
  return {
    id: r.id,
    artifactId: r.artifactId,
    artifactType: r.artifactType,
    title: typeof r.title === 'string' ? r.title : '',
    summary: typeof r.summary === 'string' ? r.summary : '',
    domain: typeof r.domain === 'string' ? r.domain : 'unknown',
    tags,
    indexedAt: r.indexedAt,
    relevanceScore: typeof r.relevanceScore === 'number' ? r.relevanceScore : undefined,
  };
}

function rehydrate(storage: StorageLike | null): IndexedArtifact[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: IndexedArtifact[] = [];
  for (const p of parsed) {
    const d = deserialize(p);
    if (d) out.push(d);
  }
  return out;
}

function scoreArtifact(artifact: IndexedArtifact, queryLower: string): { score: number; matchedFields: string[] } {
  const matchedFields: string[] = [];
  let score = 0;
  if (artifact.title.toLowerCase().includes(queryLower)) {
    score += TITLE_MATCH_SCORE;
    matchedFields.push('title');
  }
  if (artifact.tags.some((t) => t.toLowerCase().includes(queryLower))) {
    score += TAG_MATCH_SCORE;
    matchedFields.push('tags');
  }
  if (artifact.summary.toLowerCase().includes(queryLower)) {
    score += SUMMARY_MATCH_SCORE;
    matchedFields.push('summary');
  }
  return { score, matchedFields };
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createIntelligenceIndexService(
  options: IntelligenceIndexOptions = {},
): IntelligenceIndexService {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const entries: IndexedArtifact[] = rehydrate(storage);
  const byKey = new Map<string, IndexedArtifact>();
  for (const e of entries) byKey.set(entryKey(e.artifactId, e.artifactType), e);
  const listeners = new Set<(entries: IndexedArtifact[]) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function capRingBuffer(): void {
    if (entries.length <= MAX_ENTRIES) return;
    const drop = entries.length - MAX_ENTRIES;
    const removed = entries.splice(0, drop);
    for (const r of removed) byKey.delete(entryKey(r.artifactId, r.artifactType));
  }

  function notify(): void {
    if (listeners.size === 0) return;
    const snapshot = entries.map((e) => cloneArtifact(e));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  return {
    index(input): IndexedArtifact {
      const nowMs = clock();
      const key = entryKey(input.artifactId, input.artifactType);
      const existing = byKey.get(key);
      let artifact: IndexedArtifact;
      if (existing) {
        // Upsert: update fields in place, preserve id, refresh indexedAt.
        existing.title = input.title;
        existing.summary = input.summary;
        existing.domain = input.domain;
        existing.tags = [...input.tags];
        existing.indexedAt = nowMs;
        existing.relevanceScore = input.relevanceScore;
        // Move to end so LIFO ordering reflects the latest update.
        const idx = entries.indexOf(existing);
        if (idx !== -1) {
          entries.splice(idx, 1);
          entries.push(existing);
        }
        artifact = existing;
      } else {
        artifact = {
          id: nextId(nowMs),
          artifactId: input.artifactId,
          artifactType: input.artifactType,
          title: input.title,
          summary: input.summary,
          domain: input.domain,
          tags: [...input.tags],
          indexedAt: nowMs,
          relevanceScore: input.relevanceScore,
        };
        entries.push(artifact);
        byKey.set(key, artifact);
        capRingBuffer();
      }
      persist();
      notify();
      return cloneArtifact(artifact);
    },

    search(query, filter, limit): SearchResult[] {
      const trimmed = query.trim().toLowerCase();
      if (trimmed.length === 0) return [];
      const cap = limit ?? DEFAULT_SEARCH_LIMIT;
      const matches: SearchResult[] = [];
      for (const e of entries) {
        if (filter?.artifactType && e.artifactType !== filter.artifactType) continue;
        if (filter?.domain && e.domain !== filter.domain) continue;
        const { score, matchedFields } = scoreArtifact(e, trimmed);
        if (score === 0) continue;
        matches.push({ artifact: cloneArtifact(e), score, matchedFields });
      }
      matches.sort((a, b) =>
        b.score - a.score
        || b.artifact.indexedAt - a.artifact.indexedAt);
      return matches.slice(0, cap);
    },

    getByType(artifactType, limit): IndexedArtifact[] {
      const out: IndexedArtifact[] = [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e?.artifactType !== artifactType) continue;
        out.push(cloneArtifact(e));
        if (limit !== undefined && out.length >= limit) break;
      }
      return out;
    },

    getByDomain(domain, limit): IndexedArtifact[] {
      const out: IndexedArtifact[] = [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e?.domain !== domain) continue;
        out.push(cloneArtifact(e));
        if (limit !== undefined && out.length >= limit) break;
      }
      return out;
    },

    remove(artifactId, artifactType): void {
      const key = entryKey(artifactId, artifactType);
      const existing = byKey.get(key);
      if (!existing) return;
      const idx = entries.indexOf(existing);
      if (idx !== -1) entries.splice(idx, 1);
      byKey.delete(key);
      persist();
      notify();
    },

    getStats(): IndexStats {
      const byType = emptyByType();
      let lastIndexedAt: number | null = null;
      for (const e of entries) {
        byType[e.artifactType] += 1;
        if (lastIndexedAt === null || e.indexedAt > lastIndexedAt) lastIndexedAt = e.indexedAt;
      }
      return { total: entries.length, byType, lastIndexedAt };
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Singleton ────────────────────────────────────────────────────────────

let _singleton: IntelligenceIndexService | null = null;

export function getIntelligenceIndexService(): IntelligenceIndexService {
  _singleton ??= createIntelligenceIndexService();
  return _singleton;
}

export function resetIntelligenceIndexServiceForTests(): void {
  _singleton = null;
}

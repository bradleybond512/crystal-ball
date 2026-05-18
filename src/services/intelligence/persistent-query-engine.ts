/**
 * Persistent Query Engine — operators define saved "alert-me-when"
 * queries that auto-evaluate against incoming observations and
 * Situations. When a query matches, a QueryMatch record is created
 * and the query's matchCount + lastMatchedAt are updated. This is
 * the standing-query / continuous-intelligence layer.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 * Persists saved queries under `wm-saved-queries` and matches
 * under `wm-query-matches` (max 2000 ring buffer). Defensive
 * deserialise + corrupt-blob recovery + listener crash isolation.
 */

// ── Public types ──────────────────────────────────────────────────────

export type QueryField = 'domain' | 'severity' | 'region' | 'keyword';
export type QueryOperator = 'equals' | 'contains' | 'gte';
export type Combinator = 'AND' | 'OR';
export type SourceType = 'observation' | 'situation';

export interface QueryCondition {
  field: QueryField;
  operator: QueryOperator;
  value: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  conditions: QueryCondition[];
  combinator: Combinator;
  enabled: boolean;
  createdAt: number;
  lastMatchedAt?: number;
  matchCount: number;
}

export interface QueryMatch {
  id: string;
  queryId: string;
  queryName: string;
  sourceId: string;
  sourceType: SourceType;
  matchedAt: number;
  fieldSnapshot: Record<string, string>;
}

export interface EvaluationSource {
  id: string;
  type: SourceType;
  domain: string;
  severity: string;
  region?: string;
  title?: string;
}

export interface QueryEngineStats {
  totalQueries: number;
  enabledQueries: number;
  totalMatches: number;
  topQuery: { id: string; name: string; matchCount: number } | null;
}

export type QueryInput = Omit<SavedQuery, 'id' | 'createdAt' | 'matchCount'>;
export type QueryUpdate = Partial<Pick<SavedQuery, 'name' | 'conditions' | 'combinator' | 'enabled'>>;

export interface QueryEngineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type QueryEngineListener = (match: QueryMatch) => void;

// ── Constants ─────────────────────────────────────────────────────────

export const QUERIES_STORAGE_KEY = 'wm-saved-queries';
export const MATCHES_STORAGE_KEY = 'wm-query-matches';
export const MAX_MATCHES = 2000;

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ── Helpers ───────────────────────────────────────────────────────────

let queryCounter = 0;
let matchCounter = 0;
function makeQueryId(now: number): string {
  queryCounter += 1;
  return `q-${now}-${queryCounter}`;
}
function makeMatchId(now: number): string {
  matchCounter += 1;
  return `m-${now}-${matchCounter}`;
}

function severityRank(s: string): number {
  return SEVERITY_RANK[s.toLowerCase()] ?? 0;
}

function fieldValue(source: EvaluationSource, field: QueryField): string {
  switch (field) {
    case 'domain': { return source.domain;
    }
    case 'severity': { return source.severity;
    }
    case 'region': { return source.region ?? '';
    }
    case 'keyword': { return source.title ?? '';
    }
  }
}

/** Returns true when the source satisfies the condition. */
export function evaluateCondition(source: EvaluationSource, cond: QueryCondition): boolean {
  const raw = fieldValue(source, cond.field);
  if (cond.operator === 'gte') {
    if (cond.field !== 'severity') return false;
    return severityRank(raw) >= severityRank(cond.value);
  }
  const lhs = raw.toLowerCase();
  const rhs = cond.value.toLowerCase();
  if (cond.operator === 'equals') return lhs === rhs;
  return lhs.includes(rhs);
}

function isStringArrayObject(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object') return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

function isValidCondition(v: unknown): v is QueryCondition {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  const fields: QueryField[] = ['domain', 'severity', 'region', 'keyword'];
  const ops: QueryOperator[] = ['equals', 'contains', 'gte'];
  return (
    typeof r.field === 'string' && fields.includes(r.field as QueryField) &&
    typeof r.operator === 'string' && ops.includes(r.operator as QueryOperator) &&
    typeof r.value === 'string'
  );
}

function isValidQuery(v: unknown): v is SavedQuery {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string') return false;
  if (typeof r.name !== 'string') return false;
  if (!Array.isArray(r.conditions)) return false;
  if (!r.conditions.every((c) => isValidCondition(c))) return false;
  if (r.combinator !== 'AND' && r.combinator !== 'OR') return false;
  if (typeof r.enabled !== 'boolean') return false;
  if (typeof r.createdAt !== 'number') return false;
  if (typeof r.matchCount !== 'number') return false;
  if (r.lastMatchedAt !== undefined && typeof r.lastMatchedAt !== 'number') return false;
  return true;
}

function isValidMatch(v: unknown): v is QueryMatch {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.queryId === 'string' &&
    typeof r.queryName === 'string' &&
    typeof r.sourceId === 'string' &&
    (r.sourceType === 'observation' || r.sourceType === 'situation') &&
    typeof r.matchedAt === 'number' &&
    isStringArrayObject(r.fieldSnapshot)
  );
}

function snapshotFields(source: EvaluationSource): Record<string, string> {
  const snap: Record<string, string> = {
    domain: source.domain,
    severity: source.severity,
  };
  if (source.region !== undefined) snap.region = source.region;
  if (source.title !== undefined) snap.title = source.title;
  return snap;
}

function cloneQuery(q: SavedQuery): SavedQuery {
  return {
    ...q,
    conditions: q.conditions.map((c) => ({ ...c })),
  };
}

function cloneMatch(m: QueryMatch): QueryMatch {
  return { ...m, fieldSnapshot: { ...m.fieldSnapshot } };
}

// ── Service ───────────────────────────────────────────────────────────

export class PersistentQueryEngineService {
  private readonly storage: QueryEngineStorage;
  private readonly clock: () => number;
  private readonly listeners = new Set<QueryEngineListener>();
  private queries: SavedQuery[] = [];
  private matches: QueryMatch[] = [];

  constructor(storage: QueryEngineStorage, clock: () => number = () => Date.now()) {
    this.storage = storage;
    this.clock = clock;
    this.hydrate();
  }

  save(input: QueryInput): SavedQuery {
    const now = this.clock();
    const query: SavedQuery = {
      id: makeQueryId(now),
      name: input.name,
      conditions: input.conditions.map((c) => ({ ...c })),
      combinator: input.combinator,
      enabled: input.enabled,
      createdAt: now,
      matchCount: 0,
    };
    this.queries.push(query);
    this.persistQueries();
    return cloneQuery(query);
  }

  update(id: string, updates: QueryUpdate): SavedQuery | null {
    const idx = this.queries.findIndex((q) => q.id === id);
    if (idx === -1) return null;
    const existing = this.queries[idx];
    if (!existing) return null;
    const next: SavedQuery = {
      ...existing,
      name: updates.name ?? existing.name,
      conditions: updates.conditions ? updates.conditions.map((c) => ({ ...c })) : existing.conditions,
      combinator: updates.combinator ?? existing.combinator,
      enabled: updates.enabled ?? existing.enabled,
    };
    this.queries[idx] = next;
    this.persistQueries();
    return cloneQuery(next);
  }

  delete(id: string): boolean {
    const idx = this.queries.findIndex((q) => q.id === id);
    if (idx === -1) return false;
    this.queries.splice(idx, 1);
    this.persistQueries();
    return true;
  }

  evaluate(source: EvaluationSource): QueryMatch[] {
    const now = this.clock();
    const matchedQueries: QueryMatch[] = [];
    for (const query of this.queries) {
      if (!query.enabled) continue;
      if (!matchesQuery(source, query)) continue;
      const match: QueryMatch = {
        id: makeMatchId(now),
        queryId: query.id,
        queryName: query.name,
        sourceId: source.id,
        sourceType: source.type,
        matchedAt: now,
        fieldSnapshot: snapshotFields(source),
      };
      this.matches.push(match);
      query.matchCount += 1;
      query.lastMatchedAt = now;
      matchedQueries.push(match);
      this.notify(match);
    }
    if (this.matches.length > MAX_MATCHES) {
      this.matches.splice(0, this.matches.length - MAX_MATCHES);
    }
    if (matchedQueries.length > 0) {
      this.persistQueries();
      this.persistMatches();
    }
    return matchedQueries.map((m) => cloneMatch(m));
  }

  getQueries(): SavedQuery[] {
    return this.queries.map((q) => cloneQuery(q));
  }

  getMatches(queryId?: string, limit?: number): QueryMatch[] {
    let pool = this.matches;
    if (queryId !== undefined) pool = pool.filter((m) => m.queryId === queryId);
    const lifo: QueryMatch[] = [];
    for (let i = pool.length - 1; i >= 0; i--) {
      const m = pool[i];
      if (m) lifo.push(m);
    }
    const sliced = typeof limit === 'number' && limit >= 0 ? lifo.slice(0, limit) : lifo;
    return sliced.map((m) => cloneMatch(m));
  }

  getStats(): QueryEngineStats {
    const totalQueries = this.queries.length;
    const enabledQueries = this.queries.filter((q) => q.enabled).length;
    const totalMatches = this.matches.length;
    let topQuery: QueryEngineStats['topQuery'] = null;
    for (const q of this.queries) {
      if (q.matchCount === 0) continue;
      if (topQuery === null || q.matchCount > topQuery.matchCount) {
        topQuery = { id: q.id, name: q.name, matchCount: q.matchCount };
      }
    }
    return { totalQueries, enabledQueries, totalMatches, topQuery };
  }

  subscribe(cb: QueryEngineListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private hydrate(): void {
    this.queries = this.hydrateOne(QUERIES_STORAGE_KEY, isValidQuery);
    const matches = this.hydrateOne(MATCHES_STORAGE_KEY, isValidMatch);
    this.matches = matches.slice(-MAX_MATCHES);
  }

  private hydrateOne<T>(key: string, validator: (v: unknown) => v is T): T[] {
    let raw: string | null;
    try {
      raw = this.storage.getItem(key);
    } catch {
      return [];
    }
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v) => validator(v));
    } catch {
      try { this.storage.removeItem(key); } catch { /* noop */ }
      return [];
    }
  }

  private persistQueries(): void {
    try { this.storage.setItem(QUERIES_STORAGE_KEY, JSON.stringify(this.queries)); }
    catch { /* best-effort */ }
  }

  private persistMatches(): void {
    try { this.storage.setItem(MATCHES_STORAGE_KEY, JSON.stringify(this.matches)); }
    catch { /* best-effort */ }
  }

  private notify(match: QueryMatch): void {
    for (const listener of this.listeners) {
      try { listener(cloneMatch(match)); }
      catch { /* crash isolation */ }
    }
  }
}

function matchesQuery(source: EvaluationSource, query: SavedQuery): boolean {
  if (query.conditions.length === 0) return false;
  if (query.combinator === 'AND') {
    return query.conditions.every((c) => evaluateCondition(source, c));
  }
  return query.conditions.some((c) => evaluateCondition(source, c));
}

// ── Singleton ─────────────────────────────────────────────────────────

let singleton: PersistentQueryEngineService | null = null;

function defaultStorage(): QueryEngineStorage {
  if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: QueryEngineStorage }).localStorage) {
    return (globalThis as unknown as { localStorage: QueryEngineStorage }).localStorage;
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) ?? null : null),
    setItem: (k, v) => { mem.set(k, v); },
    removeItem: (k) => { mem.delete(k); },
  };
}

export function getPersistentQueryEngineService(): PersistentQueryEngineService {
  singleton ??= new PersistentQueryEngineService(defaultStorage());
  return singleton;
}

export function __resetPersistentQueryEngineSingleton(): void {
  singleton = null;
  queryCounter = 0;
  matchCounter = 0;
}

export const __internals = {
  severityRank,
  matchesQuery,
  snapshotFields,
  isValidQuery,
  isValidMatch,
};

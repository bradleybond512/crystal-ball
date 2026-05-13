/**
 * Entity Registry — canonical identity store for the intelligence fabric.
 *
 * The richer `Entity` shape (with aliases, identifiers, domains, riskScore)
 * is the Phase 3 canonical record: any real-world thing that can appear
 * across multiple ObservationEvents — a ship, an aircraft, a person, an
 * organization, a facility, or a location. The registry deduplicates
 * references so the intelligence pipeline can join facts across providers,
 * resolves fuzzy queries (name / alias / identifier), and tracks rolling
 * risk + per-entity observation links.
 *
 * A minimal legacy API (`LegacyEntity`, `upsertEntity`, `findByName`,
 * `findNear`, `queryEntities`) is preserved so existing consumers
 * (notably `observation-fabric.test.mts`) keep compiling. Cross-entity
 * relationships still belong in the EvidenceGraph (evidence-graph.ts).
 *
 * Persistence: the canonical registry serializes to `localStorage` at the
 * key `wm-entity-registry` (renderer-only — guarded behind a typeof check
 * so node tests don't trip on a missing global).
 */

// ── Legacy types (kept for back-compat with observation-fabric tests) ──────

export type EntityKind = 'ship' | 'aircraft' | 'location' | 'organization';

export interface LegacyEntity {
  /** Stable canonical identifier, e.g. '123456789' (MMSI), 'a12345' (hex). */
  id: string;
  kind: EntityKind;
  /** Human-readable name or callsign. */
  name: string;
  /** Last-known latitude, if any. */
  lat?: number;
  /** Last-known longitude, if any. */
  lon?: number;
  /** Epoch ms when this entity was last observed. */
  lastSeenAt: number;
  /** Free-form attributes (flag state, registration, country code, etc.). */
  meta: Record<string, unknown>;
}

export interface EntityQuery {
  kind?: EntityKind;
  /** Name substring (case-insensitive). */
  nameContains?: string;
}

export interface NearbyQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  kind?: EntityKind;
}

const legacyRegistry = new Map<string, LegacyEntity>();

export function upsertEntity(entity: Omit<LegacyEntity, 'lastSeenAt'> & { lastSeenAt?: number }): LegacyEntity {
  const existing = legacyRegistry.get(entity.id);
  const merged: LegacyEntity = {
    ...existing,
    ...entity,
    lastSeenAt: entity.lastSeenAt ?? Date.now(),
    meta: { ...existing?.meta, ...entity.meta },
  };
  legacyRegistry.set(entity.id, merged);
  return merged;
}

export function getEntity(id: string): LegacyEntity | undefined {
  return legacyRegistry.get(id);
}

export function findByName(nameContains: string, kind?: EntityKind): LegacyEntity[] {
  const lower = nameContains.toLowerCase();
  const results: LegacyEntity[] = [];
  for (const entity of legacyRegistry.values()) {
    if (kind && entity.kind !== kind) continue;
    if (entity.name.toLowerCase().includes(lower)) results.push(entity);
  }
  return results;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNear(query: NearbyQuery): LegacyEntity[] {
  const results: LegacyEntity[] = [];
  for (const entity of legacyRegistry.values()) {
    if (query.kind && entity.kind !== query.kind) continue;
    if (entity.lat == null || entity.lon == null) continue;
    if (haversineKm(query.lat, query.lon, entity.lat, entity.lon) <= query.radiusKm) {
      results.push(entity);
    }
  }
  return results;
}

export function queryEntities(query: EntityQuery): LegacyEntity[] {
  const results: LegacyEntity[] = [];
  for (const entity of legacyRegistry.values()) {
    if (query.kind && entity.kind !== query.kind) continue;
    if (query.nameContains && !entity.name.toLowerCase().includes(query.nameContains.toLowerCase())) continue;
    results.push(entity);
  }
  return results;
}

export function registrySize(): number {
  return legacyRegistry.size;
}

// ── Canonical (Phase 3) registry ──────────────────────────────────────────

export type EntityType =
  | 'ship'
  | 'aircraft'
  | 'person'
  | 'organization'
  | 'facility'
  | 'location';

/** Free-form domain string matching `ObservationEvent.domain`. Kept as a
 *  type-alias-free `string` (sonarjs/redundant-type-aliases) — adapters
 *  pass whatever the source event domain string is. */

export interface Entity {
  /** Stable canonical identifier (registry-assigned or caller-supplied). */
  id: string;
  type: EntityType;
  /** Preferred display name. */
  canonicalName: string;
  /** Alternate names / spellings / transliterations. Case-insensitive. */
  aliases: string[];
  /** Typed external IDs: `mmsi`, `icao24`, `tail`, `ofac-sdn`, `iso3`, … */
  identifiers: Record<string, string>;
  /** ObservationEvent domains this entity has appeared in. */
  domains: string[];
  /** Rolling risk score, 0..1. */
  riskScore: number;
  /** Epoch ms when this entity was last touched (linked / risk-updated). */
  lastSeen: number;
  /** Free-form attributes (flag state, registration, locality, …). */
  attributes: Record<string, unknown>;
}

export interface EntityLink {
  entityId: string;
  observationId: string;
  situationId?: string;
  linkedAt: number;
}

const STORAGE_KEY = 'wm-entity-registry';
const STORAGE_VERSION = 1;
const MAX_LINKS_PER_ENTITY = 50;

interface PersistedState {
  version: number;
  entities: Entity[];
  links: EntityLink[];
}

const canonicalRegistry = new Map<string, Entity>();
const links: EntityLink[] = [];

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    if (typeof localStorage.getItem !== 'function') return null;
    if (typeof localStorage.setItem !== 'function') return null;
    if (typeof localStorage.removeItem !== 'function') return null;
    return localStorage;
  } catch {
    return null;
  }
}

let hydrated = false;
function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const store = safeLocalStorage();
  if (!store) return;
  let raw: string | null = null;
  try { raw = store.getItem(STORAGE_KEY); } catch { return; }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as PersistedState | null;
    if (parsed?.version !== STORAGE_VERSION) return;
    for (const e of parsed.entities ?? []) canonicalRegistry.set(e.id, e);
    for (const l of parsed.links ?? []) links.push(l);
  } catch {
    /* corrupt blob — start clean */
  }
}

function persist(): void {
  const store = safeLocalStorage();
  if (!store) return;
  const state: PersistedState = {
    version: STORAGE_VERSION,
    entities: [...canonicalRegistry.values()],
    links,
  };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or disabled — best effort */
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function dedupe<T>(arr: readonly T[]): T[] {
  return [...new Set(arr)];
}

function mergeStringArrays(a: readonly string[], b: readonly string[]): string[] {
  return dedupe([...a, ...b]);
}

function mergeRecords(
  a: Record<string, string>,
  b: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v !== '') out[k] = v;
  }
  return out;
}

function clampRisk(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

/** Normalize a query string for fuzzy matching: lowercase + strip
 *  non-alphanumerics. So "M.V. Horizon" matches "mv horizon" matches
 *  "MVHORIZON". */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ── Public API: registry ──────────────────────────────────────────────────

export interface EntityRegistry {
  register: (entity: PartialEntity) => Entity;
  resolve: (query: string) => Entity | undefined;
  getByType: (type: EntityType) => Entity[];
  getByDomain: (domain: string) => Entity[];
  link: (entityId: string, observationId: string, situationId?: string) => EntityLink | undefined;
  getLinkedObservations: (entityId: string) => EntityLink[];
  updateRiskScore: (entityId: string, score: number) => Entity | undefined;
  all: () => Entity[];
  size: () => number;
}

export type PartialEntity = Partial<Omit<Entity, 'id' | 'type' | 'canonicalName'>>
  & Pick<Entity, 'id' | 'type' | 'canonicalName'>;

let entityIdSeq = 0;
function nextEntityId(type: EntityType, hint?: string, now = Date.now()): string {
  entityIdSeq += 1;
  const base = hint ? normalize(hint).slice(0, 16) || type : type;
  return `${type}:${base}-${now.toString(36)}-${entityIdSeq}`;
}

/** Register or merge an entity. If `entity.id` already exists, the new
 *  record is merged in: aliases + domains union, identifiers right-biased,
 *  attributes shallow-merged, riskScore taken as the max of the two. */
export function register(entity: PartialEntity): Entity {
  hydrate();
  const id = entity.id;
  const existing = canonicalRegistry.get(id);
  const now = Date.now();
  if (existing) {
    const merged: Entity = {
      ...existing,
      type: entity.type,
      canonicalName: entity.canonicalName,
      aliases: mergeStringArrays(existing.aliases, entity.aliases ?? []),
      identifiers: mergeRecords(existing.identifiers, entity.identifiers ?? {}),
      domains: mergeStringArrays(existing.domains, entity.domains ?? []),
      riskScore: Math.max(existing.riskScore, clampRisk(entity.riskScore ?? 0)),
      lastSeen: now,
      attributes: { ...existing.attributes, ...entity.attributes },
    };
    canonicalRegistry.set(id, merged);
    persist();
    return merged;
  }
  const created: Entity = {
    id,
    type: entity.type,
    canonicalName: entity.canonicalName,
    aliases: dedupe(entity.aliases ?? []),
    identifiers: { ...entity.identifiers },
    domains: dedupe(entity.domains ?? []),
    riskScore: clampRisk(entity.riskScore ?? 0),
    lastSeen: now,
    attributes: { ...entity.attributes },
  };
  canonicalRegistry.set(id, created);
  persist();
  return created;
}

/** Resolve a free-text query to an Entity. Match precedence:
 *  1. exact id
 *  2. exact identifier value (any namespace)
 *  3. exact canonicalName (case-insensitive)
 *  4. exact alias (case-insensitive)
 *  5. normalized canonicalName equality
 *  6. normalized canonicalName substring
 *  7. normalized alias substring */
interface ResolveCandidates {
  aliasExact?: Entity;
  nameNormEqual?: Entity;
  nameNormSubstring?: Entity;
  aliasNormSubstring?: Entity;
}

function findIdentifierExact(entity: Entity, raw: string): boolean {
  for (const value of Object.values(entity.identifiers)) {
    if (value === raw) return true;
  }
  return false;
}

function findAliasExact(entity: Entity, lower: string): boolean {
  for (const alias of entity.aliases) {
    if (alias.toLowerCase() === lower) return true;
  }
  return false;
}

function findAliasNormSubstring(entity: Entity, norm: string): boolean {
  for (const alias of entity.aliases) {
    const aliasNorm = normalize(alias);
    if (aliasNorm.length >= norm.length && aliasNorm.includes(norm)) return true;
  }
  return false;
}

function updateResolveCandidates(
  entity: Entity,
  lower: string,
  norm: string,
  candidates: ResolveCandidates,
): void {
  if (!candidates.aliasExact && findAliasExact(entity, lower)) {
    candidates.aliasExact = entity;
  }
  if (!candidates.nameNormEqual && normalize(entity.canonicalName) === norm) {
    candidates.nameNormEqual = entity;
  }
  if (norm.length < 3) return;
  if (!candidates.nameNormSubstring) {
    const nameNorm = normalize(entity.canonicalName);
    if (nameNorm.length >= norm.length && nameNorm.includes(norm)) {
      candidates.nameNormSubstring = entity;
    }
  }
  if (!candidates.aliasNormSubstring && findAliasNormSubstring(entity, norm)) {
    candidates.aliasNormSubstring = entity;
  }
}

export function resolve(query: string): Entity | undefined {
  hydrate();
  const raw = query.trim();
  if (!raw) return undefined;
  if (canonicalRegistry.has(raw)) return canonicalRegistry.get(raw);

  const lower = raw.toLowerCase();
  const norm = normalize(raw);
  const candidates: ResolveCandidates = {};

  for (const entity of canonicalRegistry.values()) {
    if (findIdentifierExact(entity, raw)) return entity;
    if (entity.canonicalName.toLowerCase() === lower) return entity;
    updateResolveCandidates(entity, lower, norm, candidates);
  }
  return candidates.aliasExact
    ?? candidates.nameNormEqual
    ?? candidates.nameNormSubstring
    ?? candidates.aliasNormSubstring;
}

export function getByType(type: EntityType): Entity[] {
  hydrate();
  const out: Entity[] = [];
  for (const e of canonicalRegistry.values()) if (e.type === type) out.push(e);
  return out;
}

export function getByDomain(domain: string): Entity[] {
  hydrate();
  const out: Entity[] = [];
  for (const e of canonicalRegistry.values()) if (e.domains.includes(domain)) out.push(e);
  return out;
}

export function link(
  entityId: string,
  observationId: string,
  situationId?: string,
): EntityLink | undefined {
  hydrate();
  const entity = canonicalRegistry.get(entityId);
  if (!entity) return undefined;
  const now = Date.now();
  // Idempotent — same (entity, observation) pair upserts the timestamp.
  const existing = links.find((l) => l.entityId === entityId && l.observationId === observationId);
  if (existing) {
    existing.linkedAt = now;
    if (situationId !== undefined) existing.situationId = situationId;
    entity.lastSeen = now;
    canonicalRegistry.set(entityId, entity);
    persist();
    return existing;
  }
  const created: EntityLink = { entityId, observationId, situationId, linkedAt: now };
  links.push(created);
  // Cap per-entity link history (keep newest).
  const forEntity = links.filter((l) => l.entityId === entityId);
  if (forEntity.length > MAX_LINKS_PER_ENTITY) {
    const overflow = forEntity.length - MAX_LINKS_PER_ENTITY;
    let removed = 0;
    for (let i = 0; i < links.length && removed < overflow; i += 1) {
      if (links[i]!.entityId === entityId) {
        links.splice(i, 1);
        removed += 1;
        i -= 1;
      }
    }
  }
  entity.lastSeen = now;
  canonicalRegistry.set(entityId, entity);
  persist();
  return created;
}

export function getLinkedObservations(entityId: string): EntityLink[] {
  hydrate();
  return links
    .filter((l) => l.entityId === entityId)
    .sort((a, b) => b.linkedAt - a.linkedAt)
    .map((l) => ({ ...l }));
}

export function updateRiskScore(entityId: string, score: number): Entity | undefined {
  hydrate();
  const entity = canonicalRegistry.get(entityId);
  if (!entity) return undefined;
  const next: Entity = {
    ...entity,
    riskScore: clampRisk(score),
    lastSeen: Date.now(),
  };
  canonicalRegistry.set(entityId, next);
  persist();
  return next;
}

export function allEntities(): Entity[] {
  hydrate();
  return [...canonicalRegistry.values()];
}

export function canonicalRegistrySize(): number {
  hydrate();
  return canonicalRegistry.size;
}

/** Top-N by risk score, ties broken by lastSeen (newest first). */
export function topByRisk(limit = 10): Entity[] {
  hydrate();
  return [...canonicalRegistry.values()]
    .sort((a, b) => (b.riskScore - a.riskScore) || (b.lastSeen - a.lastSeen))
    .slice(0, Math.max(0, limit));
}

/** Test seam — clears both legacy + canonical stores. */
export function _clearRegistryForTests(): void {
  legacyRegistry.clear();
  canonicalRegistry.clear();
  links.length = 0;
  entityIdSeq = 0;
  hydrated = true;
  const store = safeLocalStorage();
  if (store) {
    try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
  }
}

/** ID helper exported so adapters can mint stable IDs in their own scope
 *  when they don't have an external identifier to anchor on. */
export { nextEntityId };

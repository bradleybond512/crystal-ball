/**
 * Order of Battle (ORBAT) — military force disposition tracker
 *
 * Maintains an in-memory registry of military units with parent-child
 * hierarchy, position, echelon, type, and operational status. Provides
 * filtered retrieval, hierarchical tree traversal, and country-level force
 * composition summaries.
 *
 * No external dependencies, no network calls. All state is in-memory.
 * Designed for integration with the Crystal Ball conflict intelligence stack.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** NATO echelon vocabulary, smallest to largest */
export type UnitEchelon =
  | 'team'
  | 'squad'
  | 'platoon'
  | 'company'
  | 'battalion'
  | 'brigade'
  | 'division'
  | 'corps'
  | 'army'
  | 'army_group'
  | 'theater';

/** Broad branch/capability classification */
export type UnitType =
  | 'infantry'
  | 'armor'
  | 'artillery'
  | 'air_defense'
  | 'aviation'
  | 'naval'
  | 'special_forces'
  | 'logistics'
  | 'signals'
  | 'engineering'
  | 'cyber'
  | 'missile'
  | 'nuclear';

/** Operational strength assessment */
export type UnitStrength =
  | 'full'
  | 'reinforced'
  | 'reduced'
  | 'combat_ineffective'
  | 'unknown';

/** Current operational status */
export type UnitStatus = 'active' | 'reserve' | 'deployed' | 'withdrawn';

/** A single tracked military unit */
export interface OrbatUnit {
  /** Unique identifier */
  id: string;
  /** Common or informal unit name, e.g. "3rd Infantry Division" */
  name: string;
  /** Official alphanumeric designation, e.g. "3ID" or "1/7 CAV" */
  designation: string;
  /** Echelon in the force hierarchy */
  echelon: UnitEchelon;
  /** Primary combat/support branch */
  unitType: UnitType;
  /** Parent unit id, or null for top-level units */
  parentId: string | null;
  /** ISO 3166-1 alpha-3 country code or common name */
  country: string;
  /** Latitude of last known position, null if undisclosed */
  lat: number | null;
  /** Longitude of last known position, null if undisclosed */
  lon: number | null;
  /** Personnel / equipment readiness assessment */
  strength: UnitStrength;
  /** Current operational status */
  status: UnitStatus;
  /** Unix ms timestamp of last data update */
  lastUpdated: number;
  /** Free-form analyst notes */
  notes: string;
}

/** OrbatUnit extended with recursive children for tree output */
export interface OrbatUnitNode extends OrbatUnit {
  children: OrbatUnitNode[];
}

/** Aggregated force composition for a single country */
export interface ForceComposition {
  country: string;
  totalUnits: number;
  byEchelon: Record<UnitEchelon, number>;
  byType: Record<UnitType, number>;
  deployedCount: number;
  activeCount: number;
}

/** Options for filtered unit retrieval */
export interface GetUnitsOptions {
  country?: string;
  echelon?: UnitEchelon;
  unitType?: UnitType;
  status?: UnitStatus;
}

// ── State ──────────────────────────────────────────────────────────────────

/** Primary unit store — keyed by id */
const _units = new Map<string, OrbatUnit>();

let _idCounter = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  _idCounter += 1;
  return `orbat-${Date.now()}-${_idCounter}`;
}

function emptyEchelonRecord(): Record<UnitEchelon, number> {
  return {
 team: 0,
 squad: 0,
 platoon: 0,
 company: 0,
 battalion: 0,
 brigade: 0,
 division: 0,
 corps: 0,
 army: 0,
 army_group: 0,
 theater: 0,
  };
}

function emptyTypeRecord(): Record<UnitType, number> {
  return {
 infantry: 0,
 armor: 0,
 artillery: 0,
 air_defense: 0,
 aviation: 0,
 naval: 0,
 special_forces: 0,
 logistics: 0,
 signals: 0,
 engineering: 0,
 cyber: 0,
 missile: 0,
 nuclear: 0,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Register a new unit or update an existing one. When a unit with the same id
 * already exists every provided field overwrites the stored value, and
 * lastUpdated is refreshed automatically. If id is omitted or empty a new
 * unique id is generated and returned.
 */
export function registerUnit(
  params: {
 id?: string;
 name: string;
 designation: string;
 echelon: UnitEchelon;
 unitType: UnitType;
 parentId?: string | null;
 country: string;
 lat?: number | null;
 lon?: number | null;
 strength?: UnitStrength;
 status?: UnitStatus;
 notes?: string;
  },
): string {
  const id = params.id && params.id.length > 0 ? params.id : generateId();

  const existing = _units.get(id);

  const unit: OrbatUnit = {
 id,
 name: params.name,
 designation: params.designation,
 echelon: params.echelon,
 unitType: params.unitType,
 parentId: params.parentId ?? existing?.parentId ?? null,
 country: params.country,
 lat: params.lat !== undefined ? params.lat : (existing?.lat ?? null),
 lon: params.lon !== undefined ? params.lon : (existing?.lon ?? null),
 strength: params.strength ?? existing?.strength ?? 'unknown',
 status: params.status ?? existing?.status ?? 'active',
 lastUpdated: Date.now(),
 notes: params.notes ?? existing?.notes ?? '',
  };

  _units.set(id, unit);
  return id;
}

/**
 * Remove a unit by id. No-op if the id does not exist.
 * Note: orphaned children (units whose parentId referenced the removed unit)
 * retain their parentId but will appear as root-level nodes in getUnitTree().
 */
export function removeUnit(id: string): void {
  _units.delete(id);
}

/**
 * Retrieve units with optional filtering by country, echelon, unit type, and
 * status. Results are sorted by lastUpdated descending.
 */
export function getUnits(opts: GetUnitsOptions = {}): OrbatUnit[] {
  let results = Array.from(_units.values());

  if (opts.country !== undefined) {
 const c = opts.country.toLowerCase();
 results = results.filter(u => u.country.toLowerCase() === c);
  }
  if (opts.echelon !== undefined) {
 results = results.filter(u => u.echelon === opts.echelon);
  }
  if (opts.unitType !== undefined) {
 results = results.filter(u => u.unitType === opts.unitType);
  }
  if (opts.status !== undefined) {
 results = results.filter(u => u.status === opts.status);
  }

  return results.sort((a, b) => b.lastUpdated - a.lastUpdated);
}

/**
 * Build a hierarchical unit tree. If rootId is provided, the tree is rooted at
 * that unit. If rootId is omitted the result is an array of all units that have
 * no parent (or whose parent does not exist in the store), each with its
 * descendants nested under a `children` field.
 *
 * Units that form circular parent references are handled safely — each unit
 * appears at most once in the output.
 */
export function getUnitTree(rootId?: string): OrbatUnitNode[] {
  /** Recursively attach children, tracking visited ids to guard cycles */
  function buildNode(unit: OrbatUnit, visited: Set<string>): OrbatUnitNode {
 visited.add(unit.id);
 const children: OrbatUnitNode[] = [];
 for (const candidate of _units.values()) {
 if (candidate.parentId === unit.id && !visited.has(candidate.id)) {
 children.push(buildNode(candidate, new Set(visited)));
 }
 }
 children.sort((a, b) => a.name.localeCompare(b.name));
 return { ...unit, children };
  }

  if (rootId !== undefined) {
 const root = _units.get(rootId);
 if (!root) return [];
 return [buildNode(root, new Set())];
  }

  // Return all units whose parent does not exist in the store
  const roots: OrbatUnitNode[] = [];
  for (const unit of _units.values()) {
 const parentPresent = unit.parentId !== null && _units.has(unit.parentId);
 if (!parentPresent) {
 roots.push(buildNode(unit, new Set()));
 }
  }

  return roots.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Return a force composition summary for the given country. Counts are drawn
 * from all units whose country matches (case-insensitive).
 */
export function getForceComposition(country: string): ForceComposition {
  const c = country.toLowerCase();
  const byEchelon = emptyEchelonRecord();
  const byType = emptyTypeRecord();
  let deployedCount = 0;
  let activeCount = 0;

  for (const unit of _units.values()) {
 if (unit.country.toLowerCase() !== c) continue;
 byEchelon[unit.echelon] = (byEchelon[unit.echelon] ?? 0) + 1;
 byType[unit.unitType] = (byType[unit.unitType] ?? 0) + 1;
 if (unit.status === 'deployed') deployedCount += 1;
 if (unit.status === 'active') activeCount += 1;
  }

  const totalUnits = Object.values(byEchelon).reduce((s, n) => s + n, 0);

  return {
 country,
 totalUnits,
 byEchelon,
 byType,
 deployedCount,
 activeCount,
  };
}

/**
 * Return a deduplicated, sorted list of country values currently represented
 * in the unit registry.
 */
export function getCountries(): string[] {
  const seen = new Set<string>();
  for (const unit of _units.values()) {
 seen.add(unit.country);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/**
 * Update the geographic position of a unit. No-op if the unit does not exist.
 */
export function moveUnit(id: string, lat: number, lon: number): void {
  const unit = _units.get(id);
  if (!unit) return;
  unit.lat = lat;
  unit.lon = lon;
  unit.lastUpdated = Date.now();
}

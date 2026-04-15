/* eslint-disable unicorn/no-array-callback-reference */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/**
 * Custom Tier 2 Country Watchlist
 *
 * Lets users add additional countries to the CII monitoring pipeline
 * beyond the hardcoded Tier 1 list.
 *
 * This is a data-layer utility only — it persists the user's custom
 * watchlist to localStorage. Wiring the watchlist into the CII calculation
 * pipeline is intentionally deferred to a separate task to avoid invasive
 * changes to the scoring engine.
 */

const STORAGE_KEY = 'cb-cii-tier2';

export interface Tier2Country {
  /** ISO 3166-1 alpha-2 country code (uppercased on persist). */
  code: string;
  /** Human-readable country name. */
  name: string;
  /** Epoch millis when this entry was added. */
  addedAt: number;
  /** Optional user-supplied note explaining why this country was added. */
  notes?: string;
}

function isTier2Country(value: unknown): value is Tier2Country {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' &&
    typeof v.name === 'string' &&
    typeof v.addedAt === 'number' &&
    (v.notes === undefined || typeof v.notes === 'string')
  );
}

function readStorage(): Tier2Country[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTier2Country);
  } catch {
    return [];
  }
}

function writeStorage(countries: Tier2Country[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(countries));
  } catch {
    // Storage may be full or unavailable (private mode); silently ignore.
  }
}

/**
 * Return the user's current Tier 2 watchlist.
 * Corrupted / partial entries are filtered out.
 */
export function getTier2Countries(): Tier2Country[] {
  return readStorage();
}

/**
 * Add a country to the Tier 2 watchlist.
 * If the code already exists, the existing entry is updated in-place
 * (preserving original `addedAt`).
 */
export function addTier2Country(country: Omit<Tier2Country, 'addedAt'>): Tier2Country {
  const code = country.code.toUpperCase();
  const existing = readStorage();
  const priorIdx = existing.findIndex((c) => c.code === code);

  const entry: Tier2Country = {
    code,
    name: country.name,
    addedAt: priorIdx === -1 ? Date.now() : (existing[priorIdx]?.addedAt ?? Date.now()),
    notes: country.notes,
  };

  if (priorIdx === -1) {
    existing.push(entry);
  } else {
    existing[priorIdx] = entry;
  }
  writeStorage(existing);
  return entry;
}

/**
 * Remove a country from the Tier 2 watchlist by ISO alpha-2 code.
 * No-op if the code is not present.
 */
export function removeTier2Country(code: string): void {
  const target = code.toUpperCase();
  const next = readStorage().filter((c) => c.code !== target);
  writeStorage(next);
}

/**
 * Test whether a country code is present in the Tier 2 watchlist.
 */
export function isTier2(code: string): boolean {
  const target = code.toUpperCase();
  return readStorage().some((c) => c.code === target);
}

/**
 * STIX/TAXII Threat Intelligence Feed Management
 *
 * Manages TAXII 2.1 feed subscriptions and handles ingestion and storage of
 * STIX 2.1 objects. Feeds are persisted in localStorage; objects are kept
 * in memory with a 5000-entry LRU cap.
 *
 * Fully offline capable — no network calls are made by this module.
 * Callers are responsible for fetching raw TAXII bundle JSON and passing it
 * to ingestStixBundle(). The module handles parsing, deduplication, and eviction.
 *
 * STIX 2.1 bundle format: { type: "bundle", id: "bundle--{uuid}", objects: [...] }
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type StixFeedStatus = 'active' | 'paused' | 'error';

export interface TaxiiFeed {
  id: string;
  name: string;
  url: string;
  apiRoot?: string;
  collectionId?: string;
  status: StixFeedStatus;
  lastPoll: number | null;
  objectCount: number;
  addedAt: number;
  errorMessage?: string;
}

export interface StixObject {
  id: string;
  type: string;
  name?: string;
  description?: string;
  created: string;
  modified: string;
  labels?: string[];
  confidence?: number;
  source: string;
  raw: Record<string, unknown>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-taxii-feeds';
const MAX_OBJECTS = 5000;

// ── State ──────────────────────────────────────────────────────────────────────

const _feeds = new Map<string, TaxiiFeed>();

/**
 * LRU object store: insertion-order Map preserves access order.
 * When at capacity, the oldest entry (first key) is evicted.
 */
const _objects = new Map<string, StixObject>();

// ── ID / UUID generation ──────────────────────────────────────────────────────

let _feedCounter = 0;

/**
 * Generate a pseudo-UUID in the form `{type}--{random hex}`.
 * Not cryptographically strong — suitable only for local object identity.
 */
function generateStixId(type: string): string {
  const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${type}--${hex()}${hex()}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
}

/** Generate a feed ID. */
function generateFeedId(): string {
  _feedCounter++;
  return `feed-${Date.now()}-${_feedCounter}`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function loadFeeds(): void {
  try {
 const stored = localStorage.getItem(STORAGE_KEY);
 if (!stored) return;
 const parsed = JSON.parse(stored) as TaxiiFeed[];
 if (!Array.isArray(parsed)) return;
 for (const feed of parsed) {
 _feeds.set(feed.id, feed);
 }
  } catch {
 // localStorage unavailable or corrupt — start fresh
  }
}

function saveFeeds(): void {
  try {
 localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(_feeds.values())));
  } catch {
 // localStorage full or unavailable
  }
}

// ── LRU eviction ──────────────────────────────────────────────────────────────

/**
 * Insert or update an object in the LRU store, evicting the oldest entry
 * when capacity is exceeded. Re-insertion moves the key to the end (most recent).
 */
function lruSet(obj: StixObject): void {
  if (_objects.has(obj.id)) {
 // Remove to re-insert at end (most-recently-used position)
 _objects.delete(obj.id);
  } else if (_objects.size >= MAX_OBJECTS) {
 // Evict the oldest entry (first key in insertion order)
 const oldestKey = _objects.keys().next().value;
 if (oldestKey !== undefined) {
 _objects.delete(oldestKey);
 }
  }
  _objects.set(obj.id, obj);
}

// ── Feed management ───────────────────────────────────────────────────────────

/**
 * Register a new TAXII feed. Returns the generated feed id.
 */
export function addFeed(
  name: string,
  url: string,
  apiRoot?: string,
  collectionId?: string,
): string {
  const id = generateFeedId();
  const feed: TaxiiFeed = {
 id,
 name,
 url,
 apiRoot,
 collectionId,
 status: 'active',
 lastPoll: null,
 objectCount: 0,
 addedAt: Date.now(),
  };
  _feeds.set(id, feed);
  saveFeeds();
  return id;
}

/**
 * Unregister a TAXII feed. No-ops if the feed does not exist.
 */
export function removeFeed(id: string): void {
  _feeds.delete(id);
  saveFeeds();
}

/**
 * Pause polling for a feed. No-ops if the feed does not exist.
 */
export function pauseFeed(id: string): void {
  const feed = _feeds.get(id);
  if (!feed) return;
  _feeds.set(id, { ...feed, status: 'paused' });
  saveFeeds();
}

/**
 * Resume polling for a feed. Only transitions from 'paused'; no-ops otherwise.
 */
export function resumeFeed(id: string): void {
  const feed = _feeds.get(id);
  if (!feed || feed.status !== 'paused') return;
  _feeds.set(id, { ...feed, status: 'active', errorMessage: undefined });
  saveFeeds();
}

/** Return all registered feeds as an array. */
export function getFeeds(): TaxiiFeed[] {
  return Array.from(_feeds.values());
}

export interface FeedStats {
  totalFeeds: number;
  activeFeeds: number;
  totalObjects: number;
  lastPollTime: number | null;
}

/** Return aggregate statistics across all feeds. */
export function getFeedStats(): FeedStats {
  const feeds = Array.from(_feeds.values());
  const pollTimes = feeds.map(f => f.lastPoll).filter((t): t is number => t !== null);

  return {
 totalFeeds: feeds.length,
 activeFeeds: feeds.filter(f => f.status === 'active').length,
 totalObjects: _objects.size,
 lastPollTime: pollTimes.length > 0 ? Math.max(...pollTimes) : null,
  };
}

// ── Ingestion ─────────────────────────────────────────────────────────────────

/** Shape of a raw STIX 2.1 bundle as parsed from JSON. */
interface RawStixBundle {
  type: string;
  id?: string;
  objects?: Array<Record<string, unknown>>;
}

/**
 * Parse a STIX 2.1 bundle JSON string, store the contained objects,
 * and update the feed's lastPoll time and objectCount.
 *
 * Sets the feed status to 'error' on parse failure.
 * Silently skips objects that lack a required `id` or `type` field.
 */
export function ingestStixBundle(feedId: string, bundleJson: string): void {
  const feed = _feeds.get(feedId);
  if (!feed) return;

  let bundle: RawStixBundle;
  try {
 bundle = JSON.parse(bundleJson) as RawStixBundle;
  } catch {
 _feeds.set(feedId, {
 ...feed,
 status: 'error',
 errorMessage: 'Failed to parse STIX bundle JSON',
 });
 saveFeeds();
 return;
  }

  if (bundle.type !== 'bundle' || !Array.isArray(bundle.objects)) {
 _feeds.set(feedId, {
 ...feed,
 status: 'error',
 errorMessage: 'Invalid STIX bundle: missing type="bundle" or objects array',
 });
 saveFeeds();
 return;
  }

  let ingested = 0;
  for (const raw of bundle.objects) {
 const id = typeof raw['id'] === 'string' ? raw['id'] : undefined;
 const type = typeof raw['type'] === 'string' ? raw['type'] : undefined;
 if (!id || !type) continue;

 const obj: StixObject = {
 id,
 type,
 name: typeof raw['name'] === 'string' ? raw['name'] : undefined,
 description: typeof raw['description'] === 'string' ? raw['description'] : undefined,
 created: typeof raw['created'] === 'string' ? raw['created'] : new Date().toISOString(),
 modified: typeof raw['modified'] === 'string' ? raw['modified'] : new Date().toISOString(),
 labels: Array.isArray(raw['labels'])
 ? (raw['labels'] as unknown[]).filter((l): l is string => typeof l === 'string')
 : undefined,
 confidence: typeof raw['confidence'] === 'number' ? raw['confidence'] : undefined,
 source: feedId,
 raw,
 };

 lruSet(obj);
 ingested++;
  }

  _feeds.set(feedId, {
 ...feed,
 status: 'active',
 lastPoll: Date.now(),
 objectCount: feed.objectCount + ingested,
 errorMessage: undefined,
  });
  saveFeeds();
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

export interface StixObjectQueryOpts {
  type?: string;
  source?: string;
  limit?: number;
}

/**
 * Return STIX objects with optional type and source filtering.
 * Results are returned in insertion order (oldest first).
 */
export function getStixObjects(opts?: StixObjectQueryOpts): StixObject[] {
  let results = Array.from(_objects.values());

  if (opts?.type !== undefined) {
 results = results.filter(o => o.type === opts.type);
  }
  if (opts?.source !== undefined) {
 results = results.filter(o => o.source === opts.source);
  }
  if (opts?.limit !== undefined && opts.limit > 0) {
 results = results.slice(0, opts.limit);
  }

  return results;
}

/**
 * Search STIX objects by name or description (case-insensitive substring match).
 */
export function searchStixObjects(query: string): StixObject[] {
  const lower = query.toLowerCase();
  return Array.from(_objects.values()).filter(
 o =>
 (o.name !== undefined && o.name.toLowerCase().includes(lower)) ||
 (o.description !== undefined && o.description.toLowerCase().includes(lower)),
  );
}

export interface StixBundleExportOpts {
  type?: string;
  limit?: number;
}

/**
 * Export a STIX 2.1 bundle JSON string from stored objects.
 * Optionally filter by object type and cap the result count.
 */
export function exportBundle(opts?: StixBundleExportOpts): string {
  let objects = Array.from(_objects.values());

  if (opts?.type !== undefined) {
 objects = objects.filter(o => o.type === opts.type);
  }
  if (opts?.limit !== undefined && opts.limit > 0) {
 objects = objects.slice(0, opts.limit);
  }

  const bundle = {
 type: 'bundle',
 id: generateStixId('bundle'),
 objects: objects.map(o => o.raw),
  };

  return JSON.stringify(bundle);
}

/**
 * Return a count of stored objects broken down by STIX type.
 */
export function getObjectTypeBreakdown(): Map<string, number> {
  const breakdown = new Map<string, number>();
  for (const obj of _objects.values()) {
 breakdown.set(obj.type, (breakdown.get(obj.type) ?? 0) + 1);
  }
  return breakdown;
}

// ── Initialise from localStorage on module load ───────────────────────────────

loadFeeds();

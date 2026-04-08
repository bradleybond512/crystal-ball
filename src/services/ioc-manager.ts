/**
 * Indicator of Compromise (IOC) Manager — pure TypeScript, fully offline
 *
 * Tracks IOCs ingested from multiple threat intelligence feeds. Supports
 * deduplication by type+value, sighting counts, TLP traffic-light markings,
 * confidence filtering, and a STIX 2.1 bundle export. IOCs not seen within
 * 90 days are automatically pruned on each mutating operation.
 *
 * No external dependencies, no network calls. All state is in-memory.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Indicator type vocabulary */
export type IocType =
  | 'ip'
  | 'domain'
  | 'url'
  | 'hash_md5'
  | 'hash_sha1'
  | 'hash_sha256'
  | 'email'
  | 'cve'
  | 'mutex'
  | 'registry_key';

/** TLP (Traffic Light Protocol) marking */
export type TlpLevel = 'white' | 'green' | 'amber' | 'red';

/** A single tracked indicator of compromise */
export interface IocEntry {
  /** Unique identifier (auto-generated) */
  id: string;
  /** Indicator type */
  type: IocType;
  /** Raw indicator value, e.g. "192.0.2.1" or "badactor.example.com" */
  value: string;
  /** Source feed or analyst attribution */
  source: string;
  /** Analyst confidence 0–100 */
  confidence: number;
  /** Free-form tags, e.g. ["ransomware", "cobalt-strike"] */
  tags: string[];
  /** Unix ms timestamp — when this IOC was first recorded */
  firstSeen: number;
  /** Unix ms timestamp — most recent sighting/update */
  lastSeen: number;
  /** Number of times this IOC has been observed/re-ingested */
  sightings: number;
  /** Human-readable description or analyst note */
  description: string;
  /** Associated threat campaign, if known */
  relatedCampaign?: string;
  /** TLP marking governing sharing restrictions */
  tlp: TlpLevel;
}

/** Aggregated statistics for dashboard display */
export interface IocStats {
  totalIocs: number;
  byType: Record<IocType, number>;
  byTlp: Record<TlpLevel, number>;
  /** IOCs with confidence >= 75 */
  highConfidence: number;
  /** IOCs whose firstSeen is within the last 24 hours */
  recentlyAdded24h: number;
}

/** Options for filtered IOC retrieval */
export interface GetIocsOptions {
  type?: IocType;
  minConfidence?: number;
  tlp?: TlpLevel;
  limit?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** IOCs not seen within this window are pruned automatically */
const PRUNE_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const HIGH_CONFIDENCE_THRESHOLD = 75;

// ── State ──────────────────────────────────────────────────────────────────

/** Primary store — keyed by id */
const _iocs = new Map<string, IocEntry>();

/** Dedup index — keyed by `${type}::${value}` → id */
const _dedupIndex = new Map<string, string>();

let _idCounter = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  _idCounter += 1;
  return `ioc-${Date.now()}-${_idCounter}`;
}

function dedupKey(type: IocType, value: string): string {
  return `${type}::${value.toLowerCase()}`;
}

/** Remove IOCs whose lastSeen is older than PRUNE_AGE_MS */
function pruneStale(): void {
  const cutoff = Date.now() - PRUNE_AGE_MS;
  for (const [id, entry] of _iocs.entries()) {
 if (entry.lastSeen < cutoff) {
 _iocs.delete(id);
 _dedupIndex.delete(dedupKey(entry.type, entry.value));
 }
  }
}

function clampConfidence(confidence: number): number {
  return Math.min(100, Math.max(0, Math.round(confidence)));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Add a new IOC or bump the sighting count if an identical type+value already
 * exists. Returns the id of the new or updated entry.
 */
export function addIoc(
  type: IocType,
  value: string,
  source: string,
  confidence: number,
  tags: string[],
  description: string,
  tlp: TlpLevel = 'white',
  relatedCampaign?: string,
): string {
  pruneStale();

  const key = dedupKey(type, value);
  const existingId = _dedupIndex.get(key);

  if (existingId) {
 const existing = _iocs.get(existingId)!;
 // Bump sightings and refresh lastSeen; keep max confidence
 existing.sightings += 1;
 existing.lastSeen = Date.now();
 existing.confidence = Math.max(existing.confidence, clampConfidence(confidence));
 // Merge tags without duplicates
 for (const tag of tags) {
 if (!existing.tags.includes(tag)) existing.tags.push(tag);
 }
 if (relatedCampaign && !existing.relatedCampaign) {
 existing.relatedCampaign = relatedCampaign;
 }
 return existingId;
  }

  const now = Date.now();
  const id = generateId();
  const entry: IocEntry = {
 id,
 type,
 value,
 source,
 confidence: clampConfidence(confidence),
 tags: [...tags],
 firstSeen: now,
 lastSeen: now,
 sightings: 1,
 description,
 relatedCampaign,
 tlp,
  };

  _iocs.set(id, entry);
  _dedupIndex.set(key, id);
  return id;
}

/**
 * Remove an IOC by id. No-op if the id does not exist.
 */
export function removeIoc(id: string): void {
  const entry = _iocs.get(id);
  if (!entry) return;
  _dedupIndex.delete(dedupKey(entry.type, entry.value));
  _iocs.delete(id);
}

/**
 * Search IOCs by value substring or tag match (case-insensitive).
 * Returns all matching entries sorted by confidence descending.
 */
export function searchIocs(query: string): IocEntry[] {
  pruneStale();
  if (!query) return [];
  const q = query.toLowerCase();
  const results: IocEntry[] = [];
  for (const entry of _iocs.values()) {
 const valueMatch = entry.value.toLowerCase().includes(q);
 const tagMatch = entry.tags.some(t => t.toLowerCase().includes(q));
 if (valueMatch || tagMatch) results.push(entry);
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Retrieve IOCs with optional filtering by type, minimum confidence, TLP, and
 * a result limit. Results are sorted by lastSeen descending (most recent first).
 */
export function getIocs(opts: GetIocsOptions = {}): IocEntry[] {
  pruneStale();
  let results = Array.from(_iocs.values());

  if (opts.type !== undefined) {
 results = results.filter(e => e.type === opts.type);
  }
  if (opts.minConfidence !== undefined) {
 results = results.filter(e => e.confidence >= opts.minConfidence!);
  }
  if (opts.tlp !== undefined) {
 results = results.filter(e => e.tlp === opts.tlp);
  }

  results.sort((a, b) => b.lastSeen - a.lastSeen);

  if (opts.limit !== undefined && opts.limit > 0) {
 results = results.slice(0, opts.limit);
  }

  return results;
}

/**
 * Compute aggregated statistics across all tracked IOCs.
 */
export function getIocStats(): IocStats {
  pruneStale();

  const byType: Record<IocType, number> = {
 ip: 0,
 domain: 0,
 url: 0,
 hash_md5: 0,
 hash_sha1: 0,
 hash_sha256: 0,
 email: 0,
 cve: 0,
 mutex: 0,
 registry_key: 0,
  };

  const byTlp: Record<TlpLevel, number> = {
 white: 0,
 green: 0,
 amber: 0,
 red: 0,
  };

  let highConfidence = 0;
  let recentlyAdded24h = 0;
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

  for (const entry of _iocs.values()) {
 byType[entry.type] = (byType[entry.type] ?? 0) + 1;
 byTlp[entry.tlp] = (byTlp[entry.tlp] ?? 0) + 1;
 if (entry.confidence >= HIGH_CONFIDENCE_THRESHOLD) highConfidence += 1;
 if (entry.firstSeen >= cutoff24h) recentlyAdded24h += 1;
  }

  return {
 totalIocs: _iocs.size,
 byType,
 byTlp,
 highConfidence,
 recentlyAdded24h,
  };
}

/**
 * Export all IOCs as a simplified STIX 2.1 bundle JSON string.
 * Each IOC becomes a STIX `indicator` object with a pattern derived from its
 * type and value. Only a representative subset of STIX fields is populated.
 */
export function exportIocsStix(): string {
  pruneStale();

  /** Map IocType to a STIX pattern expression */
  function buildPattern(type: IocType, value: string): string {
 const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
 switch (type) {
 case 'ip': return `[ipv4-addr:value = '${escaped}']`;
 case 'domain': return `[domain-name:value = '${escaped}']`;
 case 'url': return `[url:value = '${escaped}']`;
 case 'hash_md5': return `[file:hashes.MD5 = '${escaped}']`;
 case 'hash_sha1': return `[file:hashes.'SHA-1' = '${escaped}']`;
 case 'hash_sha256': return `[file:hashes.'SHA-256' = '${escaped}']`;
 case 'email': return `[email-addr:value = '${escaped}']`;
 case 'cve': return `[vulnerability:name = '${escaped}']`;
 case 'mutex': return `[mutex:name = '${escaped}']`;
 case 'registry_key':  return `[windows-registry-key:key = '${escaped}']`;
 }
  }

  const indicators = Array.from(_iocs.values()).map(entry => ({
 type: 'indicator',
 spec_version: '2.1',
 id: `indicator--${entry.id}`,
 name: `${entry.type}: ${entry.value}`,
 description: entry.description || undefined,
 pattern: buildPattern(entry.type, entry.value),
 pattern_type: 'stix',
 valid_from: new Date(entry.firstSeen).toISOString(),
 modified: new Date(entry.lastSeen).toISOString(),
 confidence: entry.confidence,
 labels: entry.tags,
 object_marking_refs: [`marking-definition--tlp-${entry.tlp}`],
 ...(entry.relatedCampaign ? { x_campaign: entry.relatedCampaign } : {}),
 extensions: {
 'extension-definition--crystalball': {
 source: entry.source,
 sightings: entry.sightings,
 ioc_type: entry.type,
 },
 },
  }));

  const bundle = {
 type: 'bundle',
 id: `bundle--${Date.now()}`,
 spec_version: '2.1',
 objects: indicators,
  };

  return JSON.stringify(bundle, null, 2);
}

/**
 * Batch ingest an array of IOC descriptors. Duplicates are resolved via the
 * same dedup logic as addIoc(). Returns the count of new entries created
 * (not counting bumped sightings).
 */
export function bulkIngest(
  entries: Array<{
 type: IocType;
 value: string;
 source: string;
 confidence: number;
 tags: string[];
 description: string;
 tlp?: TlpLevel;
 relatedCampaign?: string;
  }>,
): number {
  let newCount = 0;
  const before = _iocs.size;

  for (const e of entries) {
 addIoc(e.type, e.value, e.source, e.confidence, e.tags, e.description, e.tlp, e.relatedCampaign);
  }

  newCount = _iocs.size - before;
  return newCount;
}

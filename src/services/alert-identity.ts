export interface ObservationIdentity { key: string; revision: string; eventTime: number }
export interface IdentityEntry<T> { key: string; revisions: string[]; firstReceivedAt: number; eventTime: number; value: T }
export interface IdentitySnapshot<T> { version: 1; entries: IdentityEntry<T>[] }
export interface IdentityLimits { maxEntries?: number; maxBytes?: number; maxAgeMs?: number }
export interface IdentityLedger<T> {
  get(key: string): IdentityEntry<T> | undefined;
  admit(identity: ObservationIdentity, value: T, now: number, protectedKeys?: ReadonlySet<string>): 'accepted' | 'duplicate' | 'invalid' | 'capacity';
  updateValue(key: string, value: T): boolean;
  expire(now: number): void;
  snapshot(): IdentitySnapshot<T>;
  readonly byteLength: number;
  readonly size: number;
}

const MAX_ENTRIES = 4096;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_KEY_BYTES = 4096;
const MAX_REVISION_BYTES = 16_384;
const encoder = new TextEncoder();
const EMPTY_BYTES = encoder.encode('{"version":1,"entries":[]}').length;
const SOURCES = new Set(['breaking-news', 'nws', 'gdacs', 'tsunami', 'volcano', 'oref', 'hazard', 'correlation', 'cyber', 'resource', 'local-ids', 'earthquake', 'fire', 'cyclone', 'power-grid', 'comms-health', 'space-weather', 'spc', 'disease', 'maritime', 'travel-advisory', 'radiation', 'air-quality', 'aviation-hazard']);
const SIGNAL_TYPES = new Set(['prediction_leads_news', 'news_leads_markets', 'silent_divergence', 'velocity_spike', 'keyword_spike', 'convergence', 'triangulation', 'flow_drop', 'flow_price_divergence', 'geo_convergence', 'explained_market_move', 'hotspot_escalation', 'sector_cascade', 'military_surge', 'sentiment_divergence', 'weather_correlation']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const SIGNAL_DATA = ['newsVelocity', 'marketChange', 'predictionShift', 'relatedTopics', 'correlatedEntities', 'correlatedNews', 'explanation', 'term', 'baseline', 'multiplier', 'sourceCount', 'placeIds', 'placeSummary', 'sentimentScore', 'sentimentTrend', 'weatherEvent', 'weatherSeverity', 'impactedInfrastructure', 'source', 'domainHint', 'geo'];
const MATERIAL_EVIDENCE = ['claim', 'verdict', 'supportingSources', 'conflictingSources', 'corroborationCount', 'trustedSourceCount', 'sourceDiversity', 'confidenceReason', 'actionThreshold'];

export interface AlertIdentityInput {
  id: string; source: string; timestamp: number; severity: string; title: string; body: string;
  location?: { lat: number; lon: number; label?: string };
  spatialScope?: unknown;
  link?: string;
}
export interface SignalIdentityInput {
  id: string; type: string; title: string; description: string; confidence: number; timestamp: Date;
  data?: object; evidence?: object;
}
export interface StormReportIdentityInput {
  reportedAt: Date; lat: number; lon: number; type: string; magnitude: string; location: string;
  county: string; state: string; remarks: string;
}

export function identifyAlert(alert: AlertIdentityInput): ObservationIdentity | null {
  if (!alert || !SOURCES.has(alert.source) || !SEVERITIES.has(alert.severity) || !validTime(alert.timestamp)) return null;
  if (!boundedString(alert.id, MAX_KEY_BYTES) || !boundedString(alert.title, MAX_REVISION_BYTES, true) || !boundedString(alert.body, MAX_REVISION_BYTES, true)) return null;
  if (alert.link !== undefined && !boundedString(alert.link, MAX_REVISION_BYTES, true)) return null;
  if (alert.location !== undefined && !validLocation(alert.location)) return null;
  if (alert.spatialScope !== undefined && !validScope(alert.spatialScope)) return null;
  const location = alert.location ? [alert.location.lat, alert.location.lon, alert.location.label ?? null] : null;
  const scope = alert.spatialScope as { kind: string; basis?: string } | undefined;
  return makeIdentity(['alert', alert.source, alert.id], [alert.timestamp, alert.severity, alert.title, alert.body, location, scope ? [scope.kind, scope.basis ?? null] : null, alert.link ?? null], alert.timestamp);
}

export function identifySignal(signal: SignalIdentityInput): ObservationIdentity | null {
  const eventTime = signal?.timestamp instanceof Date ? signal.timestamp.getTime() : Number.NaN;
  if (!signal || !SIGNAL_TYPES.has(signal.type) || !validTime(eventTime) || !Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1) return null;
  if (!boundedString(signal.id, MAX_KEY_BYTES) || !boundedString(signal.title, MAX_REVISION_BYTES, true) || !boundedString(signal.description, MAX_REVISION_BYTES, true)) return null;
  if ((signal.data !== undefined && !record(signal.data)) || (signal.evidence !== undefined && !record(signal.evidence))) return null;
  if (!validSignalContext(signal.data)) return null;
  return makeIdentity(['signal', signal.type, signal.id], [eventTime, signal.type, signal.confidence, signal.title, signal.description, pick(signal.data, SIGNAL_DATA), pick(signal.evidence, MATERIAL_EVIDENCE)], eventTime);
}

export function canonicalStormReportId(report: StormReportIdentityInput): string | null {
  const eventTime = report?.reportedAt instanceof Date ? report.reportedAt.getTime() : Number.NaN;
  if (!report || !validTime(eventTime) || !validLocation(report) || !['tornado', 'hail', 'wind', 'flooding', 'other'].includes(report.type)) return null;
  const fields = [report.magnitude, report.location, report.county, report.state, report.remarks];
  if (!fields.every((field) => boundedString(field, MAX_KEY_BYTES, true))) return null;
  const key = JSON.stringify(['lsr', eventTime, report.lat, report.lon, report.type, ...fields]);
  return bytes(key) <= MAX_KEY_BYTES ? key : null;
}

function validSignalContext(value: object | undefined): boolean {
  if (!value) return true;
  const data = value as Record<string, unknown>;
  for (const key of ['relatedTopics', 'correlatedEntities', 'correlatedNews', 'placeIds']) {
    const entries = data[key];
    if (entries !== undefined && (!Array.isArray(entries) || entries.length > MAX_ENTRIES
      || !entries.every(entry => boundedString(entry, MAX_KEY_BYTES, true)))) return false;
  }
  for (const key of ['explanation', 'placeSummary']) {
    if (data[key] !== undefined && !boundedString(data[key], MAX_REVISION_BYTES, true)) return false;
  }
  if (data.source !== undefined && !boundedString(data.source, MAX_KEY_BYTES)) return false;
  if (data.domainHint !== undefined && !['military', 'economic', 'natural_hazard', 'cyber', 'infrastructure', 'health', 'civil_unrest', 'compound'].includes(data.domainHint as string)) return false;
  return data.geo === undefined || validSignalGeo(data.geo);
}
function validSignalGeo(value: unknown): boolean {
  if (!record(value) || !boundedString(value.label, MAX_REVISION_BYTES, true) || !Array.isArray(value.countries) || !value.countries.every((country) => boundedString(country, MAX_KEY_BYTES)) || typeof value.radiusKm !== 'number' || !Number.isFinite(value.radiusKm) || value.radiusKm < 0) return false;
  if (value.kind === 'point') return validLocation(value as unknown as { lat: number; lon: number }) && ['reported-event', 'centroid', 'regional-centroid'].includes(value.basis as string);
  if (value.kind === 'area') return value.basis === 'nws-geometry' && (value.centroid === undefined || validLocation(value.centroid as { lat: number; lon: number }));
  return ['country', 'global', 'unknown'].includes(value.kind as string);
}

function pick(value: object | undefined, keys: string[]): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  if (value) for (const key of keys) if ((value as Record<string, unknown>)[key] !== undefined) selected[key] = (value as Record<string, unknown>)[key];
  return selected;
}
function makeIdentity(keyParts: unknown[], revisionParts: unknown[], eventTime: number): ObservationIdentity | null {
  try {
    const key = JSON.stringify(keyParts);
    const revision = JSON.stringify(canonical(revisionParts, 0, { remaining: MAX_REVISION_BYTES }));
    return bytes(key) <= MAX_KEY_BYTES && bytes(revision) <= MAX_REVISION_BYTES ? { key, revision, eventTime } : null;
  } catch { return null; }
}
function canonical(value: unknown, depth: number, budget: { remaining: number }): unknown {
  if (depth > 12) throw new Error('Identity nesting limit');
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
    consumeBudget(budget, bytes(JSON.stringify(value)));
    return value;
  }
  if (typeof value === 'string' && bytes(value) <= MAX_REVISION_BYTES) {
    consumeBudget(budget, bytes(JSON.stringify(value)));
    return value;
  }
  if (Array.isArray(value) && value.length <= MAX_ENTRIES) {
    consumeBudget(budget, 2 + Math.max(0, value.length - 1));
    return value.map((entry) => canonical(entry, depth + 1, budget));
  }
  if (record(value)) {
    const keys = Object.keys(value).sort(compareKeys);
    if (keys.length > MAX_ENTRIES) throw new Error('Identity object limit');
    consumeBudget(budget, 2 + Math.max(0, keys.length - 1));
    return Object.fromEntries(keys.map((key) => {
      consumeBudget(budget, bytes(JSON.stringify(key)) + 1);
      return [key, canonical(value[key], depth + 1, budget)];
    }));
  }
  throw new Error('Invalid identity data');
}
function consumeBudget(budget: { remaining: number }, count: number): void {
  budget.remaining -= count;
  if (budget.remaining < 0) throw new Error('Identity revision limit');
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function validTime(time: number): boolean { return Number.isSafeInteger(time) && time >= 0 && time <= 8_640_000_000_000_000; }
function boundedString(value: unknown, limit: number, empty = false): value is string { return typeof value === 'string' && (empty || value.length > 0) && bytes(value) <= limit; }
function validLocation(location: { lat: number; lon: number; label?: string }): boolean {
  return !!location && Number.isFinite(location.lat) && location.lat >= -90 && location.lat <= 90 && Number.isFinite(location.lon) && location.lon >= -180 && location.lon <= 180 && (location.label === undefined || boundedString(location.label, MAX_REVISION_BYTES, true));
}
function validScope(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value.kind) {
    case 'point': { return ['reported-event', 'centroid', 'regional-centroid'].includes(value.basis as string);
    }
    case 'area': { return value.basis === 'nws-geometry';
    }
    case 'global': { return value.basis === 'producer';
    }
    case 'members': { return value.basis === undefined;
    }
    default: { return false;
    }
  }
}
function compareKeys(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
function bytes(value: string): number { return encoder.encode(value).length; }
function limit(value: number | undefined, hard: number): number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, hard) : hard; }
export function validObservationIdentity(value: unknown): value is ObservationIdentity {
  return record(value) && boundedString(value.key, MAX_KEY_BYTES)
    && boundedString(value.revision, MAX_REVISION_BYTES) && validTime(value.eventTime as number);
}

interface StoredEntry<T> { entry: IdentityEntry<T>; json: string; bytes: number; revisions: Set<string> }
class Ledger<T> implements IdentityLedger<T> {
  private entries = new Map<string, StoredEntry<T>>();
  private totalBytes = EMPTY_BYTES;
  private nextExpiry = Infinity;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxAgeMs: number;
  constructor(private readonly validateValue: (value: unknown) => value is T, limits: IdentityLimits = {}) {
    this.maxEntries = limit(limits.maxEntries, MAX_ENTRIES);
    this.maxBytes = Math.max(EMPTY_BYTES, limit(limits.maxBytes, MAX_BYTES));
    this.maxAgeMs = limit(limits.maxAgeMs, MAX_AGE_MS);
  }
  get size(): number { return this.entries.size; }
  get byteLength(): number { return this.totalBytes; }
  get(key: string): IdentityEntry<T> | undefined {
    const stored = this.entries.get(key);
    return stored ? JSON.parse(stored.json) as IdentityEntry<T> : undefined;
  }
  snapshot(): IdentitySnapshot<T> { return { version: 1, entries: [...this.entries.values()].map((stored) => JSON.parse(stored.json) as IdentityEntry<T>) }; }
  expire(now: number): void {
    if (!validTime(now) || now < this.nextExpiry) return;
    this.nextExpiry = Infinity;
    for (const [key, stored] of this.entries) {
      const deadline = stored.entry.firstReceivedAt + this.maxAgeMs;
      if (deadline <= now) this.remove(key);
      else this.nextExpiry = Math.min(this.nextExpiry, deadline);
    }
  }
  admit(identity: ObservationIdentity, value: T, now: number, protectedKeys: ReadonlySet<string> = new Set()): 'accepted' | 'duplicate' | 'invalid' | 'capacity' {
    if (!validObservationIdentity(identity) || !validTime(now)) return 'invalid';
    this.expire(now);
    const existing = this.entries.get(identity.key);
    if (existing?.revisions.has(identity.revision)) return 'duplicate';
    const candidate = this.prepare({ key: identity.key, revisions: [...(existing?.entry.revisions ?? []), identity.revision], firstReceivedAt: existing?.entry.firstReceivedAt ?? now, eventTime: identity.eventTime, value });
    if (!candidate) return 'invalid';
    const victims = this.victims(candidate, existing, protectedKeys);
    if (!victims) return 'capacity';
    for (const key of victims) this.remove(key);
    if (existing) this.remove(existing.entry.key);
    this.insert(candidate);
    return 'accepted';
  }
  updateValue(key: string, value: T): boolean {
    const existing = this.entries.get(key);
    if (!existing) return false;
    const candidate = this.prepare({ ...existing.entry, value });
    if (!candidate || this.totalBytes - existing.bytes + candidate.bytes > this.maxBytes) return false;
    this.totalBytes += candidate.bytes - existing.bytes;
    this.entries.set(key, candidate);
    return true;
  }
  hydrate(value: unknown, now: number): boolean {
    if (!validTime(now) || !record(value) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > this.maxEntries) return false;
    const staged = new Map<string, StoredEntry<T>>();
    let total = EMPTY_BYTES;
    for (const raw of value.entries) {
      const stored = this.prepareHydration(raw, now);
      if (!stored || staged.has(stored.entry.key)) return false;
      staged.set(stored.entry.key, stored);
      total += stored.bytes + (staged.size > 1 ? 1 : 0);
      if (total > this.maxBytes) return false;
    }
    for (const stored of staged.values()) if (stored.entry.firstReceivedAt + this.maxAgeMs > now) this.insert(stored);
    return true;
  }
  private prepareHydration(raw: unknown, now: number): StoredEntry<T> | null {
    if (!record(raw) || !boundedString(raw.key, MAX_KEY_BYTES) || !Array.isArray(raw.revisions) || !raw.revisions.length || !validTime(raw.firstReceivedAt as number) || (raw.firstReceivedAt as number) > now || !validTime(raw.eventTime as number)) return null;
    if (!raw.revisions.every((revision) => boundedString(revision, MAX_REVISION_BYTES)) || new Set(raw.revisions).size !== raw.revisions.length) return null;
    return this.prepare({ key: raw.key, revisions: raw.revisions, firstReceivedAt: raw.firstReceivedAt as number, eventTime: raw.eventTime as number, value: raw.value as T });
  }
  private prepare(entry: IdentityEntry<T>): StoredEntry<T> | null {
    try {
      if (!this.validateValue(entry.value)) return null;
      const json = JSON.stringify(entry);
      const clone = JSON.parse(json) as IdentityEntry<T>;
      if (!this.validateValue(clone.value)) return null;
      return { entry: clone, json, bytes: bytes(json), revisions: new Set(clone.revisions) };
    } catch { return null; }
  }
  private victims(candidate: StoredEntry<T>, existing: StoredEntry<T> | undefined, protectedKeys: ReadonlySet<string>): string[] | null {
    let count = this.size + (existing ? 0 : 1);
    let total = this.totalBytes - (existing?.bytes ?? 0) + candidate.bytes + (!existing && this.size ? 1 : 0);
    if (count <= this.maxEntries && total <= this.maxBytes) return [];
    const available = [...this.entries.values()].filter((stored) => stored !== existing && !protectedKeys.has(stored.entry.key)).sort((a, b) => a.entry.firstReceivedAt - b.entry.firstReceivedAt || compareKeys(a.entry.key, b.entry.key));
    const victims: string[] = [];
    for (const stored of available) {
      victims.push(stored.entry.key);
      count--;
      total -= stored.bytes + (count > 0 ? 1 : 0);
      if (count <= this.maxEntries && total <= this.maxBytes) return victims;
    }
    return null;
  }
  private remove(key: string): void {
    const stored = this.entries.get(key);
    if (!stored) return;
    this.totalBytes -= stored.bytes + (this.size > 1 ? 1 : 0);
    this.entries.delete(key);
  }
  private insert(stored: StoredEntry<T>): void {
    this.totalBytes += stored.bytes + (this.size ? 1 : 0);
    this.entries.set(stored.entry.key, stored);
    this.nextExpiry = Math.min(this.nextExpiry, stored.entry.firstReceivedAt + this.maxAgeMs);
  }
}

export function createIdentityLedger<T>(validateValue: (value: unknown) => value is T, limits?: IdentityLimits): IdentityLedger<T> { return new Ledger(validateValue, limits); }
export function hydrateIdentityLedger<T>(value: unknown, now: number, validateValue: (value: unknown) => value is T, limits?: IdentityLimits, onInvalid?: () => void): IdentityLedger<T> {
  const ledger = new Ledger(validateValue, limits);
  try { if (ledger.hydrate(value, now)) return ledger; } catch { /* Invalid persisted data is quarantined as an empty registry. */ }
  onInvalid?.();
  return new Ledger(validateValue, limits);
}

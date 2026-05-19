/**
 * GlobalRhythmEngine — models baseline circadian (hourly), weekly,
 * and seasonal (ISO-week) activity patterns per domain so that
 * downstream consumers can score anomalies relative to the expected
 * rhythm.
 *
 * Each domain has three sliding rhythm windows:
 *   - hourly: 24 buckets indexed by UTC hour-of-day
 *   - daily:  7  buckets indexed by UTC day-of-week (0=Sun..6=Sat)
 *   - weekly: 52 buckets indexed by ISO week-of-year (1..52)
 *
 * Each bucket maintains a Welford running mean + variance so that
 * `record()` is O(1) and numerically stable across many samples.
 *
 * Pure deterministic; no DOM, no fetch. Injectable Storage keeps
 * tests hermetic.
 */

// ── Public types ─────────────────────────────────────────────────────

export interface RhythmBucket {
  mean: number;
  variance: number;
  stddev: number;
  sampleCount: number;
}

export interface DomainRhythm {
  domain: string;
  hourly: RhythmBucket[];   // length 24
  daily: RhythmBucket[];    // length 7
  weekly: RhythmBucket[];   // length 52
}

export interface RhythmExpectation {
  hourlyMean: number;
  hourlyStddev: number;
  dailyMean: number;
  dailyStddev: number;
  weeklyMean: number;
  weeklyStddev: number;
  compositeExpected: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface GlobalRhythmEngineOptions {
  storage?: StorageLike | null;
  maxEntries?: number;
  seed?: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-global-rhythms';
export const MAX_ENTRIES = 500;
export const STDDEV_FLOOR = 0.1;
export const HOURLY_WEIGHT = 0.5;
export const DAILY_WEIGHT = 0.3;
export const WEEKLY_WEIGHT = 0.2;

const HOURS = 24;
const DAYS = 7;
const WEEKS = 52;

export const SEED_DOMAINS: readonly string[] = [
  'cyber', 'weather', 'geopolitical', 'maritime',
  'aviation', 'health', 'financial', 'seismic',
];

// Per-domain hand-tuned baseline activity profile. Numbers are in the
// "expected events per query window" scale; downstream consumers care
// about *relative* deviation, not absolute units.
interface SeedProfile {
  hourly: readonly number[];      // length 24
  daily: readonly number[];       // length 7  (Sun..Sat)
  weekly: readonly number[];      // length 52
}

function tunedProfile(
  base: number,
  hourlyShape: readonly number[],
  dailyShape: readonly number[],
): SeedProfile {
  const hourly = hourlyShape.map((m) => Math.max(0.1, base * m));
  const daily = dailyShape.map((m) => Math.max(0.1, base * m));
  const weekly = Array.from({ length: WEEKS }, () => base);
  return { hourly, daily, weekly };
}

// Hourly shapes (length 24, peak business hours):
const BUSINESS_HOURS_SHAPE = [
  0.4, 0.3, 0.3, 0.3, 0.3, 0.4, 0.6, 0.9, 1.2, 1.4, 1.5, 1.6,
  1.5, 1.5, 1.4, 1.3, 1.2, 1.1, 1, 0.9, 0.8, 0.7, 0.6, 0.5,
];
const NIGHT_HEAVY_SHAPE = [
  1.4, 1.5, 1.5, 1.4, 1.2, 1, 0.8, 0.6, 0.5, 0.5, 0.6, 0.7,
  0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.5, 1.5, 1.4, 1.4,
];
const FLAT_SHAPE = Array.from({ length: HOURS }, () => 1);

// Daily shapes (Sun=0 .. Sat=6):
const WEEKDAY_HEAVY = [0.6, 1.2, 1.3, 1.3, 1.3, 1.3, 0.7];
const FLAT_DAY = [1, 1, 1, 1, 1, 1, 1];

const SEED_PROFILES: Record<string, SeedProfile> = {
  cyber: tunedProfile(8, BUSINESS_HOURS_SHAPE, WEEKDAY_HEAVY),
  weather: tunedProfile(12, FLAT_SHAPE, FLAT_DAY),
  geopolitical: tunedProfile(6, BUSINESS_HOURS_SHAPE, WEEKDAY_HEAVY),
  maritime: tunedProfile(4, FLAT_SHAPE, FLAT_DAY),
  aviation: tunedProfile(20, BUSINESS_HOURS_SHAPE, FLAT_DAY),
  health: tunedProfile(5, FLAT_SHAPE, FLAT_DAY),
  financial: tunedProfile(15, BUSINESS_HOURS_SHAPE, WEEKDAY_HEAVY),
  seismic: tunedProfile(3, NIGHT_HEAVY_SHAPE, FLAT_DAY),
};

// ── Bucket math ──────────────────────────────────────────────────────

function newBucket(): RhythmBucket {
  return { mean: 0, variance: 0, stddev: 0, sampleCount: 0 };
}

function welfordUpdate(bucket: RhythmBucket, sample: number): void {
  bucket.sampleCount += 1;
  const delta = sample - bucket.mean;
  bucket.mean += delta / bucket.sampleCount;
  const delta2 = sample - bucket.mean;
  // Maintain M2 in `variance` until we publish; finalize stddev below.
  bucket.variance += delta * delta2;
  bucket.stddev = bucket.sampleCount < 2
    ? STDDEV_FLOOR
    : Math.max(STDDEV_FLOOR, Math.sqrt(bucket.variance / (bucket.sampleCount - 1)));
}

function emptyDomainRhythm(domain: string): DomainRhythm {
  return {
    domain,
    hourly: Array.from({ length: HOURS }, () => newBucket()),
    daily: Array.from({ length: DAYS }, () => newBucket()),
    weekly: Array.from({ length: WEEKS }, () => newBucket()),
  };
}

function seedDomainRhythm(domain: string): DomainRhythm {
  const profile = SEED_PROFILES[domain];
  const rhythm = emptyDomainRhythm(domain);
  if (!profile) return rhythm;
  for (let h = 0; h < HOURS; h++) welfordUpdate(rhythm.hourly[h]!, profile.hourly[h] ?? 0);
  for (let d = 0; d < DAYS; d++) welfordUpdate(rhythm.daily[d]!, profile.daily[d] ?? 0);
  for (let w = 0; w < WEEKS; w++) welfordUpdate(rhythm.weekly[w]!, profile.weekly[w] ?? 0);
  return rhythm;
}

// ── Time → bucket indices (UTC) ──────────────────────────────────────

function hourIndex(timestamp: number): number {
  return new Date(timestamp).getUTCHours();
}

function dayIndex(timestamp: number): number {
  return new Date(timestamp).getUTCDay();
}

// ISO week number (1..52, clamping 53 → 52 for bucket math).
function weekIndex(timestamp: number): number {
  const d = new Date(timestamp);
  const utcDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Shift to nearest Thursday: ISO weeks belong to the year of their Thursday.
  const dayNum = (utcDate.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  utcDate.setUTCDate(utcDate.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const diffMs = utcDate.getTime() - firstThursday.getTime();
  const week = 1 + Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  if (week < 1) return 0;
  if (week > WEEKS) return WEEKS - 1;
  return week - 1;
}

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedState {
  rhythms: DomainRhythm[];
}

export class GlobalRhythmEngine {
  private readonly storage: StorageLike | null;
  private readonly maxEntries: number;
  private readonly rhythms = new Map<string, DomainRhythm>();
  private readonly insertionOrder: string[] = [];

  constructor(opts: GlobalRhythmEngineOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.maxEntries = opts.maxEntries ?? MAX_ENTRIES;
    this.hydrate();
    if (opts.seed) this.seedAll();
  }

  static getInstance(): GlobalRhythmEngine {
    singleton ??= new GlobalRhythmEngine({ seed: true });
    return singleton;
  }

  record(domain: string, count: number, timestamp: number): void {
    const rhythm = this.getOrCreate(domain);
    welfordUpdate(rhythm.hourly[hourIndex(timestamp)]!, count);
    welfordUpdate(rhythm.daily[dayIndex(timestamp)]!, count);
    welfordUpdate(rhythm.weekly[weekIndex(timestamp)]!, count);
    this.persist();
  }

  getExpected(domain: string, timestamp: number): RhythmExpectation {
    const rhythm = this.rhythms.get(domain);
    if (!rhythm) {
      return {
        hourlyMean: 0, hourlyStddev: STDDEV_FLOOR,
        dailyMean: 0, dailyStddev: STDDEV_FLOOR,
        weeklyMean: 0, weeklyStddev: STDDEV_FLOOR,
        compositeExpected: 0,
      };
    }
    const h = rhythm.hourly[hourIndex(timestamp)]!;
    const d = rhythm.daily[dayIndex(timestamp)]!;
    const w = rhythm.weekly[weekIndex(timestamp)]!;
    const compositeExpected = HOURLY_WEIGHT * h.mean + DAILY_WEIGHT * d.mean + WEEKLY_WEIGHT * w.mean;
    return {
      hourlyMean: h.mean,
      hourlyStddev: h.stddev,
      dailyMean: d.mean,
      dailyStddev: d.stddev,
      weeklyMean: w.mean,
      weeklyStddev: w.stddev,
      compositeExpected,
    };
  }

  getDeviation(domain: string, count: number, timestamp: number): number {
    const expected = this.getExpected(domain, timestamp);
    const compositeStddev = Math.max(
      STDDEV_FLOOR,
      HOURLY_WEIGHT * expected.hourlyStddev
        + DAILY_WEIGHT * expected.dailyStddev
        + WEEKLY_WEIGHT * expected.weeklyStddev,
    );
    return (count - expected.compositeExpected) / compositeStddev;
  }

  getDomainRhythms(): DomainRhythm[] {
    return [...this.rhythms.values()].map((r) => cloneRhythm(r));
  }

  clear(): void {
    this.rhythms.clear();
    this.insertionOrder.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private getOrCreate(domain: string): DomainRhythm {
    const existing = this.rhythms.get(domain);
    if (existing) return existing;
    const created = emptyDomainRhythm(domain);
    this.addRhythm(created);
    return created;
  }

  private addRhythm(rhythm: DomainRhythm): void {
    this.rhythms.set(rhythm.domain, rhythm);
    this.insertionOrder.push(rhythm.domain);
    while (this.insertionOrder.length > this.maxEntries) {
      const evict = this.insertionOrder.shift();
      if (evict !== undefined) this.rhythms.delete(evict);
    }
  }

  private seedAll(): void {
    for (const domain of SEED_DOMAINS) {
      if (this.rhythms.has(domain)) continue;
      this.addRhythm(seedDomainRhythm(domain));
    }
    this.persist();
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed || !Array.isArray(parsed.rhythms)) return;
      for (const r of parsed.rhythms) {
        if (this.isValidRhythm(r)) this.addRhythm(r);
      }
    } catch {
      this.rhythms.clear();
      this.insertionOrder.length = 0;
    }
  }

  private isValidRhythm(r: unknown): r is DomainRhythm {
    if (typeof r !== 'object' || r === null) return false;
    const obj = r as { domain?: unknown; hourly?: unknown; daily?: unknown; weekly?: unknown };
    return typeof obj.domain === 'string'
      && Array.isArray(obj.hourly) && obj.hourly.length === HOURS
      && Array.isArray(obj.daily) && obj.daily.length === DAYS
      && Array.isArray(obj.weekly) && obj.weekly.length === WEEKS;
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedState = { rhythms: [...this.rhythms.values()] };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // non-fatal
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: GlobalRhythmEngine | undefined;

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function cloneBucket(b: RhythmBucket): RhythmBucket {
  return { mean: b.mean, variance: b.variance, stddev: b.stddev, sampleCount: b.sampleCount };
}

function cloneRhythm(r: DomainRhythm): DomainRhythm {
  return {
    domain: r.domain,
    hourly: r.hourly.map((b) => cloneBucket(b)),
    daily: r.daily.map((b) => cloneBucket(b)),
    weekly: r.weekly.map((b) => cloneBucket(b)),
  };
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

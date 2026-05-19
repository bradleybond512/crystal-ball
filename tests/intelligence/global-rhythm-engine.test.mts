import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GlobalRhythmEngine,
  resetForTests,
  STORAGE_KEY,
  MAX_ENTRIES,
  SEED_DOMAINS,
  STDDEV_FLOOR,
  type RhythmExpectation,
} from '../../src/services/intelligence/global-rhythm-engine.ts';

// Pick a fixed UTC anchor whose properties we know:
// 2024-01-08 00:00:00 UTC — a Monday (UTC), week 02 ISO, hour 0.
const MON_W2_T0 = Date.UTC(2024, 0, 8, 0, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(k: string): string | null { return data.get(k) ?? null; },
    setItem(k: string, v: string): void { data.set(k, v); },
  };
}

describe('GlobalRhythmEngine — basic record', () => {
  beforeEach(() => { resetForTests(); });

  it('record increments hourly bucket count', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 10, MON_W2_T0); // hour 0
    const expected = eng.getExpected('cyber', MON_W2_T0);
    assert.ok(expected.hourlyMean > 0);
    assert.equal(expected.hourlyMean, 10);
  });

  it('multiple records to the same bucket use Welford running mean', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    // Three observations into the SAME bucket (Monday hour 0, week 02)
    eng.record('cyber', 10, MON_W2_T0);
    eng.record('cyber', 20, MON_W2_T0 + WEEK); // same hour, same DOW, week+1
    eng.record('cyber', 30, MON_W2_T0 + 2 * WEEK);
    const expected = eng.getExpected('cyber', MON_W2_T0);
    // Hourly bucket at hour-0 has all three; mean = 20
    assert.equal(expected.hourlyMean, 20);
    // Sample variance of [10, 20, 30] = 200/2 = 100, stddev = 10
    assert.ok(Math.abs(expected.hourlyStddev - 10) < 0.01);
  });

  it('record updates each of the 3 windows independently', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 5, MON_W2_T0); // hour=0, DOW=Mon, week=02
    const exp = eng.getExpected('cyber', MON_W2_T0);
    assert.equal(exp.hourlyMean, 5);
    assert.equal(exp.dailyMean, 5);
    assert.equal(exp.weeklyMean, 5);
  });
});

describe('GlobalRhythmEngine — bucket bucketing', () => {
  beforeEach(() => { resetForTests(); });

  it('different hours land in different hourly buckets', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 10, MON_W2_T0);           // hour 0
    eng.record('cyber', 100, MON_W2_T0 + 12 * HOUR); // hour 12 same day
    const at0 = eng.getExpected('cyber', MON_W2_T0);
    const at12 = eng.getExpected('cyber', MON_W2_T0 + 12 * HOUR);
    assert.equal(at0.hourlyMean, 10);
    assert.equal(at12.hourlyMean, 100);
  });

  it('different days land in different daily buckets', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 7, MON_W2_T0);             // Mon
    eng.record('cyber', 70, MON_W2_T0 + 2 * DAY);  // Wed
    const mon = eng.getExpected('cyber', MON_W2_T0);
    const wed = eng.getExpected('cyber', MON_W2_T0 + 2 * DAY);
    assert.equal(mon.dailyMean, 7);
    assert.equal(wed.dailyMean, 70);
  });

  it('different ISO weeks land in different weekly buckets', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 1, MON_W2_T0);             // week 02
    eng.record('cyber', 100, MON_W2_T0 + 5 * WEEK); // ~5 weeks later
    const w2 = eng.getExpected('cyber', MON_W2_T0);
    const wLater = eng.getExpected('cyber', MON_W2_T0 + 5 * WEEK);
    assert.equal(w2.weeklyMean, 1);
    assert.equal(wLater.weeklyMean, 100);
  });

  it('hourly bucket wraps modulo 24', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    // hour 0 and hour 24 (= next day hour 0) should hit the same hourly bucket
    eng.record('cyber', 10, MON_W2_T0);
    eng.record('cyber', 30, MON_W2_T0 + DAY); // next day, hour 0
    const exp = eng.getExpected('cyber', MON_W2_T0);
    assert.equal(exp.hourlyMean, 20);
  });
});

describe('GlobalRhythmEngine — getExpected and compositeExpected', () => {
  beforeEach(() => { resetForTests(); });

  it('empty domain returns zero expectations', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    const exp = eng.getExpected('never-seen', MON_W2_T0);
    assert.equal(exp.hourlyMean, 0);
    assert.equal(exp.dailyMean, 0);
    assert.equal(exp.weeklyMean, 0);
    assert.equal(exp.compositeExpected, 0);
  });

  it('compositeExpected is 0.5*hourly + 0.3*daily + 0.2*weekly', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    // Place independent values into each window by using non-overlapping time points
    // Hour-of-day 0 / DOW Mon / Week 2 — record value 10 at MON_W2_T0
    eng.record('cyber', 10, MON_W2_T0);
    // Hour-of-day 5 / DOW Tue / Week 2 — record 20 (boosts daily Tue + hourly5 + week2)
    eng.record('cyber', 20, MON_W2_T0 + DAY + 5 * HOUR);
    // For a query AT MON_W2_T0 (hour 0, Mon, week 02):
    //  hourly bucket 0  -> mean 10
    //  daily bucket Mon -> mean 10
    //  weekly bucket 02 -> mean (10+20)/2 = 15
    const exp = eng.getExpected('cyber', MON_W2_T0);
    assert.equal(exp.hourlyMean, 10);
    assert.equal(exp.dailyMean, 10);
    assert.equal(exp.weeklyMean, 15);
    const composite = 0.5 * 10 + 0.3 * 10 + 0.2 * 15;
    assert.ok(Math.abs(exp.compositeExpected - composite) < 1e-6);
  });

  it('getExpected returns stddev with floor STDDEV_FLOOR for single-sample bucket', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 10, MON_W2_T0);
    const exp = eng.getExpected('cyber', MON_W2_T0);
    // Single sample → variance 0 → stddev floored
    assert.equal(exp.hourlyStddev, STDDEV_FLOOR);
    assert.equal(exp.dailyStddev, STDDEV_FLOOR);
    assert.equal(exp.weeklyStddev, STDDEV_FLOOR);
  });
});

describe('GlobalRhythmEngine — getDeviation z-score', () => {
  beforeEach(() => { resetForTests(); });

  it('exact-mean observation has zero deviation', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    for (let i = 0; i < 5; i++) eng.record('cyber', 10, MON_W2_T0 + i * WEEK);
    const dev = eng.getDeviation('cyber', 10, MON_W2_T0);
    assert.ok(Math.abs(dev) < 1e-6);
  });

  it('above-mean observation has positive deviation', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    for (let i = 0; i < 5; i++) eng.record('cyber', 10, MON_W2_T0 + i * WEEK);
    const dev = eng.getDeviation('cyber', 50, MON_W2_T0);
    assert.ok(dev > 0);
  });

  it('below-mean observation has negative deviation', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    for (let i = 0; i < 5; i++) eng.record('cyber', 10, MON_W2_T0 + i * WEEK);
    const dev = eng.getDeviation('cyber', 0, MON_W2_T0);
    assert.ok(dev < 0);
  });

  it('deviation divides by composite stddev that respects floor', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 10, MON_W2_T0);
    // Single sample → composite stddev = floor; deviation = (50 - composite_mean) / floor
    const dev = eng.getDeviation('cyber', 50, MON_W2_T0);
    assert.ok(Number.isFinite(dev));
    assert.ok(dev !== 0);
  });

  it('deviation for unknown domain falls back to absolute count', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    const dev = eng.getDeviation('mystery-domain', 7, MON_W2_T0);
    // composite expected is 0, stddev is floor — deviation = 7 / floor
    assert.equal(dev, 7 / STDDEV_FLOOR);
  });
});

describe('GlobalRhythmEngine — getDomainRhythms', () => {
  beforeEach(() => { resetForTests(); });

  it('returns one entry per recorded domain', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 1, MON_W2_T0);
    eng.record('weather', 2, MON_W2_T0);
    const rhythms = eng.getDomainRhythms();
    const domains = rhythms.map((r) => r.domain).sort((a, b) => a.localeCompare(b));
    assert.ok(domains.includes('cyber'));
    assert.ok(domains.includes('weather'));
  });

  it('each rhythm carries hourly/daily/weekly bucket arrays', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 5, MON_W2_T0);
    const rhythms = eng.getDomainRhythms();
    const cyber = rhythms.find((r) => r.domain === 'cyber');
    assert.equal(cyber?.hourly.length, 24);
    assert.equal(cyber?.daily.length, 7);
    assert.equal(cyber?.weekly.length, 52);
  });

  it('bucket entries expose mean + sampleCount', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 10, MON_W2_T0);
    eng.record('cyber', 20, MON_W2_T0 + WEEK);
    const rhythms = eng.getDomainRhythms();
    const cyber = rhythms.find((r) => r.domain === 'cyber');
    const hourBucket = cyber?.hourly[0];
    assert.equal(hourBucket?.mean, 15);
    assert.equal(hourBucket?.sampleCount, 2);
  });

  it('returns defensive copies', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 10, MON_W2_T0);
    const first = eng.getDomainRhythms();
    first[0]!.hourly[0]!.mean = 99999;
    const second = eng.getDomainRhythms();
    assert.notEqual(second[0]?.hourly[0]?.mean, 99999);
  });
});

describe('GlobalRhythmEngine — seed domains', () => {
  beforeEach(() => { resetForTests(); });

  it('SEED_DOMAINS lists all 8 expected domains', () => {
    assert.deepEqual(
      [...SEED_DOMAINS].sort((a, b) => a.localeCompare(b)),
      ['aviation', 'cyber', 'financial', 'geopolitical', 'health', 'maritime', 'seismic', 'weather'],
    );
  });

  it('seeded engine pre-populates all 8 domains', () => {
    const eng = new GlobalRhythmEngine({ storage: null, seed: true });
    const rhythms = eng.getDomainRhythms();
    for (const seed of SEED_DOMAINS) {
      assert.ok(rhythms.some((r) => r.domain === seed), `missing seed: ${seed}`);
    }
  });

  it('non-seeded engine has no domains until record is called', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    assert.equal(eng.getDomainRhythms().length, 0);
  });

  it('seed produces non-zero baseline mean for each seed domain', () => {
    const eng = new GlobalRhythmEngine({ storage: null, seed: true });
    for (const seed of SEED_DOMAINS) {
      const exp: RhythmExpectation = eng.getExpected(seed, MON_W2_T0);
      assert.ok(exp.compositeExpected > 0, `${seed} composite should be > 0`);
    }
  });
});

describe('GlobalRhythmEngine — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('domains persist + hydrate', () => {
    const storage = memoryStorage();
    const eng1 = new GlobalRhythmEngine({ storage });
    eng1.record('cyber', 42, MON_W2_T0);
    const eng2 = new GlobalRhythmEngine({ storage });
    const exp = eng2.getExpected('cyber', MON_W2_T0);
    assert.equal(exp.hourlyMean, 42);
  });

  it('Welford state survives hydrate (mean + variance preserved)', () => {
    const storage = memoryStorage();
    const eng1 = new GlobalRhythmEngine({ storage });
    eng1.record('cyber', 10, MON_W2_T0);
    eng1.record('cyber', 20, MON_W2_T0 + WEEK);
    const eng2 = new GlobalRhythmEngine({ storage });
    // Continue with third sample → mean should become 20 across all three
    eng2.record('cyber', 30, MON_W2_T0 + 2 * WEEK);
    const exp = eng2.getExpected('cyber', MON_W2_T0);
    assert.equal(exp.hourlyMean, 20);
  });

  it('storage key is wm-global-rhythms', () => {
    assert.equal(STORAGE_KEY, 'wm-global-rhythms');
  });

  it('max entries is 500', () => {
    assert.equal(MAX_ENTRIES, 500);
  });

  it('malformed persisted state recovers gracefully', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    const eng = new GlobalRhythmEngine({ storage });
    assert.equal(eng.getDomainRhythms().length, 0);
    eng.record('cyber', 5, MON_W2_T0);
    assert.equal(eng.getExpected('cyber', MON_W2_T0).hourlyMean, 5);
  });

  it('null storage means no persistence side effects', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 5, MON_W2_T0);
    assert.equal(eng.getExpected('cyber', MON_W2_T0).hourlyMean, 5);
  });
});

describe('GlobalRhythmEngine — getInstance singleton', () => {
  beforeEach(() => { resetForTests(); });

  it('getInstance returns the same instance across calls', () => {
    const a = GlobalRhythmEngine.getInstance();
    const b = GlobalRhythmEngine.getInstance();
    assert.equal(a, b);
  });

  it('resetForTests clears the singleton', () => {
    const a = GlobalRhythmEngine.getInstance();
    resetForTests();
    const b = GlobalRhythmEngine.getInstance();
    assert.notEqual(a, b);
  });

  it('getInstance pre-seeds the 8 domains', () => {
    const eng = GlobalRhythmEngine.getInstance();
    const rhythms = eng.getDomainRhythms();
    assert.ok(rhythms.length >= 8);
  });
});

describe('GlobalRhythmEngine — capacity', () => {
  beforeEach(() => { resetForTests(); });

  it('honors maxEntries override', () => {
    const eng = new GlobalRhythmEngine({ storage: null, maxEntries: 3 });
    eng.record('a', 1, MON_W2_T0);
    eng.record('b', 1, MON_W2_T0);
    eng.record('c', 1, MON_W2_T0);
    eng.record('d', 1, MON_W2_T0);
    eng.record('e', 1, MON_W2_T0);
    const rhythms = eng.getDomainRhythms();
    assert.ok(rhythms.length <= 3);
  });
});

describe('GlobalRhythmEngine — variance edge cases', () => {
  beforeEach(() => { resetForTests(); });

  it('identical samples keep stddev at floor', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    for (let i = 0; i < 5; i++) eng.record('cyber', 10, MON_W2_T0 + i * WEEK);
    const exp = eng.getExpected('cyber', MON_W2_T0);
    assert.equal(exp.hourlyMean, 10);
    assert.equal(exp.hourlyStddev, STDDEV_FLOOR);
  });

  it('sampleCount on a bucket reflects every record routed to it', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    for (let i = 0; i < 7; i++) eng.record('cyber', 5, MON_W2_T0 + i * WEEK);
    const rhythms = eng.getDomainRhythms();
    const cyber = rhythms.find((r) => r.domain === 'cyber');
    assert.equal(cyber?.hourly[0]?.sampleCount, 7);
  });

  it('per-domain state is independent', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    eng.record('cyber', 100, MON_W2_T0);
    eng.record('weather', 5, MON_W2_T0);
    const cyber = eng.getExpected('cyber', MON_W2_T0);
    const weather = eng.getExpected('weather', MON_W2_T0);
    assert.equal(cyber.hourlyMean, 100);
    assert.equal(weather.hourlyMean, 5);
  });

  it('Sunday and Saturday land in different daily buckets', () => {
    const eng = new GlobalRhythmEngine({ storage: null });
    // Monday is MON_W2_T0 → Sunday is -1 day, Saturday is -2 days
    const sunday = MON_W2_T0 - DAY;
    const saturday = MON_W2_T0 - 2 * DAY;
    eng.record('cyber', 11, sunday);
    eng.record('cyber', 99, saturday);
    const sunExp = eng.getExpected('cyber', sunday);
    const satExp = eng.getExpected('cyber', saturday);
    assert.equal(sunExp.dailyMean, 11);
    assert.equal(satExp.dailyMean, 99);
  });
});

describe('GlobalRhythmEngine — clear', () => {
  beforeEach(() => { resetForTests(); });

  it('clear empties domains and persists', () => {
    const storage = memoryStorage();
    const eng = new GlobalRhythmEngine({ storage });
    eng.record('cyber', 5, MON_W2_T0);
    eng.clear();
    assert.equal(eng.getDomainRhythms().length, 0);
    const eng2 = new GlobalRhythmEngine({ storage });
    assert.equal(eng2.getDomainRhythms().length, 0);
  });
});

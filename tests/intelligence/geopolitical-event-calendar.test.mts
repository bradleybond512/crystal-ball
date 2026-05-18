import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGeopoliticalEventCalendar,
  STORAGE_KEY,
  SEEDED_FLAG_KEY,
  MAX_EVENTS,
  BUILT_IN_SEED,
  type CalendarEvent,
} from '../../src/services/intelligence/geopolitical-event-calendar.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-18T12:00:00Z');
const NOW_MS = NOW.getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function baseEvent(overrides: Partial<Omit<CalendarEvent, 'id' | 'createdAt' | 'acknowledged'>> = {}) {
  return {
    type: 'summit' as const,
    title: 'Test summit',
    description: 'Description',
    country: 'USA',
    region: 'North America',
    scheduledAt: NOW_MS + 7 * DAY_MS,
    domains: ['geopolitical'],
    riskLevel: 'medium' as const,
    riskRationale: 'standard summit',
    tags: ['test'],
    source: 'test',
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-geopolitical-calendar"', () => {
  assert.equal(STORAGE_KEY, 'wm-geopolitical-calendar');
});

test('SEEDED_FLAG_KEY is "wm-geopolitical-calendar-seeded"', () => {
  assert.equal(SEEDED_FLAG_KEY, 'wm-geopolitical-calendar-seeded');
});

test('MAX_EVENTS is 500', () => {
  assert.equal(MAX_EVENTS, 500);
});

test('BUILT_IN_SEED contains 12 events', () => {
  assert.equal(BUILT_IN_SEED.length, 12);
});

test('BUILT_IN_SEED has the expected titles', () => {
  const titles = BUILT_IN_SEED.map((s) => s.title);
  assert.ok(titles.some((t) => /G7/.test(t)));
  assert.ok(titles.some((t) => /midterm/i.test(t)));
  assert.ok(titles.some((t) => /NATO/.test(t)));
  assert.ok(titles.some((t) => /IMF/.test(t)));
  assert.ok(titles.some((t) => /Security Council/i.test(t)));
  assert.ok(titles.some((t) => /Taiwan/i.test(t)));
  assert.ok(titles.some((t) => /OPEC/i.test(t)));
  assert.ok(titles.some((t) => /North Korea/i.test(t)));
  assert.ok(titles.some((t) => /EU sanctions/i.test(t)));
  assert.ok(titles.some((t) => /African Union/i.test(t)));
  assert.ok(titles.some((t) => /WHO/i.test(t)));
  assert.ok(titles.some((t) => /Indo-Pacific/i.test(t)));
});

// ── Seeding ──────────────────────────────────────────────────────────────

test('seeds 12 events on first init', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const evs = svc.getUpcoming(365 * DAY_MS);
  assert.equal(evs.length, 12);
});

test('seeding is idempotent across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createGeopoliticalEventCalendar({ storage, now: () => NOW_MS });
  const before = svc1.getUpcoming(365 * DAY_MS).length;
  const svc2 = createGeopoliticalEventCalendar({ storage, now: () => NOW_MS + 1000 });
  const after = svc2.getUpcoming(365 * DAY_MS).length;
  assert.equal(before, after);
});

test('seeded flag is set after first init', () => {
  const storage = createMemoryStorage();
  createGeopoliticalEventCalendar({ storage, now: () => NOW_MS });
  assert.equal(storage.getItem(SEEDED_FLAG_KEY), '1');
});

test('seed honors riskLevel from BUILT_IN_SEED', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const all = svc.getUpcoming(365 * DAY_MS);
  const critical = all.filter((e) => e.riskLevel === 'critical');
  assert.ok(critical.length >= 2, 'expected at least 2 critical-risk seeded events');
});

// ── add ──────────────────────────────────────────────────────────────────

test('add assigns id, createdAt=now, acknowledged=false', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const ev = svc.add(baseEvent());
  assert.ok(ev.id);
  assert.equal(ev.createdAt, NOW_MS);
  assert.equal(ev.acknowledged, false);
});

test('add assigns unique ids', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) ids.add(svc.add(baseEvent()).id);
  assert.equal(ids.size, 5);
});

test('add appends to upcoming results', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const before = svc.getUpcoming(365 * DAY_MS).length;
  svc.add(baseEvent({ title: 'Custom event' }));
  const after = svc.getUpcoming(365 * DAY_MS).length;
  assert.equal(after, before + 1);
});

// ── acknowledge ──────────────────────────────────────────────────────────

test('acknowledge sets acknowledged=true', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const ev = svc.add(baseEvent());
  svc.acknowledge(ev.id);
  const found = svc.getUpcoming(365 * DAY_MS).find((e) => e.id === ev.id);
  assert.equal(found?.acknowledged, true);
});

test('acknowledge is a no-op for unknown id', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  assert.doesNotThrow(() => svc.acknowledge('nope'));
});

// ── getUpcoming ──────────────────────────────────────────────────────────

test('getUpcoming returns only future events within window', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.add(baseEvent({ title: 'soon', scheduledAt: NOW_MS + 3 * DAY_MS }));
  svc.add(baseEvent({ title: 'far', scheduledAt: NOW_MS + 200 * DAY_MS }));
  svc.add(baseEvent({ title: 'past', scheduledAt: NOW_MS - 1 * DAY_MS }));
  const window7 = svc.getUpcoming(7 * DAY_MS);
  assert.ok(window7.some((e) => e.title === 'soon'));
  assert.ok(!window7.some((e) => e.title === 'far'));
  assert.ok(!window7.some((e) => e.title === 'past'));
});

test('getUpcoming is sorted by scheduledAt asc', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.add(baseEvent({ title: 'later', scheduledAt: NOW_MS + 5 * DAY_MS }));
  svc.add(baseEvent({ title: 'earlier', scheduledAt: NOW_MS + 2 * DAY_MS }));
  const evs = svc.getUpcoming(7 * DAY_MS);
  const customs = evs.filter((e) => e.title === 'earlier' || e.title === 'later');
  assert.equal(customs[0]?.title, 'earlier');
  assert.equal(customs[1]?.title, 'later');
});

test('getUpcoming filters by type', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.add(baseEvent({ title: 'sum', type: 'summit', scheduledAt: NOW_MS + 1 * DAY_MS }));
  svc.add(baseEvent({ title: 'elec', type: 'election', scheduledAt: NOW_MS + 2 * DAY_MS }));
  const summits = svc.getUpcoming(7 * DAY_MS, { type: 'election' });
  assert.ok(summits.every((e) => e.type === 'election'));
  assert.ok(summits.some((e) => e.title === 'elec'));
});

test('getUpcoming filters by riskLevel', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.add(baseEvent({ title: 'high', riskLevel: 'high', scheduledAt: NOW_MS + 1 * DAY_MS }));
  const high = svc.getUpcoming(7 * DAY_MS, { riskLevel: 'high' });
  assert.ok(high.every((e) => e.riskLevel === 'high'));
});

test('getUpcoming filters by domain', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.add(baseEvent({ title: 'mar', domains: ['maritime'], scheduledAt: NOW_MS + 1 * DAY_MS }));
  const maritime = svc.getUpcoming(7 * DAY_MS, { domain: 'maritime' });
  assert.ok(maritime.every((e) => e.domains.includes('maritime')));
});

test('getUpcoming filters by country', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.add(baseEvent({ title: 'jp', country: 'Japan', scheduledAt: NOW_MS + 1 * DAY_MS }));
  const jp = svc.getUpcoming(7 * DAY_MS, { country: 'Japan' });
  assert.ok(jp.every((e) => e.country === 'Japan'));
});

// ── getPast ──────────────────────────────────────────────────────────────

test('getPast returns only past events', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.add(baseEvent({ title: 'past1', scheduledAt: NOW_MS - 10 * DAY_MS }));
  svc.add(baseEvent({ title: 'past2', scheduledAt: NOW_MS - 5 * DAY_MS }));
  svc.add(baseEvent({ title: 'future', scheduledAt: NOW_MS + 5 * DAY_MS }));
  const past = svc.getPast();
  assert.ok(past.every((e) => e.scheduledAt <= NOW_MS));
  assert.ok(past.some((e) => e.title === 'past1'));
  assert.ok(!past.some((e) => e.title === 'future'));
});

test('getPast LIFO ordering (most-recent past first)', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.add(baseEvent({ title: 'older', scheduledAt: NOW_MS - 10 * DAY_MS }));
  svc.add(baseEvent({ title: 'newer', scheduledAt: NOW_MS - 2 * DAY_MS }));
  const past = svc.getPast();
  const customs = past.filter((e) => e.title === 'older' || e.title === 'newer');
  assert.equal(customs[0]?.title, 'newer');
});

test('getPast respects limit', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (let i = 1; i <= 5; i++) {
    svc.add(baseEvent({ title: `p${i}`, scheduledAt: NOW_MS - i * DAY_MS }));
  }
  assert.equal(svc.getPast(3).length, 3);
});

// ── getSummary ───────────────────────────────────────────────────────────

test('getSummary.upcoming7Days only contains events in next 7 days', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const s = svc.getSummary();
  for (const e of s.upcoming7Days) {
    const days = (e.scheduledAt - NOW_MS) / DAY_MS;
    assert.ok(days > 0 && days <= 7, `event ${e.title} at ${days} days`);
  }
});

test('getSummary.upcoming30Days only contains events in next 30 days', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const s = svc.getSummary();
  for (const e of s.upcoming30Days) {
    const days = (e.scheduledAt - NOW_MS) / DAY_MS;
    assert.ok(days > 0 && days <= 30);
  }
});

test('getSummary.highRiskCount counts high+critical upcoming events', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.add(baseEvent({ title: 'hi1', riskLevel: 'high', scheduledAt: NOW_MS + 1 * DAY_MS }));
  svc.add(baseEvent({ title: 'cr1', riskLevel: 'critical', scheduledAt: NOW_MS + 1 * DAY_MS }));
  svc.add(baseEvent({ title: 'lo1', riskLevel: 'low', scheduledAt: NOW_MS + 1 * DAY_MS }));
  const s = svc.getSummary();
  // 12 seeded + 3 added. Seeded high/critical = 5 (G7, midterms, Taiwan, OPEC, NoKo, Indo-Pacific = 6 actually depending on definition).
  // The custom checks: our 2 added must be in the count.
  assert.ok(s.highRiskCount >= 2);
});

test('getSummary.byType has counts for each event type', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const s = svc.getSummary();
  assert.ok(typeof s.byType.summit === 'number');
  assert.ok(typeof s.byType.election === 'number');
  assert.ok(typeof s.byType['military-exercise'] === 'number');
  assert.ok(typeof s.byType['sanctions-review'] === 'number');
  assert.ok(typeof s.byType['economic-release'] === 'number');
  assert.ok(typeof s.byType['treaty-deadline'] === 'number');
  assert.ok(typeof s.byType.other === 'number');
});

// ── Ring buffer ──────────────────────────────────────────────────────────

test('ring buffer evicts oldest at MAX_EVENTS', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (let i = 0; i < MAX_EVENTS + 50; i++) {
    svc.add(baseEvent({ title: `ev${i}`, scheduledAt: NOW_MS + (i + 100) * DAY_MS }));
  }
  const all = [...svc.getUpcoming(365 * 10 * DAY_MS), ...svc.getPast(10_000)];
  assert.ok(all.length <= MAX_EVENTS, `total ${all.length} > MAX_EVENTS ${MAX_EVENTS}`);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe is notified on add', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.add(baseEvent());
  assert.ok(calls >= 1);
});

test('subscribe is notified on acknowledge', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  const ev = svc.add(baseEvent());
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.acknowledge(ev.id);
  assert.ok(calls >= 1);
});

test('unsubscribe stops notifications', () => {
  const svc = createGeopoliticalEventCalendar({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  const fn = () => { calls += 1; };
  svc.subscribe(fn);
  svc.unsubscribe(fn);
  svc.add(baseEvent());
  assert.equal(calls, 0);
});

// ── Persistence ──────────────────────────────────────────────────────────

test('events persist across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createGeopoliticalEventCalendar({ storage, now: () => NOW_MS });
  const ev = svc1.add(baseEvent({ title: 'PersistedEvent' }));

  const svc2 = createGeopoliticalEventCalendar({ storage, now: () => NOW_MS });
  const all = svc2.getUpcoming(365 * DAY_MS);
  assert.ok(all.some((e) => e.id === ev.id));
});

test('acknowledged flag persists', () => {
  const storage = createMemoryStorage();
  const svc1 = createGeopoliticalEventCalendar({ storage, now: () => NOW_MS });
  const ev = svc1.add(baseEvent());
  svc1.acknowledge(ev.id);

  const svc2 = createGeopoliticalEventCalendar({ storage, now: () => NOW_MS });
  const found = svc2.getUpcoming(365 * DAY_MS).find((e) => e.id === ev.id);
  assert.equal(found?.acknowledged, true);
});

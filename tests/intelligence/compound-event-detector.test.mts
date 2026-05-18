import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CompoundEventDetectorService,
  resetForTests,
  STORAGE_KEY,
  MAX_EVENTS,
  type CompoundEvent,
  type ElevatedDomain,
} from '../../src/services/intelligence/compound-event-detector.ts';

const T0 = 1_780_000_000_000;
const HOUR = 60 * 60 * 1000;

function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(k: string): string | null { return data.get(k) ?? null; },
    setItem(k: string, v: string): void { data.set(k, v); },
  };
}

function dom(domain: string, count = 1, sev = 'critical', sitIds: string[] = []): ElevatedDomain {
  return { domain, activeSituationCount: count, highestSeverity: sev, situationIds: sitIds.length ? sitIds : [`${domain}-s1`] };
}

describe('CompoundEventDetectorService — creation', () => {
  beforeEach(() => { resetForTests(); });

  it('update with 1 domain does not create event', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('weather')]);
    assert.equal(svc.getActive(), null);
  });

  it('update with 0 domains does not create event', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([]);
    assert.equal(svc.getActive(), null);
  });

  it('update with 2 domains creates a watch compound event', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('weather'), dom('earthquake')]);
    const active = svc.getActive();
    assert.ok(active);
    assert.equal(active?.compoundSeverity, 'watch');
    assert.equal(active?.domainCount, 2);
    assert.equal(active?.detectedAt, T0);
    assert.equal(active?.active, true);
  });

  it('update with 3 domains creates a warning', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('weather'), dom('earthquake'), dom('cyber')]);
    assert.equal(svc.getActive()?.compoundSeverity, 'warning');
  });

  it('update with 4 domains is still a warning', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('a'), dom('b'), dom('c'), dom('d')]);
    assert.equal(svc.getActive()?.compoundSeverity, 'warning');
  });

  it('update with 5+ domains creates an emergency', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('a'), dom('b'), dom('c'), dom('d'), dom('e')]);
    assert.equal(svc.getActive()?.compoundSeverity, 'emergency');
  });
});

describe('CompoundEventDetectorService — description generation', () => {
  beforeEach(() => { resetForTests(); });

  it('description includes domain count and joined names', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('weather'), dom('earthquake'), dom('cyber')]);
    const desc = svc.getActive()?.description ?? '';
    assert.match(desc, /3-domain compound event/);
    assert.match(desc, /weather/);
    assert.match(desc, /earthquake/);
    assert.match(desc, /cyber/);
  });

  it('description for 2 domains', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('weather'), dom('biosurv')]);
    assert.match(svc.getActive()?.description ?? '', /2-domain compound event/);
  });
});

describe('CompoundEventDetectorService — update existing event', () => {
  beforeEach(() => { resetForTests(); });

  it('subsequent update with same domains is a no-op on identity', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    svc.update([dom('weather'), dom('earthquake')]);
    const id1 = svc.getActive()?.id;
    t += HOUR;
    svc.update([dom('weather'), dom('earthquake')]);
    const id2 = svc.getActive()?.id;
    assert.equal(id1, id2);
  });

  it('adding a third domain promotes the event from watch to warning', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    svc.update([dom('weather'), dom('earthquake')]);
    assert.equal(svc.getActive()?.compoundSeverity, 'watch');
    t += HOUR;
    svc.update([dom('weather'), dom('earthquake'), dom('cyber')]);
    const active = svc.getActive();
    assert.equal(active?.compoundSeverity, 'warning');
    assert.equal(active?.domainCount, 3);
  });

  it('removing a domain still keeps the event active if >=2 remain', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    svc.update([dom('a'), dom('b'), dom('c'), dom('d'), dom('e')]);
    assert.equal(svc.getActive()?.compoundSeverity, 'emergency');
    t += HOUR;
    svc.update([dom('a'), dom('b'), dom('c')]);
    assert.equal(svc.getActive()?.compoundSeverity, 'warning');
    assert.equal(svc.getActive()?.domainCount, 3);
  });

  it('elevatedDomains reflects the latest update', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('a', 1), dom('b', 2)]);
    svc.update([dom('a', 5), dom('b', 3)]);
    const ed = svc.getActive()?.elevatedDomains ?? [];
    const a = ed.find((e) => e.domain === 'a');
    assert.equal(a?.activeSituationCount, 5);
  });
});

describe('CompoundEventDetectorService — resolution', () => {
  beforeEach(() => { resetForTests(); });

  it('update with 1 domain resolves an active event', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    svc.update([dom('a'), dom('b')]);
    assert.ok(svc.getActive());
    t += HOUR;
    svc.update([dom('a')]);
    assert.equal(svc.getActive(), null);
    const history = svc.getHistory();
    assert.equal(history[0]?.active, false);
    assert.equal(history[0]?.resolvedAt, T0 + HOUR);
  });

  it('update with 0 domains resolves an active event', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    svc.update([dom('a'), dom('b')]);
    t += HOUR;
    svc.update([]);
    assert.equal(svc.getActive(), null);
    assert.equal(svc.getHistory().length, 1);
  });

  it('resolved event with subsequent re-elevation creates a new event', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    svc.update([dom('a'), dom('b')]);
    const id1 = svc.getActive()?.id;
    t += HOUR;
    svc.update([]);
    t += HOUR;
    svc.update([dom('a'), dom('b')]);
    const id2 = svc.getActive()?.id;
    assert.ok(id1);
    assert.ok(id2);
    assert.notEqual(id1, id2);
    assert.equal(svc.getHistory().length, 2);
  });
});

describe('CompoundEventDetectorService — getHistory + getSummary', () => {
  beforeEach(() => { resetForTests(); });

  it('getHistory returns LIFO by detectedAt', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    svc.update([dom('a'), dom('b')]); t += HOUR;
    svc.update([]); t += HOUR;
    svc.update([dom('c'), dom('d')]); t += HOUR;
    svc.update([]); t += HOUR;
    svc.update([dom('e'), dom('f')]);
    const hist = svc.getHistory();
    assert.equal(hist[0]?.elevatedDomains[0]?.domain, 'e');
    assert.equal(hist[1]?.elevatedDomains[0]?.domain, 'c');
    assert.equal(hist[2]?.elevatedDomains[0]?.domain, 'a');
  });

  it('getHistory honors limit', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    for (let i = 0; i < 5; i++) {
      svc.update([dom('a'), dom('b')]); t += HOUR;
      svc.update([]); t += HOUR;
    }
    assert.equal(svc.getHistory(2).length, 2);
  });

  it('getSummary tracks activeEvents + currentElevatedDomains', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('a'), dom('b'), dom('c')]);
    const sum = svc.getSummary();
    assert.equal(sum.activeEvents.length, 1);
    assert.deepEqual([...sum.currentElevatedDomains].sort((a, b) => a.localeCompare(b)), ['a', 'b', 'c']);
  });

  it('getSummary maxDomainsEver reflects the largest historical event', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    svc.update([dom('a'), dom('b'), dom('c'), dom('d'), dom('e'), dom('f')]);
    t += HOUR;
    svc.update([]);
    t += HOUR;
    svc.update([dom('a'), dom('b')]);
    assert.equal(svc.getSummary().maxDomainsEver, 6);
  });

  it('getSummary resolvedToday counts events resolved in last 24h', () => {
    const ONE_DAY = 24 * HOUR;
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    // Resolved within 24h: 2 events
    svc.update([dom('a'), dom('b')]); t += HOUR;
    svc.update([]); t += HOUR;
    svc.update([dom('c'), dom('d')]); t += HOUR;
    svc.update([]); t += HOUR;
    // Resolved more than 24h ago in the future view: jump forward
    const sumNow = svc.getSummary();
    assert.equal(sumNow.resolvedToday, 2);
    // Advance time well beyond 24h
    t += 2 * ONE_DAY;
    assert.equal(svc.getSummary().resolvedToday, 0);
  });
});

describe('CompoundEventDetectorService — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribers fire on create', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    const seen: CompoundEvent[] = [];
    svc.subscribe((e) => seen.push(e));
    svc.update([dom('a'), dom('b')]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.active, true);
  });

  it('subscribers fire on update (domain change)', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    const seen: CompoundEvent[] = [];
    svc.subscribe((e) => seen.push(e));
    svc.update([dom('a'), dom('b')]);
    svc.update([dom('a'), dom('b'), dom('c')]);
    assert.equal(seen.length, 2);
    assert.equal(seen[1]?.domainCount, 3);
  });

  it('subscribers fire on resolve', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null });
    const seen: CompoundEvent[] = [];
    svc.subscribe((e) => seen.push(e));
    svc.update([dom('a'), dom('b')]); t += HOUR;
    svc.update([]);
    assert.equal(seen.length, 2);
    assert.equal(seen[1]?.active, false);
  });

  it('subscribers do NOT fire when identical domain set is re-supplied', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    const seen: CompoundEvent[] = [];
    svc.subscribe((e) => seen.push(e));
    svc.update([dom('a'), dom('b')]);
    svc.update([dom('a'), dom('b')]);
    assert.equal(seen.length, 1);
  });

  it('disposer stops notifications', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    const seen: CompoundEvent[] = [];
    const off = svc.subscribe((e) => seen.push(e));
    svc.update([dom('a'), dom('b')]);
    off();
    svc.update([dom('a'), dom('b'), dom('c')]);
    assert.equal(seen.length, 1);
  });

  it('unsubscribe also removes listener', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    const seen: CompoundEvent[] = [];
    const cb = (e: CompoundEvent) => seen.push(e);
    svc.subscribe(cb);
    svc.update([dom('a'), dom('b')]);
    svc.unsubscribe(cb);
    svc.update([dom('a'), dom('b'), dom('c')]);
    assert.equal(seen.length, 1);
  });
});

describe('CompoundEventDetectorService — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('events persist + hydrate', () => {
    const storage = memoryStorage();
    let t = T0;
    const svc1 = new CompoundEventDetectorService({ now: () => t, storage });
    svc1.update([dom('a'), dom('b')]);
    const svc2 = new CompoundEventDetectorService({ now: () => t, storage });
    assert.ok(svc2.getActive());
    assert.equal(svc2.getHistory().length, 1);
  });

  it('storage key is wm-compound-events', () => {
    assert.equal(STORAGE_KEY, 'wm-compound-events');
  });

  it('default max is 200', () => {
    assert.equal(MAX_EVENTS, 200);
  });

  it('malformed persisted state recovers gracefully', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    const svc = new CompoundEventDetectorService({ now: () => T0, storage });
    assert.equal(svc.getHistory().length, 0);
    svc.update([dom('a'), dom('b')]);
    assert.equal(svc.getHistory().length, 1);
  });

  it('null storage means no persistence', () => {
    const svc = new CompoundEventDetectorService({ now: () => T0, storage: null });
    svc.update([dom('a'), dom('b')]);
    assert.ok(svc.getActive());
  });
});

describe('CompoundEventDetectorService — ring-buffer', () => {
  beforeEach(() => { resetForTests(); });

  it('history ring buffer caps at maxEvents', () => {
    let t = T0;
    const svc = new CompoundEventDetectorService({ now: () => t, storage: null, maxEvents: 3 });
    for (let i = 0; i < 6; i++) {
      svc.update([dom('a'), dom('b')]); t += HOUR;
      svc.update([]); t += HOUR;
    }
    assert.equal(svc.getHistory().length, 3);
  });
});

describe('CompoundEventDetectorService — clear', () => {
  beforeEach(() => { resetForTests(); });

  it('clear empties active + history and persists', () => {
    const storage = memoryStorage();
    const svc = new CompoundEventDetectorService({ now: () => T0, storage });
    svc.update([dom('a'), dom('b')]);
    svc.clear();
    assert.equal(svc.getActive(), null);
    assert.equal(svc.getHistory().length, 0);
    const svc2 = new CompoundEventDetectorService({ now: () => T0, storage });
    assert.equal(svc2.getHistory().length, 0);
  });
});

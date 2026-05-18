import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  AlertEscalationService,
  resetForTests,
  RECORDS_STORAGE_KEY,
  POLICIES_STORAGE_KEY,
  MAX_RECORDS,
  DEFAULT_SEVERITY_TIMEOUTS,
  type EscalationRecord,
} from '../../src/services/intelligence/alert-escalation.ts';

const T0 = 1_780_000_000_000;
const MIN = 60_000;

function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(k: string): string | null { return data.get(k) ?? null; },
    setItem(k: string, v: string): void { data.set(k, v); },
  };
}

describe('AlertEscalationService — register', () => {
  beforeEach(() => { resetForTests(); });

  it('register creates a pending record with severity-based expiry', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    const rec = svc.register('alert-1', 'weather', 'critical');
    assert.equal(rec.alertId, 'alert-1');
    assert.equal(rec.domain, 'weather');
    assert.equal(rec.severity, 'critical');
    assert.equal(rec.status, 'pending');
    assert.equal(rec.registeredAt, T0);
    assert.equal(rec.expiresAt, T0 + DEFAULT_SEVERITY_TIMEOUTS.critical);
    assert.equal(rec.escalationLevel, 1);
  });

  it('register uses high severity timeout (15min)', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    const rec = svc.register('a', 'weather', 'high');
    assert.equal(rec.expiresAt - rec.registeredAt, 15 * MIN);
  });

  it('register uses medium severity timeout (1hr)', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    const rec = svc.register('a', 'weather', 'medium');
    assert.equal(rec.expiresAt - rec.registeredAt, 60 * MIN);
  });

  it('register uses low severity timeout (4hr)', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    const rec = svc.register('a', 'weather', 'low');
    assert.equal(rec.expiresAt - rec.registeredAt, 240 * MIN);
  });

  it('register unknown severity falls back to medium', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    const rec = svc.register('a', 'weather', 'mysterious');
    assert.equal(rec.expiresAt - rec.registeredAt, DEFAULT_SEVERITY_TIMEOUTS.medium);
  });
});

describe('AlertEscalationService — tick escalation flow', () => {
  beforeEach(() => { resetForTests(); });

  it('tick is a no-op when not overdue', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical');
    t += MIN; // less than 5-min critical timeout
    const escalated = svc.tick();
    assert.equal(escalated, 0);
    const rec = svc.getRecords()[0]!;
    assert.equal(rec.status, 'pending');
  });

  it('tick escalates overdue critical alert to level 2', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical');
    t += 6 * MIN;
    const escalated = svc.tick();
    assert.equal(escalated, 1);
    const rec = svc.getRecords()[0]!;
    assert.equal(rec.status, 'escalated');
    assert.equal(rec.escalationLevel, 2);
    assert.equal(rec.escalatedAt, T0 + 6 * MIN);
  });

  it('tick re-registers escalated alert at doubled timeout', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical'); // base 5min
    t += 6 * MIN;
    svc.tick(); // level 2, next expiry = now + 10min
    const rec1 = svc.getRecords()[0]!;
    assert.equal(rec1.expiresAt, T0 + 6 * MIN + 2 * DEFAULT_SEVERITY_TIMEOUTS.critical);
  });

  it('tick escalates to level 3 then expires on 4th tick window', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical'); // L1 expires at T0+5min
    t += 6 * MIN;
    svc.tick(); // L2; next expiry = T0+6min + 10min
    t += 11 * MIN; // > 10min
    svc.tick(); // L3; next expiry = T0+17min + 20min
    let rec = svc.getRecords()[0]!;
    assert.equal(rec.escalationLevel, 3);
    assert.equal(rec.status, 'escalated');
    t += 21 * MIN; // > 20min
    svc.tick(); // exceeds max level; status = expired
    rec = svc.getRecords()[0]!;
    assert.equal(rec.status, 'expired');
  });

  it('tick on already-acknowledged record is a no-op', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical');
    svc.acknowledge('a');
    t += 10 * MIN;
    const escalated = svc.tick();
    assert.equal(escalated, 0);
  });

  it('tick escalates multiple overdue records in one call', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical');
    svc.register('b', 'cyber', 'critical');
    svc.register('c', 'aviation', 'critical');
    t += 10 * MIN;
    assert.equal(svc.tick(), 3);
  });
});

describe('AlertEscalationService — acknowledge', () => {
  beforeEach(() => { resetForTests(); });

  it('acknowledge transitions pending to acknowledged with timestamp', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical');
    t += MIN;
    const rec = svc.acknowledge('a');
    assert.ok(rec);
    assert.equal(rec?.status, 'acknowledged');
    assert.equal(rec?.acknowledgedAt, T0 + MIN);
  });

  it('acknowledge transitions escalated to acknowledged', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical');
    t += 6 * MIN;
    svc.tick();
    const rec = svc.acknowledge('a');
    assert.equal(rec?.status, 'acknowledged');
  });

  it('acknowledge on unknown alertId returns null', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    assert.equal(svc.acknowledge('nope'), null);
  });

  it('acknowledged record is terminal — tick wont escalate it', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical');
    svc.acknowledge('a');
    t += 60 * MIN;
    assert.equal(svc.tick(), 0);
    const rec = svc.getRecords()[0]!;
    assert.equal(rec.status, 'acknowledged');
  });
});

describe('AlertEscalationService — policies', () => {
  beforeEach(() => { resetForTests(); });

  it('getPolicy returns defaults for unknown domain', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    const policy = svc.getPolicy('unknown-domain');
    assert.equal(policy.domain, 'unknown-domain');
    assert.deepEqual(policy.severityTimeouts, DEFAULT_SEVERITY_TIMEOUTS);
  });

  it('setPolicy overrides timeouts per domain', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    svc.setPolicy('weather', { severityTimeouts: { critical: 60_000, high: 120_000, medium: 240_000, low: 480_000 } });
    const policy = svc.getPolicy('weather');
    assert.equal(policy.severityTimeouts.critical, 60_000);
  });

  it('register uses the overridden timeout for matching domain', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    svc.setPolicy('weather', { severityTimeouts: { critical: 30_000, high: 60_000, medium: 120_000, low: 240_000 } });
    const rec = svc.register('a', 'weather', 'critical');
    assert.equal(rec.expiresAt - rec.registeredAt, 30_000);
  });

  it('register on another domain still uses defaults', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    svc.setPolicy('weather', { severityTimeouts: { critical: 30_000, high: 60_000, medium: 120_000, low: 240_000 } });
    const rec = svc.register('a', 'cyber', 'critical');
    assert.equal(rec.expiresAt - rec.registeredAt, DEFAULT_SEVERITY_TIMEOUTS.critical);
  });
});

describe('AlertEscalationService — getRecords + getSummary', () => {
  beforeEach(() => { resetForTests(); });

  it('getRecords returns LIFO by registeredAt', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical'); t += MIN;
    svc.register('b', 'cyber', 'high'); t += MIN;
    svc.register('c', 'aviation', 'medium');
    const records = svc.getRecords();
    assert.equal(records[0]?.alertId, 'c');
    assert.equal(records[1]?.alertId, 'b');
    assert.equal(records[2]?.alertId, 'a');
  });

  it('status filter narrows results', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical'); t += 6 * MIN;
    svc.tick();
    svc.register('b', 'cyber', 'critical');
    const escalated = svc.getRecords({ status: 'escalated' });
    assert.equal(escalated.length, 1);
    assert.equal(escalated[0]?.alertId, 'a');
  });

  it('domain filter narrows results', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    svc.register('a', 'weather', 'critical');
    svc.register('b', 'cyber', 'critical');
    const weather = svc.getRecords({ domain: 'weather' });
    assert.equal(weather.length, 1);
  });

  it('limit caps results', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    for (let i = 0; i < 10; i++) { svc.register(`a${i}`, 'weather', 'critical'); t += MIN; }
    assert.equal(svc.getRecords(undefined, 3).length, 3);
  });

  it('getSummary counts by status and computes avgTimeToEscalateMs', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    svc.register('a', 'weather', 'critical'); t += 6 * MIN;
    svc.tick(); // escalates a after 6min
    svc.register('b', 'cyber', 'critical');
    const sum = svc.getSummary();
    assert.equal(sum.escalated, 1);
    assert.equal(sum.pending, 1);
    assert.equal(sum.avgTimeToEscalateMs, 6 * MIN);
    assert.equal(sum.byDomain['weather'], 1);
    assert.equal(sum.byDomain['cyber'], 1);
  });

  it('getSummary avgTimeToEscalate is null when nothing escalated', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    svc.register('a', 'weather', 'critical');
    assert.equal(svc.getSummary().avgTimeToEscalateMs, null);
  });
});

describe('AlertEscalationService — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribers receive escalation events', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    const seen: EscalationRecord[] = [];
    svc.subscribe((r) => seen.push(r));
    svc.register('a', 'weather', 'critical');
    t += 6 * MIN;
    svc.tick();
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.status, 'escalated');
  });

  it('subscribers receive acknowledge events', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    const seen: EscalationRecord[] = [];
    svc.subscribe((r) => seen.push(r));
    svc.register('a', 'weather', 'critical');
    svc.acknowledge('a');
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.status, 'acknowledged');
  });

  it('disposer stops notifications', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null });
    const seen: EscalationRecord[] = [];
    const off = svc.subscribe((r) => seen.push(r));
    svc.register('a', 'weather', 'critical');
    t += 6 * MIN;
    svc.tick();
    off();
    svc.register('b', 'cyber', 'critical');
    t += 12 * MIN;
    svc.tick();
    assert.equal(seen.length, 1);
  });

  it('unsubscribe also removes listener', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    const seen: EscalationRecord[] = [];
    const cb = (r: EscalationRecord) => seen.push(r);
    svc.subscribe(cb);
    svc.register('a', 'weather', 'critical');
    svc.acknowledge('a');
    svc.unsubscribe(cb);
    svc.register('b', 'cyber', 'critical');
    svc.acknowledge('b');
    assert.equal(seen.length, 1);
  });
});

describe('AlertEscalationService — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('records persist + hydrate', () => {
    const storage = memoryStorage();
    const svc1 = new AlertEscalationService({ now: () => T0, storage });
    svc1.register('a', 'weather', 'critical');
    const svc2 = new AlertEscalationService({ now: () => T0, storage });
    assert.equal(svc2.getRecords().length, 1);
    assert.equal(svc2.getRecords()[0]?.alertId, 'a');
  });

  it('policies persist + hydrate', () => {
    const storage = memoryStorage();
    const svc1 = new AlertEscalationService({ now: () => T0, storage });
    svc1.setPolicy('weather', { severityTimeouts: { critical: 99_999, high: 99_999, medium: 99_999, low: 99_999 } });
    const svc2 = new AlertEscalationService({ now: () => T0, storage });
    assert.equal(svc2.getPolicy('weather').severityTimeouts.critical, 99_999);
  });

  it('storage keys are the expected ones', () => {
    assert.equal(RECORDS_STORAGE_KEY, 'wm-escalation-records');
    assert.equal(POLICIES_STORAGE_KEY, 'wm-escalation-policies');
  });

  it('malformed persisted state recovers gracefully', () => {
    const storage = memoryStorage();
    storage.setItem(RECORDS_STORAGE_KEY, '{not json');
    storage.setItem(POLICIES_STORAGE_KEY, '{not json');
    const svc = new AlertEscalationService({ now: () => T0, storage });
    assert.equal(svc.getRecords().length, 0);
    svc.register('a', 'weather', 'critical');
    assert.equal(svc.getRecords().length, 1);
  });

  it('null storage means no persistence', () => {
    const svc = new AlertEscalationService({ now: () => T0, storage: null });
    svc.register('a', 'weather', 'critical');
    assert.equal(svc.getRecords().length, 1);
  });
});

describe('AlertEscalationService — ring-buffer eviction', () => {
  beforeEach(() => { resetForTests(); });

  it('records ring buffer caps at maxRecords', () => {
    let t = T0;
    const svc = new AlertEscalationService({ now: () => t, storage: null, maxRecords: 3 });
    for (let i = 0; i < 7; i++) { svc.register(`a${i}`, 'weather', 'critical'); t += MIN; }
    assert.equal(svc.getRecords().length, 3);
  });

  it('default max is 2000', () => {
    assert.equal(MAX_RECORDS, 2000);
  });
});

describe('AlertEscalationService — clear', () => {
  beforeEach(() => { resetForTests(); });

  it('clear empties records + policies and persists', () => {
    const storage = memoryStorage();
    const svc = new AlertEscalationService({ now: () => T0, storage });
    svc.register('a', 'weather', 'critical');
    svc.setPolicy('weather', { severityTimeouts: { critical: 1, high: 1, medium: 1, low: 1 } });
    svc.clear();
    assert.equal(svc.getRecords().length, 0);
    // Policy returns defaults again
    assert.deepEqual(svc.getPolicy('weather').severityTimeouts, DEFAULT_SEVERITY_TIMEOUTS);
  });
});

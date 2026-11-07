import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  beginStoredCredentialCheck as begin, completeStoredCredentialCheck as complete,
  getCredentialEvidenceDisplay as display, invalidateCredentialEvidence as invalidate,
} from '../credential-evidence.ts';

const key = 'GROQ_API_KEY';
const at = 1_800_000_000_000;
const day = 86_400_000;
const accepted = { outcome: 'verified', reason: 'provider-accepted' } as const;
const rejected = { outcome: 'rejected', reason: 'provider-rejected' } as const;
const outage = { outcome: 'unavailable', reason: 'provider-unavailable' } as const;
const items = new Map<string, string>();
const storage = {
  getItem: (k: string) => items.get(k) ?? null,
  setItem: (k: string, value: string) => { items.set(k, value); },
  removeItem: (k: string) => { items.delete(k); },
};
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  items.clear();
  invalidate(undefined, false);
});

for (const result of [accepted, rejected]) {
  test(result.outcome + ' ages at exactly 24 hours and has an exact date', () => {
    assert.equal(complete(begin(key), result, { now: at }), true);
    assert.equal(display(key, true, at + day - 1).state, result.outcome);
    const stale = display(key, true, at + day);
    assert.equal(stale.state, 'stale');
    assert.match(stale.text, /stale/i);
    assert.match(stale.title, new RegExp(new Date(at).toISOString(), 'u'));
    assert.equal(display(key, false, at + day).state, 'unset');
    assert.equal(display(key, true, at - 1).state, 'unverified');
  });
}

test('an outage reports its own dated attempt and preserves the prior conclusive check', () => {
  complete(begin(key), accepted, { now: at });
  complete(begin(key), outage, { now: at + day });
  const result = display(key, true, at + day + 61_000);
  assert.equal(result.state, 'unavailable');
  assert.match(result.text, /could not verify.*1 min/i);
  assert.match(result.text, /previous.*provider verified.*1 day/i);
  for (const timestamp of [at, at + day]) assert.ok(result.title.includes(new Date(timestamp).toISOString()));
});

test('session reset and credential changes remove current binding; paired edits discard in-flight checks', () => {
  complete(begin(key), accepted, { now: at });
  invalidate(undefined, false);
  assert.equal(display(key, true, at).state, 'historical');
  const pending = begin('OPENSKY_CLIENT_ID');
  invalidate('OPENSKY_CLIENT_SECRET');
  assert.equal(complete(pending, accepted, { now: at }), false);
  assert.equal(display('OPENSKY_CLIENT_ID', true, at).state, 'unverified');
  complete(begin(key), rejected, { now: at });
  invalidate(key);
  assert.equal(display(key, true, at).state, 'historical');
});

test('overlapping attempts cannot overwrite newer results or be completed twice', () => {
  const first = begin(key);
  const second = begin(key);
  assert.equal(complete(second, rejected, { now: at }), true);
  assert.equal(complete(first, accepted, { now: at }), false);
  assert.equal(complete(second, accepted, { now: at }), false);
  assert.equal(display(key, true, at).state, 'rejected');
});

test('a marker changed in another window invalidates evidence before its storage event arrives', () => {
  complete(begin(key), accepted, { now: at });
  const pending = begin(key);
  const saved = new Map(items);
  invalidate(key);
  const changedMarker = [...items.keys()].find(k => saved.get(k) !== items.get(k))!;
  assert.ok(changedMarker);
  complete(begin(key), accepted, { now: at + 1 });
  const other = begin(key);
  items.set(changedMarker, 'another-window-changed-it');
  assert.equal(complete(other, accepted, { now: at + 2 }), false);
  assert.equal(complete(pending, accepted, { now: at + 2 }), false);
  assert.equal(display(key, true, at + 2).state, 'historical');
});

test('old Boolean records are historical and cannot leak errors or certify a provider', () => {
  const oldKey = 'cb:key-status:' + key;
  storage.setItem(oldKey, JSON.stringify({ state: 'valid', lastChecked: at, lastError: 'SECRET-CANARY' }));
  const result = display(key, true, at);
  assert.equal(result.state, 'historical');
  assert.doesNotMatch(JSON.stringify(result), /SECRET-CANARY|provider verified/i);
  complete(begin(key), { ...outage, message: 'SECRET-CANARY' } as typeof outage, { now: at });
  assert.ok(![...items.values()].join('').includes('SECRET-CANARY'));
  assert.equal(storage.getItem(oldKey), null);
});

test('unknown timestamps and malformed legacy records cannot establish evidence', () => {
  for (const date of [null, undefined, '12345', at + 1, -1, 0, 1.25]) {
    storage.setItem('cb:key-status:' + key, JSON.stringify({ state: 'valid', lastChecked: date }));
    assert.equal(display(key, true, at).state, 'unverified');
  }
});

test('do not accept arbitrary reason codes or relabel a transport failure as verified', () => {
  assert.equal(complete(begin(key), { outcome: 'verified', reason: 'SECRET-CANARY' } as typeof accepted, { now: at }), false);
  assert.equal(complete(begin(key), { outcome: 'verified', reason: 'provider-unavailable' } as typeof accepted, { now: at }), false);
  assert.ok(![...items.values()].join('').includes('SECRET-CANARY'));
  assert.equal(display(key, true, at).state, 'unverified');
});

test('storage denial never turns a single action into saved evidence', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
  assert.equal(complete(begin(key), accepted, { now: at }), false);
  assert.equal(display(key, true, at).state, 'unverified');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  assert.equal(display(key, true, at).state, 'unverified');
});

test('unsupported probes and format failures cannot claim provider outcomes', () => {
  for (const result of [
    { outcome: 'not-probed', reason: 'unsupported-probe' },
    { outcome: 'invalid-format', reason: 'invalid-format' },
  ] as const) {
    assert.equal(complete(begin(key), result, { now: at }), true);
    assert.equal(display(key, true, at).state, result.outcome);
  }
});

test('a sidecar copy stays historical even in the testing session', () => {
  assert.equal(complete(begin(key), accepted, { historicalOnly: true, now: at }), true);
  const result = display(key, true, at);
  assert.equal(result.state, 'historical');
  assert.match(result.text, /sidecar copy/i);
  assert.match(result.text, /provider verified/i);
  assert.ok(result.title.includes(new Date(at).toISOString()));
  invalidate(undefined, false);
  assert.match(display(key, true, at).text, /sidecar copy/i);
});

test('a newer check from another window supersedes a pending check without a credential edit', () => {
  const saved = new Map(items);
  const pending = begin(key);
  const marker = [...items.keys()].find(k => saved.get(k) !== items.get(k))!;
  assert.ok(marker);
  items.set(marker, 'concurrent-check');
  assert.equal(complete(pending, accepted, { now: at }), false);
  assert.equal(display(key, true, at).state, 'unverified');
});

test('a receipt storage write rejected at completion stays operation-local', () => {
  const pending = begin(key);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...storage, setItem() { throw new Error('denied'); },
  } });
  assert.equal(complete(pending, accepted, { now: at }), false);
  assert.equal(display(key, true, at).state, 'unverified');
});

test('prior result is identified as stale after an inconclusive attempt', () => {
  complete(begin(key), rejected, { now: at });
  complete(begin(key), outage, { now: at + day });
  assert.match(display(key, true, at + day).text, /previous result.*stale/i);
});

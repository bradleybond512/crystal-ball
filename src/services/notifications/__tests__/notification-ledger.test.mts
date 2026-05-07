import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNotificationLedger,
  type NotificationLedgerEntry,
} from '../notification-ledger.ts';

const baseEntry = (overrides: Partial<NotificationLedgerEntry> = {}): Omit<NotificationLedgerEntry, 'id' | 'recordedAt'> => ({
  channel: 'push',
  threatType: 'seismic_tier3',
  threatLevel: 'critical',
  title: 'Crystal Ball — M6.4 earthquake',
  body: 'M6.4 near La Porte, IN',
  ...overrides,
});

test('append: assigns id + recordedAt and returns entry', () => {
  const ledger = createNotificationLedger();
  const before = Date.now();
  const entry = ledger.append(baseEntry());
  const after = Date.now();
  assert.ok(entry.id, 'id must be assigned');
  assert.ok(entry.recordedAt >= before && entry.recordedAt <= after);
  assert.equal(entry.threatType, 'seismic_tier3');
});

test('list: returns entries in append order', () => {
  const ledger = createNotificationLedger();
  ledger.append(baseEntry({ threatType: 'seismic_tier3' }));
  ledger.append(baseEntry({ threatType: 'geomagnetic_g4' }));
  ledger.append(baseEntry({ threatType: 'cap_extreme' }));
  const entries = ledger.list();
  assert.deepEqual(entries.map(e => e.threatType), ['seismic_tier3', 'geomagnetic_g4', 'cap_extreme']);
});

test('listSince: filters by timestamp', () => {
  const ledger = createNotificationLedger();
  const old = ledger.append(baseEntry());
  // Force a deterministic gap by passing an explicit recordedAt
  const cutoff = old.recordedAt + 1000;
  ledger.append(baseEntry({ threatType: 'cap_extreme' }), { recordedAt: cutoff + 100 });
  const recent = ledger.listSince(cutoff);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].threatType, 'cap_extreme');
});

test('serialize / load: round-trips the ledger as JSON', () => {
  const a = createNotificationLedger();
  a.append(baseEntry({ threatType: 'seismic_tier4' }));
  a.append(baseEntry({ threatType: 'cap_extreme' }));
  const json = a.serialize();
  const b = createNotificationLedger();
  b.loadJson(json);
  assert.deepEqual(b.list().map(e => e.threatType), ['seismic_tier4', 'cap_extreme']);
});

test('loadJson: tolerates malformed input by starting empty', () => {
  const ledger = createNotificationLedger();
  ledger.loadJson('{"this":"is broken"}');
  assert.deepEqual(ledger.list(), []);
});

test('append: deduplicates within the dedupe window when key matches', () => {
  const ledger = createNotificationLedger({ dedupeWindowMs: 60_000 });
  const first = ledger.append(baseEntry({ dedupeKey: 'eq-12345' }));
  const second = ledger.append(baseEntry({ dedupeKey: 'eq-12345' }));
  assert.equal(first.id, second.id, 'duplicate within window returns the existing entry');
  assert.equal(ledger.list().length, 1);
});

test('append: dedupe expires after window', () => {
  const ledger = createNotificationLedger({ dedupeWindowMs: 1000 });
  const first = ledger.append(baseEntry({ dedupeKey: 'eq-x' }), { recordedAt: 1_000_000 });
  const second = ledger.append(baseEntry({ dedupeKey: 'eq-x' }), { recordedAt: 1_002_000 });
  assert.notEqual(first.id, second.id);
  assert.equal(ledger.list().length, 2);
});

test('append: missing dedupeKey never deduplicates', () => {
  const ledger = createNotificationLedger({ dedupeWindowMs: 60_000 });
  ledger.append(baseEntry());
  ledger.append(baseEntry());
  assert.equal(ledger.list().length, 2);
});

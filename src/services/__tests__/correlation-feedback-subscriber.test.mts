import test from 'node:test';
import assert from 'node:assert/strict';
import { runIsolatedFeedback } from '../../../tests/helpers/correlation-feedback-fixture.mts';

for (const transitions of [0, 1, 500]) test(`full500 delivery with ${transitions} ack/pin transitions uses one feedback scan`, () => {
  const result = runIsolatedFeedback({ scenario: 'capacity', transitions });
  assert.equal(result.capacity, 500); assert.equal(result.callbackCosts.length, 1);
  assert.deepEqual(result.behavior.callbackErrors, []);
  assert.equal(result.callbackCosts[0].getAllCalls, 1);
  assert.equal(result.callbackCosts[0].arrayReferences, 500);
  assert.equal(result.behavior.serializedStats, transitions ? JSON.stringify({ 'earthquake|tsunami': { ack: transitions, fastAck: transitions, pinned: transitions } }) : null);
  assert.equal(result.behavior.multiplier, transitions === 500 ? 0.6 : 1);
  assert.equal(result.behavior.saves, transitions ? 1 : 0);
  assert.equal(result.fanout.observerCalls, 2); assert.equal(result.fanout.getAllCalls, 3);
});

const stats = (ack, fastAck, pinned) => ({ ack, fastAck, pinned });
function assertCallbacks(result) {
  assert.deepEqual(result.behavior.callbackErrors, []);
  assert.equal(result.initializationReads, 2, 'singleton start is idempotent');
  for (const cost of result.callbackCosts) assert.equal(cost.getAllCalls, 1);
  assert.equal(result.fixture.pendingFrames, 0);
}

test('mixed-source transitions, updates and repins preserve serialized feedback without duplicate saves', () => {
  const result = runIsolatedFeedback({ scenario: 'transitions' }); assertCallbacks(result);
  const byLabel = Object.fromEntries(result.steps.map(step => [step.label, step]));
  const first = { 'earthquake|tsunami': stats(1, 1, 1) };
  assert.equal(byLabel.combined.serializedStats, JSON.stringify(first)); assert.equal(byLabel.combined.saves, 1);
  for (const label of ['unchanged', 'update-pair', 'unpin']) { assert.equal(byLabel[label].serializedStats, JSON.stringify(first)); assert.equal(byLabel[label].saves, 0); }
  assert.deepEqual(byLabel['update-pair'].alerts.find(alert => alert.id === 'a').pair, ['tsunami', 'earthquake']);
  const repinned = { ...first, 'tsunami|earthquake': stats(0, 0, 1) };
  assert.equal(byLabel.repin.serializedStats, JSON.stringify(repinned)); assert.equal(byLabel.repin.saves, 1);
  const combined = { ...repinned, 'power-grid|comms-health': stats(1, 1, 1) };
  for (const label of ['both-new-pair', 'missing-pair-now-present', 'missing-pair-unpin']) assert.equal(byLabel[label].serializedStats, JSON.stringify(combined));
  assert.equal(byLabel['missing-pair-now-present'].saves, 0); assert.equal(byLabel['missing-pair-unpin'].saves, 0);
  assert.equal(byLabel['missing-pair-repin'].serializedStats, JSON.stringify({ ...repinned, 'power-grid|comms-health': stats(1, 1, 2) }));
  assert.equal(byLabel['missing-pair-repin'].multipliers['power-grid|comms-health'], 0.6333333333333333);
});

test('acknowledgments precede pins even when the pinned pair was inserted first', () => {
  const result = runIsolatedFeedback({ scenario: 'pair-order' }); assertCallbacks(result);
  assert.equal(result.steps[1].serializedStats, '{"earthquake|tsunami":{"ack":1,"fastAck":1,"pinned":0},"power-grid|comms-health":{"ack":0,"fastAck":0,"pinned":1}}');
  assert.equal(result.steps[1].saves, 1);
});

test('fast acknowledgment is strictly before10000ms and multiplier bounds remain unchanged', () => {
  const result = runIsolatedFeedback({ scenario: 'boundary' }); assertCallbacks(result);
  const fast = { 'earthquake|tsunami': stats(3, 3, 0) }, boundary = { ...fast, 'power-grid|comms-health': stats(3, 0, 0) };
  assert.equal(result.steps[1].serializedStats, JSON.stringify(fast)); assert.equal(result.steps[1].multipliers['earthquake|tsunami'], 0.5);
  assert.equal(result.steps[2].serializedStats, JSON.stringify(boundary)); assert.equal(result.steps[2].multipliers['power-grid|comms-health'], 1);
  assert.equal(result.steps[3].serializedStats, JSON.stringify({ ...boundary, 'tsunami|earthquake': stats(0, 0, 3) })); assert.equal(result.steps[3].multipliers['tsunami|earthquake'], 1.2);
});

test('real retention removal and reintroduction reset the first-seen acknowledgment window', () => {
  const result = runIsolatedFeedback({ scenario: 'reintroduction' }); assertCallbacks(result);
  assert.deepEqual(result.steps[1].alerts.map(alert => alert.id), ['marker']);
  assert.deepEqual(result.steps[2].alerts.map(alert => alert.id), ['marker', 'return']);
  assert.equal(result.steps[3].serializedStats, '{"earthquake|tsunami":{"ack":1,"fastAck":1,"pinned":0}}');
  assert.deepEqual(result.steps.map(step => step.saves), [0, 0, 0, 1]);
});

test('earlier subscriber mutation is observed immediately and a subsequent delivery is deduplicated despite another subscriber throwing', () => {
  const result = runIsolatedFeedback({ scenario: 'reentrancy' }); assertCallbacks(result);
  const delivery = result.steps[1]; assert.equal(delivery.callbackCosts.length, 2);
  assert.equal(delivery.serializedStats, '{"earthquake|tsunami":{"ack":2,"fastAck":2,"pinned":0}}'); assert.equal(delivery.saves, 1);
  assert.ok(delivery.alerts.every(alert => alert.acknowledged));
  assert.equal(result.steps[2].serializedStats, delivery.serializedStats); assert.equal(result.steps[2].saves, 0);
  assert.equal(result.fanout.deliberateExceptions, 3); assert.equal(result.fanout.laterCalls, 3);
});

test('fresh-process restart loads persisted statistics and previous reaction sets without replaying feedback', () => {
  const previous = runIsolatedFeedback({ scenario: 'transitions' });
  const result = runIsolatedFeedback({ scenario: 'restart', storage: previous.storage }); assertCallbacks(result);
  for (const step of result.steps.slice(0, 3)) { assert.equal(step.serializedStats, previous.behavior.serializedStats); assert.equal(step.saves, 0); }
  assert.equal(result.steps[3].serializedStats, JSON.stringify({ 'earthquake|tsunami': stats(1, 1, 1), 'tsunami|earthquake': stats(0, 0, 2), 'power-grid|comms-health': stats(1, 1, 2) }));
  assert.equal(result.steps[3].saves, 1);
});

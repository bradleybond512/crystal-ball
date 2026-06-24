import test from 'node:test';
import assert from 'node:assert/strict';
import { runNwsPolygonSelfTestFixture } from '../self-test-fixture.ts';

test('polygon self-test fixture passes against the real matcher', () => {
  const r = runNwsPolygonSelfTestFixture(1_700_000_000_000);
  assert.equal(r.ok, true, r.reason);
});

test('fixture is deterministic across calls', () => {
  assert.deepEqual(
    runNwsPolygonSelfTestFixture(1_700_000_000_000),
    runNwsPolygonSelfTestFixture(1_700_000_000_000),
  );
});

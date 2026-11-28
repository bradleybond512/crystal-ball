import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anomalyEngine } from '../anomaly-detection';
import type { Anomaly } from '../anomaly-detection';

const MINUTE = 60_000;
let sourceSeq = 0;

/** Feed `values` one per minute into a fresh source; return anomalies raised by the LAST value. */
function anomaliesFromLastValue(values: readonly number[]): Anomaly[] {
  const source = `baseline-test-${sourceSeq++}`;
  const start = 1_700_000_000_000 + sourceSeq * 24 * 60 * MINUTE;
  const raised: Anomaly[] = [];
  const unsubscribe = anomalyEngine.subscribe((a) => {
    if (a.source === source) raised.push(a);
  });
  try {
    values.forEach((value, i) => {
      if (i === values.length - 1) raised.length = 0;
      anomalyEngine.ingest(source, value, start + i * MINUTE);
    });
  } finally {
    unsubscribe();
  }
  return raised;
}

test('an extreme value after a short flat baseline is reported as a burst', () => {
  // Scored against a sample containing itself, this value could never reach
  // 10x the mean (nor 2.5 sigma) with only five observations.
  const raised = anomaliesFromLastValue([10, 10, 10, 10, 1_000_000]);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.type, 'spike');
  assert.equal(raised[0]!.severity, 'critical');
  assert.match(raised[0]!.description, /burst detected/);
});

test('a 5-sigma value against an eight-point baseline is reported with its true z-score', () => {
  const baseline = [98, 102, 99, 101, 100, 103, 97, 100];
  const raised = anomaliesFromLastValue([...baseline, 110]);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.type, 'spike');
  // mean 100, sample sd 2: the z-score is 5, not the self-diluted ~2.4.
  assert.ok(Math.abs(raised[0]!.zScore - 5) < 0.01, `zScore was ${raised[0]!.zScore}`);
  assert.ok(Math.abs((raised[0]!.expectedMin + raised[0]!.expectedMax) / 2 - 100) < 1e-9);
});

test('a value well below an eight-point baseline is reported as a deviation', () => {
  const raised = anomaliesFromLastValue([98, 102, 99, 101, 100, 103, 97, 100, 90]);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.type, 'deviation');
});

test('no z-score anomaly is raised from a baseline shorter than eight observations', () => {
  // sd of [10, 11, 12, 11] is ~0.82, so 14 is ~3.7 sigma: too few points to trust.
  assert.deepEqual(anomaliesFromLastValue([10, 11, 12, 11, 14]), []);
});

test('an ordinary value raises nothing', () => {
  assert.deepEqual(anomaliesFromLastValue([98, 102, 99, 101, 100, 103, 97, 100, 101]), []);
});

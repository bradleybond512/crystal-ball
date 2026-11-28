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
  assert.equal(raised.length, 2);
  assert.equal(raised[0]!.type, 'spike');
  assert.equal(raised[0]!.severity, 'critical');
  assert.match(raised[0]!.description, /burst detected/);
  // A burst must not erase the separate legacy reversal.
  assert.equal(raised[1]!.type, 'reversal');
  assert.equal(raised[1]!.severity, 'info');
  assert.ok(Math.abs(raised[1]!.zScore - Math.sqrt(5)) < 1e-12);
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

/** Observe the real engine through subscribers, history, and a fake document. */
function trace(values: readonly number[], offsets = values.map((_, i) => i * MINUTE)) {
  const source = 'repair-fixture';
  const storage = new Map<string, string>();
  const events: Anomaly[] = [];
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    dispatchEvent: (event: CustomEvent<Anomaly>) => { events.push(event.detail); return true; },
  } });
  anomalyEngine.reset();
  const raised: Anomaly[][] = [];
  let current: Anomaly[] = [];
  const unsubscribe = anomalyEngine.subscribe(a => { current.push(a); });
  try {
    values.forEach((value, i) => {
      current = [];
      anomalyEngine.ingest(source, value, 1_700_000_000_000 + offsets[i]!);
      raised.push(current);
    });
    return { raised, history: anomalyEngine.getHistory(), events: [...events] };
  } finally {
    unsubscribe();
    anomalyEngine.reset();
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}
const spikes = (anomalies: readonly Anomaly[]) => anomalies.filter(a => a.type === 'spike');

test('reversal keeps its legacy inclusive SD and info severity on a falling turn', () => {
  const raised = trace([10, 11, 12, 0]).raised.at(-1)!;
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.type, 'reversal');
  assert.equal(raised[0]!.severity, 'info');
  assert.ok(Math.abs(raised[0]!.zScore - 12 / Math.sqrt(30.916666666666668)) < 1e-12);
  assert.equal(raised[0]!.expectedMin, 10);
  assert.equal(raised[0]!.expectedMax, 12);
});

test('a flat prior window still yields the legacy reversal when the latest value changes', () => {
  const raised = trace([10, 10, 10, 20]).raised.at(-1)!;
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.type, 'reversal');
  assert.equal(raised[0]!.severity, 'info');
  assert.equal(raised[0]!.zScore, 2);
});

for (const baselineSize of [8, 11]) {
  test(`same-ingestion critical burst beats the lower z-score spike with ${baselineSize} prior observations`, () => {
    // mean 1, sample SD sqrt(n): the z-score is warning (n=8) or info (n=11).
    const result = trace([...Array<number>(baselineSize - 1).fill(0), baselineSize, 10]);
    const emitted = result.raised.at(-1)!;
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]!.type, 'spike');
    assert.equal(emitted[0]!.severity, 'critical');
    assert.match(emitted[0]!.description, /burst detected/);
    for (const channel of [result.history, result.events]) {
      assert.equal(spikes(channel).length, 1);
      assert.equal(spikes(channel)[0]!.severity, 'critical');
      assert.equal(spikes(channel)[0]!.id, emitted[0]!.id);
    }
  });
}

test('equal-critical collision retains the original z-score metadata', () => {
  const raised = spikes(trace([0, 0, 0, 0, 0, 0, 0, 8, 20]).raised.at(-1)!);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.severity, 'critical');
  assert.doesNotMatch(raised[0]!.description, /burst detected/);
  assert.ok(Math.abs(raised[0]!.expectedMin - (1 - 2.5 * Math.sqrt(8))) < 1e-12);
  assert.ok(Math.abs(raised[0]!.expectedMax - (1 + 2.5 * Math.sqrt(8))) < 1e-12);
});

test('burst is gated at exactly three prior observations, not two', () => {
  assert.equal(spikes(trace([1, 1, 10]).raised.at(-1)!).length, 0);
  const raised = spikes(trace([1, 1, 1, 10]).raised.at(-1)!);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.severity, 'critical');
  assert.match(raised[0]!.description, /burst detected/);
});

test('z-score is gated at exactly eight prior observations, not seven', () => {
  assert.equal(spikes(trace([98, 102, 99, 101, 100, 103, 97, 110]).raised.at(-1)!).length, 0);
  const raised = spikes(trace([98, 102, 99, 101, 100, 103, 97, 100, 110]).raised.at(-1)!);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.zScore, 5);
});

for (const [offset, expected] of [[4 * MINUTE, 0], [5 * MINUTE, 0], [5 * MINUTE + 1, 1]] as const) {
  test(`cross-ingestion spike cooldown is unchanged at ${offset} ms`, () => {
    const values = [0, 0, 0, 0, 0, 0, 0, 8, 10, 100];
    const offsets = values.map((_, i) => i * MINUTE);
    offsets[9] = offsets[8]! + offset;
    const result = trace(values, offsets);
    assert.equal(spikes(result.raised[8]!).length, 1);
    assert.equal(spikes(result.raised[9]!).length, expected);
  });
}

test('a prior warning still suppresses a later critical spike inside five minutes', () => {
  const result = trace([98, 102, 99, 101, 100, 103, 97, 100, 106, 1000]);
  assert.equal(spikes(result.raised[8]!).length, 1);
  assert.equal(spikes(result.raised[8]!)[0]!.severity, 'warning');
  assert.equal(spikes(result.raised[9]!).length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GOLDEN_STREAMS, PLANTED_COUPLINGS } from '../__bench__/golden-streams';
import { runCorrelationBenchmark } from '../bench-correlation';
import * as baseline from '../bench-correlation-baseline';
const previous = JSON.parse(readFileSync(new URL('./fixtures/bench-correlation-v13.json', import.meta.url), 'utf8'));

test('S11 adds an explicitly planted weak causal fixture without changing the original streams', () => {
  assert.equal(GOLDEN_STREAMS.length, 11);
  const s = GOLDEN_STREAMS.find(x => x.id === 'near-boundary-causal');
  assert.equal(s?.observations.length, 35);
  assert.equal(PLANTED_COUPLINGS.find(x => x.from === 'boundary-a' && x.to === 'boundary-b')?.kind, 'causal');
  const report = runCorrelationBenchmark();
  for (const [id, digest] of Object.entries(previous.streamDigests)) assert.equal(report.streamDigests[id], digest);
});
test('real candidate is recovered near the actual Holm boundary', () => {
  const report = runCorrelationBenchmark();
  assert.equal(report.boundaryRecall?.length, 1);
  const row = report.boundaryRecall[0];
  assert.equal(row.admitted, true); assert.equal(row.becameLearnedRule, true);
  assert.equal(row.bindingGate, 'holm-adjusted-p');
  assert.ok(row.alphaUtilization >= .85 && row.alphaUtilization <= .99);
  assert.equal(row.eligibleOrderedPairs, 342);
  assert.deepEqual(baseline.validateBoundaryRecall(report), []);
});
test('schema fourteen baseline carries readable boundary evidence', () => {
  const report = runCorrelationBenchmark();
  const candidate = baseline.seedCorrelationBenchBaseline(report, previous, previous.seededAt);
  assert.equal(candidate.schemaVersion, 14);
  assert.deepEqual(candidate.boundaryRecall, report.boundaryRecall);
});
test('only the reviewed additive v13 to v14 transition can reseed', () => {
  assert.equal(typeof baseline.validateCorrelationBenchV13ToV14Migration, 'function');
  const report = runCorrelationBenchmark();
  const valid = baseline.validateCorrelationBenchV13ToV14Migration(report, previous);
  assert.deepEqual(valid, {ok:true,reasons:[]});
  const altered = structuredClone(previous); altered.tolerances.couplingRecallDrop=.1;
  assert.equal(baseline.validateCorrelationBenchV13ToV14Migration(report, altered).ok,false);
});

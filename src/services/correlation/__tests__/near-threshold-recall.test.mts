import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GOLDEN_STREAMS, PLANTED_COUPLINGS, CORPUS_T0 } from '../__bench__/golden-streams';
import { runCorrelationBenchmark } from '../bench-correlation';
import * as gate from '../bench-correlation-baseline';

test('boundary fixture declares an additional causal relationship with six causes and four delayed effects', () => {
  const stream = GOLDEN_STREAMS.find(row => row.id === 'near-boundary-causal');
  assert.ok(stream, 'a real causal fixture must exercise the promotion boundary');
  assert.equal(PLANTED_COUPLINGS.find(row => row.from === 'boundary-a' && row.to === 'boundary-b')?.kind, 'causal');
  assert.equal(stream.observations.filter(row => row.domain === 'boundary-a').length, 6);
  assert.equal(stream.observations.filter(row => row.domain === 'boundary-b').length, 29);
  const effects = new Set(stream.observations.filter(row => row.domain === 'boundary-b').map(row => row.timestamp));
  const causes = stream.observations.filter(row => row.domain === 'boundary-a');
  assert.equal(causes.filter(row => effects.has(row.timestamp + 1_800_000)).length, 4);
});


const DAY = 86_400_000;
let cached: ReturnType<typeof runCorrelationBenchmark>;
function report() { return structuredClone(cached ??= runCorrelationBenchmark()); }
function previous() { return JSON.parse(readFileSync(new URL('./fixtures/bench-correlation-v13.json', import.meta.url), 'utf8')); }
function boundary(value = report()) {
  assert.ok(Array.isArray(value.boundaryRecall), 'report must preserve an actual boundary candidate');
  assert.equal(value.boundaryRecall.length, 1);
  return value.boundaryRecall[0]!;
}
function boundaryReasons(value = report()) {
  assert.equal(typeof gate.validateBoundaryRecall, 'function');
  return gate.validateBoundaryRecall(value);
}
// Hand-authored boundary values differ from the frozen run; isolate only its exact replay pin.
function policyReasons(value: ReturnType<typeof report>) {
  return boundaryReasons(value).filter(reason => !reason.startsWith('boundaryRecall'));
}
function seed(value = report()) {
  const prior = previous();
  return gate.seedCorrelationBenchBaseline(value, { note: prior.note, tolerances: prior.tolerances }, prior.seededAt);
}
function withCorpus(action: () => void) {
  const streams = [...GOLDEN_STREAMS];
  const truth = [...PLANTED_COUPLINGS];
  try { action(); return runCorrelationBenchmark(); }
  finally {
    (GOLDEN_STREAMS as unknown[]).splice(0, GOLDEN_STREAMS.length, ...streams);
    (PLANTED_COUPLINGS as unknown[]).splice(0, PLANTED_COUPLINGS.length, ...truth);
  }
}
function replaceBoundary(transform: (observations: typeof GOLDEN_STREAMS[number]['observations']) => typeof GOLDEN_STREAMS[number]['observations']) {
  const index = GOLDEN_STREAMS.findIndex(row => row.id === 'near-boundary-causal');
  assert.ok(index >= 0);
  const stream = GOLDEN_STREAMS[index]!;
  (GOLDEN_STREAMS as unknown[])[index] = { ...stream, observations: transform(stream.observations) };
}

test('real miner and engine recover the boundary relationship and preserve original streams', t => {
  const value = report(); const row = boundary(value);
  assert.equal(value.streamCount, 11); assert.equal(value.observationCount, 504);
  assert.equal(value.plantedCausalCount, 6); assert.equal(value.couplingRecall, 1);
  assert.equal(value.falseEdgeCount, 0); assert.equal(value.decoyPairsEmitted, 0);
  assert.equal(row.from, 'boundary-a'); assert.equal(row.to, 'boundary-b');
  assert.equal(row.support, 4); assert.equal(row.antecedents, 6);
  assert.equal(row.eligibleOrderedPairs, 342); assert.equal(row.alpha, .05);
  assert.ok(Math.abs(row.adjustedPValue - .04514048363946339) < 1e-12);
  assert.equal(row.alphaUtilization, row.adjustedPValue / row.alpha);
  assert.equal(row.bindingGate, 'holm-adjusted-p');
  assert.equal(row.posteriorSlack, row.posteriorProbability - .8);
  assert.equal(row.utilitySlack, row.expectedUtility);
  assert.equal(row.admitted, true); assert.equal(row.becameLearnedRule, true);
  assert.deepEqual(boundaryReasons(value), []);
  t.diagnostic(JSON.stringify({ fixture: 'approved-boundary', candidate: row }));
  for (const [id, digest] of Object.entries(previous().streamDigests)) assert.equal(value.streamDigests[id], digest, id);
});

test('an absent causal fixture retains no invented boundary witness', () => {
  const value = withCorpus(() => {
    const index = GOLDEN_STREAMS.findIndex(row => row.id === 'near-boundary-causal');
    assert.ok(index >= 0); (GOLDEN_STREAMS as unknown[]).splice(index, 1);
  });
  assert.deepEqual(value.boundaryRecall, []);
  assert.ok(boundaryReasons(value).length > 0);
});

test('real easier and harder neighbors fail opposite sides of boundary coverage', t => {
  const easier = withCorpus(() => replaceBoundary(observations => {
    const causes = new Set(observations.filter(row => row.domain === 'boundary-a').map(row => row.timestamp + 1_800_000));
    const background = observations.filter(row => row.domain === 'boundary-b' && !causes.has(row.timestamp));
    const removeId = background.at(-1)!.id;
    return observations.filter(row => row.id !== removeId);
  }));
  const easy = boundary(easier);
  assert.equal(easy.admitted, true); assert.equal(easy.becameLearnedRule, true);
  assert.ok(easy.alphaUtilization < .85, `easier utilization ${easy.alphaUtilization}`);
  assert.ok(policyReasons(easier).length > 0, 'an admitted fixture that is too easy must fail');
  const harder = withCorpus(() => replaceBoundary(observations => {
    const exemplar = observations.find(row => row.domain === 'boundary-b')!;
    return [...observations, { ...exemplar, id: 'harder-background', timestamp: CORPUS_T0 + .63 * DAY }];
  }));
  const hard = boundary(harder);
  assert.ok(hard.alphaUtilization > 1); assert.ok(hard.posteriorProbability >= .8);
  assert.equal(hard.admitted, false); assert.equal(hard.becameLearnedRule, false);
  assert.ok(policyReasons(harder).length > 0);
  t.diagnostic(JSON.stringify({ fixture: 'calibration-neighbors', easier: easy, harder: hard }));
});

test('independent-domain family growth exposes a rejected candidate instead of stale success', t => {
  const value = withCorpus(() => {
    const exemplar = GOLDEN_STREAMS[0]!.observations[0]!;
    (GOLDEN_STREAMS as unknown[]).push({ id: 'family-drift', description: 'independent domain', truePairKeys: [], decoyEventIds: [],
      observations: [1.23, 10.353, 19.476].map((day, i) => ({ ...exemplar, id: `family-drift-${i}`, domain: 'drift-independent', timestamp: CORPUS_T0 + day * DAY })) });
  });
  const row = boundary(value);
  assert.equal(row.eligibleOrderedPairs, 380);
  assert.ok(Math.abs(row.adjustedPValue - .05041844788038526) < 1e-12);
  assert.equal(row.alphaUtilization, row.adjustedPValue / row.alpha);
  assert.equal(row.admitted, false); assert.equal(row.becameLearnedRule, false);
  assert.ok(policyReasons(value).length > 0);
  t.diagnostic(JSON.stringify({ fixture: 'family-drift', candidate: row }));
});

test('boundary validator enforces the inclusive engineering band using realized alpha', () => {
  for (const utilization of [.85, .99]) {
    const value = report(); const row = boundary(value);
    row.adjustedPValue = utilization * row.alpha; row.alphaUtilization = row.adjustedPValue / row.alpha;
    assert.deepEqual(policyReasons(value), [], `inclusive utilization ${utilization}`);
  }
  for (const utilization of [.85 - 1e-8, .99 + 1e-8]) {
    const value = report(); const row = boundary(value);
    row.adjustedPValue = utilization * row.alpha; row.alphaUtilization = row.adjustedPValue / row.alpha;
    assert.ok(policyReasons(value).length > 0, `outside utilization ${utilization}`);
  }
  const changedAlpha = report(); boundary(changedAlpha).alpha = .1;
  assert.ok(policyReasons(changedAlpha).length > 0, 'candidate alpha must match the actual family');
  const staleMargin = report(); boundary(staleMargin).alphaUtilization = .9;
  assert.ok(policyReasons(staleMargin).length > 0, 'rounded or cached margin cannot replace realized ratio');
});

test('boundary validator fails closed on missing, malformed and duplicate measurements', () => {
  for (const value of [undefined, null, [], [null], [42], [[]], [boundary(), boundary()]]) {
    const changed = report(); changed.boundaryRecall = value;
    assert.ok(boundaryReasons(changed).length > 0, `invalid rows ${String(value)}`);
  }
  const numeric = ['support', 'antecedents', 'lift', 'zScore', 'windowMs', 'adjustedPValue', 'alpha', 'eligibleOrderedPairs', 'posteriorProbability', 'expectedUtility', 'alphaUtilization', 'posteriorSlack', 'utilitySlack'];
  for (const key of numeric) for (const bad of [NaN, Infinity, undefined, null]) {
    const changed = report(); boundary(changed)[key] = bad;
    assert.ok(policyReasons(changed).length > 0, `${key}=${String(bad)}`);
  }
});

test('identity, admission, recovery and underlying gate failures cannot claim boundary success', () => {
  for (const patch of [
    { from: 'boundary-b', to: 'boundary-a' }, { from: 'not-planted' }, { bindingGate: 'criticalAbsZ' },
    { admitted: false }, { becameLearnedRule: false }, { support: 2 }, { antecedents: 0 },
    { lift: 1.99 }, { zScore: 1.99 }, { posteriorProbability: .79, posteriorSlack: -.01 },
    { expectedUtility: 0, utilitySlack: 0 }, { eligibleOrderedPairs: 341 }, { windowMs: -1 },
    { posteriorSlack: .5 }, { utilitySlack: 99 },
  ]) {
    const changed = report(); Object.assign(boundary(changed), patch);
    assert.ok(policyReasons(changed).length > 0, JSON.stringify(patch));
  }
});

test('a self-consistent forged report and baseline cannot invent recovery or candidate evidence', () => {
  const honest = report(); assert.equal(gate.compareCorrelationBenchToBaseline(honest, seed(honest)).ok, true);
  for (const patch of [{ support: 5 }, { adjustedPValue: .046, alphaUtilization: .92 }, { admitted: false }, { becameLearnedRule: false }]) {
    const changed = report(); Object.assign(boundary(changed), patch);
    assert.ok(boundaryReasons(changed).length > 0, 'candidate witness must reproduce the actual miner');
    assert.equal(gate.compareCorrelationBenchToBaseline(changed, seed(changed)).ok, false, JSON.stringify(patch));
  }
});

test('explicit schema migration accepts only the reviewed old payload and tolerances', () => {
  assert.equal(typeof gate.validateCorrelationBenchV13ToV14Migration, 'function');
  const value = report(); const old = previous(); const manifest = structuredClone(gate.CORRELATION_BENCH_V13_TO_V14_MIGRATION);
  assert.equal(old.schemaVersion, 13);
  assert.equal(gate.validateCorrelationBenchV13ToV14Migration(value, old, manifest).ok, true);
  for (const change of [
    (before: typeof old) => { before.schemaVersion = 14; },
    (before: typeof old) => { before.reportDigest = 'f'.repeat(32); },
    (before: typeof old) => { before.corpusDigest = 'e'.repeat(32); },
    (before: typeof old) => { before.minedEdgeCount += 1; },
    (before: typeof old) => { before.tolerances.couplingRecallDrop = .1; },
    (before: typeof old) => { before.streamDigests['seismic-ocean'] = '0'.repeat(32); },
    (before: typeof old) => { before.witnessed.sectionDigests.edges = '0'.repeat(32); },
    (before: typeof old) => { before.unreviewedField = 1; },
  ]) {
    const tampered = structuredClone(old); change(tampered);
    assert.equal(gate.validateCorrelationBenchV13ToV14Migration(value, tampered, manifest).ok, false, change.toString());
  }
});

test('migration rejects changed candidates, removed old evidence and caller-forged manifests', () => {
  assert.equal(typeof gate.validateCorrelationBenchV13ToV14Migration, 'function');
  const old = previous(); const manifest = structuredClone(gate.CORRELATION_BENCH_V13_TO_V14_MIGRATION);
  for (const change of [
    (value: ReturnType<typeof report>) => { value.streamDigests['seismic-ocean'] = '0'.repeat(32); },
    (value: ReturnType<typeof report>) => { value.observationCount += 1; },
    (value: ReturnType<typeof report>) => { value.couplingRecall = .9; },
    (value: ReturnType<typeof report>) => { value.boundaryRecall = []; },
    (value: ReturnType<typeof report>) => { value.learnedPairs = value.learnedPairs.filter(row => row.ruleId.includes('boundary')); },
    (value: ReturnType<typeof report>) => { value.extraUnreviewedMeasurement = 1; },
  ]) {
    const changed = report(); change(changed);
    assert.equal(gate.validateCorrelationBenchV13ToV14Migration(changed, old, manifest).ok, false, change.toString());
  }
  for (const patch of [{ toSchemaVersion: 15 }, { fromSchemaVersion: 12 }, { previousPayloadDigest: '0'.repeat(32) }, { reason: 'unapproved replacement' }]) {
    assert.equal(gate.validateCorrelationBenchV13ToV14Migration(report(), old, { ...manifest, ...patch }).ok, false, JSON.stringify(patch));
  }
});


test('adding the weak relationship preserves every old learned rule emission', () => {
  const old = withCorpus(() => {
    const stream = GOLDEN_STREAMS.findIndex(row => row.id === 'near-boundary-causal');
    assert.ok(stream >= 0); (GOLDEN_STREAMS as unknown[]).splice(stream, 1);
    const truth = PLANTED_COUPLINGS.findIndex(row => row.from === 'boundary-a' && row.to === 'boundary-b');
    assert.ok(truth >= 0); (PLANTED_COUPLINGS as unknown[]).splice(truth, 1);
  });
  assert.equal(old.causalLearnedRuleCount, 5); assert.equal(old.causalLearnedRulePairCount, 32);
  const oldIds = new Set(old.learnedPairs.map(row => row.ruleId));
  const preserved = report().learnedPairs.filter(row => oldIds.has(row.ruleId));
  assert.deepEqual(preserved, old.learnedPairs);
});


test('independent planted truth cannot be replaced by the report claim', () => {
  const value = report(); const original = [...PLANTED_COUPLINGS];
  const chosen = original.find(row => row.from === 'boundary-a' && row.to === 'boundary-b')!;
  for (const replacement of [[], [chosen, chosen], [{ ...chosen, kind: 'independent' }]]) {
    try {
      (PLANTED_COUPLINGS as unknown[]).splice(0, PLANTED_COUPLINGS.length,
        ...original.filter(row => row !== chosen), ...replacement);
      assert.ok(policyReasons(value).length > 0, 'truth must independently declare one causal direction');
    } finally { (PLANTED_COUPLINGS as unknown[]).splice(0, PLANTED_COUPLINGS.length, ...original); }
  }
});

test('normal benchmark gate rejects genuinely changed boundary runs even with matching new baselines', () => {
  const sources = {
    corpus: new URL('../__bench__/golden-streams.ts', import.meta.url).href,
    benchmark: new URL('../bench-correlation.ts', import.meta.url).href,
    gate: new URL('../bench-correlation-baseline.ts', import.meta.url).href,
  };
  for (const scenario of ['easier', 'harder', 'family-drift', 'unreviewed-source']) {
    const code = `
      import { GOLDEN_STREAMS, CORPUS_T0 } from ${JSON.stringify(sources.corpus)};
      import { runCorrelationBenchmark } from ${JSON.stringify(sources.benchmark)};
      import { seedCorrelationBenchBaseline, compareCorrelationBenchToBaseline, DEFAULT_CORRELATION_BENCH_TOLERANCES, validateCorrelationBenchV13ToV14Migration } from ${JSON.stringify(sources.gate)};
      import { readFileSync } from 'node:fs';
      const scenario = ${JSON.stringify(scenario)};
      const index = GOLDEN_STREAMS.findIndex(row => row.id === 'near-boundary-causal');
      const stream = GOLDEN_STREAMS[index];
      if (!stream) throw new Error('Missing real fixture');
      const causes = new Set(stream.observations.filter(row => row.domain === 'boundary-a').map(row => row.timestamp + 1800000));
      const background = stream.observations.filter(row => row.domain === 'boundary-b' && !causes.has(row.timestamp));
      if (scenario === 'easier') GOLDEN_STREAMS[index] = { ...stream, observations: stream.observations.filter(row => row.id !== background.at(-1).id) };
      if (scenario === 'harder') GOLDEN_STREAMS[index] = { ...stream, observations: [...stream.observations, { ...background[0], id: 'harder-background', timestamp: CORPUS_T0 + .63 * 86400000 }] };
      if (scenario === 'family-drift') GOLDEN_STREAMS.push({ id:'extra-independent-domain', description:'family perturbation', truePairKeys:[], decoyEventIds:[], observations:[1.23,10.353,19.476].map((day,i) => ({ ...background[0], id:'independent-'+i, domain:'drift-independent', timestamp:CORPUS_T0+day*86400000 })) });
      if (scenario === 'unreviewed-source') GOLDEN_STREAMS[index] = { ...stream, observations: stream.observations.map((row,i) => i === 0 ? { ...row, sourceId:'unreviewed-source' } : row) };
      const report = runCorrelationBenchmark();
      const seeded = seedCorrelationBenchBaseline(report, { note:'independent perturbation', tolerances:DEFAULT_CORRELATION_BENCH_TOLERANCES }, '2026-11-05T00:00:00.000Z');
      const result = compareCorrelationBenchToBaseline(report, seeded);
      const previous = JSON.parse(readFileSync(${JSON.stringify(fileURLToPath(new URL('./fixtures/bench-correlation-v13.json', import.meta.url)))}, 'utf8'));
      const migration = validateCorrelationBenchV13ToV14Migration(report, previous);
      console.log(JSON.stringify({ scenario, result, migration, boundary:report.boundaryRecall }));
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)), encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    if (scenario === 'unreviewed-source') {
      assert.equal(result.result.ok, true, 'matching baseline and unchanged numeric margin remain internally consistent');
      assert.equal(result.migration.ok, false, 'migration cannot approve an unreviewed S11 source change');
    } else {
      assert.equal(result.result.ok, false, scenario);
      assert.ok(result.result.reasons.some((reason: string) => reason.includes('boundary recall')), JSON.stringify(result));
    }
  }
});


test('persisted boundary witness must agree with the live report', () => {
  const value = report(); const seeded = seed(value);
  assert.equal(gate.compareCorrelationBenchToBaseline(value, seeded).ok, true);
  seeded.boundaryRecall[0].adjustedPValue += .0001;
  assert.equal(gate.compareCorrelationBenchToBaseline(value, seeded).ok, false);
  const missing = seed(value); delete missing.boundaryRecall;
  assert.equal(gate.compareCorrelationBenchToBaseline(value, missing).ok, false);
});

test('seeded candidate owns a defensive copy of the boundary witness', () => {
  const value = report(); const seeded = seed(value); const original = structuredClone(value.boundaryRecall);
  seeded.boundaryRecall[0].support = 0;
  seeded.boundaryRecall.push({ ...seeded.boundaryRecall[0] });
  assert.deepEqual(value.boundaryRecall, original);
});

test('CLI routes the reviewed prior schema through explicit migration and refuses tampering', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'acc508-prior-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../../../../scripts/correlation-benchmark.mts', import.meta.url));
  const priorPath = path.join(directory, 'prior.json');
  const old = previous(); writeFileSync(priorPath, JSON.stringify(old));
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', cli, '--seed', '--previous-baseline', priorPath], {
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)), encoding: 'utf8', timeout: 30_000,
  });
  const valid = run(); assert.equal(valid.status, 0, valid.stderr);
  const candidate = JSON.parse(valid.stdout);
  assert.equal(candidate.schemaVersion, 14);
  assert.deepEqual(candidate.tolerances, old.tolerances);
  assert.deepEqual(candidate.boundaryRecall, report().boundaryRecall);
  old.tolerances.couplingRecallDrop = .1; writeFileSync(priorPath, JSON.stringify(old));
  const invalid = run(); assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout.trim(), '', 'rejected migration must not emit a candidate baseline');
  assert.match(invalid.stderr, /REFUSED/);
});

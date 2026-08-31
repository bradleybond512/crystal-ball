import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CANONICAL_EXECUTABLE,
  aggregateProcessSample,
  buildPackagedReport,
  parsePackagedArgs,
  parseProcessTable,
  percentile,
  selectProcessTree,
  validateCheckpoint,
} from '../../scripts/measure-ux025-packaged.mjs';

const ROWS = [
  { pid: 10, ppid: 1, cpuPercent: 1.5, rssKb: 100, command: CANONICAL_EXECUTABLE },
  { pid: 11, ppid: 10, cpuPercent: 2.5, rssKb: 200, command: 'child worker' },
  { pid: 12, ppid: 11, cpuPercent: 3, rssKb: 300, command: 'grandchild worker' },
  { pid: 99, ppid: 1, cpuPercent: 80, rssKb: 900, command: 'unrelated' },
];

test('process parser, recursive selection, and aggregation exclude unrelated processes', () => {
  const parsed = parseProcessTable(`10 1 1.5 100 ${CANONICAL_EXECUTABLE}\n11 10 2.5 200 child worker\n`);
  assert.equal(parsed.length, 2);
  assert.deepEqual(selectProcessTree(ROWS, 10).map((row) => row.pid), [10, 11, 12]);
  assert.deepEqual(aggregateProcessSample(ROWS, 10, 'fixed'), { sampledAt: 'fixed', pids: [10, 11, 12], cpuPercent: 7, rssKb: 600 });
  assert.throws(() => selectProcessTree([{ ...ROWS[0], command: '/tmp/crystalball' }], 10), /not the canonical/);
});

test('nearest-rank percentile and packaged report schema are stable', () => {
  assert.equal(percentile([5, 1, 4, 2, 3], 0.5), 3);
  assert.equal(percentile([5, 1, 4, 2, 3], 0.95), 5);
  const sample = aggregateProcessSample(ROWS, 10, 'fixed');
  const report = buildPackagedReport({ expectedSha: 'abc', rootPid: 10, durationMs: 60_000, cadenceMs: 1_000, runs: 3, rawRuns: [[sample], [sample], [sample]], measuredAt: 'fixed' });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, 'ux025-packaged-performance');
  assert.equal(report.scenario.processSelection, 'root-and-recursive-children');
  assert.equal(report.runs.length, 3);
  assert.deepEqual(Object.keys(report.summary), ['cpuPercent', 'rssKb']);
});

test('packaged arguments and checkpoint SHA fail closed', () => {
  assert.throws(() => parsePackagedArgs([]), /--root-pid is required/);
  const parsed = parsePackagedArgs(['--root-pid', '10', '--state-file', 'state.json', '--expected-sha', 'abc', '--output', 'out.json']);
  assert.equal(parsed.durationMs, 60_000);
  assert.equal(parsed.runs, 3);
  const directory = mkdtempSync(join(os.tmpdir(), 'ux025-state-'));
  const state = join(directory, 'state.json');
  writeFileSync(state, JSON.stringify({ localBuildSha: 'abc' }));
  assert.equal(validateCheckpoint(state, 'abc').localBuildSha, 'abc');
  assert.throws(() => validateCheckpoint(state, 'def'), /checkpoint SHA mismatch/);
});

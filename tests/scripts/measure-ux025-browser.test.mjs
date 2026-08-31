import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBrowserReport, parseBrowserArgs, summarizeIntervals } from '../../scripts/measure-ux025-browser.mjs';

test('browser measurement requires label/output and exactly three runs', () => {
  assert.throws(() => parseBrowserArgs([]), /--label is required/);
  assert.throws(() => parseBrowserArgs(['--label', 'base', '--output', 'out.json', '--runs', '2']), /exactly three runs/);
  const parsed = parseBrowserArgs(['--label', 'base', '--output', 'out.json']);
  assert.equal(parsed.runs, 3);
  assert.equal(parsed.port, 4187);
});

test('frame interval summary and browser report schema are stable', () => {
  assert.deepEqual(summarizeIntervals([20, 10, 30]), { count: 3, medianMs: 20, p95Ms: 30, maxMs: 30 });
  const args = { label: 'baseline', output: 'out.json', port: 4187, baseUrl: 'http://127.0.0.1:4187', durationMs: 3000, runs: 3 };
  const run = { animationFrameIntervalsMs: [16, 17], longTasksMs: [], externalRequests: [] };
  const report = buildBrowserReport({ args, commit: 'abc', rawRuns: [run, run, run], measuredAt: 'fixed' });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, 'ux025-browser-performance');
  assert.equal(report.scenario.networkPolicy, 'same-origin-only');
  assert.equal(report.runs.length, 3);
  assert.deepEqual(Object.keys(report.summary), ['animationFrameIntervals', 'longTaskCount', 'longTaskTotalMs']);
});

#!/usr/bin/env node
/**
 * Wrapper that runs the panel smoke harness and exits based on the
 * structured report rather than node:test's exit code.
 *
 * Why: panels that fire-and-forget refresh promises (`void
 * this.fetchData()`) reject AFTER the test row has already been recorded.
 * node:test treats those late rejections as test failures, so its exit
 * code is unreliable as a regression gate. We want the harness to be
 * useful as both a report and a gate, so this wrapper interprets the
 * report directly:
 *
 *   - Always: render Markdown report to stdout.
 *   - PANEL_SMOKE_FAIL_ON=silent,errored (default) — exit 1 if any
 *     panel matches one of the listed states.
 *   - PANEL_SMOKE_FAIL_ON=never — always exit 0 (report-only mode).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const reportPath = path.join(here, '.last-report.json');

const failOn = (process.env.PANEL_SMOKE_FAIL_ON ?? 'silent,errored')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const baselinePath = path.join(here, 'baseline.json');
let baseline = { silent: [], errored: [], skipped: [] };
if (existsSync(baselinePath)) {
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    // Treat malformed baseline as empty.
  }
}

const result = spawnSync('npx', [
  'tsx',
  '--import', './tests/panels/register-hook.mjs',
  '--test',
  'tests/panels/panel-smoke.test.mts',
  'tests/panels/sidecar-routes-audit.test.mts',
], { cwd: projectRoot, stdio: 'inherit' });

if (!existsSync(reportPath)) {
  console.error('[panel-smoke] no report produced — harness crashed before summary.');
  process.exit(result.status === 0 ? 1 : (result.status ?? 1));
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const offenders = (report.panels ?? []).filter((p) => failOn.includes(p.state));

// Subtract the baseline of known-broken panels — those don't fail the
// gate, but they ARE listed in the report so they remain visible.
const baselineSet = new Set([
  ...(baseline.silent ?? []),
  ...(baseline.errored ?? []),
]);
const newOffenders = offenders.filter((p) => !baselineSet.has(p.id));
const stillBaselined = offenders.filter((p) => baselineSet.has(p.id));

if (stillBaselined.length > 0) {
  console.log(`\n[panel-smoke] ${stillBaselined.length} known-broken panel(s) still in {${failOn.join(', ')}} (baselined):`);
  for (const p of stillBaselined) console.log(`  ${p.state.padEnd(8)}  ${p.id}`);
}

if (newOffenders.length === 0) {
  console.log(`\n[panel-smoke] PASS — no NEW panels in {${failOn.join(', ')}} state.`);
  process.exit(0);
}

console.error(`\n[panel-smoke] FAIL — ${newOffenders.length} new panel(s) in {${failOn.join(', ')}} state (not in baseline):`);
for (const p of newOffenders) console.error(`  ${p.state.padEnd(8)}  ${p.id}`);
console.error('\nIf the regression is intentional, add the panel id to tests/panels/baseline.json.');
process.exit(1);

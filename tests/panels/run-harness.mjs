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

// ── Non-degenerate guard ────────────────────────────────────────────────
// The offender logic below subtracts the baseline, so a report that rendered
// 0 panels (registry collapse) or where everything errored produced an EMPTY
// offender list and slipped through as a green PASS. Reject reports that the
// harness plainly didn't exercise. Floors are env-robust: an absolute minimum
// (catches the registry returning a handful) plus a relative 10%-usable share
// (catches "everything errored/skipped" without false-failing on fixture-sparse
// runs where many panels legitimately skip).
{
  const states = report.states ?? {};
  const panelCount = report.panelCount ?? (Array.isArray(report.panels) ? report.panels.length : 0);
  const usable = (states.rendered ?? 0) + (states.degraded ?? 0);
  const minPanels = Number(process.env.PANEL_SMOKE_MIN_PANELS ?? 50);
  const degenerate = [];
  if (!Array.isArray(report.panels) || report.panels.length === 0) {
    degenerate.push('report contains 0 panels (harness/registry crashed before exercising panels)');
  } else if (panelCount < minPanels) {
    degenerate.push(`only ${panelCount} panels enumerated (expected >= ${minPanels}; the panel registry likely collapsed)`);
  }
  if (panelCount > 0 && usable < Math.ceil(panelCount * 0.1)) {
    degenerate.push(`only ${usable}/${panelCount} panels reached a rendered/degraded state (>=10% expected; nearly everything errored or skipped)`);
  }
  if (degenerate.length > 0) {
    console.error('\n[panel-smoke] FAIL — degenerate report; passing this would be green-when-broken:');
    for (const d of degenerate) console.error(`  • ${d}`);
    console.error('\nThis means the harness did not actually exercise the panels — not that the panels are healthy.');
    process.exit(1);
  }
}

const stateOffenders = (report.panels ?? []).filter((p) => failOn.includes(p.state));
// Async errors are a separate signal: a panel can be `degraded` (a
// loading banner is visible) yet have a fire-and-forget rejection
// upstream. We treat any panel with asyncErrors as an offender too.
const asyncOffenders = (report.panels ?? []).filter(
  (p) => Array.isArray(p.asyncErrors) && p.asyncErrors.length > 0,
);

// Merge the two offender lists by id so a panel that's both `errored`
// AND has asyncErrors is reported once.
const offendersById = new Map();
for (const p of [...stateOffenders, ...asyncOffenders]) {
  offendersById.set(p.id, p);
}
const offenders = [...offendersById.values()];

// Subtract the baseline of known-broken panels — those don't fail the
// gate, but they ARE listed in the report so they remain visible.
const baselineSet = new Set([
  ...(baseline.silent ?? []),
  ...(baseline.errored ?? []),
  ...(baseline.asyncErrors ?? []),
]);
const newOffenders = offenders.filter((p) => !baselineSet.has(p.id));
const stillBaselined = offenders.filter((p) => baselineSet.has(p.id));

if (stillBaselined.length > 0) {
  console.log(`\n[panel-smoke] ${stillBaselined.length} known-broken panel(s) still failing (baselined):`);
  for (const p of stillBaselined) {
    const tag = (p.asyncErrors?.length ?? 0) > 0 ? `${p.state}+async` : p.state;
    console.log(`  ${tag.padEnd(14)}  ${p.id}`);
  }
}

if (newOffenders.length === 0) {
  console.log(`\n[panel-smoke] PASS — no NEW panels in {${failOn.join(', ')}} state and no new async-error offenders.`);
  process.exit(0);
}

console.error(`\n[panel-smoke] FAIL — ${newOffenders.length} new panel(s) failing (state ∈ {${failOn.join(', ')}} or asyncErrors > 0; not in baseline):`);
for (const p of newOffenders) {
  const tag = (p.asyncErrors?.length ?? 0) > 0 ? `${p.state}+async` : p.state;
  console.error(`  ${tag.padEnd(14)}  ${p.id}`);
  if (p.asyncErrors?.length) {
    for (const e of p.asyncErrors.slice(0, 3)) console.error(`    └─ ${e}`);
  }
}
console.error('\nIf the regression is intentional, add the panel id to tests/panels/baseline.json.');
process.exit(1);

#!/usr/bin/env node
// Listener-leak guard.
//
// Components that call addEventListener / setInterval without a matching
// removeEventListener / clearInterval accumulate handlers across a session,
// which is a primary cause of the app getting slower the longer it stays open.
//
// This is a *ratchet*, mirroring the a11y baseline: it records the current
// per-file imbalance in scripts/listener-leak-baseline.json and, in --ci mode,
// fails only when a file's imbalance grows beyond its baseline or a brand-new
// offender appears. Run without flags for a ranked report; run with --update to
// re-baseline after intentionally fixing (lowering) counts.
//
// Heuristic, not a type-aware analysis: it counts textual occurrences. A file
// can legitimately add in one method and remove in another, so the goal is
// "don't get worse", not "zero imbalance".

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'listener-leak-baseline.json');
const REPORT_LIMIT = 25;

const args = new Set(process.argv.slice(2));
const CI = args.has('--ci');
const UPDATE = args.has('--update');

function count(haystack, needle) {
  // Count "<needle>(" call sites; tolerant of optional chaining (?.needle).
  const re = new RegExp(`(?:\\.|\\b)${needle}\\s*\\(`, 'g');
  return (haystack.match(re) || []).length;
}

function listTrackedTs() {
  const out = execSync('git ls-files "src/**/*.ts"', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter((f) => f && !f.includes('__tests__') && !f.endsWith('.test.ts') && !f.endsWith('.test.mts'));
}

const files = listTrackedTs();
const offenders = {};
let totalAddRemove = 0;
let totalTimerImbalance = 0;

for (const rel of files) {
  let src;
  try {
    src = readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    continue;
  }
  const add = count(src, 'addEventListener');
  const remove = count(src, 'removeEventListener');
  const setI = count(src, 'setInterval');
  const clearI = count(src, 'clearInterval');
  const listenerGap = Math.max(0, add - remove);
  const timerGap = Math.max(0, setI - clearI);
  if (listenerGap === 0 && timerGap === 0) continue;
  offenders[rel] = { add, remove, listenerGap, setI, clearI, timerGap };
  totalAddRemove += listenerGap;
  totalTimerImbalance += timerGap;
}

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ offenders, totalAddRemove, totalTimerImbalance }, null, 2) + '\n');
  console.log(`[listener-leak] baseline written: ${Object.keys(offenders).length} files, listener gap ${totalAddRemove}, timer gap ${totalTimerImbalance}.`);
  process.exit(0);
}

// Ranked report.
const ranked = Object.entries(offenders)
  .sort((a, b) => (b[1].listenerGap + b[1].timerGap) - (a[1].listenerGap + a[1].timerGap))
  .slice(0, REPORT_LIMIT);

console.log(`[listener-leak] ${Object.keys(offenders).length} files with an add/remove or set/clear imbalance.`);
console.log(`[listener-leak] total unmatched listeners: ${totalAddRemove}, unmatched timers: ${totalTimerImbalance}.`);
console.log(`[listener-leak] top ${ranked.length} offenders (listenerGap / timerGap):`);
for (const [rel, m] of ranked) {
  console.log(`  ${String(m.listenerGap).padStart(3)}L ${String(m.timerGap).padStart(3)}T  ${rel}`);
}

if (!CI) process.exit(0);

if (!existsSync(BASELINE_PATH)) {
  console.error('[listener-leak] --ci requires a baseline. Run: npm run perf:listeners:update');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const regressions = [];
for (const [rel, m] of Object.entries(offenders)) {
  const base = baseline.offenders[rel];
  const baseListener = base ? base.listenerGap : 0;
  const baseTimer = base ? base.timerGap : 0;
  if (m.listenerGap > baseListener || m.timerGap > baseTimer) {
    regressions.push({ rel, m, baseListener, baseTimer });
  }
}

if (regressions.length) {
  console.error(`\n[listener-leak] FAIL — ${regressions.length} file(s) increased listener/timer imbalance:`);
  for (const r of regressions) {
    console.error(`  ${r.rel}: listeners ${r.baseListener} -> ${r.m.listenerGap}, timers ${r.baseTimer} -> ${r.m.timerGap}`);
  }
  console.error('\nAdd matching removeEventListener/clearInterval in destroy(), or re-baseline with');
  console.error('npm run perf:listeners:update once the imbalance is intentionally reduced.');
  process.exit(1);
}

console.log('\n[listener-leak] OK — no file exceeded its baseline imbalance.');
process.exit(0);

#!/usr/bin/env node
/**
 * cognition-shadow-report — PR 13 Shadow Rollout Report.
 *
 * Prints per-run pair counts, divergence rates, Brier scores (live vs shadow
 * where outcomes are resolved), and the flip recommendation for each of the
 * three shadow runs.
 *
 * Usage:
 *   npm run cognition:shadow-report
 *   npm run cognition:shadow-report -- /path/to/snapshot.json
 *
 * Design note — why a JSON file argument, not live localStorage:
 *   The shadow ledger lives in the browser's localStorage / IndexedDB.
 *   A Node.js script cannot read the browser's storage directly.  The
 *   honest, practical solution is a two-step export:
 *
 *   Step 1 (in the app's DevTools console):
 *     copy(localStorage.getItem('crystalball-cognition-shadow-v1'))
 *     Then paste into a file, e.g. /tmp/shadow-snapshot.json
 *
 *   Step 2:
 *     npm run cognition:shadow-report -- /tmp/shadow-snapshot.json
 *
 *   Without a file argument the script prints these instructions and exits 0.
 *
 *   The app also calls persistVerdictSnapshot() (from shadow-rollout.ts) to
 *   keep the localStorage value current.  The IDB copy is the durable backup.
 *
 * Output format:
 *   A table per run with: run ID, pairs, divergence %, Brier live, Brier shadow,
 *   Brier delta, recommendation.  Designed to be read by a human and cited in a
 *   PR description ("a printed number, not a feeling").
 */

import { readFileSync } from 'node:fs';

// ── ANSI colours (best-effort; disabled when not a TTY) ───────────────────────
const isTTY = process.stdout.isTTY;
const C = {
  reset:  isTTY ? '\u001B[0m'  : '',
  bold:   isTTY ? '\u001B[1m'  : '',
  green:  isTTY ? '\u001B[32m' : '',
  yellow: isTTY ? '\u001B[33m' : '',
  red:    isTTY ? '\u001B[31m' : '',
  cyan:   isTTY ? '\u001B[36m' : '',
  dim:    isTTY ? '\u001B[2m'  : '',
};

// ── Types (mirroring shadow-rollout.ts) ───────────────────────────────────────

/** @typedef {{ runId: string; pairs: number; divergenceRate: number; brierLive?: number; brierShadow?: number; recommendation: string; computedAt: number; }} ShadowVerdict */
/** @typedef {{ verdicts: ShadowVerdict[]; snapshottedAt: number; }} ShadowVerdictSnapshot */

// ── Formatting helpers ────────────────────────────────────────────────────────

function pct(v) {
  return (v * 100).toFixed(2) + '%';
}

function brier(v) {
  if (v === undefined || v === null) return C.dim + 'n/a' + C.reset;
  return v.toFixed(4);
}

function brierDelta(live, shadow) {
  if (live === undefined || shadow === undefined) return C.dim + 'n/a' + C.reset;
  const delta = shadow - live;
  const sign  = delta <= 0 ? '-' : '+';
  const colour = delta <= 0 ? C.green : C.red;
  return colour + sign + Math.abs(delta).toFixed(4) + ' (shadow vs live)' + C.reset;
}

function recommendColour(rec) {
  if (rec === 'flip-to-shadow') return C.green + rec + C.reset;
  if (rec === 'keep-live')      return C.yellow + rec + C.reset;
  return C.dim + rec + C.reset;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const jsonPath = args[0];

if (!jsonPath) {
  console.log(`
${C.bold}Crystal Ball — Cognition Shadow Rollout Report${C.reset}

No snapshot file provided.  To generate a report:

  ${C.cyan}Step 1${C.reset} — Open the app and open DevTools (F12 / ⌘⌥I).
           In the Console tab, run:
             ${C.dim}copy(localStorage.getItem('crystalball-cognition-shadow-v1'))${C.reset}
           Then paste the clipboard into a file, e.g.:
             ${C.dim}pbpaste > /tmp/shadow-snapshot.json${C.reset}

  ${C.cyan}Step 2${C.reset} — Run this script with the file path:
             ${C.dim}npm run cognition:shadow-report -- /tmp/shadow-snapshot.json${C.reset}

The app writes this snapshot automatically whenever persistVerdictSnapshot()
is called (every analyst cycle + on demand from shadow-rollout.ts).

Three shadow runs are tracked:

  ${C.cyan}recalibration-vs-legacy${C.reset}
    LIVE: PR 2 recalibration (per-domain reliability curve)
    SHADOW: legacy getBoostMultiplier-only path
    Flip gate: ≥200 pairs AND shadow Brier ≤ live Brier

  ${C.cyan}superforecast-vs-baseline${C.reset}
    LIVE: forecastHypothesis() (current ranking input)
    SHADOW: superforecast() (not yet live)
    Flip gate: ≥200 pairs AND shadow Brier ≤ live Brier

  ${C.cyan}learned-schema-vs-handauthored${C.reset}
    LIVE: hand-authored crisis signatures
    SHADOW: learned schemas (registered by consolidation.ts)
    Flip gate: 200-pair count only (matchCounts are not probabilities;
    Brier is inapplicable — always 'insufficient-data')
`);
  process.exit(0);
}

// ── Load snapshot ─────────────────────────────────────────────────────────────

let snapshot;
try {
  const raw = readFileSync(jsonPath, 'utf8');
  snapshot = JSON.parse(raw);
} catch (error) {
  console.error(`${C.red}Error reading snapshot: ${error.message}${C.reset}`);
  process.exit(1);
}

if (!snapshot || !Array.isArray(snapshot.verdicts)) {
  console.error(`${C.red}Invalid snapshot format — expected { verdicts: [...], snapshottedAt: number }${C.reset}`);
  process.exit(1);
}

// ── Print report ──────────────────────────────────────────────────────────────

const snapDate = new Date(snapshot.snapshottedAt).toISOString();
console.log(`\n${C.bold}Crystal Ball — Cognition Shadow Rollout Report${C.reset}`);
console.log(`${C.dim}Snapshot: ${snapDate}${C.reset}`);
console.log(`${C.dim}Source:   ${jsonPath}${C.reset}\n`);

for (const v of snapshot.verdicts) {
  console.log(`${'─'.repeat(60)}`);
  console.log(`${C.bold}Run: ${v.runId}${C.reset}`);
  console.log(`  Pairs collected : ${v.pairs}`);
  console.log(`  Divergence rate : ${pct(v.divergenceRate)}`);
  console.log(`  Brier live      : ${brier(v.brierLive)}`);
  console.log(`  Brier shadow    : ${brier(v.brierShadow)}`);
  console.log(`  Brier delta     : ${brierDelta(v.brierLive, v.brierShadow)}`);
  console.log(`  Recommendation  : ${recommendColour(v.recommendation)}`);
  console.log();
}

console.log(`${'─'.repeat(60)}`);
console.log();

// ── Summary ───────────────────────────────────────────────────────────────────

const ready = snapshot.verdicts.filter(v => v.recommendation === 'flip-to-shadow');
const keepLive = snapshot.verdicts.filter(v => v.recommendation === 'keep-live');
const insufficient = snapshot.verdicts.filter(v => v.recommendation === 'insufficient-data');

console.log(`${C.bold}Summary${C.reset}`);
if (ready.length > 0) {
  console.log(`  ${C.green}Ready to flip → shadow${C.reset}: ${ready.map(v => v.runId).join(', ')}`);
}
if (keepLive.length > 0) {
  console.log(`  ${C.yellow}Keep live${C.reset}:              ${keepLive.map(v => v.runId).join(', ')}`);
}
if (insufficient.length > 0) {
  console.log(`  ${C.dim}Insufficient data${C.reset}:     ${insufficient.map(v => v.runId).join(', ')}`);
}
console.log();

if (ready.length > 0) {
  console.log(`${C.green}${C.bold}Action: open a PR to promote the shadow path to live for:${C.reset}`);
  for (const v of ready) {
    console.log(`  - ${v.runId}  (shadow Brier ${v.brierShadow?.toFixed(4)} ≤ live ${v.brierLive?.toFixed(4)})`);
  }
  console.log();
} else {
  console.log(`${C.dim}No runs are ready to flip yet.${C.reset}\n`);
}

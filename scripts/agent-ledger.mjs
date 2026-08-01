#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path -- dev-tooling CLI: git on PATH is intentional */
// Spend/outcome ledger for the autonomous pipeline.
//
// Every dispatch, review cycle, escalation, and verdict appends one JSONL
// event to .agentic/ledger.jsonl (gitignored — local analytics, not repo
// history). `report` answers the question the pipeline otherwise can't:
// is autonomy paying for itself, or are branches burning cycles?
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const LEDGER = path.join(root, '.agentic/ledger.jsonl');

export function append(event) {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}

export function aggregate(lines) {
  const byKey = {};
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const key = e.branch ?? (e.issue ? `issue #${e.issue}` : '(unknown)');
    const row = byKey[key] ??= { dispatches: 0, cycles: 0, blocking: 0, escalations: 0, verdicts: 0, last: '' };
    if (e.type === 'dispatch') row.dispatches += 1;
    if (e.type === 'review-cycle') {
      row.cycles += 1;
      row.blocking += e.blocking ?? 0;
    }
    if (e.type === 'escalation') row.escalations += 1;
    if (e.type === 'verdict') row.verdicts += 1;
    row.last = e.ts ?? row.last;
  }
  return byKey;
}

function main() {
  if (process.argv[2] !== 'report') {
    console.error('Usage: agent-ledger.mjs report');
    process.exit(2);
  }
  let lines = [];
  try {
    lines = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
  } catch { /* empty ledger */ }
  const rows = aggregate(lines);
  if (Object.keys(rows).length === 0) {
    console.log('[ledger] no events recorded yet.');
    return;
  }
  console.log('branch/issue                              cycles  blocking  escal  verdicts  last');
  for (const [key, r] of Object.entries(rows)) {
    console.log(`${key.padEnd(42)}${String(r.cycles).padStart(5)}${String(r.blocking).padStart(9)}${String(r.escalations).padStart(7)}${String(r.verdicts).padStart(9)}  ${r.last}`);
  }
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('agent-ledger.mjs');
if (isDirectRun) main();

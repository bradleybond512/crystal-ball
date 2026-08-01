#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path -- dev-tooling CLI: git/gh/codex/claude on PATH is intentional */
// The cross-agent review/repair loop as a program, not a practice.
//
// One invocation = one review cycle against the current branch tip:
//   findings > 0  -> print them, bump the cycle counter, exit 1 (repair, rerun)
//   cycle 3+      -> STOP: escalate with a needs-human label + PR comment,
//                    exit 2. A third automatic cycle, a quiet severity
//                    downgrade, and "pre-existing" are the same failure.
//   approve       -> record the SHA-pinned verdict commit and exit 0.
//
// State lives in .agentic/loop-state.json (gitignored — cycle counts are
// session bookkeeping, not repo history). The reviewer runs from an
// instruction-free temp dir with the diff on stdin, and the verdict must be
// the FINAL line of strict JSON (parseVerdictLine).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { append as ledger } from './agent-ledger.mjs';
import { parseVerdictLine } from './ci-codex-review.mjs';
import { requiredReviewers } from './verify-review-verdict.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const STATE_FILE = path.join(root, '.agentic/loop-state.json');
const MAX_CYCLES = 2;

// Cycles accumulate per branch until a clean review records a verdict, which
// resets them: a later, unrelated change on the same branch starts fresh
// instead of inheriting exhausted cycles and escalating on its first review.
export function nextAction(state, branch, tip, blockingCount) {
  const entry = state[branch] ?? { cycles: 0 };
  if (blockingCount === 0) return { action: 'record', cycles: 0 };
  const cycles = (entry.cycles ?? 0) + 1;
  if (cycles > MAX_CYCLES) return { action: 'escalate', cycles };
  return { action: 'repair', cycles };
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function reviewPrompt(branch, diffPath) {
  return [
    `You are the independent cross-agent reviewer for Crystal Ball branch ${branch}.`,
    // The working directory is a bare temp dir ON PURPOSE: run in the repo and
    // codex rebases the worktree and reports the resulting conflict markers as
    // committed P0s. But an EMPTY dir made it burn its whole budget probing for
    // a source tree ("fatal: not a git repository") and exit 0 with no verdict.
    // So: hand it the diff as a real file and say plainly there is nothing else.
    `Your working directory contains exactly one file: ${diffPath}. Read it.`,
    'There is no git repository and no source tree here, by design — do not look',
    'for one, and do not treat its absence as a reason to withhold the verdict.',
    'Judge the diff on its own text; say so in a finding if context is missing.',
    `The same unified diff against main is also on stdin. Review it for real defects:`,
    'correctness, security boundaries, fail-open provider votes, denylist',
    'filtering of untrusted fields, truthiness-tested coordinates, regressions,',
    'missing or weakened tests, and CI/release hazards. Ignore style covered by',
    'automation. Audit evidence claims — a test never seen red is not coverage.',
    '',
    'Your FINAL output line must be exactly one JSON object, no code fence:',
    '{"blockingFindings": <int>, "findings": [{"severity": "...", "file": "...",',
    '"line": <int>, "summary": "...", "blocking": <bool>}]}',
  ].join('\n');
}

function runReviewer(reviewer, branch, diff) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agentic-review-'));
  const diffPath = path.join(cwd, 'review.diff');
  writeFileSync(diffPath, diff);
  // codex exec consumes stdin as ADDITIONAL input alongside a positional
  // prompt — it prints "Reading additional input from stdin..." and echoes
  // the diff between <stdin> markers in its transcript (observed on every
  // run of this loop). The diff on stdin does reach the reviewer.
  const argv = reviewer === 'codex'
    ? ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', reviewPrompt(branch, diffPath)]
    : ['-p', reviewPrompt(branch, diffPath)];
  const r = spawnSync(reviewer, argv, { cwd, input: diff, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // The verdict is parsed from STDOUT ONLY: codex prints progress ("tokens
  // used") on stderr AFTER the verdict, and concatenating streams made that
  // noise the final line — observed live on this script's first run.
  return { status: r.status, stdout: r.stdout ?? '', output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

function escalate(branch, summary, cycles) {
  console.error(`[review-loop] cycle ${cycles} exceeds the ${MAX_CYCLES}-cycle cap — escalating to the human.`);
  const body = `Automated review loop stopped after ${cycles} cycles with blocking findings still open:\n\n${summary}\n\nPer AGENTS.md, a third automatic cycle is prohibited — human decision required.`;
  // The escalation must survive having nowhere to post it. The documented flow
  // reviews BEFORE push and pr-closeout, so at the cap there is usually no PR
  // yet — swallowing the gh failure made the loop escalate into silence.
  // Write the record to disk first; the PR annotation is best-effort on top.
  const file = path.join(root, '.agentic/escalations', `${branch.replaceAll('/', '__')}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${body}\n`);
  console.error(`[review-loop] escalation recorded at ${path.relative(root, file)}`);
  const prExists = spawnSync('gh', ['pr', 'view', branch, '--json', 'number'], { cwd: root, encoding: 'utf8' }).status === 0;
  if (prExists) {
    spawnSync('gh', ['label', 'create', 'needs-human', '--color', 'B60205', '--description', 'Agent loop escalation'], { cwd: root });
    const commented = spawnSync('gh', ['pr', 'comment', branch, '--body', body], { cwd: root, stdio: 'inherit' });
    const labeled = spawnSync('gh', ['pr', 'edit', branch, '--add-label', 'needs-human'], { cwd: root, stdio: 'inherit' });
    if (commented.status !== 0 || labeled.status !== 0) {
      console.error('[review-loop] PR annotation FAILED — the needs-human alert will not fire. Deliver it manually.');
    }
  } else {
    console.error(`[review-loop] no PR exists for ${branch} yet, so no needs-human label can fire.`);
    console.error('[review-loop] ACTION REQUIRED: open the PR and apply needs-human, or resolve the findings above.');
  }
  process.exit(2);
}

function main() {
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const tip = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const reviewers = requiredReviewers(branch);
  if (reviewers === null) {
    console.error(`[review-loop] ${branch} is not an agent branch.`);
    process.exit(2);
  }
  const reviewer = reviewers[0];
  // Resolve the canonical remote (macos on Bradley's Mac, origin elsewhere)
  // and FETCH it first: a stale remote-tracking ref makes the reviewer audit
  // the wrong range — observed live when a stale macos/main pulled merged
  // tier-1 files back into the review diff.
  const remotes = execFileSync('git', ['remote', '-v'], { cwd: root, encoding: 'utf8' });
  const canon = remotes.split('\n').find((l) => l.includes('bradleybond512/crystal-ball') && l.endsWith('(fetch)'))?.split('\t')[0] ?? 'origin';
  execFileSync('git', ['fetch', canon, 'main', '--quiet'], { cwd: root });
  const diff = execFileSync('git', ['diff', `${canon}/main...HEAD`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!diff.trim()) {
    console.error('[review-loop] empty diff vs origin/main — nothing to review.');
    process.exit(2);
  }

  // Preflight the cycle cap BEFORE spending a review: with the cap already
  // exhausted, the third invocation must escalate, not buy a third opinion.
  const preState = loadState();
  if ((preState[branch]?.cycles ?? 0) >= MAX_CYCLES) {
    escalate(branch, preState[branch]?.lastFindings ?? '(see prior cycle logs)', (preState[branch].cycles ?? 0) + 1);
    return; // unreachable — escalate exits — but keeps control flow explicit
  }

  console.log(`[review-loop] reviewing ${branch}@${tip.slice(0, 8)} with ${reviewer}...`);
  const { status, stdout, output } = runReviewer(reviewer, branch, diff);
  console.log(output);
  if (status !== 0) {
    console.error(`[review-loop] reviewer exited ${status}; not counting as a cycle.`);
    process.exit(1);
  }
  const verdict = parseVerdictLine(stdout);
  if (!verdict) {
    console.error('[review-loop] no strict final-line JSON verdict — refusing to interpret prose.');
    // Exit 0 with no verdict is the silent-no-op class this pipeline exists to
    // catch, so name what the reviewer actually ended on instead of making the
    // next operator scroll a multi-thousand-line transcript to find out.
    console.error('[review-loop] reviewer\'s last 20 stdout lines:');
    console.error(stdout.trimEnd().split('\n').slice(-20).join('\n') || '(stdout was empty)');
    process.exit(1);
  }

  const state = loadState();
  const blocking = Math.max(verdict.blockingFindings, verdict.findings.filter((f) => f.blocking).length);
  const { action, cycles } = nextAction(state, branch, tip, blocking);
  const summary = verdict.findings.filter((f) => f.blocking)
    .map((f) => `- [${f.severity}] ${f.file}:${f.line} — ${f.summary}`).join('\n');
  state[branch] = { cycles, lastTip: tip, lastRun: new Date().toISOString(), lastFindings: summary };
  saveState(state);
  ledger({ type: 'review-cycle', branch, tip: tip.slice(0, 8), blocking, action });

  if (action === 'record') {
    // The verdict pins HEAD — if anything committed while the reviewer ran,
    // recording now would approve code the reviewer never saw.
    const tipNow = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (tipNow !== tip) {
      console.error(`[review-loop] tip moved during review (${tip.slice(0, 8)} -> ${tipNow.slice(0, 8)}) — rerun against the new tip.`);
      process.exit(1);
    }
    const evidenceFile = path.join(tmpdir(), `evidence-${tip.slice(0, 8)}.txt`);
    writeFileSync(evidenceFile, output.trim().split('\n').slice(-20).join('\n'));
    execFileSync('node', [path.join(root, 'scripts/verify-review-verdict.mjs'), '--record', '--reviewer', reviewer, '--evidence-file', evidenceFile], { cwd: root, stdio: 'inherit' });
    ledger({ type: 'verdict', branch, tip: tip.slice(0, 8), reviewer });
    console.log('[review-loop] verdict recorded — push, then run scripts/pr-closeout.sh.');
    return;
  }
  if (action === 'escalate') {
    ledger({ type: 'escalation', branch, tip: tip.slice(0, 8) });
    escalate(branch, summary, cycles);
  }
  console.error(`[review-loop] cycle ${cycles}/${MAX_CYCLES}: ${blocking} blocking finding(s) — repair and rerun.`);
  process.exit(1);
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('agentic-review-loop.mjs');
if (isDirectRun) main();

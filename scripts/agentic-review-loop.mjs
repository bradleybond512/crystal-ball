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

import { parseVerdictLine } from './ci-codex-review.mjs';
import { requiredReviewers } from './verify-review-verdict.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const STATE_FILE = path.join(root, '.agentic/loop-state.json');
const MAX_CYCLES = 2;

export function nextAction(state, branch, tip, blockingCount) {
  const key = `${branch}`;
  const entry = state[key]?.tipFamily === tip.slice(0, 8) || state[key] ? state[key] : { cycles: 0 };
  if (blockingCount === 0) return { action: 'record', cycles: entry.cycles ?? 0 };
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

function reviewPrompt(branch) {
  return [
    `You are the independent cross-agent reviewer for Crystal Ball branch ${branch}.`,
    'The unified diff against main arrives on stdin. Review it for real defects:',
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
  const argv = reviewer === 'codex'
    ? ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', reviewPrompt(branch)]
    : ['-p', reviewPrompt(branch)];
  const r = spawnSync(reviewer, argv, { cwd, input: diff, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
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
  const diff = execFileSync('git', ['diff', 'origin/main...HEAD'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!diff.trim()) {
    console.error('[review-loop] empty diff vs origin/main — nothing to review.');
    process.exit(2);
  }

  console.log(`[review-loop] reviewing ${branch}@${tip.slice(0, 8)} with ${reviewer}...`);
  const { status, output } = runReviewer(reviewer, branch, diff);
  console.log(output);
  if (status !== 0) {
    console.error(`[review-loop] reviewer exited ${status}; not counting as a cycle.`);
    process.exit(1);
  }
  const verdict = parseVerdictLine(output);
  if (!verdict) {
    console.error('[review-loop] no strict final-line JSON verdict — refusing to interpret prose.');
    process.exit(1);
  }

  const state = loadState();
  const blocking = Math.max(verdict.blockingFindings, verdict.findings.filter((f) => f.blocking).length);
  const { action, cycles } = nextAction(state, branch, tip, blocking);
  state[branch] = { cycles, lastTip: tip, lastRun: new Date().toISOString() };
  saveState(state);

  if (action === 'record') {
    const evidenceFile = path.join(tmpdir(), `evidence-${tip.slice(0, 8)}.txt`);
    writeFileSync(evidenceFile, output.trim().split('\n').slice(-20).join('\n'));
    execFileSync('node', [path.join(root, 'scripts/verify-review-verdict.mjs'), '--record', '--reviewer', reviewer, '--evidence-file', evidenceFile], { cwd: root, stdio: 'inherit' });
    console.log('[review-loop] verdict recorded — push, then run scripts/pr-closeout.sh.');
    return;
  }
  if (action === 'escalate') {
    console.error(`[review-loop] cycle ${cycles} exceeds the ${MAX_CYCLES}-cycle cap — escalating to the human.`);
    const summary = verdict.findings.filter((f) => f.blocking)
      .map((f) => `- [${f.severity}] ${f.file}:${f.line} — ${f.summary}`).join('\n');
    const body = `Automated review loop stopped after ${cycles} cycles with blocking findings still open:\n\n${summary}\n\nPer AGENTS.md, a third automatic cycle is prohibited — human decision required.`;
    try {
      spawnSync('gh', ['label', 'create', 'needs-human', '--color', 'B60205', '--description', 'Agent loop escalation'], { cwd: root });
      execFileSync('gh', ['pr', 'comment', branch, '--body', body], { cwd: root, stdio: 'inherit' });
      execFileSync('gh', ['pr', 'edit', branch, '--add-label', 'needs-human'], { cwd: root, stdio: 'inherit' });
    } catch {
      console.error('[review-loop] could not annotate the PR — deliver the escalation manually.');
    }
    process.exit(2);
  }
  console.error(`[review-loop] cycle ${cycles}/${MAX_CYCLES}: ${blocking} blocking finding(s) — repair and rerun.`);
  process.exit(1);
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('agentic-review-loop.mjs');
if (isDirectRun) main();

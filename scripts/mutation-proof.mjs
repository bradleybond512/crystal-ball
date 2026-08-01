#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path -- dev-tooling CLI: git/npm on PATH is intentional */
// Machine-checked mutation proofs.
//
// The AGENTS.md mutation-proof procedure was discipline, not verification —
// an agent could claim the red without inducing it (a perl substitution once
// matched zero bytes and the suite "stayed green at 124 pass / 0 fail").
// This runner executes the procedure mechanically and emits an artifact the
// reviewer can check instead of trusting a transcript:
//
//   1. tracked tree clean; record shasums of the files the fix touched
//   2. GREEN baseline: run the named suites, record pass/fail counts
//   3. revert ONLY the fix (git apply -R of the commit's own diff) and
//      CONFIRM the mutation applied — a no-op revert is the false green
//   4. RED run: at least one suite must fail
//   5. restore, verify identical shasums, write .agentic/proofs/<sha>.json
//
// Usage:
//   node scripts/mutation-proof.mjs --commit <sha> --tests "test:a test:b"
//   (--commit defaults to HEAD; proves THAT commit's change is load-bearing)
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

export function parseCounts(output) {
  // Node's test runner (tsx --test / node --test) reports these lines.
  const pass = [...output.matchAll(/ℹ pass (\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  const fail = [...output.matchAll(/ℹ fail (\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  const seen = /ℹ (pass|fail) \d+/.test(output);
  return { pass, fail, seen };
}

function runSuites(tests, { phase }) {
  const results = {};
  for (const script of tests) {
    const r = spawnSync('npm', ['run', script], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const counts = parseCounts(`${r.stdout ?? ''}${r.stderr ?? ''}`);
    if (!counts.seen) {
      // In GREEN, a runnerless output means the setup is broken — abort.
      // In RED, the mutation crashing the suite outright IS a failure signal:
      // count it as red instead of aborting mid-mutation.
      if (phase === 'green') {
        throw new Error(`${script} produced no "ℹ pass/fail" lines — not a node test runner, or it crashed before running. Exit ${r.status}.`);
      }
      results[script] = { pass: 0, fail: 1, crashed: true, exit: r.status };
      continue;
    }
    results[script] = { ...counts, exit: r.status };
  }
  return results;
}

function shasums(files) {
  return Object.fromEntries(files.map((f) => [
    f,
    createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex'),
  ]));
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const commit = git(['rev-parse', get('--commit') ?? 'HEAD']).trim();
  const tests = (get('--tests') ?? '').split(/\s+/).filter(Boolean);
  if (tests.length === 0) {
    console.error('Usage: mutation-proof.mjs [--commit <sha>] --tests "test:a test:b"');
    process.exit(2);
  }
  if (git(['status', '--porcelain', '--untracked-files=no']).trim()) {
    throw new Error('tracked tree not clean — a proof must start from an exact committed state.');
  }

  // Revert ONLY the implementation: a commit that ships fix + tests together
  // must keep its tests in place while the fix is removed, or the proof is
  // vacuous (the reverted tests would no longer demand the behavior).
  const allFiles = git(['diff', '--name-only', `${commit}^`, commit]).split('\n').filter(Boolean);
  const files = allFiles.filter((f) => !f.startsWith('tests/') && !f.includes('/__tests__/')
    // The runner cannot prove itself: reverting a commit that contains this
    // script deletes the tool mid-proof (observed live on its first dogfood).
    && f !== 'scripts/mutation-proof.mjs');
  if (files.length === 0) throw new Error(`${commit.slice(0, 8)} touches only test files — nothing to mutate.`);
  const patch = git(['diff', `${commit}^`, commit, '--', ...files]);
  if (!patch.trim()) throw new Error(`${commit.slice(0, 8)} has an empty non-test diff.`);
  const before = shasums(files);

  console.log(`[mutation-proof] GREEN baseline (${tests.join(', ')})...`);
  const green = runSuites(tests, { phase: 'green' });
  const greenFails = Object.values(green).reduce((a, r) => a + r.fail, 0);
  if (greenFails > 0) throw new Error(`baseline is already red (${greenFails} failing) — fix that first.`);

  console.log(`[mutation-proof] reverting ${commit.slice(0, 8)} in the working tree...`);
  // Plain apply — NEVER --3way, which stages into the index and makes
  // `git checkout --` restore the mutation instead of the fix (observed on
  // the first dogfood: the "restored" tree was still mutated and staged).
  const rev = spawnSync('git', ['apply', '-R'], { cwd: root, input: patch, encoding: 'utf8' });
  if (rev.status !== 0) throw new Error(`revert did not apply: ${rev.stderr}`);
  // THE load-bearing step: a revert that changed nothing reads exactly like a
  // passing test. The mutation must be visible in the tree.
  if (!git(['diff', '--name-only']).trim()) throw new Error('mutation applied but the tree is unchanged — refusing a vacuous proof.');

  // From here the tree is mutated: whatever happens, restore before exiting —
  // an abort that leaves the fix reverted is worse than no proof at all.
  let red;
  try {
    console.log('[mutation-proof] RED run...');
    red = runSuites(tests, { phase: 'red' });
  } finally {
    console.log('[mutation-proof] restoring...');
    git(['checkout', 'HEAD', '--', ...files]);
  }
  const redFails = Object.values(red).reduce((a, r) => a + r.fail, 0);
  const after = shasums(files);
  for (const f of files) {
    if (before[f] !== after[f]) throw new Error(`restore mismatch on ${f} — DO NOT TRUST THIS TREE; re-checkout.`);
  }

  if (redFails === 0) {
    console.error('[mutation-proof] FAILED: the suite stayed green without the fix — the tests do not guard this change.');
    process.exit(1);
  }

  const artifact = {
    commit,
    files,
    tests,
    green: Object.fromEntries(Object.entries(green).map(([k, v]) => [k, `${v.pass} pass / ${v.fail} fail`])),
    red: Object.fromEntries(Object.entries(red).map(([k, v]) => [k, `${v.pass} pass / ${v.fail} fail`])),
    restoredChecksumsVerified: true,
    provedAt: new Date().toISOString(),
  };
  const out = path.join(root, '.agentic/proofs', `${commit.slice(0, 12)}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`[mutation-proof] PROVEN: ${redFails} failure(s) without the fix, 0 with it. Artifact: ${path.relative(root, out)}`);
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('mutation-proof.mjs');
if (isDirectRun) main();

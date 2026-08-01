#!/usr/bin/env node
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-os-command-from-path -- dev-tooling CLI: git/npm on PATH is intentional */
// Changed-path-scoped test selection for the merge gate.
//
// Branch protection's required checks run no unit tests at all — a PR that
// breaks every suite merges green. Running the full ~11k-test sweep per PR is
// not viable, so this selects the targeted `test:*` scripts whose files (or
// covered source directories) intersect the PR's changed paths.
//
// The mapping is DERIVED from package.json: each eligible script lists its
// test files explicitly, and a test file at src/<area>/__tests__/x.test.mts
// covers src/<area>/. Hand-maintained mappings drift; derived ones cannot.
// Only plain node/tsx --test runners are eligible (allowlist, never a
// denylist): playwright, composite npm-run chains, and bespoke harnesses are
// never auto-selected.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_SCRIPTS = 12;

// Cross-file guards the derived map cannot see: tests that assert against the
// TEXT of another file, and scripts exercised by a suite that does not live
// beside them.
export const OVERRIDES = {
  'src/app/data-loader.ts': ['test:providers'],
  'scripts/agentic-validate.sh': ['test:agentic-gate'],
  'scripts/check-docs-freshness.mjs': ['test:agentic-gate'],
  'scripts/verify-review-verdict.mjs': ['test:agentic-pipeline'],
  'scripts/targeted-tests.mjs': ['test:agentic-pipeline'],
  'scripts/ci-codex-review.mjs': ['test:agentic-pipeline'],
};

const RUNNER_ALLOWLIST = [
  /^tsx --test /,
  /^node --test /,
  /^tsx --import \.\/tests\/panels\/register-hook\.mjs --test /,
];

function isPathToken(token) {
  return token.includes('/') && /\.(mjs|mts|ts|js)$/.test(token) && !token.startsWith('--');
}

export function deriveScriptIndex(scripts) {
  const index = new Map(); // script -> { testFiles: Set, coveredDirs: Set }
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith('test:')) continue;
    if (!RUNNER_ALLOWLIST.some((re) => re.test(command))) continue;
    const testFiles = new Set(command.split(/\s+/).filter((token) => isPathToken(token)));
    if (testFiles.size === 0) continue;
    const coveredDirs = new Set();
    for (const f of testFiles) {
      const m = f.match(/^(src\/.+?|src-tauri\/sidecar)\/__tests__\//);
      if (m) coveredDirs.add(`${m[1]}/`);
    }
    index.set(name, { testFiles, coveredDirs });
  }
  return index;
}

export function selectScripts(changedFiles, index, overrides = OVERRIDES) {
  const selected = new Set();
  const unmapped = [];
  for (const file of changedFiles) {
    let mapped = false;
    for (const script of overrides[file] ?? []) {
      if (index.has(script)) {
        selected.add(script);
        mapped = true;
      }
    }
    for (const [script, { testFiles, coveredDirs }] of index) {
      if (testFiles.has(file)) {
        selected.add(script);
        mapped = true;
        continue;
      }
      for (const dir of coveredDirs) {
        if (file.startsWith(dir)) {
          selected.add(script);
          mapped = true;
        }
      }
    }
    // Only source-shaped paths count as coverage gaps; docs, workflows, and
    // assets legitimately map to nothing.
    if (!mapped && /^(src|src-tauri\/sidecar|scripts|tests)\//.test(file) && /\.(ts|mts|tsx|mjs|js|rs|sh)$/.test(file)) {
      unmapped.push(file);
    }
  }
  const ordered = [...selected].sort();
  const dropped = ordered.slice(MAX_SCRIPTS);
  return { scripts: ordered.slice(0, MAX_SCRIPTS), dropped, unmapped };
}

function changedFilesFromGit() {
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
  const mergeBase = execFileSync('git', ['merge-base', baseRef, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return execFileSync('git', ['diff', '--name-only', `${mergeBase}...HEAD`], { cwd: root, encoding: 'utf8' })
    .split('\n').map((l) => l.trim()).filter(Boolean);
}

function summarize(lines) {
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n\n')}\n`);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
  const index = deriveScriptIndex(scripts);
  const changed = changedFilesFromGit();
  const { scripts: selected, dropped, unmapped } = selectScripts(changed, index);

  summarize([
    `[targeted-tests] ${changed.length} changed file(s) → ${selected.length} test script(s): ${selected.join(', ') || '(none)'}`,
    ...(dropped.length > 0 ? [`[targeted-tests] CAPPED at ${MAX_SCRIPTS}; dropped: ${dropped.join(', ')} — run these locally.`] : []),
    ...(unmapped.length > 0 ? [
      [
        `[targeted-tests] WARNING — ${unmapped.length} changed source file(s) map to no targeted suite; this gate proves nothing about them:`,
        ...unmapped.map((f) => `  - ${f}`),
      ].join('\n'),
    ] : []),
  ]);

  if (unmapped.length > 0 && args.has('--strict')) {
    console.error('[targeted-tests] --strict: unmapped source changes are a failure.');
    process.exit(1);
  }
  if (args.has('--list')) return;

  const failures = [];
  for (const script of selected) {
    console.log(`\n==> npm run ${script}`);
    const r = spawnSync('npm', ['run', script], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) failures.push(`${script} (exit ${r.status})`);
  }
  if (failures.length > 0) {
    summarize([`[targeted-tests] FAILED: ${failures.join(', ')}`]);
    process.exit(1);
  }
  console.log(`\n[targeted-tests] ${selected.length} script(s) passed.`);
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectRun) main();

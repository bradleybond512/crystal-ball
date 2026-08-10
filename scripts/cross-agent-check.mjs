#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

function run(command, commandArgs, options = {}) {
  try {
    return execFileSync(command, commandArgs, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).trim();
  } catch {
    return '';
  }
}

function hasCommand(command) {
  return Boolean(run('sh', ['-c', `command -v ${command}`]));
}

function currentBranch() {
  return process.env.GITHUB_HEAD_REF || run('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || '';
}

function baseRef() {
  const candidates = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : '',
    'origin/main',
    'macos/main',
    'main',
    'HEAD~1',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (run('git', ['rev-parse', '--verify', candidate])) return candidate;
  }
  return 'HEAD~1';
}

function changedFiles() {
  const base = baseRef();
  const mergeBase = run('git', ['merge-base', base, 'HEAD']) || base;
  const outputs = [
    run('git', ['diff', '--name-only', `${mergeBase}...HEAD`]),
    run('git', ['diff', '--name-only', '--cached']),
    run('git', ['diff', '--name-only']),
    run('git', ['ls-files', '--others', '--exclude-standard']),
  ];
  return [...new Set(outputs
    .join('\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean))].sort();
}

function changedAreas(files) {
  const rules = [
    ['sidecar/api', (file) => file.startsWith('src-tauri/sidecar/') || file.startsWith('api/')],
    ['tauri', (file) => file.startsWith('src-tauri/src/')],
    ['ui', (file) => file.startsWith('src/components/')],
    ['services', (file) => file.startsWith('src/services/')],
    ['config', (file) => file.startsWith('src/config/')],
    ['ci', (file) => file.startsWith('.github/')],
    ['tooling', (file) => file.startsWith('scripts/')],
    ['tests', (file) => file.startsWith('tests/') || file.startsWith('e2e/') || file.includes('.test.')],
    ['docs', (file) => file.endsWith('.md')],
  ];
  const areas = new Set();
  for (const file of files) {
    for (const [area, matches] of rules) {
      if (matches(file)) areas.add(area);
    }
  }
  return [...areas].sort();
}

function expectedReviewer(branch) {
  if (branch.startsWith('claude/')) return 'Codex';
  if (branch.startsWith('codex/')) return 'Claude';
  if (branch.startsWith('copilot/')) return 'Codex or Claude';
  return 'another agent';
}

// expectedReviewer() is prose for humans; --reviewer wants a single slug.
function reviewerSlug(reviewer) {
  const match = reviewer.match(/codex|claude/i);
  return match ? match[0].toLowerCase() : '<codex|claude>';
}

function requiredFilesPresent() {
  return [
    '.github/workflows/cross-agent-review.yml',
    'scripts/cross-agent-check.mjs',
    'scripts/verify-review-verdict.mjs',
  ].filter((file) => !existsSync(path.resolve(root, file)));
}

function printLocalReport({ branch, files, areas, reviewer }) {
  console.log('Crystal Ball cross-agent check');
  console.log(`Branch: ${branch || '(unknown)'}`);
  console.log(`Changed files: ${files.length}`);
  console.log(`Changed areas: ${areas.length ? areas.join(', ') : 'none detected'}`);
  console.log(`Required reviewer: ${reviewer}`);
  console.log('');

  console.log('Available local review tools:');
  console.log(`- Claude CLI: ${hasCommand('claude') ? 'available' : 'missing'}`);
  console.log(`- Codex CLI: ${hasCommand('codex') ? 'available' : 'missing'}`);
  console.log(`- GitHub CLI: ${hasCommand('gh') ? 'available' : 'missing'}`);
  console.log(`- Qodo CLI: ${hasCommand('qodo') ? 'available' : 'missing (optional)'}`);
  console.log(`- CodeRabbit CLI: ${hasCommand('coderabbit') ? 'available' : 'missing (optional)'}`);
  console.log('');

  console.log('Second-agent review prompt:');
  console.log('```');
  console.log(`Review the current Crystal Ball branch ${branch || '(current branch)'} as an independent reviewer.`);
  console.log(`Focus on changed files since ${baseRef()}. Prioritize bugs, regressions, security risks, missing tests, and CI/release hazards.`);
  console.log(`Changed areas: ${areas.length ? areas.join(', ') : 'none detected'}.`);
  if (areas.includes('sidecar/api')) {
    console.log('Also apply the sidecar-reviewer checklist for CORS proxy routes, timeouts, JSON errors, API keys, and sidecar tests.');
  }
  console.log('Return findings first with file/line references, then test gaps and residual risk.');
  console.log('```');
  console.log('');

  console.log('After the second review, record the verdict as a SHA-pinned commit (a PR-body');
  console.log('marker no longer satisfies the gate — see .github/workflows/cross-agent-review.yml):');
  console.log('```');
  console.log(`node scripts/verify-review-verdict.mjs --record --reviewer ${reviewerSlug(reviewer)} --evidence-file <review-output>`);
  console.log('git commit -m "agentic: record review verdict" -- .agentic/reviews');
  console.log('```');
  console.log('The verdict pins the reviewed SHA, so record it LAST — any later code commit');
  console.log('invalidates it and the gate turns red until a fresh review is recorded.');
}

function collectFailures() {
  const failures = [];
  const missing = requiredFilesPresent();
  if (missing.length > 0) {
    failures.push(`Missing cross-agent workflow file(s): ${missing.join(', ')}`);
  }
  return failures;
}

function reportFailures(failures, { ci }) {
  if (ci && !args.has('--verbose')) {
    for (const failure of failures) console.error(`[cross-check] ${failure}`);
    return;
  }
  console.log('');
  console.log('Failures:');
  for (const failure of failures) console.log(`- ${failure}`);
}

function main() {
  const branch = currentBranch();
  const files = changedFiles();
  const areas = changedAreas(files);
  const reviewer = expectedReviewer(branch);
  const ci = args.has('--ci') || Boolean(process.env.CI);
  const failures = collectFailures();

  if (!ci || args.has('--verbose')) {
    printLocalReport({ branch, files, areas, reviewer });
    if (failures.length > 0) reportFailures(failures, { ci });
  }

  if (failures.length > 0) {
    if (ci && !args.has('--verbose')) reportFailures(failures, { ci });
    process.exit(1);
  }

  // The review verdict itself is enforced by verify-review-verdict.mjs / ci-codex-review.mjs
  // from origin/main; this script only advises and asserts the gate files exist.
  if (ci) console.log('[cross-check] Cross-agent gate files present.');
}

main();

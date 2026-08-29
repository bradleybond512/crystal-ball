#!/usr/bin/env node
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-os-command-from-path -- dev-tooling CLI: git/npm on PATH is intentional */
// Changed-path-scoped test selection for the merge gate.
//
// Branch protection's required checks run no unit tests at all — a PR that
// breaks every suite merges green. Running the full ~11k-test sweep per PR is
// not viable, so this selects the targeted `test:*` scripts whose files (or
// covered source directories) intersect the PR's changed paths and runs ALL
// of them — no cap: a silently dropped suite is a suite that cannot block a
// merge, which defeats the gate.
//
// The mapping is DERIVED from package.json: each eligible script lists its
// test files explicitly, and a test file at src/<area>/__tests__/x.test.mts
// covers src/<area>/. Hand-maintained mappings drift; derived ones cannot.
// Only plain node/tsx --test runners are eligible (allowlist, never a
// denylist): playwright, composite npm-run chains, and bespoke harnesses are
// never auto-selected.
//
// CI runs the copy of this script from origin/main (a PR must not control its
// own gate), so paths resolve from the working directory, not this file.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

// The derived index currently holds ~106 scripts. If a package.json change
// collapses it below this floor, the gate is being starved (runner formats
// rewritten, scripts deleted) — refuse to certify instead of passing vacuously.
const INDEX_FLOOR = 40;

// Cross-file guards the derived map cannot see: tests that assert against the
// TEXT of another file, and scripts exercised by a suite that does not live
// beside them.
export const OVERRIDES = {
  'api/_bounded-json.js': ['test:lifelines'],
  'api/grid-outages.js': ['test:lifelines-grid'],
  'api/osrm-route.js': ['test:lifelines-map'],
  'api/ucdp-classifications.js': ['test:ucdp-provider'],
  'api/usgs-water-proxy.js': ['test:lifelines'],
  'src/app/data-loader.ts': ['test:providers'],
  'src/config/panel-metadata.ts': ['test:emergency-readiness'],
  'src/config/panels.ts': ['test:emergency-readiness'],
  'scripts/agentic-validate.sh': ['test:agentic-gate'],
  'scripts/roadmap-controller.mjs': ['test:roadmap-controller'],
  'scripts/check-docs-freshness.mjs': ['test:agentic-gate'],
  'scripts/setup-main-sync-agent.mjs': ['test:data'],
  'scripts/verify-review-verdict.mjs': ['test:agentic-pipeline'],
  'scripts/cross-agent-check.mjs': ['test:agentic-pipeline'],
  'scripts/targeted-tests.mjs': ['test:agentic-pipeline'],
  'scripts/ci-codex-review.mjs': ['test:agentic-pipeline'],
  'scripts/lint-baseline.mjs': ['test:eslint-runner'],
  'scripts/lint-changed.mjs': ['test:eslint-runner'],
  'scripts/little-snitch-log-traffic-helper.sh': ['test:little-snitch'],
  'scripts/run-eslint.mjs': ['test:eslint-runner'],
  'scripts/bundle-budget-policy.mjs': ['test:bundle-budget-policy'],
  'tests/main-sync-agent.test.mjs': ['test:data'],
  'docs/USABILITY_UPLIFT_FOR_CODEX.md': ['test:roadmap-controller'],
  'docs/PREDICTION_ACCURACY_ROADMAP.md': ['test:roadmap-controller'],
  'tools/mcp-server/local-lock.mjs': ['test:mcp-evaluation-report'],
  'tools/mcp-server/tools/evaluation-report.mjs': ['test:mcp-evaluation-report'],
  'tools/mcp-server/weekly-evaluation-report.mjs': ['test:mcp-evaluation-report'],
};

const RUNNER_ALLOWLIST = [
  /^tsx --test /,
  /^node --test /,
  /^tsx --import \.\/tests\/panels\/register-hook\.mjs --test /,
];

// Anything source-shaped that maps to no suite is a visible coverage gap.
const SOURCE_SHAPED = /^(src|src-tauri\/(sidecar|src)|scripts|tests|api|tools)\//;
const SOURCE_EXT = /\.(ts|mts|tsx|mjs|js|rs|sh)$/;

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
    if (!mapped && SOURCE_SHAPED.test(file) && SOURCE_EXT.test(file)) {
      unmapped.push(file);
    }
  }
  return { scripts: [...selected].sort(), unmapped };
}

export function isRunnerAllowlisted(command) {
  return typeof command === 'string' && RUNNER_ALLOWLIST.some((re) => re.test(command));
}

// Turn a trusted (origin/main) runner command into directly-spawnable stages,
// so a main-selected suite executes MAIN's definition even if the PR rewrote
// its package.json entry to another allowlisted-but-inert command. Commands
// may chain runners with `&&` (e.g. test:feed-health); each stage must itself
// be a plain tsx/node invocation or the whole command is refused.
export function commandToStages(command, binDir = 'node_modules/.bin') {
  return command.split('&&').map((stage) => {
    const tokens = stage.trim().split(/\s+/).filter(Boolean);
    const [runner, ...rest] = tokens;
    if (runner === 'node') return { bin: process.execPath, args: rest };
    if (runner === 'tsx') return { bin: path.join(binDir, 'tsx'), args: rest };
    throw new Error(`untrusted stage runner "${runner}" in: ${command}`);
  });
}

// Pure gate decision, unit-testable without git or npm.
// indexSize/selected derive from ORIGIN/MAIN's package.json — the PR's copy
// only ADDS suites, so a PR cannot fabricate a compliant index of no-op
// scripts or starve the floor. `unbaselined` lists unmapped
// source files absent from the coverage-ratchet baseline: pre-existing gaps
// are listed there and warn; NEW uncovered files fail until covered or
// explicitly baselined in a reviewable diff.
export function ciVerdict({ indexSize, selected, unmapped, unbaselined = [] }) {
  if (indexSize < INDEX_FLOOR) {
    return {
      fail: true,
      reason: `derived index collapsed to ${indexSize} script(s) (floor ${INDEX_FLOOR}) — `
        + 'package.json runner formats changed or scripts were mass-removed; refusing to certify.',
    };
  }
  if (unbaselined.length > 0) {
    return {
      fail: true,
      reason: 'changed source file(s) have no targeted suite and are not in the coverage baseline: '
        + `${unbaselined.join(', ')} — add a suite, an OVERRIDES entry, or a reviewed baseline line `
        + '(scripts/targeted-tests-baseline.txt).',
    };
  }
  if (unmapped.length > 0 && selected.length === 0) {
    return {
      fail: true,
      reason: 'source files changed but ZERO targeted suites apply — this gate would certify nothing. '
        + 'Add or map a suite for at least one changed area (see OVERRIDES in scripts/targeted-tests.mjs).',
    };
  }
  return { fail: false, reason: '' };
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

function mainPackageScripts() {
  // The DECISION index comes from origin/main's package.json so a PR cannot
  // fabricate its own gate. Before the gate first lands on main, fall back to
  // the working copy.
  try {
    const raw = execFileSync('git', ['show', 'origin/main:package.json'], { cwd: root, encoding: 'utf8' });
    return JSON.parse(raw).scripts ?? {};
  } catch {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
  }
}

function baselinePaths() {
  try {
    return new Set(
      readFileSync(path.join(root, 'scripts/targeted-tests-baseline.txt'), 'utf8')
        .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
    );
  } catch {
    return new Set();
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const prScripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
  const mainScripts = mainPackageScripts();
  const mainIndex = deriveScriptIndex(mainScripts);
  const prIndex = deriveScriptIndex(prScripts);
  const changed = changedFilesFromGit();

  const mainSel = selectScripts(changed, mainIndex);
  const prSel = selectScripts(changed, prIndex);
  // Main's mapping decides what MUST run; the PR's copy may only add suites
  // (new tests shipped alongside new code).
  const prOnly = prSel.scripts.filter((s) => !mainSel.scripts.includes(s));
  const selected = [...new Set([...mainSel.scripts, ...prOnly])].sort();
  // A file is a coverage gap only if NEITHER mapping covers it; the baseline
  // ratchet decides whether the gap is pre-existing (warn) or new (fail).
  const unmapped = mainSel.unmapped.filter((f) => prSel.unmapped.includes(f));
  const baseline = baselinePaths();
  const unbaselined = unmapped.filter((f) => !baseline.has(f));

  summarize([
    `[targeted-tests] ${changed.length} changed file(s) → ${selected.length} test script(s): ${selected.join(', ') || '(none)'}`,
    ...(unmapped.length > 0 ? [
      [
        `[targeted-tests] WARNING — ${unmapped.length} changed source file(s) map to no targeted suite; this gate proves nothing about them:`,
        ...unmapped.map((f) => `  - ${f}${baseline.has(f) ? ' (baselined)' : ' (NEW GAP)'}`),
      ].join('\n'),
    ] : []),
  ]);

  const gate = ciVerdict({ indexSize: mainIndex.size, selected, unmapped, unbaselined });
  if (gate.fail) {
    summarize([`[targeted-tests] FAIL: ${gate.reason}`]);
    process.exit(1);
  }
  if (unmapped.length > 0 && args.has('--strict')) {
    console.error('[targeted-tests] --strict: unmapped source changes are a failure.');
    process.exit(1);
  }
  if (args.has('--list')) return;

  const failures = [];
  for (const script of selected) {
    // Main-selected suites run MAIN's command verbatim — a PR rewriting the
    // script to another allowlisted-but-inert runner changes nothing here.
    // PR-only (new) suites run via the PR's npm.
    if (mainSel.scripts.includes(script)) {
      console.log(`\n==> [trusted:main] ${script}: ${mainScripts[script]}`);
      for (const { bin, args: argv } of commandToStages(mainScripts[script], path.join(root, 'node_modules/.bin'))) {
        const r = spawnSync(bin, argv, { cwd: root, stdio: 'inherit' });
        if (r.status !== 0) {
          failures.push(`${script} (exit ${r.status})`);
          break;
        }
      }
    } else {
      console.log(`\n==> npm run ${script}`);
      const r = spawnSync('npm', ['run', script], { cwd: root, stdio: 'inherit' });
      if (r.status !== 0) failures.push(`${script} (exit ${r.status})`);
    }
  }
  if (failures.length > 0) {
    summarize([`[targeted-tests] FAILED: ${failures.join(', ')}`]);
    process.exit(1);
  }
  console.log(`\n[targeted-tests] ${selected.length} script(s) passed.`);
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectRun) main();

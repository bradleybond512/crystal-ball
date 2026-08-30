import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateVerdict, requiredReviewers } from '../scripts/verify-review-verdict.mjs';
import {
  OVERRIDES,
  deriveScriptIndex,
  selectScripts,
  ciVerdict,
  isRunnerAllowlisted,
  commandToStages,
} from '../scripts/targeted-tests.mjs';
import { parseVerdictLine } from '../scripts/ci-codex-review.mjs';
import { expectedReviewer, verdictAdvice } from '../scripts/cross-agent-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// ── verify-review-verdict: pure validation ──

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function goodVerdict(overrides = {}) {
  return JSON.stringify({
    reviewedSha: SHA_A,
    reviewer: 'codex',
    verdict: 'approve',
    blockingFindings: 0,
    reviewedAt: '2026-08-01T00:00:00.000Z',
    evidence: 'Confirmed. The repair is sound and complete. No blocking findings remain after inspection.',
    ...overrides,
  });
}

function verdictEntry(status = 'A', file = `.agentic/reviews/${SHA_A}.json`) {
  return { status, file };
}

test('non-agent branches require no verdict', () => {
  assert.equal(requiredReviewers('dependabot/npm_and_yarn/foo'), null);
  const r = validateVerdict({ branch: 'dependabot/npm_and_yarn/foo', headEntries: [{ status: 'M', file: 'package.json' }], headParent: SHA_A, verdictJson: '' });
  assert.equal(r.ok, true);
});

test('a code tip on an agent branch fails with recording instructions', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headEntries: [{ status: 'M', file: 'src/app/data-loader.ts' }],
    headParent: SHA_A,
    verdictJson: '',
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /not a verdict-only commit/);
  assert.match(r.failures[0], /--record/);
});

test('a valid codex verdict commit on claude/* passes', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headEntries: [verdictEntry()],
    headParent: SHA_A,
    verdictJson: goodVerdict(),
  });
  assert.equal(r.ok, true, JSON.stringify(r.failures ?? []));
});

test('self-review is rejected: claude reviewing claude/*', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headEntries: [verdictEntry()],
    headParent: SHA_A,
    verdictJson: goodVerdict({ reviewer: 'claude' }),
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /Self-review does not count/.test(f)));
});

test('a verdict pinning the wrong sha is rejected', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headEntries: [verdictEntry()],
    headParent: SHA_A,
    verdictJson: goodVerdict({ reviewedSha: SHA_B }),
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /pins b{40}.*reviewed commit is a{40}/.test(f)));
});

test('a verdict commit smuggling a code file is rejected', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headEntries: [verdictEntry(), { status: 'M', file: 'src/services/weather/weather.ts' }],
    headParent: SHA_A,
    verdictJson: goodVerdict(),
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /Offending entries.*weather\.ts/.test(f)));
});

test('rename smuggling decomposes to a delete and is rejected', () => {
  // `git mv src/x.ts .agentic/reviews/<sha>.json` under --no-renames shows
  // D src/x.ts + A .agentic/reviews/<sha>.json — the D must fail the commit.
  const r = validateVerdict({
    branch: 'claude/feature',
    headEntries: [{ status: 'D', file: 'src/services/weather/weather.ts' }, verdictEntry()],
    headParent: SHA_A,
    verdictJson: goodVerdict(),
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /Offending entries.*D src\/services\/weather\/weather\.ts/.test(f)));
});

test('a delete inside the protocol dir is still rejected', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headEntries: [verdictEntry(), { status: 'D', file: `.agentic/reviews/${SHA_B}.json` }],
    headParent: SHA_A,
    verdictJson: goodVerdict(),
  });
  assert.equal(r.ok, false);
});

test('non-approve verdicts, nonzero blocking counts, and thin evidence are rejected', () => {
  for (const [overrides, pattern] of [
    [{ verdict: 'request_changes' }, /not "approve"/],
    [{ blockingFindings: 2 }, /blockingFindings is 2/],
    [{ evidence: 'looks good' }, /quote the reviewer's actual concluding output/],
  ]) {
    const r = validateVerdict({
      branch: 'codex/feature',
      headEntries: [verdictEntry()],
      headParent: SHA_A,
      verdictJson: goodVerdict({ reviewer: 'claude', ...overrides }),
    });
    assert.equal(r.ok, false, JSON.stringify(overrides));
    assert.ok(r.failures.some((f) => pattern.test(f)), `${pattern} not found in ${JSON.stringify(r.failures)}`);
  }
});

// ── verify-review-verdict: end-to-end against a fixture repo ──

function fixtureRepo(branch) {
  const dir = mkdtempSync(join(tmpdir(), 'verdict-fixture-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', branch);
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@invalid.test');
  writeFileSync(join(dir, 'code.txt'), 'v1\n');
  git('add', 'code.txt');
  git('commit', '-q', '-m', 'feat: code');
  return { dir, git };
}

function runVerify(dir) {
  const env = { ...process.env };
  delete env.GITHUB_HEAD_REF; // branch must come from the fixture repo
  return spawnSync(process.execPath, [join(root, 'scripts/verify-review-verdict.mjs')], { cwd: dir, encoding: 'utf8', env });
}

test('end-to-end: --record produces a tip that verifies, and a later code push breaks it', () => {
  const { dir, git } = fixtureRepo('claude/e2e');
  const evidencePath = join(dir, 'evidence.txt');
  writeFileSync(evidencePath, 'Confirmed sound and complete after full inspection of the diff. No blocking findings.');

  assert.equal(runVerify(dir).status, 1, 'code tip must fail before recording');

  const env = { ...process.env };
  delete env.GITHUB_HEAD_REF;
  const rec = spawnSync(
    process.execPath,
    [join(root, 'scripts/verify-review-verdict.mjs'), '--record', '--reviewer', 'codex', '--evidence-file', evidencePath],
    { cwd: dir, encoding: 'utf8', env },
  );
  assert.equal(rec.status, 0, rec.stderr);
  assert.equal(runVerify(dir).status, 0, 'verdict tip must verify');

  // Stacking a second verdict on a verdict tip must refuse.
  const rec2 = spawnSync(
    process.execPath,
    [join(root, 'scripts/verify-review-verdict.mjs'), '--record', '--reviewer', 'codex', '--evidence-file', evidencePath],
    { cwd: dir, encoding: 'utf8', env },
  );
  assert.equal(rec2.status, 1);
  assert.match(`${rec2.stderr}`, /do not stack verdicts/);

  // The #1601 scenario: code pushed after approval must invalidate the check.
  writeFileSync(join(dir, 'code.txt'), 'v2\n');
  git('add', 'code.txt');
  git('commit', '-q', '-m', 'feat: sneak in more code');
  const after = runVerify(dir);
  assert.equal(after.status, 1, 'stale approval must not survive a new push');
  assert.match(`${after.stderr}`, /not a verdict-only commit/);
});

// ── targeted-tests: derived mapping ──

const SCRIPTS = {
  'test:weather': 'tsx --test src/services/weather/__tests__/a.test.mts src/services/weather/__tests__/b.test.mts',
  'test:providers': 'tsx --test tests/data-sources-wiring.test.mjs src/services/providers/__tests__/p.test.mts',
  'test:sidecar': 'node --test src-tauri/sidecar/__tests__/route.test.mjs',
  'test:e2e:full': 'cross-env VITE_VARIANT=full playwright test',
  'test:panels:smoke': 'node tests/panels/run-harness.mjs',
  'test:agentic-gate': 'tsx --test tests/agentic-gate.test.mjs',
  'build': 'vite build',
};

test('index derivation: only plain test runners are eligible', () => {
  const index = deriveScriptIndex(SCRIPTS);
  assert.deepEqual([...index.keys()].sort(), ['test:agentic-gate', 'test:providers', 'test:sidecar', 'test:weather']);
});

test('a source change selects the suite covering its directory', () => {
  const index = deriveScriptIndex(SCRIPTS);
  const { scripts, unmapped } = selectScripts(['src/services/weather/nws-polygon-match.ts'], index, {});
  assert.deepEqual(scripts, ['test:weather']);
  assert.deepEqual(unmapped, []);
});

test('a test-file change selects its own suite; sidecar dirs are covered too', () => {
  const index = deriveScriptIndex(SCRIPTS);
  assert.deepEqual(selectScripts(['tests/data-sources-wiring.test.mjs'], index, {}).scripts, ['test:providers']);
  assert.deepEqual(selectScripts(['src-tauri/sidecar/local-api-server.mjs'], index, {}).scripts, ['test:sidecar']);
});

test('the data-loader override guards the text-pinned wiring test', () => {
  const index = deriveScriptIndex(SCRIPTS);
  const { scripts } = selectScripts(['src/app/data-loader.ts'], index, { 'src/app/data-loader.ts': ['test:providers'] });
  assert.deepEqual(scripts, ['test:providers']);
});

test('the UX-010 native controller selects its focused wiring suite', () => {
  const index = deriveScriptIndex({
    'test:ux010-native': 'node --test tests/ux010-location-startup.test.mjs tests/ux010-native-gate.test.mjs',
  });
  const result = selectScripts(['src-tauri/src/current_location.rs'], index, OVERRIDES);
  assert.deepEqual(result, { scripts: ['test:ux010-native'], unmapped: [] });
});

test('the UX-010 native runner keeps trusted selection while executing its Rust contract gate', () => {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  const command = scripts['test:ux010-native'];
  assert.equal(
    command,
    'node --test tests/ux010-location-startup.test.mjs tests/ux010-native-gate.test.mjs',
  );
  assert.equal(isRunnerAllowlisted(command), true);
  assert.deepEqual(commandToStages(command, '/repo/node_modules/.bin'), [{
    bin: process.execPath,
    args: ['--test', 'tests/ux010-location-startup.test.mjs', 'tests/ux010-native-gate.test.mjs'],
  }]);
});

test('UCDP source and boundary tests select the focused provider suite', () => {
  const index = deriveScriptIndex({
    'test:ucdp-provider': 'tsx --test src/services/__tests__/ucdp-runtime-boundary.test.mts api/__tests__/ucdp-classifications.test.mjs tests/ucdp-local-boundary.test.mjs tests/ucdp-loader-freshness.test.mjs',
  });
  const result = selectScripts([
    'api/ucdp-classifications.js',
    'api/__tests__/ucdp-classifications.test.mjs',
    'tests/ucdp-local-boundary.test.mjs',
    'tests/ucdp-loader-freshness.test.mjs',
  ], index, OVERRIDES);
  assert.deepEqual(result, { scripts: ['test:ucdp-provider'], unmapped: [] });
});

test('Emergency Readiness panel config changes select their focused wiring suite', () => {
  const index = deriveScriptIndex({
    'test:emergency-readiness': 'tsx --import ./tests/panels/register-hook.mjs --test tests/emergency-readiness-panel-wiring.test.mjs',
  });
  const result = selectScripts([
    'src/config/panel-metadata.ts',
    'src/config/panels.ts',
  ], index, OVERRIDES);
  assert.deepEqual(result, { scripts: ['test:emergency-readiness'], unmapped: [] });
});

test('roadmap docs and controller changes select the roadmap suite', () => {
  const index = deriveScriptIndex({
    ...SCRIPTS,
    'test:roadmap-controller': 'node --test tests/roadmap-controller.test.mjs',
  });
  const result = selectScripts([
    'docs/USABILITY_UPLIFT_FOR_CODEX.md',
    'docs/PREDICTION_ACCURACY_ROADMAP.md',
    'scripts/roadmap-controller.mjs',
  ], index, OVERRIDES);
  assert.deepEqual(result, { scripts: ['test:roadmap-controller'], unmapped: [] });
});

test('the ESLint runner override selects its focused behavioral suite', () => {
  const index = deriveScriptIndex({
    ...SCRIPTS,
    'test:eslint-runner': 'node --test tests/eslint-runner.test.mjs tests/eslint-baseline.test.mjs tests/lint-workflow.test.mjs',
  });
  const result = selectScripts([
    'scripts/run-eslint.mjs',
    'scripts/lint-baseline.mjs',
    'scripts/lint-changed.mjs',
  ], index, OVERRIDES);
  assert.deepEqual(result, { scripts: ['test:eslint-runner'], unmapped: [] });
});

test('main sync agent changes select the data suite that covers them', () => {
  const index = deriveScriptIndex({
    ...SCRIPTS,
    'test:data': 'tsx --test tests/*.test.mjs tests/*.test.mts',
  });
  const result = selectScripts([
    'scripts/setup-main-sync-agent.mjs',
    'tests/main-sync-agent.test.mjs',
  ], index, OVERRIDES);
  assert.deepEqual(result, { scripts: ['test:data'], unmapped: [] });
});

test('the bundle budget policy override selects its focused behavioral suite', () => {
  const index = deriveScriptIndex({
    ...SCRIPTS,
    'test:bundle-budget-policy': 'node --test tests/bundle-budget-policy.test.mjs',
  });
  const result = selectScripts(['scripts/bundle-budget-policy.mjs'], index, OVERRIDES);
  assert.deepEqual(result, { scripts: ['test:bundle-budget-policy'], unmapped: [] });
});

test('the Little Snitch helper selects its focused behavioral suite', () => {
  const index = deriveScriptIndex({
    ...SCRIPTS,
    'test:little-snitch': 'node --test scripts/little-snitch-log-traffic-helper.test.mjs',
  });
  const result = selectScripts(['scripts/little-snitch-log-traffic-helper.sh'], index, OVERRIDES);
  assert.deepEqual(result, { scripts: ['test:little-snitch'], unmapped: [] });
});

test('weekly evaluation report sources select their focused MCP suite', () => {
  const index = deriveScriptIndex({
    ...SCRIPTS,
    'test:mcp-evaluation-report': 'node --test tools/mcp-server/__tests__/evaluation-report-tools.test.mjs tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs',
  });
  const changed = [
    'tools/mcp-server/local-lock.mjs',
    'tools/mcp-server/tools/evaluation-report.mjs',
    'tools/mcp-server/weekly-evaluation-report.mjs',
  ];
  const result = selectScripts(changed, index, OVERRIDES);
  assert.deepEqual(result, { scripts: ['test:mcp-evaluation-report'], unmapped: [] });
});

test('unmapped source files are reported across api/, tools/, and src-tauri/src/', () => {
  const index = deriveScriptIndex(SCRIPTS);
  const changed = [
    'src/services/brandnew/engine.ts',
    'api/handler.mjs',
    'tools/mcp-server/index.mjs',
    'src-tauri/src/main.rs',
    'docs/README.md',
  ];
  const { scripts, unmapped } = selectScripts(changed, index, {});
  assert.deepEqual(scripts, []);
  assert.deepEqual(unmapped, [
    'src/services/brandnew/engine.ts',
    'api/handler.mjs',
    'tools/mcp-server/index.mjs',
    'src-tauri/src/main.rs',
  ]);
});

test('lockfile- and docs-only changes select nothing and flag nothing', () => {
  const index = deriveScriptIndex(SCRIPTS);
  const { scripts, unmapped } = selectScripts(['package-lock.json', 'docs/PLAN.md', '.github/workflows/x.yml'], index, {});
  assert.deepEqual(scripts, []);
  assert.deepEqual(unmapped, []);
});

test('ciVerdict fails a collapsed index instead of certifying vacuously', () => {
  const r = ciVerdict({ indexSize: 3, selected: [], unmapped: [] });
  assert.equal(r.fail, true);
  assert.match(r.reason, /collapsed to 3/);
});

test('ciVerdict fails a source-touching PR with zero applicable suites', () => {
  const r = ciVerdict({ indexSize: 106, selected: [], unmapped: ['src/services/brandnew/engine.ts'] });
  assert.equal(r.fail, true);
  assert.match(r.reason, /ZERO targeted suites/);
});

test('commandToStages spawns main-trusted commands directly, bypassing PR package.json', () => {
  // A PR rewriting test:weather to another allowlisted-but-inert runner
  // changes nothing: main-selected suites execute MAIN's command verbatim.
  const [tsx] = commandToStages('tsx --test src/services/weather/__tests__/a.test.mts', '/repo/node_modules/.bin');
  assert.equal(tsx.bin, '/repo/node_modules/.bin/tsx');
  assert.deepEqual(tsx.args, ['--test', 'src/services/weather/__tests__/a.test.mts']);
  // Composite && commands (test:feed-health) split into sequential stages —
  // `&&` must never be passed to tsx as a file argument.
  const stages = commandToStages('tsx --test a.test.mts && node --test b.test.mjs', '/bin');
  assert.equal(stages.length, 2);
  assert.deepEqual(stages[0], { bin: '/bin/tsx', args: ['--test', 'a.test.mts'] });
  assert.deepEqual(stages[1], { bin: process.execPath, args: ['--test', 'b.test.mjs'] });
  assert.ok(stages.every((st) => !st.args.includes('&&')));
  // A stage with an untrusted runner refuses instead of shelling out.
  assert.throws(() => commandToStages('tsx --test a.mts && rm -rf /', '/bin'), /untrusted stage runner/);
});

test('ciVerdict fails a NEW uncovered source file; baselined gaps only warn', () => {
  // New file, not in the ratchet baseline → hard fail even with other coverage.
  const fresh = ciVerdict({
    indexSize: 106,
    selected: ['test:weather'],
    unmapped: ['src/services/brandnew/engine.ts'],
    unbaselined: ['src/services/brandnew/engine.ts'],
  });
  assert.equal(fresh.fail, true);
  assert.match(fresh.reason, /not in the coverage baseline/);
  // Same gap listed in the reviewed baseline → pass with the printed warning.
  const known = ciVerdict({
    indexSize: 106,
    selected: ['test:weather'],
    unmapped: ['scripts/pr-closeout.sh'],
    unbaselined: [],
  });
  assert.equal(known.fail, false);
  assert.equal(ciVerdict({ indexSize: 106, selected: ['test:weather'], unmapped: [] }).fail, false);
});

test('the runner allowlist accepts real runners and rejects impostors', () => {
  assert.equal(isRunnerAllowlisted('tsx --test src/services/weather/__tests__/a.test.mts'), true);
  assert.equal(isRunnerAllowlisted('node --test tests/x.test.mjs'), true);
  assert.equal(isRunnerAllowlisted('echo ok'), false);
  assert.equal(isRunnerAllowlisted(undefined), false);
});

// ── ci-codex-review: verdict-line parsing ──

test('the verdict must be the final non-empty line', () => {
  const good = '{"blockingFindings": 1, "findings": [{"severity": "high", "file": "a.ts", "line": 3, "summary": "bug", "blocking": true}]}';
  const v = parseVerdictLine(`Thinking about the diff...\n${good}`);
  assert.equal(v.blockingFindings, 1);
  // An approve JSON followed by a prose correction must NOT read as approval.
  assert.equal(parseVerdictLine(`${good}\nActually, one more blocking issue in b.ts.`), null);
});

test('schema violations parse to null so the check refuses to pass', () => {
  assert.equal(parseVerdictLine('All good, ship it. No blocking findings.'), null);
  assert.equal(parseVerdictLine('{"blockingFindings": -1, "findings": []}'), null);
  assert.equal(parseVerdictLine('{"blockingFindings": 0.5, "findings": []}'), null);
  assert.equal(parseVerdictLine('{"blockingFindings": 0, "findings": [{"file": "a.ts", "summary": "x"}]}'), null);
  assert.equal(parseVerdictLine('{"looksLike": "json but wrong shape"}'), null);
});

// ── cross-agent-check: advice must match the gate it describes ──

test('the advised reviewer tracks requiredReviewers, never a private copy', () => {
  assert.equal(expectedReviewer('claude/x'), 'Codex');
  assert.equal(expectedReviewer('codex/x'), 'Claude');
  assert.equal(expectedReviewer('copilot/x'), 'Codex or Claude');
  assert.equal(expectedReviewer('feature/x'), 'another agent');
  // Drift guard: the prose must be derived from the enforcing mapping.
  for (const branch of ['claude/x', 'codex/x', 'copilot/x', 'feature/x']) {
    const reviewers = requiredReviewers(branch);
    const expected = reviewers === null
      ? 'another agent'
      : reviewers.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(' or ');
    assert.equal(expectedReviewer(branch), expected);
  }
});

test('a non-agent branch is advised no verdict, because record() would reject it', () => {
  assert.equal(verdictAdvice('feature/x'), null);
  assert.equal(verdictAdvice('main'), null);
  assert.equal(requiredReviewers('feature/x'), null);
});

test('the advised --reviewer slug is one the verifier would accept', () => {
  for (const branch of ['claude/x', 'codex/x']) {
    const line = verdictAdvice(branch).find((l) => l.includes('--reviewer'));
    const slug = line.split('--reviewer ')[1].split(' ')[0];
    assert.ok(requiredReviewers(branch).includes(slug), `${slug} rejected for ${branch}`);
  }
  // Either agent may review a copilot branch, so the advice must not pick one.
  const copilot = verdictAdvice('copilot/x').find((l) => l.includes('--reviewer'));
  assert.match(copilot, /--reviewer <codex\|claude>/);
});

test('the advice never tells the operator to commit the verdict a second time', () => {
  const advice = verdictAdvice('claude/x').join('\n');
  assert.ok(advice.includes('--record'), 'advice should show the record command');
  assert.doesNotMatch(advice, /^git commit/m, '--record already commits; a second commit fails');
});

test('importing cross-agent-check does not run its CLI', () => {
  // A bare `main()` call at module scope would print the whole report on import
  // and shell out to git; asserting on exported types would not catch that.
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `import ${JSON.stringify(join(root, 'scripts/cross-agent-check.mjs'))};`],
    { encoding: 'utf8', cwd: root },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '', `import emitted CLI output:\n${r.stdout}`);
});

test('a same-basename entrypoint does not trigger the CLI', () => {
  // The previous guard compared basenames, so ANY entrypoint named
  // cross-agent-check.mjs ran the report on import. argv[1] is the decoy here.
  const dir = mkdtempSync(join(tmpdir(), 'basename-collision-'));
  const decoy = join(dir, 'cross-agent-check.mjs');
  writeFileSync(decoy, `import ${JSON.stringify(join(root, 'scripts/cross-agent-check.mjs'))};\n`);
  const r = spawnSync(process.execPath, [decoy], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '', `same-basename import emitted CLI output:\n${r.stdout}`);
});

test('importing cross-agent-check cannot trigger the verifier CLI transitively', () => {
  // cross-agent-check imports requiredReviewers from verify-review-verdict. Under
  // the verifier's own basename guard, an entrypoint named verify-review-verdict.mjs
  // made that transitive import RUN THE GATE and exit 1 — import-safety in the
  // importer is worthless if the imported module is not import-safe too.
  const dir = mkdtempSync(join(tmpdir(), 'transitive-collision-'));
  const decoy = join(dir, 'verify-review-verdict.mjs');
  writeFileSync(decoy, `import ${JSON.stringify(join(root, 'scripts/cross-agent-check.mjs'))};\n`);
  const r = spawnSync(process.execPath, [decoy], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, `verifier CLI ran transitively:\n${r.stderr}`);
  assert.equal(r.stdout.trim(), '', `transitive import emitted stdout:\n${r.stdout}`);
  assert.equal(r.stderr.trim(), '', `transitive import emitted stderr:\n${r.stderr}`);
});

test('changing cross-agent-check selects a suite that actually covers it', () => {
  // Guards the OVERRIDES entry: without it the five tests above still pass
  // while CI certifies nothing about the file.
  const index = deriveScriptIndex({ 'test:agentic-pipeline': 'tsx --test tests/agentic-pipeline.test.mjs' }, root);
  const { scripts, unmapped } = selectScripts(['scripts/cross-agent-check.mjs'], index);
  assert.deepEqual(scripts, ['test:agentic-pipeline']);
  assert.deepEqual(unmapped, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateVerdict, requiredReviewers } from '../scripts/verify-review-verdict.mjs';
import { deriveScriptIndex, selectScripts } from '../scripts/targeted-tests.mjs';
import { parseVerdictLine } from '../scripts/ci-codex-review.mjs';

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

test('non-agent branches require no verdict', () => {
  assert.equal(requiredReviewers('dependabot/npm_and_yarn/foo'), null);
  const r = validateVerdict({ branch: 'dependabot/npm_and_yarn/foo', headFiles: ['package.json'], headParent: SHA_A, verdictJson: '' });
  assert.equal(r.ok, true);
});

test('a code tip on an agent branch fails with recording instructions', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headFiles: ['src/app/data-loader.ts'],
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
    headFiles: [`.agentic/reviews/${SHA_A}.json`],
    headParent: SHA_A,
    verdictJson: goodVerdict(),
  });
  assert.equal(r.ok, true, JSON.stringify(r.failures ?? []));
});

test('self-review is rejected: claude reviewing claude/*', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headFiles: [`.agentic/reviews/${SHA_A}.json`],
    headParent: SHA_A,
    verdictJson: goodVerdict({ reviewer: 'claude' }),
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /Self-review does not count/.test(f)));
});

test('a verdict pinning the wrong sha is rejected', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headFiles: [`.agentic/reviews/${SHA_A}.json`],
    headParent: SHA_A,
    verdictJson: goodVerdict({ reviewedSha: SHA_B }),
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /pins b{40}.*reviewed commit is a{40}/.test(f)));
});

test('a verdict commit smuggling a code file is rejected', () => {
  const r = validateVerdict({
    branch: 'claude/feature',
    headFiles: [`.agentic/reviews/${SHA_A}.json`, 'src/services/weather/weather.ts'],
    headParent: SHA_A,
    verdictJson: goodVerdict(),
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /outside the protocol dir.*weather\.ts/.test(f)));
});

test('non-approve verdicts, nonzero blocking counts, and thin evidence are rejected', () => {
  for (const [overrides, pattern] of [
    [{ verdict: 'request_changes' }, /not "approve"/],
    [{ blockingFindings: 2 }, /blockingFindings is 2/],
    [{ evidence: 'looks good' }, /quote the reviewer's actual concluding output/],
  ]) {
    const r = validateVerdict({
      branch: 'codex/feature',
      headFiles: [`.agentic/reviews/${SHA_A}.json`],
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
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', branch);
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

test('unmapped source files are reported, never silently covered', () => {
  const index = deriveScriptIndex(SCRIPTS);
  const { scripts, unmapped } = selectScripts(['src/services/brandnew/engine.ts', 'docs/README.md'], index, {});
  assert.deepEqual(scripts, []);
  assert.deepEqual(unmapped, ['src/services/brandnew/engine.ts']);
});

test('lockfile- and docs-only changes select nothing and flag nothing', () => {
  const index = deriveScriptIndex(SCRIPTS);
  const { scripts, unmapped } = selectScripts(['package-lock.json', 'docs/PLAN.md', '.github/workflows/x.yml'], index, {});
  assert.deepEqual(scripts, []);
  assert.deepEqual(unmapped, []);
});

// ── ci-codex-review: verdict-line parsing ──

test('the parser takes the final JSON verdict line and ignores prose', () => {
  const out = [
    'Thinking about the diff...',
    '{"looksLike": "json but wrong shape"}',
    'Findings below.',
    '{"blockingFindings": 1, "findings": [{"severity": "high", "file": "a.ts", "line": 3, "summary": "bug", "blocking": true}]}',
  ].join('\n');
  const v = parseVerdictLine(out);
  assert.equal(v.blockingFindings, 1);
  assert.equal(v.findings[0].file, 'a.ts');
});

test('prose-only reviewer output parses to null so the check refuses to pass', () => {
  assert.equal(parseVerdictLine('All good, ship it. No blocking findings.'), null);
});

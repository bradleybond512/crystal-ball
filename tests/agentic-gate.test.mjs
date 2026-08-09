import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = 'scripts/agentic-validate.sh';

// A fake `npm` shadows the real one via PATH and logs every invocation, so
// "no test executed before rejection" is proven by the log being empty — not
// inferred from the gate's own output markers, which a broken gate that
// bypassed run() would never print. It also makes the positive paths cheap:
// the full pipeline "runs" in milliseconds because every npm call is the stub.
// Args are logged \037-delimited to preserve boundaries: `npm run x -- --y`
// and `npm "run x -- --y"` must not produce the same record.
const stubDir = mkdtempSync(join(tmpdir(), 'agentic-gate-stub-'));
writeFileSync(
  join(stubDir, 'npm'),
  '#!/bin/sh\n'
    // A surviving CB_DOCS_ROOT means the gate leaked the docs-checker's test
    // seam into a real run — record it as a call so deepEqual catches it.
    + '[ -n "${CB_DOCS_ROOT:-}" ] && printf \'CB_DOCS_ROOT_LEAKED\\037\\n\' >> "$NPM_CALL_LOG"\n'
    + '{ printf \'%s\\037\' "$@"; printf \'\\n\'; } >> "$NPM_CALL_LOG"\n'
    + 'exit 0\n',
);
chmodSync(join(stubDir, 'npm'), 0o755);

// Exported bash functions (BASH_FUNC_npm%%=...) resolve before PATH, and
// BASH_ENV/ENV source arbitrary startup files — either could bypass the stub
// and run the real npm. Strip them so the harness is hermetic.
function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.BASH_ENV;
  delete env.ENV;
  for (const k of Object.keys(env)) {
    if (k.startsWith('BASH_FUNC_')) delete env[k];
  }
  return env;
}

let callSeq = 0;

function gate(args, extraEnv = {}) {
  const logPath = join(stubDir, `calls-${callSeq++}.log`);
  const r = spawnSync('bash', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: cleanEnv({ PATH: `${stubDir}:${process.env.PATH}`, NPM_CALL_LOG: logPath, ...extraEnv }),
  });
  const npmCalls = existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
        .map((line) => line.split('\u001f').slice(0, -1))
    : [];
  return { code: r.status, out: `${r.stdout}${r.stderr}`, npmCalls };
}

const MANDATORY_PIPELINE = [
  ['run', 'lockfile:check'],
  ['run', 'lint:strict'],
  ['run', 'typecheck:all'],
  ['run', 'secrets:scan'],
  ['run', 'cross-agent:check'],
  ['run', 'docs:check', '--', '--changelog-advisory'],
  ['run', 'build'],
];

// ── Rejection paths: exit 2 and, critically, zero npm invocations ──

test('no arguments is refused rather than passing silently', () => {
  const { code, out, npmCalls } = gate([]);
  assert.equal(code, 2);
  assert.match(out, /Refusing to pass: no tests named/);
  assert.deepEqual(npmCalls, []);
});

test('--tests and --no-tests together are refused', () => {
  const { code, out, npmCalls } = gate(['--tests', 'test:providers', '--no-tests', 'because']);
  assert.equal(code, 2);
  assert.match(out, /mutually exclusive/);
  assert.deepEqual(npmCalls, []);
});

test('an unknown npm script is refused before any script runs', () => {
  const { code, out, npmCalls } = gate(['--tests', 'test:providers test:doesnotexist']);
  assert.equal(code, 2);
  assert.match(out, /No such npm script: test:doesnotexist/);
  // The regression this pins: validation used to live inside the run loop, so
  // test:providers executed for real before the typo was caught.
  assert.deepEqual(npmCalls, []);
});

test('a whitespace-only --tests value is refused, not treated as coverage', () => {
  const { code, out, npmCalls } = gate(['--tests', '   ']);
  assert.equal(code, 2);
  assert.match(out, /Refusing to pass: no tests named/);
  assert.deepEqual(npmCalls, []);
});

test('a whitespace-only --no-tests reason is refused', () => {
  // Tabs included: a space-only strip would let "\t" through as a "reason".
  for (const reason of ['   ', '\t', ' \t \t ']) {
    const { code, out, npmCalls } = gate(['--no-tests', reason]);
    assert.equal(code, 2);
    assert.match(out, /Refusing to pass: no tests named/);
    assert.deepEqual(npmCalls, []);
  }
});

test('a glob in --tests stays a literal script name', () => {
  const { code, out, npmCalls } = gate(['--tests', '*']);
  assert.equal(code, 2);
  assert.match(out, /No such npm script: \*/);
  assert.deepEqual(npmCalls, []);
});

test('--tests with no value is refused', () => {
  const { code, npmCalls } = gate(['--tests']);
  assert.equal(code, 2);
  assert.deepEqual(npmCalls, []);
});

test('an unrecognized argument is refused', () => {
  const { code, out, npmCalls } = gate(['--yolo']);
  assert.equal(code, 2);
  assert.match(out, /Unknown argument: --yolo/);
  assert.deepEqual(npmCalls, []);
});

// ── Positive paths: the pipeline actually runs, in order ──
// Deliberately NOT test:agentic-gate here: if the stub were ever bypassed,
// naming this suite would recurse into itself.

test('a valid --tests invocation runs the named scripts then the full pipeline', () => {
  const { code, out, npmCalls } = gate(['--tests', 'test:settings test:datacenter']);
  assert.equal(code, 0);
  assert.deepEqual(npmCalls, [
    ['run', 'test:settings'],
    ['run', 'test:datacenter'],
    ...MANDATORY_PIPELINE,
  ]);
  assert.match(out, /Agentic validation gate passed\./);
  assert.match(out, /Tests run: test:settings test:datacenter/);
});

test('a valid --no-tests waiver proceeds through the pipeline without running any test', () => {
  const { code, out, npmCalls } = gate(['--no-tests', 'docs-only change, no testable behavior']);
  assert.equal(code, 0);
  assert.deepEqual(npmCalls, MANDATORY_PIPELINE);
  assert.match(out, /Tests waived: docs-only change, no testable behavior/);
  assert.match(out, /Agentic validation gate passed\./);
});

test('the gate neutralizes an inherited CB_DOCS_ROOT so the docs seam cannot bypass it', () => {
  // Without the unset, CB_DOCS_ROOT=/var/empty makes every structural doc
  // check vacuously green in a REAL gate run. The stub logs a leak marker if
  // the variable survives into any npm invocation.
  const { code, npmCalls } = gate(
    ['--no-tests', 'seam-leak check'],
    { CB_DOCS_ROOT: '/var/empty' },
  );
  assert.equal(code, 0);
  assert.ok(!npmCalls.some((call) => call.includes('CB_DOCS_ROOT_LEAKED')));
  assert.deepEqual(npmCalls, MANDATORY_PIPELINE);
});

// ── docs:check advisory split: only the CHANGELOG heuristic is demoted ──

function docsCheck({ fixtureRoot, flags = [] } = {}) {
  const r = spawnSync(process.execPath, ['scripts/check-docs-freshness.mjs', '--json', ...flags], {
    cwd: root,
    encoding: 'utf8',
    env: cleanEnv(fixtureRoot ? { CB_DOCS_ROOT: fixtureRoot } : {}),
  });
  return { code: r.status, json: JSON.parse(r.stdout) };
}

test('bare docs:check --json output shape is unchanged and exit tracks needsUpdate', () => {
  const { code, json } = docsCheck();
  assert.equal('advisoryIssues' in json, false);
  assert.equal(code, json.needsUpdate ? 1 : 0);
});

test('--changelog-advisory demotes only CHANGELOG items, never drops or invents issues', () => {
  const bare = docsCheck();
  const adv = docsCheck({ flags: ['--changelog-advisory'] });
  assert.equal(adv.code, adv.json.needsUpdate ? 1 : 0);
  // Nothing changelog-shaped may remain blocking...
  for (const issue of adv.json.issues) assert.doesNotMatch(issue, /not in CHANGELOG/);
  // ...nothing else may be demoted...
  for (const issue of adv.json.advisoryIssues) assert.match(issue, /not in CHANGELOG/);
  // ...and blocking + advisory under the flag is exactly the bare blocking set.
  assert.deepEqual(
    [...adv.json.issues, ...adv.json.advisoryIssues].sort(),
    [...bare.json.issues].sort(),
  );
});

// The live tree may have zero structural issues, which would make "keeps the
// rest fatal" vacuously true. A fixture tree with BOTH a structural issue and
// a CHANGELOG issue proves the flag demotes one without softening the other.
function buildDocsFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'docs-fixture-'));
  writeFileSync(join(dir, 'README.md'), '| Supported secret keys | 99 |\n');
  mkdirSync(join(dir, 'src-tauri', 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src-tauri', 'src', 'main.rs'),
    'pub const SUPPORTED_SECRET_KEYS: [&str; 2] = ["A_KEY", "B_KEY"];\n',
  );
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args[0]} failed: ${r.stderr}`);
  };
  git('init', '-q');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@test',
    'commit', '--allow-empty', '-q', '-m', 'feat: fixture change (#123)');
  return dir;
}

test('--changelog-advisory keeps structural drift fatal on a tree that has both kinds', () => {
  const fixtureRoot = buildDocsFixture();
  const bare = docsCheck({ fixtureRoot });
  assert.equal(bare.code, 1);
  assert.ok(bare.json.issues.some((i) => /README says 99 secret keys, main\.rs has 2/.test(i)));
  assert.ok(bare.json.issues.some((i) => /PR #123 not in CHANGELOG/.test(i)));

  const adv = docsCheck({ fixtureRoot, flags: ['--changelog-advisory'] });
  // The CHANGELOG item is demoted; the structural item still fails the run.
  assert.equal(adv.code, 1);
  assert.ok(adv.json.issues.some((i) => /README says 99 secret keys, main\.rs has 2/.test(i)));
  assert.ok(adv.json.issues.every((i) => !/not in CHANGELOG/.test(i)));
  assert.ok(adv.json.advisoryIssues.some((i) => /PR #123 not in CHANGELOG/.test(i)));
});

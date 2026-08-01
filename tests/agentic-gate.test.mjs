import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
const stubDir = mkdtempSync(join(tmpdir(), 'agentic-gate-stub-'));
writeFileSync(join(stubDir, 'npm'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$NPM_CALL_LOG"\nexit 0\n');
chmodSync(join(stubDir, 'npm'), 0o755);

let callSeq = 0;

function gate(...args) {
  const logPath = join(stubDir, `calls-${callSeq++}.log`);
  const r = spawnSync('bash', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, NPM_CALL_LOG: logPath },
  });
  const npmCalls = existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    : [];
  return { code: r.status, out: `${r.stdout}${r.stderr}`, npmCalls };
}

const MANDATORY_PIPELINE = [
  'run lockfile:check',
  'run lint:strict',
  'run typecheck:all',
  'run secrets:scan',
  'run cross-agent:check',
  'run docs:check -- --changelog-advisory',
  'run build',
];

// ── Rejection paths: exit 2 and, critically, zero npm invocations ──

test('no arguments is refused rather than passing silently', () => {
  const { code, out, npmCalls } = gate();
  assert.equal(code, 2);
  assert.match(out, /Refusing to pass: no tests named/);
  assert.deepEqual(npmCalls, []);
});

test('--tests and --no-tests together are refused', () => {
  const { code, out, npmCalls } = gate('--tests', 'test:providers', '--no-tests', 'because');
  assert.equal(code, 2);
  assert.match(out, /mutually exclusive/);
  assert.deepEqual(npmCalls, []);
});

test('an unknown npm script is refused before any script runs', () => {
  const { code, out, npmCalls } = gate('--tests', 'test:providers test:doesnotexist');
  assert.equal(code, 2);
  assert.match(out, /No such npm script: test:doesnotexist/);
  // The regression this pins: validation used to live inside the run loop, so
  // test:providers executed for real before the typo was caught.
  assert.deepEqual(npmCalls, []);
});

test('a whitespace-only --tests value is refused, not treated as coverage', () => {
  const { code, out, npmCalls } = gate('--tests', '   ');
  assert.equal(code, 2);
  assert.match(out, /Refusing to pass: no tests named/);
  assert.deepEqual(npmCalls, []);
});

test('a whitespace-only --no-tests reason is refused', () => {
  // Tabs included: a space-only strip would let "\t" through as a "reason".
  for (const reason of ['   ', '\t', ' \t \t ']) {
    const { code, out, npmCalls } = gate('--no-tests', reason);
    assert.equal(code, 2);
    assert.match(out, /Refusing to pass: no tests named/);
    assert.deepEqual(npmCalls, []);
  }
});

test('a glob in --tests stays a literal script name', () => {
  const { code, out, npmCalls } = gate('--tests', '*');
  assert.equal(code, 2);
  assert.match(out, /No such npm script: \*/);
  assert.deepEqual(npmCalls, []);
});

test('--tests with no value is refused', () => {
  const { code, npmCalls } = gate('--tests');
  assert.equal(code, 2);
  assert.deepEqual(npmCalls, []);
});

test('an unrecognized argument is refused', () => {
  const { code, out, npmCalls } = gate('--yolo');
  assert.equal(code, 2);
  assert.match(out, /Unknown argument: --yolo/);
  assert.deepEqual(npmCalls, []);
});

// ── Positive paths: the pipeline actually runs, in order ──

test('a valid --tests invocation runs the named scripts then the full pipeline', () => {
  const { code, out, npmCalls } = gate('--tests', 'test:agentic-gate test:settings');
  assert.equal(code, 0);
  assert.deepEqual(npmCalls, [
    'run test:agentic-gate',
    'run test:settings',
    ...MANDATORY_PIPELINE,
  ]);
  assert.match(out, /Agentic validation gate passed\./);
  assert.match(out, /Tests run: test:agentic-gate test:settings/);
});

test('a valid --no-tests waiver proceeds through the pipeline without running any test', () => {
  const { code, out, npmCalls } = gate('--no-tests', 'docs-only change, no testable behavior');
  assert.equal(code, 0);
  assert.deepEqual(npmCalls, MANDATORY_PIPELINE);
  assert.match(out, /Tests waived: docs-only change, no testable behavior/);
  assert.match(out, /Agentic validation gate passed\./);
});

// ── docs:check advisory split: only the CHANGELOG heuristic is demoted ──

function docsCheck(...flags) {
  const r = spawnSync(process.execPath, ['scripts/check-docs-freshness.mjs', '--json', ...flags], {
    cwd: root,
    encoding: 'utf8',
  });
  return { code: r.status, json: JSON.parse(r.stdout) };
}

test('bare docs:check --json output shape is unchanged and exit tracks needsUpdate', () => {
  const { code, json } = docsCheck();
  assert.equal('advisoryIssues' in json, false);
  assert.equal(code, json.needsUpdate ? 1 : 0);
});

test('--changelog-advisory demotes only CHANGELOG items and keeps the rest fatal', () => {
  const bare = docsCheck();
  const adv = docsCheck('--changelog-advisory');
  assert.equal(adv.code, adv.json.needsUpdate ? 1 : 0);
  // Nothing changelog-shaped may remain blocking...
  for (const issue of adv.json.issues) assert.doesNotMatch(issue, /not in CHANGELOG/);
  // ...nothing else may be demoted...
  for (const issue of adv.json.advisoryIssues) assert.match(issue, /not in CHANGELOG/);
  // ...and the flag must not drop or invent issues: blocking + advisory under
  // the flag is exactly the bare blocking set.
  assert.deepEqual(
    [...adv.json.issues, ...adv.json.advisoryIssues].sort(),
    [...bare.json.issues].sort(),
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = 'scripts/agentic-validate.sh';

// Every case below must be rejected during argument parsing, BEFORE the gate
// shells out to npm. That is what makes them cheap enough to test: a case that
// reached the run loop would take minutes and write build artifacts.
function gate(...args) {
  const r = spawnSync('bash', [script, ...args], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// `npm run <script>` emits this; its absence proves nothing was executed.
function ranSomething(out) {
  return /^==> npm run /m.test(out);
}

test('no arguments is refused rather than passing silently', () => {
  const { code, out } = gate();
  assert.equal(code, 2);
  assert.match(out, /Refusing to pass: no tests named/);
  assert.equal(ranSomething(out), false);
});

test('--tests and --no-tests together are refused', () => {
  const { code, out } = gate('--tests', 'test:providers', '--no-tests', 'because');
  assert.equal(code, 2);
  assert.match(out, /mutually exclusive/);
  assert.equal(ranSomething(out), false);
});

test('an unknown npm script is refused before any real script runs', () => {
  const { code, out } = gate('--tests', 'test:providers test:doesnotexist');
  assert.equal(code, 2);
  assert.match(out, /No such npm script: test:doesnotexist/);
  // The regression this locks in: validation used to live inside the run loop,
  // so `test:providers` executed for real before the typo was caught.
  assert.equal(ranSomething(out), false);
});

test('a whitespace-only --tests value is refused, not treated as coverage', () => {
  const { code, out } = gate('--tests', '   ');
  assert.equal(code, 2);
  assert.match(out, /Refusing to pass: no tests named/);
  assert.equal(ranSomething(out), false);
});

test('a whitespace-only --no-tests reason is refused', () => {
  // Tabs included: a space-only strip would let "\t" through as a "reason".
  for (const reason of ['   ', '\t', ' \t \t ']) {
    const { code, out } = gate('--no-tests', reason);
    assert.equal(code, 2);
    assert.match(out, /Refusing to pass: no tests named/);
    assert.equal(ranSomething(out), false);
  }
});

test('a glob in --tests stays a literal script name', () => {
  const { code, out } = gate('--tests', '*');
  assert.equal(code, 2);
  assert.match(out, /No such npm script: \*/);
});

test('--tests with no value is refused', () => {
  const { code, out } = gate('--tests');
  assert.equal(code, 2);
  assert.equal(ranSomething(out), false);
});

test('an unrecognized argument is refused', () => {
  const { code, out } = gate('--yolo');
  assert.equal(code, 2);
  assert.match(out, /Unknown argument: --yolo/);
  assert.equal(ranSomething(out), false);
});

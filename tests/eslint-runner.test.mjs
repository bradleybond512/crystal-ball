import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(repoRoot, 'scripts', 'run-eslint.mjs');

async function loadRunner() {
  assert.equal(existsSync(runnerPath), true, 'bounded ESLint runner should exist');
  return import(pathToFileURL(runnerPath).href);
}

test('ESLint runner reports progress and returns a successful exit', async () => {
  const { runCommandWithProgress } = await loadRunner();
  const messages = [];
  const result = await runCommandWithProgress(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 40)'],
    {
      label: 'fixture',
      timeoutMs: 10_000,
      progressIntervalMs: 10,
      stdio: 'ignore',
      logger: { log: message => messages.push(message), error: message => messages.push(message) },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.ok(messages.some(message => message.includes('fixture still running')));
});

test('ESLint runner preserves a child failure exit code', async () => {
  const { runCommandWithProgress } = await loadRunner();
  const result = await runCommandWithProgress(
    process.execPath,
    ['-e', 'process.exit(7)'],
    { label: 'fixture', timeoutMs: 10_000, progressIntervalMs: 100, stdio: 'ignore' },
  );

  assert.equal(result.exitCode, 7);
  assert.equal(result.timedOut, false);
});

test('ESLint runner terminates an over-budget process with exit 124', async () => {
  const { runCommandWithProgress } = await loadRunner();
  const messages = [];
  const result = await runCommandWithProgress(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1_000)'],
    {
      label: 'fixture',
      timeoutMs: 30,
      progressIntervalMs: 10,
      killGraceMs: 30,
      stdio: 'ignore',
      logger: { log: message => messages.push(message), error: message => messages.push(message) },
    },
  );

  assert.equal(result.exitCode, 124);
  assert.equal(result.timedOut, true);
  assert.ok(messages.some(message => message.includes('exceeded 30ms')));
});

test('ESLint runner rechecks an unchanged caller when an imported return type changes', { timeout: 120_000 }, () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'eslint-runner-types-'));
  try {
    mkdirSync(path.join(fixture, 'scripts'));
    mkdirSync(path.join(fixture, 'src'));
    copyFileSync(runnerPath, path.join(fixture, 'scripts', 'run-eslint.mjs'));
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
    writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(path.join(fixture, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', strict: true },
      include: ['src'],
    }));
    writeFileSync(path.join(fixture, 'eslint.config.mjs'), `
import tseslint from 'typescript-eslint';
export default [{
  files: ['src/**/*.ts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
  },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: { '@typescript-eslint/no-floating-promises': 'error' },
}];
`);
    const callerPath = path.join(fixture, 'src', 'caller.ts');
    const providerPath = path.join(fixture, 'src', 'provider.ts');
    const caller = "import { execute } from './provider';\nexecute();\n";
    writeFileSync(callerPath, caller);
    writeFileSync(providerPath, 'export function execute(): void {}\n');
    const env = { ...process.env, CB_ESLINT_TIMEOUT_MS: '30000' };
    delete env.CB_ESLINT_NO_CACHE;
    const lint = () => spawnSync(process.execPath, ['scripts/run-eslint.mjs', 'src'], {
      cwd: fixture,
      env,
      encoding: 'utf8',
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
    });

    const before = lint();
    assert.ifError(before.error);
    assert.equal(before.status, 0, before.stdout + before.stderr);

    writeFileSync(providerPath, 'export function execute(): Promise<void> { return Promise.resolve(); }\n');
    assert.equal(readFileSync(callerPath, 'utf8'), caller);
    const after = lint();
    assert.ifError(after.error);
    assert.equal(after.status, 1, `The unchanged caller must be rechecked: ${after.stdout}${after.stderr}`);
    assert.match(after.stdout + after.stderr, /@typescript-eslint\/no-floating-promises/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

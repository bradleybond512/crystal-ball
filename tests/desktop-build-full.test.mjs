// R4-SEC-002 review fix: `npm run desktop:build:full -- <flags>` must hand
// every flag to packaging (not to the local install), print help without
// downloading, building or installing, and install only after packaging
// succeeded. These tests run the real npm entry point, the real .npmrc and the
// real orchestrator against harmless stub child scripts in a temp project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = 'desktop:build:full';
const { scripts } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PACKAGE_ARGS = ['--os', 'macos', '--variant', 'full'];

const STUB = `import { appendFileSync } from 'node:fs';
import path from 'node:path';
const name = path.basename(process.argv[1]);
appendFileSync(process.env.STUB_LOG, JSON.stringify({ name, args: process.argv.slice(2) }) + '\\n');
const code = Number(process.env['STUB_EXIT_' + name.replace(/\\W/g, '_')] ?? 0);
process.exit(code);
`;

/** A temp project: the real npm script, .npmrc and orchestrator; stub children. */
function project(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'desktop-build-full-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'scripts'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'desktop-build-full-fixture', private: true, scripts: { [SCRIPT]: scripts[SCRIPT] },
  }));
  copyFileSync(path.join(ROOT, '.npmrc'), path.join(dir, '.npmrc'));
  copyFileSync(path.join(ROOT, 'scripts/desktop-build-full.mjs'), path.join(dir, 'scripts/desktop-build-full.mjs'));
  for (const stub of ['download-vault-textures.mjs', 'desktop-package.mjs', 'local-install.mjs']) {
    writeFileSync(path.join(dir, 'scripts', stub), STUB);
  }
  return dir;
}

function npmRun(dir, forwarded, extraEnv = {}) {
  const log = path.join(dir, 'calls.jsonl');
  writeFileSync(log, '');
  const npm = process.env.npm_execpath;
  const [cmd, base] = npm ? [process.execPath, [npm]] : ['npm', []];
  const args = [...base, 'run', '--silent', SCRIPT, ...(forwarded.length > 0 ? ['--', ...forwarded] : [])];
  const env = { ...process.env, STUB_LOG: log, ...extraEnv };
  for (const key of Object.keys(env)) if (key.startsWith('npm_config_')) delete env[key];
  const result = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { status: result.status, calls, output: `${result.stdout}${result.stderr}` };
}

test('the npm entry point is the orchestrator, not a shell chain', () => {
  assert.equal(scripts[SCRIPT], 'node scripts/desktop-build-full.mjs');
});

test('npm forwards packaging flags to packaging, never to the install', (t) => {
  const run = npmRun(project(t), ['--sign', '--skip-node-runtime']);
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.calls, [
    { name: 'download-vault-textures.mjs', args: [] },
    { name: 'desktop-package.mjs', args: [...PACKAGE_ARGS, '--sign', '--skip-node-runtime'] },
    { name: 'local-install.mjs', args: [] },
  ]);
});

test('help prints packaging help only: no download, build or install', (t) => {
  const dir = project(t);
  for (const flag of ['--help', '--h', '-h']) {
    const run = npmRun(dir, [flag]);
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.calls, [{ name: 'desktop-package.mjs', args: [...PACKAGE_ARGS, '--help'] }], flag);
  }
});

test('a failed packaging step stops before the install and fails the npm run', (t) => {
  const run = npmRun(project(t), ['--sign'], { STUB_EXIT_desktop_package_mjs: '7' });
  assert.notEqual(run.status, 0);
  assert.deepEqual(run.calls.map((c) => c.name), ['download-vault-textures.mjs', 'desktop-package.mjs']);
  assert.match(run.output, /desktop-package\.mjs exited 7; stopping before any later step/);
});

test('a failed texture download stops before packaging', (t) => {
  const run = npmRun(project(t), [], { STUB_EXIT_download_vault_textures_mjs: '3' });
  assert.notEqual(run.status, 0);
  assert.deepEqual(run.calls.map((c) => c.name), ['download-vault-textures.mjs']);
});

test('the exact exit code of a failed step reaches the caller, and install failures fail too', (t) => {
  const dir = project(t);
  const direct = (env) => {
    const log = path.join(dir, 'direct.jsonl');
    writeFileSync(log, '');
    return spawnSync(process.execPath, [path.join(dir, 'scripts/desktop-build-full.mjs')], {
      env: { ...process.env, STUB_LOG: log, ...env }, encoding: 'utf8',
    }).status;
  };
  assert.equal(direct({ STUB_EXIT_desktop_package_mjs: '7' }), 7);
  assert.equal(direct({ STUB_EXIT_local_install_mjs: '5' }), 5);
  assert.equal(direct({}), 0);
});

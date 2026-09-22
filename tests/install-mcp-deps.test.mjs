/**
 * Guards the nested-MCP-dependency installer.
 *
 * The bug this script exists to prevent: tools/mcp-server is its own npm
 * package, the root `npm ci` never installed it, and the MCP server died with
 * ERR_MODULE_NOT_FOUND surfacing only as "CONNECTION_CLOSED". These tests pin
 * the decision logic — especially the skip paths, since a regression there
 * either reintroduces that failure or slows every `npm install`.
 */
import test, { after } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'install-mcp-deps.mjs');

async function loadScript() {
  assert.equal(existsSync(scriptPath), true, 'install-mcp-deps.mjs should exist');
  return import(pathToFileURL(scriptPath).href);
}

const temporaryDirs = [];
after(() => temporaryDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Build a throwaway server dir with the requested marker files present. */
function makeServerDir({ pkg = true, nodeModules = false, lockfile = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-deps-'));
  temporaryDirs.push(dir);
  if (pkg) writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
  if (lockfile) writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  if (nodeModules) mkdirSync(path.join(dir, 'node_modules'));
  return dir;
}

// A real, existing file stands in for npm's CLI — decideAction only checks that
// npm_execpath points at something that exists.
const fakeNpm = writeFakeNpm(makeServerDir());

test('importing the script does not run an install', async () => {
  // The module auto-runs only when executed directly. If that guard regresses,
  // importing it here would shell out to npm during the test run.
  const mod = await loadScript();
  assert.equal(typeof mod.decideAction, 'function');
  assert.equal(typeof mod.installMcpDeps, 'function');
});

test('CB_SKIP_MCP_INSTALL=1 disables the installer outright', async () => {
  const { decideAction } = await loadScript();
  const serverDir = makeServerDir();
  assert.equal(
    decideAction({ serverDir, env: { CB_SKIP_MCP_INSTALL: '1', npm_execpath: fakeNpm } }),
    'skip:disabled',
  );
});

test('skips when the nested package is absent (not a full checkout)', async () => {
  const { decideAction } = await loadScript();
  const serverDir = makeServerDir({ pkg: false });
  assert.equal(decideAction({ serverDir, env: { npm_execpath: fakeNpm } }), 'skip:no-package');
});

test('skips when all local dependency entrypoints resolve without executing them', async () => {
  const { decideAction } = await loadScript();
  const serverDir = makeServerDir({ nodeModules: true, lockfile: true });
  writeDependencies(serverDir);
  assert.equal(decideAction({ serverDir, env: { npm_execpath: fakeNpm } }), 'skip:installed');
});

test('skips rather than resolving npm from PATH when npm_execpath is unusable', async () => {
  const { decideAction } = await loadScript();
  const serverDir = makeServerDir({ lockfile: true });
  // Missing entirely.
  assert.equal(decideAction({ serverDir, env: {} }), 'skip:no-npm');
  // Present but pointing at nothing.
  assert.equal(
    decideAction({ serverDir, env: { npm_execpath: path.join(serverDir, 'no-such-npm.js') } }),
    'skip:no-npm',
  );
});

test('prefers `npm ci` when the nested lockfile is present, else `npm install`', async () => {
  const { decideAction } = await loadScript();
  const withLock = makeServerDir({ lockfile: true });
  const withoutLock = makeServerDir({ lockfile: false });
  assert.equal(decideAction({ serverDir: withLock, env: { npm_execpath: fakeNpm } }), 'ci');
  assert.equal(decideAction({ serverDir: withoutLock, env: { npm_execpath: fakeNpm } }), 'install');
});

test('installMcpDeps returns the skip reason without throwing', async () => {
  const { installMcpDeps } = await loadScript();
  const serverDir = makeServerDir({ nodeModules: true });
  writeDependencies(serverDir);
  assert.equal(installMcpDeps({ serverDir, env: { npm_execpath: fakeNpm } }), 'skip:installed');
  // The no-npm path warns; it must still return rather than throw, because a
  // throw here would fail `npm install` for the whole repo.
  assert.equal(
    installMcpDeps({ serverDir: makeServerDir({ lockfile: true }), env: {} }),
    'skip:no-npm',
  );
});

test('the repo really does wire this into prepare', async () => {
  // The script is useless if nothing calls it; this is the regression that
  // would silently reintroduce the original bug.
  const pkg = JSON.parse(
    await import('node:fs/promises').then((fs) => fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')),
  );
  assert.match(pkg.scripts.prepare, /install-mcp-deps\.mjs/);
  assert.equal(pkg.scripts['mcp:install'], 'npm ci --prefix tools/mcp-server');
});

function writeDependencies(serverDir) {
  const modules = path.join(serverDir, 'node_modules');
  for (const [name, exports] of [
    ['@modelcontextprotocol/sdk', {
      './server/mcp.js': { import: './esm/server/mcp.js', require: './cjs/server/mcp.js' },
      './server/stdio.js': { import: './esm/server/stdio.js', require: './cjs/server/stdio.js' },
    }],
    ['zod', { '.': { import: './esm/index.js', require: './cjs/index.js' } }],
  ]) {
    const packageDir = path.join(modules, name);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, exports }));
    for (const entry of Object.values(exports).flatMap(Object.values)) {
      const filename = path.join(packageDir, entry);
      mkdirSync(path.dirname(filename), { recursive: true });
      writeFileSync(filename, 'throw new Error("Dependency code must not execute");');
    }
  }
}

function writeFakeNpm(serverDir, { fail = false } = {}) {
  const filename = path.join(serverDir, 'npm ; touch injected.cjs');
  writeFileSync(filename, `
    const fs = require('node:fs');
    fs.appendFileSync('attempts.jsonl', JSON.stringify({
      argv: process.argv.slice(2), cwd: process.cwd(), node: process.execPath,
    }) + '\\n');
    fs.mkdirSync('node_modules', { recursive: true });
    process.exit(${fail ? 1 : 0});
  `);
  return filename;
}

function runInstaller(serverDir, env) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { installMcpDeps } from ${JSON.stringify(pathToFileURL(scriptPath).href)};
    const action = installMcpDeps(${JSON.stringify({ serverDir, env })});
    console.log('Action: ' + action);
  `], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  return result.stdout + result.stderr;
}

test('an empty node_modules directory retries installation', async () => {
  const { decideAction } = await loadScript();
  const serverDir = makeServerDir({ nodeModules: true, lockfile: true });
  assert.equal(decideAction({ serverDir, env: { npm_execpath: fakeNpm } }), 'ci');
});

for (const entry of ['@modelcontextprotocol/sdk/esm/server/mcp.js', '@modelcontextprotocol/sdk/esm/server/stdio.js', 'zod/esm/index.js']) {
  test(`a missing ESM ${entry} retries despite intact CommonJS entries`, async () => {
    const { decideAction } = await loadScript();
    const serverDir = makeServerDir({ lockfile: true });
    writeDependencies(serverDir);
    rmSync(path.join(serverDir, 'node_modules', entry));
    assert.equal(decideAction({ serverDir, env: { npm_execpath: fakeNpm } }), 'ci');
  });
}

test('hoisted root dependencies cannot mark a nested installation complete', async () => {
  const { decideAction } = await loadScript();
  const root = makeServerDir();
  writeDependencies(root);
  const serverDir = path.join(root, 'tools', 'mcp-server');
  mkdirSync(path.join(serverDir, 'node_modules'), { recursive: true });
  writeFileSync(path.join(serverDir, 'package.json'), '{}');
  assert.equal(decideAction({ serverDir, env: { npm_execpath: fakeNpm } }), 'install');
});

test('dependency symlinks outside the nested installation are not accepted', async () => {
  const { decideAction } = await loadScript();
  const outside = makeServerDir();
  writeDependencies(outside);
  const serverDir = makeServerDir({ lockfile: true });
  symlinkSync(path.join(outside, 'node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  assert.equal(decideAction({ serverDir, env: { npm_execpath: fakeNpm } }), 'ci');
});

test('a failed installer leaves a directory but the next prepare retries nonfatally', () => {
  const serverDir = makeServerDir({ lockfile: true });
  const npm = writeFakeNpm(serverDir, { fail: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = runInstaller(serverDir, { npm_execpath: npm });
    assert.match(output, /Action: ci/);
    assert.doesNotMatch(output, /Done/);
    assert.match(output, /MCP server will not start until this succeeds/);
    assert.match(output, /Retry with: npm run mcp:install/);
    assert.equal(existsSync(path.join(serverDir, 'node_modules')), true);
  }
  const attempts = readFileSync(path.join(serverDir, 'attempts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(attempts.length, 2);
  for (const attempt of attempts) {
    assert.deepEqual(attempt.argv, ['ci', '--no-audit', '--no-fund']);
    assert.equal(attempt.node, process.execPath);
    assert.equal(attempt.cwd, realpathSync(serverDir));
  }
  assert.equal(existsSync(path.join(serverDir, 'injected.cjs')), false);
});

test('successful fake npm uses install without a lockfile and repaired dependencies skip', () => {
  const serverDir = makeServerDir();
  const npm = writeFakeNpm(serverDir);
  assert.match(runInstaller(serverDir, { npm_execpath: npm }), /Action: install/);
  const attempt = JSON.parse(readFileSync(path.join(serverDir, 'attempts.jsonl'), 'utf8'));
  assert.deepEqual(attempt.argv, ['install', '--no-audit', '--no-fund']);
  writeDependencies(serverDir);
  assert.match(runInstaller(serverDir, { npm_execpath: npm }), /Action: skip:installed/);
  assert.equal(readFileSync(path.join(serverDir, 'attempts.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('suppressed and absent package paths never execute npm', () => {
  for (const absent of [false, true]) {
    const serverDir = makeServerDir({ pkg: !absent, nodeModules: true });
    const npm = writeFakeNpm(serverDir);
    const env = absent ? { npm_execpath: npm } : { npm_execpath: npm, CB_SKIP_MCP_INSTALL: '1' };
    assert.match(runInstaller(serverDir, env), absent ? /Action: skip:no-package/ : /Action: skip:disabled/);
    assert.equal(existsSync(path.join(serverDir, 'attempts.jsonl')), false);
  }
});

test('an ESM export pointing at a directory retries installation', async () => {
  const { decideAction } = await loadScript();
  const serverDir = makeServerDir({ lockfile: true });
  writeDependencies(serverDir);
  const entry = path.join(serverDir, 'node_modules/zod/esm/index.js');
  rmSync(entry);
  mkdirSync(entry);
  assert.equal(decideAction({ serverDir, env: { npm_execpath: fakeNpm } }), 'ci');
});

test('malformed dependency metadata selects repair without throwing', async () => {
  const { decideAction } = await loadScript();
  const serverDir = makeServerDir({ lockfile: true });
  writeDependencies(serverDir);
  writeFileSync(path.join(serverDir, 'node_modules/zod/package.json'), '{');
  assert.equal(decideAction({ serverDir, env: { npm_execpath: fakeNpm } }), 'ci');
});

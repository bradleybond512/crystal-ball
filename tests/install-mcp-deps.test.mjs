/**
 * Guards the nested-MCP-dependency installer.
 *
 * The bug this script exists to prevent: tools/mcp-server is its own npm
 * package, the root `npm ci` never installed it, and the MCP server died with
 * ERR_MODULE_NOT_FOUND surfacing only as "CONNECTION_CLOSED". These tests pin
 * the decision logic — especially the skip paths, since a regression there
 * either reintroduces that failure or slows every `npm install`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'install-mcp-deps.mjs');

async function loadScript() {
  assert.equal(existsSync(scriptPath), true, 'install-mcp-deps.mjs should exist');
  return import(pathToFileURL(scriptPath).href);
}

/** Build a throwaway server dir with the requested marker files present. */
function makeServerDir({ pkg = true, nodeModules = false, lockfile = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-deps-'));
  if (pkg) writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
  if (lockfile) writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  if (nodeModules) mkdirSync(path.join(dir, 'node_modules'));
  return dir;
}

// A real, existing file stands in for npm's CLI — decideAction only checks that
// npm_execpath points at something that exists.
const fakeNpm = scriptPath;

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

test('skips when node_modules already exists — the common, must-stay-free path', async () => {
  const { decideAction } = await loadScript();
  const serverDir = makeServerDir({ nodeModules: true, lockfile: true });
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

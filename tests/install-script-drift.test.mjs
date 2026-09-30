// R4-SEC-002 steps 1-2: dependency install scripts are disabled everywhere
// we install, and the drift gate flags new install scripts / commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OVERRIDE_LABEL,
  diffInstallSurface,
  installSurface,
} from '../scripts/check-install-script-drift.mjs';
import { NPM_VERIFICATION_COMMANDS } from '../scripts/sync-main-to-mac.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GATE = path.join(ROOT, 'scripts/check-install-script-drift.mjs');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

function lock(packages) {
  return { name: 'x', lockfileVersion: 3, packages: { '': { name: 'x' }, ...packages } };
}
const BASE = lock({
  'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true, bin: { esbuild: 'bin/esbuild' } },
  'node_modules/lodash': { version: '4.17.21' },
  'node_modules/typescript': { version: '5.9.0', bin: { tsc: 'bin/tsc', tsserver: 'bin/tsserver' } },
});
const diff = (head) => diffInstallSurface(installSurface(BASE), installSurface(head)).findings.map((f) => f.kind);

test('ordinary bumps and version-only changes of bin packages pass', () => {
  const head = structuredClone(BASE);
  head.packages['node_modules/lodash'].version = '4.17.22';
  head.packages['node_modules/typescript'].version = '5.9.1';
  assert.deepEqual(diff(head), []);
});

test('a package that gains an install script is flagged (the worm move)', () => {
  const head = structuredClone(BASE);
  head.packages['node_modules/lodash'] = { version: '4.17.22', hasInstallScript: true };
  assert.deepEqual(diff(head), ['new-install-script']);
  const added = structuredClone(BASE);
  added.packages['node_modules/evil-helper'] = { version: '1.0.0', hasInstallScript: true };
  assert.deepEqual(diff(added), ['new-install-script']);
  const nested = structuredClone(BASE);
  nested.packages['node_modules/vite/node_modules/fsevents'] = { version: '2.3.3', hasInstallScript: true };
  assert.deepEqual(diff(nested), ['new-install-script'], 'nested copies count separately');
});

test('a scripted package changing version is flagged; removing a script passes', () => {
  const bumped = structuredClone(BASE);
  bumped.packages['node_modules/esbuild'].version = '0.28.2';
  assert.deepEqual(diff(bumped), ['scripted-version-change']);
  const removed = structuredClone(BASE);
  delete removed.packages['node_modules/esbuild'].hasInstallScript;
  const result = diffInstallSurface(installSurface(BASE), installSurface(removed));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.removed, ['node_modules/esbuild']);
});

test('new command names are flagged (they can shadow tools our npm scripts call)', () => {
  const gained = structuredClone(BASE);
  gained.packages['node_modules/lodash'].bin = { tsc: 'evil.js' };
  assert.deepEqual(diff(gained), ['new-bin']);
  const extra = structuredClone(BASE);
  extra.packages['node_modules/typescript'].bin.node = 'bin/node';
  assert.deepEqual(diff(extra), ['new-bin']);
  const stringBin = structuredClone(BASE);
  stringBin.packages['node_modules/newcli'] = { version: '1.0.0', bin: 'cli.js' };
  assert.deepEqual(diff(stringBin), ['new-bin']);
});

function gitRepo(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-drift-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(BASE));
  mkdirSync(path.join(dir, 'tools/mcp-server'), { recursive: true });
  writeFileSync(path.join(dir, 'tools/mcp-server/package-lock.json'), JSON.stringify(lock({})));
  git('add', '-A');
  git('commit', '-qm', 'base');
  return {
    dir,
    write(file, value) { writeFileSync(path.join(dir, file), JSON.stringify(value)); },
    run(args, env = {}) {
      const r = spawnSync(process.execPath, [GATE, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, PR_LABELS: '', ...env } });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    },
  };
}

test('CLI: clean PR passes, drift fails, the review label approves, a bad base fails closed', (t) => {
  const repo = gitRepo(t);
  assert.equal(repo.run(['--base', 'HEAD']).status, 0);

  const head = structuredClone(BASE);
  head.packages['node_modules/lodash'] = { version: '4.17.22', hasInstallScript: true };
  repo.write('package-lock.json', head);
  const failed = repo.run(['--base', 'HEAD']);
  assert.equal(failed.status, 1, failed.out);
  assert.match(failed.out, /NEW install script: node_modules\/lodash@4\.17\.22/);
  assert.match(failed.out, /install-scripts-reviewed/);

  assert.equal(repo.run(['--base', 'HEAD'], { PR_LABELS: `bug,${OVERRIDE_LABEL}` }).status, 0);
  assert.equal(repo.run(['--base', 'HEAD', '--labels', 'bug']).status, 1, 'other labels do not approve');
  assert.equal(repo.run(['--base', 'no-such-ref']).status, 2);
});

test('CLI: the MCP server lockfile is gated too', (t) => {
  const repo = gitRepo(t);
  repo.write('tools/mcp-server/package-lock.json', lock({ 'node_modules/zod': { version: '4.0.0', hasInstallScript: true } }));
  const r = repo.run(['--base', 'HEAD']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /tools\/mcp-server\/package-lock\.json: NEW install script: node_modules\/zod/);
});

test('install scripts are disabled for every project we install', () => {
  for (const file of ['.npmrc', 'tools/mcp-server/.npmrc']) {
    assert.match(read(file), /^ignore-scripts=true$/m, `${file} disables install scripts`);
  }
});

test('main-sync and the MCP installers pass --ignore-scripts explicitly (in case .npmrc is removed)', () => {
  const installs = NPM_VERIFICATION_COMMANDS.filter(([command]) => ['ci', 'install', 'i', 'rebuild'].includes(command));
  assert.ok(installs.length > 0);
  for (const args of installs) assert.ok(args.includes('--ignore-scripts'), `main-sync: npm ${args.join(' ')}`);
  assert.match(read('scripts/install-mcp-deps.mjs'), /\[env\.npm_execpath, action, '--ignore-scripts'/);
  assert.match(read('scripts/install-crystalball-mcp.mjs'), /'install',\n[^\]]*'--ignore-scripts',/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['mcp:install'], /npm ci --ignore-scripts /);
  assert.match(read('.github/workflows/smoke.yml'), /cd tools\/mcp-server && npm ci --ignore-scripts &&/);
  assert.match(read('.github/workflows/targeted-tests.yml'), /- run: npm ci --ignore-scripts\n\s+working-directory: tools\/mcp-server/);
});

test('our own scripts do not depend on lifecycle hooks that ignore-scripts would skip', () => {
  const { scripts } = JSON.parse(read('package.json'));
  for (const hook of ['preinstall', 'install', 'postinstall']) {
    assert.equal(hook in scripts, false, `${hook} would silently never run`);
  }
  for (const name of Object.keys(scripts)) {
    for (const prefix of ['pre', 'post']) {
      if (name.startsWith(prefix) && name.slice(prefix.length) in scripts) {
        assert.fail(`${name} is a ${prefix}-hook for "${name.slice(prefix.length)}" and would silently be skipped`);
      }
    }
  }
  assert.match(scripts['desktop:build:full'], /^node scripts\/download-vault-textures\.mjs && node scripts\/desktop-package\.mjs --os macos --variant full && node scripts\/local-install\.mjs$/);
});

test('the drift gate runs in the required integrity-checks job and re-runs on labels', () => {
  const workflow = read('.github/workflows/release-integrity.yml');
  const job = workflow.slice(workflow.indexOf('integrity-checks:'), workflow.indexOf('scenario-coverage:'));
  assert.match(job, /node scripts\/check-install-script-drift\.mjs --base FETCH_HEAD/);
  assert.match(job, /PR_LABELS: \$\{\{ join\(github\.event\.pull_request\.labels\.\*\.name, ','\) \}\}/);
  assert.match(workflow, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
});

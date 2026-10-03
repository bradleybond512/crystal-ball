// R4-SEC-002 step 3: a PR cannot bring in a registry package version younger
// than 7 days without Bradley's label. Registries are faked; git is real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MIN_AGE_DAYS,
  OVERRIDE_LABEL,
  blockingResults,
  cargoRegistryVersions,
  createPublishTimeLookup,
  lookupAges,
  newVersions,
  npmRegistryVersions,
  runAgeGate,
} from '../scripts/check-dependency-age.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 2, 12);
const REG = 'https://registry.npmjs.org';

function npmLock(packages) {
  return { name: 'x', lockfileVersion: 3, packages: { '': { name: 'x' }, ...packages } };
}
const pkg = (name, version) => ({ version, resolved: `${REG}/${name}/-/${name.split('/').pop()}-${version}.tgz` });

function cargoLock(entries) {
  return entries.map(([name, version, source]) => `[[package]]\nname = "${name}"\nversion = "${version}"\n${source ? `source = "${source}"\n` : ''}`).join('\n');
}
const CRATES = 'registry+https://github.com/rust-lang/crates.io-index';

test('npm lockfiles yield registry versions; links, git and bundled entries are listed separately', () => {
  const { versions, skipped } = npmRegistryVersions(npmLock({
    'node_modules/a': pkg('a', '1.0.0'),
    'node_modules/b/node_modules/a': pkg('a', '2.0.0'),
    'node_modules/@scope/c': pkg('@scope/c', '3.1.0'),
    'node_modules/alias': { ...pkg('real', '1.2.3'), name: 'real' },
    'node_modules/linked': { link: true, resolved: 'packages/linked' },
    'node_modules/g': { version: '0.1.0', resolved: 'git+ssh://git@github.com/x/g.git#abc' },
    'node_modules/bundled': { version: '1.0.0', inBundle: true },
    'packages/linked': { version: '0.0.0' },
  }));
  assert.deepEqual([...versions].sort(), ['@scope/c@3.1.0', 'a@1.0.0', 'a@2.0.0', 'real@1.2.3']);
  assert.deepEqual([...skipped].sort(), ['bundled@1.0.0', 'g@0.1.0']);
});

test('Cargo.lock yields crates.io versions; git sources are listed; path crates are ours', () => {
  const { versions, skipped } = cargoRegistryVersions(`version = 4\n\n${cargoLock([
    ['serde', '1.0.229', CRATES],
    ['tokio', '1.48.0', 'sparse+https://index.crates.io/'],
    ['fork', '0.1.0', 'git+https://github.com/x/fork#abc'],
    ['crystal-ball', '2.25.0', null],
  ])}`);
  assert.deepEqual([...versions].sort(), ['serde@1.0.229', 'tokio@1.48.0']);
  assert.deepEqual([...skipped], ['fork@0.1.0']);
});

test('only versions absent from the base count as new', () => {
  assert.deepEqual(newVersions(new Set(['a@1', 'b@1']), new Set(['a@1', 'b@2', 'c@1'])), ['b@2', 'c@1']);
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    const hit = routes[String(url)];
    if (hit === undefined) return new Response('{}', { status: 404 });
    if (hit instanceof Error) throw hit;
    return new Response(JSON.stringify(hit), { status: 200 });
  };
  return { impl, calls };
}

test('publish times come from the npm document (cached) and crates.io (with a User-Agent)', async () => {
  const { impl, calls } = fakeFetch({
    [`${REG}/@scope%2Fc`]: { time: { '3.1.0': new Date(NOW - 10 * DAY).toISOString(), '3.2.0': new Date(NOW - DAY).toISOString() } },
    'https://crates.io/api/v1/crates/serde/1.0.229': { version: { created_at: new Date(NOW - 30 * DAY).toISOString() } },
  });
  const results = await lookupAges([
    { ecosystem: 'npm', spec: '@scope/c@3.1.0', file: 'p' },
    { ecosystem: 'npm', spec: '@scope/c@3.2.0', file: 'p' },
    { ecosystem: 'cargo', spec: 'serde@1.0.229', file: 'c' },
    { ecosystem: 'npm', spec: 'gone@1.0.0', file: 'p' },
    { ecosystem: 'npm', spec: '@scope/c@9.9.9', file: 'p' },
  ], createPublishTimeLookup(impl), NOW);
  assert.deepEqual(results.map((r) => r.ageDays === undefined ? r.error : Math.round(r.ageDays)), [10, 1, 30, 'HTTP 404', 'no publish time']);
  assert.equal(calls.filter((c) => c.url === `${REG}/@scope%2Fc`).length, 1, 'one document per package');
  assert.match(calls.find((c) => c.url.includes('crates.io')).headers['User-Agent'], /crystal-ball/);
});

test('versions under 7 days and unknown versions block; exactly 7 days passes', () => {
  const blocked = blockingResults([
    { spec: 'old@1', ageDays: MIN_AGE_DAYS },
    { spec: 'new@1', ageDays: MIN_AGE_DAYS - 0.01 },
    { spec: 'unknown@1', error: 'HTTP 500' },
    { spec: 'ancient@1', ageDays: 400 },
  ]);
  assert.deepEqual(blocked.map((r) => r.spec), ['new@1', 'unknown@1']);
});

function gitRepo(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-age-'));
  const cwd = process.cwd();
  t.after(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(npmLock({ 'node_modules/a': pkg('a', '1.0.0') })));
  mkdirSync(path.join(dir, 'src-tauri'));
  writeFileSync(path.join(dir, 'src-tauri/Cargo.lock'), cargoLock([['serde', '1.0.228', CRATES]]));
  git('add', '-A');
  git('commit', '-qm', 'base');
  process.chdir(dir);
  return {
    npm(packages) { writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(npmLock(packages))); },
    cargo(entries) { writeFileSync(path.join(dir, 'src-tauri/Cargo.lock'), cargoLock(entries)); },
    mcp(packages) {
      mkdirSync(path.join(dir, 'tools/mcp-server'), { recursive: true });
      writeFileSync(path.join(dir, 'tools/mcp-server/package-lock.json'), JSON.stringify(npmLock(packages)));
    },
  };
}

const ROUTES = {
  [`${REG}/a`]: { time: { '1.0.0': new Date(NOW - 400 * DAY).toISOString(), '1.1.0': new Date(NOW - 2 * DAY).toISOString(), '1.0.1': new Date(NOW - 20 * DAY).toISOString() } },
  'https://crates.io/api/v1/crates/serde/1.0.229': { version: { created_at: new Date(NOW - 3 * DAY).toISOString() } },
};

test('gate: unchanged and old versions pass; a fresh npm or crates.io version fails; the label approves', async (t) => {
  const repo = gitRepo(t);
  const logs = [];
  const run = (labels = []) => runAgeGate({ baseRef: 'HEAD', labels, fetchImpl: fakeFetch(ROUTES).impl, now: NOW, log: (l) => logs.push(l) });

  assert.equal(await run(), 0, 'nothing new');
  assert.ok(logs.some((l) => /no new registry package versions/.test(l)), 'unchanged lockfiles are not looked up at all');
  repo.npm({ 'node_modules/a': pkg('a', '1.0.1') });
  assert.equal(await run(), 0, '20 days old');
  repo.npm({ 'node_modules/a': pkg('a', '1.1.0') });
  assert.equal(await run(), 1, '2 days old');
  assert.ok(logs.some((l) => /a@1\.1\.0 — 2\.0 days old/.test(l)));
  assert.equal(await run([OVERRIDE_LABEL]), 0);

  repo.npm({ 'node_modules/a': pkg('a', '1.0.0') });
  repo.cargo([['serde', '1.0.229', CRATES]]);
  assert.equal(await run(), 1, 'a 3-day-old crate');
  repo.cargo([['serde', '1.0.228', CRATES], ['newcrate', '0.1.0', CRATES]]);
  assert.equal(await run(), 1, 'an unknown crate fails closed');
  repo.cargo([['serde', '1.0.228', CRATES]]);
  assert.equal(await run(), 0);
  repo.mcp({ 'node_modules/a': pkg('a', '1.1.0') });
  assert.equal(await run(), 1, 'the MCP server lockfile is checked too');
});

test('gate: an unreadable base ref fails closed', async (t) => {
  gitRepo(t);
  assert.equal(await runAgeGate({ baseRef: 'no-such-ref', labels: [], fetchImpl: fakeFetch({}).impl, now: NOW, log: () => {} }), 2);
});

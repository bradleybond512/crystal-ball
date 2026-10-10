import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
const { join, relative } = path;
import { MCP_BINS, promotePackage, validateArchiveEntry, validateBins, validateManifest } from './install-crystalball-mcp.mjs';
import { sourceFixture, npmCli } from '../tests/helpers/mcp-runtime-fixture.mjs';

function scenario(t) {
  const fixture = sourceFixture({ packageOnly: true }); t.after(() => fixture.cleanup());
  const prefix = join(fixture.root, 'prefix'); const modules = join(prefix, 'lib/node_modules'); const bin = join(prefix, 'bin');
  const stage = join(modules, '.crystalball-mcp-stage-test'); const staged = join(stage, 'package'); const target = join(modules, 'crystalball-mcp');
  for (const dir of [staged, target, bin]) mkdirSync(dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(fixture.serverRoot, 'package.json'), 'utf8'));
  for (const dir of [staged, target]) writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(staged, 'generation'), 'new'); writeFileSync(join(target, 'generation'), 'old');
  return { fixture, prefix, modules, bin, stage, staged, target, manifest };
}

test('archive admission rejects traversal, links, ignored input and unsafe node types before extraction', () => {
  for (const path of ['package/../outside', '/package/index.mjs', 'outside/index.mjs', 'package/./index.mjs', 'package//index.mjs', String.raw`package\index.mjs`, 'package/.npmrc', 'package/.env.local', 'package/node_modules/a/index.js']) {
    assert.throws(() => validateArchiveEntry({ path, type: 'File', linkpath: '' }), /Unsafe package archive/);
  }
  for (const type of ['SymbolicLink', 'Link', 'FIFO', 'CharacterDevice', 'BlockDevice']) assert.throws(() => validateArchiveEntry({ path: 'package/index.mjs', type }), /Unsafe package archive/);
  assert.throws(() => validateArchiveEntry({ path: 'package/index.mjs', type: 'File', linkpath: '../outside' }), /Unsafe package archive/);
  assert.doesNotThrow(() => validateArchiveEntry({ path: 'package/index.mjs', type: 'File', linkpath: '' }));
});

test('manifest and executable targets reject changed aliases, paths, links and lost modes', (t) => {
  const s = scenario(t); const lock = JSON.parse(readFileSync(join(s.fixture.serverRoot, 'package-lock.json'), 'utf8'));
  validateManifest(s.manifest, lock);
  const changed = structuredClone(s.manifest); changed.bin.crystalball = '../outside';
  assert.throws(() => validateManifest(changed, lock), /identity or bin map/);
  for (const name of Object.values(MCP_BINS)) { writeFileSync(join(s.staged, name), '#!/usr/bin/env node\n'); chmodSync(join(s.staged, name), 0o755); }
  validateBins(s.staged, s.manifest);
  chmodSync(join(s.staged, 'cli.mjs'), 0o644);
  assert.throws(() => validateBins(s.staged, s.manifest), /Invalid executable/);
  rmSync(join(s.staged, 'cli.mjs'));
  const outside = join(s.fixture.root, 'outside-bin.mjs'); writeFileSync(outside, '#!/usr/bin/env node\n'); chmodSync(outside, 0o755);
  symlinkSync(outside, join(s.staged, 'cli.mjs'));
  assert.throws(() => validateBins(s.staged, s.manifest), /Invalid executable/, 'bin symlinks cannot redirect an alias outside the owned package');
});

test('unrelated alias collision leaves its sentinel and the old package untouched', (t) => {
  const s = scenario(t); const alias = join(s.bin, 'crystalball'); writeFileSync(alias, 'unrelated sentinel');
  assert.throws(() => promotePackage(s), /Unrelated command already exists/);
  assert.equal(readFileSync(alias, 'utf8'), 'unrelated sentinel');
  assert.equal(readFileSync(join(s.target, 'generation'), 'utf8'), 'old');
  assert.equal(readFileSync(join(s.staged, 'generation'), 'utf8'), 'new');
});

test('promotion failure restores old package and removes only newly created owned aliases', (t) => {
  const s = scenario(t); const correct = join(s.bin, 'crystalball-mcp'); symlinkSync(relative(s.bin, join(s.target, 'index.mjs')), correct);
  writeFileSync(join(s.bin, 'unrelated-command'), 'keep');
  assert.throws(() => promotePackage({ ...s, afterPromote() { throw new Error('fixture publication failure'); } }), /fixture publication failure/);
  assert.equal(readFileSync(join(s.target, 'generation'), 'utf8'), 'old');
  assert.equal(readFileSync(join(s.staged, 'generation'), 'utf8'), 'new');
  assert.equal(readlinkSync(correct), relative(s.bin, join(s.target, 'index.mjs')));
  assert.deepEqual(readdirSync(s.bin).sort(), ['crystalball-mcp', 'unrelated-command']);
  assert.equal(readFileSync(join(s.bin, 'unrelated-command'), 'utf8'), 'keep');
});

test('genuine failed offline ci preserves old installation, aliases and source bytes and cleans owned staging', { timeout: 60_000 }, (t) => {
  const s = scenario(t);
  // The manually built stage belongs to this oracle, not the real installer.
  const before = readdirSync(s.modules).sort();
  const pkgBefore = readFileSync(join(s.fixture.serverRoot, 'package.json'));
  const lockBefore = readFileSync(join(s.fixture.serverRoot, 'package-lock.json'));
  symlinkSync(relative(s.bin, join(s.target, 'index.mjs')), join(s.bin, 'crystalball-mcp'));
  const result = spawnSync(process.execPath, ['--import', join(s.fixture.repo, 'tests/helpers/loopback-only.mjs'), npmCli(), 'run', 'mcp:install-local', '--', '--prefix', s.prefix, '--no-monitor'], {
    cwd: s.fixture.repo, env: s.fixture.env, encoding: 'utf8', timeout: 50_000,
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /ENOTCACHED|cache mode is.*only-if-cached|Missing.*cache/, 'real npm must fail for absent locked resources');
  assert.equal(readFileSync(join(s.target, 'generation'), 'utf8'), 'old');
  assert.deepEqual(readdirSync(s.modules).sort(), before);
  assert.equal(readlinkSync(join(s.bin, 'crystalball-mcp')), relative(s.bin, join(s.target, 'index.mjs')));
  assert.deepEqual(readFileSync(join(s.fixture.serverRoot, 'package.json')), pkgBefore);
  assert.deepEqual(readFileSync(join(s.fixture.serverRoot, 'package-lock.json')), lockBefore);
  assert.equal(existsSync(join(s.fixture.env.HOME, 'Library/LaunchAgents')), false);
  assert.doesNotMatch(result.stdout, /Installed Crystal Ball agent commands/);
});

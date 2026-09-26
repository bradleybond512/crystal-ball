import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, readlinkSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectProbe, runDoctor } from './claude-auth-doctor.mjs';

const cli = fileURLToPath(new URL('claude-auth-doctor.mjs', import.meta.url));
const sentinel = 'PRIVATE_SENTINEL_9dbadf';
function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), 'claude-doctor-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, '.claude'), { mode: 0o700 });
  writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { token: sentinel } }), { mode: 0o600 });
  writeFileSync(path.join(home, '.claude/.credentials.json'), sentinel, { mode: 0o600 });
  for (const name of ['.claude.json.backup', '.claude.json.tmp1', '.claude.json.lock', '.claude.json.swp']) writeFileSync(path.join(home, name), sentinel);
  writeFileSync(path.join(home, 'target'), sentinel);
  symlinkSync('target', path.join(home, '.claude.json.tmp-link'));
  for (const dir of ['bin1', 'bin2']) {
    mkdirSync(path.join(home, dir));
    for (const executable of ['claude', 'security']) writeFileSync(path.join(home, dir, executable), '#!/bin/sh\n: > "' + home + '/EXECUTED"\n', { mode: 0o700 });
  }
  writeFileSync(path.join(home, '.zshrc'), `export ANTHROPIC_API_KEY=${sentinel}\n: > "${home}/EXECUTED"\n`);
  const env = { HOME: home, PATH: [path.join(home, 'bin1'), path.join(home, 'bin2')].join(path.delimiter), ANTHROPIC_API_KEY: sentinel };
  return { home, env };
}
function snapshot(root) {
  const result = {};
  function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
      const target = path.join(dir, name);
      const stat = lstatSync(target);
      let content = null;
      if (stat.isSymbolicLink()) content = readlinkSync(target);
      else if (stat.isFile()) content = readFileSync(target, 'hex');
      result[path.relative(root, target)] = { mode: stat.mode, uid: stat.uid, gid: stat.gid, mtime: stat.mtimeMs, content };
      if (stat.isDirectory()) visit(target);
    }
  }
  visit(root);
  return result;
}
function capture(args, options) {
  let stdout = '';
  let stderr = '';
  const code = runDoctor(args, { ...options, stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } });
  return { code, stdout, stderr };
}

test('invalid arguments including help with fix are rejected before collection', () => {
  for (const args of [['--fix'], ['--help', '--fix'], ['--json', '--fix'], ['--bad-' + sentinel]]) {
    let collected = false;
    const result = capture(args, { collect: () => { collected = true; throw new Error(sentinel); } });
    assert.equal(collected, false);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Unsupported argument. Use --help for this read-only diagnostic.\n');
  }
});

test('help needs no probe and explains read-only limits', () => {
  for (const args of [['--help'], ['-h']]) {
    const result = capture(args, { collect: () => { throw new Error(sentinel); } });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /read-only/i);
    assert.doesNotMatch(result.stdout, /--fix|PRIVATE_SENTINEL/);
  }
});

test('CLI modes leave synthetic auth files and symlink targets unchanged and never invoke tools', (t) => {
  const { home, env } = fixture(t);
  const before = snapshot(home);
  for (const args of [[], ['--json'], ['--help'], ['-h'], ['--fix'], ['--help', '--fix'], ['--unknown-' + sentinel]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, args.some((a) => a === '--fix' || a.startsWith('--unknown')) ? 2 : 0);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(sentinel));
    assert.ok(!result.stdout.includes(home));
    assert.equal(existsSync(path.join(home, 'EXECUTED')), false);
    assert.deepEqual(snapshot(home), before);
  }
});

test('collector returns presence only and no shell lines or credential data', (t) => {
  const { home, env } = fixture(t);
  const probe = collectProbe({ home, env, platform: 'linux' });
  assert.equal(probe.config.hasOAuthAccount, true);
  assert.deepEqual(probe.envSources, [{ file: '.zshrc', line: 1, variable: 'ANTHROPIC_API_KEY' }]);
  assert.equal(probe.env.ANTHROPIC_API_KEY, true);
  assert.equal(probe.installs.length, 2);
  assert.doesNotMatch(JSON.stringify(probe), /PRIVATE_SENTINEL|: > /);
});

test('malformed configuration is sanitized in the probe, text, and JSON', (t) => {
  const { home, env } = fixture(t);
  writeFileSync(path.join(home, '.claude.json'), sentinel + '{');
  const probe = collectProbe({ home, env, platform: 'linux' });
  assert.equal(probe.config.parseError, true);
  assert.doesNotMatch(JSON.stringify(probe), new RegExp(sentinel));
  for (const args of [[], ['--json']]) {
    const result = capture(args, { home, env, platform: 'linux' });
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(sentinel));
    assert.ok(!result.stdout.includes(home));
  }
});

test('missing, empty, unreadable, and invalid JSON remain distinct', (t) => {
  const { home, env } = fixture(t);
  const config = path.join(home, '.claude.json');
  const expected = [
    ['missing', () => rmSync(config), 'config-missing'],
    ['empty', () => writeFileSync(config, ''), 'config-empty'],
    ['unreadable', () => { rmSync(config); mkdirSync(config); }, 'config-unreadable'],
    ['invalid', () => { rmSync(config, { recursive: true }); writeFileSync(config, '{'); }, 'config-corrupt'],
  ];
  for (const [, arrange, id] of expected) {
    arrange();
    const result = capture(['--json'], { home, env, platform: 'linux' });
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).findings.some((f) => f.id === id), id);
  }
});

test('unexpected collector errors fail safely with no internal details', () => {
  const result = capture([], { collect: () => { throw new Error(sentinel); } });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Diagnostic collection failed. No changes were made.\n');
});

test('oversized configuration is a bounded safe read failure', (t) => {
  const { home, env } = fixture(t);
  writeFileSync(path.join(home, '.claude.json'), sentinel + 'x'.repeat(1024 * 1024));
  const result = capture(['--json'], { home, env, platform: 'linux' });
  assert.equal(result.code, 1);
  assert.ok(JSON.parse(result.stdout).findings.some((f) => f.id === 'config-unreadable'));
  assert.doesNotMatch(result.stdout, new RegExp(sentinel));
});

test('configuration symlink target remains unchanged and a dangling link is unreadable', (t) => {
  const { home, env } = fixture(t);
  const config = path.join(home, '.claude.json');
  rmSync(config);
  writeFileSync(path.join(home, 'target'), '{"oauthAccount":true}');
  symlinkSync('target', config);
  const before = snapshot(home);
  assert.equal(capture(['--json'], { home, env, platform: 'linux' }).code, 0);
  assert.deepEqual(snapshot(home), before);
  rmSync(path.join(home, 'target'));
  const result = capture(['--json'], { home, env, platform: 'linux' });
  assert.equal(result.code, 1);
  assert.ok(JSON.parse(result.stdout).findings.some((f) => f.id === 'config-unreadable'));
});

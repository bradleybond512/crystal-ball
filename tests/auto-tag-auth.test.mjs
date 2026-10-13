import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const realGit = '/usr/bin/git';
const canonical = 'https://github.com/example/project.git';
const syntheticToken = 'fixture-token-not-a-credential';
const expectedHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${syntheticToken}`).toString('base64')}`;
const source = readFileSync(path.join(root, '.github/workflows/auto-tag.yml'), 'utf8');
const step = parse(source).jobs['auto-tag'].steps.find((s) => s.name === 'Create and push tag');

function fixture(t, { token = syntheticToken, origin = canonical, pushUrl, rewrite, extraOrigin, fail = '', tag = 'v1.2.3' } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-auto-tag-auth-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const remote = path.join(dir, 'remote.git');
  const bin = path.join(dir, 'bin');
  for (const p of [repo, bin, path.join(repo, 'scripts')]) mkdirSync(p, { recursive: true });
  const globalConfig = path.join(dir, 'global.config');
  const systemConfig = path.join(dir, 'system.config');
  writeFileSync(globalConfig, '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n');
  writeFileSync(systemConfig, '');
  const env = { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: systemConfig, GIT_TERMINAL_PROMPT: '0' };
  const git = (args) => spawnSync(realGit, args, { cwd: repo, env, encoding: 'utf8' });
  for (const args of [['init', '--quiet'], ['commit', '--allow-empty', '--quiet', '-m', 'fixture'], ['remote', 'add', 'origin', origin], ['init', '--bare', '--quiet', remote]]) {
    const result = git(args);
    assert.equal(result.status, 0, result.stderr);
  }
  if (pushUrl) assert.equal(git(['remote', 'set-url', '--push', 'origin', pushUrl]).status, 0);
  if (rewrite) assert.equal(git(['config', `url.${rewrite}.insteadOf`, 'https://github.com/']).status, 0);
  if (extraOrigin) assert.equal(git(['remote', 'set-url', '--add', 'origin', extraOrigin]).status, 0);
  const initialConfig = readFileSync(path.join(repo, '.git/config'), 'utf8');
  const initialGlobal = readFileSync(globalConfig, 'utf8');
  const initialAuth = git(['config', '--get-regexp', '(extraheader|credential)']).stdout;
  for (const file of ['push-auto-tag.mjs', 'release-metadata.mjs']) {
    const input = path.join(root, 'scripts', file);
    if (existsSync(input)) cpSync(input, path.join(repo, 'scripts', file));
  }
  const log = path.join(dir, 'calls.jsonl');
  // Production uses a fixed Git executable. Redirect it only inside the
  // fixture's helper process, leaving all forwarded Git operations real.
  const preload = path.join(dir, 'fake-git-preload.cjs');
  writeFileSync(preload, String.raw`
if (process.argv[1]?.endsWith('/scripts/push-auto-tag.mjs')) {
  const childProcess = require('node:child_process');
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => original(command === '/usr/bin/git' ? process.env.FIXTURE_FAKE_GIT : command, args, options);
  require('node:module').syncBuiltinESMExports();
}
`);
  writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\n` + String.raw`
const { spawnSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
const push = args.indexOf('push');
const env = process.env;
let headerMatches = false, headers = [];
const commandIndex = args.findIndex((arg) => ['push', 'remote', 'tag'].includes(arg));
const configPrefix = args.slice(0, commandIndex);
const helperValues = spawnSync(env.FIXTURE_REAL_GIT, [...configPrefix, 'config', '--get-all', 'credential.helper'], { env, encoding: 'utf8' }).stdout || '';
const genericHeaders = spawnSync(env.FIXTURE_REAL_GIT, [...configPrefix, 'config', '--get-all', 'http.extraheader'], { env, encoding: 'utf8' }).stdout || '';
if (push >= 0) {
  const r = spawnSync(env.FIXTURE_REAL_GIT, [...args.slice(0, push), 'config', '--get-all', 'http.' + env.FIXTURE_CANONICAL + '.extraheader'], { env, encoding: 'utf8' });
  headers = (r.stdout || '').trim().split('\n').filter(Boolean);
  headerMatches = headers.length === 1 && headers[0] === env.FIXTURE_HEADER;
}
appendFileSync(env.FIXTURE_LOG, JSON.stringify({ args, push: push >= 0, headerMatches, headerCount: headers.length, authPresent: !!env.AUTO_TAG_HTTP_AUTH, rawToken: !!env.GITHUB_TOKEN, trace: Object.keys(env).some((k) => k.startsWith('GIT_TRACE') || k === 'GIT_CURL_VERBOSE'), injectedConfig: !!env.GIT_CONFIG_COUNT || !!env.GIT_CONFIG_PARAMETERS, helperReset: helperValues.endsWith('\n\n') || helperValues === '\n', genericHeadersReset: genericHeaders.trim() === '', promptDisabled: env.GIT_TERMINAL_PROMPT === '0' }) + '\n');
if (push >= 0) {
  if (env.FIXTURE_FAIL) process.exit(Number(env.FIXTURE_FAIL));
  if (!headerMatches || args[push + 1] !== 'origin' || args[push + 2] !== 'refs/tags/' + env.FIXTURE_TAG + ':refs/tags/' + env.FIXTURE_TAG) process.exit(61);
  args[push + 1] = env.FIXTURE_REMOTE; // Fixture transport only; production still addresses the verified origin.
}
const r = spawnSync(env.FIXTURE_REAL_GIT, args, { env, stdio: 'inherit' });
process.exit(r.status ?? 1);
`, { mode: 0o700 });
  const commandEnv = { ...env, TAG: tag, GITHUB_REPOSITORY: 'example/project', GITHUB_TOKEN: token, GIT_TRACE: '1', GIT_CURL_VERBOSE: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: 'Inherited-auth-must-be-cleared', NODE_OPTIONS: `--require=${preload}`, FIXTURE_FAKE_GIT: path.join(bin, 'git'), FIXTURE_REAL_GIT: realGit, FIXTURE_LOG: log, FIXTURE_CANONICAL: canonical, FIXTURE_REMOTE: remote, FIXTURE_HEADER: expectedHeader, FIXTURE_TAG: tag, FIXTURE_FAIL: fail };
  const result = spawnSync('/bin/bash', ['-e', '-c', step.run.replaceAll('${{ steps.version.outputs.tag }}', tag)], { cwd: repo, env: commandEnv, encoding: 'utf8' });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  for (const output of [result.stdout, result.stderr, JSON.stringify(calls.map((c) => c.args))]) {
    assert.equal(output.includes(syntheticToken), false, 'raw token must not enter output or argv');
    assert.equal(output.includes(Buffer.from(`x-access-token:${syntheticToken}`).toString('base64')), false, 'encoded token must not enter output or argv');
  }
  assert.equal(readFileSync(globalConfig, 'utf8'), initialGlobal, 'global config unchanged');
  assert.equal(readFileSync(systemConfig, 'utf8'), '', 'system config unchanged');
  const laterAuth = git(['config', '--get-regexp', '(extraheader|credential)']);
  assert.equal(laterAuth.stdout, initialAuth, 'subsequent child has only its original authentication configuration');
  assert.equal(git(['config', '--get-regexp', 'extraheader']).status, 1, 'no authentication header survives the push');
  // User identity is command-local as well; no helper should write .git/config.
  assert.equal(readFileSync(path.join(repo, '.git/config'), 'utf8'), initialConfig, 'repository config unchanged');
  return { result, calls, git, remote };
}

test('actual auto-tag step uses a token only for the authenticated tag-only push', (t) => {
  assert.equal(step.env.TAG, '${{ steps.version.outputs.tag }}', 'tag arrives through env rather than shell text');
  assert.doesNotMatch(step.run, /\$\{\{/);
  const { result, calls, git, remote } = fixture(t);
  assert.equal(result.status, 0, result.stderr);
  const pushes = calls.filter((c) => c.push);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].headerMatches, true);
  for (const call of calls) {
    assert.equal(call.rawToken, false, 'raw token is stripped before every Git child');
    assert.equal(call.trace, false, 'Git tracing is stripped before every Git child');
    assert.equal(call.injectedConfig, false, 'inherited command config is stripped');
    assert.equal(call.helperReset, true, 'the credential-helper chain is cleared');
    assert.equal(call.genericHeadersReset, true, 'generic extraheader chain is cleared');
    assert.equal(call.promptDisabled, true, 'interactive authentication is disabled');
    assert.equal(call.authPresent, call.push, 'only the push receives the in-memory authentication header');
  }
  assert.equal(git(['--git-dir', remote, 'cat-file', '-t', 'refs/tags/v1.2.3']).stdout.trim(), 'tag', 'annotated tag reached the local remote');
});

test('missing token fails before tag creation or push', (t) => {
  const { result, calls, git } = fixture(t, { token: '' });
  assert.notEqual(result.status, 0);
  assert.equal(calls.some((c) => c.push), false);
  assert.notEqual(git(['rev-parse', '--verify', 'refs/tags/v1.2.3']).status, 0);
});

for (const [label, options] of Object.entries({
  'wrong repository': { origin: 'https://github.com/other/project.git' },
  'credential-bearing URL': { origin: 'https://user:fixture@github.com/example/project.git' },
  'SSH origin': { origin: 'git@github.com:example/project.git' },
  'whitespace-altered origin': { origin: canonical + ' ' },
  'wrong push URL': { pushUrl: 'https://github.com/other/project.git' },
  'rewritten URL': { rewrite: 'https://other.example.invalid/' },
  'multiple origin URLs': { extraOrigin: 'https://github.com/other/project.git' },
})) {
  test(`auto-tag rejects ${label} before tag creation or push`, (t) => {
    const { result, calls, git } = fixture(t, options);
    assert.notEqual(result.status, 0);
    assert.equal(calls.some((c) => c.push), false);
    assert.notEqual(git(['rev-parse', '--verify', 'refs/tags/v1.2.3']).status, 0);
  });
}

test('push failure status propagates from Git through the workflow step', (t) => {
  const { result, calls } = fixture(t, { fail: '37' });
  assert.equal(result.status, 37);
  assert.equal(calls.filter((c) => c.push).length, 1);
});

test('invalid release tag fails closed before any Git operation', (t) => {
  const { result, calls } = fixture(t, { tag: '--all' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(calls, []);
});

test('whitespace-altered tag is rejected rather than silently normalized', (t) => {
  const { result, calls } = fixture(t, { tag: ' v1.2.3' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(calls, []);
});

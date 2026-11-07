import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  commitIsOnRemoteMain,
  readSynchronizedVersions,
  resolveAnnotatedTagCommit,
  resolveReleaseContext,
  selectReleaseSourceCommit,
  validateVersionSync,
} from '../scripts/release-context.mjs';

const mainSha = 'a'.repeat(40);
const tagSha = 'b'.repeat(40);

test('CLI binds build metadata and rejects recovery from an older source commit', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cb-release-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, 'scripts');
  mkdirSync(scripts);
  mkdirSync(join(root, 'src-tauri'));
  for (const file of ['release-context.mjs', 'release-doctor.mjs', 'release-metadata.mjs']) {
    copyFileSync(join(import.meta.dirname, '..', 'scripts', file), join(scripts, file));
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Release Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const writeVersions = (version) => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', version }));
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version }));
    writeFileSync(join(root, 'src-tauri/Cargo.toml'), `[package]\nname = "crystal-ball"\nversion = "${version}"\n`);
    writeFileSync(join(root, 'src-tauri/Cargo.lock'), `[[package]]\nname = "crystal-ball"\nversion = "${version}"\n`);
    writeFileSync(join(root, 'src-tauri/Info.plist'), `<key>CFBundleGetInfoString</key><string>Crystal Ball ${version}</string>`);
  };
  writeVersions('2.7.2');
  git('add', '.');
  git('commit', '-q', '-m', 'release source');
  git('tag', '-a', 'v2.7.2', '-m', 'release fixture');
  const taggedCommit = git('rev-parse', 'v2.7.2^{commit}');
  writeVersions('2.7.3');
  git('add', '.');
  git('commit', '-q', '-m', 'newer main');
  const mainCommit = git('rev-parse', 'HEAD');
  git('tag', '-a', 'v2.7.3', '-m', 'current release fixture');
  git('update-ref', 'refs/remotes/origin/main', mainCommit);
  const run = (...args) => spawnSync(process.execPath, [realpathSync(join(scripts, 'release-context.mjs')), ...args],
    { cwd: root, encoding: 'utf8' });
  const common = ['--event', 'workflow_dispatch', '--ref', 'main', '--variant', 'full', '--sha', mainCommit];
  const build = run(...common, '--publish-mode', 'build', '--release-tag-input', '');
  assert.equal(build.status, 0, build.stderr);
  assert.equal(JSON.parse(build.stdout).commitSha, mainCommit);
  assert.equal(JSON.parse(build.stdout).version, '2.7.3');
  const recovery = run(...common, '--publish-mode', 'publish', '--release-tag-input', 'v2.7.2');
  assert.notEqual(taggedCommit, mainCommit);
  assert.notEqual(recovery.status, 0, recovery.stdout);
  assert.match(recovery.stderr, /Source commit differs from workflow event SHA; refusing misleading provenance/);
  const currentRecovery = run(...common, '--publish-mode', 'publish', '--release-tag-input', 'v2.7.3');
  assert.equal(currentRecovery.status, 0, currentRecovery.stderr);
  assert.equal(JSON.parse(currentRecovery.stdout).commitSha, mainCommit);
  assert.equal(JSON.parse(currentRecovery.stdout).version, '2.7.3');
  const mismatchedPush = run('--event', 'push', '--ref', 'v2.7.2', '--sha', mainCommit);
  assert.notEqual(mismatchedPush.status, 0);
  assert.match(mismatchedPush.stderr, /Tag commit does not match event SHA/);
  const buildWithTag = run(...common, '--publish-mode', 'build', '--release-tag-input', 'v2.7.2');
  assert.notEqual(buildWithTag.status, 0);
  assert.match(buildWithTag.stderr, /release_tag is only valid in publish mode/);
});

test('only an annotated release tag can supply the source commit', () => {
  assert.equal(resolveAnnotatedTagCommit('v2.7.2', (command, args) => {
    assert.equal(command, 'git');
    if (args[0] === 'cat-file') {
      assert.deepEqual(args, ['cat-file', '-t', 'refs/tags/v2.7.2']);
      return 'tag';
    }
    assert.deepEqual(args, ['rev-parse', 'refs/tags/v2.7.2^{commit}']);
    return tagSha;
  }), tagSha);
  assert.throws(() => resolveAnnotatedTagCommit('v2.7.2', () => 'commit'), /must be annotated/);
});

test('every version file is read from the selected immutable source commit', async () => {
  const files = [];
  const versions = await readSynchronizedVersions(tagSha, (sha, file) => {
    assert.equal(sha, tagSha);
    files.push(file);
    return readFileSync(join(import.meta.dirname, '..', file), 'utf8');
  });
  assert.deepEqual(files, ['package.json', 'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/Info.plist']);
  assert.equal(versions.packageVersion, JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version);
});

test('build dispatch pins its event commit and refuses a release tag input', () => {
  assert.equal(selectReleaseSourceCommit({
    event: 'workflow_dispatch', refName: 'main', releaseTagInput: '',
    publishMode: 'build', sha: mainSha,
  }, () => { throw new Error('build mode must not resolve a tag'); }), mainSha);
  assert.throws(() => selectReleaseSourceCommit({
    event: 'workflow_dispatch', refName: 'main', releaseTagInput: 'v2.7.2',
    publishMode: 'build', sha: mainSha,
  }, () => tagSha), /release_tag is only valid in publish mode/);
});

test('publish recovery refuses an older tag instead of misidentifying its source', () => {
  assert.throws(() => selectReleaseSourceCommit({
    event: 'workflow_dispatch', refName: 'main', releaseTagInput: 'v2.7.2',
    publishMode: 'publish', sha: mainSha,
  }, () => tagSha), /Source commit differs from workflow event SHA; refusing misleading provenance/);
  assert.equal(selectReleaseSourceCommit({
    event: 'workflow_dispatch', refName: 'main', releaseTagInput: 'v2.7.2',
    publishMode: 'publish', sha: mainSha,
  }, (tag) => {
    assert.equal(tag, 'v2.7.2');
    return mainSha;
  }), mainSha);
  assert.throws(() => selectReleaseSourceCommit({
    event: 'workflow_dispatch', refName: 'main', releaseTagInput: '',
    publishMode: 'publish', sha: mainSha,
  }, () => tagSha), /Missing release_tag/);
});

test('tag push refuses a tag that resolves to a different commit', () => {
  assert.equal(selectReleaseSourceCommit({
    event: 'push', refName: 'v2.7.2', publishMode: 'build', sha: tagSha,
  }, () => tagSha), tagSha);
  assert.throws(() => selectReleaseSourceCommit({
    event: 'push', refName: 'v2.7.2', publishMode: 'build', sha: mainSha,
  }, () => tagSha), /Tag commit does not match event SHA/);
  assert.throws(() => selectReleaseSourceCommit({
    event: 'push', refName: 'v2.7.2', publishMode: 'build', sha: 'bad',
  }, () => tagSha), /Invalid event SHA/);
  assert.throws(() => selectReleaseSourceCommit({
    event: 'push', refName: 'v2.7.2', publishMode: 'other', sha: tagSha,
  }, () => tagSha), /Unsupported publish mode/);
});

test('release context derives publish metadata from tag pushes', () => {
  assert.deepEqual(
 resolveReleaseContext({
 event: 'push',
 refName: 'refs/tags/v2.7.2-tech',
 packageVersion: '2.7.2',
 sha: 'abcdef1234567890',
 }),
 {
 publish: true,
 variant: 'tech',
 version: '2.7.2',
 tag: 'v2.7.2-tech',
 releaseName: 'Tech Monitor v2.7.2',
 productName: 'Tech Monitor',
 commitSha: 'abcdef1234567890',
 shortSha: 'abcdef123456',
 },
  );
});

test('release context uses build-only mode for workflow dispatch', () => {
  assert.equal(
 resolveReleaseContext({
 event: 'workflow_dispatch',
 inputVariant: 'finance',
 packageVersion: '2.7.2',
 sha: 'abcdef1234567890',
 }).publish,
 false,
  );
});

test('release context validates synchronized versions and origin/main ancestry', () => {
  assert.deepEqual(
 validateVersionSync({
 packageVersion: '2.7.2',
 tauriVersion: '2.7.2',
 cargoVersion: '2.7.2',
 cargoLockVersion: '2.7.2',
 infoPlistVersion: '2.7.2',
 }),
 [],
  );
  assert.equal(commitIsOnRemoteMain('  origin/main\n  origin/feature\n'), true);
  assert.equal(commitIsOnRemoteMain('  origin/release\n'), false);
});

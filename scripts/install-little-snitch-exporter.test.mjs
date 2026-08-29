import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  installLittleSnitchLaunchAgent,
  installRootArtifact,
  ensureUserSupportDirectory,
  littleSnitchInstallPaths,
  LITTLE_SNITCH_CODE_REQUIREMENT,
  LITTLE_SNITCH_PINNED_CLI,
  parseRootArtifactStat,
  quarantineLegacySnapshot,
  readLegacySnapshotNoFollow,
  renderLaunchAgentPlist,
  renderLittleSnitchSudoers,
  resolveStableNodePath,
} from './install-little-snitch-exporter.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

test('renders an unprivileged fixed-argument user LaunchAgent', () => {
  const plist = renderLaunchAgentPlist({
    nodePath: '/opt/homebrew/opt/node@22/bin/node',
    exporterPath: '/Users/me/Library/Application Support/Crystal Ball/bin/export-little-snitch-traffic.mjs',
    logDir: '/Users/me/Library/Logs/Crystal Ball',
  });

  assert.match(plist, /<integer>300<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key>/);
  assert.match(plist, /export-little-snitch-traffic\.mjs/);
  assert.doesNotMatch(plist, /sudo|LaunchDaemon|--output|--input|--no-sudo/);
});

test('replaces a versioned Homebrew Cellar runtime with its stable command path', async () => {
  const checked = [];
  const resolved = await resolveStableNodePath(
    '/opt/homebrew/Cellar/node/26.3.0/bin/node',
    async candidate => { checked.push(candidate); },
  );

  assert.equal(resolved, '/opt/homebrew/bin/node');
  assert.deepEqual(checked, ['/opt/homebrew/bin/node']);
  await assert.rejects(
    resolveStableNodePath('/opt/homebrew/Cellar/node/26.3.0/bin/node', async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }),
    /stable Node\.js runtime is unavailable/,
  );
  assert.throws(() => renderLaunchAgentPlist({
    nodePath: '/opt/homebrew/Cellar/node/26.3.0/bin/node',
    exporterPath: '/exporter',
    logDir: '/logs',
  }), /versioned Homebrew runtime/);
});

test('derives production install paths from the passwd-backed home instead of inherited HOME', () => {
  const moduleUrl = new URL('install-little-snitch-exporter.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { littleSnitchInstallPaths } = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(littleSnitchInstallPaths().supportDir);
  `], {
    encoding: 'utf8',
    env: { ...process.env, HOME: '/Users/attacker-controlled-home' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    path.join(os.userInfo().homedir, 'Library/Application Support/Crystal Ball'),
  );
});

test('renders sudoers authorization for the root-owned no-argument helper only', () => {
  assert.equal(
    renderLittleSnitchSudoers('bradleybond'),
    'bradleybond ALL=(root) NOPASSWD: /usr/local/libexec/crystal-ball-little-snitch-log ""\n',
  );
  assert.throws(() => renderLittleSnitchSudoers('bad user\nroot ALL=(ALL) ALL'), /Invalid/);
});

test('pins the exact Little Snitch signer and identifier', () => {
  assert.equal(
    LITTLE_SNITCH_CODE_REQUIREMENT,
    'identifier littlesnitch and anchor apple generic and certificate leaf[subject.OU] = MLZF7K7B5R',
  );
  assert.equal(LITTLE_SNITCH_PINNED_CLI, '/Library/PrivilegedHelperTools/com.crystalball.littlesnitch-cli');
});

test('stages privileged artifacts through root tee and preserves the verified inode across atomic move', async () => {
  const calls = [];
  const runner = {
    async sudo(args, options = {}) {
      calls.push({ args, options });
      if (args[0] === '/usr/bin/stat') return '0:0:755:4242:Regular File\n';
      return '';
    },
  };
  let verifiedPath = null;
  await installRootArtifact({
    target: '/usr/local/libexec/example-helper',
    contents: Buffer.from('#!/bin/bash\n'),
    mode: '0755',
    runner,
    verify: async temp => { verifiedPath = temp; },
  });

  assert.match(verifiedPath, /^\/usr\/local\/libexec\/\.example-helper\.[a-f0-9]{24}\.tmp$/);
  assert.deepEqual(calls[0].args, ['/usr/bin/tee', verifiedPath]);
  assert.equal(calls[0].options.input.toString(), '#!/bin/bash\n');
  assert.equal(calls[0].options.discardStdout, true);
  assert.ok(calls.some(call => call.args[0] === '/usr/sbin/chown' && call.args.includes('-h')));
  assert.ok(calls.some(call => call.args[0] === '/bin/mv' && call.args.at(-1) === '/usr/local/libexec/example-helper'));
});

test('rejects unsafe privileged artifact stat output', () => {
  assert.deepEqual(parseRootArtifactStat('0:0:755:42:Regular File\n', '0755'), { inode: '42' });
  assert.throws(() => parseRootArtifactStat('501:20:755:42:Regular File\n', '0755'), /unsafe/);
  assert.throws(() => parseRootArtifactStat('0:0:777:42:Regular File\n', '0755'), /unsafe/);
  assert.throws(() => parseRootArtifactStat('0:0:755:42:Symbolic Link\n', '0755'), /unsafe/);
});

test('installs private user-owned artifacts at deterministic paths', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'little-snitch-home-'));
  const sourcePath = path.join(homeDir, 'source.mjs');
  await writeFile(sourcePath, 'process.stdout.write("ok")\n', { mode: 0o600 });

  const paths = await installLittleSnitchLaunchAgent({
    homeDir,
    nodePath: '/usr/bin/node',
    sourcePath,
  });

  assert.deepEqual(paths, littleSnitchInstallPaths(homeDir));
  assert.equal(await readFile(paths.exporterPath, 'utf8'), 'process.stdout.write("ok")\n');
  const exporterStat = await stat(paths.exporterPath);
  const launchAgentStat = await stat(paths.launchAgentPath);
  const launchAgent = await readFile(paths.launchAgentPath, 'utf8');
  assert.equal(exporterStat.mode & 0o777, 0o700);
  assert.equal(launchAgentStat.mode & 0o777, 0o600);
  assert.ok(launchAgent.includes('/usr/bin/node'));
});

test('repairs an existing user support directory to private mode without replacing its inode', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'little-snitch-support-'));
  const supportDir = path.join(homeDir, 'Library/Application Support/Crystal Ball');
  await writeFile(path.join(homeDir, 'marker'), 'x');
  await ensureUserSupportDirectory(supportDir, {
    uid: process.getuid(),
    gid: process.getgid(),
    runner: { sudo: async () => { throw new Error('sudo must not be needed'); } },
  });
  const supportStat = await stat(supportDir);
  assert.equal(supportStat.mode & 0o777, 0o700);
});

test('keeps an existing valid schema-v1 snapshot during an idempotent repair', async () => {
  const supportDir = await mkdtemp(path.join(os.tmpdir(), 'little-snitch-idempotent-'));
  const snapshotPath = path.join(supportDir, 'little-snitch-traffic.json');
  const contents = JSON.stringify({
    schemaVersion: 1,
    available: true,
    generatedAt: new Date().toISOString(),
    entries: [],
  });
  await writeFile(snapshotPath, contents, { mode: 0o600 });
  const result = await quarantineLegacySnapshot(snapshotPath, supportDir, {
    uid: process.getuid(),
    gid: process.getgid(),
    runner: { sudo: async () => { throw new Error('valid snapshot must not use sudo'); } },
  });
  assert.equal(result, null);
  assert.equal(await readFile(snapshotPath, 'utf8'), contents);
});

test('quarantines a readable legacy snapshot privately without privileged home-directory access', async () => {
  const supportDir = await mkdtemp(path.join(os.tmpdir(), 'little-snitch-legacy-'));
  const snapshotPath = path.join(supportDir, 'little-snitch-traffic.json');
  const contents = JSON.stringify({ available: true, entries: [{ remoteHost: 'example.com' }] });
  await writeFile(snapshotPath, contents, { mode: 0o644 });

  const quarantinePath = await quarantineLegacySnapshot(snapshotPath, supportDir, {
    uid: process.getuid(),
    gid: process.getgid(),
    runner: { sudo: async () => { throw new Error('sudo must not access a user-owned directory'); } },
  });

  assert.ok(quarantinePath);
  assert.equal(await readFile(quarantinePath, 'utf8'), contents);
  const quarantineStat = await stat(quarantinePath);
  assert.equal(quarantineStat.uid, process.getuid());
  assert.equal(quarantineStat.gid, process.getgid());
  assert.equal(quarantineStat.mode & 0o777, 0o600);
  await assert.rejects(lstat(snapshotPath), error => error?.code === 'ENOENT');
});

test('rejects a legacy snapshot swapped to a symlink before its no-follow read', async () => {
  const supportDir = await mkdtemp(path.join(os.tmpdir(), 'little-snitch-swap-'));
  const snapshotPath = path.join(supportDir, 'little-snitch-traffic.json');
  const secretPath = path.join(supportDir, 'secret');
  await writeFile(snapshotPath, 'legacy', { mode: 0o600 });
  await writeFile(secretPath, 'must-not-be-read', { mode: 0o600 });
  const expectedStat = await lstat(snapshotPath);
  await rm(snapshotPath);
  await symlink(secretPath, snapshotPath);

  await assert.rejects(
    readLegacySnapshotNoFollow(snapshotPath, expectedStat),
    error => error?.code === 'ELOOP' || /changed during inspection/.test(error?.message),
  );
  assert.equal(await readFile(secretPath, 'utf8'), 'must-not-be-read');
});

test('rejects broad homes and unsafe launch intervals', () => {
  assert.throws(() => littleSnitchInstallPaths('/'), /valid user home/);
  assert.throws(() => renderLaunchAgentPlist({
    nodePath: '/node',
    exporterPath: '/exporter',
    logDir: '/logs',
    intervalSeconds: 10,
  }), /between 60 and 3600/);
});

test('repair script delegates to the hardened installer and never executes Node as root', async () => {
  const repairPath = path.join(scriptsDir, 'repair-little-snitch-exporter.sh');
  const source = await readFile(repairPath, 'utf8');
  const syntax = spawnSync('/bin/bash', ['-n', repairPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(source, /install-little-snitch-exporter\.mjs/);
  assert.match(source, /exec "\$\{NODE_PATH\}" "\$\{INSTALLER\}"/);
  assert.doesNotMatch(source, /sudo\s+(?:\/[^\s]+\/)?node\b/);
  assert.doesNotMatch(source, /bootstrap system/);
});

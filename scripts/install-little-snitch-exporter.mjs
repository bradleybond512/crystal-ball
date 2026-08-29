#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LITTLE_SNITCH_EXPORTER_LABEL = 'com.crystalball.little-snitch-exporter';
export const LITTLE_SNITCH_TEAM_ID = 'MLZF7K7B5R';
export const LITTLE_SNITCH_VENDOR_CLI = '/Applications/Little Snitch.app/Contents/Components/littlesnitch';
export const LITTLE_SNITCH_PINNED_CLI = '/Library/PrivilegedHelperTools/com.crystalball.littlesnitch-cli';
export const LITTLE_SNITCH_ROOT_HELPER = '/usr/local/libexec/crystal-ball-little-snitch-log';
export const LITTLE_SNITCH_SUDOERS = '/etc/sudoers.d/crystal-ball-little-snitch';
export const LITTLE_SNITCH_CODE_REQUIREMENT = 'identifier littlesnitch and anchor apple generic and certificate leaf[subject.OU] = MLZF7K7B5R';

export function littleSnitchInstallPaths(homeDir = os.userInfo().homedir) {
  if (!path.isAbsolute(homeDir) || homeDir === '/') throw new Error('A valid user home directory is required');
  const supportDir = path.join(homeDir, 'Library/Application Support/Crystal Ball');
  return {
    supportDir,
    exporterPath: path.join(supportDir, 'bin/export-little-snitch-traffic.mjs'),
    outputPath: path.join(supportDir, 'little-snitch-traffic.json'),
    baselinePath: path.join(supportDir, 'little-snitch-baseline.json'),
    logDir: path.join(homeDir, 'Library/Logs/Crystal Ball'),
    launchAgentPath: path.join(homeDir, `Library/LaunchAgents/${LITTLE_SNITCH_EXPORTER_LABEL}.plist`),
  };
}

export function renderLaunchAgentPlist({ nodePath, exporterPath, logDir, intervalSeconds = 300 }) {
  if (![nodePath, exporterPath, logDir].every(value => path.isAbsolute(value))) throw new Error('LaunchAgent paths must be absolute');
  if (nodePath.includes('/Cellar/')) throw new Error('LaunchAgent cannot pin a versioned Homebrew runtime');
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 3600) {
    throw new Error('LaunchAgent interval must be between 60 and 3600 seconds');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LITTLE_SNITCH_EXPORTER_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapePlist(nodePath)}</string>
    <string>${escapePlist(exporterPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapePlist(path.join(logDir, 'little-snitch-exporter.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapePlist(path.join(logDir, 'little-snitch-exporter.error.log'))}</string>
</dict>
</plist>
`;
}

export async function resolveStableNodePath(
  execPath = process.execPath,
  accessImpl = candidate => access(candidate, fsConstants.X_OK),
) {
  if (!path.isAbsolute(execPath) || path.basename(execPath) !== 'node') {
    throw new Error('A valid Node.js runtime is required');
  }
  let candidate = execPath;
  if (execPath.startsWith('/opt/homebrew/Cellar/')) candidate = '/opt/homebrew/bin/node';
  else if (execPath.startsWith('/usr/local/Cellar/')) candidate = '/usr/local/bin/node';
  if (candidate.includes('/Cellar/')) throw new Error('A stable Node.js runtime is unavailable');
  try {
    await accessImpl(candidate);
  } catch {
    throw new Error('A stable Node.js runtime is unavailable');
  }
  return candidate;
}

export function renderLittleSnitchSudoers(userName) {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(userName)) throw new Error('Invalid local user name');
  return `${userName} ALL=(root) NOPASSWD: /usr/local/libexec/crystal-ball-little-snitch-log ""\n`;
}

export async function installLittleSnitchLaunchAgent({
  homeDir = os.userInfo().homedir,
  nodePath,
  sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-little-snitch-traffic.mjs'),
} = {}) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    throw new Error('Install the LaunchAgent as the signed-in user, not root');
  }
  const paths = littleSnitchInstallPaths(homeDir);
  const exporterDir = path.dirname(paths.exporterPath);
  const launchAgentDir = path.dirname(paths.launchAgentPath);
  await mkdir(exporterDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.logDir, { recursive: true, mode: 0o700 });
  await mkdir(launchAgentDir, { recursive: true, mode: 0o700 });
  await chmod(exporterDir, 0o700);
  await chmod(paths.logDir, 0o700);
  await chmod(launchAgentDir, 0o700);
  await atomicPrivateWrite(paths.exporterPath, await readBoundedRegularFile(sourcePath, 1024 * 1024));
  await chmod(paths.exporterPath, 0o700);
  const resolvedNodePath = nodePath ?? await resolveStableNodePath();
  const plist = renderLaunchAgentPlist({ nodePath: resolvedNodePath, exporterPath: paths.exporterPath, logDir: paths.logDir });
  await atomicPrivateWrite(paths.launchAgentPath, plist);
  return paths;
}

export async function installLittleSnitchExporter({
  homeDir = os.userInfo().homedir,
  nodePath,
  userName = os.userInfo().username,
  uid = process.getuid?.(),
  gid = process.getgid?.(),
  runner = createCommandRunner(),
} = {}) {
  if (!Number.isInteger(uid) || uid === 0 || !Number.isInteger(gid)) {
    throw new Error('Install Little Snitch integration as the signed-in user');
  }
  const paths = littleSnitchInstallPaths(homeDir);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const helperSource = path.join(scriptDir, 'little-snitch-log-traffic-helper.sh');
  await assertSafeUserDirectory(homeDir, uid);
  const helperContents = await readBoundedRegularFile(helperSource, 128 * 1024);
  const vendorContents = await readBoundedRegularFile(LITTLE_SNITCH_VENDOR_CLI, 16 * 1024 * 1024);
  const sudoersContents = Buffer.from(renderLittleSnitchSudoers(userName), 'utf8');

  await runner.run('/usr/bin/codesign', [
    '--verify', '--strict', '--verbose=2', `-R=${LITTLE_SNITCH_CODE_REQUIREMENT}`, LITTLE_SNITCH_VENDOR_CLI,
  ]);
  await runner.sudo(['-v']);
  await runner.sudo(['/bin/launchctl', 'bootout', `system/${LITTLE_SNITCH_EXPORTER_LABEL}`], { allowFailure: true });
  await runner.sudo(['/bin/rm', '-f', `/Library/LaunchDaemons/${LITTLE_SNITCH_EXPORTER_LABEL}.plist`]);
  await runner.sudo(['/usr/bin/install', '-d', '-o', 'root', '-g', 'wheel', '-m', '0755', '/Library/PrivilegedHelperTools']);
  await runner.sudo(['/usr/bin/install', '-d', '-o', 'root', '-g', 'wheel', '-m', '0755', '/usr/local/libexec']);

  await installRootArtifact({
    target: LITTLE_SNITCH_PINNED_CLI,
    contents: vendorContents,
    mode: '0755',
    runner,
    verify: temp => runner.sudo([
      '/usr/bin/codesign', '--verify', '--strict', '--verbose=2',
      `-R=${LITTLE_SNITCH_CODE_REQUIREMENT}`, temp,
    ]),
  });
  await installRootArtifact({
    target: LITTLE_SNITCH_ROOT_HELPER,
    contents: helperContents,
    mode: '0755',
    runner,
  });
  await installRootArtifact({
    target: LITTLE_SNITCH_SUDOERS,
    contents: sudoersContents,
    mode: '0440',
    runner,
    verify: temp => runner.sudo(['/usr/sbin/visudo', '-cf', temp]),
  });
  await runner.sudo(['/usr/sbin/visudo', '-cf', '/etc/sudoers']);

  await ensureUserSupportDirectory(paths.supportDir, { uid, gid, runner });
  await quarantineLegacySnapshot(paths.outputPath, paths.supportDir, { uid, gid, runner });
  await installLittleSnitchLaunchAgent({ homeDir, nodePath });
  await runner.run('/bin/launchctl', ['bootout', `gui/${uid}/${LITTLE_SNITCH_EXPORTER_LABEL}`], { allowFailure: true });
  await runner.run('/bin/launchctl', ['bootstrap', `gui/${uid}`, paths.launchAgentPath]);
  await runner.run('/bin/launchctl', ['kickstart', '-k', `gui/${uid}/${LITTLE_SNITCH_EXPORTER_LABEL}`]);
  return paths;
}

export async function installRootArtifact({ target, contents, mode, runner, verify }) {
  if (!path.isAbsolute(target) || !Buffer.isBuffer(contents) || !/^(?:0755|0440)$/.test(mode)) {
    throw new Error('Invalid privileged artifact');
  }
  const temporaryPath = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomBytes(12).toString('hex')}.tmp`,
  );
  try {
    await runner.sudo(['/usr/bin/tee', temporaryPath], { input: contents, discardStdout: true });
    await runner.sudo(['/usr/sbin/chown', '-h', 'root:wheel', temporaryPath]);
    await runner.sudo(['/bin/chmod', mode, temporaryPath]);
    const before = parseRootArtifactStat(await runner.sudo([
      '/usr/bin/stat', '-f', '%u:%g:%Lp:%i:%HT', temporaryPath,
    ], { capture: true }), mode);
    if (verify) await verify(temporaryPath);
    const after = parseRootArtifactStat(await runner.sudo([
      '/usr/bin/stat', '-f', '%u:%g:%Lp:%i:%HT', temporaryPath,
    ], { capture: true }), mode);
    if (before.inode !== after.inode) throw new Error('Privileged artifact changed during verification');
    await runner.sudo(['/bin/mv', '-f', temporaryPath, target]);
    const installed = parseRootArtifactStat(await runner.sudo([
      '/usr/bin/stat', '-f', '%u:%g:%Lp:%i:%HT', target,
    ], { capture: true }), mode);
    if (installed.inode !== before.inode) throw new Error('Privileged artifact replacement was not atomic');
  } catch (error) {
    await runner.sudo(['/bin/rm', '-f', temporaryPath], { allowFailure: true });
    throw error;
  }
}

export function parseRootArtifactStat(output, expectedMode) {
  const match = /^(\d+):(\d+):(\d+):(\d+):Regular File\s*$/.exec(String(output));
  if (!match || match[1] !== '0' || match[2] !== '0' || match[3] !== expectedMode.replace(/^0/, '')) {
    throw new Error('Privileged artifact ownership, mode, or type is unsafe');
  }
  return { inode: match[4] };
}

export function createCommandRunner() {
  return {
    run: executeCommand,
    sudo: (args, options) => executeCommand('/usr/bin/sudo', args, options),
  };
}

function executeCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdoutMode = 'inherit';
    if (options.capture) stdoutMode = 'pipe';
    else if (options.discardStdout) stdoutMode = 'ignore';
    const child = spawn(command, args, {
      stdio: [options.input ? 'pipe' : 'inherit', stdoutMode, 'inherit'],
    });
    const output = [];
    child.stdout?.on('data', chunk => output.push(chunk));
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0 || options.allowFailure) resolve(Buffer.concat(output).toString('utf8'));
      else reject(new Error(`${path.basename(command)} failed with exit ${code}`));
    });
    if (options.input) child.stdin.end(options.input);
  });
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export async function quarantineLegacySnapshot(snapshotPath, supportDir, { uid, gid }) {
  let snapshotStat;
  try {
    snapshotStat = await lstat(snapshotPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!snapshotStat.isFile() || snapshotStat.isSymbolicLink()) {
    throw new Error('Legacy Little Snitch snapshot is not a regular file');
  }
  let snapshotContents;
  try {
    snapshotContents = await readLegacySnapshotNoFollow(snapshotPath, snapshotStat);
  } catch (error) {
    if ((error?.code !== 'EACCES' && error?.code !== 'EPERM')
        || snapshotStat.uid !== 0 || (snapshotStat.mode & 0o777) !== 0o600) throw error;
    const quarantinePath = path.join(supportDir, `little-snitch-traffic.legacy-${Date.now()}.json`);
    await rename(snapshotPath, quarantinePath);
    const quarantined = await lstat(quarantinePath);
    if (!quarantined.isFile() || quarantined.isSymbolicLink() || quarantined.uid !== 0
        || (quarantined.mode & 0o777) !== 0o600
        || quarantined.dev !== snapshotStat.dev || quarantined.ino !== snapshotStat.ino) {
      throw new Error('Unreadable legacy snapshot quarantine verification failed');
    }
    return quarantinePath;
  }
  if (snapshotStat.size <= 1024 * 1024) {
    try {
      const snapshot = JSON.parse(snapshotContents);
      if (snapshot?.schemaVersion === 1 && snapshot.available === true
          && typeof snapshot.generatedAt === 'string' && Array.isArray(snapshot.entries)
          && snapshotStat.uid === uid && snapshotStat.gid === gid
          && (snapshotStat.mode & 0o777) === 0o600) return null;
    } catch {
      // Legacy or malformed snapshots are quarantined below.
    }
  }
  const quarantinePath = path.join(supportDir, `little-snitch-traffic.legacy-${Date.now()}.json`);
  await atomicPrivateWrite(quarantinePath, snapshotContents);
  const beforeUnlink = await lstat(snapshotPath);
  if (!beforeUnlink.isFile() || beforeUnlink.isSymbolicLink()
      || beforeUnlink.dev !== snapshotStat.dev || beforeUnlink.ino !== snapshotStat.ino) {
    await rm(quarantinePath, { force: true });
    throw new Error('Legacy snapshot changed during quarantine');
  }
  await rm(snapshotPath);
  const quarantined = await lstat(quarantinePath);
  if (!quarantined.isFile() || quarantined.isSymbolicLink() || quarantined.uid !== uid
      || quarantined.gid !== gid || (quarantined.mode & 0o777) !== 0o600
      || quarantined.size !== snapshotContents.length) {
    throw new Error('Legacy snapshot quarantine verification failed');
  }
  return quarantinePath;
}

export async function readLegacySnapshotNoFollow(snapshotPath, expectedStat, maxBytes = 8 * 1024 * 1024) {
  if (!expectedStat?.isFile?.() || expectedStat.isSymbolicLink?.()
      || !Number.isSafeInteger(expectedStat.size) || expectedStat.size < 1 || expectedStat.size > maxBytes) {
    throw new Error('Legacy snapshot size or type is unsafe');
  }
  let handle;
  try {
    handle = await open(snapshotPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.isSymbolicLink()
        || openedStat.dev !== expectedStat.dev || openedStat.ino !== expectedStat.ino
        || openedStat.size !== expectedStat.size) {
      throw new Error('Legacy snapshot changed during inspection');
    }
    return await handle.readFile();
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function ensureUserSupportDirectory(supportDir, { uid, gid, runner }) {
  let before;
  try {
    before = await lstat(supportDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(supportDir, { recursive: true, mode: 0o700 });
    before = await lstat(supportDir);
  }
  if (!before.isDirectory() || before.isSymbolicLink() || ![0, uid].includes(before.uid)) {
    throw new Error('Crystal Ball support directory ownership or type is unsafe');
  }
  if (before.uid === 0) {
    await runner.sudo(['/usr/sbin/chown', '-h', `${uid}:${gid}`, supportDir]);
  }
  const after = await lstat(supportDir);
  if (!after.isDirectory() || after.isSymbolicLink() || after.uid !== uid || after.gid !== gid
      || after.dev !== before.dev || after.ino !== before.ino) {
    throw new Error('Crystal Ball support directory repair verification failed');
  }
  await chmod(supportDir, 0o700);
}

async function readBoundedRegularFile(filePath, maxBytes) {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size < 1 || fileStat.size > maxBytes) {
    throw new Error(`Unsafe installation source: ${path.basename(filePath)}`);
  }
  return readFile(filePath);
}

async function assertSafeUserDirectory(homeDir, uid) {
  const homeStat = await lstat(homeDir);
  if (!homeStat.isDirectory() || homeStat.isSymbolicLink() || homeStat.uid !== uid) {
    throw new Error('User home directory ownership or type is unsafe');
  }
}

async function atomicPrivateWrite(target, contents) {
  const temporaryPath = `${target}.${process.pid}.${Date.now()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function escapePlist(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('This installer does not accept path or command arguments');
    const paths = await installLittleSnitchExporter();
    process.stdout.write(`Installed ${paths.launchAgentPath}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Little Snitch installer failed'}\n`);
    process.exitCode = 1;
  }
}

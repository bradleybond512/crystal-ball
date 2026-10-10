#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, readdirSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const { dirname, join, resolve, relative, isAbsolute, sep } = path;
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '../tools/mcp-server');
export const MCP_BINS = Object.freeze({
  crystalball: './cli.mjs', 'crystalball-mcp': './index.mjs',
  'crystalball-monitor': './monitor-once.mjs', 'crystalball-monitor-install': './install-monitor.mjs',
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (filename) => JSON.parse(readFileSync(filename, 'utf8'));
function present(filename) {
  try { lstatSync(filename); return true; }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
function contains(parent, child) {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function plainDirectory(directory) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error(`Expected an owned regular directory: ${directory}`);
  }
}
function childDirectory(parent, name) {
  const directory = join(parent, name);
  if (!present(directory)) mkdirSync(directory);
  plainDirectory(directory);
  if (realpathSync(directory) !== directory) throw new Error('Installation directory redirects outside its expected parent.');
  return directory;
}
export function validateManifest(manifest, lock) {
  if (manifest.name !== 'crystalball-mcp' || typeof manifest.version !== 'string'
      || !isDeepStrictEqual(manifest.bin, MCP_BINS)) throw new Error('Unexpected MCP package identity or bin map.');
  if (lock.name !== manifest.name || lock.version !== manifest.version || lock.lockfileVersion !== 3
      || lock.packages?.['']?.name !== manifest.name || lock.packages[''].version !== manifest.version
      || !isDeepStrictEqual(lock.packages[''].dependencies, manifest.dependencies)) throw new Error('Invalid MCP project lock.');
  for (const [name, target] of Object.entries(manifest.bin)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || !/^\.\/[a-z][a-z0-9-]*\.mjs$/.test(target)) throw new Error('Unsafe MCP bin path.');
  }
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (location === '') continue;
    if (!/^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/.test(location)
        || entry.link || !entry.version || !entry.integrity || !entry.resolved) throw new Error(`Unsupported locked package: ${location}`);
  }
}
export function validateArchiveEntry(entry) {
  const name = entry.path;
  if (typeof name !== 'string' || name.includes('\\') || name.includes('\0') || isAbsolute(name)
      || name.split('/').some((part) => part === '..' || part === '.') || name.includes('//')
      || !(name === 'package/' || name.startsWith('package/'))
      || !['File', 'Directory'].includes(entry.type) || entry.linkpath
      || name.split('/').some((part) => ['node_modules', '.git', '.npmrc'].includes(part) || part.startsWith('.env'))) {
    throw new Error(`Unsafe package archive entry: ${name}`);
  }
}
export function validateBins(directory, manifest) {
  for (const target of Object.values(manifest.bin)) {
    const filename = resolve(directory, target);
    const stat = lstatSync(filename);
    if (!contains(directory, filename) || !stat.isFile() || stat.isSymbolicLink() || realpathSync(filename) !== filename
        || !(stat.mode & 0o111)) throw new Error(`Invalid executable MCP bin target: ${target}`);
  }
}
function validateLockedNode(directory, location, entry, installed) {
    for (const key of ['version', 'resolved', 'integrity']) {
      if (installed[key] !== entry[key]) throw new Error(`Installed lock mismatch: ${location} ${key}`);
    }
    let current = directory;
    for (const segment of location.split('/')) { current = join(current, segment); plainDirectory(current); }
    if (!contains(directory, realpathSync(current))) throw new Error(`Dependency escapes the installation: ${location}`);
    if (json(join(current, 'package.json')).version !== entry.version) throw new Error(`Installed package version mismatch: ${location}`);
}
export function validateInstalledGraph(directory, manifest, lock) {
  validateManifest(manifest, lock);
  if (!isDeepStrictEqual(json(join(directory, 'package.json')), manifest)) throw new Error('Packed package manifest changed.');
  const hidden = json(join(directory, 'node_modules/.package-lock.json'));
  const expected = Object.keys(lock.packages).filter(Boolean).sort();
  if (!isDeepStrictEqual(Object.keys(hidden.packages ?? {}).sort(), expected)) throw new Error('Installed dependency graph differs from the committed lock.');
  for (const location of expected) {
    validateLockedNode(directory, location, lock.packages[location], hidden.packages[location]);
  }
  // Compare each existing override's actual node to the unchanged lock, without
  // inventing a replacement semver graph or accepting global resolution.
  for (const name of Object.keys(manifest.overrides ?? {})) {
    const location = `node_modules/${name}`;
    if (!lock.packages[location] || hidden.packages[location]?.version !== lock.packages[location].version) {
      throw new Error(`Missing locked security override: ${name}`);
    }
  }
  function checkLinks(parent) {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const filename = join(parent, entry.name);
      if (entry.isSymbolicLink()) {
        if (!contains(directory, realpathSync(filename))) throw new Error('Dependency link escapes the staged package.');
      } else if (entry.isDirectory()) checkLinks(filename);
    }
  }
  checkLinks(join(directory, 'node_modules'));
  validateBins(directory, manifest);
  for (const file of ['docs', 'tools', 'index.mjs', 'profile.mjs', 'framing.mjs', 'doctor.mjs']) {
    const filename = join(directory, file); const stat = lstatSync(filename);
    if (stat.isSymbolicLink() || !(stat.isFile() || stat.isDirectory())) throw new Error(`Missing packaged MCP resource: ${file}`);
  }
}
function aliasState(bin, target, manifest) {
  const aliases = [];
  for (const [name, entrypoint] of Object.entries(manifest.bin)) {
    const filename = join(bin, name); const expected = resolve(target, entrypoint);
    if (present(filename)) {
      const stat = lstatSync(filename);
      if (!stat.isSymbolicLink() || resolve(bin, readlinkSync(filename)) !== expected) {
        throw new Error(`Unrelated command already exists: ${name}`);
      }
    } else aliases.push({ filename, expected });
  }
  return aliases;
}
// Graceful failure rolls back only this package and links created by this call.
// No claim of crash-atomic publication across node_modules and bin directories.
export function promotePackage({ staged, target, bin, manifest, stage, afterPromote = () => {} }) {
  const aliases = aliasState(bin, target, manifest);
  const backup = join(stage, 'previous-package');
  const created = []; let oldMoved = false; let promoted = false;
  try {
    if (present(target)) {
      plainDirectory(target);
      const previous = json(join(target, 'package.json'));
      if (previous.name !== manifest.name || !isDeepStrictEqual(previous.bin, manifest.bin)) throw new Error('Unexpected existing MCP installation.');
      renameSync(target, backup); oldMoved = true;
    }
    renameSync(staged, target); promoted = true;
    for (const { filename, expected } of aliases) {
      symlinkSync(relative(bin, expected), filename); created.push(filename);
    }
    aliasState(bin, target, manifest);
    afterPromote();
  } catch (error) {
    // If rollback itself fails, retain our stage/backup for explicit recovery.
    try {
      for (const filename of created) rmSync(filename);
      if (promoted) renameSync(target, staged);
      if (oldMoved) renameSync(backup, target);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Installation rollback failed; recovery files retained in ${stage}`);
    }
    throw error;
  }
}
function genuineNpm(npmExec) {
  if (!npmExec) throw new Error('Run this installer through npm run mcp:install-local.');
  const cli = realpathSync(npmExec);
  if (path.basename(cli) !== 'npm-cli.js' || path.basename(dirname(cli)) !== 'bin'
      || json(join(dirname(cli), '../package.json')).name !== 'npm' || !lstatSync(cli).isFile()) throw new Error('Expected the genuine npm CLI.');
  return cli;
}
function packProject(npm, stage, manifest, lockBytes) {
  const tar = createRequire(npm)('tar');
    const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', stage], { cwd: SOURCE, encoding: 'utf8' }));
    if (!Array.isArray(packed) || packed.length !== 1 || packed[0].name !== manifest.name || packed[0].version !== manifest.version
        || packed[0].filename !== `${manifest.name}-${manifest.version}.tgz`
        || !/^[a-z0-9][a-z0-9._-]*\.tgz$/.test(packed[0].filename)) throw new Error('Unexpected npm package archive.');
    const archive = join(stage, packed[0].filename);
    if (!lstatSync(archive).isFile() || realpathSync(archive) !== archive) throw new Error('Package archive redirects outside staging.');
    const archiveBytes = readFileSync(archive);
    if (packed[0].integrity !== `sha512-${createHash('sha512').update(archiveBytes).digest('base64')}`) throw new Error('Packed archive checksum mismatch.');
    const seen = new Set();
    tar.t({ file: archive, sync: true, strict: true, onReadEntry(entry) {
      validateArchiveEntry(entry);
      if (seen.has(entry.path)) throw new Error(`Duplicate archive entry: ${entry.path}`);
      seen.add(entry.path);
    } });
    if (!seen.has('package/package.json')) throw new Error('Archive lacks package manifest.');
    tar.x({ file: archive, cwd: stage, sync: true, strict: true, noMtime: true, filter(name, entry) { validateArchiveEntry(entry); return true; } });
    const staged = join(stage, 'package'); plainDirectory(staged);
    if (!isDeepStrictEqual(json(join(staged, 'package.json')), manifest)) throw new Error('Packed manifest differs from source.');
    validateBins(staged, manifest);
    copyFileSync(join(SOURCE, 'package-lock.json'), join(staged, 'package-lock.json'));
    if (digest(readFileSync(join(staged, 'package-lock.json'))) !== digest(lockBytes)) throw new Error('Source lock changed during staging.');
  return staged;
}
export function installMcp({ prefix, npmExec, noMonitor = false }) {
  const npm = genuineNpm(npmExec);
  const manifestBytes = readFileSync(join(SOURCE, 'package.json'));
  const lockBytes = readFileSync(join(SOURCE, 'package-lock.json'));
  const manifest = JSON.parse(manifestBytes); const lock = JSON.parse(lockBytes);
  validateManifest(manifest, lock);
  mkdirSync(prefix, { recursive: true }); plainDirectory(prefix); prefix = realpathSync(prefix);
  const lib = childDirectory(prefix, 'lib'); const modules = childDirectory(lib, 'node_modules'); const bin = childDirectory(prefix, 'bin');
  const target = join(modules, manifest.name);
  aliasState(bin, target, manifest);
  if (present(target)) {
    plainDirectory(target);
    const previous = json(join(target, 'package.json'));
    if (previous.name !== manifest.name || !isDeepStrictEqual(previous.bin, manifest.bin)) throw new Error('Unexpected existing MCP installation.');
  }
  const stage = mkdtempSync(join(modules, '.crystalball-mcp-stage-'));
  let retainRecovery = false; let failure;
  try {
    const staged = packProject(npm, stage, manifest, lockBytes);
    execFileSync(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: staged, stdio: 'inherit' });
    if (digest(readFileSync(join(staged, 'package-lock.json'))) !== digest(lockBytes)
        || digest(readFileSync(join(SOURCE, 'package-lock.json'))) !== digest(lockBytes)
        || digest(readFileSync(join(SOURCE, 'package.json'))) !== digest(manifestBytes)) throw new Error('MCP manifest or lock changed during installation.');
    validateInstalledGraph(staged, manifest, lock);
    try {
      promotePackage({ staged, target, bin, manifest, stage, afterPromote() {
        if (process.platform === 'darwin' && !noMonitor) {
          execFileSync(process.execPath, [join(target, 'install-monitor.mjs')], { stdio: 'inherit' });
        }
      } });
    } catch (error) { retainRecovery = error instanceof AggregateError; throw error; }
    console.log(`Installed Crystal Ball agent commands in ${bin}.`);
  } catch (error) { failure = error; throw error; }
  finally {
    if (!retainRecovery) {
      try { rmSync(stage, { recursive: true, force: true }); }
      catch (cleanupError) {
        if (failure) throw new AggregateError([failure, cleanupError], 'Installation failed and owned staging cleanup also failed.');
        throw cleanupError;
      }
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prefixIndex = process.argv.indexOf('--prefix');
  if (prefixIndex !== -1 && !process.argv[prefixIndex + 1]) throw new Error('--prefix requires a directory path.');
  const prefix = prefixIndex === -1 ? join(homedir(), '.local') : resolve(process.argv[prefixIndex + 1]);
  installMcp({ prefix, npmExec: process.env.npm_execpath, noMonitor: process.argv.includes('--no-monitor') });
}

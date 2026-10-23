#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseIdentity } from './release-metadata.mjs';

export function verifyDesktopConfig({ variant, version, repoRoot = process.cwd() }) {
  const identity = assertReleaseIdentity({ variant, version });
  const base = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const override = JSON.parse(readFileSync(path.join(repoRoot, identity.config), 'utf8'));
  const effective = { ...base, ...override };
  if (effective.productName !== identity.productName || effective.identifier !== identity.identifier || effective.version !== version) {
    throw new Error('Tauri config does not match the allowlisted native identity: ' + variant);
  }
  return identity;
}

function checkedRun(runCapture, command, args) {
  const result = runCapture(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || String(result.stderr || command + ' failed').trim());
  }
  return String(result.stdout || '').replace(/\r?\n$/, '');
}

function regularPath(filePath, directory = false) {
  const info = lstatSync(filePath);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
    throw new Error('Expected a regular ' + (directory ? 'directory' : 'file') + ', not a symbolic link: ' + filePath);
  }
  return info;
}

function assertFresh(info, builtAfter, filePath) {
  if (builtAfter !== undefined && (!Number.isFinite(builtAfter) || info.mtimeMs < builtAfter)) {
    throw new Error('Stale desktop output; use a fresh build output directory: ' + filePath);
  }
}

export function verifyMacApp({ appPath, variant, version, tag, builtAfter, runCapture = spawnSync }) {
  const identity = assertReleaseIdentity({ variant, version, tag });
  regularPath(appPath, true);
  if (path.basename(appPath) !== identity.productName + '.app') throw new Error('App basename mismatch: ' + appPath);
  regularPath(path.join(appPath, 'Contents'), true);
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  assertFresh(regularPath(plist), builtAfter, plist);
  const read = key => checkedRun(runCapture, '/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
  if (read('CFBundleName') !== identity.productName) throw new Error('App product name mismatch: ' + appPath);
  if (read('CFBundleIdentifier') !== identity.identifier) throw new Error('App identifier mismatch: ' + appPath);
  if (read('CFBundleShortVersionString') !== version) throw new Error('App version mismatch: ' + appPath);
  return { productName: identity.productName, identifier: identity.identifier, version };
}

function assertOnlyExpectedApp(directory, productName) {
  regularPath(directory, true);
  const apps = readdirSync(directory).filter(name => name.toLowerCase().endsWith('.app'));
  if (apps.length !== 1 || apps[0] !== productName + '.app') {
    throw new Error('Unexpected macOS app output in ' + directory + ': ' + apps.join(', '));
  }
}

function verifyDmg(dmgPath, options) {
  const { runCapture = spawnSync, builtAfter } = options;
  assertFresh(regularPath(dmgPath), builtAfter, dmgPath);
  const beforeHash = createHash('sha256').update(readFileSync(dmgPath)).digest('hex');
  const mountPoint = mkdtempSync(path.join(os.tmpdir(), 'desktop-identity-'));
  let mounted = false;
  let nativeIdentity;
  try {
    checkedRun(runCapture, '/usr/bin/hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-readonly', '-nobrowse', '-quiet']);
    mounted = true;
    const { productName } = assertReleaseIdentity(options);
    assertOnlyExpectedApp(mountPoint, productName);
    nativeIdentity = verifyMacApp({ ...options, builtAfter: undefined, appPath: path.join(mountPoint, productName + '.app') });
  } finally {
    // Never recursively remove a mount point whose detach failed.
    if (mounted) {
      checkedRun(runCapture, '/usr/bin/hdiutil', ['detach', mountPoint, '-quiet']);
      mounted = false;
    }
    if (!mounted) rmSync(mountPoint, { recursive: true, force: true });
  }
  const sha256 = createHash('sha256').update(readFileSync(dmgPath)).digest('hex');
  if (sha256 !== beforeHash) throw new Error('DMG changed during identity verification: ' + dmgPath);
  return { path: dmgPath, sha256, nativeIdentity };
}

export function verifyMacBundle(options) {
  const identity = assertReleaseIdentity(options);
  regularPath(options.bundleRoot, true);
  const appDir = path.join(options.bundleRoot, 'macos');
  assertOnlyExpectedApp(appDir, identity.productName);
  const appPath = path.join(appDir, identity.productName + '.app');
  const measured = verifyMacApp({ ...options, appPath });
  const dmgs = [];
  if (options.includeDmg) {
    const dmgDir = path.join(options.bundleRoot, 'dmg');
    regularPath(dmgDir, true);
    const names = readdirSync(dmgDir).filter(name => name.toLowerCase().endsWith('.dmg'));
    const prefixes = [identity.productName + '_', identity.productName.replaceAll(' ', '.') + '_'];
    if (names.length !== 1 || !prefixes.some(prefix => names[0].startsWith(prefix + options.version + '_'))) {
      throw new Error('Unexpected or mixed DMG outputs in ' + dmgDir + ': ' + names.join(', '));
    }
    dmgs.push(verifyDmg(path.join(dmgDir, names[0]), options));
  }
  return { ...measured, variant: options.variant, appPath, dmgs };
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  const fields = new Map([['--bundle-root', 'bundleRoot'], ['--variant', 'variant'], ['--version', 'version'], ['--tag', 'tag'], ['--built-after', 'builtAfter']]);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--include-dmg') { options.includeDmg = true; continue; }
    if (args[i] === '--config-only') { options.configOnly = true; continue; }
    const key = fields.get(args[i]);
    if (!key || !args[i + 1]) throw new Error('Unknown or incomplete identity argument: ' + args[i]);
    options[key] = args[++i];
  }
  if (options.configOnly) {
    console.log(JSON.stringify(verifyDesktopConfig(options)));
    return;
  }
  if (!options.bundleRoot || !options.variant || !options.version) throw new Error('Identity check requires --bundle-root, --variant and --version');
  if (options.builtAfter !== undefined) options.builtAfter = Number(options.builtAfter);
  console.log(JSON.stringify(verifyMacBundle(options)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error('[desktop-identity] ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

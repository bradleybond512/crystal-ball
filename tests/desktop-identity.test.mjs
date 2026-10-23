import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getDesktopIdentity } from '../scripts/release-metadata.mjs';
import { verifyMacApp, verifyMacBundle, verifyDesktopConfig } from '../scripts/check-desktop-identity.mjs';

const version = '2.25.147';
const freshAt = Date.now() - 5_000;

function fixture(t, variant = 'tech') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-identity-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundleRoot = path.join(root, 'bundle');
  const identity = getDesktopIdentity(variant);
  function app(directory, overrides = {}, productName = identity.productName) {
    const appPath = path.join(directory, productName + '.app');
    mkdirSync(path.join(appPath, 'Contents'), { recursive: true });
    writeFileSync(path.join(appPath, 'Contents', 'Info.plist'), JSON.stringify({
      CFBundleName: productName,
      CFBundleIdentifier: identity.identifier,
      CFBundleShortVersionString: version,
      ...overrides,
    }));
    return appPath;
  }
  const appPath = app(path.join(bundleRoot, 'macos'));
  const dmgPath = path.join(bundleRoot, 'dmg', identity.productName + '_' + version + '_aarch64.dmg');
  mkdirSync(path.dirname(dmgPath), { recursive: true });
  writeFileSync(dmgPath, 'fixture disk image');
  let mountedIdentity = {};
  let mountedName = identity.productName;
  const commands = [];
  const runCapture = (command, args) => {
    commands.push([command, args]);
    if (command === '/usr/bin/plutil') {
      const data = JSON.parse(readFileSync(args.at(-1), 'utf8'));
      return { status: data[args[1]] === undefined ? 1 : 0, stdout: data[args[1]] ?? '', stderr: '' };
    }
    if (command === '/usr/bin/hdiutil' && args[0] === 'attach') {
      app(args[args.indexOf('-mountpoint') + 1], mountedIdentity, mountedName);
      return { status: 0 };
    }
    if (command === '/usr/bin/hdiutil' && args[0] === 'detach') return { status: 0 };
    throw new Error('Unexpected fixture command: ' + command);
  };
  return { bundleRoot, appPath, dmgPath, app, runCapture, commands, setMountedIdentity: value => { mountedIdentity = value; }, setMountedName: value => { mountedName = value; } };
}

test('each approved native override agrees with the shared allowlist and preserves the base identity', () => {
  const base = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  for (const variant of ['full', 'tech', 'finance']) {
    const identity = getDesktopIdentity(variant);
    const config = { ...base, ...JSON.parse(readFileSync(new URL('../' + identity.config, import.meta.url), 'utf8')) };
    assert.equal(config.productName, identity.productName);
    assert.equal(config.identifier, identity.identifier);
    assert.equal(config.mainBinaryName, 'crystalball');
    assert.equal(config.version, base.version);
    assert.equal(verifyDesktopConfig({ variant, version: base.version }).identifier, identity.identifier);
  }
  assert.equal(base.identifier, 'com.bradleybond.crystalball');
  assert.throws(() => getDesktopIdentity('../full'), /Unsupported release variant/);
});

test('pre-build validation rejects a config carrying a different native identity or version', t => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'desktop-config-test-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repoRoot, 'src-tauri'));
  writeFileSync(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version }));
  for (const override of [
    { productName: 'Tech Monitor', identifier: 'com.bradleybond.crystalball' },
    { productName: 'Crystal Ball', identifier: 'com.bradleybond.crystalball.tech' },
    { productName: 'Tech Monitor', identifier: 'com.bradleybond.crystalball.tech', version: '2.25.146' },
  ]) {
    writeFileSync(path.join(repoRoot, 'src-tauri', 'tauri.tech.conf.json'), JSON.stringify(override));
    assert.throws(() => verifyDesktopConfig({ variant: 'tech', version, repoRoot }), /config does not match/);
  }
});

for (const variant of ['full', 'tech', 'finance']) {
  test('the real packaging entry point passes the native config and frontend variant for ' + variant, t => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-package-config-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const bin = path.join(root, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'src-tauri'));
    for (const script of ['desktop-package.mjs', 'desktop-signing.mjs', 'release-metadata.mjs', 'check-desktop-identity.mjs']) {
      copyFileSync(new URL('../scripts/' + script, import.meta.url), path.join(root, 'scripts', script));
    }
    for (const name of ['tauri.conf.json', 'tauri.tech.conf.json', 'tauri.finance.conf.json']) {
      copyFileSync(new URL('../src-tauri/' + name, import.meta.url), path.join(root, 'src-tauri', name));
    }
    const packageVersion = JSON.parse(readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', version: packageVersion }));
    writeFileSync(path.join(root, 'scripts', 'sync-desktop-version.mjs'), 'process.exitCode = 0;\n');
    const log = path.join(root, 'tauri-args.json');
    const stub = path.join(bin, 'tauri-fixture.mjs');
    writeFileSync(stub, 'import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.TAURI_ARGS_FILE, JSON.stringify({ args: process.argv.slice(2), variant: process.env.VITE_VARIANT }));\n');
    const tauriPath = path.join(bin, process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
    writeFileSync(tauriPath, process.platform === 'win32'
      ? '@"' + process.execPath + '" "' + stub + '" %*\r\n'
      : '#!' + process.execPath + '\n' + readFileSync(stub, 'utf8'), { mode: 0o755 });
    // Windows packaging skips macOS signing/mounting. The Tauri executable and
    // version synchronizer are inert fixtures, and runtime downloads are off.
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'desktop-package.mjs'), '--os', 'windows', '--variant', variant, '--skip-node-runtime'], {
      cwd: root, env: { TAURI_ARGS_FILE: log }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    const observed = JSON.parse(readFileSync(log, 'utf8'));
    assert.equal(observed.variant, variant);
    assert.deepEqual(observed.args, ['build', '--bundles', 'nsis,msi', '--config', getDesktopIdentity(variant).config]);
  });
}

for (const variant of ['full', 'tech', 'finance']) {
  test('measures the app and mounted DMG identity for ' + variant, t => {
    const f = fixture(t, variant);
    const measured = verifyMacBundle({ ...f, variant, version, builtAfter: freshAt, includeDmg: true });
    assert.equal(measured.identifier, getDesktopIdentity(variant).identifier);
    assert.equal(measured.dmgs.length, 1);
    assert.equal(measured.dmgs[0].nativeIdentity.identifier, measured.identifier);
    assert.match(measured.dmgs[0].sha256, /^[a-f0-9]{64}$/);
    assert.ok(f.commands.find(([, args]) => args.includes('-readonly')));
    assert.ok(f.commands.find(([, args]) => args[0] === 'detach'));
  });
}

test('a renamed full DMG payload cannot pass a tech release identity gate', t => {
  const f = fixture(t);
  f.setMountedIdentity({ CFBundleIdentifier: 'com.bradleybond.crystalball' });
  assert.throws(() => verifyMacBundle({ ...f, variant: 'tech', version, includeDmg: true }), /identifier mismatch/);
  assert.ok(f.commands.find(([, args]) => args[0] === 'detach'), 'failed payload checks still detach');
});

for (const name of ['Crystal Ball', 'CrystalBall']) {
  test('a tech-named DMG cannot contain the full app ' + name, t => {
    const f = fixture(t);
    f.setMountedName(name);
    f.setMountedIdentity({ CFBundleIdentifier: 'com.bradleybond.crystalball' });
    assert.throws(() => verifyMacBundle({ ...f, variant: 'tech', version, includeDmg: true }), /Unexpected macOS app/);
    assert.ok(f.commands.find(([, args]) => args[0] === 'detach'));
  });
}

test('stale DMGs are rejected before mounting', t => {
  const f = fixture(t);
  utimesSync(f.dmgPath, new Date(0), new Date(0));
  assert.throws(() => verifyMacBundle({ ...f, variant: 'tech', version, builtAfter: freshAt, includeDmg: true }), /Stale/);
  assert.equal(f.commands.some(([command]) => command === '/usr/bin/hdiutil'), false);
});

test('wrong version, wrong product name, stale output and symlinked apps are rejected', t => {
  const f = fixture(t);
  const inspect = overrides => f.app(path.join(f.bundleRoot, 'macos'), overrides);
  inspect({ CFBundleShortVersionString: '2.25.146' });
  assert.throws(() => verifyMacApp({ ...f, variant: 'tech', version }), /version mismatch/);
  inspect({ CFBundleName: 'Crystal Ball' });
  assert.throws(() => verifyMacApp({ ...f, variant: 'tech', version }), /product name mismatch/);
  inspect();
  const plist = path.join(f.appPath, 'Contents', 'Info.plist');
  utimesSync(plist, new Date(0), new Date(0));
  assert.throws(() => verifyMacApp({ ...f, variant: 'tech', version, builtAfter: freshAt }), /Stale/);
  const link = path.join(path.dirname(f.appPath), 'linked.app');
  symlinkSync(f.appPath, link);
  assert.throws(() => verifyMacApp({ ...f, appPath: link, variant: 'tech', version }), /symbolic link|basename mismatch/);
});

for (const wrongName of ['Crystal Ball.app', 'CrystalBall.app', 'Finance Monitor.app']) {
  test('successive variant outputs cannot reuse a mixed app directory: ' + wrongName, t => {
    const f = fixture(t);
    mkdirSync(path.join(f.bundleRoot, 'macos', wrongName));
    assert.throws(() => verifyMacBundle({ ...f, variant: 'tech', version }), /Unexpected macOS app/);
  });
}

test('a tag suffix must agree with the selected native identity', t => {
  const f = fixture(t);
  assert.throws(() => verifyMacBundle({ ...f, variant: 'tech', version, tag: 'v' + version + '-finance' }), /tag.*identity/i);
});

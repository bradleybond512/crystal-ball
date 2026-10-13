#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import nodeOs from 'node:os';
import path from 'node:path';
import { resolveStableIdentity, signLocalMacApp, stableIdentityRequired } from './desktop-signing.mjs';

const args = process.argv.slice(2);

const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return args[index + 1];
};

const hasFlag = (name) => args.includes(`--${name}`);

const targetOs = getArg('os');
const variant = getArg('variant') || 'full';
const sign = hasFlag('sign');
const appOnly = hasFlag('app-only');
const skipNodeRuntime = hasFlag('skip-node-runtime');
const showHelp = hasFlag('help') || hasFlag('h');
// Product banner per variant. Must match packaging targets emitted by the
// Tauri build so the expected app bundle name resolves cleanly.
const variantProductName = {
  full: 'Crystal Ball',
  tech: 'Tech Monitor',
  finance: 'Finance Monitor',
}[variant];

const validOs = new Set(['macos', 'windows', 'linux']);
const validVariant = /^(full|tech|finance)$/.test(variant);

if (showHelp) {
  console.log('Usage: npm run desktop:package -- --os <macos|windows|linux> --variant <full|tech|finance> [--sign] [--app-only] [--skip-node-runtime] [--require-stable-identity]');
  process.exit(0);
}

if (!validOs.has(targetOs) || !validVariant) {
  console.error('Usage: npm run desktop:package -- --os <macos|windows|linux> --variant <full|tech|finance> [--sign] [--app-only] [--skip-node-runtime] [--require-stable-identity]');
  process.exit(1);
}

if (appOnly && targetOs !== 'macos') {
  console.error('--app-only is only supported for macOS packaging.');
  process.exit(1);
}

if (appOnly && sign) {
  console.error('--app-only cannot be combined with --sign.');
  process.exit(1);
}

const syncVersionsResult = spawnSync(process.execPath, ['scripts/sync-desktop-version.mjs'], {
  stdio: 'inherit'
});
if (syncVersionsResult.error) {
  console.error(syncVersionsResult.error.message);
  process.exit(1);
}
if ((syncVersionsResult.status ?? 1) !== 0) {
  process.exit(syncVersionsResult.status ?? 1);
}

// eslint-disable-next-line sonarjs/no-nested-conditional
const bundles = targetOs === 'macos' ? (sign ? 'app,dmg' : 'app') : (targetOs === 'linux' ? 'appimage' : 'nsis,msi'); // NOSONAR
const env = {
  ...process.env,
  VITE_VARIANT: variant,
  VITE_DESKTOP_RUNTIME: '1',
};
const cliArgs = ['build', '--bundles', bundles];
const tauriBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');

if (!existsSync(tauriBin)) {
  console.error(
 `Local Tauri CLI not found at ${tauriBin}. Run \"npm ci\" to install dependencies before desktop packaging.`
  );
  process.exit(1);
}

const resolveNodeTarget = () => {
  if (env.NODE_TARGET) return env.NODE_TARGET;
  if (targetOs === 'windows') return 'x86_64-pc-windows-msvc';
  if (targetOs === 'linux') return 'x86_64-unknown-linux-gnu';
  if (targetOs === 'macos') {
 if (process.arch === 'arm64') return 'aarch64-apple-darwin';
 if (process.arch === 'x64') return 'x86_64-apple-darwin';
  }
  return '';
};

if (sign) {
  if (targetOs === 'macos') {
 const hasIdentity = Boolean(env.TAURI_BUNDLE_MACOS_SIGNING_IDENTITY || env.APPLE_SIGNING_IDENTITY);
 const hasProvider = Boolean(env.TAURI_BUNDLE_MACOS_PROVIDER_SHORT_NAME);
 if (!hasIdentity || !hasProvider) {
 console.error(
 'Signing requested (--sign) but missing macOS signing env vars. Set TAURI_BUNDLE_MACOS_SIGNING_IDENTITY (or APPLE_SIGNING_IDENTITY) and TAURI_BUNDLE_MACOS_PROVIDER_SHORT_NAME.'
 );
 process.exit(1);
 }
  }

  if (targetOs === 'windows') {
 const hasThumbprint = Boolean(env.TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT);
 const hasPfx = Boolean(env.TAURI_BUNDLE_WINDOWS_CERTIFICATE && env.TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD);
 if (!hasThumbprint && !hasPfx) {
 console.error(
 'Signing requested (--sign) but missing Windows signing env vars. Set TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT or TAURI_BUNDLE_WINDOWS_CERTIFICATE + TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD.'
 );
 process.exit(1);
 }
  }
}

if (!skipNodeRuntime) {
  const nodeTarget = resolveNodeTarget();
  if (!nodeTarget) {
 console.error(
 `Unable to infer Node runtime target for OS=${targetOs} ARCH=${process.arch}. Set NODE_TARGET explicitly or pass --skip-node-runtime.`
 );
 process.exit(1);
  }
  console.log(
 `[desktop-package] Bundling Node runtime TARGET=${nodeTarget} VERSION=${env.NODE_VERSION ?? '22.14.0'}`
  );
  const downloadResult = spawnSync('bash', ['scripts/download-node.sh', '--target', nodeTarget], { // eslint-disable-line sonarjs/no-os-command-from-path
 env: {
 ...env,
 NODE_TARGET: nodeTarget
 },
 stdio: 'inherit',
 shell: process.platform === 'win32'
  });
  if (downloadResult.error) {
 console.error(downloadResult.error.message);
 process.exit(1);
  }
  if ((downloadResult.status ?? 1) !== 0) {
 process.exit(downloadResult.status ?? 1);
  }
}

// Vendor a self-contained wgrib2 for the HRRR-Smoke decoder. NON-fatal by
// design: it only builds on a macOS host whose arch matches the target and
// self-skips (exit 0) otherwise. Even a hard failure must not block the desktop
// build — the decoder is an optional upgrade that fails closed to Open-Meteo, so
// we warn and continue rather than exit. The binary is never vendored unless it
// passed the script's own otool -L self-containment gate.
if (!skipNodeRuntime && targetOs === 'macos') {
  console.log('[desktop-package] Vendoring wgrib2 (HRRR-Smoke decoder, optional)');
  const wgrib2Result = spawnSync('bash', ['scripts/vendor-wgrib2.sh'], { // eslint-disable-line sonarjs/no-os-command-from-path
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (wgrib2Result.error) {
    console.warn(`[desktop-package] wgrib2 vendor step could not run: ${wgrib2Result.error.message} — continuing without HRRR (Open-Meteo fallback).`);
  } else if ((wgrib2Result.status ?? 1) !== 0) {
    console.warn(`[desktop-package] wgrib2 vendor step exited ${wgrib2Result.status} — continuing without HRRR (Open-Meteo fallback).`);
  }
}

console.log(`[desktop-package] OS=${targetOs} VARIANT=${variant} BUNDLES=${bundles} SIGN=${sign ? 'on' : 'off'}`);

const result = spawnSync(tauriBin, cliArgs, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

const run = (command, args, options = {}) => {
  const child = spawnSync(command, args, {
 env,
 stdio: 'inherit',
 shell: process.platform === 'win32',
 ...options,
  });
  if (child.error) {
 throw child.error;
  }
  if ((child.status ?? 1) !== 0) {
 throw new Error(`${command} exited with status ${child.status ?? 1}`);
  }
};

const runCapture = (command, args, options = {}) =>
  spawnSync(command, args, {
 env,
 encoding: 'utf8',
 shell: process.platform === 'win32',
 ...options,
  });

const verifyMacCodeSignature = (artifactPath, label, args = ['--verify', '--deep', '--strict']) => {
  const result = runCapture('codesign', [...args, artifactPath]);
  if ((result.status ?? 1) !== 0) {
 const error = new Error(
 (result.stderr || result.stdout || '').trim() || `${label} codesign verification failed`
 );
 error.result = result;
 throw error;
  }
};

const ensureModernMacLaunchServicesPlist = (appPath, allowMutation) => {
  if (process.platform !== 'darwin') return;
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  const printResult = runCapture('/usr/libexec/PlistBuddy', ['-c', 'Print :LSRequiresCarbon', plistPath]);
  const currentValue = (printResult.stdout || '').trim();
  if (currentValue === 'false' || currentValue === '') return;
  if (!allowMutation) {
    throw new Error('App bundle Info.plist still has LSRequiresCarbon=true; fix src-tauri/Info.plist before signing.');
  }
  let result = runCapture('/usr/libexec/PlistBuddy', ['-c', 'Set :LSRequiresCarbon false', plistPath]);
  if ((result.status ?? 1) !== 0) {
    result = runCapture('/usr/libexec/PlistBuddy', ['-c', 'Add :LSRequiresCarbon bool false', plistPath]);
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || 'Failed to clear LSRequiresCarbon in app bundle');
  }
};

if (targetOs === 'macos') {
  const bundleRoot = path.join('src-tauri', 'target', 'release', 'bundle');
  const appDir = path.join(bundleRoot, 'macos');
  const dmgDir = path.join(bundleRoot, 'dmg');
  const appName = `${variantProductName}.app`;
  const appPath = path.join(appDir, appName);
  if (!existsSync(appPath)) {
 const discoveredApps = readdirSync(appDir).filter((entry) => entry.endsWith('.app'));
 console.error(
 `[desktop-package] Expected ${appName} in ${appDir}, found: ${discoveredApps.join(', ') || '(none)'}`
 );
 process.exit(1);
  }

  const bundleVersion = env.npm_package_version;
  const archSuffix = process.arch === 'arm64' ? 'aarch64' : process.arch;
  const dmgPath = path.join(dmgDir, `${variantProductName}_${bundleVersion}_${archSuffix}.dmg`);
  ensureModernMacLaunchServicesPlist(appPath, !sign);

  // Stable local signing (R3-SEC-003 phase A): see scripts/desktop-signing.mjs.
  // `--require-stable-identity` (or CRYSTALBALL_REQUIRE_STABLE_IDENTITY=1, which
  // main-sync sets) makes a failed stable signature fatal instead of falling
  // back to ad hoc. `--options runtime` matches tauri.conf `hardenedRuntime:
  // true`. The bundled Node keeps the Node.js Foundation's own signature and
  // entitlements (Resources aren't re-signed), and our binary needs no
  // unsigned executable memory (R3-SEC-008: only allow-jit remains).
  if (sign) {
 // Tauri already signed with the developer identity; just verify.
 try {
 verifyMacCodeSignature(appPath, 'App bundle');
 } catch (error) {
 console.error(`[desktop-package] Signed app bundle failed verification: ${error.message}`);
 process.exit(1);
 }
  } else {
 const entitlementsPath = path.join('src-tauri', 'Entitlements.plist');
 try {
 signLocalMacApp({
 appPath,
 stableIdentity: resolveStableIdentity(process.env),
 required: stableIdentityRequired(args, process.env),
 entitlementsPath: existsSync(entitlementsPath) ? entitlementsPath : null,
 run,
 verify: verifyMacCodeSignature,
 });
 } catch (error) {
 console.error(`[desktop-package] ${error.message}`);
 process.exit(1);
 }
  }

  if (appOnly) {
 process.exit(0);
  }

  if (sign) {
 if (!existsSync(dmgPath)) {
 console.error(`[desktop-package] Expected signed DMG output at ${dmgPath}`);
 process.exit(1);
 }
 verifyMacCodeSignature(dmgPath, 'DMG artifact', ['--verify', '--strict']);
  } else {
 mkdirSync(dmgDir, { recursive: true });
 rmSync(dmgPath, { force: true });
 run('hdiutil', ['create', '-volname', variantProductName, '-srcfolder', appPath, '-ov', '-format', 'UDZO', dmgPath]);
  }

  const mountPoint = mkdtempSync(path.join(nodeOs.tmpdir(), 'desktop-package-dmg-'));
  try {
 run('hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse', '-readonly', '-quiet']);
 verifyMacCodeSignature(path.join(mountPoint, appName), 'Mounted app bundle');
  } finally {
 const detach = runCapture('hdiutil', ['detach', mountPoint, '-quiet']);
 if ((detach.status ?? 1) !== 0) {
 console.error((detach.stderr || detach.stdout || '').trim());
 }
 rmSync(mountPoint, { recursive: true, force: true });
  }
}

process.exit(0);

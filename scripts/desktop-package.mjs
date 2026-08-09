#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import nodeOs from 'node:os';
import path from 'node:path';

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
  console.log('Usage: npm run desktop:package -- --os <macos|windows|linux> --variant <full|tech|finance> [--sign] [--app-only] [--skip-node-runtime]');
  process.exit(0);
}

if (!validOs.has(targetOs) || !validVariant) {
  console.error('Usage: npm run desktop:package -- --os <macos|windows|linux> --variant <full|tech|finance> [--sign] [--app-only] [--skip-node-runtime]');
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

  // A stable local signing identity (a self-signed code-signing cert the
  // developer creates once) keeps the app's designated requirement constant
  // across rebuilds. macOS keys keychain ACLs and Location Services (TCC) grants
  // off that requirement, so signing every local build with the same identity
  // means "Always Allow" / location are granted ONCE and persist — instead of
  // re-prompting after every rebuild like an ad-hoc signature does (each ad-hoc
  // build gets a new cdhash, which resets both). Applied to ALL local builds
  // (not just when tauri's signature fails verification) so the identity is
  // never silently skipped.
  // Default to the well-known local dev identity so a developer only has to
  // create the "Crystal Ball Dev" self-signed cert once — no env var needed.
  // Override with CRYSTALBALL_SIGN_IDENTITY. `--options runtime` matches
  // tauri.conf `hardenedRuntime: true`; the sidecar's V8 JIT is covered by the
  // allow-jit entitlements in Entitlements.plist.
  const DEFAULT_LOCAL_SIGN_IDENTITY = 'Crystal Ball Dev';
  const stableIdentity = (process.env.CRYSTALBALL_SIGN_IDENTITY || DEFAULT_LOCAL_SIGN_IDENTITY).trim();
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
 const hasEntitlements = existsSync(entitlementsPath);
 let stableSigned = false;
 if (stableIdentity) {
 try {
 console.log(`[desktop-package] Signing macOS app bundle with stable identity "${stableIdentity}" (hardened runtime) — keychain/location grants persist across rebuilds`);
 run('codesign', [
 '--force',
 '--deep',
 '--options',
 'runtime',
 '--sign',
 stableIdentity,
 ...(hasEntitlements ? ['--entitlements', entitlementsPath] : []),
 appPath,
 ]);
 verifyMacCodeSignature(appPath, 'App bundle');
 stableSigned = true;
 } catch (error) {
 const bar = '='.repeat(78);
 console.warn(`\n${bar}\n[desktop-package] ⚠️  STABLE SIGNING FAILED — falling back to AD-HOC.\n  Identity "${stableIdentity}" not found in the keychain (or codesign error:\n  ${error.message}).\n  Ad-hoc builds get a NEW cdhash every rebuild, so macOS RE-PROMPTS for all\n  ~29 keychain keys AND re-asks for Location Services after each install.\n  Fix (one-time): create a self-signed "Crystal Ball Dev" Code Signing cert in\n  Keychain Access (Certificate Assistant → Create a Certificate), then rebuild.\n${bar}\n`);
 }
 }
 if (!stableSigned) {
 // Ad-hoc fallback (unchanged behavior). Keep the codesign flags as an
 // inline array literal — the desktop-package-signing.test.mjs regression
 // test grep-matches on the literal flag sequence so any dynamic
 // `signArgs.push()` style hides the intent from the contract check.
 console.log('[desktop-package] Re-signing macOS app bundle with ad-hoc signature for local packaging');
 run('codesign', [
 '--force',
 '--deep',
 '--sign',
 '-',
 ...(hasEntitlements ? ['--entitlements', entitlementsPath] : []),
 appPath,
 ]);
 verifyMacCodeSignature(appPath, 'App bundle');
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

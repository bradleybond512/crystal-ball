// Local macOS app signing (R3-SEC-003 phase A, approved by Bradley on 2026-10-03).
//
// A stable self-signed identity ("Crystal Ball Dev") keeps the app's
// designated requirement constant across rebuilds, so Keychain "Always Allow"
// and Location grants persist. An ad-hoc signature changes every rebuild,
// which re-prompts for the Keychain and is what made the shadow vault seem
// necessary. Interactive builds may still fall back to ad hoc; a build that
// requires the stable identity (main-sync) fails instead.

export const DEFAULT_LOCAL_SIGN_IDENTITY = 'Crystal Ball Dev';
export const REQUIRE_STABLE_FLAG = '--require-stable-identity';
export const REQUIRE_STABLE_ENV = 'CRYSTALBALL_REQUIRE_STABLE_IDENTITY';
export const SIGNING_GUIDE = 'docs/guides/crystal-ball-dev-signing-identity.md';

export class StableSigningRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StableSigningRequiredError';
  }
}

/** True when this build must not fall back to an ad-hoc signature. */
export function stableIdentityRequired(argv = [], env = {}) {
  return argv.includes(REQUIRE_STABLE_FLAG) || env[REQUIRE_STABLE_ENV] === '1';
}

/** The identity to sign with: CRYSTALBALL_SIGN_IDENTITY, else the default. */
export function resolveStableIdentity(env = {}) {
  return String(env.CRYSTALBALL_SIGN_IDENTITY || DEFAULT_LOCAL_SIGN_IDENTITY).trim();
}

/**
 * Sign a locally built macOS app bundle. `run(command, args)` and
 * `verify(path, label)` throw on failure. Returns 'stable' or 'adhoc'; throws
 * StableSigningRequiredError instead of falling back when `required`.
 */
export function signLocalMacApp({
  appPath,
  stableIdentity,
  required,
  entitlementsPath = null,
  run,
  verify,
  log = console.log,
  warn = console.warn,
}) {
  const entitlements = entitlementsPath ? ['--entitlements', entitlementsPath] : [];
  if (stableIdentity) {
    try {
      log(`[desktop-package] Signing macOS app bundle with stable identity "${stableIdentity}" (hardened runtime) — keychain/location grants persist across rebuilds`);
      run('codesign', ['--force', '--deep', '--options', 'runtime', '--sign', stableIdentity, ...entitlements, appPath]);
      verify(appPath, 'App bundle');
      return 'stable';
    } catch (error) {
      if (required) {
        throw new StableSigningRequiredError(
          `Stable signing with "${stableIdentity}" failed and this build requires it, so it stops instead of signing ad hoc (${error.message}). See ${SIGNING_GUIDE}.`,
        );
      }
      const bar = '='.repeat(78);
      warn(`\n${bar}\n[desktop-package] ⚠️  STABLE SIGNING FAILED — falling back to AD-HOC.\n  Identity "${stableIdentity}" not found in the keychain (or codesign error:\n  ${error.message}).\n  Ad-hoc builds get a NEW cdhash every rebuild, so macOS RE-PROMPTS for the\n  keychain AND re-asks for Location Services after each install.\n  Fix (one-time): see ${SIGNING_GUIDE}, then rebuild.\n${bar}\n`);
    }
  } else if (required) {
    throw new StableSigningRequiredError(`No signing identity is configured and this build requires one. See ${SIGNING_GUIDE}.`);
  }
  // Ad-hoc fallback for interactive builds. Keep the codesign flags as an
  // inline array literal — tests/desktop-package-signing.test.mjs matches the
  // literal flag sequence.
  log('[desktop-package] Re-signing macOS app bundle with ad-hoc signature for local packaging');
  run('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    ...entitlements,
    appPath,
  ]);
  verify(appPath, 'App bundle');
  return 'adhoc';
}

/**
 * Classify `codesign -dv --verbose=2 <app>` output (codesign prints it on
 * stderr): ad hoc, signed by a named authority, or unknown. Mirrors
 * `classify_codesign_details` in src-tauri/src/main.rs.
 */
export function classifyCodesignDetails(output) {
  const text = String(output ?? '');
  if (/^Signature=adhoc$/m.test(text)) return { kind: 'adhoc', authority: null };
  const authority = text.match(/^Authority=(.+)$/m)?.[1]?.trim();
  if (authority) return { kind: 'stable', authority };
  return { kind: 'unknown', authority: null };
}

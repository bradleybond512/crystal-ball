// R3-SEC-003 phase A: a build that requires the stable identity fails instead
// of falling back to an ad-hoc signature; interactive builds keep the fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_LOCAL_SIGN_IDENTITY,
  REQUIRE_STABLE_ENV,
  REQUIRE_STABLE_FLAG,
  SIGNING_GUIDE,
  StableSigningRequiredError,
  classifyCodesignDetails,
  resolveStableIdentity,
  signLocalMacApp,
  stableIdentityRequired,
} from '../scripts/desktop-signing.mjs';

const root = path.resolve(import.meta.dirname, '..');

function fakeSigner({ stableFails = false, verifyFails = false } = {}) {
  const calls = [];
  const warnings = [];
  return {
    calls,
    warnings,
    options: {
      appPath: '/build/Crystal Ball.app',
      entitlementsPath: 'src-tauri/Entitlements.plist',
      run: (command, args) => {
        calls.push([command, ...args].join(' '));
        if (stableFails && args.includes('runtime')) throw new Error('no identity found');
      },
      verify: (target, label) => {
        calls.push(`verify ${label}`);
        if (verifyFails) throw new Error('invalid signature');
      },
      log: () => {},
      warn: (message) => warnings.push(message),
    },
  };
}

test('the stable identity is required by flag or by the main-sync environment variable', () => {
  assert.equal(stableIdentityRequired([], {}), false);
  assert.equal(stableIdentityRequired(['--os', 'macos', REQUIRE_STABLE_FLAG], {}), true);
  assert.equal(stableIdentityRequired([], { [REQUIRE_STABLE_ENV]: '1' }), true);
  assert.equal(stableIdentityRequired([], { [REQUIRE_STABLE_ENV]: '0' }), false);
  assert.equal(REQUIRE_STABLE_FLAG, '--require-stable-identity');
  assert.equal(REQUIRE_STABLE_ENV, 'CRYSTALBALL_REQUIRE_STABLE_IDENTITY');
});

test('the identity defaults to Crystal Ball Dev and can be overridden', () => {
  assert.equal(DEFAULT_LOCAL_SIGN_IDENTITY, 'Crystal Ball Dev');
  assert.equal(resolveStableIdentity({}), 'Crystal Ball Dev');
  assert.equal(resolveStableIdentity({ CRYSTALBALL_SIGN_IDENTITY: '  Other Cert ' }), 'Other Cert');
});

test('a stable signature is used when it works, required or not', () => {
  for (const required of [false, true]) {
    const signer = fakeSigner();
    assert.equal(signLocalMacApp({ ...signer.options, stableIdentity: 'Crystal Ball Dev', required }), 'stable');
    assert.deepEqual(signer.calls, [
      'codesign --force --deep --options runtime --sign Crystal Ball Dev --entitlements src-tauri/Entitlements.plist /build/Crystal Ball.app',
      'verify App bundle',
    ]);
  }
});

test('an interactive build falls back to ad hoc with a warning', () => {
  const signer = fakeSigner({ stableFails: true });
  assert.equal(signLocalMacApp({ ...signer.options, stableIdentity: 'Crystal Ball Dev', required: false }), 'adhoc');
  assert.equal(signer.calls.at(-2), 'codesign --force --deep --sign - --entitlements src-tauri/Entitlements.plist /build/Crystal Ball.app');
  assert.match(signer.warnings.join('\n'), /STABLE SIGNING FAILED/);
  assert.ok(signer.warnings.join('\n').includes(SIGNING_GUIDE));
});

test('a build that requires the stable identity stops instead of signing ad hoc', () => {
  for (const fault of [{ stableFails: true }, { verifyFails: true }]) {
    const signer = fakeSigner(fault);
    assert.throws(
      () => signLocalMacApp({ ...signer.options, stableIdentity: 'Crystal Ball Dev', required: true }),
      (error) => error instanceof StableSigningRequiredError && error.message.includes(SIGNING_GUIDE),
    );
    assert.equal(signer.calls.some((call) => call.includes('--sign -')), false, 'no ad-hoc signature');
  }
  const unnamed = fakeSigner();
  assert.throws(() => signLocalMacApp({ ...unnamed.options, stableIdentity: '', required: true }), StableSigningRequiredError);
  assert.deepEqual(unnamed.calls, []);
});

test('codesign details classify as ad hoc, stable or unknown', () => {
  assert.deepEqual(classifyCodesignDetails('Identifier=x\nSignature=adhoc\n'), { kind: 'adhoc', authority: null });
  assert.deepEqual(classifyCodesignDetails('Authority=Crystal Ball Dev\nSigned Time=now\n'), { kind: 'stable', authority: 'Crystal Ball Dev' });
  assert.deepEqual(classifyCodesignDetails('code object is not signed at all'), { kind: 'unknown', authority: null });
  assert.deepEqual(classifyCodesignDetails(undefined), { kind: 'unknown', authority: null });
});

test('desktop-package wires the requirement and exits non-zero when signing stops', () => {
  const pkg = readFileSync(path.join(root, 'scripts/desktop-package.mjs'), 'utf8');
  assert.match(pkg, /import \{ resolveStableIdentity, signLocalMacApp, stableIdentityRequired \} from '\.\/desktop-signing\.mjs';/);
  assert.match(pkg, /required: stableIdentityRequired\(args, process\.env\),/);
  assert.match(pkg, /signLocalMacApp\(\{[\s\S]*?\}\);\s*\} catch \(error\) \{\s*console\.error\(`\[desktop-package\] \$\{error\.message\}`\);\s*process\.exit\(1\);/);
  assert.doesNotMatch(pkg, /'--sign',\s*'-'/, 'the ad-hoc fallback lives only in desktop-signing.mjs');
});

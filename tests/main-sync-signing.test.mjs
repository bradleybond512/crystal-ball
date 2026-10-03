// R3-SEC-003 phase A: main-sync builds with the stable identity required and
// refuses to install an app that is not stable-signed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as syncMainToMac from '../scripts/sync-main-to-mac.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('every main-sync build command runs with the stable identity required', () => {
  const toolchain = syncMainToMac.buildMainSyncToolchain('/opt/node22/bin/node', { PATH: '/usr/bin:/bin' });
  assert.equal(toolchain.env.CRYSTALBALL_REQUIRE_STABLE_IDENTITY, '1');
  const calls = [];
  syncMainToMac.runVerificationAndBuild('/tmp/repo', toolchain, (...args) => calls.push(args));
  assert.ok(calls.some(([, args]) => args.join(' ') === 'run desktop:build:app:full'));
  for (const [, , options] of calls) assert.equal(options.env.CRYSTALBALL_REQUIRE_STABLE_IDENTITY, '1');
});

test('only a stable-signed app passes the install check', () => {
  const stable = syncMainToMac.assertStableSignedApp('/x/Crystal Ball.app', () => 'Authority=Crystal Ball Dev\n');
  assert.deepEqual(stable, { kind: 'stable', authority: 'Crystal Ball Dev' });
  assert.throws(() => syncMainToMac.assertStableSignedApp('/x.app', () => 'Signature=adhoc\n'), /ad hoc signed; refusing to install/);
  assert.throws(() => syncMainToMac.assertStableSignedApp('/x.app', () => ''), /not signed with a stable identity; refusing to install/);
});

test('the install step checks the signature before hashing and installing', () => {
  const sync = readFileSync(path.join(root, 'scripts/sync-main-to-mac.mjs'), 'utf8');
  const install = sync.slice(sync.indexOf('async function installBuiltApp('), sync.indexOf('async function main()'));
  const check = install.indexOf('assertStableSignedApp(appPath);');
  assert.ok(check > install.indexOf('await verifyAppBundle(appPath);'));
  assert.ok(check < install.indexOf('await hashDirectory(appPath)'));
  assert.ok(check < install.indexOf("'install-built-app.mjs'"));
  assert.match(sync, /throw new SyncBlockedError\(`Built app is \$\{what\}; refusing to install it\./, 'a blocked run, not a crash');
});

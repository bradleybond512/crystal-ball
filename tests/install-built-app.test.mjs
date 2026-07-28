import test from 'node:test';
import assert from 'node:assert/strict';

import * as installer from '../scripts/install-built-app.mjs';

const {
  buildSwapPaths,
  getInfoPlistPath,
  parseArgs,
} = installer;

test('install-built-app derives deterministic staged and backup paths', () => {
  assert.deepEqual(
 buildSwapPaths('/Users/bradleybond/Applications/Crystal Ball.app'),
 {
 parent: '/Users/bradleybond/Applications',
 staged: '/Users/bradleybond/Applications/Crystal Ball.app.main-sync-staged',
 backup: '/Users/bradleybond/Applications/Crystal Ball.app.main-sync-backup',
 },
  );
});

test('install-built-app resolves Info.plist path for macOS bundle validation', () => {
  assert.equal(
 getInfoPlistPath('/Users/bradleybond/Applications/Crystal Ball.app'),
 '/Users/bradleybond/Applications/Crystal Ball.app/Contents/Info.plist',
  );
});

test('install-built-app parses separated and inline CLI options', () => {
  assert.deepEqual(
 parseArgs([
   '--app',
   '/tmp/source.app',
   '--install-path=/tmp/destination.app',
   '--sha256',
   'abc123',
   '--relaunch',
   '--local-sha=def456',
   '--state-file',
   '/tmp/state.json',
 ]),
 {
   appPath: '/tmp/source.app',
   installPath: '/tmp/destination.app',
   expectedSha256: 'abc123',
   relaunch: true,
   localSha: 'def456',
   stateFile: '/tmp/state.json',
 },
  );
});

test('install-built-app rejects unknown CLI options', () => {
  assert.throws(
 () => parseArgs(['--unknown']),
 /Unknown argument: --unknown/,
  );
});

test('install-built-app waits for the prior app process to exit before replacement', async () => {
  assert.equal(typeof installer.waitForAppProcess, 'function');

  const processSamples = [
 '/Users/bradleybond/Applications/Crystal Ball.app/Contents/MacOS/crystalball',
 '/Users/bradleybond/Applications/Crystal Ball.app/Contents/MacOS/crystalball',
 '',
  ];
  let reads = 0;

  await installer.waitForAppProcess(
 '/Users/bradleybond/Applications/Crystal Ball.app',
 false,
 {
   pollIntervalMs: 0,
   readProcessCommands: () => {
  reads += 1;
  return processSamples.shift() ?? '';
   },
 },
  );

  assert.equal(reads, 3);
});

test('install-built-app waits for the replacement app process to start', async () => {
  assert.equal(typeof installer.waitForAppProcess, 'function');

  const processSamples = [
 '',
 '/Users/bradleybond/Applications/Crystal Ball.app/Contents/MacOS/crystalball',
  ];

  await installer.waitForAppProcess(
 '/Users/bradleybond/Applications/Crystal Ball.app',
 true,
 {
   pollIntervalMs: 0,
   readProcessCommands: () => processSamples.shift() ?? '',
 },
  );
});

test('install-built-app fails closed when the requested process state is never reached', async () => {
  assert.equal(typeof installer.waitForAppProcess, 'function');

  await assert.rejects(
 installer.waitForAppProcess(
   '/Users/bradleybond/Applications/Crystal Ball.app',
   true,
   {
  timeoutMs: 0,
  readProcessCommands: () => '',
   },
 ),
 /Crystal Ball app process did not start within 0ms/,
  );
});

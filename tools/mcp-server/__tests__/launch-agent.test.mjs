import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  installMonitorLaunchAgent,
  renderMonitorLaunchAgent,
} from '../launch-agent.mjs';

test('monitor LaunchAgent uses an explicit runtime, bounded cadence, and escaped paths', () => {
  const plist = renderMonitorLaunchAgent({
    nodePath: '/opt/node & tools/bin/node',
    runnerPath: '/Users/test/Crystal <Ball>/monitor-once.mjs',
    logPath: '/Users/test/Library/Logs/crystalball-monitor.log',
    intervalSeconds: 900,
    stoppedGraceSeconds: 2_400,
  });

  assert.match(plist, /<integer>900<\/integer>/);
  assert.match(plist, /--expected-interval-seconds[\s\S]*<string>900<\/string>/);
  assert.match(plist, /--stopped-grace-seconds[\s\S]*<string>2400<\/string>/);
  assert.match(plist, /\/opt\/node &amp; tools\/bin\/node/);
  assert.match(plist, /Crystal &lt;Ball&gt;\/monitor-once\.mjs/);
  assert.doesNotMatch(plist, /RunAtLoad/);
});

test('monitor LaunchAgent validates the configured stopped grace', () => {
  assert.throws(() => renderMonitorLaunchAgent({
    nodePath: '/usr/bin/node',
    runnerPath: '/tmp/monitor-once.mjs',
    logPath: '/tmp/monitor.log',
    intervalSeconds: 900,
    stoppedGraceSeconds: 59,
  }), /stopped grace/i);
});

test('monitor installer validates the staged plist before unloading the active service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-install-'));
  const plistPath = join(dir, 'monitor.plist');
  const calls = [];
  writeFileSync(plistPath, 'working plist');

  assert.throws(() => installMonitorLaunchAgent({
    domain: 'gui/501',
    execFileSyncFn(command, args) {
      calls.push([command, ...args]);
      throw new Error('invalid staged plist');
    },
    plist: 'invalid replacement',
    plistPath,
    service: 'gui/501/test.monitor',
  }), /invalid staged plist/);
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [['plutil', '-lint']]);
  assert.equal(readFileSync(plistPath, 'utf8'), 'working plist');
  assert.deepEqual(readdirSync(dir), ['monitor.plist']);
  rmSync(dir, { recursive: true });
});

test('monitor installer restores and reloads the working plist when replacement bootstrap fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-install-'));
  const plistPath = join(dir, 'monitor.plist');
  const calls = [];
  let bootstrapCount = 0;
  writeFileSync(plistPath, 'working plist');

  assert.throws(() => installMonitorLaunchAgent({
    domain: 'gui/501',
    execFileSyncFn(command, args) {
      calls.push([command, ...args]);
      if (command === 'launchctl' && args[0] === 'bootstrap') {
        bootstrapCount += 1;
        if (bootstrapCount === 1) throw new Error('replacement rejected');
      }
    },
    plist: 'valid replacement',
    plistPath,
    service: 'gui/501/test.monitor',
  }), /replacement rejected/);
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [
    ['plutil', '-lint'],
    ['launchctl', 'bootout'],
    ['launchctl', 'bootstrap'],
    ['launchctl', 'bootstrap'],
  ]);
  assert.equal(readFileSync(plistPath, 'utf8'), 'working plist');
  assert.deepEqual(readdirSync(dir), ['monitor.plist']);
  rmSync(dir, { recursive: true });
});

test('monitor installer reloads the working service when activation rename fails after bootout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-install-'));
  const plistPath = join(dir, 'monitor.plist');
  const calls = [];
  writeFileSync(plistPath, 'working plist');

  assert.throws(() => installMonitorLaunchAgent({
    domain: 'gui/501',
    execFileSyncFn(command, args) {
      calls.push([command, ...args]);
    },
    plist: 'valid replacement',
    plistPath,
    renameSyncFn() {
      throw new Error('activation rename failed');
    },
    service: 'gui/501/test.monitor',
  }), /activation rename failed/);
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [
    ['plutil', '-lint'],
    ['launchctl', 'bootout'],
    ['launchctl', 'bootstrap'],
  ]);
  assert.equal(readFileSync(plistPath, 'utf8'), 'working plist');
  assert.deepEqual(readdirSync(dir), ['monitor.plist']);
  rmSync(dir, { recursive: true });
});

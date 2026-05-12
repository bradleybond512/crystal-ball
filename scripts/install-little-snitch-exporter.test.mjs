import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePathArg, renderLaunchdPlist } from './install-little-snitch-exporter.mjs';

test('renders a launchd plist for the Little Snitch exporter', () => {
  const plist = renderLaunchdPlist({
    label: 'com.crystalball.little-snitch-exporter',
    nodePath: '/usr/local/bin/node',
    scriptPath: '/repo/scripts/export-little-snitch-traffic.mjs',
    outputPath: '/Users/me/Library/Application Support/Crystal Ball/little-snitch-traffic.json',
    intervalSeconds: 300,
  });

  assert.match(plist, /com\.crystalball\.little-snitch-exporter/);
  assert.match(plist, /<integer>300<\/integer>/);
  assert.match(plist, /export-little-snitch-traffic\.mjs/);
  assert.doesNotMatch(plist, /<string>sudo<\/string>/);
});

test('normalizes accidental control characters in output paths', () => {
  assert.equal(
    normalizePathArg('/Users/me/Library/\n  Application Support/Crystal Ball/little-snitch-traffic.json'),
    '/Users/me/Library/Application Support/Crystal Ball/little-snitch-traffic.json',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMonitorLaunchAgent } from '../launch-agent.mjs';

test('monitor LaunchAgent uses an explicit runtime, bounded cadence, and escaped paths', () => {
  const plist = renderMonitorLaunchAgent({
    nodePath: '/opt/node & tools/bin/node',
    runnerPath: '/Users/test/Crystal <Ball>/monitor-once.mjs',
    logPath: '/Users/test/Library/Logs/crystalball-monitor.log',
    intervalSeconds: 900,
  });

  assert.match(plist, /<integer>900<\/integer>/);
  assert.match(plist, /\/opt\/node &amp; tools\/bin\/node/);
  assert.match(plist, /Crystal &lt;Ball&gt;\/monitor-once\.mjs/);
  assert.doesNotMatch(plist, /RunAtLoad/);
});

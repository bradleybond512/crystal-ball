import assert from 'node:assert/strict';
import test from 'node:test';

import {
  latestSessionLines,
  parseInjectedKeyCount,
  unrecoveredHeartbeatStaleAge,
} from './checkup-log-audit.mjs';

test('limits log audit evidence to the latest desktop session', () => {
  const lines = [
    '[100][v1][WARN] sidecar heartbeat stale age=392s pid=1',
    '[101][v1][INFO] RunEvent::Exit pid=1',
    '[200][v1][INFO] ════════ SESSION START pid=2 version=1 ════════',
    '[201][v1][INFO] sidecar confirmed port=46123',
  ];

  assert.deepEqual(latestSessionLines(lines), lines.slice(2));
});

test('parses async keychain injection counts', () => {
  const lines = [
    '[200][v1][INFO] injected 0 keychain secrets into sidecar env',
    '[210][v1][INFO] injected 1/1 keychain secrets into running sidecar via IPC',
  ];

  assert.equal(parseInjectedKeyCount(lines), 1);
});

test('reports only an unrecovered stale heartbeat in the latest session', () => {
  assert.equal(unrecoveredHeartbeatStaleAge([
    '[200][v1][WARN] sidecar heartbeat stale age=410s pid=2',
  ]), 410);

  assert.equal(unrecoveredHeartbeatStaleAge([
    '[200][v1][WARN] sidecar heartbeat stale age=410s pid=2',
    '[201][v1][INFO] sidecar heartbeat recovered',
  ]), null);
});

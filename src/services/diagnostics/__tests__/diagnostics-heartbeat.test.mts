import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordDiagnosticsHeartbeat,
  diagnosticsHeartbeatAgeMs,
  resetDiagnosticsHeartbeatForTest,
} from '../diagnostics-heartbeat.ts';

test('age is Infinity until the first heartbeat (never-ran is not green)', () => {
  resetDiagnosticsHeartbeatForTest();
  assert.equal(diagnosticsHeartbeatAgeMs(1000), Number.POSITIVE_INFINITY);
});

test('age reflects time since the last heartbeat', () => {
  resetDiagnosticsHeartbeatForTest();
  recordDiagnosticsHeartbeat(1000);
  assert.equal(diagnosticsHeartbeatAgeMs(1000), 0);
  assert.equal(diagnosticsHeartbeatAgeMs(4000), 3000);
});

test('age never goes negative on clock skew', () => {
  resetDiagnosticsHeartbeatForTest();
  recordDiagnosticsHeartbeat(5000);
  assert.equal(diagnosticsHeartbeatAgeMs(4000), 0);
});

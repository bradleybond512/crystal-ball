import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentDoctorReport, DOCTOR_EXIT } from '../doctor.mjs';

test('doctor runs independent privacy-safe checks and reports compatible health', async () => {
  const calls = [];
  const report = await buildAgentDoctorReport({
    now: () => '2026-07-31T12:00:00.000Z',
    packageVersion: '0.3.0',
    nodeVersion: '22.0.0',
    executablePath: '/Users/alice/.local/bin/crystalball',
    checkSidecar: async () => ({ ok: true, version: '0.3.0', port: 46123, token: 'secret' }),
    readMonitor: async () => ({ available: true, status: 'green', lastRunAt: '2026-07-31T11:50:00.000Z' }),
    inspectClients: async () => [{ name: 'Codex', configured: true, path: '/Users/alice/.codex/config.toml' }],
    onCheck: (name) => calls.push(name),
  });
  assert.deepEqual(calls, ['install', 'runtime', 'clients', 'monitor', 'compatibility', 'capabilities']);
  assert.equal(report.status, 'ready');
  assert.equal(report.exitCode, DOCTOR_EXIT.READY);
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.equal(JSON.stringify(report).includes('/Users/alice'), false);
  assert.equal(report.compatibility.verdict, 'compatible');
  assert.equal(report.capabilities.tools, 59);
});

test('doctor continues partial checks and uses stable degraded and unavailable exit codes', async () => {
  const degraded = await buildAgentDoctorReport({
    packageVersion: '0.3.0',
    nodeVersion: '22.0.0',
    executablePath: null,
    checkSidecar: async () => { throw new Error('Bearer secret-value failed at /Users/alice/x'); },
    readMonitor: async () => null,
    inspectClients: async () => [],
  });
  assert.equal(degraded.status, 'unavailable');
  assert.equal(degraded.exitCode, DOCTOR_EXIT.UNAVAILABLE);
  assert.equal(JSON.stringify(degraded).includes('secret-value'), false);
  assert.equal(JSON.stringify(degraded).includes('/Users/alice'), false);

  const warning = await buildAgentDoctorReport({
    packageVersion: '0.3.0',
    nodeVersion: '22.0.0',
    executablePath: '/usr/local/bin/crystalball',
    checkSidecar: async () => ({ ok: true }),
    readMonitor: async () => null,
    inspectClients: async () => [],
  });
  assert.equal(warning.status, 'degraded');
  assert.equal(warning.exitCode, DOCTOR_EXIT.DEGRADED);
});

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
    inspectInstall: async () => ({
      installed: true,
      nodeSupported: true,
      mcpExecutable: '/Users/alice/.local/bin/crystalball-mcp',
    }),
    checkMcp: async ({ executablePath }) => ({
      ok: executablePath === '/Users/alice/.local/bin/crystalball-mcp',
      name: 'crystalball',
      version: '0.3.0',
    }),
    checkSidecar: async () => ({ ok: true, version: '0.3.0', port: 46123, token: 'secret' }),
    readMonitor: async () => ({
      available: true,
      status: 'green',
      lastRunAt: '2026-07-31T11:50:00.000Z',
      schedule: { status: 'running' },
    }),
    inspectClients: async () => [{
      name: 'Codex',
      configured: true,
      commandResolvable: true,
      portable: true,
      path: '/Users/alice/.codex/config.toml',
    }],
    onCheck: (name) => calls.push(name),
  });
  assert.deepEqual(calls, ['install', 'mcp', 'runtime', 'clients', 'monitor', 'compatibility', 'capabilities']);
  assert.equal(report.status, 'ready');
  assert.equal(report.exitCode, DOCTOR_EXIT.READY);
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.equal(JSON.stringify(report).includes('/Users/alice'), false);
  assert.equal(report.compatibility.verdict, 'compatible');
  assert.equal(report.capabilities.tools, 61);
  assert.equal(report.checks.mcp.status, 'pass');
  assert.equal(report.checks.mcp.version, '0.3.0');
});

test('doctor fails closed when the installed MCP command cannot handshake or reports another version', async () => {
  const base = {
    packageVersion: '0.3.0',
    nodeVersion: '22.0.0',
    executablePath: '/opt/crystalball/bin/crystalball',
    inspectInstall: async () => ({
      installed: true,
      nodeSupported: true,
      mcpExecutable: '/opt/crystalball/bin/crystalball-mcp',
    }),
    checkSidecar: async () => ({ ok: true }),
    readMonitor: async () => null,
    inspectClients: async () => [],
  };
  const failed = await buildAgentDoctorReport({
    ...base,
    checkMcp: async () => ({ ok: false }),
  });
  assert.equal(failed.checks.mcp.status, 'fail');
  assert.equal(failed.status, 'unavailable');

  const stale = await buildAgentDoctorReport({
    ...base,
    checkMcp: async () => ({ ok: true, name: 'crystalball', version: '0.2.9' }),
  });
  assert.equal(stale.checks.mcp.status, 'fail');
  assert.equal(stale.checks.mcp.versionMatches, false);
  assert.equal(stale.status, 'unavailable');
});

test('doctor does not call an MCP handshake without a verified installed sibling command', async () => {
  let called = false;
  const report = await buildAgentDoctorReport({
    packageVersion: '0.3.0',
    nodeVersion: '22.0.0',
    executablePath: '/opt/crystalball/bin/crystalball',
    inspectInstall: async () => ({ installed: false, nodeSupported: true, mcpExecutable: null }),
    checkMcp: async () => {
      called = true;
      return { ok: true, name: 'crystalball', version: '0.3.0' };
    },
    checkSidecar: async () => ({ ok: true }),
    readMonitor: async () => null,
    inspectClients: async () => [],
  });
  assert.equal(called, false);
  assert.equal(report.checks.mcp.status, 'fail');
});

test('doctor distinguishes registered clients from resolvable portable registrations', async () => {
  const report = await buildAgentDoctorReport({
    packageVersion: '0.3.0',
    nodeVersion: '22.0.0',
    executablePath: '/opt/crystalball/bin/crystalball',
    inspectInstall: async () => ({
      installed: true,
      nodeSupported: true,
      mcpExecutable: '/opt/crystalball/bin/crystalball-mcp',
    }),
    checkMcp: async () => ({ ok: true, name: 'crystalball', version: '0.3.0' }),
    checkSidecar: async () => ({ ok: true }),
    readMonitor: async () => null,
    inspectClients: async () => [{
      name: 'Codex',
      configured: true,
      commandResolvable: false,
      portable: false,
    }],
  });
  assert.equal(report.checks.clients.configured, 1);
  assert.equal(report.checks.clients.resolvable, 0);
  assert.equal(report.checks.clients.portable, 0);
  assert.equal(report.checks.clients.status, 'warn');
});

test('doctor continues partial checks and uses stable degraded and unavailable exit codes', async () => {
  const degraded = await buildAgentDoctorReport({
    packageVersion: '0.3.0',
    nodeVersion: '22.0.0',
    executablePath: null,
    inspectInstall: async () => ({ installed: false, nodeSupported: true }),
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
    inspectInstall: async () => ({
      installed: true,
      nodeSupported: true,
      mcpExecutable: '/usr/local/bin/crystalball-mcp',
    }),
    checkMcp: async () => ({ ok: true, name: 'crystalball', version: '0.3.0' }),
    checkSidecar: async () => ({ ok: true }),
    readMonitor: async () => null,
    inspectClients: async () => [],
  });
  assert.equal(warning.status, 'degraded');
  assert.equal(warning.exitCode, DOCTOR_EXIT.DEGRADED);
});

test('doctor degrades stopped monitors and unsupported or unverified installations', async () => {
  const report = await buildAgentDoctorReport({
    now: () => '2026-07-31T12:00:00.000Z',
    packageVersion: '0.3.0',
    nodeVersion: '18.0.0',
    executablePath: '/missing/crystalball',
    inspectInstall: async () => ({ installed: false, nodeSupported: false }),
    checkSidecar: async () => ({ ok: true }),
    readMonitor: async () => ({
      available: true,
      status: 'green',
      lastRunAt: '2026-07-30T12:00:00.000Z',
      schedule: { status: 'stopped' },
    }),
    inspectClients: async () => [{ name: 'Codex', configured: false }],
  });
  assert.equal(report.checks.install.status, 'fail');
  assert.equal(report.checks.monitor.status, 'warn');
  assert.equal(report.checks.monitor.scheduleStatus, 'stopped');
  assert.equal(report.status, 'unavailable');
});

test('doctor fails closed on malformed matching-generation monitor state and omits executable paths', async () => {
  const customPath = '/Volumes/Private/Bradley/tools/crystalball';
  const report = await buildAgentDoctorReport({
    now: () => '2026-07-31T12:00:00.000Z',
    packageVersion: '0.3.0',
    nodeVersion: '22.0.0',
    executablePath: customPath,
    inspectInstall: async () => ({ installed: true, nodeSupported: true }),
    checkSidecar: async () => ({ ok: true }),
    readMonitor: async () => ({
      available: true,
      status: 'green',
      lastRunAt: 'not-a-date',
      schedule: { status: 'running' },
    }),
    inspectClients: async () => [{ name: 'Codex', configured: true }],
  });
  assert.equal(report.checks.monitor.status, 'warn');
  assert.equal(JSON.stringify(report).includes(customPath), false);
});

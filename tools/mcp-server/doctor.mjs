import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createSidecarClient } from './sidecar-client.mjs';
import { createStorage } from './storage.mjs';
import {
  SERVER_VERSION,
  SKILL_CONTRACT_VERSION,
  compatibilityVerdict,
} from './server-meta.mjs';
import { TOOL_CATALOG, TOOL_INDEX } from './tool-registry.mjs';

export const DOCTOR_EXIT = Object.freeze({ READY: 0, DEGRADED: 1, UNAVAILABLE: 2, USAGE: 64 });

export async function buildAgentDoctorReport(options = {}) {
  const packageVersion = options.packageVersion ?? SERVER_VERSION;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const executablePath = options.executablePath ?? process.argv[1];
  const now = options.now?.() ?? new Date().toISOString();
  const checkSidecar = options.checkSidecar ?? defaultSidecarCheck;
  const inspectClients = options.inspectClients ?? defaultClientInspection;
  const readMonitor = options.readMonitor ?? defaultMonitorRead;
  const checks = {};

  checks.install = await independentCheck('install', options, async () => ({
    status: executablePath ? 'pass' : 'warn',
    installed: Boolean(executablePath),
    executable: executablePath ? redact(executablePath) : null,
    nodeVersion,
    packageVersion,
  }));
  checks.runtime = await independentCheck('runtime', options, async () => {
    const runtime = await checkSidecar();
    return {
      status: runtime?.ok ? 'pass' : 'fail',
      available: runtime?.ok === true,
      version: typeof runtime?.version === 'string' ? runtime.version : null,
      message: runtime?.ok ? 'Crystal Ball local sidecar is reachable.' : 'Launch Crystal Ball to enable live intelligence.',
    };
  });
  checks.clients = await independentCheck('clients', options, async () => {
    const clients = await inspectClients();
    const safeClients = Array.isArray(clients) ? clients.map((client) => ({
      name: String(client.name ?? 'Unknown'),
      configured: client.configured === true,
    })) : [];
    return {
      status: safeClients.some((client) => client.configured) ? 'pass' : 'warn',
      configured: safeClients.filter((client) => client.configured).length,
      clients: safeClients,
    };
  });
  checks.monitor = await independentCheck('monitor', options, async () => {
    const monitor = await readMonitor();
    return {
      status: monitor?.available ? (monitor.status === 'red' ? 'warn' : 'pass') : 'warn',
      available: monitor?.available === true,
      monitorStatus: monitor?.status ?? 'unknown',
      lastRunAt: validDateOrNull(monitor?.lastRunAt),
      message: monitor?.available ? 'Safety monitor state is available.' : 'Safety monitor has not completed a cycle.',
    };
  });
  const compatibility = compatibilityVerdict({
    serverVersion: packageVersion,
    skillContractVersion: SKILL_CONTRACT_VERSION,
  });
  checks.compatibility = await independentCheck('compatibility', options, async () => ({
    status: compatibility.verdict === 'compatible'
      ? 'pass'
      : compatibility.verdict === 'incompatible' ? 'fail' : 'warn',
    ...compatibility,
  }));
  checks.capabilities = await independentCheck('capabilities', options, async () => ({
    status: 'pass',
    tools: Object.keys(TOOL_CATALOG).length,
    categories: Object.keys(TOOL_INDEX.categories).length,
  }));

  const statuses = Object.values(checks).map((check) => check.status);
  const status = checks.runtime.status === 'fail' || checks.compatibility.status === 'fail'
    ? 'unavailable'
    : statuses.includes('warn') || statuses.includes('fail') ? 'degraded' : 'ready';
  const exitCode = status === 'ready'
    ? DOCTOR_EXIT.READY
    : status === 'degraded' ? DOCTOR_EXIT.DEGRADED : DOCTOR_EXIT.UNAVAILABLE;
  return {
    schemaVersion: 1,
    generatedAt: validDateOrNull(now) ?? new Date().toISOString(),
    status,
    exitCode,
    summary: status === 'ready'
      ? 'Crystal Ball agent access is ready.'
      : status === 'degraded'
        ? 'Crystal Ball agent access is available with warnings.'
        : 'Crystal Ball agent access is unavailable.',
    compatibility,
    capabilities: checks.capabilities,
    checks,
  };
}

async function independentCheck(name, options, run) {
  options.onCheck?.(name);
  try {
    return await run();
  } catch (error) {
    return { status: 'fail', error: redact(error?.message ?? 'Check failed.') };
  }
}

async function defaultSidecarCheck() {
  const health = await createSidecarClient().get('/api/health');
  return {
    ok: !health?.error && (health?.ok === true || health?.healthy === true),
    version: typeof health?.version === 'string'
      ? health.version
      : typeof health?.app_version === 'string' ? health.app_version : null,
  };
}

async function defaultMonitorRead() {
  return createStorage().readJSON('monitor/state.json');
}

async function defaultClientInspection() {
  const candidates = [
    ['Codex', join(homedir(), '.codex', 'config.toml')],
    ['Claude Code', join(homedir(), '.claude.json')],
  ];
  return candidates.map(([name, path]) => ({ name, configured: existsSync(path) }));
}

export function formatDoctorReport(report) {
  const lines = [report.summary, `Compatibility: ${report.compatibility.verdict}`];
  for (const [name, check] of Object.entries(report.checks)) {
    lines.push(`${check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL'}  ${name}`);
  }
  return `${lines.join('\n')}\n`;
}

function redact(value) {
  return String(value)
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[USER]')
    .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]');
}

function validDateOrNull(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

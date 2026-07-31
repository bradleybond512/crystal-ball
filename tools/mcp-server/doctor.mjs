import { readFileSync, statSync } from 'node:fs';
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
import {
  publicMonitorEvents,
  validCommittedMonitorState,
} from './tools/monitor-events.mjs';

export const DOCTOR_EXIT = Object.freeze({ READY: 0, DEGRADED: 1, UNAVAILABLE: 2, USAGE: 64 });

export async function buildAgentDoctorReport(options = {}) {
  const packageVersion = options.packageVersion ?? SERVER_VERSION;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const executablePath = options.executablePath ?? process.argv[1];
  const now = options.now?.() ?? new Date().toISOString();
  const checkSidecar = options.checkSidecar ?? defaultSidecarCheck;
  const inspectInstall = options.inspectInstall ?? defaultInstallInspection;
  const inspectClients = options.inspectClients ?? defaultClientInspection;
  const readMonitor = options.readMonitor ?? defaultMonitorRead;
  const checks = {};

  checks.install = await independentCheck('install', options, async () => {
    const install = await inspectInstall({ executablePath, nodeVersion, packageVersion });
    return {
      status: install?.installed && install?.nodeSupported ? 'pass' : 'fail',
      installed: install?.installed === true,
      nodeSupported: install?.nodeSupported === true,
      command: install?.installed ? 'crystalball' : null,
      nodeVersion,
      packageVersion,
    };
  });
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
    const monitor = await readMonitor(new Date(now).valueOf());
    const scheduleStatus = monitor?.schedule?.status ?? 'unknown';
    const lastRunAt = validDateOrNull(monitor?.lastRunAt);
    const healthy = monitor?.available === true
      && monitor.status === 'green'
      && scheduleStatus === 'running'
      && lastRunAt !== null;
    return {
      status: healthy ? 'pass' : 'warn',
      available: monitor?.available === true,
      monitorStatus: monitor?.status ?? 'unknown',
      scheduleStatus,
      lastRunAt,
      message: healthy
        ? 'Safety monitor is current and running.'
        : scheduleStatus === 'stopped'
          ? 'Safety monitor missed its expected run window.'
          : 'Safety monitor state is unavailable, degraded, or not current.',
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

export async function readLocalMonitorStatus(now = Date.now(), storage = createStorage()) {
  const state = storage.readJSON('monitor/state.json');
  const eventState = storage.readJSON('monitor/events.json');
  const monitorEvents = publicMonitorEvents(eventState, now);
  if (!validCommittedMonitorState(state, eventState)) {
    return {
      available: false,
      status: 'unknown',
      summary: 'The monitor state is missing, incompatible, or from mismatched generations.',
      schedule: monitorEvents.schedule,
      events: [],
    };
  }
  return {
    ...state,
    schedule: monitorEvents.schedule,
    events: monitorEvents.events,
  };
}

async function defaultMonitorRead(now) {
  return readLocalMonitorStatus(now);
}

async function defaultClientInspection() {
  const candidates = [
    ['Codex', join(homedir(), '.codex', 'config.toml')],
    ['Claude Code', join(homedir(), '.claude.json')],
  ];
  return candidates.map(([name, path]) => ({
    name,
    configured: hasCrystalBallClientRegistration(path),
  }));
}

function defaultInstallInspection({ executablePath, nodeVersion }) {
  let installed = false;
  try {
    installed = Boolean(executablePath) && statSync(executablePath).isFile();
  } catch {
    installed = false;
  }
  const nodeMajor = Number.parseInt(String(nodeVersion).split('.')[0], 10);
  return { installed, nodeSupported: Number.isInteger(nodeMajor) && nodeMajor >= 20 };
}

function hasCrystalBallClientRegistration(path) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  if (path.endsWith('.toml')) {
    const sections = source.split(/^\s*(?=\[)/m);
    const section = sections.find((candidate) => (
      /^\s*\[mcp_servers\.(?:"crystalball"|crystalball)\]\s*$/im.test(candidate)
    ));
    if (!section) return false;
    const disabled = /^\s*disabled\s*=\s*true\s*$/im.test(section)
      || /^\s*enabled\s*=\s*false\s*$/im.test(section);
    const command = section.match(/^\s*command\s*=\s*["']([^"']+)["']\s*$/im)?.[1];
    return !disabled && isCrystalBallCommand(command);
  }
  try {
    return containsCrystalBallClient(JSON.parse(source));
  } catch {
    return false;
  }
}

function containsCrystalBallClient(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'mcpServers' && child && typeof child === 'object') {
      const registration = child.crystalball;
      if (registration && typeof registration === 'object'
          && registration.disabled !== true
          && isCrystalBallCommand(registration.command)) return true;
    }
    if (containsCrystalBallClient(child)) return true;
  }
  return false;
}

function isCrystalBallCommand(value) {
  return typeof value === 'string' && /(?:^|[\\/])crystalball-mcp$/.test(value.trim());
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
  if (typeof value !== 'string' && !Number.isFinite(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

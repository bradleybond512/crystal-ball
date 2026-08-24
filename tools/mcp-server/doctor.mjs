import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { createSidecarClient } from './sidecar-client.mjs';
import { createStorage } from './storage.mjs';
import {
  SERVER_NAME,
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
  const checkMcp = options.checkMcp ?? defaultMcpHandshake;
  const inspectInstall = options.inspectInstall ?? defaultInstallInspection;
  const inspectClients = options.inspectClients ?? defaultClientInspection;
  const readMonitor = options.readMonitor ?? defaultMonitorRead;
  const checks = {};
  let installation = null;

  checks.install = await independentCheck('install', options, async () => {
    installation = await inspectInstall({ executablePath, nodeVersion, packageVersion });
    return {
      status: installation?.installed && installation?.nodeSupported ? 'pass' : 'fail',
      installed: installation?.installed === true,
      nodeSupported: installation?.nodeSupported === true,
      command: installation?.installed ? 'crystalball' : null,
      nodeVersion,
      packageVersion,
    };
  });
  checks.mcp = await independentCheck('mcp', options, async () => {
    if (!installation?.installed || typeof installation.mcpExecutable !== 'string') {
      return {
        status: 'fail',
        available: false,
        nameMatches: false,
        version: null,
        versionMatches: false,
      };
    }
    const mcp = await checkMcp({
      executablePath: installation.mcpExecutable,
      timeoutMs: options.mcpTimeoutMs ?? 3_000,
    });
    const nameMatches = mcp?.name === SERVER_NAME;
    const versionMatches = mcp?.version === packageVersion;
    return {
      status: mcp?.ok && nameMatches && versionMatches ? 'pass' : 'fail',
      available: mcp?.ok === true,
      nameMatches,
      version: typeof mcp?.version === 'string' ? mcp.version : null,
      versionMatches,
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
      commandResolvable: client.commandResolvable === true,
      portable: client.portable === true,
    })) : [];
    const configured = safeClients.filter((client) => client.configured).length;
    const resolvable = safeClients.filter((client) => client.configured && client.commandResolvable).length;
    const portable = safeClients.filter((client) => (
      client.configured && client.commandResolvable && client.portable
    )).length;
    return {
      status: portable > 0 ? 'pass' : 'warn',
      configured,
      resolvable,
      portable,
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
  const status = checks.runtime.status === 'fail'
      || checks.mcp.status === 'fail'
      || checks.compatibility.status === 'fail'
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

async function defaultMcpHandshake({ executablePath, timeoutMs }) {
  const client = new Client({ name: 'crystalball-doctor', version: SERVER_VERSION });
  const transport = new StdioClientTransport({
    command: executablePath,
    args: [],
    stderr: 'pipe',
  });
  try {
    await client.connect(transport, { timeout: timeoutMs, maxTotalTimeout: timeoutMs });
    const server = client.getServerVersion();
    return {
      ok: true,
      name: typeof server?.name === 'string' ? server.name : null,
      version: typeof server?.version === 'string' ? server.version : null,
    };
  } catch {
    return { ok: false, name: null, version: null };
  } finally {
    await client.close().catch(() => {});
  }
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
    ...inspectCrystalBallClientRegistration(path),
  }));
}

function defaultInstallInspection({ executablePath, nodeVersion }) {
  const cliInstalled = executableFile(executablePath);
  const mcpExecutable = cliInstalled
    ? join(dirname(executablePath), 'crystalball-mcp')
    : null;
  const installed = cliInstalled && executableFile(mcpExecutable);
  const nodeMajor = Number.parseInt(String(nodeVersion).split('.')[0], 10);
  return {
    installed,
    nodeSupported: Number.isInteger(nodeMajor) && nodeMajor >= 20,
    mcpExecutable: installed ? mcpExecutable : null,
  };
}

function inspectCrystalBallClientRegistration(path) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    return clientRegistrationResult(null, false);
  }
  if (path.endsWith('.toml')) {
    const sections = source.split(/^\s*(?=\[)/m);
    const section = sections.find((candidate) => (
      /^\s*\[mcp_servers\.(?:"crystalball"|crystalball)\]\s*$/im.test(candidate)
    ));
    if (!section) return clientRegistrationResult(null, false);
    const disabled = /^\s*disabled\s*=\s*true\s*$/im.test(section)
      || /^\s*enabled\s*=\s*false\s*$/im.test(section);
    const command = section.match(/^\s*command\s*=\s*["']([^"']+)["']\s*$/im)?.[1];
    return clientRegistrationResult(command, !disabled && isCrystalBallCommand(command));
  }
  try {
    return findCrystalBallClient(JSON.parse(source));
  } catch {
    return clientRegistrationResult(null, false);
  }
}

function findCrystalBallClient(value) {
  if (!value || typeof value !== 'object') return clientRegistrationResult(null, false);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'mcpServers' && child && typeof child === 'object') {
      const registration = child.crystalball;
      if (registration && typeof registration === 'object') {
        return clientRegistrationResult(
          registration.command,
          registration.disabled !== true && isCrystalBallCommand(registration.command),
        );
      }
    }
    const nested = findCrystalBallClient(child);
    if (nested.configured) return nested;
  }
  return clientRegistrationResult(null, false);
}

function isCrystalBallCommand(value) {
  return typeof value === 'string' && /(?:^|[\\/])crystalball-mcp$/.test(value.trim());
}

function clientRegistrationResult(command, configured) {
  const resolved = configured ? resolveExecutable(command) : null;
  return {
    configured,
    commandResolvable: resolved !== null,
    portable: resolved !== null && isAbsolute(String(command).trim()),
  };
}

function resolveExecutable(command) {
  if (typeof command !== 'string') return null;
  const candidate = command.trim();
  if (!candidate) return null;
  if (isAbsolute(candidate)) return executableFile(candidate) ? candidate : null;
  if (candidate.includes('/') || candidate.includes('\\')) return null;
  for (const directory of String(process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const path = join(directory, candidate);
    if (executableFile(path)) return path;
  }
  return null;
}

function executableFile(path) {
  if (typeof path !== 'string' || !path) return false;
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
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

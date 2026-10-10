// Explicit --import test preload, never an inherited NODE_OPTIONS hook.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const violations = [];
const ownedPorts = new Set(String(process.env.CB_TEST_LOOPBACK_PORTS ?? '').split(',').filter(Boolean));
const closedFixturePorts = new Set();
const registry = process.env.CB_TEST_PORT_REGISTRY;
const registrations = new Set();
function fixturePortIsLive(port) {
  if (!registry || !existsSync(registry)) return false;
  for (const file of readdirSync(registry).filter((name) => name.endsWith(`-${port}.json`))) {
    try {
      const entry = JSON.parse(readFileSync(join(registry, file), 'utf8'));
      if (entry.port !== port || !Number.isSafeInteger(entry.pid)) continue;
      process.kill(entry.pid, 0);
      return true;
    } catch { /* closed or reaped fixture process */ }
  }
  return false;
}
const serverEmit = net.Server.prototype.emit;
net.Server.prototype.emit = function(event, ...args) {
  if (event === 'listening') {
    const address = this.address();
    if (address && typeof address === 'object') {
      const port = String(address.port);
      ownedPorts.add(port);
      closedFixturePorts.delete(port);
      const registration = registry ? join(registry, `${process.pid}-${port}.json`) : null;
      if (registration) { writeFileSync(registration, JSON.stringify({ pid: process.pid, port })); registrations.add(registration); }
      this.once('close', () => {
        ownedPorts.delete(port); closedFixturePorts.add(port);
        if (registration) { rmSync(registration, { force: true }); registrations.delete(registration); }
      });
    }
  }
  return serverEmit.call(this, event, ...args);
};
function admit(value) {
  const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    if (ownedPorts.has(url.port) || fixturePortIsLive(url.port)) return true;
    // Reproduce connection refusal after a test-owned server closes, without
    // risking a connection to an unrelated process that reuses its old port.
    if (closedFixturePorts.has(url.port)) return false;
  }
  violations.push(url.origin);
  throw new Error(`Unexpected real network attempt in isolated test: ${url.origin}`);
}
function refused() { return Object.assign(new Error('Closed fixture server: ECONNREFUSED'), { code: 'ECONNREFUSED' }); }
const realFetch = globalThis.fetch;
globalThis.fetch = (value, ...args) => {
  if (!admit(value)) return Promise.reject(refused());
  return realFetch(value, ...args);
};
for (const module of [http, https]) {
  for (const name of ['request', 'get']) {
    const original = module[name];
    module[name] = function(value, ...args) {
      const target = typeof value === 'string' || value instanceof URL ? value
        : `${module === https ? 'https' : 'http'}://${value.hostname || value.host}:${value.port || (module === https ? 443 : 80)}`;
      if (!admit(target)) {
        const request = new EventEmitter();
        for (const method of ['end', 'write', 'destroy', 'setTimeout']) request[method] = () => request;
        queueMicrotask(() => request.emit('error', refused()));
        return request;
      }
      return original.call(this, value, ...args);
    };
  }
}
// Preserve the same guard for direct Node subprocesses, including npm's real
// installer and the installed aliases/doctor's SDK handshake descendants.
const installedRoot = process.env.CB_TEST_INSTALLED_ROOT;
const aliasTargets = { crystalball: 'cli.mjs', 'crystalball-mcp': 'index.mjs',
  'crystalball-monitor': 'monitor-once.mjs', 'crystalball-monitor-install': 'install-monitor.mjs' };
function installedEntrypoint(command) {
  if (!installedRoot || typeof command !== 'string') return null;
  const name = basename(command);
  if (!Object.hasOwn(aliasTargets, name)) return null;
  const prefix = resolve(installedRoot, '../../..');
  if (resolve(command) !== join(prefix, 'bin', name)) return null;
  const expected = join(installedRoot, aliasTargets[name]);
  if (realpathSync(command) !== realpathSync(expected)) throw new Error('Installed test alias points outside its owned package.');
  return expected;
}
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[name];
  childProcess[name] = function(command, args, ...rest) {
    const entrypoint = installedEntrypoint(command);
    if (entrypoint && Array.isArray(args)) { command = process.execPath; args = [entrypoint, ...args]; }
    if (command === process.execPath && Array.isArray(args)) {
      args = ['--import', fileURLToPath(import.meta.url), ...args];
      // SDK default-env filtering drops test variables. Supply the same owned
      // guard context explicitly; never reintroduce inherited NODE_OPTIONS.
      if (rest[0] && typeof rest[0] === 'object' && rest[0].env) {
        rest[0] = { ...rest[0], env: { ...rest[0].env,
          ...(installedRoot ? { CB_TEST_INSTALLED_ROOT: installedRoot } : {}),
          ...(registry ? { CB_TEST_PORT_REGISTRY: registry } : {}),
          CRYSTALBALL_MCP_MONITOR_INTERVAL_MINUTES: '0',
        } };
        delete rest[0].env.NODE_OPTIONS;
      }
    }
    return original.call(this, command, args, ...rest);
  };
}
syncBuiltinESMExports();
process.on('exit', () => {
  for (const registration of registrations) rmSync(registration, { force: true });
  if (violations.length) { console.error(`ISOLATION VIOLATIONS: ${JSON.stringify(violations)}`); process.exitCode = 1; } });

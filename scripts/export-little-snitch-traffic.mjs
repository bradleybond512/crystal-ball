#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LITTLE_SNITCH_EXPORT_PATH = path.join(
  os.userInfo().homedir,
  'Library/Application Support/Crystal Ball/little-snitch-traffic.json',
);
export const LITTLE_SNITCH_HELPER_PATH = '/usr/local/libexec/crystal-ball-little-snitch-log';
export const MAX_LITTLE_SNITCH_CSV_BYTES = 8 * 1024 * 1024;
export const MAX_LITTLE_SNITCH_ENTRIES = 500;
const COLLECTION_TIMEOUT_MS = 35_000;
const VALID_HEADERS = new Set([
  'date', 'direction', 'uid', 'ipaddress', 'remotehostname', 'protocol', 'port',
  'connectcount', 'denycount', 'bytecountin', 'bytecountout',
  'connectingexecutable', 'parentappexecutable',
]);
const REQUIRED_HEADERS = ['date', 'direction', 'remotehostname', 'protocol', 'connectcount', 'denycount'];
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const SKIP_IP_ONLY_ROW = Symbol('skip-ip-only-row');

export function parseLittleSnitchTrafficCsv(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > MAX_LITTLE_SNITCH_CSV_BYTES) {
    throw new Error('Little Snitch export exceeded the permitted size');
  }
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error('Little Snitch export did not contain a CSV header');
  const headers = rows[0].map(header => normalizeHeader(header));
  validateHeaders(headers);

  const aggregated = new Map();
  for (const row of rows.slice(1)) {
    const entry = rowToEntry(headers, row);
    if (entry === SKIP_IP_ONLY_ROW) continue;
    if (!entry) throw new Error('Little Snitch export contains an invalid traffic row');
    const key = `${entry.app}\0${entry.remoteHost}\0${entry.decision}\0${entry.direction}\0${entry.protocol}`;
    const previous = aggregated.get(key);
    if (!previous) {
      aggregated.set(key, entry);
      continue;
    }
    previous.bytesIn = addBounded(previous.bytesIn, entry.bytesIn);
    previous.bytesOut = addBounded(previous.bytesOut, entry.bytesOut);
    previous.count = addBounded(previous.count, entry.count);
    if (entry.lastSeen > previous.lastSeen) previous.lastSeen = entry.lastSeen;
  }

  return [...aggregated.values()]
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)
      || a.app.localeCompare(b.app)
      || a.remoteHost.localeCompare(b.remoteHost))
    .slice(0, MAX_LITTLE_SNITCH_ENTRIES)
    .map(entry => ({
      id: createHash('sha256')
        .update(`${entry.app}\0${entry.remoteHost}\0${entry.decision}\0${entry.direction}\0${entry.protocol}`)
        .digest('hex')
        .slice(0, 24),
      ...entry,
    }));
}

export async function collectLittleSnitchTraffic({
  command = '/usr/bin/sudo',
  args = ['-n', LITTLE_SNITCH_HELPER_PATH],
  timeoutMs = COLLECTION_TIMEOUT_MS,
  maxBytes = MAX_LITTLE_SNITCH_CSV_BYTES,
  terminationGraceMs = 1000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    let stdoutBytes = 0;
    let failure = null;
    let finished = false;
    let forceTimer = null;

    const failAndStop = message => {
      if (!failure) failure = new Error(message);
      child.kill('SIGTERM');
      if (!forceTimer) {
        forceTimer = setTimeout(() => {
          if (!finished) child.kill('SIGKILL');
        }, terminationGraceMs);
        forceTimer.unref?.();
      }
    };
    const timer = setTimeout(() => failAndStop('Little Snitch collection timed out'), timeoutMs);
    timer.unref?.();

    child.stdout.on('data', chunk => {
      if (failure) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        failAndStop('Little Snitch export exceeded the permitted size');
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.resume();
    child.once('error', error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      reject(new Error(`Little Snitch collector could not start: ${safeProcessError(error)}`));
    });
    child.once('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (failure) {
        reject(failure);
      } else if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        reject(new Error('Little Snitch collection failed'));
      }
    });
  });
}

export async function writeLittleSnitchSnapshot(entries, outputPath = LITTLE_SNITCH_EXPORT_PATH, now = new Date()) {
  if (!Array.isArray(entries) || entries.length > MAX_LITTLE_SNITCH_ENTRIES) {
    throw new Error('Little Snitch snapshot contains too many entries');
  }
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);
  const snapshot = {
    schemaVersion: 1,
    available: true,
    generatedAt: now.toISOString(),
    entries,
  };
  const temporaryPath = path.join(outputDir, `.little-snitch-traffic.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(snapshot)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, outputPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return outputPath;
}

async function main() {
  const csv = await collectLittleSnitchTraffic();
  const entries = parseLittleSnitchTrafficCsv(csv);
  await writeLittleSnitchSnapshot(entries);
  process.stdout.write(`Little Snitch snapshot updated (${entries.length} entries)\n`);
}

function validateHeaders(headers) {
  if (headers.some((header, index) => !header || headers.indexOf(header) !== index)) {
    throw new Error('Little Snitch export contains invalid or duplicate CSV headers');
  }
  if (headers.some(header => !VALID_HEADERS.has(header))) {
    throw new Error('Little Snitch export schema is not supported');
  }
  if (REQUIRED_HEADERS.some(header => !headers.includes(header))) {
    throw new Error('Little Snitch export is missing required CSV headers');
  }
}

function rowToEntry(headers, row) {
  if (row.length !== headers.length) return null;
  const field = name => row[headers.indexOf(name)] ?? '';
  const remoteHostname = String(field('remotehostname')).trim();
  const remoteHost = sanitizeDomainHost(remoteHostname);
  const ipOnly = net.isIP(remoteHostname) !== 0
    || (!remoteHostname && net.isIP(String(field('ipaddress')).trim()) !== 0);
  if (!remoteHost && !ipOnly) return null;
  const parentApp = field('parentappexecutable');
  const executable = field('connectingexecutable');
  const app = sanitizeApp(parentApp || executable);
  const denyCount = sanitizeInteger(field('denycount'));
  const connectCount = sanitizeInteger(field('connectcount'));
  const bytesIn = optionalInteger(headers, row, 'bytecountin');
  const bytesOut = optionalInteger(headers, row, 'bytecountout');
  const lastSeen = sanitizeTimestamp(field('date'));
  if (denyCount === null || connectCount === null
      || bytesIn === null || bytesOut === null || !lastSeen) return null;
  if (ipOnly) return SKIP_IP_ONLY_ROW;
  return {
    app,
    remoteHost,
    remoteIp: null,
    decision: denyCount > 0 ? 'block' : 'allow',
    direction: sanitizeDirection(field('direction')),
    protocol: sanitizeProtocol(field('protocol')),
    bytesIn,
    bytesOut,
    lastSeen,
    count: Math.max(connectCount, denyCount, 1),
  };
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('Little Snitch export contains malformed CSV');
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value).replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sanitizeApp(value) {
  const basename = path.basename(String(value || '').trim()).replace(/[^a-zA-Z0-9 ._()+-]/g, '').trim();
  return basename.slice(0, 100) || 'Unknown App';
}

function sanitizeDomainHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host.length > 253 || !DOMAIN_RE.test(host)) return null;
  return host;
}

function sanitizeDirection(value) {
  if (value === 'in' || value === 'inbound') return 'inbound';
  if (value === 'out' || value === 'outbound') return 'outbound';
  return 'unknown';
}

function sanitizeProtocol(value) {
  if (value === '6' || String(value).toLowerCase() === 'tcp') return 'tcp';
  if (value === '17' || String(value).toLowerCase() === 'udp') return 'udp';
  return 'unknown';
}

function sanitizeInteger(value) {
  if (!/^\d+$/.test(String(value || '').trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function optionalInteger(headers, row, name) {
  const index = headers.indexOf(name);
  return index === -1 ? 0 : sanitizeInteger(row[index]);
}

function sanitizeTimestamp(value) {
  const timestamp = Date.parse(String(value || '').replace(' ', 'T'));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function addBounded(a, b) {
  return Math.min(Number.MAX_SAFE_INTEGER, a + b);
}

function safeProcessError(error) {
  if (error?.code === 'ENOENT') return 'required command not found';
  if (error?.code === 'EACCES') return 'permission denied';
  return 'unknown process error';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Little Snitch export failed'}\n`);
    process.exitCode = 1;
  }
}

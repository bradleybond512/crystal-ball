#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT = path.join(os.homedir(), 'Library/Application Support/Crystal Ball/little-snitch-traffic.json');
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const SUDO = '/usr/bin/sudo';
const LITTLE_SNITCH_CANDIDATES = [
  '/Applications/Little Snitch.app/Contents/Components/littlesnitch',
  '/usr/local/bin/littlesnitch',
  '/opt/homebrew/bin/littlesnitch',
];
const padDatePart = value => String(value).padStart(2, '0');

export function parseLittleSnitchTrafficCsv(csv) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const headers = rows[0].map(header => normalizeHeader(header));
  return rows.slice(1)
    .map((row, idx) => rowToEntry(headers, row, idx))
    .filter(Boolean);
}

export async function writeLittleSnitchSnapshot(entries, outputPath = DEFAULT_OUTPUT) {
  const snapshot = {
    available: entries.length > 0,
    generatedAt: new Date().toISOString(),
    entries,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o644 });
  await chmod(outputPath, 0o644);
  return outputPath;
}

async function main(argv) {
  const outputPath = readArg(argv, '--output') || DEFAULT_OUTPUT;
  const beginDate = readArg(argv, '--begin-date') || defaultBeginDate();
  const inputPath = readArg(argv, '--input');
  const useSudo = !argv.includes('--no-sudo');
  const csv = inputPath
    ? await import('node:fs/promises').then(fs => fs.readFile(inputPath, 'utf8'))
    : await runLittleSnitchTraffic(beginDate, useSudo);
  const entries = parseLittleSnitchTrafficCsv(csv);
  const written = await writeLittleSnitchSnapshot(entries, outputPath);
  console.log(`Written ${entries.length} Little Snitch entries to ${written}`);
}

function runLittleSnitchTraffic(beginDate, useSudo) {
  return new Promise((resolve, reject) => {
    const littleSnitchBin = resolveLittleSnitchBin();
    const command = useSudo ? SUDO : littleSnitchBin;
    const args = useSudo
      ? [littleSnitchBin, 'log-traffic', '--begin-date', beginDate]
      : ['log-traffic', '--begin-date', beginDate];
    const child = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `littlesnitch log-traffic exited ${code}`));
    });
  });
}

function resolveLittleSnitchBin() {
  const found = LITTLE_SNITCH_CANDIDATES.find(candidate => existsSync(candidate));
  if (!found) throw new Error('Could not find Little Snitch CLI in /Applications/Little Snitch.app, /usr/local/bin, or /opt/homebrew/bin');
  return found;
}

function rowToEntry(headers, row, idx) {
  const value = (...names) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index !== -1 && row[index]) return row[index];
    }
    return '';
  };
  const remoteHost = normalizeHost(value('remotehostname', 'remotehost', 'host', 'hostname', 'domain', 'remote', 'server', 'ipaddress'));
  if (!remoteHost) return null;
  const app = sanitizeApp(value('parentappexecutable', 'connectingexecutable', 'app', 'application', 'process', 'processname', 'process_name'));
  return {
    id: `${app}-${remoteHost}-${idx}`,
    app,
    remoteHost,
    decision: sanitizeDecision(value('decision', 'action', 'ruleaction', 'rule_action'), value('denycount')),
    direction: sanitizeDirection(value('direction')),
    protocol: sanitizeProtocol(value('protocol')),
    bytesIn: sanitizeNumber(value('bytecountin', 'bytesin', 'bytes_in', 'receivedbytes', 'received')),
    bytesOut: sanitizeNumber(value('bytecountout', 'bytesout', 'bytes_out', 'sentbytes', 'sent')),
    lastSeen: sanitizeTimestamp(value('date', 'timestamp', 'time', 'enddate', 'end_date')),
    count: Math.max(1, sanitizeNumber(value('connectcount', 'count', 'connections', 'connectioncount'))),
    firstSeen: sanitizeBoolean(value('firstseen', 'first_seen', 'new')),
  };
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];
    if (isEscapedQuote(char, next, quoted)) {
      field += char;
      i += 1;
    } else if (isQuote(char)) {
      quoted = !quoted;
    } else if (isDelimiter(char, quoted)) {
      row.push(field);
      field = '';
    } else if (isLineBreak(char, quoted)) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

function isEscapedQuote(char, next, quoted) {
  return char === '"' && quoted && next === '"';
}

function isQuote(char) {
  return char === '"';
}

function isDelimiter(char, quoted) {
  return char === ',' && !quoted;
}

function isLineBreak(char, quoted) {
  return (char === '\n' || char === '\r') && !quoted;
}

function normalizeHeader(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function normalizeHost(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return normalizeHostLabel(parsed.hostname);
  } catch {
    return normalizeHostLabel(trimmed.split(/[/:?#]/, 1)[0] || '');
  }
}

function normalizeHostLabel(value) {
  const host = String(value).toLowerCase().replace(/\.$/, '');
  return HOST_RE.test(host) ? host : null;
}

function sanitizeLabel(value, fallback) {
  return String(value || '').replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback;
}

function sanitizeApp(value) {
  const label = sanitizeLabel(value, 'Unknown App');
  const parts = label.split('/');
  return parts.at(-1) || label;
}

function sanitizeDecision(value, denyCount = '') {
  if (sanitizeNumber(denyCount) > 0) return 'block';
  const normalized = String(value).toLowerCase();
  if (normalized === 'allow' || normalized === 'allowed') return 'allow';
  if (normalized === 'block' || normalized === 'blocked' || normalized === 'deny' || normalized === 'denied') return 'block';
  return 'unknown';
}

function sanitizeDirection(value) {
  const normalized = String(value).toLowerCase();
  if (normalized === 'in' || normalized === 'incoming') return 'inbound';
  if (normalized === 'out' || normalized === 'outgoing') return 'outbound';
  if (normalized === 'inbound' || normalized === 'outbound') return normalized;
  return 'unknown';
}

function sanitizeProtocol(value) {
  const normalized = String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (normalized === '6') return 'tcp';
  if (normalized === '17') return 'udp';
  return normalized || 'unknown';
}

function sanitizeNumber(value) {
  const num = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(Math.round(num), Number.MAX_SAFE_INTEGER);
}

function sanitizeTimestamp(value) {
  const ms = Date.parse(String(value || '').replace(' ', 'T'));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(0).toISOString();
}

function sanitizeBoolean(value) {
  return ['1', 'true', 'yes', 'new'].includes(String(value).toLowerCase());
}

function defaultBeginDate() {
  const date = new Date(Date.now() - 60 * 60 * 1000);
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

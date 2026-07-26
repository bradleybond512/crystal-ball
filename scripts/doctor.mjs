#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createSidecarClient } from '../tools/mcp-server/sidecar-client.mjs';
import { latestSessionLines } from './checkup-log-audit.mjs';
import { buildDoctorReport } from './doctor-core.mjs';

const dataDir = path.join(homedir(), 'Library', 'Logs', 'com.bradleybond.crystalball');
const logFile = path.join(dataDir, 'desktop.log');
const heartbeatFile = path.join(dataDir, 'sidecar.health.json');
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(`Crystal Ball runtime doctor

Usage:
  npm run doctor
  npm run doctor -- --deep
  npm run doctor -- --json
  npm run doctor -- --json --output /tmp/crystalball-doctor.json

Options:
  --deep           Run the 10-route sidecar self-test.
  --json           Print a privacy-safe JSON report for an agent or issue.
  --output <path>  Save the JSON report to a file.
  --help           Show this help.`);
  process.exit(0);
}

const startedAt = Date.now();
const client = createSidecarClient(dataDir);
const requests = [
  client.get('/api/health'),
  client.get('/api/feeds/health'),
  client.get('/api/analyst-state'),
];
if (options.deep) requests.push(client.get('/api/diagnostics/self-test'));

const [health, feeds, analyst, selfTest = null] = await Promise.all(requests);
const heartbeat = readJson(heartbeatFile);
const logLines = existsSync(logFile)
  ? latestSessionLines(readLastText(logFile, 1024 * 1024).split('\n'))
  : [];
const report = buildDoctorReport({
  now: Date.now(),
  durationMs: Date.now() - startedAt,
  health,
  heartbeat,
  feeds,
  analyst,
  selfTest,
  logLines,
});

if (options.output) {
  const outputPath = path.resolve(options.output);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (!options.json) console.log(`Saved privacy-safe diagnostics to ${outputPath}`);
}

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report, options.deep);
}

let exitCode = 0;
if (report.status === 'red') exitCode = 2;
else if (report.status === 'yellow') exitCode = 1;
process.exit(exitCode);

function parseArgs(args) {
  const parsed = { deep: false, json: false, help: false, output: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--deep') parsed.deep = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--output') {
      const output = args[index + 1];
      if (!output || output.startsWith('--')) throw new Error('--output requires a file path');
      parsed.output = output;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return parsed;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readLastText(path, maxBytes) {
  const descriptor = openSync(path, 'r');
  try {
    const size = fstatSync(descriptor).size;
    const bytes = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(bytes);
    readSync(descriptor, buffer, 0, bytes, size - bytes);
    return buffer.toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

function printHumanReport(report, deep) {
  const statusColors = {
    green: '\u001B[32m',
    yellow: '\u001B[33m',
    red: '\u001B[31m',
  };
  const color = statusColors[report.status];
  const reset = '\u001B[0m';
  console.log(`\nCrystal Ball Doctor  ${color}${report.status.toUpperCase()}${reset}  ${report.durationMs}ms`);
  console.log(`Runtime   port ${report.runtime.port ?? '—'} · pid ${report.runtime.pid ?? '—'} · RSS ${report.runtime.rssMb ?? '—'} MB · loop lag ${report.runtime.eventLoopLagMs ?? '—'} ms`);
  console.log(`Feeds     ${report.feeds.healthy}/${report.feeds.total} healthy · ${report.feeds.degraded} degraded · ${report.feeds.failed} failed`);
  const ledger = report.algorithms.ledger;
  const algorithmSummary = ledger
    ? `${ledger.graded ?? 0}/${ledger.total ?? 0} graded`
    : 'awaiting renderer snapshot';
  const deepSummary = deep ? ' · deep self-test included' : '';
  console.log(`Algorithms ${algorithmSummary}${deepSummary}`);

  if (report.findings.length === 0) {
    console.log('\nNo actionable runtime problems detected.');
  } else {
    console.log('\nRanked findings:');
    for (const finding of report.findings) {
      const marker = finding.severity === 'red' ? 'RED' : 'WARN';
      console.log(`  [${marker}] ${finding.summary}`);
      if (finding.evidence) console.log(`         ${finding.evidence}`);
      console.log(`         Next: ${finding.nextAction}`);
    }
  }

  console.log('\nAgent handoff: npm run doctor -- --deep --json');
}

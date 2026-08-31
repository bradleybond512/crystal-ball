import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

export const CANONICAL_EXECUTABLE = '/Users/bradleybond/Applications/Crystal Ball.app/Contents/MacOS/crystalball';

export function percentile(values, quantile) {
  if (values.length === 0) throw new Error('percentile requires samples');
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index];
}

export function parseProcessTable(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [pid, ppid, cpuPercent, rssKb, ...commandParts] = line.split(/\s+/);
    const parsed = { pid: Number(pid), ppid: Number(ppid), cpuPercent: Number(cpuPercent), rssKb: Number(rssKb), command: commandParts.join(' ') };
    if (!parsed.command || Object.values(parsed).slice(0, 4).some((value) => !Number.isFinite(value))) throw new Error(`malformed ps row: ${line}`);
    return parsed;
  });
}

export function selectProcessTree(rows, rootPid) {
  const root = rows.find((row) => row.pid === rootPid);
  if (!root) throw new Error(`root PID ${rootPid} is not running`);
  if (root.command !== CANONICAL_EXECUTABLE && !root.command.startsWith(`${CANONICAL_EXECUTABLE} `)) {
    throw new Error(`root PID ${rootPid} is not the canonical Crystal Ball executable: ${root.command}`);
  }
  const selected = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (selected.has(row.ppid) && !selected.has(row.pid)) { selected.add(row.pid); changed = true; }
  }
  return rows.filter((row) => selected.has(row.pid));
}

export function aggregateProcessSample(rows, rootPid, sampledAt = new Date().toISOString()) {
  const tree = selectProcessTree(rows, rootPid);
  return {
    sampledAt,
    pids: tree.map((row) => row.pid).sort((a, b) => a - b),
    cpuPercent: tree.reduce((sum, row) => sum + row.cpuPercent, 0),
    rssKb: tree.reduce((sum, row) => sum + row.rssKb, 0),
  };
}

export function parsePackagedArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`missing value for ${key ?? 'option'}`);
    values[key.slice(2)] = value;
  }
  for (const key of ['root-pid', 'state-file', 'expected-sha', 'output']) if (!values[key]) throw new Error(`--${key} is required`);
  const rootPid = Number(values['root-pid']);
  const durationMs = Number(values['duration-ms'] ?? 60_000);
  const cadenceMs = Number(values['cadence-ms'] ?? 1000);
  const runs = Number(values.runs ?? 3);
  if (!Number.isInteger(rootPid) || rootPid <= 0) throw new Error('--root-pid must be a positive integer');
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(cadenceMs) || cadenceMs <= 0 || !Number.isInteger(runs) || runs <= 0) throw new Error('duration, cadence, and runs must be positive');
  return { rootPid, stateFile: values['state-file'], expectedSha: values['expected-sha'], output: values.output, durationMs, cadenceMs, runs };
}

export function validateCheckpoint(stateFile, expectedSha) {
  const state = JSON.parse(readFileSync(path.resolve(stateFile), 'utf8'));
  if (state.localBuildSha !== expectedSha) throw new Error(`checkpoint SHA mismatch: expected ${expectedSha}, found ${String(state.localBuildSha)}`);
  return state;
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
function sample(rootPid) {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,command='], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ps failed: ${result.stderr.trim()}`);
  return aggregateProcessSample(parseProcessTable(result.stdout), rootPid);
}

export function buildPackagedReport({ expectedSha, rootPid, durationMs, cadenceMs, runs, rawRuns, measuredAt = new Date().toISOString() }) {
  const samples = rawRuns.flat();
  return {
    schemaVersion: 1,
    kind: 'ux025-packaged-performance',
    commit: expectedSha,
    measuredAt,
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    scenario: { executable: CANONICAL_EXECUTABLE, rootPid, durationMs, cadenceMs, runs, processSelection: 'root-and-recursive-children' },
    runs: rawRuns,
    summary: {
      cpuPercent: { median: percentile(samples.map((entry) => entry.cpuPercent), 0.5), p95: percentile(samples.map((entry) => entry.cpuPercent), 0.95) },
      rssKb: { median: percentile(samples.map((entry) => entry.rssKb), 0.5), p95: percentile(samples.map((entry) => entry.rssKb), 0.95) },
    },
  };
}

export async function runPackagedMeasurement(argv) {
  const args = parsePackagedArgs(argv);
  validateCheckpoint(args.stateFile, args.expectedSha);
  sample(args.rootPid);
  const rawRuns = [];
  for (let run = 0; run < args.runs; run += 1) {
    const samples = [];
    const count = Math.ceil(args.durationMs / args.cadenceMs);
    for (let index = 0; index < count; index += 1) {
      samples.push(sample(args.rootPid));
      if (index + 1 < count) await sleep(args.cadenceMs);
    }
    rawRuns.push(samples);
  }
  const report = buildPackagedReport({ ...args, rawRuns });
  mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  writeFileSync(path.resolve(args.output), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runPackagedMeasurement(process.argv.slice(2));
    console.log(JSON.stringify(report.summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

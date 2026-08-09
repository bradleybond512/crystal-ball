import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('CLI exposes stable help and offline capability contracts', () => {
  const help = run(['help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /doctor/);
  assert.match(help.stdout, /safeguard-demo/);
  assert.match(help.stdout, /evidence/);
  assert.match(help.stdout, /evaluation-report/);

  const capabilities = run(['capabilities', '--json']);
  assert.equal(capabilities.status, 0, capabilities.stderr);
  const payload = JSON.parse(capabilities.stdout);
  assert.equal(payload.tools.length, 61);
  assert.equal(payload.compatibility.protocol, '2025-03-26');
  assert.ok(payload.tools.every((tool) => tool.permission?.label));
});

test('CLI reads latest weekly evaluation reports in human and JSON formats', () => {
  const home = mkdtempSync(join(tmpdir(), 'crystalball-cli-evaluation-'));
  const currentWeek = utcMonday(Date.now());
  const weekStart = currentWeek - 7 * 24 * 60 * 60_000;
  const directory = join(home, '.crystal-ball', 'monitor', 'evaluation-reports');
  mkdirSync(directory, { recursive: true });
  const report = unavailableReport(weekStart, currentWeek);
  writeFileSync(join(directory, `weekly-${dateOnly(weekStart)}.json`), JSON.stringify(report));

  const human = run(['evaluation-report'], { HOME: home });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, new RegExp(dateOnly(weekStart)));
  assert.match(human.stdout, /restore_monitor/);

  const json = run(['evaluation-report', '--json', '--week', dateOnly(weekStart)], { HOME: home });
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), {
    available: true,
    reasonCode: null,
    report,
  });
});

test('CLI weekly evaluation uses closed no-data and usage exit semantics', () => {
  const home = mkdtempSync(join(tmpdir(), 'crystalball-cli-evaluation-empty-'));
  const missing = run(['evaluation-report', '--json'], { HOME: home });
  assert.equal(missing.status, 2, missing.stderr);
  assert.deepEqual(JSON.parse(missing.stdout), {
    available: false,
    reasonCode: 'no_weekly_report',
    report: null,
  });

  const generate = run(['evaluation-report', '--generate', '--json'], { HOME: home });
  assert.equal(generate.status, 2, generate.stderr);
  assert.deepEqual(JSON.parse(generate.stdout), {
    available: false,
    reasonCode: 'no_weekly_accumulator',
    finalizedReports: [],
    reports: [],
    accumulator: null,
  });

  const currentWeek = utcMonday(Date.now());
  const initializedWeekStart = currentWeek - 7 * 24 * 60 * 60_000;
  const monitorDirectory = join(home, '.crystal-ball', 'monitor');
  mkdirSync(monitorDirectory, { recursive: true });
  writeFileSync(join(monitorDirectory, 'weekly-accumulator.json'), JSON.stringify({
    schemaVersion: 1,
    initializedWeekStart,
    lastFinalizedWeekStart: null,
    omittedCatchupWeeks: 0,
    weeks: [],
  }));
  const generated = run(['evaluation-report', '--generate', '--json'], { HOME: home });
  assert.equal(generated.status, 0, generated.stderr);
  const generatedPayload = JSON.parse(generated.stdout);
  assert.equal(generatedPayload.available, true);
  assert.equal(generatedPayload.finalizedReports.length, 1);
  assert.equal(generatedPayload.finalizedReports[0].period.weekStart, initializedWeekStart);

  const generatedSelection = run([
    'evaluation-report',
    '--generate',
    '--week',
    dateOnly(initializedWeekStart),
    '--json',
  ], { HOME: home });
  assert.equal(generatedSelection.status, 0, generatedSelection.stderr);
  assert.equal(JSON.parse(generatedSelection.stdout).report.period.weekStart, initializedWeekStart);

  for (const args of [
    ['evaluation-report', '--week', '2026-07-28'],
    ['evaluation-report', '--week'],
    ['evaluation-report', '--unknown'],
    ['evaluation-report', '--json', '--json'],
  ]) {
    const invalid = run(args, { HOME: home });
    assert.equal(invalid.status, 64, `${args.join(' ')}\n${invalid.stderr}`);
  }
});

test('CLI safeguard demo never depends on local runtime state', () => {
  const result = run(['safeguard-demo', '--json'], {
    HOME: '/definitely/not/a/real/home',
    CRYSTALBALL_DATA_DIR: '/definitely/not/state',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).passed, true);
});

test('CLI exports Evidence Packet v1 with restrictive permissions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'crystalball-cli-evidence-'));
  const input = join(directory, 'input.json');
  const output = join(directory, 'packet.json');
  writeFileSync(input, JSON.stringify({
    generatedAt: '2026-07-31T12:00:00.000Z',
    query: { tool: 'get_sitrep' },
    result: { summary: 'ok', sources: ['/api/health'] },
  }));
  const result = run(['evidence', '--input', input, '--output', output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).schemaVersion, 1);
  assert.equal(statSync(output).mode & 0o777, 0o600);
});

test('CLI returns EX_USAGE for unknown commands', () => {
  const result = run(['unknown-command']);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /Unknown command/);
});

test('CLI monitor exits degraded for an old green state whose scheduler stopped', () => {
  const home = mkdtempSync(join(tmpdir(), 'crystalball-cli-monitor-'));
  const monitorDir = join(home, '.crystal-ball', 'monitor');
  mkdirSync(monitorDir, { recursive: true });
  const generationId = 'monitor-generation-v1-1785000000000';
  writeFileSync(join(monitorDir, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    available: true,
    status: 'green',
    lastRunAt: Date.now() - 60 * 60_000,
    summary: 'Old green state.',
    findings: [],
    recovered: [],
    activeIds: [],
    snapshot: { feeds: {}, quarantinedAlgorithms: [] },
  }));
  writeFileSync(join(monitorDir, 'events.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    schedule: {
      expectedIntervalMs: 15 * 60_000,
      stoppedGraceMs: 0,
      lastRunAt: Date.now() - 60 * 60_000,
      nextRunAt: Date.now() - 45 * 60_000,
    },
    activeFindings: {},
    cooldowns: {},
    events: [],
  }));
  const result = run(['monitor', '--json'], { HOME: home });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).schedule.status, 'stopped');
});

test('CLI doctor does not treat an unrelated Codex config as Crystal Ball registration', () => {
  const home = mkdtempSync(join(tmpdir(), 'crystalball-cli-doctor-'));
  const codexDir = join(home, '.codex');
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(join(codexDir, 'config.toml'), '[mcp_servers.other]\ncommand = "other-mcp"\n');
  let result = run(['doctor', '--json'], { HOME: home });
  let report = JSON.parse(result.stdout);
  assert.equal(report.checks.clients.configured, 0);

  writeFileSync(join(codexDir, 'config.toml'), '[mcp_servers.crystalball]\ncommand = "crystalball-mcp"\n');
  result = run(['doctor', '--json'], { HOME: home });
  report = JSON.parse(result.stdout);
  assert.equal(report.checks.clients.configured, 1);

  writeFileSync(join(codexDir, 'config.toml'), [
    '[mcp_servers.crystalball]',
    'enabled = false',
    '[mcp_servers.other]',
    'command = "crystalball-mcp"',
  ].join('\n'));
  result = run(['doctor', '--json'], { HOME: home });
  report = JSON.parse(result.stdout);
  assert.equal(report.checks.clients.configured, 0);
});

function utcMonday(at) {
  const date = new Date(at);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return midnight - ((date.getUTCDay() + 6) % 7) * 24 * 60 * 60_000;
}

function dateOnly(at) {
  return new Date(at).toISOString().slice(0, 10);
}

function unavailableReport(weekStart, generatedAt) {
  return {
    schemaVersion: 1,
    reportType: 'weekly_evaluation',
    generatedAt,
    period: {
      weekStart,
      weekEnd: weekStart + 7 * 24 * 60 * 60_000,
      timezone: 'UTC',
      complete: true,
    },
    availability: 'unavailable',
    coverage: {
      observations: 0,
      fresh: 0,
      stale: 0,
      unavailable: 0,
      firstObservedAt: null,
      lastObservedAt: null,
    },
    championChallenger: { availability: 'unavailable', active: null, challengers: [] },
    predictions: { availability: 'unavailable', endOfWeek: null, changeDuringWeek: null },
    drift: {
      model: {
        availability: 'unavailable',
        brierStart: null,
        brierEnd: null,
        brierDelta: null,
        resolutionCoverageStart: null,
        resolutionCoverageEnd: null,
        largestVersionLossShare: null,
      },
      providers: { availability: 'unavailable', rows: [] },
    },
    changes: {
      promoted: { availability: 'unavailable', count: null, rows: [], omitted: 0 },
      rejected: {
        availability: 'unavailable',
        count: null,
        reasonCode: 'no_runtime_rejection_history',
      },
    },
    nextRecommendedTask: {
      availability: 'available',
      scope: 'operational',
      code: 'restore_monitor',
      roadmapTask: null,
    },
    limitations: [
      'app_closed',
      'partial_week',
      'no_rejection_ledger',
      'roadmap_metadata_unavailable',
    ],
  };
}

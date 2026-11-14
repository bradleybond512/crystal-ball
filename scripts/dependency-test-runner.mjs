#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { globSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPENDENCY_GRAPHS, changedFilesBetween, commandToStages, dependencySelection, readTrustedPolicy } from './targeted-tests.mjs';

const MAX_STAGE_MS = 600_000;
const MAX_OUTPUT = 16 * 1024 * 1024;
const npm = path.join(path.dirname(process.execPath), 'npm');
const self = fileURLToPath(import.meta.url);
const projects = { root: '.', fixtures: '.', codex: '.github/tools/codex', marketing: 'marketing-site', scripts: 'scripts', 'cb-control': 'tools/cb-control', mcp: 'tools/mcp-server' };
const fixtureSuites = ['test:globe-overlay', 'test:finance', 'test:climate', 'test:native-lows', 'test:advisor-json-extraction', 'test:angle-span-text', 'test:spc-angle', 'test:foreign-mil-angle', 'test:dsca-angle'];
const rootSuites = ['test:install-scripts', 'test:workflow-security', 'test:domain-retirement', 'test:desktop-identity', 'test:e2e:ci-wiring', 'test:supply-chain-gates', 'test:ux054', 'test:renderer'];
const graphSuites = { root: rootSuites, fixtures: fixtureSuites, codex: ['test:agentic-pipeline', 'test:install-scripts', 'test:supply-chain-gates'], mcp: ['test:mcp-untrusted', 'test:mcp-companion'] };

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function sha(value) {
  check(/^[a-f0-9]{40}$/.test(value ?? ''), 'an exact commit SHA is required');
  return value;
}

function git(repo, args) {
  return execFileSync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
}

function testStage(id, files, repo, extra = {}) {
  const expanded = [...new Set(files.flatMap(file => {
    const matched = [...globSync(file, { cwd: repo })];
    check(matched.length > 0 && matched.every(name => lstatSync(path.join(repo, name)).isFile()), `missing or nonregular test input for ${id}`);
    return matched;
  }))].sort();
  check(expanded.length > 0, `no test files discovered for ${id}`);
  return { id, bin: process.execPath, args: ['--test-reporter=tap', '--test', ...expanded], kind: 'test', testFiles: expanded, timeoutMs: MAX_STAGE_MS, ...extra };
}

function stage(id, bin, args, kind = 'setup', extra = {}) {
  return { id, bin, args, kind, timeoutMs: MAX_STAGE_MS, ...extra };
}

export function graphStages(graph, repo, metadata) {
  check(DEPENDENCY_GRAPHS.includes(graph), 'unknown dependency graph');
  const install = dir => stage(`install-${dir === '.' ? 'root' : Object.keys(projects).find(id => projects[id] === dir)}`, npm, ['--prefix', dir, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--userconfig=/dev/null', '--globalconfig=/dev/null']);
  const stages = [stage('npm-version', npm, ['--version'], 'probe', { timeoutMs: 30_000 }), install('.')];
  if (projects[graph] !== '.') stages.push(install(projects[graph]));
  if (['root', 'codex'].includes(graph)) stages.push(install(projects.mcp));
  const suite = name => {
    const command = metadata.scripts[name];
    check(typeof command === 'string', `missing policy-owned suite ${name}`);
    for (const [i, commandStage] of commandToStages(command, path.join(repo, 'node_modules/.bin'), metadata.scripts, {}).entries()) {
      const id = `${name.replaceAll(':', '-')}-${i}`;
      if (commandStage.args.includes('--test')) {
        const files = commandStage.args.filter(arg => /\.test\.(?:[cm]?[jt]s|tsx)$/.test(arg) || (arg.includes('*') && /\.(?:[cm]?[jt]s|tsx)$/.test(arg)));
        const expanded = testStage(id, files, repo);
        const args = commandStage.args.flatMap(arg => files.includes(arg) ? [...globSync(arg, { cwd: repo })] : [arg]);
        stages.push({ ...expanded, ...commandStage, args: ['--test-reporter=tap', ...args], kind: 'test', testFiles: expanded.testFiles, timeoutMs: MAX_STAGE_MS });
      } else stages.push(stage(id, commandStage.bin, commandStage.args, 'build', { env: commandStage.env }));
    }
  };
  for (const name of graphSuites[graph] ?? []) suite(name);
  if (graph === 'codex') {
    stages.push(stage('codex-version', process.execPath, ['.github/tools/codex/node_modules/@openai/codex/bin/codex.js', '--version'], 'probe', { timeoutMs: 30_000 }));
  }
  if (graph === 'mcp') {
    stages.push(testStage('mcp-package', ['tools/mcp-server/__tests__/*.test.mjs'], repo, {
      args: ['--import', path.join(repo, 'tests/helpers/loopback-only.mjs'), '--test-reporter=tap', '--test', ...globSync('tools/mcp-server/__tests__/*.test.mjs', { cwd: repo })],
    }));
  }
  if (graph === 'marketing') {
    const cwd = path.join(repo, 'marketing-site');
    for (const [id, args] of [
      ['generate-data', ['scripts/generate-site-data.mjs']], ['generate-discovery', ['scripts/generate-discovery.mjs']],
      ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
      ['lint', ['node_modules/eslint/bin/eslint.js', '.', '--ignore-pattern', 'dist', '--ignore-pattern', '.next']],
      ['build', ['node_modules/vinext/dist/cli.js', 'build']],
    ]) stages.push(stage(id, process.execPath, args, 'build', { cwd, env: { WRANGLER_LOG_PATH: path.join(tmpdir(), 'dependency-marketing-wrangler.log') } }));
    stages.push(testStage('marketing-tests', ['tests/*.test.mjs'], cwd, { cwd }));
  }
  if (graph === 'scripts') {
    stages.push(testStage('ais-regressions', ['scripts/ais-relay-rss.test.cjs', 'scripts/ais-relay-cors.test.cjs'], repo));
  }
  if (graph === 'cb-control') {
    stages.push(
      stage('native-lifecycle-probe', process.execPath, [self, 'lifecycle-probe'], 'probe', { timeoutMs: 30_000 }),
      stage('sqlite-build', npm, ['--prefix', 'tools/cb-control/node_modules/better-sqlite3', '--ignore-scripts', 'run', 'build-release']),
      stage('pty-build', npm, ['--prefix', 'tools/cb-control/node_modules/node-pty', '--ignore-scripts', 'run', 'install']),
    );
  }
  if (['scripts', 'cb-control'].includes(graph)) {
    stages.push(testStage('runtime-contracts', [`tests/dependency-runtime/${graph}.test.mjs`], repo),
      testStage('runtime-mutations', ['scripts/dependency-runtime-mutations.mjs'], repo, { env: { CB_DEPENDENCY_GRAPH: graph } }));
  }
  return stages;
}

export function parseTestCounts(stdout) {
  const lines = stdout.trimEnd().split(/\r?\n/);
  const start = lines.findLastIndex(line => /^# tests \d+$/.test(line));
  check(start !== -1 && lines.slice(0, start).includes('TAP version 13') && lines.slice(0, start).some(line => /^1\.\.[1-9]\d*$/.test(line)), 'missing complete positive TAP');
  check(!lines.some(line => line.trimStart().startsWith('Bail out!')), 'TAP bailout');
  const keys = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
  check(lines.length === start + keys.length + 1, 'trailing or truncated TAP');
  const result = {};
  for (const [i, key] of keys.entries()) {
    const match = new RegExp(String.raw`^# ${key} (\d+)$`).exec(lines[start + i]);
    check(match && Number.isSafeInteger(Number(match[1])), 'invalid TAP count');
    result[key] = Number(match[1]);
  }
  check(/^# duration_ms \d+(?:\.\d+)?$/.test(lines.at(-1)), 'missing TAP duration');
  check(result.tests > 0 && result.pass === result.tests && ['fail', 'cancelled', 'skipped', 'todo'].every(key => result[key] === 0), 'test execution incomplete or failed');
  return result;
}

export function isolatedEnvironment(dir, inherited = process.env) {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'CI', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT']) if (inherited[key]) env[key] = inherited[key];
  for (const [key, folder] of Object.entries({ HOME: 'home', TMPDIR: 'tmp', XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data', CB_CONTROL_DIR: 'cb-control', NPM_CONFIG_CACHE: 'npm-cache' })) {
    env[key] = path.join(dir, folder);
    mkdirSync(env[key], { recursive: true });
  }
  return { ...env, NO_COLOR: '1', NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_GLOBALCONFIG: '/dev/null' };
}

export async function executeStage(stage, { cwd, env }) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  return new Promise(resolve => {
    let stdout = '', stderr = '', bytes = 0, overflow = false, timedOut = false, launchError = false;
    const child = spawn(stage.bin, stage.args, { cwd: stage.cwd ?? cwd, env: { ...env, ...stage.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') launchError = true; }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, stage.timeoutMs);
    const capture = (part, target) => {
      bytes += part.length;
      if (bytes > (stage.maxBytes ?? MAX_OUTPUT)) { overflow = true; stop(); return; }
      if (target === 'out') stdout += part.toString(); else stderr += part.toString();
    };
    child.stdout.on('data', part => capture(part, 'out'));
    child.stderr.on('data', part => capture(part, 'err'));
    child.on('error', () => { launchError = true; });
    child.on('close', exitCode => {
      clearTimeout(timer);
      stop();
      let status = exitCode === 0 && !overflow && !launchError ? 'passed' : 'failed';
      if (timedOut) status = 'timed_out';
      resolve({ startedAt, durationMs: Date.now() - started, status, exitCode, stdout, stderr, overflow });
    });
  });
}

export function aggregateReceipts(plan, receipts) {
  const failures = [];
  const notExecuted = [];
  for (const graph of plan.graphs) {
    const matches = receipts.filter(row => row.graph === graph);
    const row = matches[0];
    if (matches.length !== 1 || row.policySha !== plan.policySha || row.executionSha !== plan.executionSha || row.mode !== plan.mode) {
      failures.push(`${graph}: missing or inconsistent receipt`);
      notExecuted.push(...plan.stages[graph].map(item => `${graph}/${item.id}`));
      continue;
    }
    const expected = plan.stages[graph];
    if (!Array.isArray(row.stages) || row.stages.length !== expected.length) { failures.push(`${graph}: missing stage receipts`); continue; }
    for (const [i, stage] of row.stages.entries()) {
      if (stage.stageId !== expected[i].id || stage.kind !== expected[i].kind || stage.status !== 'passed' || stage.exitCode !== 0
          || (stage.kind === 'test' && (!Number.isSafeInteger(stage.discoveredTestFiles) || stage.discoveredTestFiles <= 0 || !Number.isSafeInteger(stage.executedCases) || stage.executedCases <= 0))) failures.push(`${graph}/${expected[i].id}: ${stage.status ?? 'missing'}`);
    }
  }
  if (receipts.some(row => !plan.graphs.includes(row.graph))) failures.push('unexpected graph receipt');
  return { passed: failures.length === 0, failures, notExecuted };
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function options(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    check(/^--[a-z-]+$/.test(args[i]) && args[i + 1] !== undefined && !Object.hasOwn(values, args[i].slice(2)), 'invalid command options');
    values[args[i].slice(2)] = args[i + 1];
  }
  return values;
}

function validatePlan(plan) {
  check(plan?.schemaVersion === 1 && ['trusted', 'preview'].includes(plan.mode), 'invalid dependency plan');
  sha(plan.policySha); sha(plan.executionSha);
  check(Array.isArray(plan.graphs) && new Set(plan.graphs).size === plan.graphs.length && plan.graphs.every(graph => DEPENDENCY_GRAPHS.includes(graph)), 'invalid graph plan');
  check(plan.stages && plan.graphs.every(graph => Array.isArray(plan.stages[graph]) && plan.stages[graph].length > 0
    && plan.stages[graph].every(item => /^[a-z0-9-]+$/.test(item.id) && ['setup', 'probe', 'build', 'test'].includes(item.kind))), 'missing planned stages');
}

function planRun(opts, repo) {
  const policySha = sha(opts['policy-sha']);
  const executionSha = sha(opts['execution-sha']);
  check(git(repo, ['rev-parse', 'HEAD']).trim() === executionSha, 'execution checkout mismatch');
  check(['trusted', 'preview'].includes(opts.mode), 'invalid policy mode');
  check(opts.event !== 'schedule' || (opts.mode === 'trusted' && policySha === executionSha), 'scheduled policy must equal execution commit');
  const all = ['schedule', 'workflow_dispatch', 'workflow_call'].includes(opts.event);
  const baseSha = sha(opts['base-sha']);
  const changed = all ? [] : changedFilesBetween(repo, baseSha, executionSha);
  const selection = dependencySelection(changed);
  const graphs = all ? [...DEPENDENCY_GRAPHS] : selection.graphs;
  const metadata = readTrustedPolicy(repo, policySha);
  const plan = { schemaVersion: 1, policySha, executionSha, mode: opts.mode, event: opts.event, graphs, gaps: selection.gaps,
    stages: Object.fromEntries(graphs.map(graph => [graph, graphStages(graph, repo, metadata).map(stage => ({ id: stage.id, kind: stage.kind }))])) };
  writeJson(opts.out, plan);
  console.log(JSON.stringify(plan));
}

async function runGraph(opts, repo) {
  check(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted', 'dependency graph execution requires disposable hosted Linux');
  const plan = JSON.parse(readFileSync(opts.plan, 'utf8'));
  validatePlan(plan);
  check(plan.graphs.includes(opts.graph), 'graph was not planned');
  check(git(repo, ['rev-parse', 'HEAD']).trim() === plan.executionSha, 'execution checkout mismatch');
  const stages = graphStages(opts.graph, repo, readTrustedPolicy(repo, plan.policySha));
  check(JSON.stringify(stages.map(stage => ({ id: stage.id, kind: stage.kind }))) === JSON.stringify(plan.stages[opts.graph]), 'planned stages changed');
  const output = path.resolve(opts.out, opts.graph);
  check(!output.startsWith(`${path.resolve(repo)}${path.sep}`), 'receipts must be outside the checkout');
  const owned = mkdtempSync(path.join(tmpdir(), 'dependency-run-'));
  const env = isolatedEnvironment(owned);
  const receipt = { schemaVersion: 1, graph: opts.graph, policySha: plan.policySha, executionSha: plan.executionSha, mode: plan.mode, event: plan.event,
    nodeVersion: process.version, lockSha256: createHash('sha256').update(readFileSync(path.join(repo, projects[opts.graph], 'package-lock.json'))).digest('hex'),
    stages: stages.map(stage => ({ stageId: stage.id, kind: stage.kind, commandId: stage.id, status: 'not_executed', exitCode: null })) };
  const receiptPath = path.join(output, 'receipt.json');
  writeJson(receiptPath, receipt);
  let failed = false;
  try {
    for (const [i, stage] of stages.entries()) {
      if (failed) break;
      const result = await executeStage(stage, { cwd: repo, env });
      const record = { ...receipt.stages[i], startedAt: result.startedAt, durationMs: result.durationMs, status: result.status, exitCode: result.exitCode, logArtifact: `${opts.graph}/${stage.id}.log` };
      if (stage.kind === 'test' && record.status === 'passed') {
        try {
          const counts = parseTestCounts(result.stdout);
          record.discoveredTestFiles = stage.testFiles.length;
          record.executedCases = counts.pass;
          record.counts = counts;
        } catch { record.status = 'failed'; }
      }
      writeFileSync(path.join(output, `${stage.id}.log`), `${result.stdout}\n${result.stderr}`);
      receipt.stages[i] = record;
      writeJson(receiptPath, receipt);
      const counts = record.executedCases ? ` (${record.executedCases} cases)` : '';
      console.log(`${opts.graph}/${stage.id}: ${record.status}${counts}`);
      failed = record.status !== 'passed';
    }
  } finally { rmSync(owned, { recursive: true, force: true }); }
  check(!failed, 'dependency graph did not complete successfully');
}

function lifecycleProbe() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dependency-npm-lifecycle-'));
  try {
    const marker = path.join(dir, 'calls');
    const quote = value => {
      const escaped = value.replaceAll("'", String.raw`'\''`);
      return `'${escaped}'`;
    };
    const command = word => {
      writeFileSync(path.join(dir, `${word}.cjs`), `require('node:fs').appendFileSync(require('node:path').join(__dirname,'calls'),${JSON.stringify(word)});\n`);
      return `${quote(process.execPath)} ${word}.cjs`;
    };
    writeJson(path.join(dir, 'package.json'), { private: true, scripts: { preinstall: command('pre'), install: command('target'), postinstall: command('post') } });
    const result = spawnSync(npm, ['--ignore-scripts', 'run', 'install'], { cwd: dir, env: isolatedEnvironment(dir), encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 });
    check(result.status === 0 && readFileSync(marker, 'utf8') === 'target', 'explicit npm target lifecycle isolation failed');
    const npmVersion = execFileSync(npm, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
    const nodeGypVersion = JSON.parse(readFileSync(path.resolve(realpathSync(npm), '../../node_modules/node-gyp/package.json'), 'utf8')).version;
    console.log(JSON.stringify({ node: process.version, npm: npmVersion, nodeGyp: nodeGypVersion, lifecycleProbe: 'only explicit target executed' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const opts = options(args);
  const repo = process.cwd();
  if (command === 'plan') planRun(opts, repo);
  else if (command === 'run') await runGraph(opts, repo);
  else if (command === 'lifecycle-probe') lifecycleProbe();
  else if (command === 'aggregate') {
    const plan = JSON.parse(readFileSync(opts.plan, 'utf8'));
    validatePlan(plan);
    const receipts = plan.graphs.flatMap(graph => {
      try { return [JSON.parse(readFileSync(path.join(opts.results, graph, 'receipt.json'), 'utf8'))]; } catch { return []; }
    });
    const result = aggregateReceipts(plan, receipts);
    console.log(JSON.stringify({ mode: plan.mode, policySha: plan.policySha, executionSha: plan.executionSha, ...result }, null, 2));
    check(result.passed, 'dependency coverage has failed or missing execution');
  } else throw new Error('unknown dependency runner command');
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

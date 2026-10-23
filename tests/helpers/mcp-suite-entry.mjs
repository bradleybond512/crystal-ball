// Test-entry adapter for the trusted selector's existing plain node --test format.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { sourceFixture } from './mcp-runtime-fixture.mjs';
import { SIDECAR_REMAINING_NODE_FILES, SIDECAR_REMAINING_TSX_FILES } from './sidecar-ci-inventory.mjs';

const { join } = path;
export const STAGE_TIMEOUT_MS = 150_000;
export const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const TERM_GRACE_MS = 500;
const KILL_GRACE_MS = 2_000;
export const SUITE_STAGES = Object.freeze({
  untrusted: Object.freeze([
    Object.freeze(['--import', 'tsx', '--test', 'src/services/__tests__/agent-suggestions.test.mts', 'src/services/__tests__/analyst-command-listener.test.mts', 'src/components/__tests__/analyst-hud-agent-suggestions.test.mts']),
    Object.freeze(['--test', 'src-tauri/sidecar/__tests__/analyst-commands-origin.test.mjs', 'tools/mcp-server/__tests__/profile.test.mjs', 'tools/mcp-server/__tests__/framing.test.mjs', 'tools/mcp-server/__tests__/untrusted-framing-stdio.test.mjs', 'tools/mcp-server/__tests__/stdio-integration.test.mjs']),
  ]),
  companion: Object.freeze([
    Object.freeze(['--test', 'tools/mcp-server/__tests__/help-tool.test.mjs', 'tools/mcp-server/__tests__/analyst-tools.test.mjs', 'tools/mcp-server/__tests__/tool-registry.test.mjs', 'tools/mcp-server/__tests__/stdio-integration.test.mjs', 'src-tauri/sidecar/__tests__/analyst-diagnostics-mirror.test.mjs', 'tools/mcp-server/__tests__/runtime-isolation.test.mjs']),
  ]),
  'install-smoke': Object.freeze([
    Object.freeze(['--test', 'tools/mcp-server/__tests__/install-smoke.test.mjs']),
  ]),
  'sidecar-remaining': Object.freeze([
    Object.freeze(['--test', ...SIDECAR_REMAINING_NODE_FILES]),
    Object.freeze(['--import', 'tsx', '--test', ...SIDECAR_REMAINING_TSX_FILES]),
  ]),
  'port-publication': Object.freeze([
    Object.freeze(['--test', 'tests/sidecar-port-publication.test.mjs', 'tests/sidecar-supervisor-boundary.test.mjs']),
    Object.freeze(['--import', 'tsx', '--test', 'src/services/diagnostics/__tests__/local-engine-status.test.mts']),
  ]),
});

export function parseFinalTap(stdout) {
  const lines = stdout.trimEnd().split(/\r?\n/);
  const starts = lines.map((line, i) => /^# tests \d+$/.test(line) ? i : -1).filter((i) => i !== -1);
  const start = starts.at(-1);
  if (start === undefined || !lines.slice(0, start).some((line) => /^TAP version 13$/.test(line))
      || !lines.slice(0, start).some((line) => /^1\.\.[1-9]\d*$/.test(line))) throw new Error('Missing complete top-level inner TAP summary.');
  const names = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
  const summary = lines.slice(start);
  if (summary.length !== names.length + 1) throw new Error('Truncated or trailing inner TAP summary.');
  const counts = {};
  for (let i = 0; i < names.length; i += 1) {
    const match = new RegExp(`^# ${names[i]} (\\d+)$`).exec(summary[i]);
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error(`Malformed inner TAP ${names[i]} count.`);
    counts[names[i]] = Number(match[1]);
  }
  const duration = /^# duration_ms (\d+(?:\.\d+)?)$/.exec(summary.at(-1));
  if (!duration || !Number.isFinite(Number(duration[1]))) throw new Error('Missing complete inner TAP duration.');
  counts.duration_ms = Number(duration[1]);
  return counts;
}
export function validateStageResult(result) {
  if (result.error) throw new Error(`Inner suite launch failed: ${result.error.message ?? result.error}`);
  if (result.timedOut) throw new Error('Inner suite timed out.');
  if (result.aborted) throw new Error('Inner suite aborted.');
  if (result.overflowed) throw new Error('Inner suite output exceeded the finite capture limit.');
  if (result.cleanupError) throw new Error(`Owned descendant cleanup failed: ${result.cleanupError.message}`);
  if (result.signal) throw new Error(`Inner suite terminated by ${result.signal}.`);
  if (result.status !== 0) throw new Error(`Inner suite exited ${result.status}.`);
  if (/^\s*Bail out!/m.test(`${result.stdout}\n${result.stderr}`)) throw new Error('Inner suite reported a TAP bailout.');
  const counts = parseFinalTap(result.stdout);
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) {
    if (counts[name] !== 0) throw new Error(`Inner suite has ${counts[name]} ${name} tests.`);
  }
  if (counts.tests < 1 || counts.pass < 1 || counts.tests !== counts.pass) throw new Error('Inner suite has no complete positive passing test set.');
  return counts;
}
function groupSignal(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Refusing to signal an unowned process group.');
  try { process.kill(-pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function stopOwnedGroup(pid) {
  if (!groupSignal(pid, 'SIGTERM')) return;
  await delay(TERM_GRACE_MS);
  if (!groupSignal(pid, 0)) return;
  groupSignal(pid, 'SIGKILL');
  const deadline = Date.now() + KILL_GRACE_MS;
  while (groupSignal(pid, 0)) {
    if (Date.now() >= deadline) throw new Error(`Owned process group ${pid} did not stop after SIGKILL.`);
    await delay(50);
  }
}
function artifactDirectory() {
  const requested = process.env.CB_TEST_ARTIFACT_DIR;
  if (!requested) return null;
  try {
    const stat = lstatSync(requested);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) return null;
    return realpathSync(requested);
  } catch { return null; }
}
function reportStage(result, fixture, t, artifacts) {
  const root = artifacts ?? fixture.root;
  const stem = `mcp-${result.suite}-stage-${result.stage}-${randomUUID()}`;
  const stdout = join(root, `${stem}.stdout.log`); const stderr = join(root, `${stem}.stderr.log`);
  writeFileSync(stdout, result.stdout, { flag: 'wx' }); writeFileSync(stderr, result.stderr, { flag: 'wx' });
  const metadata = { ...result, stdout: undefined, stderr: undefined, error: result.error?.message,
    cleanupError: result.cleanupError?.message, stdoutFile: stdout, stderrFile: stderr };
  writeFileSync(join(root, `${stem}.json`), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  t.diagnostic(`${result.suite} stage ${result.stage}: inner counts ${JSON.stringify(result.counts ?? null)}; status=${result.status}; signal=${result.signal ?? 'none'}. Outer orchestration counts are separate.`);
  if (artifacts) t.diagnostic(`Raw inner stage logs: ${stdout} ; ${stderr}`);
  else {
    t.diagnostic(`${result.suite} stage ${result.stage} raw stdout:\n${result.stdout}`);
    if (result.stderr) t.diagnostic(`${result.suite} stage ${result.stage} raw stderr:\n${result.stderr}`);
  }
}
async function captureStage(fixture, args, signal) {
  const result = { status: null, signal: null, error: null, timedOut: false, aborted: false,
    overflowed: false, cleanupError: null, stdout: '', stderr: '' };
  let child; let pid; let bytes = 0; let termination; let timer;
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  function terminate() {
    if (!pid) return Promise.resolve();
    termination ??= stopOwnedGroup(pid).catch((error) => { result.cleanupError = error; });
    return termination;
  }
  function output(name, chunk) {
    const remaining = Math.max(0, OUTPUT_LIMIT_BYTES - bytes);
    const kept = chunk.subarray(0, remaining); result[name] += decoders[name].write(kept); bytes += kept.length;
    if (chunk.length > remaining) { result.overflowed = true; void terminate(); }
  }
  const abort = () => { result.aborted = true; void terminate(); };
  try {
    child = spawn(process.execPath, ['--import', join(fixture.repo, 'tests/helpers/loopback-only.mjs'), join(fixture.repo, 'tests/helpers/run-isolated-mcp.mjs'), ...args], {
      cwd: fixture.repo, env: { ...fixture.env, CB_TEST_RUNNER_GROUP: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (Number.isSafeInteger(child.pid) && child.pid > 0) pid = child.pid;
    child.stdout.on('data', (chunk) => output('stdout', chunk));
    child.stderr.on('data', (chunk) => output('stderr', chunk));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(() => { result.timedOut = true; void terminate(); }, STAGE_TIMEOUT_MS);
    await new Promise((done) => {
      child.once('error', (error) => { result.error = error; });
      child.once('close', (status, closedSignal) => { result.status = status; result.signal = closedSignal; done(); });
    });
  } catch (error) { result.error = error; }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    await terminate();
    result.stdout += decoders.stdout.end(); result.stderr += decoders.stderr.end();
  }
  return result;
}
export async function runFixedSuite(suite, t) {
  if (!Object.hasOwn(SUITE_STAGES, suite)) throw new Error('Unknown fixed MCP suite identifier.');
  if (process.platform === 'win32') throw new Error('MCP suite isolation requires the existing POSIX process-group environment.');
  const results = []; const artifacts = artifactDirectory();
  for (const [index, args] of SUITE_STAGES[suite].entries()) {
    const fixture = sourceFixture();
    // The existing source fixture only forwards this input. Enforce destination
    // ownership before its nested installer/test helpers receive that path.
    if (artifacts) fixture.env.CB_TEST_ARTIFACT_DIR = artifacts;
    else delete fixture.env.CB_TEST_ARTIFACT_DIR;
    let result;
    try {
      result = { ...await captureStage(fixture, args, t.signal), suite, stage: index + 1, args: [...args] };
      let failure;
      try { result.counts = validateStageResult(result); } catch (error) { failure = error; }
      reportStage(result, fixture, t, artifacts);
      if (failure) throw failure;
      results.push(result);
    } finally {
      // A failed group stop retains its owned fixture for manual recovery;
      // never remove files that still-running descendants may be using.
      if (result?.cleanupError) t.diagnostic(`Owned fixture retained after cleanup failure: ${fixture.root}`);
      else fixture.cleanup();
    }
  }
  return results;
}

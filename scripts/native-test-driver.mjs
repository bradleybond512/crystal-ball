import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const inventory = JSON.parse(readFileSync(new URL('native-test-inventory.json', import.meta.url), 'utf8'));
export const stageIds = ['setup', 'metadata', 'compile', ...inventory.targets.flatMap(t => [`list:${t.name}`, `test:${t.name}`]), 'clippy', 'mutation'];
const triples = { 'linux-x64': 'x86_64-unknown-linux-gnu', 'darwin-arm64': 'aarch64-apple-darwin' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const unique = values => new Set(values).size === values.length;
const inside = (base, child) => { const relative = path.relative(base, child); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };

export function assertHostedPlatform({ platform = process.platform, arch = process.arch, env = process.env } = {}) {
  const id = `${platform}-${arch}`;
  requireThat(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted', 'Hosted runner required');
  requireThat(Object.hasOwn(triples, id), 'Unsupported runner architecture');
  requireThat(!env.RUNNER_OS || env.RUNNER_OS === (platform === 'linux' ? 'Linux' : 'macOS'), 'Runner OS mismatch');
  requireThat(!env.RUNNER_ARCH || env.RUNNER_ARCH === (arch === 'x64' ? 'X64' : 'ARM64'), 'Runner architecture mismatch');
  return id;
}

export function validateTargetInventory(targets, expectedTargets) {
  const keys = rows => rows.map(t => {
    requireThat(t && typeof t.name === 'string' && ['test', 'bin'].includes(t.kind), 'Invalid target');
    return `${t.kind}:${t.name}`;
  });
  const actual = keys(targets), expected = keys(expectedTargets);
  requireThat(expected.length > 0 && unique(actual) && unique(expected), 'Empty or duplicate targets');
  requireThat(actual.length === expected.length && expected.every(t => actual.includes(t)), 'Target inventory mismatch');
  return true;
}

function expectedTests(names) {
  requireThat(Array.isArray(names) && names.length > 0 && unique(names) && names.every(n => typeof n === 'string' && /^[\w:]+$/.test(n)), 'Invalid expected test inventory');
}

export function validateTestInventory(stdout, expectedNames) {
  expectedTests(expectedNames);
  const names = [...stdout.matchAll(/^([\w:]+): test$/gm)].map(m => m[1]);
  const footers = [...stdout.matchAll(/^(\d+) tests?, (\d+) benchmarks?$/gm)];
  requireThat(footers.length === 1 && Number(footers[0][1]) === expectedNames.length && Number(footers[0][2]) === 0, 'Invalid test list count');
  requireThat(unique(names) && names.length === expectedNames.length && expectedNames.every(n => names.includes(n)), 'Test inventory mismatch');
  requireThat(!/^.+: benchmark$/m.test(stdout), 'Unexpected benchmark');
  return names;
}

export function parseTestResult(stdout, expectedNames) {
  expectedTests(expectedNames);
  const results = [...stdout.matchAll(/^test ([\w:]+) \.\.\. (\S+)$/gm)];
  const footers = [...stdout.matchAll(/^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out; finished in [^\n]+$/gm)];
  const running = [...stdout.matchAll(/^running (\d+) tests?$/gm)];
  requireThat(footers.length === 1 && running.length === 1 && Number(running[0][1]) === expectedNames.length, 'Missing test execution result');
  const f = footers[0];
  const counts = { tests: Number(running[0][1]), passed: Number(f[2]), failed: Number(f[3]), ignored: Number(f[4]), measured: Number(f[5]), filtered: Number(f[6]) };
  requireThat(f[1] === 'ok' && counts.passed === expectedNames.length && [counts.failed, counts.ignored, counts.measured, counts.filtered].every(n => n === 0), 'Test execution failed or incomplete');
  requireThat(results.length === expectedNames.length && unique(results.map(m => m[1])) && results.every(m => m[2] === 'ok' && expectedNames.includes(m[1])), 'Missing or unexpected executed tests');
  return counts;
}

export function prepareWatchdogMutation(original) {
  const marker = 'assert!(!focus.snapshot().focused);';
  const source = original.toString();
  requireThat(source.split(marker).length === 2, 'Mutation marker must be unique');
  return source.replace(marker, 'assert!(focus.snapshot().focused);');
}

export function validateMutationFailure(result, expectedNames) {
  expectedTests(expectedNames);
  requireThat(expectedNames.includes('main_focus_tracks_gain_and_loss'), 'Mutation target test missing');
  requireThat(result.status === 'failed' && Number.isInteger(result.exitCode) && result.exitCode > 0, 'Mutation process did not fail');
  const results = [...result.stdout.matchAll(/^test ([\w:]+) \.\.\. (\S+)$/gm)];
  requireThat(results.length === expectedNames.length && unique(results.map(m => m[1])) && results.every(m => expectedNames.includes(m[1]) && m[2] === (m[1] === 'main_focus_tracks_gain_and_loss' ? 'FAILED' : 'ok')), 'Unexpected mutation failures');
  const repaired = result.stdout.replace('test main_focus_tracks_gain_and_loss ... FAILED', 'test main_focus_tracks_gain_and_loss ... ok')
    .replace(`test result: FAILED. ${expectedNames.length - 1} passed; 1 failed;`, `test result: ok. ${expectedNames.length} passed; 0 failed;`);
  const counts = parseTestResult(repaired, expectedNames);
  let rejected = false;
  try { parseTestResult(result.stdout, expectedNames); } catch { rejected = true; }
  requireThat(rejected, 'Failed test result was accepted');
  return { ...counts, passed: expectedNames.length - 1, failed: 1 };
}

export function validateLock(bytes, expectedSHA256) {
  requireThat(/^[a-f0-9]{64}$/.test(expectedSHA256) && hash(bytes) === expectedSHA256, 'Cargo lock changed');
  return true;
}

export function resolveRustTools(inherited, checkout) {
  requireThat(typeof inherited.PATH === 'string', 'Runner PATH required');
  const directories = inherited.PATH.split(path.delimiter);
  requireThat(directories.every(dir => path.isAbsolute(dir)), 'Runner PATH must contain only absolute directories');
  const root = realpathSync(checkout);
  const selected = {};
  for (const name of ['cargo', 'rustc']) {
    for (const directory of directories) {
      const candidate = path.join(directory, name);
      if (!existsSync(candidate)) continue;
      const canonical = realpathSync(candidate), parent = realpathSync(directory);
      requireThat(parent !== root && !inside(root, parent), 'Rust executable path is inside checkout');
      requireThat(statSync(canonical).isFile() && !inside(root, canonical) && canonical !== root, 'Unsafe Rust executable');
      accessSync(candidate, constants.X_OK);
      selected[name] = candidate;
      break;
    }
    requireThat(selected[name], 'Installed Rust executable missing from PATH');
  }
  return selected;
}

export function validateToolchain(rustVersion, clippyVersion, platformId) {
  requireThat(Object.hasOwn(triples, platformId), 'Unsupported toolchain platform');
  requireThat(/^release: 1\.93\.1$/m.test(rustVersion) && rustVersion.split('\n').includes(`host: ${triples[platformId]}`), 'Rust toolchain mismatch');
  requireThat(/^clippy 0\.1\.93 \(/.test(clippyVersion.trim()), 'Clippy toolchain mismatch');
  return true;
}

export function buildCommands(targets = inventory.targets) {
  validateTargetInventory(targets, inventory.targets);
  const selectors = targets.flatMap(t => [`--${t.kind}`, t.name]);
  const common = ['--locked', '--manifest-path', 'src-tauri/Cargo.toml'];
  return {
    compile: ['+1.93.1', 'test', ...common, '--no-run', '--message-format=json', ...selectors],
    clippy: ['+1.93.1', 'clippy', ...common, ...selectors, '--', '-D', 'warnings'],
  };
}

export function selectTestExecutables(stdout, targets, targetDir) {
  const base = realpathSync(targetDir), selected = {};
  for (const line of stdout.split('\n').filter(Boolean)) {
    let artifact;
    try { artifact = JSON.parse(line); } catch { throw new Error('Invalid Cargo artifact stream'); }
    if (artifact.reason !== 'compiler-artifact' || artifact.profile?.test !== true || !artifact.executable) continue;
    const target = targets.find(t => t.name === artifact.target?.name && artifact.target.kind?.includes(t.kind));
    requireThat(target && !selected[target.name], 'Unknown or duplicate test executable');
    requireThat(path.isAbsolute(artifact.executable) && lstatSync(artifact.executable).isFile(), 'Invalid test executable');
    const executable = realpathSync(artifact.executable);
    requireThat(inside(base, executable), 'Test executable escapes owned directory');
    selected[target.name] = executable;
  }
  requireThat(targets.length > 0 && targets.every(t => selected[t.name]), 'Missing test executable');
  return selected;
}

export function isolatedEnvironment(dir, inherited = process.env) {
  requireThat(path.isAbsolute(dir), 'Owned state path must be absolute');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  requireThat(lstatSync(dir).isDirectory(), 'Unsafe owned state directory');
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'RUSTUP_HOME', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'RUNNER_ARCH', 'ImageOS', 'ImageVersion', 'SDKROOT', 'DEVELOPER_DIR']) {
    if (typeof inherited[key] === 'string') env[key] = inherited[key];
  }
  for (const [key, relative] of Object.entries({ HOME: 'home', TMPDIR: 'tmp', TMP: 'tmp', TEMP: 'tmp', CARGO_TARGET_DIR: 'target', CARGO_HOME: 'cargo', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache', XDG_DATA_HOME: 'data', XDG_STATE_HOME: 'state', NPM_CONFIG_CACHE: 'npm-cache' })) {
    env[key] = path.join(dir, relative);
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
    requireThat(!lstatSync(env[key]).isSymbolicLink() && inside(realpathSync(dir), realpathSync(env[key])), 'Unsafe owned child directory');
  }
  for (const [key, filename] of [['NPM_CONFIG_USERCONFIG', 'npm-user.conf'], ['NPM_CONFIG_GLOBALCONFIG', 'npm-global.conf']]) {
    env[key] = path.join(dir, filename);
    requireThat(!existsSync(env[key]) || lstatSync(env[key]).isFile(), 'Unsafe npm config');
    writeFileSync(env[key], '', { mode: 0o600 });
  }
  Object.assign(env, { CI: 'true', CARGO_TERM_COLOR: 'never', RUST_BACKTRACE: '0', NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false' });
  return env;
}

export function executeStage(stage, { cwd, env }) {
  requireThat(stage && typeof stage.bin === 'string' && Array.isArray(stage.args) && stage.args.every(a => typeof a === 'string'), 'Invalid command');
  requireThat(Number.isSafeInteger(stage.timeoutMs) && stage.timeoutMs > 0 && stage.timeoutMs <= 45 * 60_000, 'Invalid deadline');
  const maxOutput = stage.maxOutput ?? 8 * 1024 * 1024;
  requireThat(Number.isSafeInteger(maxOutput) && maxOutput > 0 && maxOutput <= 32 * 1024 * 1024, 'Invalid output limit');
  return new Promise(resolve => {
    const start = Date.now();
    let stdout = '', stderr = '', bytes = 0, failure = null;
    const child = spawn(stage.bin, stage.args, { cwd, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = reason => {
      if (failure) return;
      failure = reason;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxOutput) { stop('output_limit'); return; }
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    });
    child.on('error', () => { failure = 'spawn_error'; });
    const timer = setTimeout(() => stop('timeout'), stage.timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      let status = failure || code !== 0 ? 'failed' : 'passed';
      if (failure === 'timeout') status = 'timed_out';
      resolve({ status, failure, exitCode: code, stdout, stderr, durationMs: Date.now() - start });
    });
  });
}

function stageKind(id) {
  if (id.startsWith('test:')) return 'test';
  if (id.startsWith('list:')) return 'inventory';
  if (id === 'mutation') return 'control';
  return 'build';
}

function validReceiptShape(receipt) {
  return receipt && typeof receipt === 'object' && Array.isArray(receipt.stages)
    && receipt.stages.every(stage => stage && typeof stage.id === 'string');
}

function validExecutionCounts(stage, platform) {
  const target = inventory.targets.find(t => stage.id === `test:${t.name}`);
  if (!target || !stage.counts || stage.kind !== 'test') return false;
  let expected = target.tests.length;
  if (platform === 'darwin-arm64') expected += target.darwinOnly.length;
  const c = stage.counts;
  return expected > 0 && c.tests === expected && c.passed === expected
    && [c.failed, c.ignored, c.measured, c.filtered].every(n => n === 0);
}

function stageFailures(stage, platform) {
  const failures = [];
  if (stage.kind !== stageKind(stage.id)) failures.push('Invalid stage evidence kind');
  if (stage.status !== 'passed' || stage.exitCode !== 0) failures.push(`${platform}/${stage.id} did not pass`);
  if (stage.id.startsWith('test:') && !validExecutionCounts(stage, platform)) failures.push('Incomplete test evidence');
  if (stage.id === 'mutation' && (stage.kind !== 'control' || stage.detectedFailure !== true || stage.restored !== true)) failures.push('Missing mutation evidence');
  return failures;
}

function receiptFailures(receipt, expectedPlatforms) {
  const failures = [];
  if (receipt.schemaVersion !== 1 || !expectedPlatforms.includes(receipt.platform) || !/^[a-f0-9]{40}$/.test(receipt.sourceSha ?? '') || !/^[a-f0-9]{64}$/.test(receipt.lockHash ?? '')) failures.push('Invalid receipt identity');
  const stages = receipt.stages;
  if (stages.length !== stageIds.length || !unique(stages.map(s => s.id)) || stageIds.some(id => !stages.some(s => s.id === id))) failures.push('Missing or duplicate stage');
  return [...failures, ...stages.flatMap(stage => stageFailures(stage, receipt.platform))];
}

export function aggregateReceipts(expectedPlatforms, receipts) {
  const failures = [];
  if (!Array.isArray(expectedPlatforms) || !Array.isArray(receipts) || !receipts.every(receipt => validReceiptShape(receipt))) return { passed: false, failures: ['Malformed receipt'] };
  if (!unique(expectedPlatforms) || expectedPlatforms.length !== 2 || !expectedPlatforms.every(p => Object.hasOwn(triples, p))) failures.push('Invalid expected platforms');
  if (receipts.length !== expectedPlatforms.length || !unique(receipts.map(r => r.platform))) failures.push('Missing or duplicate platform receipt');
  failures.push(...receipts.flatMap(receipt => receiptFailures(receipt, expectedPlatforms)));
  const sources = new Set(receipts.map(r => r.sourceSha)), locks = new Set(receipts.map(r => r.lockHash));
  if (sources.size !== 1 || locks.size !== 1) failures.push('Platform source or lock mismatch');
  return { passed: failures.length === 0, failures };
}

async function runHosted() {
  const platform = assertHostedPlatform();
  requireThat(process.versions.node.split('.')[0] === '22', 'Node 22 required');
  const repo = realpathSync(process.cwd());
  const workspace = realpathSync(process.env.GITHUB_WORKSPACE ?? '');
  requireThat(repo === workspace && !lstatSync(repo).isSymbolicLink(), 'Disposable checkout required');
  const runnerTemp = realpathSync(process.env.RUNNER_TEMP ?? '');
  requireThat(!inside(repo, runnerTemp) && runnerTemp !== repo, 'State must be outside checkout');
  const state = path.join(runnerTemp, 'ux071-native');
  requireThat(!existsSync(state), 'Native state already exists');
  const originalHome = homedir();
  const { cargo, rustc } = resolveRustTools(process.env, repo);
  const env = isolatedEnvironment(state, { ...process.env, RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(originalHome, '.rustup') });
  const frontend = path.join(state, 'frontend'); mkdirSync(frontend); writeFileSync(path.join(frontend, 'index.html'), '<!doctype html><title>Native test fixture</title>');
  env.TAURI_CONFIG = JSON.stringify({ build: { frontendDist: frontend } });
  const artifactDir = path.join(runnerTemp, `ux071-receipts-${platform}`); mkdirSync(artifactDir, { recursive: true });
  const lockFile = path.join(repo, 'src-tauri/Cargo.lock');
  const receipt = { schemaVersion: 1, platform, sourceSha: '', lockHash: hash(readFileSync(lockFile)), runner: { os: process.env.RUNNER_OS, architecture: process.env.RUNNER_ARCH, image: process.env.ImageOS, version: process.env.ImageVersion }, versions: { node: process.version }, stages: [] };
  const deadline = Date.now() + 43 * 60_000;
  let sequence = 0;
  async function command(id, bin, args, timeoutMs = 120_000, commandEnv = env) {
    const remaining = deadline - Date.now();
    requireThat(remaining > 0, 'Platform deadline exhausted');
    const result = await executeStage({ id, bin, args, timeoutMs: Math.min(timeoutMs, remaining) }, { cwd: repo, env: commandEnv });
    const log = `${String(++sequence).padStart(2, '0')}-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    writeFileSync(path.join(artifactDir, `${log}.stdout.log`), result.stdout);
    writeFileSync(path.join(artifactDir, `${log}.stderr.log`), result.stderr);
    receipt.commands ??= []; receipt.commands.push({ id, bin, args, status: result.status, exitCode: result.exitCode, durationMs: result.durationMs });
    return result;
  }
  const passed = result => { requireThat(result.status === 'passed' && result.exitCode === 0, 'Command did not pass'); return result.stdout; };
  async function stage(id, kind, action) {
    const started = Date.now();
    try { const extra = await action(); receipt.stages.push({ id, kind, status: 'passed', exitCode: 0, durationMs: Date.now() - started, ...extra }); }
    catch (error) { receipt.stages.push({ id, kind, status: 'failed', exitCode: 1, durationMs: Date.now() - started, error: error.message }); }
    writeFileSync(path.join(artifactDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  }
  await stage('setup', 'build', async () => {
    receipt.sourceSha = passed(await command('source', 'git', ['rev-parse', 'HEAD'])).trim();
    requireThat(passed(await command('clean', 'git', ['status', '--porcelain'])).trim() === '', 'Checkout must start clean');
    receipt.versions.rust = passed(await command('rust-version', rustc, ['+1.93.1', '--version', '--verbose']));
    receipt.versions.clippy = passed(await command('clippy-version', cargo, ['+1.93.1', 'clippy', '--version']));
    validateToolchain(receipt.versions.rust, receipt.versions.clippy, platform);
    passed(await command('npm-install', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], 5 * 60_000));
    passed(await command('xmpp-bundle', process.execPath, ['scripts/build-sidecar-xmpp.mjs'], 60_000));
  });
  await stage('metadata', 'build', async () => {
    const metadata = JSON.parse(passed(await command('metadata', cargo, ['+1.93.1', 'metadata', '--locked', '--no-deps', '--format-version=1', '--manifest-path', 'src-tauri/Cargo.toml'])));
    const packages = metadata.packages.filter(p => p.name === 'crystalball' && p.manifest_path === path.join(repo, 'src-tauri/Cargo.toml'));
    requireThat(packages.length === 1, 'Unexpected native package');
    const targets = packages[0].targets.filter(t => !t.kind.includes('custom-build')).map(t => { requireThat(t.kind.length === 1, 'Unexpected target kind'); return { name: t.name, kind: t.kind[0] }; });
    validateTargetInventory(targets, inventory.targets);
    validateLock(readFileSync(lockFile), receipt.lockHash);
  });
  const commands = buildCommands(); let executables = {};
  await stage('compile', 'build', async () => {
    requireThat(receipt.stages.every(s => s.status === 'passed'), 'Native prerequisites failed');
    executables = selectTestExecutables(passed(await command('compile', cargo, commands.compile, 18 * 60_000)), inventory.targets, env.CARGO_TARGET_DIR);
    validateLock(readFileSync(lockFile), receipt.lockHash);
  });
  for (const target of inventory.targets) {
    const names = [...target.tests, ...(platform === 'darwin-arm64' ? target.darwinOnly : [])];
    const testEnv = { ...env }; const temp = path.join(state, `test-${target.name}`); mkdirSync(temp);
    for (const key of ['TMPDIR', 'TMP', 'TEMP']) testEnv[key] = temp;
    await stage(`list:${target.name}`, 'inventory', async () => {
      requireThat(executables[target.name], 'Test harness unavailable');
      validateTestInventory(passed(await command(`list:${target.name}`, executables[target.name], ['--list'], 120_000, testEnv)), names);
    });
    await stage(`test:${target.name}`, 'test', async () => {
      requireThat(receipt.stages.find(s => s.id === `list:${target.name}`)?.status === 'passed', 'Reviewed test inventory unavailable');
      return { counts: parseTestResult(passed(await command(`test:${target.name}`, executables[target.name], ['--test-threads=1'], 120_000, testEnv)), names) };
    });
  }
  await stage('clippy', 'build', async () => {
    requireThat(receipt.stages.find(s => s.id === 'setup')?.status === 'passed', 'Native prerequisites failed');
    passed(await command('clippy', cargo, commands.clippy, 15 * 60_000));
    validateLock(readFileSync(lockFile), receipt.lockHash);
  });
  await stage('mutation', 'control', async () => {
    requireThat(receipt.stages.find(s => s.id === 'test:watchdog_contract')?.status === 'passed', 'Green watchdog baseline required');
    requireThat(passed(await command('mutation-clean', 'git', ['status', '--porcelain'])).trim() === '', 'Mutation baseline must be clean');
    const filename = path.join(repo, 'src-tauri/tests/watchdog_contract.rs');
    const original = readFileSync(filename), checksum = hash(original), mutated = prepareWatchdogMutation(original);
    let detectedFailure = false, redCounts;
    const target = inventory.targets.find(t => t.name === 'watchdog_contract');
    const compileArgs = ['+1.93.1', 'test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--test', target.name, '--no-run', '--message-format=json'];
    try {
      writeFileSync(filename, mutated);
      const diff = passed(await command('mutation-diff', 'git', ['diff', '--', target.source]));
      requireThat(diff.includes('-    assert!(!focus.snapshot().focused);') && diff.includes('+    assert!(focus.snapshot().focused);'), 'Mutation did not apply');
      const binaries = selectTestExecutables(passed(await command('mutation-compile', cargo, compileArgs, 5 * 60_000)), [target], env.CARGO_TARGET_DIR);
      const result = await command('mutation-red', binaries[target.name], ['--test-threads=1']);
      redCounts = validateMutationFailure(result, target.tests);
      detectedFailure = true;
    } finally { writeFileSync(filename, original); }
    requireThat(hash(readFileSync(filename)) === checksum, 'Mutation restoration checksum mismatch');
    requireThat(passed(await command('mutation-restored', 'git', ['status', '--porcelain'])).trim() === '', 'Mutation did not restore clean checkout');
    const binaries = selectTestExecutables(passed(await command('mutation-green-compile', cargo, compileArgs, 5 * 60_000)), [target], env.CARGO_TARGET_DIR);
    const counts = parseTestResult(passed(await command('mutation-green', binaries[target.name], ['--test-threads=1'])), target.tests);
    validateLock(readFileSync(lockFile), receipt.lockHash);
    return { detectedFailure, restored: true, checksum, counts, redCounts };
  });
  if (receipt.stages.some(s => s.status !== 'passed')) process.exitCode = 1;
  console.log(JSON.stringify({ platform, stages: receipt.stages.map(s => ({ id: s.id, status: s.status, counts: s.counts })) }));
}

async function main() {
  if (process.argv[2] === 'run' && process.argv.length === 3) return runHosted();
  if (process.argv[2] === 'aggregate' && process.argv.length === 4) {
    const dir = realpathSync(process.argv[3]);
    const receipts = readdirSync(dir, { withFileTypes: true }).map(entry => {
      requireThat(entry.isDirectory(), 'Unexpected receipt artifact');
      const filename = path.join(dir, entry.name, 'receipt.json'), stat = lstatSync(filename);
      requireThat(stat.isFile() && stat.size <= 2 * 1024 * 1024 && inside(dir, realpathSync(filename)), 'Invalid receipt file');
      return JSON.parse(readFileSync(filename, 'utf8'));
    });
    const result = aggregateReceipts(Object.keys(triples), receipts);
    if (!/^[a-f0-9]{40}$/.test(process.env.EXPECTED_SOURCE_SHA ?? '') || receipts.some(r => r.sourceSha !== process.env.EXPECTED_SOURCE_SHA)) { result.passed = false; result.failures.push('Unexpected workflow source SHA'); }
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
    return;
  }
  throw new Error('Usage: native-test-driver.mjs run | aggregate RECEIPTS_DIRECTORY');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(`Native gate failed: ${error.message}`); process.exitCode = 1; }
}

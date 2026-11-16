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

const mutationControls = [
  { id: 'watchdog', source: 'src-tauri/tests/watchdog_contract.rs', target: 'watchdog_contract', failureNames: ['main_focus_tracks_gain_and_loss'] },
  { id: 'crypto-nonce-rejection', source: 'src-tauri/src/main.rs', target: 'crystalball', failureNames: ['vault_shadow_crypto_tests::malformed_nonce_lengths_are_rejected'] },
  { id: 'crypto-auth-rejection', source: 'src-tauri/src/main.rs', target: 'crystalball', failureNames: ['modified_nonce_is_rejected', 'modified_tag_is_rejected', 'tampered_ciphertext_is_rejected', 'wrong_key_fails_authentication'].map(name => `vault_shadow_crypto_tests::${name}`) },
  { id: 'updater-dto-required-fields', source: 'src-tauri/src/updater_policy.rs', target: 'crystalball', failureNames: ['updater_policy::tests::release_asset_wire_shape_is_required_on_every_platform'] },
  { id: 'updater-serialization', source: 'src-tauri/src/updater_policy.rs', target: 'crystalball', failureNames: ['updater_policy::tests::result_contract_uses_native_versions_and_camel_case_fields', 'updater_policy::tests::outcome_and_reason_serialization_preserves_wire_values'] },
  { id: 'native-outcome-serialization', source: 'src-tauri/src/main.rs', target: 'crystalball', failureNames: ['native_outcome_tests::native_outcome_serialization_preserves_wire_values'] },
  { id: 'location-error-serialization', source: 'src-tauri/src/current_location.rs', target: 'current_location_contract', failureNames: ['current_location::tests::native_envelopes_are_exact_and_camel_case', 'current_location::tests::native_error_serialization_preserves_wire_values'] },
  { id: 'vault-accessor-authority', source: 'src-tauri/src/vault_coordinator.rs', target: 'crystalball', failureNames: ['vault_coordinator::transport_tests::test_accessor_reads_authoritative_state', 'vault_coordinator::transport_tests::coordinator_accessor_preserves_state_identity'] },
  { id: 'updater-lock-nontruncation', source: 'src-tauri/src/main.rs', target: 'crystalball', platforms: ['darwin-arm64'], failureNames: ['updater_gate_tests::lock_reopen_preserves_bytes_inode_and_exclusion'] },
];

function requiredMutationControls(platform) {
  requireThat(Object.hasOwn(triples, platform), 'Unsupported mutation platform');
  return mutationControls.filter(control => !control.platforms || control.platforms.includes(platform));
}

function replaceUnique(source, before, after) {
  requireThat(source.split(before).length === 2, 'Mutation marker must be unique');
  return source.replace(before, after);
}

function mutateDeclaration(source, marker, transform) {
  requireThat(source.split(marker).length === 2, 'Mutation declaration must be unique');
  const start = source.indexOf(marker), open = source.indexOf('{', start);
  requireThat(open !== -1, 'Mutation declaration body missing');
  let depth = 1, end = open + 1;
  for (; end < source.length && depth; end += 1) {
    if (source[end] === '{') depth += 1;
    if (source[end] === '}') depth -= 1;
  }
  requireThat(depth === 0, 'Mutation declaration end missing');
  return source.slice(0, start) + transform(source.slice(start, end)) + source.slice(end);
}

function mutateSerde(source, declaration, before, after) {
  requireThat(source.split(declaration).length === 2, 'Mutation declaration must be unique');
  const end = source.indexOf(declaration), start = source.lastIndexOf('#[serde(', end);
  requireThat(start !== -1 && !source.slice(start, end).includes('}'), 'Serde mutation attribute missing');
  return source.slice(0, start) + replaceUnique(source.slice(start, end), before, after) + source.slice(end);
}

function mutateRequiredSize(source) {
  return mutateDeclaration(source, 'pub struct ReleaseAsset {', body => {
    const fields = /^([ \t]*)(?:pub(?:\(crate\))? )?(size|_size): u64,$/gm;
    const matches = [...body.matchAll(fields)];
    requireThat(matches.length === 2 && new Set(matches.map(match => match[2])).size === 2, 'Required size fields must be unique');
    return body.replace(fields, (line, indent) => `${indent}#[serde(default)]\n${line}`);
  });
}

export function prepareControlMutation(id, original) {
  const source = original.toString();
  if (id === 'updater-dto-required-fields') return mutateRequiredSize(source);
  if (id === 'updater-serialization') {
    const changed = mutateSerde(source, 'pub enum UpdateOutcome {', 'rename_all = "snake_case"', 'rename_all = "camelCase"');
    return mutateSerde(changed, 'pub enum BrowserReason {', 'rename_all = "snake_case"', 'rename_all = "camelCase"');
  }
  if (id === 'native-outcome-serialization') return mutateSerde(source, 'enum NativeOutcome {', 'rename_all = "snake_case"', 'rename_all = "camelCase"');
  if (id === 'location-error-serialization') return mutateSerde(source, 'pub enum NativeLocationErrorCode {', 'rename_all = "lowercase"', 'rename_all = "UPPERCASE"');
  if (id === 'vault-accessor-authority') {
    const changed = mutateDeclaration(source, 'pub fn get(', body => replaceUnique(body, '.get(key).cloned()', '.get(key).filter(|_| false).cloned()'));
    return mutateDeclaration(changed, 'pub fn state(', body => replaceUnique(body, '&self.state', 'Box::leak(Box::new(Arc::new(VaultState::new())))'));
  }
  if (id === 'updater-lock-nontruncation') return mutateDeclaration(source, 'fn open_lockfile(', body => replaceUnique(body, '.truncate(false)', '.truncate(true)'));
  const replacements = {
    watchdog: [['assert!(!focus.snapshot().focused);', 'assert!(focus.snapshot().focused);']],
    'crypto-nonce-rejection': [
      ['let env: ShadowEnvelope = serde_json::from_str(raw).ok()?;', 'let mut env: ShadowEnvelope = serde_json::from_str(raw).ok()?;'],
      ['if env.v != 2 || env.n.len() != 12 {', 'if env.v != 2 {'],
      ['let nonce_bytes: [u8; 12] = env.n.as_slice().try_into().ok()?;', 'env.n.resize(12, 0);\n let nonce_bytes: [u8; 12] = env.n.as_slice().try_into().ok()?;'],
    ],
    'crypto-auth-rejection': [['cipher.decrypt(&nonce, env.c.as_ref()).ok()?', 'cipher.decrypt(&nonce, env.c.as_ref()).unwrap_or_default()']],
  };
  requireThat(Object.hasOwn(replacements, id), 'Unknown mutation control');
  let changed = source;
  for (const [before, after] of replacements[id]) changed = replaceUnique(changed, before, after);
  return changed;
}

export function validateMutationFailure(result, expectedNames, failureNames) {
  expectedTests(expectedNames);
  expectedTests(failureNames);
  requireThat(failureNames.every(name => expectedNames.includes(name)), 'Mutation target test missing');
  requireThat(result.status === 'failed' && !result.failure && Number.isInteger(result.exitCode) && result.exitCode > 0, 'Mutation process did not fail');
  const results = [...result.stdout.matchAll(/^test ([\w:]+) \.\.\. (\S+)$/gm)];
  requireThat(results.length === expectedNames.length && unique(results.map(m => m[1])) && results.every(m => expectedNames.includes(m[1]) && m[2] === (failureNames.includes(m[1]) ? 'FAILED' : 'ok')), 'Unexpected mutation failures');
  let repaired = result.stdout;
  for (const name of failureNames) repaired = repaired.replace(`test ${name} ... FAILED`, `test ${name} ... ok`);
  repaired = repaired.replace(`test result: FAILED. ${expectedNames.length - failureNames.length} passed; ${failureNames.length} failed;`, `test result: ok. ${expectedNames.length} passed; 0 failed;`);
  const counts = parseTestResult(repaired, expectedNames);
  let rejected = false;
  try { parseTestResult(result.stdout, expectedNames); } catch { rejected = true; }
  requireThat(rejected, 'Failed test result was accepted');
  return { ...counts, passed: expectedNames.length - failureNames.length, failed: failureNames.length };
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

function validMutationControls(controls, platform) {
  if (!Object.hasOwn(triples, platform)) return false;
  const expectedControls = requiredMutationControls(platform);
  if (!Array.isArray(controls) || controls.length !== expectedControls.length || !controls.every(control => control && typeof control.id === 'string') || !unique(controls.map(control => control.id))) return false;
  return expectedControls.every(spec => {
    const control = controls.find(control => control.id === spec.id);
    if (!control || control.source !== spec.source || control.target !== spec.target || control.appliedDiff !== true || control.detectedFailure !== true || control.restored !== true) return false;
    if (![control.originalHash, control.mutatedHash, control.restoredHash].every(value => /^[a-f0-9]{64}$/.test(value ?? '')) || control.originalHash !== control.restoredHash || control.mutatedHash === control.originalHash) return false;
    if (!Array.isArray(control.failureNames) || !unique(control.failureNames) || control.failureNames.length !== spec.failureNames.length || !spec.failureNames.every(name => control.failureNames.includes(name))) return false;
    if (!validExecutionCounts({ id: `test:${spec.target}`, kind: 'test', counts: control.counts }, platform)) return false;
    const red = control.redCounts, total = control.counts.tests, failed = spec.failureNames.length;
    return red && red.tests === total && red.passed === total - failed && red.failed === failed && [red.ignored, red.measured, red.filtered].every(count => count === 0);
  });
}

function stageFailures(stage, platform) {
  const failures = [];
  if (stage.kind !== stageKind(stage.id)) failures.push('Invalid stage evidence kind');
  if (stage.status !== 'passed' || stage.exitCode !== 0) failures.push(`${platform}/${stage.id} did not pass`);
  if (stage.id.startsWith('test:') && !validExecutionCounts(stage, platform)) failures.push('Incomplete test evidence');
  if (stage.id === 'mutation' && (stage.kind !== 'control' || stage.detectedFailure !== true || stage.restored !== true || !validMutationControls(stage.controls, platform))) failures.push('Missing mutation evidence');
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
    const controls = [];
    for (const spec of requiredMutationControls(platform)) {
      requireThat(receipt.stages.find(s => s.id === `test:${spec.target}`)?.status === 'passed', 'Green mutation baseline required');
      requireThat(passed(await command(`${spec.id}-clean`, 'git', ['status', '--porcelain'])).trim() === '', 'Mutation baseline must be clean');
      const filename = path.join(repo, spec.source), original = readFileSync(filename);
      const originalHash = hash(original), mutated = prepareControlMutation(spec.id, original), mutatedHash = hash(mutated);
      requireThat(originalHash !== mutatedHash, 'Mutation did not change source');
      const target = inventory.targets.find(target => target.name === spec.target);
      const names = [...target.tests, ...(platform === 'darwin-arm64' ? target.darwinOnly : [])];
      const compileArgs = ['+1.93.1', 'test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', `--${target.kind}`, target.name, '--no-run', '--message-format=json'];
      const temp = path.join(state, `mutation-${spec.id}`); mkdirSync(temp);
      const testEnv = { ...env, TMPDIR: temp, TMP: temp, TEMP: temp };
      let redCounts;
      try {
        writeFileSync(filename, mutated);
        requireThat(hash(readFileSync(filename)) === mutatedHash, 'Mutation bytes did not apply');
        const diff = passed(await command(`${spec.id}-diff`, 'git', ['diff', '--', spec.source]));
        requireThat(/^-(?!-).+/m.test(diff) && /^\+(?!\+).+/m.test(diff), 'Mutation diff missing');
        const binaries = selectTestExecutables(passed(await command(`${spec.id}-compile`, cargo, compileArgs, 5 * 60_000)), [target], env.CARGO_TARGET_DIR);
        const result = await command(`${spec.id}-red`, binaries[target.name], ['--test-threads=1'], 120_000, testEnv);
        redCounts = validateMutationFailure(result, names, spec.failureNames);
      } finally {
        writeFileSync(filename, original);
        requireThat(hash(readFileSync(filename)) === originalHash, 'Mutation restoration checksum mismatch');
        requireThat(passed(await command(`${spec.id}-restored`, 'git', ['status', '--porcelain'])).trim() === '', 'Mutation did not restore clean checkout');
        validateLock(readFileSync(lockFile), receipt.lockHash);
      }
      const binaries = selectTestExecutables(passed(await command(`${spec.id}-green-compile`, cargo, compileArgs, 5 * 60_000)), [target], env.CARGO_TARGET_DIR);
      const counts = parseTestResult(passed(await command(`${spec.id}-green`, binaries[target.name], ['--test-threads=1'], 120_000, testEnv)), names);
      validateLock(readFileSync(lockFile), receipt.lockHash);
      controls.push({ ...spec, appliedDiff: true, detectedFailure: true, restored: true, originalHash, mutatedHash, restoredHash: hash(readFileSync(filename)), redCounts, counts });
    }
    return { detectedFailure: true, restored: true, controls };
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

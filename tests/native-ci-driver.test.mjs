import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as driver from '../scripts/native-test-driver.mjs';
import { validReceipt as receipt } from './fixtures/native-ci/receipts.mjs';

const targets = [
  { name: 'current_location_contract', kind: 'test' },
  { name: 'imessage_contract', kind: 'test' },
  { name: 'notify_policy_contract', kind: 'test' },
  { name: 'sidecar_supervisor_contract', kind: 'test' },
  { name: 'updater_identity_contract', kind: 'test' },
  { name: 'vault_coordinator_contract', kind: 'test' },
  { name: 'watchdog_contract', kind: 'test' },
  { name: 'crystalball', kind: 'bin' },
];
const names = ['tests::alpha', 'tests::beta'];
const listed = 'tests::alpha: test\ntests::beta: test\n\n2 tests, 0 benchmarks\n';
const passed = 'running 2 tests\ntest tests::alpha ... ok\ntest tests::beta ... ok\n\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n';
const counts = { tests: 2, passed: 2, failed: 0, ignored: 0, measured: 0, filtered: 0 };
const platforms = ['linux-x64', 'darwin-arm64'];
const digest = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function temporary(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'native-ci fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('native execution requires the approved hosted OS and architecture before launch', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64' };
  assert.equal(driver.assertHostedPlatform({ platform: 'linux', arch: 'x64', env }), 'linux-x64');
  assert.equal(driver.assertHostedPlatform({ platform: 'darwin', arch: 'arm64', env: { ...env, RUNNER_OS: 'macOS', RUNNER_ARCH: 'ARM64' } }), 'darwin-arm64');
  for (const candidate of [
    { platform: 'linux', arch: 'x64', env: {} },
    { platform: 'linux', arch: 'x64', env: { ...env, RUNNER_ENVIRONMENT: 'self-hosted' } },
    { platform: 'linux', arch: 'x64', env: { ...env, GITHUB_ACTIONS: 'false' } },
    { platform: 'linux', arch: 'arm64', env },
    { platform: 'linux', arch: 'arm64', env: { ...env, RUNNER_ARCH: 'ARM64' } },
    { platform: 'darwin', arch: 'x64', env: { ...env, RUNNER_OS: 'macOS', RUNNER_ARCH: 'X64' } },
    { platform: 'darwin', arch: 'x64', env },
    { platform: 'win32', arch: 'x64', env },
    { platform: 'linux', arch: 'x64', env: { ...env, RUNNER_OS: 'macOS' } },
    { platform: 'linux', arch: 'x64', env: { ...env, RUNNER_ARCH: 'ARM64' } },
  ]) assert.throws(() => driver.assertHostedPlatform(candidate), JSON.stringify(candidate));
});

test('toolchain receipts reject version, host and missing Clippy mismatches', () => {
  const version = 'rustc 1.93.1 (fixture 2026-01-01)\nbinary: rustc\nhost: x86_64-unknown-linux-gnu\nrelease: 1.93.1\n';
  assert.doesNotThrow(() => driver.validateToolchain(version, 'clippy 0.1.93 (fixture)', 'linux-x64'));
  assert.doesNotThrow(() => driver.validateToolchain(version.replace('x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'), 'clippy 0.1.93 (fixture)', 'darwin-arm64'));
  for (const [rust, clippy, platform] of [
    [version.replace('release: 1.93.1', 'release: 1.93.0'), 'clippy 0.1.93 (fixture)', 'linux-x64'],
    [version.replace('release: 1.93.1', 'release: 1.93.1-nightly'), 'clippy 0.1.93 (fixture)', 'linux-x64'],
    [version, 'clippy 0.1.92 (fixture)', 'linux-x64'],
    [version, '', 'linux-x64'],
    [version, 'clippy 0.1.93 (fixture)', 'darwin-arm64'],
    ['', 'clippy 0.1.93 (fixture)', 'linux-x64'],
  ]) assert.throws(() => driver.validateToolchain(rust, clippy, platform));
});

test('target inventory rejects missing, added, duplicated or reclassified executables', () => {
  assert.throws(() => driver.validateTargetInventory([], []));
  assert.doesNotThrow(() => driver.validateTargetInventory([...targets].reverse(), targets));
  for (const changed of [
    targets.slice(1), [...targets, { name: 'unreviewed', kind: 'test' }], [...targets, targets[0]],
    targets.map((target, i) => i === 0 ? { ...target, kind: 'bin' } : target), [],
  ]) assert.throws(() => driver.validateTargetInventory(changed, targets));
});

test('compiled artifacts select test harnesses and reject app binaries and path escapes', t => {
  const dir = temporary(t), owned = path.join(dir, 'target');
  mkdirSync(owned);
  const artifacts = targets.map(target => {
    const executable = path.join(owned, `${target.name}-fixture`);
    writeFileSync(executable, 'fixture only; never executed', { mode: 0o700 });
    return { reason: 'compiler-artifact', target: { name: target.name, kind: [target.kind] }, profile: { test: true }, executable };
  });
  const json = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  assert.doesNotThrow(() => driver.selectTestExecutables(json(artifacts), targets, owned));
  const app = { ...artifacts.at(-1), profile: { test: false } };
  assert.doesNotThrow(() => driver.selectTestExecutables(json([app, ...artifacts]), targets, owned));
  const outside = path.join(dir, 'outside'); writeFileSync(outside, 'inert');
  const link = path.join(owned, 'link'); symlinkSync(artifacts[0].executable, link);
  for (const changed of [
    artifacts.slice(1), [...artifacts, artifacts[0]],
    [...artifacts.slice(0, -1), app],
    artifacts.map((row, i) => i === 0 ? { ...row, executable: outside } : row),
    artifacts.map((row, i) => i === 0 ? { ...row, executable: link } : row),
    artifacts.map((row, i) => i === 0 ? { ...row, executable: path.join(owned, 'missing') } : row),
    [...artifacts, { ...artifacts[0], target: { name: 'unreviewed', kind: ['test'] } }],
  ]) assert.throws(() => driver.selectTestExecutables(json(changed), targets, owned));
});

test('listed test names and positive footer must match the reviewed inventory exactly', () => {
  assert.throws(() => driver.validateTestInventory('0 tests, 0 benchmarks\n', []));
  assert.deepEqual([...driver.validateTestInventory(listed, names)].sort(), names);
  for (const output of [
    '', '0 tests, 0 benchmarks\n', listed + listed, listed.replace('tests::alpha: test\n', ''),
    listed.replace('tests::beta: test', 'tests::alpha: test'),
    listed.replace('2 tests', '1 tests'), listed.replace('0 benchmarks', '1 benchmarks'),
    'tests::unreviewed: test\n' + listed,
  ]) assert.throws(() => driver.validateTestInventory(output, names));
});

test('test receipts require each expected passing case and reject ignored or filtered runs', () => {
  assert.throws(() => driver.parseTestResult('running 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n', []));
  assert.deepEqual(driver.parseTestResult(passed, names), counts);
  for (const output of [
    '', passed.replace('test tests::alpha ... ok\n', ''),
    passed.replace('test tests::beta ... ok', 'test tests::alpha ... ok'),
    passed.replace('2 passed', '1 passed'), passed.replace('0 failed', '1 failed'),
    passed.replace('0 ignored', '1 ignored'), passed.replace('0 measured', '1 measured'),
    passed.replace('0 filtered out', '1 filtered out'), passed.replace('result: ok', 'result: FAILED'),
    passed.replace('tests::alpha ... ok', 'tests::alpha ... ignored'),
    passed.replace('running 2 tests', 'running 0 tests'),
    passed + passed,
  ]) assert.throws(() => driver.parseTestResult(output, names), output);
});

test('native commands pin the toolchain and lock while naming every target and strict Clippy', () => {
  const commands = driver.buildCommands(targets);
  for (const [kind, args] of Object.entries(commands)) {
    assert.equal(args[0], '+1.93.1');
    assert.ok(args.includes('--locked'));
    assert.ok(!args.includes('--all-targets') && !args.includes('--workspace'));
    for (const target of targets) assert.ok(args.some((arg, i) => arg === `--${target.kind}` && args[i + 1] === target.name));
    if (kind === 'compile') {
      assert.ok(args.includes('--no-run') && args.includes('--message-format=json'));
    } else assert.deepEqual(args.slice(-3), ['--', '-D', 'warnings']);
  }
});

test('lock drift is detected independently of a successful process exit', () => {
  const lock = Buffer.from('version = 3\n');
  assert.doesNotThrow(() => driver.validateLock(lock, digest(lock)));
  assert.throws(() => driver.validateLock(Buffer.from('version = 4\n'), digest(lock)));
  assert.throws(() => driver.validateLock(lock, 'not-a-digest'));
});

test('owned environment isolates credentials, compiler hooks and npm configuration', t => {
  const dir = temporary(t);
  const inherited = {
    PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
    RUSTUP_HOME: '/fixture/toolchain', CARGO_HOME: '/fixture/untrusted-cargo',
    HOME: '/fixture/user', TMPDIR: '/fixture/user-temp',
    GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64',
    OPENAI_API_KEY: 'dummy-native-key', NPM_TOKEN: 'dummy-native-token', NODE_OPTIONS: '--require=/fixture/hook',
    RUSTFLAGS: '--cfg untrusted', RUSTC: '/fixture/untrusted', RUSTC_WRAPPER: '/fixture/wrapper', GIT_CONFIG_GLOBAL: '/fixture/git',
  };
  const env = driver.isolatedEnvironment(dir, inherited);
  for (const name of ['HOME', 'TMPDIR', 'TMP', 'TEMP', 'CARGO_TARGET_DIR', 'CARGO_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'NPM_CONFIG_CACHE']) {
    assert.ok(env[name].startsWith(dir + path.sep), name);
    assert.ok(existsSync(env[name]), name);
  }
  assert.equal(env.PATH, inherited.PATH); assert.equal(env.RUSTUP_HOME, inherited.RUSTUP_HOME);
  assert.equal(env.RUNNER_ARCH, 'X64');
  for (const name of ['OPENAI_API_KEY', 'NPM_TOKEN', 'NODE_OPTIONS', 'RUSTFLAGS', 'RUSTC', 'RUSTC_WRAPPER', 'GIT_CONFIG_GLOBAL']) assert.equal(env[name], undefined, name);
  assert.notEqual(env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG);
  for (const name of ['NPM_CONFIG_USERCONFIG', 'NPM_CONFIG_GLOBALCONFIG']) {
    assert.ok(env[name].startsWith(dir + path.sep));
    assert.equal(readFileSync(env[name], 'utf8'), '');
  }
});

test('real inert process execution preserves failure and bounds output', async t => {
  const dir = temporary(t), env = driver.isolatedEnvironment(dir);
  const run = (code, extra = {}) => driver.executeStage({ id: 'fixture', bin: process.execPath, args: ['-e', code], timeoutMs: 2000, ...extra }, { cwd: dir, env });
  const green = await run('console.log("observed")');
  assert.equal(green.status, 'passed'); assert.equal(green.exitCode, 0); assert.match(green.stdout, /observed/);
  const literal = '$(touch injected); `echo unsafe` \"quoted\"';
  const argv = await driver.executeStage({ id: 'literal-argv', bin: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1])', literal], timeoutMs: 2000 }, { cwd: dir, env });
  assert.equal(argv.status, 'passed'); assert.equal(argv.stdout, literal); assert.equal(existsSync(path.join(dir, 'injected')), false);
  const red = await run('console.error("fixture failure");process.exitCode=7');
  assert.equal(red.status, 'failed'); assert.equal(red.exitCode, 7); assert.match(red.stderr, /fixture failure/);
  const flood = await run('process.stdout.write("x".repeat(100000));setTimeout(()=>{},1000)', { maxOutput: 1024 });
  assert.equal(flood.status, 'failed');
  assert.ok(Buffer.byteLength(flood.stdout) + Buffer.byteLength(flood.stderr) <= 1024);
});

test('timeout terminates the process group rather than leaving a writing descendant', async t => {
  const dir = temporary(t), marker = path.join(dir, 'descendant-survived');
  const childCode = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'leaked'),1000)`;
  const code = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});console.log(child.pid);setTimeout(()=>{},1400);`;
  const result = await driver.executeStage({ id: 'timeout', bin: process.execPath, args: ['-e', code], timeoutMs: 400 }, { cwd: dir, env: driver.isolatedEnvironment(dir) });
  assert.equal(result.status, 'timed_out');
  assert.match(result.stdout, /\d+/);
  await pause(1100);
  assert.equal(existsSync(marker), false, 'descendant cannot write after stage timeout');
});

test('aggregate checks both exact platform receipts and never converts missing execution to success', () => {
  assert.equal(driver.stageIds.filter(id => id.startsWith('test:')).length, 8);
  assert.deepEqual(driver.stageIds.filter(id => id.startsWith('test:')).map(id => id.slice(5)).sort(), targets.map(target => target.name).sort());
  assert.equal(driver.stageIds.at(-1), 'mutation');
  const good = platforms.map(platform => receipt(platform));
  assert.equal(driver.aggregateReceipts(platforms, good).passed, true);
  const cases = [[], [null, good[1]], [good[0], { ...good[1], schemaVersion: 2 }], [good[0], { ...good[1], stages: [...good[1].stages, good[1].stages[0]] }], [good[0]], [...good, good[0]], [good[0], { ...good[1], platform: 'darwin-x64' }],
    [good[0], { ...good[1], sourceSha: 'c'.repeat(40) }], [good[0], { ...good[1], lockHash: 'd'.repeat(64) }],
    [good[0], { ...good[1], stages: good[1].stages.slice(1) }]];
  const watchdogCounts = good[1].stages.find(stage => stage.id === 'test:watchdog_contract').counts;
  for (const [id, change] of [
    ['compile', { status: 'failed', exitCode: 1 }], ['clippy', { status: 'timed_out', exitCode: null }],
    ['test:watchdog_contract', { counts: { ...watchdogCounts, tests: 0, passed: 0 } }],
    ['test:watchdog_contract', { counts: { ...watchdogCounts, ignored: 1 } }],
    ['test:watchdog_contract', { counts: { ...watchdogCounts, passed: 1 } }],
    ['test:watchdog_contract', { counts: { ...watchdogCounts, filtered: 1 } }],
    ['test:watchdog_contract', { counts: { ...watchdogCounts, tests: '9' } }],
    ['test:watchdog_contract', { kind: 'build' }],
    ['test:watchdog_contract', { status: 'not_executed', exitCode: null }],
    ['mutation', { detectedFailure: false }], ['mutation', { restored: false }],
  ]) cases.push([good[0], { ...good[1], stages: good[1].stages.map(stage => stage.id === id ? { ...stage, ...change } : stage) }]);
  for (const bad of cases) {
    const result = driver.aggregateReceipts(platforms, bad);
    assert.equal(result.passed, false, JSON.stringify(bad)); assert.ok(result.failures.length > 0);
  }
});

test('hosted mutation changes exactly one reviewed assertion and requires the expected Rust failure', () => {
  const original = '    assert!(!focus.snapshot().focused);\n';
  assert.equal(driver.prepareControlMutation('watchdog', Buffer.from(original)), '    assert!(focus.snapshot().focused);\n');
  for (const input of ['', original + original, 'assert!(!other.focused);']) assert.throws(() => driver.prepareControlMutation('watchdog', input));
  const expectedNames = driver.inventory.targets.find(target => target.name === 'watchdog_contract').tests;
  assert.equal(expectedNames.length, 9);
  const output = 'running 9 tests\n' + expectedNames.map(name => `test ${name} ... ${name === 'main_focus_tracks_gain_and_loss' ? 'FAILED' : 'ok'}`).join('\n') + '\n\ntest result: FAILED. 8 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n';
  const result = { status: 'failed', exitCode: 101, stdout: output, stderr: '' };
  assert.deepEqual(driver.validateMutationFailure(result, expectedNames, ['main_focus_tracks_gain_and_loss']), { tests: 9, passed: 8, failed: 1, ignored: 0, measured: 0, filtered: 0 });
  for (const changed of [
    { ...result, status: 'passed', exitCode: 0 }, { ...result, exitCode: 0 },
    { ...result, status: 'timed_out', exitCode: null },
    { ...result, stdout: output.replace('8 passed; 1 failed', '7 passed; 2 failed') },
    { ...result, stdout: output.replace('0 ignored', '1 ignored') },
    { ...result, stdout: output.replace('0 filtered out', '1 filtered out') },
    { ...result, stdout: output.replace('main_focus_tracks_gain_and_loss ... FAILED', 'unreviewed ... FAILED') },
    { ...result, stdout: output.replace('test main_focus_tracks_gain_and_loss ... FAILED\n', '') },
    { ...result, stdout: output + output },
  ]) assert.throws(() => driver.validateMutationFailure(changed, expectedNames, ['main_focus_tracks_gain_and_loss']));
});

test('Rust shims resolve from runner PATH independently of Cargo cache home', async t => {
  const dir = temporary(t), checkout = path.join(dir, 'checkout'), bin = path.join(dir, 'host-bin');
  mkdirSync(checkout); mkdirSync(bin);
  const shim = path.join(bin, 'rustup');
  writeFileSync(shim, `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)))\n`, { mode: 0o700 });
  for (const name of ['cargo', 'rustc']) symlinkSync(shim, path.join(bin, name));
  const inherited = { PATH: bin, CARGO_HOME: path.join(dir, 'cache-without-proxies') };
  const tools = driver.resolveRustTools(inherited, checkout);
  assert.deepEqual(tools, { cargo: path.join(bin, 'cargo'), rustc: path.join(bin, 'rustc') }, 'retain shim names for rustup dispatch');
  for (const bin of Object.values(tools)) {
    const result = await driver.executeStage({ bin, args: ['+1.93.1', '--version'], timeoutMs: 2000 }, { cwd: checkout, env: driver.isolatedEnvironment(path.join(dir, path.basename(bin) + '-state'), inherited) });
    assert.equal(result.status, 'passed');
    assert.deepEqual(JSON.parse(result.stdout), ['+1.93.1', '--version']);
  }
  for (const PATH of ['', '.', `:${bin}`, `${bin}:relative`, checkout]) assert.throws(() => driver.resolveRustTools({ PATH }, checkout));
  assert.throws(() => driver.resolveRustTools({}, checkout));
  const linked = path.join(checkout, 'linked'); mkdirSync(linked);
  for (const name of ['cargo', 'rustc']) symlinkSync(shim, path.join(linked, name));
  assert.throws(() => driver.resolveRustTools({ PATH: linked }, checkout));
  const unsafe = path.join(checkout, 'tools'); mkdirSync(unsafe);
  for (const name of ['cargo', 'rustc']) writeFileSync(path.join(unsafe, name), '', { mode: 0o700 });
  assert.throws(() => driver.resolveRustTools({ PATH: unsafe }, checkout));
  const indirect = path.join(dir, 'indirect'); mkdirSync(indirect);
  for (const name of ['cargo', 'rustc']) symlinkSync(path.join(unsafe, name), path.join(indirect, name));
  assert.throws(() => driver.resolveRustTools({ PATH: indirect }, checkout));
  const incomplete = path.join(dir, 'incomplete'); mkdirSync(incomplete);
  writeFileSync(path.join(incomplete, 'cargo'), '', { mode: 0o600 });
  mkdirSync(path.join(incomplete, 'rustc'));
  assert.throws(() => driver.resolveRustTools({ PATH: incomplete }, checkout));
  const nonExecutable = path.join(dir, 'non-executable'); mkdirSync(nonExecutable);
  writeFileSync(path.join(nonExecutable, 'cargo'), '', { mode: 0o600 });
  symlinkSync(shim, path.join(nonExecutable, 'rustc'));
  assert.throws(() => driver.resolveRustTools({ PATH: nonExecutable }, checkout), /EACCES/);
  const nonRegular = path.join(dir, 'non-regular'); mkdirSync(nonRegular);
  symlinkSync(shim, path.join(nonRegular, 'cargo'));
  mkdirSync(path.join(nonRegular, 'rustc'), { mode: 0o700 });
  assert.throws(() => driver.resolveRustTools({ PATH: nonRegular }, checkout), /Unsafe Rust executable/);
});


test('reviewed inventory matches the captured Linux vault and binary lists without losing cases', () => {
  const evidence = JSON.parse(readFileSync(new URL('fixtures/native-ci/linux-reviewed-lists.json', import.meta.url), 'utf8'));
  assert.equal(evidence.sourceSha, 'e64401902c952c6c20a97d658c762b244f2486b1');
  assert.equal(evidence.platform, 'linux-x64');
  const source = readFileSync(new URL('../src-tauri/src/vault_coordinator.rs', import.meta.url), 'utf8');
  assert.match(source, /#\[cfg\(test\)\]\s+mod transport_tests \{/);
  const added = ['malformed_nonce_lengths_are_rejected', 'modified_nonce_is_rejected', 'modified_tag_is_rejected', 'existing_v2_ciphertext_fixture_decrypts'].map(name => `vault_shadow_crypto_tests::${name}`);
  for (const [name, count] of [['vault_coordinator_contract', 45], ['crystalball', 115]]) {
    const target = driver.inventory.targets.find(target => target.name === name);
    const historicalNames = target.tests.filter(name => !added.includes(name));
    assert.equal(target.tests.length, count + (name === 'crystalball' ? 4 : 0));
    assert.equal(driver.validateTestInventory(evidence.lists[name], historicalNames).length, count);
    if (name === 'crystalball') assert.deepEqual(target.tests.filter(name => added.includes(name)).sort(), [...added].sort());
    assert.equal(target.tests.filter(name => name.startsWith('vault_coordinator::transport_tests::')).length, 5);
  }
});

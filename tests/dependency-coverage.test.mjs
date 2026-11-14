import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as selector from '../scripts/targeted-tests.mjs';
const runner = await import('../scripts/dependency-test-runner.mjs').catch(() => ({}));

const root = path.resolve(import.meta.dirname, '..');

test('every npm graph manifest and lock require runtime and governance coverage', () => {
  const graphs = { root: '.', codex: '.github/tools/codex', marketing: 'marketing-site', scripts: 'scripts', 'cb-control': 'tools/cb-control', mcp: 'tools/mcp-server' };
  for (const [graph, dir] of Object.entries(graphs)) {
    for (const name of ['package.json', 'package-lock.json']) {
      const result = selector.dependencySelection([path.posix.join(dir, name)]);
      assert.deepEqual(result.graphs, [graph]);
      assert.ok(result.scripts.includes('test:supply-chain-gates'));
      assert.ok(result.scripts.includes('test:ux054'));
    }
  }
});

test('tool pins, workflow changes and Cargo cannot select an empty obligation', () => {
  for (const file of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', '.node-version', '.nvmrc', '.mcp.json', '.github/mcp.json', '.github/tools/zizmor/requirements.txt', '.github/workflows/auto-update-pr-branches.yml']) {
    assert.ok(selector.dependencySelection([file]).scripts.length > 0, file);
  }
  assert.match(selector.dependencySelection(['src-tauri/Cargo.lock']).gaps.join(' '), /UX-071/);
  assert.deepEqual(selector.dependencySelection(['docs/plan.md']), { graphs: [], scripts: [], gaps: [] });
});

test('unclassified dependency paths fail, including unusual names and alternate managers', () => {
  for (const file of ['new/package.json', 'new/package-lock.json', 'scripts/npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'new/Cargo.toml', 'new/requirements.txt', 'strange\npath/package.json']) {
    assert.throws(() => selector.dependencySelection([file]), /unclassified dependency/, file);
  }
  assert.deepEqual(selector.dependencySelection(['vendor/texture-compressor-safe/package.json']).graphs, ['root']);
  assert.deepEqual(selector.dependencySelection(['marketing-site/vendor/braces/package.json']).graphs, ['marketing']);
});

test('runtime test and runner changes execute their actual graph obligations', () => {
  assert.deepEqual(selector.dependencySelection(['tests/dependency-runtime/scripts.test.mjs']).graphs, ['scripts']);
  assert.deepEqual(selector.dependencySelection(['tests/dependency-runtime/cb-control.test.mjs']).graphs, ['cb-control']);
  assert.deepEqual(selector.dependencySelection(['tests/helpers/dependency-runtime-fixture.mjs']).graphs, ['cb-control', 'scripts']);
  assert.equal(selector.dependencySelection(['scripts/dependency-test-runner.mjs']).graphs.length, 7);
});

test('NUL path parsing preserves whitespace and both renamed paths', () => {
  assert.deepEqual(selector.parseChangedPaths('old/package.json\0new/package.json\0space\nname.ts\0'), ['old/package.json', 'new/package.json', 'space\nname.ts']);
  assert.throws(() => selector.parseChangedPaths('broken'), /NUL/);
});

test('actual Git renames keep both graph obligations and unusual filenames', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dependency-renames-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'fixture');
  writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  git('add', 'package-lock.json'); git('commit', '-qm', 'before rename');
  const base = git('rev-parse', 'HEAD');
  mkdirSync(path.join(dir, 'scripts'));
  renameSync(path.join(dir, 'package-lock.json'), path.join(dir, 'scripts/package-lock.json'));
  writeFileSync(path.join(dir, 'space\nname.ts'), 'fixture');
  git('add', 'package-lock.json', 'scripts/package-lock.json', 'space\nname.ts'); git('commit', '-qm', 'rename');
  const changed = selector.changedFilesBetween(dir, base, git('rev-parse', 'HEAD'));
  assert.deepEqual(new Set(changed), new Set(['package-lock.json', 'scripts/package-lock.json', 'space\nname.ts']));
  assert.deepEqual(selector.dependencySelection(changed).graphs, ['root', 'scripts']);
});

test('trusted policy cannot be replaced with candidate scripts or a missing revision', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dependency-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'test:fixture': 'node --test trusted.test.mjs' } }));
  mkdirSync(path.join(dir, 'scripts'));
  writeFileSync(path.join(dir, 'scripts/targeted-tests-overrides.json'), '{}');
  git('add', 'package.json', 'scripts/targeted-tests-overrides.json');
  git('commit', '-qm', 'trusted fixture');
  const sha = git('rev-parse', 'HEAD');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'test:fixture': 'node --test candidate.test.mjs' } }));
  assert.equal(selector.readTrustedPolicy(dir, sha).scripts['test:fixture'], 'node --test trusted.test.mjs');
  assert.throws(() => selector.readTrustedPolicy(dir, '0'.repeat(40)), /trusted policy/);
  assert.throws(() => selector.readTrustedPolicy(dir, 'HEAD'), /SHA/);
});

test('dependency mandatory commands cannot disappear through candidate mapping removal', () => {
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  const index = selector.deriveScriptIndex(scripts);
  const selection = selector.dependencySelection(['package-lock.json']);
  const mandatory = selector.mandatoryDependencyScripts(['package-lock.json'], index, {});
  for (const name of selection.scripts) assert.ok(mandatory.includes(name));
  assert.throws(() => selector.mandatoryDependencyScripts(['package-lock.json'], new Map(), {}), /mandatory/);
});

const tap = '# tests 2\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n';
const completeTap = `TAP version 13\nok 1 - fixture\nok 2 - fixture\n1..2\n${tap}`;

test('test stages require complete positive TAP and preserve actual counts', () => {
  assert.equal(runner.parseTestCounts(completeTap).pass, 2);
  for (const output of ['', 'ok', tap, completeTap.replace('# pass 2', '# pass 0'), completeTap.replace('# fail 0', '# fail 1'), completeTap.replace('# skipped 0', '# skipped 1'), `${completeTap}trailing`]) {
    assert.throws(() => runner.parseTestCounts(output));
  }
});

test('the stage process has bounded output, timeout and clean credential-free environment', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dependency-stage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = runner.isolatedEnvironment(dir, { PATH: process.env.PATH, OPENAI_API_KEY: 'fixture-secret', NODE_OPTIONS: '--require=bad', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', NPM_TOKEN: 'fixture-token' });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.HOME, path.join(dir, 'home'));
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  const run = args => runner.executeStage({ id: 'fixture', bin: process.execPath, args, kind: 'probe', timeoutMs: 1000, maxBytes: 1024 }, { cwd: dir, env });
  assert.equal((await run(['-e', 'setInterval(()=>{},1000)'])).status, 'timed_out');
  assert.equal((await run(['-e', 'process.stdout.write("x".repeat(2048))'])).status, 'failed');
  assert.equal((await run(['-e', 'process.exit(3)'])).status, 'failed');
  assert.equal((await run(['-e', 'console.log("ok")'])).status, 'passed');
});

test('graph execution refuses a local or unclassified host before dependency setup', () => {
  const result = spawnSync(process.execPath, ['scripts/dependency-test-runner.mjs', 'run', '--graph', 'cb-control'], {
    cwd: root, env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'false' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires disposable hosted Linux/);
});

test('aggregation fails missing, wrong-identity, zero-case and unfinished receipts', () => {
  const plan = { schemaVersion: 1, policySha: 'a'.repeat(40), executionSha: 'b'.repeat(40), mode: 'trusted', event: 'pull_request', graphs: ['scripts'], stages: { scripts: [{ id: 'install', kind: 'setup' }, { id: 'tests', kind: 'test' }] } };
  const receipt = { ...plan, graph: 'scripts', stages: [{ stageId: 'install', kind: 'setup', status: 'passed', exitCode: 0 }, { stageId: 'tests', kind: 'test', status: 'passed', exitCode: 0, discoveredTestFiles: 1, executedCases: 2 }] };
  assert.equal(runner.aggregateReceipts(plan, [receipt]).passed, true);
  for (const rows of [[], [{ ...receipt, policySha: 'c'.repeat(40) }], [{ ...receipt, stages: receipt.stages.slice(0, 1) }], [{ ...receipt, stages: [receipt.stages[0], { ...receipt.stages[1], status: 'not_executed' }] }], [{ ...receipt, stages: [receipt.stages[0], { ...receipt.stages[1], executedCases: 0 }] }], [{ ...receipt, stages: [receipt.stages[0], { ...receipt.stages[1], kind: 'setup' }] }]]) {
    assert.equal(runner.aggregateReceipts(plan, rows).passed, false);
  }
  assert.equal(runner.aggregateReceipts({ ...plan, graphs: [], stages: {} }, []).passed, true);
});

test('fixed graph commands use explicit files and preserve runtime mutation stages', () => {
  const metadata = { scripts: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts };
  for (const graph of selector.DEPENDENCY_GRAPHS) {
    const stages = runner.graphStages(graph, root, metadata);
    assert.ok(stages.length > 1, graph);
    assert.ok(stages.every(stage => Array.isArray(stage.args) && stage.timeoutMs <= 600000));
    assert.ok(stages.filter(stage => stage.kind === 'test').every(stage => stage.testFiles.length > 0));
    if (['scripts', 'cb-control'].includes(graph)) assert.ok(stages.some(stage => stage.id === 'runtime-mutations'));
  }
  assert.throws(() => runner.graphStages('root;echo unsafe', root, metadata), /graph/);
  assert.throws(() => runner.graphStages('root', root, { scripts: { ...metadata.scripts, 'test:workflow-security': 'node --test tests/missing-dependency-fixture.test.mjs' } }), /missing/);
});

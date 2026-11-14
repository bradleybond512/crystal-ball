import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const workflow = () => parse(readFileSync(path.join(root, '.github/workflows/dependency-coverage.yml'), 'utf8'));
const planScript = () => workflow().jobs.plan.steps.find(step => step.id === 'plan').run;

function fixture(t, { modern = false, missingRunner = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dependency-workflow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const write = (file, body) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), body);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const runner = `import { writeFileSync } from 'node:fs';
const args=process.argv.slice(3); const get=name=>args[args.indexOf(name)+1];
writeFileSync(get('--out'), JSON.stringify({policySha:get('--policy-sha'),executionSha:get('--execution-sha'),mode:get('--mode'),event:get('--event'),graphs:['root']}));
`;
  write('scripts/targeted-tests.mjs', modern ? 'export const DEPENDENCY_POLICY_VERSION = 1;\n' : '// legacy selector\n');
  if (modern && !missingRunner) write('scripts/dependency-test-runner.mjs', runner);
  git('add', 'scripts/targeted-tests.mjs');
  if (modern && !missingRunner) git('add', 'scripts/dependency-test-runner.mjs');
  git('commit', '-qm', 'trusted policy');
  const main = git('rev-parse', 'HEAD');
  const remote = path.join(dir, 'remote.git');
  execFileSync('git', ['clone', '--bare', '-q', repo, remote]);
  git('remote', 'add', 'origin', remote);
  git('checkout', '-qb', 'candidate');
  write('scripts/dependency-test-runner.mjs', modern ? 'throw Error("candidate policy executed");\n' : runner);
  write('scripts/targeted-tests.mjs', 'export const DEPENDENCY_POLICY_VERSION = 1;\n// candidate\n');
  git('add', 'scripts/targeted-tests.mjs', 'scripts/dependency-test-runner.mjs');
  git('commit', '-qm', 'candidate');
  const head = git('rev-parse', 'HEAD');
  const temporary = path.join(dir, 'temporary');
  mkdirSync(temporary);
  const output = path.join(dir, 'outputs');
  writeFileSync(output, '');
  const env = { PATH: process.env.PATH, HOME: dir, RUNNER_TEMP: temporary, GITHUB_OUTPUT: output, EXECUTION_SHA: head, BASE_SHA: main, GITHUB_EVENT_NAME: 'pull_request' };
  return {
    dir, repo, main, head, write, git,
    run(overrides = {}, script = planScript()) {
      return spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], { cwd: repo, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 20_000 });
    },
    outputs: () => Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => {
      const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
    })),
  };
}

test('dependency workflow covers forks, merge groups and the approved bounded sweep', () => {
  const wf = workflow();
  for (const event of ['pull_request', 'merge_group', 'workflow_dispatch', 'workflow_call']) assert.ok(Object.hasOwn(wf.on, event));
  assert.deepEqual(wf.on.schedule, [{ cron: '23 3 * * 3' }]);
  assert.equal(wf.concurrency['cancel-in-progress'], false);
  assert.equal(wf.jobs.plan['timeout-minutes'] + 7 * wf.jobs.execute['timeout-minutes'] + wf.jobs.aggregate['timeout-minutes'], 140);
  assert.equal(wf.jobs.execute.strategy['max-parallel'], 2);
  assert.equal(wf.jobs.execute.strategy['fail-fast'], false);
  assert.doesNotMatch(JSON.stringify(wf), /pull_request_target|secrets\.|id-token|self-hosted|head\.repo\.fork/);
  assert.deepEqual(wf.permissions, { contents: 'read' });
});

test('all three workflow checkouts are ephemeral and artifact retention is bounded', () => {
  const wf = workflow();
  assert.deepEqual(Object.keys(wf.jobs), ['plan', 'execute', 'aggregate']);
  for (const [id, job] of Object.entries(wf.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04', id);
    const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.with['persist-credentials'], false, id);
    assert.equal(checkout.with['fetch-depth'], 0, id);
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/upload-artifact@')) assert.equal(step.with['retention-days'], 7);
    }
  }
  assert.equal(wf.jobs.aggregate.if, 'always()');
  assert.ok(wf.jobs.execute.steps.some(step => step.if === 'always()' && step.uses?.startsWith('actions/upload-artifact@')));
});

test('first rollout executes a visibly labelled candidate preview', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.outputs().policy_mode, 'preview');
  assert.equal(f.outputs().policy_sha, f.head);
  assert.equal(f.outputs().execution_sha, f.head);
  assert.deepEqual(JSON.parse(f.outputs().graphs), ['root']);
  assert.match(result.stdout, /preview/);
});

test('installed trusted policy ignores a candidate replacement and pins one revision', t => {
  const f = fixture(t, { modern: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.outputs().policy_mode, 'trusted');
  assert.equal(f.outputs().policy_sha, f.main);
  assert.doesNotMatch(result.stderr, /candidate policy executed/);
});

test('a missing modern runner fails closed without candidate fallback', t => {
  const f = fixture(t, { modern: true, missingRunner: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trusted dependency runner is missing/);
});

test('scheduled execution cannot use the legacy preview fallback', t => {
  const f = fixture(t);
  const result = f.run({ GITHUB_EVENT_NAME: 'schedule', EXECUTION_SHA: f.main, BASE_SHA: f.main });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scheduled coverage requires trusted policy/);
});

test('scheduled policy identity is its execution commit rather than moving main', t => {
  const f = fixture(t);
  const result = f.run({ GITHUB_EVENT_NAME: 'schedule' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.outputs().policy_mode, 'trusted');
  assert.equal(f.outputs().policy_sha, f.head);
  assert.notEqual(f.outputs().policy_sha, f.main);
});

test('a nonregular trusted policy blob is rejected before execution', t => {
  const f = fixture(t, { modern: true });
  f.git('checkout', '-q', 'main');
  rmSync(path.join(f.repo, 'scripts/dependency-test-runner.mjs'));
  symlinkSync('missing-target.mjs', path.join(f.repo, 'scripts/dependency-test-runner.mjs'));
  f.git('add', 'scripts/dependency-test-runner.mjs');
  f.git('commit', '-qm', 'nonregular policy');
  f.git('push', '-q', 'origin', 'main');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular Git blob/);
});

test('candidate preview cannot emit unknown or duplicate matrix jobs', t => {
  const f = fixture(t);
  const runner = readFileSync(path.join(f.repo, 'scripts/dependency-test-runner.mjs'), 'utf8');
  for (const graphs of ["['unknown']", "['root','root']"]) {
    f.write('scripts/dependency-test-runner.mjs', runner.replace("['root']", graphs));
    f.git('add', 'scripts/dependency-test-runner.mjs');
    f.git('commit', '-qm', 'invalid graph output');
    const result = f.run({ EXECUTION_SHA: f.git('rev-parse', 'HEAD') });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid dependency plan output/);
  }
});

test('unresolved or malformed execution identities fail before policy execution', t => {
  const f = fixture(t, { modern: true });
  for (const override of [{ EXECUTION_SHA: 'HEAD' }, { BASE_SHA: 'refs/heads/main' }, { EXECUTION_SHA: '0'.repeat(40) }]) {
    const result = f.run(override);
    assert.notEqual(result.status, 0, JSON.stringify({ override, stdout: result.stdout, stderr: result.stderr }));
  }
});

test('aggregate cannot certify successful receipts after a failed matrix job', t => {
  const step = workflow().jobs.aggregate.steps.find(item => item.name === 'Verify every planned result');
  const dir = mkdtempSync(path.join(tmpdir(), 'dependency-aggregate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'dependency-policy'));
  writeFileSync(path.join(dir, 'dependency-policy/dependency-test-runner.mjs'), 'process.exit(0);\n');
  for (const [matrix, graphs, expected] of [['success', '["root"]', 0], ['failure', '["root"]', 1], ['cancelled', '["root"]', 1], ['skipped', '[]', 0]]) {
    const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      env: { PATH: process.env.PATH, RUNNER_TEMP: dir, EXECUTION_RESULT: matrix, PLANNED_GRAPHS: graphs }, encoding: 'utf8',
    });
    assert.equal(result.status, expected, `${matrix}: ${result.stderr}`);
  }
});

test('targeted workflow pins main and fails instead of passing when the selector is absent', t => {
  const wf = parse(readFileSync(path.join(root, '.github/workflows/targeted-tests.yml'), 'utf8'));
  assert.equal(wf.jobs['targeted-tests']['timeout-minutes'], 30);
  const step = wf.jobs['targeted-tests'].steps.find(item => item.name === 'Select and run targeted suites');
  const f = fixture(t, { modern: true });
  const result = f.run({}, step.run);
  assert.equal(result.status, 0, result.stderr);
  assert.match(step.run, /CB_TARGETED_POLICY_SHA=/);
  assert.doesNotMatch(step.run, /gate rollout|passing\./);
  f.git('checkout', '-q', 'main');
  f.git('rm', 'scripts/targeted-tests.mjs');
  f.git('commit', '-qm', 'remove selector');
  f.git('push', '-q', 'origin', 'main');
  assert.notEqual(f.run({}, step.run).status, 0);
});

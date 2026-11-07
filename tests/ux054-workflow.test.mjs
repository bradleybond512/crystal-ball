import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { sensitiveFiles } from '../scripts/dependency-change-policy.mjs';

const workflow = parse(readFileSync(new URL('../.github/workflows/security-audit.yml', import.meta.url), 'utf8'));
const job = workflow.jobs['npm-audit'];
const audit = job.steps.find(step => step.name === 'Audit all npm lockfiles');
const checker = 'scripts/audit-npm-locks.mjs';
const trustedEvent = "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('forks get the isolated audit while installation and signature verification retain the trusted event guard', () => {
  assert.ok(audit);
  assert.equal(job.if, undefined);
  assert.deepEqual(Object.keys(workflow.on).sort(), ['merge_group', 'pull_request', 'push']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(audit.if, undefined);
  assert.equal(job.steps.find(s => s.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  const setup = job.steps.find(s => s.uses?.startsWith('actions/setup-node@'));
  assert.equal(setup.with.cache, undefined);
  assert.equal(setup.with['package-manager-cache'], false);
  assert.equal(audit.env.PR_BASE_SHA, '${{ github.event.pull_request.base.sha }}');
  assert.equal(audit.env.MERGE_BASE_SHA, '${{ github.event.merge_group.base_sha }}');
  assert.equal(audit.env.ROLLOUT_BASE, '180f58ed0e15c6453afdc5b5a267fe1af38a7793');
  const install = job.steps.find(s => s.run === 'npm ci --ignore-scripts');
  const verify = job.steps.find(s => s.run === 'npm audit signatures');
  for (const stage of [job, audit, install, verify]) {
    assert.ok(stage && !stage['continue-on-error'], 'audit and signature failures must count');
  }
  assert.equal(audit.id, 'advisories');
  assert.equal(install?.id, 'root_install');
  assert.equal(install.if, `!cancelled() && (steps.advisories.outcome == 'success' || steps.advisories.outcome == 'failure') && (${trustedEvent})`);
  assert.equal(verify?.if, `!cancelled() && steps.root_install.outcome == 'success' && (${trustedEvent})`);
  assert.ok(job.steps.indexOf(audit) < job.steps.indexOf(install) && job.steps.indexOf(install) < job.steps.indexOf(verify));
  assert.deepEqual(job.steps.filter(s => s.run && !s.if), [audit], 'only the standalone auditor shell runs for forks');
  for (const name of ['cargo-audit', 'cargo-deny']) assert.equal(workflow.jobs[name].if, trustedEvent);
});

test('changing the independent auditor requires the supply-chain approval label and code owner', () => {
  assert.equal(sensitiveFiles([checker])[0]?.why, 'supply-chain gate');
  assert.ok(readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8')
    .split('\n').includes('/' + checker + ' @bradleybond512'));
});

function history(t) {
  const root = mkdtempSync(join(tmpdir(), 'ux054-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = join(root, 'candidate'), temp = join(root, 'runner');
  mkdirSync(join(work, 'scripts'), { recursive: true }); mkdirSync(temp);
  const git = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.email', 'ux054@example.invalid'); git('config', 'user.name', 'UX-054 fixture');
  const commit = (paths = ['marker', checker]) => {
    git('add', '--', ...paths);
    git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  writeFileSync(join(work, 'marker'), 'candidate contents');
  const introduction = commit(['marker']);
  const code = label => `import {readFileSync} from 'node:fs'; console.log('${label}',readFileSync('marker','utf8'),process.env.NODE_AUTH_TOKEN || 'clean');\n`;
  const path = join(work, checker); writeFileSync(path, code('base')); const base = commit();
  writeFileSync(path, code('candidate')); const head = commit();
  function run(overrides = {}) {
    assert.ok(audit);
    return spawnSync('bash', ['-euo', 'pipefail', '-c', audit.run], { cwd: work, encoding: 'utf8',
      env: { PATH: process.env.PATH, RUNNER_TEMP: temp, GITHUB_EVENT_NAME: 'pull_request', PR_BASE_SHA: base,
        MERGE_BASE_SHA: '', GITHUB_SHA: head, GITHUB_REF: 'refs/pull/1/merge', ROLLOUT_BASE: introduction,
        ROLLOUT_SHA256: sha256(code('candidate')), NODE_AUTH_TOKEN: 'credential-must-not-leak',
        NODE_OPTIONS: '--require=/absent-ux054-preload', ...overrides } });
  }
  return { work, path, commit, introduction, base, baseTree: git('rev-parse', base + '^{tree}'), head, run };
}

test('ordinary PR and merge group execute their exact trusted base in candidate context; main push uses its reviewed tree', t => {
  const { run, base } = history(t);
  for (const [env, result] of [
    [{}, 'base'],
    [{ GITHUB_EVENT_NAME: 'merge_group', MERGE_BASE_SHA: base, PR_BASE_SHA: '' }, 'base'],
    [{ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' }, 'candidate'],
  ]) {
    const check = run(env);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, new RegExp('^' + result + ' candidate contents clean$', 'm'));
  }
});

test('only the rollout base and matching bootstrap bytes can run; missing or malformed inputs fail closed', t => {
  const h = history(t);
  const bootstrap = h.run({ PR_BASE_SHA: h.introduction });
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  assert.match(bootstrap.stdout, /candidate candidate contents clean/);
  const topicPush = h.run({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/topic' });
  assert.notEqual(topicPush.status, 0, 'a topic push must not execute its valid checker');
  assert.doesNotMatch(topicPush.stdout, /candidate contents clean/);

  rmSync(h.path); const missing = h.commit();
  const symlinkBody = 'console.log("SYMLINK_RAN")';
  symlinkSync(symlinkBody, h.path); const symlink = h.commit();
  for (const env of [
    { PR_BASE_SHA: h.introduction, GITHUB_SHA: symlink, ROLLOUT_SHA256: sha256(symlinkBody) },
    { PR_BASE_SHA: h.base, GITHUB_SHA: h.head },
    { PR_BASE_SHA: missing }, { PR_BASE_SHA: symlink }, { PR_BASE_SHA: 'HEAD~2' }, { PR_BASE_SHA: h.baseTree },
    { PR_BASE_SHA: '--help' }, { PR_BASE_SHA: '' },
    { PR_BASE_SHA: 'a'.repeat(40) }, { GITHUB_EVENT_NAME: 'merge_group', MERGE_BASE_SHA: '' },
    { GITHUB_EVENT_NAME: 'pull_request_target' },
  ]) {
    const result = h.run({ GITHUB_SHA: symlink, ...env });
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.doesNotMatch(result.stdout, /candidate contents clean|SYMLINK_RAN/);
  }
  writeFileSync(join(h.work, 'marker'), 'other'); rmSync(h.path); writeFileSync(h.path, 'console.log("TAMPERED")');
  const changed = h.commit();
  const badHash = h.run({ PR_BASE_SHA: h.introduction, GITHUB_SHA: changed });
  assert.notEqual(badHash.status, 0);
  assert.doesNotMatch(badHash.stdout, /TAMPERED/);
});

test('the checked-in auditor matches the rollout digest', () => {
  assert.ok(audit);
  assert.equal(sha256(readFileSync(new URL('../' + checker, import.meta.url))), audit.env.ROLLOUT_SHA256);
});

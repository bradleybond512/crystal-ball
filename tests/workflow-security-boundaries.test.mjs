import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const workflow = (name) => parse(readFileSync(path.join(root, '.github/workflows', name), 'utf8'));

test('read-only workflow defaults constrain every previously unscoped job', () => {
  for (const name of ['actionlint', 'build-desktop', 'security-audit', 'eslint', 'lint', 'secret-scan', 'typecheck']) {
    const wf = workflow(`${name}.yml`);
    assert.deepEqual(wf.permissions, { contents: 'read' }, name);
    for (const [job, definition] of Object.entries(wf.jobs)) {
      if (name === 'build-desktop' && job === 'publish-release') continue;
      assert.deepEqual(definition.permissions ?? wf.permissions, { contents: 'read' }, `${name}/${job}`);
    }
  }
});

test('every checkout discards its authentication while retaining narrowly scoped publisher grants', () => {
  let count = 0;
  for (const name of readdirSync(path.join(root, '.github/workflows')).filter((n) => n.endsWith('.yml'))) {
    for (const [job, definition] of Object.entries(workflow(name).jobs)) {
      for (const step of definition.steps ?? []) {
        if (!step.uses?.startsWith('actions/checkout@')) continue;
        count += 1;
        assert.equal(step.with?.['persist-credentials'], false, `${name}/${job}`);
      }
    }
  }
  assert.equal(count, 32, 'all 30 flagged checkouts and the two already-hardened checkouts are covered');
  const wf = workflow('build-desktop.yml');
  assert.deepEqual(wf.jobs['publish-release'].permissions, { contents: 'write', 'id-token': 'write', attestations: 'write' });
  assert.deepEqual(wf.jobs['publish-release'].environment, { name: 'release' });
  assert.equal(wf.jobs['publish-release'].if, "needs.release-context.outputs.publish == 'true'");
  assert.deepEqual(wf.jobs['publish-release'].needs, ['release-context', 'build-tauri']);
  assert.deepEqual(workflow('auto-tag.yml').permissions, { contents: 'write', actions: 'write' });
});

test('build and publish modes restore no Rust or npm caches before secret-bearing operations', () => {
  const wf = workflow('build-desktop.yml');
  assert.deepEqual(wf.on.workflow_dispatch.inputs.publish_mode.options, ['build', 'publish']);
  const build = wf.jobs['build-tauri'];
  assert.ok(build.steps.some((step) => JSON.stringify(step.env ?? {}).includes('secrets.')), 'secret-bearing build boundary is exercised');
  let setups = 0;
  for (const [job, definition] of Object.entries(wf.jobs)) {
    for (const step of definition.steps) {
      assert.doesNotMatch(step.uses ?? '', /(?:swatinem\/rust-cache|actions\/cache)@/, `${job}/${step.name}`);
      if (step.uses?.startsWith('actions/setup-node@')) {
        setups += 1;
        assert.equal(step.with['package-manager-cache'], false, job);
        assert.equal(step.with.cache, undefined, job);
        assert.equal(step.with['node-version'], '22', 'preserve current-main Node pin');
      }
    }
  }
  assert.equal(setups, 3);
});

test('merge queue runs strict release-doctor instead of an empty job', () => {
  const steps = workflow('release-integrity.yml').jobs['release-doctor'].steps;
  const strict = steps.filter((step) => String(step.if ?? '').includes("github.event_name == 'merge_group'"));
  assert.equal(strict.length, 3);
  for (const step of strict) {
    assert.match(step.run, /^node scripts\/release-doctor\.mjs --variant (full|tech|finance)$/);
    assert.doesNotMatch(step.run, /allow-existing-target-release/);
  }
});

test('dependency policy retains base-only trusted execution and read-only trigger permissions', () => {
  const wf = workflow('dependency-change-gate.yml');
  assert.ok(wf.on.pull_request_target);
  assert.deepEqual(wf.permissions, { contents: 'read', 'pull-requests': 'read' });
  const steps = wf.jobs['dependency-change-gate'].steps;
  assert.deepEqual(steps[0].with, { 'persist-credentials': false });
  assert.equal(steps.at(-1).run, 'node scripts/dependency-change-policy.mjs --pr "$PR_NUMBER"');
  assert.ok(steps.every((s) => !/npm (?:ci|install)|checkout.*head|actions\/cache/.test(JSON.stringify(s))));
  assert.match(readFileSync(path.join(root, '.github/workflows/dependency-change-gate.yml'), 'utf8'), /pull_request_target: # zizmor: ignore\[dangerous-triggers\]/);
});

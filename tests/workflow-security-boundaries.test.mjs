import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const workflow = (name) => parse(readFileSync(path.join(root, '.github/workflows', name), 'utf8'));

test('existing browser jobs stay on the Ubuntu release supported by pinned Playwright', () => {
  for (const [name, job] of [['accessibility', 'axe'], ['variant-e2e', 'identity']]) {
    const definition = workflow(`${name}.yml`).jobs[job];
    assert.equal(definition['runs-on'], 'ubuntu-24.04', `${name}/${job}`);
  }
});

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
  assert.equal(count, 37, 'all existing checkouts and three dependency coverage jobs are covered');
  assert.deepEqual(Object.keys(workflow('dependency-coverage.yml').jobs), ['plan', 'execute', 'aggregate']);
  const wf = workflow('build-desktop.yml');
  assert.deepEqual(wf.jobs['publish-release'].permissions, { contents: 'write', 'id-token': 'write', attestations: 'write' });
  assert.deepEqual(wf.jobs['publish-release'].environment, { name: 'release' });
  assert.equal(wf.jobs['publish-release'].if, "false && vars.DESKTOP_RELEASE_ENABLED == 'true' && needs.release-context.outputs.publish == 'true'");
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


// These fixtures evaluate the actual guards, not a duplicated policy function.
// This restricted subset has the same boolean and case-insensitive string
// equality semantics as GitHub Actions. An absent guard permits the whole job.
function evaluateReleaseGuard(expression, { enabled, event, mode, publish } = {}) {
  const values = {
    'vars.DESKTOP_RELEASE_ENABLED': enabled,
    'github.event_name': event,
    'inputs.publish_mode': mode,
    'needs.release-context.outputs.publish': publish,
  };
  let resolved = expression ?? 'true';
  for (const [key, value] of Object.entries(values)) {
    resolved = resolved.replaceAll(key, JSON.stringify((value ?? '').toLowerCase()));
  }
  assert.match(resolved, /^[a-zA-Z0-9_\s'"=|&().-]+$/);
  return runInNewContext(resolved.replaceAll('==', '==='), Object.create(null), { timeout: 100 });
}

const releaseOptIns = [undefined, '', 'false', 'FALSE', 'true', 'TRUE', 'TrUe', '1', 'unexpected'];

test('release pause retains opt-in, explicit build mode and publisher output checks', () => {
  const desktop = workflow('build-desktop.yml');
  assert.equal(workflow('auto-tag.yml').jobs['auto-tag'].if, "false && vars.DESKTOP_RELEASE_ENABLED == 'true'");
  assert.equal(desktop.jobs['release-context'].if, "(false && vars.DESKTOP_RELEASE_ENABLED == 'true') || (github.event_name == 'workflow_dispatch' && inputs.publish_mode == 'build')");
  assert.equal(desktop.jobs['publish-release'].if, "false && vars.DESKTOP_RELEASE_ENABLED == 'true' && needs.release-context.outputs.publish == 'true'");
  assert.equal(desktop.on.workflow_dispatch.inputs.publish_mode.default, 'build');
  assert.deepEqual(desktop.jobs['build-tauri'].needs, 'release-context');
});

test('auto-tag hard pause blocks tag creation and dispatch regardless of repository opt-in', () => {
  const guard = workflow('auto-tag.yml').jobs['auto-tag'].if;
  for (const enabled of releaseOptIns) {
    assert.equal(evaluateReleaseGuard(guard, { enabled }), false, `opt-in=${enabled}`);
  }
});

test('release-context hard pause permits only explicit build-only dispatches', () => {
  const guard = workflow('build-desktop.yml').jobs['release-context'].if;
  for (const enabled of releaseOptIns) {
    for (const event of ['push', 'workflow_dispatch', 'pull_request']) {
      for (const mode of [undefined, '', 'publish', 'PUBLISH', 'build', 'BUILD', 'unexpected']) {
        const expected = event === 'workflow_dispatch' && mode?.toLowerCase() === 'build';
        assert.equal(evaluateReleaseGuard(guard, { enabled, event, mode }), expected,
          `opt-in=${enabled}, event=${event}, mode=${mode}`);
      }
    }
  }
});

test('publisher hard pause rejects even a true publish output regardless of repository opt-in', () => {
  const guard = workflow('build-desktop.yml').jobs['publish-release'].if;
  for (const enabled of releaseOptIns) {
    for (const publish of [undefined, '', 'false', 'true', 'TRUE', 'unexpected']) {
      assert.equal(evaluateReleaseGuard(guard, { enabled, publish }), false,
        `opt-in=${enabled}, publish=${publish}`);
    }
  }
});

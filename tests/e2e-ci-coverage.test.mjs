import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { deriveScriptIndex, selectScripts } from '../scripts/targeted-tests.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const workflow = (name) => parse(read(`.github/workflows/${name}.yml`));
const scripts = JSON.parse(read('package.json')).scripts;
const smoke = workflow('smoke');
const wiringScript = 'test:e2e:ci-wiring';
const goldenTitle = 'matches golden screenshots per layer and zoom';
const forkGuard = "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
const mapSpecs = ['e2e/map-harness.spec.ts', 'e2e/local-basemap.spec.ts'];
const interactionSpecs = [
  'e2e/gods-vision-mode.spec.ts',
  'e2e/settings-keyboard.spec.ts',
  'e2e/map-clarity.spec.ts',
  'e2e/emergency-readiness-offline.spec.ts',
];

function browserJob(name) {
  const job = smoke.jobs[name];
  assert.ok(job, `${name} browser job must be scheduled`);
  return job;
}

function runStep(job, script) {
  const step = job.steps.find((candidate) => candidate.run === `npm run ${script}`);
  assert.ok(step, `${script} must be invoked by the browser job`);
  return step;
}

// Execute the actual package command with a recording executable. No browser,
// app, package manager, or network operation runs in this source-wiring test.
function recordedPlaywrightArgs(t, script) {
  const command = scripts[script];
  assert.equal(typeof command, 'string', `${script} must exist`);
  assert.match(command, /^playwright test /);
  assert.doesNotMatch(command, /[;&|`<>\n]|\$\(/, 'fixture accepts only one Playwright command');
  const dir = mkdtempSync(path.join(tmpdir(), 'crystalball-e2e-wiring-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const capture = path.join(dir, 'args.json');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'playwright'), `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.FIXTURE_CAPTURE_FILE, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', command], {
    cwd: dir,
    env: { PATH: `${bin}:/usr/bin:/bin`, FIXTURE_CAPTURE_FILE: capture },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(readFileSync(capture, 'utf8'));
}

test('map CI runs the two explicit specs across full, tech and finance', (t) => {
  const job = browserJob('map-e2e');
  assert.deepEqual(job.strategy.matrix.variant, ['full', 'tech', 'finance']);
  assert.equal(job.strategy['fail-fast'], false, 'one variant must not cancel the others');
  assert.equal(runStep(job, 'test:e2e:map:ci').env.VITE_VARIANT, '${{ matrix.variant }}');
  const args = recordedPlaywrightArgs(t, 'test:e2e:map:ci');
  assert.deepEqual(args.slice(0, 3), ['test', ...mapSpecs]);
  assert.deepEqual(args.slice(3), ['--grep-invert', `${goldenTitle}$`]);
});

test('interaction CI runs every approved full-variant interaction spec without filters', (t) => {
  const job = browserJob('interaction-e2e');
  assert.equal(runStep(job, 'test:e2e:interactions:ci').env.VITE_VARIANT, 'full');
  assert.deepEqual(recordedPlaywrightArgs(t, 'test:e2e:interactions:ci'), ['test', ...interactionSpecs]);
});

test('map CI excludes only the named golden comparison and retains neighboring checks', (t) => {
  const args = recordedPlaywrightArgs(t, 'test:e2e:map:ci');
  const excluded = new RegExp(args[args.indexOf('--grep-invert') + 1]);
  const titles = mapSpecs.flatMap((file) => [...read(file).matchAll(/\btest\(\s*(['"`])(?<title>.*?)\1/gs)]
    .map((match) => match.groups.title));
  assert.ok(titles.length > 10, 'exercise the real map and local-basemap declarations');
  assert.deepEqual(titles.filter((title) => excluded.test(title)), [goldenTitle]);
  assert.equal(excluded.test(`DeckGL map harness ${goldenTitle}`), true);
  assert.equal(excluded.test(`${goldenTitle} and preserves screenshot evidence`), false);
  assert.ok(titles.filter((title) => !excluded.test(title)).length > 10);
});

test('golden comparison and update commands remain available locally', () => {
  for (const variant of ['full', 'tech']) {
    assert.equal(scripts[`test:e2e:visual:${variant}`], `cross-env VITE_VARIANT=${variant} playwright test -g "${goldenTitle}"`);
    assert.equal(scripts[`test:e2e:visual:update:${variant}`], `cross-env VITE_VARIANT=${variant} playwright test -g "${goldenTitle}" --update-snapshots`);
  }
  assert.equal(scripts['test:e2e:visual'], 'npm run test:e2e:visual:full && npm run test:e2e:visual:tech');
  assert.equal(scripts['test:e2e:visual:update'], 'npm run test:e2e:visual:update:full && npm run test:e2e:visual:update:tech');
});

test('new browser jobs install dependencies, enforce failures and preserve fork boundaries', () => {
  assert.deepEqual(smoke.on, { pull_request: null, push: { branches: ['main'] }, merge_group: null });
  assert.deepEqual(smoke.permissions, { contents: 'read' });
  for (const [name, script] of [['map-e2e', 'test:e2e:map:ci'], ['interaction-e2e', 'test:e2e:interactions:ci']]) {
    const job = browserJob(name);
    assert.equal(job.if, forkGuard, name);
    assert.equal(job['runs-on'], 'ubuntu-latest', name);
    assert.deepEqual(job.permissions ?? smoke.permissions, { contents: 'read' }, name);
    assert.doesNotMatch(JSON.stringify(job), /secrets\./, 'browser jobs receive no credentials');
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    assert.match(checkout.uses, /^actions\/checkout@[a-f0-9]{40}$/);
    assert.equal(checkout.with['persist-credentials'], false, name);
    const setup = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
    assert.match(setup.uses, /^actions\/setup-node@[a-f0-9]{40}$/);
    assert.equal(setup.with['node-version'], '22', name);
    const install = job.steps.findIndex((step) => step.run === 'npm ci');
    const browser = job.steps.findIndex((step) => step.run === 'npx playwright install --with-deps chromium');
    const execution = job.steps.indexOf(runStep(job, script));
    assert.ok(install >= 0 && browser > install && execution > browser, `${name} must install before executing the actual alias`);
    assert.equal(job['continue-on-error'], undefined, name);
    for (const step of job.steps) assert.equal(step['continue-on-error'], undefined, name);
    assert.equal(runStep(job, script).if, undefined, 'coverage must not be conditional inside an eligible job');
    const artifact = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    assert.match(artifact.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/);
    assert.equal(artifact.if, 'always()', 'retain successful screenshots as well as failed traces');
    assert.equal(artifact.with.path, 'test-results/');
    assert.equal(artifact.with.name, name === 'map-e2e' ? 'map-e2e-${{ matrix.variant }}' : 'interaction-e2e-full');
  }
});

test('the smoke job executes the wiring check while keeping its existing suite steps', () => {
  const steps = smoke.jobs.smoke.steps;
  assert.equal(smoke.jobs.smoke.if, forkGuard);
  assert.ok(steps.findIndex((step) => step.run === `npm run ${wiringScript}`) > steps.findIndex((step) => step.run === 'npm ci'));
  for (const script of ['smoke:offline', 'test:renderer', 'test:delegation', 'test:api', 'test:sidecar', 'build', 'pwa:budget', 'bench:cognition', 'bench:forecast', 'bench:baselines', 'bench:correlation', 'test:sec-hardening']) {
    assert.ok(steps.some((step) => step.run === `npm run ${script}`), script);
  }
  assert.ok(steps.some((step) => step.run === 'cd tools/mcp-server && npm ci --ignore-scripts && npm test'));
  assert.ok(steps.some((step) => step.name === 'Guard correlation baseline reseed against base branch'));
});

test('identity, accessibility and Home Shell browser-harness coverage remain explicit', () => {
  const identity = workflow('variant-e2e').jobs.identity;
  assert.deepEqual(identity.strategy.matrix.variant, ['full', 'tech', 'finance', 'happy']);
  assert.equal(identity.if, forkGuard);
  assert.equal(identity.steps.find((step) => step.run === 'npx playwright test e2e/variant-identity.spec.ts').env.VITE_VARIANT, '${{ matrix.variant }}');
  const axe = workflow('accessibility').jobs.axe;
  assert.equal(axe.if, forkGuard);
  assert.equal(axe.steps.find((step) => step.run === 'npx playwright test e2e/a11y-baseline.spec.ts').env.VITE_VARIANT, 'full');
  assert.equal(axe.steps.find((step) => step.run === 'npx playwright test e2e/home-shell-boot.spec.ts --grep "browser harness only"').env.VITE_VARIANT, 'full');
  assert.equal(new Set(['e2e/variant-identity.spec.ts', 'e2e/a11y-baseline.spec.ts', 'e2e/home-shell-boot.spec.ts', ...mapSpecs, ...interactionSpecs]).size, 9);
});

test('the real startup wait and Playwright evidence configuration remain intact', () => {
  const home = read('e2e/home-shell-boot.spec.ts');
  assert.match(home, /test\('browser harness only:/);
  assert.match(home, /await page\.waitForTimeout\(31_000\);/);
  assert.match(home, /Exercise the real 30-second startup budget and the next shell refresh/);
  const config = read('playwright.config.ts');
  for (const setting of ["trace: 'retain-on-failure'", "screenshot: 'only-on-failure'", "video: 'retain-on-failure'"]) {
    assert.ok(config.includes(setting), setting);
  }
  for (const file of ['e2e/local-basemap.spec.ts', 'e2e/map-clarity.spec.ts', 'e2e/settings-keyboard.spec.ts']) {
    assert.match(read(file), /await page\.screenshot\(/, file);
  }
});

test('targeted selection adds the eligible wiring check without dropping existing requirements', () => {
  const overrides = JSON.parse(read('scripts/targeted-tests-overrides.json'));
  const index = deriveScriptIndex(scripts);
  assert.equal(scripts[wiringScript], 'node --test tests/e2e-ci-coverage.test.mjs');
  assert.ok(index.has(wiringScript));
  for (const file of ['.github/workflows/smoke.yml', '.github/workflows/variant-e2e.yml', '.github/workflows/accessibility.yml', 'package.json', 'playwright.config.ts', 'tests/e2e-ci-coverage.test.mjs', 'e2e/home-shell-boot.spec.ts', ...mapSpecs, ...interactionSpecs]) {
    assert.ok(selectScripts([file], index, overrides).scripts.includes(wiringScript), file);
  }
  for (const file of ['.github/workflows/smoke.yml', '.github/workflows/variant-e2e.yml', '.github/workflows/accessibility.yml', 'package.json']) {
    assert.ok(overrides[file].includes('test:workflow-security'), file);
  }
  assert.ok(overrides['package.json'].includes('test:install-scripts'));
  assert.ok(overrides['scripts/targeted-tests-overrides.json'].includes('test:agentic-pipeline'));
});

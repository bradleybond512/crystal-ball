import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import ts from 'typescript';
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

test('Home startup waits for every reported card and source within the existing budget', async (t) => {
  const home = read('e2e/home-shell-boot.spec.ts');
  const parsed = ts.createSourceFile('home-shell-boot.spec.ts', home, ts.ScriptTarget.Latest, true);
  const cases = [];
  const pending = [parsed];
  while (pending.length > 0) {
    const node = pending.pop();
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'test'
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('browser harness only:')) {
      cases.push(node);
    }
    ts.forEachChild(node, (child) => { pending.push(child); });
  }
  assert.equal(cases.length, 1, 'inspect the actual empty-storage Home browser case');
  const body = cases[0].arguments[1];
  assert.ok(ts.isArrowFunction(body));
  const calls = [];
  pending.push(body);
  while (pending.length > 0) {
    const node = pending.pop();
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, (child) => { pending.push(child); });
  }
  assert.equal(calls.some((call) => ts.isPropertyAccessExpression(call.expression)
    && call.expression.name.text === 'waitForTimeout'), false, 'Home startup must not use a fixed sleep');
  const waits = calls.filter((call) => call.expression.getText(parsed) === 'page.waitForFunction');
  assert.equal(waits.length, 1, 'the Home browser case must wait for actual readiness outcomes');
  const wait = waits[0];
  assert.ok(ts.isAwaitExpression(wait.parent), 'readiness must settle before the honesty assertions');
  assert.equal(wait.arguments.length, 3);
  assert.equal(wait.arguments[1].getText(parsed), 'undefined');
  assert.ok(ts.isArrowFunction(wait.arguments[0]), 'execute the real browser wait callback');
  const options = wait.arguments[2];
  assert.ok(ts.isObjectLiteralExpression(options));
  assert.equal(options.properties.length, 1);
  const timeout = options.properties[0];
  assert.ok(ts.isPropertyAssignment(timeout) && timeout.name.getText(parsed) === 'timeout');
  assert.ok(ts.isBinaryExpression(timeout.initializer));
  assert.equal(timeout.initializer.operatorToken.kind, ts.SyntaxKind.PlusToken);
  assert.ok(ts.isNumericLiteral(timeout.initializer.left) && ts.isNumericLiteral(timeout.initializer.right));
  assert.deepEqual([Number(timeout.initializer.left.text), Number(timeout.initializer.right.text)], [31_000, 15_000],
    'combine only the existing sleep and card-poll allowances');
  const polls = calls.filter((call) => call.expression.getText(parsed) === 'expect.poll');
  assert.equal(polls.length, 1, 'retain the following source check');
  assert.equal(polls[0].arguments[1].getText(parsed).replaceAll(/\s/g, ''), '{timeout:15_000}');

  const condition = ts.transpileModule(`(${wait.arguments[0].getText(parsed)})();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const cards = Array.from({ length: 12 }, (_, index) => [index === 0 ? 'useful' : 'attention']);
  const sources = [
    { id: 'usgs', state: 'working' },
    { id: 'gdacs', state: 'degraded' },
    { id: 'open-meteo', state: 'unknown' },
    { id: 'gdelt-news', state: 'working' },
  ];
  const fixtures = [
    { name: 'empty DOM is not ready', cards: [], sources: [], mountShell: false, ready: false },
    { name: 'the shell alone is not ready', cards: [], sources: [], ready: false },
    { name: 'a missing Deck card is not ready', cards: cards.slice(1), sources, ready: false },
    { name: 'an extra Deck card is not ready', cards: [...cards, ['attention']], sources, ready: false },
    { name: 'a loading Deck card is not ready', cards: [['loading'], ...cards.slice(1)], sources, ready: false },
    { name: 'an unrecognized Deck state is not ready', cards: [['unexpected'], ...cards.slice(1)], sources, ready: false },
    { name: 'loading with attention is not ready', cards: [['loading', 'attention'], ...cards.slice(1)], sources, ready: false },
    { name: 'a missing source is not ready', cards, sources: sources.slice(0, -1), ready: false },
    { name: 'an extra source is not ready', cards, sources: [...sources, sources[0]], ready: false },
    { name: 'a different source identity is not ready', cards, sources: [{ id: 'unexpected', state: 'working' }, ...sources.slice(1)], ready: false },
    { name: 'a duplicated source identity is not ready', cards, sources: [sources[1], ...sources.slice(1)], ready: false },
    { name: 'reordered source identities are not ready', cards, sources: [...sources].reverse(), ready: false },
    { name: 'a loading source is not ready', cards, sources: [{ ...sources[0], state: 'loading' }, ...sources.slice(1)], ready: false },
    { name: 'an unrecognized source state is not ready', cards, sources: [{ ...sources[0], state: 'unexpected' }, ...sources.slice(1)], ready: false },
    { name: 'complete useful and attention outcomes are ready', cards, sources, ready: true },
    { name: 'complete successful outcomes can be ready early', cards: cards.map(() => ['useful']), sources: sources.map((source) => ({ ...source, state: 'working' })), ready: true },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.name, (caseTest) => {
      const window = new Window({ url: 'http://127.0.0.1/' });
      caseTest.after(() => window.happyDOM.abort());
      const { document } = window;
      if (fixture.mountShell !== false) {
        const shell = document.createElement('div');
        shell.className = 'home-shell';
        const grid = document.createElement('div');
        grid.className = 'hs-deck-grid';
        for (const states of fixture.cards) {
          const card = document.createElement('article');
          card.className = `hs-card ${states.map((state) => `hs-card-readiness-${state}`).join(' ')}`;
          grid.append(card);
        }
        shell.append(grid);
        for (const source of fixture.sources) {
          const row = document.createElement('li');
          row.className = 'hs-readiness-source';
          row.dataset.sourceId = source.id;
          row.dataset.sourceState = source.state;
          shell.append(row);
        }
        document.body.append(shell);
      }
      assert.equal(vm.runInNewContext(condition, { document }, { timeout: 1000 }), fixture.ready, fixture.name);
    });
  }

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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as flush } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { runVaultIntro } from '../src/app/vault-intro.ts';

const startup = () => import('../src/app/workspace-startup.ts');

function appFixture() {
  const gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  return { gate, calls, app: {
    init: () => { calls.push('init'); return gate.promise; },
    openWorkspace: () => { calls.push('open'); },
    destroy: () => { calls.push('destroy'); },
  } };
}

test('normal web and desktop entry use the observable workspace gate', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /startWorkspace\(app,/);
  assert.match(main, /runVaultIntro\(ready\)/);
  assert.match(main, /showWorkspaceStartupFailure\(/);
});

test('web waits for usable UI before activating the workspace', async () => {
  const { startWorkspace } = await startup();
  const { app, calls, gate } = appFixture();
  const done = startWorkspace(app);
  assert.deepEqual(calls, ['init']);
  gate.resolve();
  assert.equal(await done, true);
  assert.deepEqual(calls, ['init', 'open']);
});

for (const first of ['intro', 'init']) {
  test('desktop retains eligibility until both interactive init and dismissal (' + first + ' first)', async () => {
    const { startWorkspace } = await startup();
    const { app, calls, gate } = appFixture();
    const dismissal = Promise.withResolvers<boolean>();
    const done = startWorkspace(app, () => dismissal.promise);
    if (first === 'intro') dismissal.resolve(true);
    else gate.resolve();
    await flush();
    assert.deepEqual(calls, ['init']);
    gate.resolve();
    dismissal.resolve(true);
    assert.equal(await done, true);
    assert.deepEqual(calls, ['init', 'open']);
  });
}

test('quit disposes promptly while initialization is pending and never activates later', async () => {
  const { startWorkspace } = await startup();
  const { app, calls, gate } = appFixture();
  let canceled = false;
  const done = startWorkspace(app, async () => false).then(value => { canceled = !value; });
  await flush();
  assert.equal(canceled, true, 'quit settles before pending init');
  gate.resolve();
  await done;
  await flush();
  assert.deepEqual(calls, ['init', 'destroy']);
});

test('early desktop rejection remains observable after intro dismissal and never activates', async () => {
  const { startWorkspace } = await startup();
  const { app, calls, gate } = appFixture();
  const dismissal = Promise.withResolvers<boolean>();
  const done = startWorkspace(app, () => dismissal.promise);
  const failure = new Error('prerequisite');
  gate.reject(failure);
  await flush();
  dismissal.resolve(true);
  await assert.rejects(done, (err) => err === failure);
  assert.deepEqual(calls, ['init', 'destroy']);
});

test('fatal startup offers one keyboard retry, preserves existing focus and exposes no raw errors', async () => {
  const { showWorkspaceStartupFailure } = await startup();
  const browser = new Window();
  const doc = browser.document as unknown as Document;
  let reloads = 0;
  showWorkspaceStartupFailure(doc, () => { reloads++; });
  const retry = doc.querySelector('button');
  assert.match(doc.querySelector('[role="alert"]')?.textContent ?? '', /could not open/i);
  assert.ok(doc.activeElement === retry, 'reload receives focus when nothing else owns it');
  assert.equal(retry?.type, 'button');
  retry!.click();
  assert.equal(reloads, 1);
  const other = doc.createElement('button');
  doc.body.prepend(other);
  other.focus();
  showWorkspaceStartupFailure(doc, () => { reloads++; });
  assert.equal(doc.querySelectorAll('[role="alert"]').length, 1);
  assert.ok(doc.activeElement === other, 'repeat failure preserves external focus');
  doc.getElementById('workspace-startup-failure')!.remove();
  showWorkspaceStartupFailure(doc, () => { reloads++; });
  assert.ok(doc.activeElement === other, 'initial failure must preserve focused privacy controls');
  await browser.happyDOM.close();
});

function introFixture(t: TestContext) {
  const browser = new Window();
  const doc = browser.document;
  const gradient = { addColorStop() {} };
  const drawing = new Proxy({}, { get: () => () => gradient });
  t.mock.method(browser.HTMLCanvasElement.prototype, 'getContext', () => drawing);
  t.mock.method(browser, 'close', () => {});
  Object.assign(globalThis, { window: browser, document: doc });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(async () => { t.mock.timers.reset(); await browser.happyDOM.close(); });
  return { doc, async advance(ms: number) { t.mock.timers.tick(ms); await flush(); } };
}

for (const state of ['fulfilled', 'pending', 'failed']) {
  test('vault animation reports ' + state + ' accurately and releases overlay within its bound', async (t) => {
    const { doc, advance } = introFixture(t);
    const gate = Promise.withResolvers<void>();
    const done = runVaultIntro(gate.promise);
    if (state === 'fulfilled') gate.resolve();
    if (state === 'failed') gate.reject(new Error('private failure'));
    for (const ms of [1200, 700, 600, 260, 540]) {
      assert.doesNotMatch(doc.body.textContent, /READY|private failure/i);
      await advance(ms);
    }
    if (state === 'pending') await advance(1700);
    const expected = { fulfilled: 'OPENING WORKSPACE', pending: 'STILL INITIALIZING', failed: 'WORKSPACE UNAVAILABLE' }[state]!;
    assert.ok(doc.body.textContent.includes(expected), doc.body.textContent);
    for (const ms of [200, 380, 80, 520, 1150]) await advance(ms);
    assert.equal(await done, true);
    assert.equal(doc.body.children.length, 0);
  });
}

test('Quit during the door animation dismisses the intro without activating the workspace', async (t) => {
  const { doc, advance } = introFixture(t);
  const done = runVaultIntro(new Promise(() => {}));
  for (const ms of [1200, 700, 600]) await advance(ms);
  doc.querySelector('button')!.click();
  await flush();
  assert.equal(doc.body.children.length, 0);
  assert.equal(await done, false);
});

test('a cleanup error cannot replace the initialization error after partial startup', async () => {
  const { startWorkspace } = await startup();
  const original = new Error('initialization');
  const { app, gate } = appFixture();
  app.destroy = () => { throw new Error('partial cleanup'); };
  const done = startWorkspace(app);
  gate.reject(original);
  await assert.rejects(done, (error) => error === original);
});

test('a broken intro is removed and the original error propagates to startup recovery', async (t) => {
  const { doc, advance } = introFixture(t);
  const original = new Error('audio failed');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: class { createOscillator() { throw original; } },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  });
  const done = assert.rejects(runVaultIntro(Promise.resolve()), (error) => error === original);
  for (const ms of [1200, 700, 600, 260]) await advance(ms);
  assert.equal(doc.body.children.length, 0);
  await done;
});

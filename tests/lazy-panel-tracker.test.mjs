import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { Window } from 'happy-dom';
import { findInsertBeforeKey } from '../src/app/lazy-panel-order.ts';

const source = readFileSync(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('panel-layout.ts', source, ts.ScriptTarget.Latest, true);
const manager = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PanelLayoutManager');
const names = ['insertPanelInOrder', 'mountLazyPanel', 'startLastViewedTracker'];
const methods = names.map(name => {
  const method = manager?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name);
  assert.ok(method, `real ${name} method exists`);
  return method.getText(parsed);
}).join('\n');
const compiled = ts.transpileModule(`class PanelLayoutManager {
  static LAST_VIEWED_KEY = 'cb-last-viewed-panel';
  ${methods}
}
return new PanelLayoutManager();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness(t, { observer = true } = {}) {
  const win = new Window({ url: 'http://localhost/' });
  t.after(() => win.happyDOM.close());
  const grid = win.document.createElement('div');
  grid.id = 'panelsGrid';
  win.document.body.append(grid);
  const warnings = [];
  class Observer {
    targets = new Set();
    constructor(callback) { this.callback = callback; }
    observe(target) {
      assert.equal(target.parentElement === grid, true, 'enrollment happens after grid insertion');
      this.targets.add(target);
    }
    disconnect() { this.targets.clear(); }
    visible(target, ratio = 0.75) {
      if (this.targets.has(target)) this.callback([{ target, isIntersecting: true, intersectionRatio: ratio }]);
    }
  }
  const owner = new Function('document', 'localStorage', 'IntersectionObserver', 'findInsertBeforeKey', 'console', compiled)(
    win.document, win.localStorage, observer ? Observer : undefined, findInsertBeforeKey,
    { warn: (...args) => warnings.push(args) },
  );
  Object.assign(owner, {
    ctx: { panels: {}, panelSettings: {} }, destroyed: false,
    lazyFactories: new Map(), mountingPanels: new Map(), _lastViewedObserver: null,
    computePanelOrder: () => ['command-center', 'api-diagnostic', 'monitors'],
    makeDraggable: () => {},
  });
  win.localStorage.setItem('cb-last-viewed-panel', 'sentinel');
  const viewed = () => win.localStorage.getItem('cb-last-viewed-panel');
  function panel(key) {
    const el = win.document.createElement('section');
    el.dataset.panel = key;
    el.innerHTML = '<button>Inspect</button>';
    return {
      el, destroyed: false, enabled: undefined,
      getElement: () => el,
      toggle(enabled) { this.enabled = enabled; el.hidden = !enabled; },
      destroy() { this.destroyed = true; el.remove(); },
    };
  }
  return { win, grid, owner, panel, viewed, warnings };
}

for (const placement of ['append', 'before']) {
  test(`late lazy panel is tracked after ${placement} insertion without moving focus`, async t => {
    const h = harness(t);
    const existing = h.panel(placement === 'before' ? 'monitors' : 'command-center');
    h.grid.append(existing.el);
    existing.el.querySelector('button').focus();
    const focused = h.win.document.activeElement;
    h.owner.startLastViewedTracker();
    const late = h.panel('api-diagnostic');
    h.owner.lazyFactories.set('api-diagnostic', async () => late);
    await h.owner.mountLazyPanel('api-diagnostic');
    assert.equal(h.grid.children[placement === 'before' ? 0 : 1] === late.el, true);
    assert.equal(h.win.document.activeElement === focused, true);
    assert.equal(late.enabled, true);
    assert.equal(h.viewed(), 'sentinel');
    h.owner._lastViewedObserver.visible(late.el, 0.25);
    assert.equal(h.viewed(), 'sentinel');
    h.owner._lastViewedObserver.visible(late.el);
    assert.equal(h.viewed(), 'api-diagnostic');
  });
}

test('panels inserted before observer creation are enrolled by the initial scan', t => {
  const h = harness(t);
  const early = h.panel('command-center');
  h.owner.insertPanelInOrder('command-center', early.el);
  h.owner.startLastViewedTracker();
  h.owner._lastViewedObserver.visible(early.el);
  assert.equal(h.viewed(), 'command-center');
});

test('missing IntersectionObserver preserves insertion without persistence', async t => {
  const h = harness(t, { observer: false });
  h.owner.startLastViewedTracker();
  const late = h.panel('api-diagnostic');
  h.owner.lazyFactories.set('api-diagnostic', async () => late);
  assert.equal(await h.owner.mountLazyPanel('api-diagnostic') === late, true);
  assert.equal(late.el.parentElement === h.grid, true);
  assert.equal(h.viewed(), 'sentinel');
});

test('a missing grid leaves detached panels unenrolled', t => {
  const h = harness(t);
  h.owner.startLastViewedTracker();
  h.grid.remove();
  const late = h.panel('api-diagnostic');
  h.owner.insertPanelInOrder('api-diagnostic', late.el);
  assert.equal(late.el.isConnected, false);
  assert.equal(h.owner._lastViewedObserver.targets.size, 0);
});

test('a pending factory completion after destruction never mounts or enrolls', async t => {
  const h = harness(t);
  h.owner.startLastViewedTracker();
  const late = h.panel('api-diagnostic');
  let resolve;
  h.owner.lazyFactories.set('api-diagnostic', () => new Promise(done => { resolve = done; }));
  const mounting = h.owner.mountLazyPanel('api-diagnostic');
  h.owner.destroyed = true;
  resolve(late);
  assert.equal(await mounting, null);
  assert.equal(late.destroyed, true);
  assert.equal(late.el.isConnected, false);
  assert.equal(h.owner._lastViewedObserver.targets.size, 0);
  assert.equal(h.owner.ctx.panels['api-diagnostic'], undefined);
  assert.equal(h.owner.mountingPanels.size, 0);
});

test('concurrent requests build once and preserve disabled state', async t => {
  const h = harness(t);
  h.owner.startLastViewedTracker();
  let calls = 0;
  const late = h.panel('api-diagnostic');
  h.owner.ctx.panelSettings['api-diagnostic'] = { enabled: false };
  h.owner.lazyFactories.set('api-diagnostic', async () => { calls++; return late; });
  const first = h.owner.mountLazyPanel('api-diagnostic');
  assert.equal(h.owner.mountLazyPanel('api-diagnostic') === first, true);
  await first;
  assert.equal(await h.owner.mountLazyPanel('api-diagnostic') === late, true);
  assert.equal(calls, 1);
  assert.equal(late.el.hidden, true);
  assert.equal(h.owner.mountingPanels.size, 0);
});

test('failed lazy loading leaves no tracked node and permits retry', async t => {
  const h = harness(t);
  h.owner.startLastViewedTracker();
  h.owner.lazyFactories.set('api-diagnostic', async () => { throw new Error('chunk unavailable'); });
  assert.equal(await h.owner.mountLazyPanel('api-diagnostic'), null);
  assert.equal(h.owner._lastViewedObserver.targets.size, 0);
  assert.equal(h.owner.mountingPanels.size, 0);
  assert.equal(h.warnings.length, 1);
  const late = h.panel('api-diagnostic');
  h.owner.lazyFactories.set('api-diagnostic', async () => late);
  assert.equal(await h.owner.mountLazyPanel('api-diagnostic') === late, true);
  assert.equal(late.el.isConnected, true);
});

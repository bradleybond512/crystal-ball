import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { afterEach } from 'node:test';
import ts from 'typescript';
import { Window } from 'happy-dom';
import { DigestOverlay } from '../src/components/DigestOverlay.ts';

const layout = readFileSync(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function environment(complete = true) {
  const win = new Window({ url: 'http://localhost/' });
  for (const key of ['document', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'CustomEvent', 'localStorage']) globalThis[key] = win[key];
  globalThis.window = win;
  globalThis.getComputedStyle = win.getComputedStyle.bind(win);
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0);
  if (complete) win.localStorage.setItem('cb:onboarding-complete', 'true');
  cleanups.push(() => win.happyDOM.abort());
  return win;
}
async function welcome() {
  const { WelcomeFlow } = await import('../src/components/WelcomeFlow.ts');
  const flow = new WelcomeFlow();
  flow.show();
  return [...document.querySelectorAll('.cb-backdrop button')];
}
function digest(options) {
  const overlay = new DigestOverlay(options);
  overlay.mount(document.body);
  cleanups.push(() => overlay.destroy());
  return overlay;
}
function key(target, key, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}
for (const order of ['digest-first', 'welcome-first']) {
  test(`${order}: Welcome owns internal Tab, wrapping and Escape`, async () => {
    environment();
    let overlay;
    if (order === 'digest-first') { overlay = digest(); overlay.showStatus('Loading'); }
    const [first, last] = await welcome();
    if (!overlay) { overlay = digest(); overlay.showStatus('Loading'); first.focus(); }
    const internal = key(first, 'Tab');
    assert.equal(internal.defaultPrevented, false, 'internal Welcome Tab must reach native traversal');
    assert.equal(document.activeElement === first, true);
    last.focus();
    key(last, 'Tab');
    assert.equal(document.activeElement === first, true, 'Welcome forward wrap must retain focus');
    key(first, 'Tab', true);
    assert.equal(document.activeElement === last, true, 'Welcome backward wrap must retain focus');
    key(last, 'Escape');
    assert.equal(overlay.isVisible(), true, 'Welcome Escape must not also dismiss Digest');
    assert.equal(localStorage.getItem('cb:onboarding-complete'), 'true');
  });
}
test('Digest yields an already consumed key even when focus is in Digest', () => {
  environment();
  const overlay = digest(); overlay.showStatus('Loading');
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  event.preventDefault(); document.dispatchEvent(event);
  assert.equal(overlay.isVisible(), true);
});
test('Digest yields document-dispatched keys while another modal owns active focus', async () => {
  environment();
  const overlay = digest(); overlay.showStatus('Loading');
  const [first] = await welcome();
  key(document, 'Tab');
  assert.equal(document.activeElement === first, true);
  key(document, 'Escape');
  assert.equal(overlay.isVisible(), true);
});
test('Digest yields a key targeted at another dialog after focus moved away', () => {
  environment();
  const overlay = digest(); overlay.showStatus('Loading');
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  const button = document.createElement('button'); modal.append(button); document.body.append(modal);
  assert.equal(key(button, 'Tab').defaultPrevented, false);
  assert.equal(document.activeElement === document.querySelector('.digest-close'), true);
});
test('visible status and card refreshes do not steal foreground modal focus', async () => {
  environment();
  const overlay = digest(); overlay.showStatus('Loading');
  const [first] = await welcome();
  for (const status of ['loading', 'empty', 'degraded', 'error']) {
    overlay.showStatus(status, status);
    assert.equal(document.activeElement === first, true, status);
  }
  overlay.show([{ headline: 'Updated', narrative: '', locationText: '', impactText: '', impactStatus: 'unknown' }]);
  assert.equal(document.activeElement === first, true);
});
for (const action of ['hide', 'destroy']) {
  test(`background ${action} preserves foreground modal focus`, async () => {
    environment();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const overlay = digest(); overlay.showStatus('Loading');
    const [first] = await welcome();
    overlay[action]();
    assert.equal(document.activeElement === first, true);
  });
}
test('opening predicate blocks cards and all status states until allowed', () => {
  environment();
  let allowed = false;
  const overlay = digest({ canOpen: () => allowed });
  for (const status of ['loading', 'empty', 'degraded', 'error']) {
    overlay.showStatus(status, status);
    assert.equal(overlay.isVisible(), false, status);
  }
  overlay.show([{ headline: 'Updated', narrative: '', locationText: '', impactText: '', impactStatus: 'unknown' }]);
  assert.equal(overlay.isVisible(), false);
  allowed = true; overlay.showStatus('Ready');
  assert.equal(overlay.isVisible(), true);
});
function lifecycle({ complete = true, idle = true } = {}) {
  const win = environment(complete);
  const pending = [];
  const scheduled = new Map();
  let serial = 0; let marked = 0;
  const schedule = callback => { const id = ++serial; scheduled.set(id, callback); return id; };
  win.setTimeout = schedule; win.clearTimeout = id => scheduled.delete(id);
  if (idle) { win.requestIdleCallback = schedule; win.cancelIdleCallback = id => scheduled.delete(id); }
  else { win.requestIdleCallback = undefined; }
  const owner = { digestGeneration: 0, digestSeeds: [], destroyed: false };
  const start = layout.indexOf('this.digestOverlay = new DigestOverlay');
  const end = layout.indexOf('// Mount Today view', start);
  const source = ts.transpileModule(layout.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const bindings = {
    DigestOverlay, document: win.document, window: win, AbortController,
    unifiedAlertStore: { getAll: () => [], subscribe: () => () => {} },
    getSavedPlaces: () => [], subscribeSavedPlaces: () => () => {},
    projectDigestStories: ({ seeds }) => seeds.map(seed => ({ ...seed, recheckAt: null, locationText: '', impactText: '', impactStatus: 'unknown' })),
    shouldShowDigest: () => true, markDigestShown: () => { marked++; },
    generateDigest: signal => new Promise((resolve, reject) => pending.push({ resolve, reject, signal })),
    console: { warn() {} },
  };
  new Function(...Object.keys(bindings), source).call(owner, ...Object.values(bindings));
  cleanups.push(() => {
    owner.destroyed = true; owner.cancelScheduledDigest?.(); owner.digestAbortController?.abort();
    document.removeEventListener('cb:show-digest', owner._onShowDigest);
    document.removeEventListener('visibilitychange', owner.onDigestVisibility);
    owner.digestOverlay.destroy();
  });
  return {
    owner, pending, scheduled, get marked() { return marked; },
    run() { for (const [id, callback] of [...scheduled]) { scheduled.delete(id); callback(); } },
    open() { document.dispatchEvent(new Event('cb:show-digest')); },
    async settle(success = true) {
      const request = pending.at(-1); assert.ok(request);
      if (success) request.resolve([{ id: 'story', alertIds: [], headline: 'Brief', narrative: '' }]);
      else request.reject(new Error('offline'));
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  };
}
for (const idle of [true, false]) {
  test(`${idle ? 'idle' : 'timeout'}: first-run skips proactive digest for the entire boot`, () => {
    const h = lifecycle({ complete: false, idle });
    assert.equal(h.scheduled.size, 0);
    localStorage.setItem('cb:onboarding-complete', 'true'); h.run();
    assert.equal(h.pending.length, 0); assert.equal(h.marked, 0);
  });
  test(`${idle ? 'idle' : 'timeout'}: scheduled run rechecks onboarding before generation`, () => {
    const h = lifecycle({ idle }); assert.equal(h.scheduled.size, 1);
    localStorage.removeItem('cb:onboarding-complete'); h.run();
    assert.equal(h.pending.length, 0); assert.equal(h.marked, 0);
  });
}
for (const success of [true, false]) {
  test(`async ${success ? 'success' : 'failure'} cannot open over Welcome or mark shown`, async () => {
    const h = lifecycle(); h.run();
    const [first] = await welcome();
    await h.settle(success);
    assert.equal(h.owner.digestOverlay.isVisible(), false);
    assert.equal(document.activeElement === first, true); assert.equal(h.marked, 0);
    assert.equal(document.querySelector('.digest-status') === null, true, 'blocked completion must not render or announce an error behind Welcome');
  });
}
for (const success of [true, false]) {
  test(`on-demand ${success ? 'success' : 'failure'} preserves Welcome and the existing loading state`, async () => {
    const h = lifecycle(); h.open();
    const [first] = await welcome();
    await h.settle(success);
    assert.equal(document.activeElement === first, true);
    assert.equal(h.marked, 0);
    assert.equal(document.querySelector('.digest-status').textContent, 'Generating brief…');
  });
}
test('on-demand during import gap does nothing; explicit opening after Welcome works', async () => {
  const h = lifecycle({ complete: false }); h.open();
  assert.equal(h.pending.length, 0);
  const [first] = await welcome(); key(first, 'Escape');
  document.querySelector('.cb-backdrop').dispatchEvent(new Event('animationend'));
  h.open(); assert.equal(h.pending.length, 1);
  assert.equal(h.owner.digestOverlay.isVisible(), true);
  await h.settle(); assert.equal(h.marked, 1);
  assert.match(document.querySelector('.digest-body').textContent, /Brief/);
});
test('dismissed generation stays aborted and teardown prevents async reopen', async () => {
  const h = lifecycle(); h.open(); h.owner.digestOverlay.hide();
  assert.equal(h.pending[0].signal.aborted, true);
  await h.settle(); assert.equal(h.marked, 0); assert.equal(h.owner.digestOverlay.isVisible(), false);
  h.open(); h.owner.destroyed = true; h.owner.digestOverlay.destroy();
  await h.settle(false); assert.equal(document.querySelector('.digest-overlay') === null, true);
});

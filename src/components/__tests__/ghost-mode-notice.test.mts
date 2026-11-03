import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before } from 'node:test';
import '../../../tests/panels/register-hook.mjs';
import '../../../tests/panels/setup-dom.mts';

let mountGhostModeNotice: typeof import('../GhostModeNotice.ts').mountGhostModeNotice;
before(async () => { ({ mountGhostModeNotice } = await import('../GhostModeNotice.ts')); });
type State = ReturnType<typeof import('../../services/mode-manager.ts').getGhostModeState>;

function setup(t: import('node:test').TestContext, initial: Partial<State> = {}) {
  const host = document.createElement('div');
  const toolbar = document.createElement('button');
  toolbar.id = 'ghostModeBtn';
  document.body.append(host, toolbar);
  let state: State = { mode: 'ghost', preference: 'saved', generation: 1, muted: 0, critical: 0, ...initial };
  let listener: (() => void) | undefined;
  const exitCalls: number[] = [];
  const choices: (State['mode'])[] = [];
  function update(change: Partial<State>) {
    state = { ...state, ...change };
    listener?.();
  }
  const unmount = mountGhostModeNotice(host, {
    snapshot: () => state,
    subscribe: (notify) => { listener = notify; return () => { listener = undefined; }; },
    exit: () => { exitCalls.push(1); update({ mode: null }); },
    choose: (mode) => { choices.push(mode); update({ mode, preference: 'saved' }); },
  });
  t.after(() => { unmount(); host.remove(); toolbar.remove(); });
  const root = host.querySelector<HTMLElement>('.cb-ghost-notice')!;
  const action = (id: string) => root.querySelector<HTMLButtonElement>(`button[data-action="${id}"]`)!;
  return { host, toolbar, root, action, exitCalls, choices, update, unmount, subscribed: () => !!listener };
}

test('Ghost shows the covered critical policy, channel exception and window counts; unchanged copy is silent on increments', (t) => {
  const { root, update, action } = setup(t);
  assert.equal(root.hidden, false);
  const status = root.querySelector('[role="status"]')!;
  assert.match(status.textContent!, /critical site warnings/i);
  assert.match(status.textContent!, /other channels can still alert/i);
  const count = root.querySelector<HTMLElement>('.cb-ghost-notice-count')!;
  assert.ok(!count.closest('[role="status"],[aria-live="polite"],[aria-live="assertive"]'), 'count outside live regions');
  assert.match(count.textContent!, /this window/i);
  const previousMessage = status.firstChild;
  action('exit-ghost').focus();
  update({ muted: 5, critical: 3 });
  assert.ok(status.firstChild === previousMessage, 'message node unchanged on count update');
  assert.match(count.textContent!, /5.*3 critical/i);
  assert.ok(document.activeElement === action('exit-ghost'), 'focus on expected control');
  update({ muted: 9999, critical: 9999 });
  assert.match(count.textContent!, /9,?999\+.*9,?999\+ critical/);
});

test('keyboard button exits restored Ghost and returns focus to the mode control', (t) => {
  const f = setup(t);
  const button = f.action('exit-ghost');
  assert.equal(button.type, 'button');
  button.focus();
  button.click();
  assert.equal(f.exitCalls.length, 1);
  assert.equal(f.root.hidden, true);
  assert.ok(document.activeElement === f.toolbar, 'focus on expected control');
});

test('unknown preference explains the hold, offers an explicit choice and withholds Ghost counters', (t) => {
  const f = setup(t, { mode: null, preference: 'unknown' });
  assert.equal(f.root.hidden, false);
  assert.match(f.root.textContent!, /could not read/i);
  assert.equal(f.root.querySelector<HTMLElement>('.cb-ghost-notice-count')!.hidden, true);
  assert.equal(f.action('use-standard').hidden, false);
  assert.equal(f.action('use-ghost').hidden, false);
  assert.equal(f.action('exit-ghost').hidden, true);
  f.action('use-ghost').focus();
  f.action('use-ghost').click();
  assert.deepEqual(f.choices, ['ghost']);
  assert.ok(document.activeElement === f.action('exit-ghost'), 'focus on expected control');
  f.update({ mode: null, preference: 'unknown' });
  f.action('use-standard').click();
  assert.deepEqual(f.choices, ['ghost', null]);
  assert.equal(f.root.hidden, true);
});

test('unsaved Ghost, normal, and God’s Vision each explain the window-only choice; retry uses the current mode', (t) => {
  const f = setup(t, { preference: 'window-only' });
  assert.match(f.root.textContent!, /only in this window/i);
  assert.equal(f.action('exit-ghost').hidden, false);
  for (const mode of [null, 'gods-vision', 'ghost'] as const) {
    f.update({ mode, preference: 'window-only' });
    assert.equal(f.root.hidden, false);
    assert.equal(f.action('save-mode').hidden, false);
    f.action('save-mode').click();
    assert.equal(f.choices.at(-1), mode);
    assert.equal(f.root.hidden, mode !== 'ghost');
  }
});

test('teardown removes the listener and the visible notice', (t) => {
  const f = setup(t);
  f.unmount();
  assert.equal(f.subscribed(), false);
  assert.ok(f.host.querySelector('.cb-ghost-notice') === null, 'unmount removes the standalone notice');
});

test('Home mounts its notice in the pinned header and removes it on teardown', async (t) => {
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const { setMode } = await import('../../services/mode-manager.ts');
  setMode('ghost');
  const host = document.createElement('main');
  document.body.append(host);
  const shell = new HomeShellOverlay({ ensurePanel: async () => undefined, getPanel: () => undefined });
  t.after(() => { shell.destroy(); host.remove(); setMode(null); });
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  let remeasure: (() => void) | undefined;
  let disconnected = false;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    constructor(private readonly resized: () => void) {}
    private header = false;
    observe(el: HTMLElement) {
      this.header = el.classList.contains('home-shell-header');
      if (this.header) remeasure = this.resized;
    }
    disconnect() { if (this.header) disconnected = true; }
  } });
  t.after(() => {
    if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });
  shell.mount(host);
  const header = host.querySelector<HTMLElement>('.home-shell-header')!;
  let height = 65;
  Object.defineProperty(header, 'offsetHeight', { get: () => height });
  shell.show();
  assert.equal(host.querySelector<HTMLElement>('.home-shell')!.style.getPropertyValue('--hs-topbar-h'), '65px');
  height = 112;
  assert.ok(remeasure);
  remeasure();
  assert.equal(host.querySelector<HTMLElement>('.home-shell')!.style.getPropertyValue('--hs-topbar-h'), '112px');
  assert.ok(document.body.classList.contains('home-shell-active'));
  assert.equal(host.querySelector<HTMLElement>('.home-shell-header .cb-ghost-notice')?.hidden, false);
  shell.hide();
  assert.equal(disconnected, true);
  assert.equal(host.querySelector<HTMLElement>('.home-shell')!.hidden, true);
  shell.show();
  assert.equal(host.querySelectorAll('.cb-ghost-notice').length, 1);
  const notice = host.querySelector<HTMLElement>('.cb-ghost-notice')!;
  shell.destroy();
  assert.ok(host.querySelector('.cb-ghost-notice') === null, 'destroy removes the Home notice');
  setMode(null);
  assert.equal(notice.hidden, false, 'destroyed notice no longer subscribes');
});

test('switching shells transfers focused notice actions in both directions without stealing unrelated focus', async (t) => {
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const { setMode } = await import('../../services/mode-manager.ts');
  setMode('ghost');
  const classic = document.createElement('div');
  classic.id = 'cb-notification-stack';
  const outside = document.createElement('button');
  const home = document.createElement('div');
  document.body.append(classic, outside, home);
  const unmount = mountGhostModeNotice(classic);
  const shell = new HomeShellOverlay({ ensurePanel: async () => undefined, getPanel: () => undefined });
  t.after(() => { shell.destroy(); unmount(); setMode(null); classic.remove(); home.remove(); outside.remove(); });
  shell.mount(home);
  const classicAction = classic.querySelector<HTMLButtonElement>('[data-action="exit-ghost"]')!;
  const homeAction = home.querySelector<HTMLButtonElement>('[data-action="exit-ghost"]')!;
  classicAction.focus();
  shell.show();
  assert.ok(document.activeElement === homeAction, 'Home adopts the focused classic action');
  shell.hide();
  assert.ok(document.activeElement === classicAction, 'classic restores the focused Home action');
  outside.focus();
  shell.show();
  assert.ok(document.activeElement === outside, 'show preserves unrelated focus');
  shell.hide();
  assert.ok(document.activeElement === outside, 'hide preserves unrelated focus');
  classicAction.focus();
  shell.show();
  shell.destroy();
  assert.ok(document.activeElement === classicAction, 'destroying the active Home shell restores the classic action');
});

test('Home can mount and show the unknown-mode choice when the preference and pins cannot be read', async (t) => {
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const mode = await import('../../services/mode-manager.ts');
  const host = document.createElement('main');
  document.body.append(host);
  const shell = new HomeShellOverlay({ ensurePanel: async () => undefined, getPanel: () => undefined });
  const store = globalThis.localStorage;
  const unavailable = new Proxy(store, { get(target, key) {
    if (key === 'getItem') return () => { throw new Error('unavailable'); };
    return Reflect.get(target, key, target);
  } });
  t.after(() => { globalThis.localStorage = store; mode.setMode(null); shell.destroy(); host.remove(); });
  globalThis.localStorage = unavailable;
  mode.getNotificationModeState();
  shell.mount(host);
  shell.show();
  const notice = host.querySelector<HTMLElement>('.home-shell-header .cb-ghost-notice')!;
  assert.equal(notice.hidden, false);
  assert.match(notice.querySelector('[role="status"]')!.textContent!, /could not read/i);
  assert.equal(notice.querySelector<HTMLButtonElement>('[data-action="use-standard"]')!.hidden, false);
});

test('cold-boot notice stands outside the app and retains visible choices, errors and focus through handoff', async (t) => {
  const { mountGhostBootNotice } = await import('../../bootstrap/ghost-mode-notice.ts');
  const { notificationStack } = await import('../NotificationStack.ts');
  const mode = await import('../../services/mode-manager.ts');
  const store = globalThis.localStorage;
  const denied = new Proxy(store, { get(target, key) {
    if (['getItem', 'setItem', 'removeItem'].includes(String(key))) return () => { throw new Error('unavailable'); };
    return Reflect.get(target, key, target);
  } });
  const app = document.createElement('div');
  app.id = 'app';
  app.append(document.createElement('div'));
  document.body.append(app);
  t.after(() => { globalThis.localStorage = store; mode.setMode(null); app.remove(); notificationStack.destroy(); });
  globalThis.localStorage = denied;
  mode.getNotificationModeState();
  const early = mountGhostBootNotice();
  const stack = notificationStack.element;
  assert.ok(stack.isConnected && !app.contains(stack));
  const root = stack.querySelector<HTMLElement>('.cb-ghost-notice')!;
  const action = (id: string) => root.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
  assert.match(root.textContent!, /could not read/i);
  early.showStartupFailure();
  early.showStartupFailure();
  assert.equal(stack.querySelectorAll('.cb-ghost-startup-failure').length, 1);
  assert.match(stack.querySelector('.cb-ghost-startup-failure')!.textContent!, /could not finish starting/i);
  action('use-ghost').click();
  assert.equal(root.hidden, false);
  assert.match(root.textContent!, /only in this window/i);
  action('exit-ghost').focus();
  const currentMessage = root.querySelector('[role="status"]')!.firstChild;
  const cleanup = mountGhostModeNotice(stack);
  t.after(cleanup);
  notificationStack.mount(document.body);
  assert.equal(stack.querySelectorAll('.cb-ghost-notice').length, 1);
  assert.ok(root === stack.querySelector('.cb-ghost-notice'), 'handoff adopts original notice');
  assert.ok(root.querySelector('[role="status"]')!.firstChild === currentMessage, 'handoff preserves live message');
  assert.ok(document.activeElement === action('exit-ghost'), 'handoff retains focused action');
  action('exit-ghost').click();
  assert.match(root.textContent!, /standard mode is on/i);
  assert.equal(action('save-mode').hidden, false);
  globalThis.localStorage = store;
  action('save-mode').focus();
  action('save-mode').click();
  assert.equal(root.hidden, true);
  assert.ok(document.activeElement === stack.querySelector('.cb-ghost-startup-failure'), 'app failure receives focus after last action disappears');
});

test('classic mount and responsive shell styles keep a single active notice in view', () => {
  const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
  assert.match(read('../../main.ts'), /mountGhostModeNotice\(notificationStack\.element\)/);
  assert.match(read('../../styles/alerts.css'), /body\.home-shell-active #cb-notification-stack \.cb-ghost-notice\s*\{\s*display: none/);
  assert.match(read('../../styles/home-shell.css'), /\.home-shell-header\s*\{[^}]*position: sticky/);
});

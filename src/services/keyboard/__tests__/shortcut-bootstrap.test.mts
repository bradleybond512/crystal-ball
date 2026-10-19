import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { matchesChord } from '../shortcut-registry.ts';

const browser = new Window({ url: 'http://127.0.0.1/' });
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const observers: TestObserver[] = [];
class TestObserver {
  connected = false;
  constructor(readonly callback: () => void) { observers.push(this); }
  observe() { this.connected = true; }
  disconnect() { this.connected = false; }
}
Object.assign(globalThis, {
  window: browser, document: browser.document, localStorage: browser.localStorage,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node,
  CustomEvent: browser.CustomEvent, KeyboardEvent: browser.KeyboardEvent, CSS: browser.CSS,
  MutationObserver: TestObserver,
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
  cancelAnimationFrame: (id: number) => frames.delete(id),
});
const { installShortcuts, getActiveRegistry } = await import('../shortcut-bootstrap.ts');
const { HelpOverlay } = await import('../../../components/HelpOverlay.ts');
let handles: ReturnType<typeof installShortcuts> | null = null;
const cleanups: (() => void)[] = [];
afterEach(() => {
  handles?.destroy(); handles = null;
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
  frames.clear(); observers.length = 0;
});
after(() => browser.happyDOM.abort());

function count(name: string) {
  let calls = 0;
  const listener = () => calls++;
  document.addEventListener(name, listener);
  cleanups.push(() => document.removeEventListener(name, listener));
  return () => calls;
}
function button(parent = document.body) {
  const element = document.createElement('button');
  parent.append(element); element.focus(); return element;
}
function key(init: KeyboardEventInit, target = document.activeElement ?? document.body) {
  const event = new browser.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event); return event;
}
function flushFrames() {
  const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0));
}

test('real bootstrap dispatches each feature once and keeps the desktop Ghost callback distinct', () => {
  let legacy = 0;
  const hud = count('cb:toggle-analyst-hud');
  const ghost = count('wm:toggle-ghost-mode');
  const globe = count('cb:toggle-gods-vision');
  handles = installShortcuts({ isDesktopApp: true, toggleLegacyGhost: () => legacy++ });
  button();
  assert.equal(key({ key: 'A', metaKey: true, shiftKey: true }).defaultPrevented, true);
  key({ key: 'a', ctrlKey: true, shiftKey: true });
  key({ key: 'G', metaKey: true, shiftKey: true });
  key({ key: 'g', ctrlKey: true, shiftKey: true });
  key({ key: 'g' });
  key({ key: 'm', metaKey: true });
  assert.deepEqual([hud(), ghost(), globe(), legacy], [2, 2, 1, 1]);
  assert.equal(key({ key: 'm', ctrlKey: true }).defaultPrevented, false);
  assert.equal(key({ key: 'm', ctrlKey: true, metaKey: true }).defaultPrevented, false);
  assert.equal(legacy, 1);
});

test('web leaves Cmd+M to the browser and Help describes exactly the installed registry', () => {
  let legacy = 0;
  handles = installShortcuts({ isDesktopApp: false, toggleLegacyGhost: () => legacy++ });
  button();
  assert.equal(key({ key: 'm', metaKey: true }).defaultPrevented, false);
  assert.equal(legacy, 0);
  const help = new HelpOverlay(handles.registry);
  help.mount(document.body); help.show();
  const labels = [...document.querySelectorAll('.help-label')].map((element) => element.textContent).sort();
  assert.deepEqual(labels, handles.registry.list().map((binding) => binding.label).sort());
  assert.ok(labels.includes('Toggle Analyst HUD'));
  assert.ok(labels.includes('Toggle Ghost Mode'));
  assert.ok(labels.includes("Toggle God's Vision"));
  assert.ok(!handles.registry.list().some((binding) => binding.id === 'ghost-mode-legacy'));
  help.destroy();
  assert.equal(document.querySelector('.help-overlay'), null);
});

test('feature bindings ignore consumed, repeated, composing and editable key events', () => {
  const hud = count('cb:toggle-analyst-hud');
  const globe = count('cb:toggle-gods-vision');
  handles = installShortcuts();
  const target = button();
  for (const extra of [{ repeat: true }, { isComposing: true }]) {
    assert.equal(key({ key: 'g', ...extra }, target).defaultPrevented, false);
    key({ key: 'a', metaKey: true, shiftKey: true, ...extra }, target);
  }
  target.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
  key({ key: 'g' }, target);
  for (const tag of ['input', 'textarea', 'select']) {
    const input = document.createElement(tag); document.body.append(input); input.focus();
    assert.equal(key({ key: 'g' }, input).defaultPrevented, false);
    key({ key: 'a', metaKey: true, shiftKey: true }, input);
  }
  const editor = document.createElement('div'); editor.setAttribute('contenteditable', 'true');
  document.body.append(editor);
  const nested = button(editor);
  key({ key: 'g' }, nested); key({ key: 'a', metaKey: true, shiftKey: true }, nested);
  assert.deepEqual([hud(), globe()], [0, 0]);
});

test('actual visible foreground roots block background actions; only HUD close toggle is allowed inside HUD', () => {
  const hud = count('cb:toggle-analyst-hud');
  const ghost = count('wm:toggle-ghost-mode');
  const globe = count('cb:toggle-gods-vision');
  handles = installShortcuts();
  for (const markup of [
    '<div id="unifiedSettingsModal" class="active"></div>',
    '<div class="cmdk-v2-overlay"></div>', '<div class="help-overlay"></div>',
    '<div role="dialog" aria-labelledby="cb-welcome-title"></div>',
  ]) {
    const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
    button(host.firstElementChild as HTMLElement);
    key({ key: 'g' }); key({ key: 'G', metaKey: true, shiftKey: true }); key({ key: 'A', metaKey: true, shiftKey: true });
    host.remove();
  }
  assert.deepEqual([hud(), ghost(), globe()], [0, 0, 0]);
  const modal = document.createElement('div'); modal.className = 'analyst-hud'; document.body.append(modal);
  button(modal);
  key({ key: 'A', metaKey: true, shiftKey: true });
  key({ key: 'g' }); key({ key: 'G', metaKey: true, shiftKey: true });
  assert.deepEqual([hud(), ghost(), globe()], [1, 0, 0]);
  button(); key({ key: 'A', metaKey: true, shiftKey: true });
  assert.equal(hud(), 1, 'an open HUD does not allow background focus to toggle it');
});

test('inactive, hidden, closing and unrelated dialogs do not claim feature shortcuts', () => {
  const globe = count('cb:toggle-gods-vision');
  handles = installShortcuts();
  document.body.innerHTML = '<div id="unifiedSettingsModal"></div><div class="help-overlay" hidden></div>'
    + '<div class="cmdk-v2-overlay" style="display:none"></div><div class="closing"><div role="dialog" aria-labelledby="cb-welcome-title"></div></div>'
    + '<div role="dialog" aria-modal="true"></div>';
  button(); key({ key: 'g' });
  assert.equal(globe(), 1);
});

test('effective installed chords do not collide and unrelated flight/navigation keys stay unhandled', () => {
  handles = installShortcuts({ isDesktopApp: true, toggleLegacyGhost: () => {} });
  button();
  const featureIds = ['analyst-hud', 'ghost-mode', 'gods-vision', 'ghost-mode-legacy'];
  assert.equal(handles.registry.list().filter((binding) => featureIds.includes(binding.id)).length, 4);
  for (const key of 'abcdefghijklmnopqrstuvwxyz123456789/,\\') {
    for (let flags = 0; flags < 16; flags++) {
      const event = { key, metaKey: Boolean(flags & 1), ctrlKey: Boolean(flags & 2), shiftKey: Boolean(flags & 4), altKey: Boolean(flags & 8) };
      const matches = handles.registry.list().filter((binding) => matchesChord(event, binding.chord) && (!binding.canRun || binding.canRun(event)));
      assert.ok(matches.length <= 1, `${key}/${flags}: ${matches.map((binding) => binding.id)}`);
    }
  }
  for (const keyName of ['Escape', 'f', 'w', 'a', 's', 'd', 'q', 'e', '1']) {
    assert.equal(key({ key: keyName }).defaultPrevented, false, keyName);
  }
});

test('reinstall/destroy remove complete listeners, observers and queued repaint work', () => {
  document.body.innerHTML = '<aside class="mac-sidebar"><button class="mac-sidebar-panel-item" data-panel-key="system-diagnostic"></button></aside>';
  const globe = count('cb:toggle-gods-vision');
  const palette = count('cb:toggle-cmdk');
  const first = installShortcuts();
  const oldObservers = [...observers]; oldObservers[0]!.callback();
  assert.equal(frames.size, 1);
  handles = installShortcuts();
  assert.ok(oldObservers.every((observer) => !observer.connected));
  flushFrames();
  assert.ok(oldObservers.every((observer) => !observer.connected), 'old callbacks never re-observe');
  first.destroy(); button(); key({ key: 'g' }); key({ key: 'k', metaKey: true });
  assert.deepEqual([globe(), palette()], [1, 1]);
  observers.at(-1)!.callback();
  handles.destroy(); flushFrames();
  key({ key: 'g' }); key({ key: 'k', metaKey: true });
  assert.deepEqual([globe(), palette()], [1, 1]);
  assert.ok(observers.every((observer) => !observer.connected));
  assert.equal(getActiveRegistry(), null);
});

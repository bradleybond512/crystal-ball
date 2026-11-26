import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { JulianDate } from 'cesium';
import { GlobeTimeMachine } from '../GlobeTimeMachine.ts';
import { TimeScrubberHud } from '../TimeScrubberHud.ts';
import { GlobeTimelineSync } from '../gods-vision/GlobeTimelineSync.ts';
import { addTimelineEvent, pruneOlderThan } from '../../services/timeline-scrubber.ts';

const NOW = Date.UTC(2026, 10, 25, 12);
const DAY = 86_400_000;
const dom = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom, document: dom.document, HTMLElement: dom.HTMLElement,
  Element: dom.Element, Node: dom.Node, CustomEvent: dom.CustomEvent,
});

function harness(t: TestContext) {
  dom.document.body.replaceChildren();
  let elapsed = 0;
  let wall = NOW;
  let sequence = 0;
  let visibility = 'visible';
  const pending = new Map<number, { at: number; callback: () => void; repeat: number; kind: string }>();
  const schedule = (callback: () => void, delay = 0, repeat = 0, kind = 'timeout') => {
    const id = ++sequence;
    pending.set(id, { at: elapsed + delay, callback, repeat, kind });
    return id;
  };
  const timeout = (callback: () => void, delay = 0) => schedule(callback, delay);
  const interval = (callback: () => void, delay = 0) => schedule(callback, delay, delay, 'interval');
  const cancel = (id: number) => { pending.delete(Number(id)); };
  t.mock.method(Date, 'now', () => wall + elapsed);
  t.mock.method(performance, 'now', () => elapsed);
  t.mock.method(globalThis, 'setTimeout', timeout);
  t.mock.method(globalThis, 'clearTimeout', cancel);
  t.mock.method(globalThis, 'setInterval', interval);
  t.mock.method(globalThis, 'clearInterval', cancel);
  t.mock.method(dom, 'setTimeout', timeout);
  t.mock.method(dom, 'clearTimeout', cancel);
  t.mock.method(dom, 'setInterval', interval);
  t.mock.method(dom, 'clearInterval', cancel);
  Object.assign(globalThis, {
    requestAnimationFrame: (cb: (ms: number) => void) => schedule(() => cb(elapsed), 16, 0, 'raf'),
    cancelAnimationFrame: cancel,
  });
  Object.defineProperty(dom.document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(dom.document, 'hidden', { configurable: true, get: () => visibility === 'hidden' });
  pruneOlderThan(-1);
  const parent = dom.document.createElement('div');
  dom.document.body.append(parent);
  const filters: Array<number | null> = [];
  const viewer = { clock: { currentTime: JulianDate.fromDate(new Date(NOW)), shouldAnimate: false, multiplier: 1 } };
  const controller = new GlobeTimeMachine(viewer as never, { applyTimeFilter: (ms: number | null) => filters.push(ms) } as never);
  controller.mount();
  t.after(() => controller.destroy());
  return {
    parent, controller, filters, viewer, pending,
    advance(ms: number) {
      const end = elapsed + ms;
      let executions = 0;
      while (true) {
        const next = [...pending].sort((a, b) => a[1].at - b[1].at).find(([, value]) => value.at <= end);
        if (!next) break;
        assert.ok(++executions < 10000, 'scheduler must remain bounded');
        const [id, task] = next;
        elapsed = task.at;
        pending.delete(id);
        if (task.repeat) pending.set(id, { ...task, at: elapsed + task.repeat });
        task.callback();
      }
      elapsed = end;
    },
    wallJump(ms: number) { wall += ms; },
    visible(value: boolean) {
      visibility = value ? 'visible' : 'hidden';
      dom.document.dispatchEvent(new dom.Event('visibilitychange'));
    },
  };
}

function button(parent: ParentNode, text: string) {
  const result = [...parent.querySelectorAll('button')].find(el => el.textContent === text);
  assert.ok(result, `button ${text} exists`);
  return result;
}

function key(target: EventTarget, value = ' ', extras = {}) {
  const event = new dom.KeyboardEvent('keydown', { key: value, code: value === ' ' ? 'Space' : value, bubbles: true, cancelable: true, ...extras });
  target.dispatchEvent(event);
  return event;
}

test('mounted controller publishes immutable state without duplicate controls', t => {
  const h = harness(t);
  const state = h.controller.getState();
  assert.ok(Object.isFrozen(state));
  assert.deepEqual(state, { cursorMs: NOW, anchorMs: NOW, playing: false, speed: 1, mode: 'latest' });
  assert.equal(h.parent.querySelectorAll('input,button').length, 0);
  const changes: unknown[] = [];
  const stop = h.controller.onStateChange(value => changes.push(value));
  h.controller.setSpeed(4);
  assert.equal(changes.length, 1, 'speed change publishes without moving cursor');
  h.controller.play();
  assert.equal(h.controller.isPlaying(), true);
  h.controller.pause();
  assert.equal((changes.at(-1) as { playing: boolean }).playing, false);
  assert.deepEqual(state, { cursorMs: NOW, anchorMs: NOW, playing: false, speed: 1, mode: 'latest' });
  stop();
  const count = changes.length;
  h.controller.setSpeed(16);
  assert.equal(changes.length, count);
});

test('finite seeks clamp to the fixed anchor and non-finite input preserves state', t => {
  const h = harness(t);
  h.wallJump(DAY * 10);
  h.controller.setTime(NOW - DAY * 2);
  assert.equal(h.controller.getCurrentMs(), NOW - DAY);
  assert.equal(h.filters.at(-1), NOW - DAY, 'explicit seek filters promptly');
  h.controller.setTime(NOW + DAY);
  assert.equal(h.controller.getCurrentMs(), NOW);
  assert.equal(h.controller.getState().anchorMs, NOW);
  for (const value of [NaN, Infinity, -Infinity]) {
    const before = h.controller.getState();
    const calls = h.filters.length;
    h.controller.setTime(value);
    assert.deepEqual(h.controller.getState(), before);
    assert.equal(h.filters.length, calls);
  }
  for (const value of [0, -1, 2, NaN, Infinity]) h.controller.setSpeed(value);
  assert.equal(h.controller.getSpeed(), 1);
  for (const value of [4, 16, 64, 1]) {
    h.controller.setSpeed(value);
    assert.equal(h.controller.getSpeed(), value);
  }
});

test('continuous playback delivers filters and cursor events at five commits per second', t => {
  const h = harness(t);
  h.controller.setTime(NOW - 10_000);
  const times: number[] = [];
  h.controller.onTimeChange(ms => times.push(ms));
  h.controller.play();
  h.filters.length = 0;
  times.length = 0;
  h.advance(199);
  assert.equal(times.length, 0);
  h.advance(801);
  assert.equal(times.length, 5);
  assert.equal(h.filters.length, 5, 'filters must not starve behind resetting debounce');
  assert.deepEqual(h.filters, times);
  assert.deepEqual(times, [200, 400, 600, 800, 1000].map(ms => NOW - 10_000 + ms));
  assert.equal(h.controller.isPlaying(), true, 'internal commits must not invoke pausing seek');
  assert.equal(h.viewer.clock.shouldAnimate, false, 'Cesium cannot advance a second clock');
  assert.equal(JulianDate.toDate(h.viewer.clock.currentTime).getTime(), times.at(-1));
  assert.equal(h.pending.size, 1);
});

test('seek pauses, endpoint playback restarts, and upper endpoint stops without drift', t => {
  const h = harness(t);
  h.controller.play();
  assert.equal(h.controller.getCurrentMs(), NOW - DAY);
  h.advance(200);
  h.controller.setTime(NOW - 100);
  assert.equal(h.controller.isPlaying(), false);
  assert.equal(h.pending.size, 0);
  assert.equal(h.filters.at(-1), NOW - 100);
  h.controller.play();
  h.advance(200);
  assert.equal(h.controller.getCurrentMs(), NOW);
  assert.equal(h.controller.isPlaying(), false);
  assert.equal(h.pending.size, 0);
  h.advance(10000);
  assert.equal(h.controller.getCurrentMs(), NOW);
});

test('Latest moves the anchor, pauses, and resets the manager immediately', t => {
  const h = harness(t);
  h.controller.play();
  h.advance(200);
  h.wallJump(3600000);
  h.controller.snapToNow();
  assert.deepEqual(h.controller.getState(), { cursorMs: NOW + 3600200, anchorMs: NOW + 3600200, playing: false, speed: 1, mode: 'latest' });
  assert.equal(h.filters.at(-1), null);
  assert.equal(h.pending.size, 0);
  assert.ok(JulianDate.equals(h.viewer.clock.currentTime, JulianDate.fromDate(new Date(NOW + 3600200))));
});

test('hidden playback cancels work and requires explicit Play without hidden catch-up', t => {
  const h = harness(t);
  h.controller.setTime(NOW - 10000);
  h.controller.play();
  h.advance(200);
  h.visible(false);
  assert.equal(h.controller.isPlaying(), false);
  assert.equal(h.pending.size, 0);
  const stopped = h.controller.getCurrentMs();
  h.advance(600000);
  h.controller.play();
  assert.equal(h.pending.size, 0, 'Play while hidden remains inert');
  h.visible(true);
  h.advance(1000);
  assert.equal(h.controller.getCurrentMs(), stopped);
  h.controller.play();
  h.advance(200);
  assert.equal(h.controller.getCurrentMs(), stopped + 200);
});

test('destroy removes listeners and makes cancelled callbacks and old controls inert', t => {
  const h = harness(t);
  const hud = new TimeScrubberHud(h.parent as never, h.controller);
  const play = button(h.parent as never, 'Play');
  play.click();
  const late = [...h.pending.values()].map(task => task.callback);
  hud.destroy();
  h.controller.destroy();
  const before = h.controller.getState();
  const filterCount = h.filters.length;
  let notifications = 0;
  const stop = h.controller.onStateChange(() => notifications++);
  for (const cb of late) cb();
  play.click();
  h.visible(false);
  h.controller.setTime(NOW - 5000);
  h.controller.snapToNow();
  assert.deepEqual(h.controller.getState(), before);
  assert.equal(h.filters.length, filterCount);
  assert.equal(notifications, 0);
  assert.equal(h.pending.size, 0);
  stop();
});

test('old callbacks cannot advance or duplicate playback after remount', t => {
  const h = harness(t);
  h.controller.play();
  const late = [...h.pending.values()][0].callback;
  h.controller.destroy();
  h.wallJump(1000);
  h.controller.mount();
  h.controller.mount();
  assert.equal(h.controller.getState().anchorMs, NOW + 1000);
  h.controller.setTime(NOW - 10000);
  h.controller.play();
  const cursor = h.controller.getCurrentMs();
  const calls = h.filters.length;
  late();
  assert.equal(h.controller.getCurrentMs(), cursor);
  assert.equal(h.filters.length, calls);
  assert.equal(h.pending.size, 1);
  h.advance(200);
  assert.equal(h.controller.getCurrentMs(), cursor + 200);
  h.visible(false);
  assert.equal(h.pending.size, 0);
});

test('HUD destruction unsubscribes and removes handlers while the controller remains usable', t => {
  const h = harness(t);
  const hud = new TimeScrubberHud(h.parent as never, h.controller);
  const play = button(h.parent as never, 'Play');
  const slider = h.parent.querySelector('input')!;
  const before = slider.value;
  hud.destroy();
  h.controller.setTime(NOW - 5000);
  assert.equal(slider.value, before, 'detached HUD stops observing state');
  play.click();
  assert.equal(h.controller.isPlaying(), false, 'detached button cannot operate live controller');
  slider.value = String(NOW - DAY);
  slider.dispatchEvent(new dom.Event('input'));
  assert.equal(h.controller.getCurrentMs(), NOW - 5000);
  const replacement = new TimeScrubberHud(h.parent as never, h.controller);
  t.after(() => replacement.destroy());
  button(h.parent as never, 'Play').click();
  assert.equal(h.controller.isPlaying(), true);
  assert.equal(h.pending.size, 1);
});

test('a consumer can pause on cursor delivery without leaving a scheduled playback task', t => {
  const h = harness(t);
  h.controller.setTime(NOW - 10000);
  const stop = h.controller.onTimeChange(() => h.controller.pause());
  h.controller.play();
  h.advance(200);
  assert.equal(h.controller.getCurrentMs(), NOW - 9800);
  assert.equal(h.controller.isPlaying(), false);
  assert.equal(h.pending.size, 0);
  stop();
  h.controller.play();
  h.advance(400);
  assert.equal(h.controller.isPlaying(), true);
  assert.equal(h.controller.getCurrentMs(), NOW - 9400);
});

test('HUD delegates controls, preserves focused slider identity, and describes current-record limits', t => {
  const h = harness(t);
  const hud = new TimeScrubberHud(h.parent as never, h.controller);
  t.after(() => hud.destroy());
  const slider = h.parent.querySelector('input[type=range]')!;
  assert.ok(slider);
  assert.equal(h.parent.querySelectorAll('input[type=range]').length, 1);
  assert.match(h.parent.textContent, /Current records/);
  assert.match(h.parent.textContent, /Filters timestamps in currently loaded data\. Positions are not historical\./);
  assert.doesNotMatch(h.parent.textContent, /\b(LIVE|Replay|Projected|Forecast)\b/i);
  assert.equal(Number(slider.max), NOW);
  assert.equal(Number(slider.min), NOW - DAY);
  slider.focus();
  slider.value = String(NOW - DAY / 2);
  slider.dispatchEvent(new dom.Event('input', { bubbles: true }));
  assert.equal(h.controller.getCurrentMs(), NOW - DAY / 2);
  assert.match(h.parent.textContent, /Selected time/);
  h.controller.setSpeed(4);
  h.controller.play();
  h.advance(200);
  assert.equal(hud.cursorMs, NOW - DAY / 2 + 800);
  assert.equal(h.parent.querySelector('input[type=range]'), slider);
  assert.equal(dom.document.activeElement, slider);
  assert.equal(Number(slider.value), hud.cursorMs);
  assert.equal(button(h.parent as never, 'Pause').getAttribute('aria-pressed'), 'true');
  const speed = h.parent.querySelector('select')!;
  speed.value = '16';
  speed.dispatchEvent(new dom.Event('change', { bubbles: true }));
  assert.equal(h.controller.getSpeed(), 16);
  button(h.parent as never, 'Latest').click();
  assert.equal(h.controller.isLive(), true);
  assert.equal(h.controller.isPlaying(), false);
  assert.equal(h.pending.size, 0, 'HUD owns no playback scheduler');
  assert.match(h.parent.textContent, /2026/);
});

test('timeline bridge uses selected cursor, retains event schema, and reports retained counts', t => {
  const h = harness(t);
  const selected = NOW - 10000;
  addTimelineEvent('fire', 0, 0, selected - 100, 'retained fire', 'high', 'fixture');
  addTimelineEvent('weather', 1, 1, selected + 300, 'future storm', 'medium', 'fixture');
  addTimelineEvent('fire', 2, 2, selected - 6 * 3600000 - 1, 'old fire', 'low', 'fixture');
  h.controller.setTime(selected);
  const events: any[] = [];
  const onCursor = (event: Event) => events.push((event as CustomEvent).detail);
  dom.document.addEventListener('wm:globe-timeline-cursor', onCursor);
  const sync = new GlobeTimelineSync(h.controller, h.parent as never);
  sync.mount();
  t.after(() => { sync.destroy(); dom.document.removeEventListener('wm:globe-timeline-cursor', onCursor); });
  assert.equal(events[0].cursorMs, selected, 'mount must use selected cursor, not wall time');
  assert.deepEqual(Object.keys(events[0]).sort(), ['countsByType', 'cursorMs', 'visible']);
  assert.deepEqual(events[0].visible.map((entry: any) => entry.event.title), ['retained fire']);
  assert.equal(events[0].countsByType.fire, 1);
  assert.match(h.parent.textContent, /1 retained timeline event/);
  h.controller.play();
  events.length = 0;
  h.advance(400);
  assert.equal(events.length, 2);
  assert.equal(events.at(-1).countsByType.weather, 1);
  assert.match(h.parent.textContent, /2 retained timeline events/);
  h.controller.setTime(NOW - DAY);
  assert.match(h.parent.textContent, /0 retained timeline events/);
  sync.destroy();
  const calls = events.length;
  h.controller.setTime(selected);
  assert.equal(events.length, calls);
  sync.mount();
  events.length = 0;
  h.controller.setTime(selected + 1000);
  assert.equal(events.length, 1, 'remount must have one subscription');
});

// Bundle the real host while replacing only unrelated WebGL, provider and overlay
// dependencies. Controller, HUD, bridge and event-store modules remain real.
async function loadHost() {
  const hostPath = path.resolve('src/components/GodsVisionView.ts');
  const source = readFileSync(hostPath, 'utf8');
  const names = new Map<string, string[]>();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    names.set(match[2], match[1].split(',').map(value => value.trim()).filter(value => value && !value.startsWith('type ')).map(value => value.split(/\s+as\s+/)[0]));
  }
  const real = new Set(['@/components/GlobeTimeMachine', '@/components/TimeScrubberHud', '@/components/gods-vision/GlobeTimelineSync']);
  const result = await build({
    entryPoints: [hostPath], bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'ux016-peripheral-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.importer !== hostPath) return;
        if (real.has(args.path)) return { path: pathToFileURL(path.resolve('src', args.path.slice(2) + '.ts')).href, external: true };
        return { path: args.path, namespace: 'ux016-peripheral' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'ux016-peripheral' }, args => ({ contents: (names.get(args.path) ?? []).map(name => {
        if (name === 'CesiumGlobe') return `export class CesiumGlobe { constructor(){this.cesiumViewer=globalThis.__ux016Host.viewer;this.canvas=this.cesiumViewer?.canvas;} async initialize(){} destroy(){} }`;
        if (name === 'GlobeDataManager') return `export class GlobeDataManager { initialize(){} destroy(){} applyTimeFilter(ms){globalThis.__ux016Host.filters.push(ms);} }`;
        if (name === 'Globe4DManager') return `export class Globe4DManager {constructor(opts){globalThis.__ux016Host.consumer=opts.timeMachine;}onChange(){}destroy(){}hasActiveTier2(){return false;}isActive(){return false;} }`;
        if (name === 'getMode') return 'export const getMode=()=>null;';
        if (name === 'ScreenSpaceEventType') return 'export const ScreenSpaceEventType={LEFT_CLICK:1,MOUSE_MOVE:2};';
        return `export class ${name} { constructor(){return new Proxy(this,{get:(target,key)=>key==='isActive'?false:key==='then'?undefined:()=>undefined});} }`;
      }).join('\n'), loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { GodsVisionView } = await loadHost();

function hostFixture(h: ReturnType<typeof harness>, viewer = true) {
  const state = { viewer: viewer ? { ...h.viewer, canvas: dom.document.createElement('canvas') } : null, filters: [] as Array<number | null>, consumer: null as GlobeTimeMachine | null };
  Object.assign(globalThis, { __ux016Host: state });
  return state;
}

test('real GodsVision mount shares HUD, keyboard and existing consumer state across re-entry', async t => {
  const h = harness(t);
  h.controller.destroy();
  const state = hostFixture(h);
  const view = new GodsVisionView();
  t.after(() => view.destroy());
  await view.enter();
  const parent = dom.document.querySelector('.gods-vision-container')!;
  assert.equal(parent.querySelectorAll('.time-scrubber-hud').length, 1);
  assert.equal(parent.querySelectorAll('input[type=range]').length, 1);
  assert.equal(parent.querySelectorAll('.godsvision-time-machine').length, 0);
  const controller = state.consumer!;
  assert.ok(controller instanceof GlobeTimeMachine, 'existing 4D consumer receives real controller');
  button(parent as never, 'Play').click();
  assert.equal(controller.isPlaying(), true);
  assert.equal([...h.pending.values()].filter(task => task.kind !== 'interval').length, 1);
  h.advance(200);
  assert.equal(state.filters.at(-1), controller.getCurrentMs());
  key(dom.document.body);
  assert.equal(controller.isPlaying(), false);
  assert.ok(button(parent as never, 'Play'));
  view.exit();
  assert.equal(h.pending.size, 0);
  assert.equal(parent.querySelectorAll('.time-scrubber-hud').length, 0);
  await view.enter();
  assert.equal(parent.querySelectorAll('.time-scrubber-hud').length, 1);
  key(dom.document.body);
  assert.equal(state.consumer!.isPlaying(), true, 'one Space listener survives re-entry');
  assert.equal(controller.isPlaying(), false, 'old controller stays stopped');
});

test('host Space preserves interactive keys, repeat/modifiers, fly-mode and Escape precedence', async t => {
  const h = harness(t);
  h.controller.destroy();
  const state = hostFixture(h);
  const view = new GodsVisionView();
  t.after(() => view.destroy());
  await view.enter();
  const controller = state.consumer!;
  for (const html of ['<button><span>x</span></button>', '<input type="range">', '<select><option>x</option></select>', '<textarea></textarea>', '<a href="#">x</a>', '<div contenteditable="true"><span>x</span></div>', '<div role="button"><span>x</span></div>']) {
    const parent = dom.document.createElement('div');
    parent.innerHTML = html;
    dom.document.body.append(parent);
    const event = key(parent.querySelector('span') ?? parent.firstElementChild!);
    assert.equal(controller.isPlaying(), false, html);
    assert.equal(event.defaultPrevented, false, html);
    parent.remove();
  }
  for (const extras of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    key(dom.document.body, ' ', extras);
    assert.equal(controller.isPlaying(), false);
  }
  let flyExits = 0;
  view.flyMode = { isActive: true, exit: () => flyExits++, destroy() {} };
  key(dom.document.body);
  assert.equal(controller.isPlaying(), false);
  key(dom.document.body, 'Escape');
  assert.equal(flyExits, 1);
  assert.equal(view.isActive, true);
  view.flyMode = null;
  let tierClears = 0;
  view.fourD = { hasActiveTier2: () => true, clearTier2: () => tierClears++, destroy() {} };
  key(dom.document.body, 'Escape');
  assert.equal(tierClears, 1);
  assert.equal(view.isActive, true);
  view.fourD = null;
  key(dom.document.body, 'Escape');
  assert.equal(view.isActive, false);
});

test('host without a viewer mounts no disconnected timeline control', async t => {
  const h = harness(t);
  h.controller.destroy();
  const state = hostFixture(h, false);
  const view = new GodsVisionView();
  t.after(() => view.destroy());
  await view.enter();
  assert.equal(dom.document.querySelector('.time-scrubber-hud'), null);
  assert.equal(state.consumer, null);
  key(dom.document.body);
  assert.equal([...h.pending.values()].filter(task => task.kind !== 'interval').length, 0);
});

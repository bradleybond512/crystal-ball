import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';
import type { TheaterPostureSummary } from '../../services/military-surge.ts';

const browser = new Window({ url: 'http://localhost/' });
const doc = browser.document;
Object.assign(globalThis, { window: browser, document: doc, localStorage: browser.localStorage,
  sessionStorage: browser.sessionStorage, CustomEvent: browser.CustomEvent });
const { CriticalPostureBanner } = await import('../CriticalPostureBanner.ts');
const { setMode } = await import('../../services/mode-manager.ts');

function posture(patch: Partial<TheaterPostureSummary> = {}): TheaterPostureSummary {
  return { theaterId: 'western', theaterName: 'Western Pacific', postureLevel: 'elevated', strikeCapable: true,
    totalAircraft: 8, summary: 'Eight aircraft', headline: 'Elevated activity', centerLat: 12, centerLon: 130,
    ...patch } as TheaterPostureSummary;
}

const views: number[][] = [];
const actions: string[][] = [];
let mounted: InstanceType<typeof CriticalPostureBanner>;
function mount() {
  views.length = actions.length = 0;
  const stack = doc.createElement('div');
  doc.body.append(stack);
  mounted = new CriticalPostureBanner(stack as unknown as HTMLElement,
    (lat, lon) => views.push([lat, lon]), (action, id) => actions.push([action, id]));
  return stack;
}

function visibility(hidden: boolean): void {
  Object.defineProperty(doc, 'hidden', { configurable: true, value: hidden });
  doc.dispatchEvent(new browser.Event('visibilitychange'));
}

afterEach(() => {
  mounted?.destroy();
  setMode(null);
  visibility(false);
  browser.localStorage.clear();
  browser.sessionStorage.clear();
  doc.body.replaceChildren();
});

test('posture status exists empty before a warning, has polite atomic semantics and contains no controls', () => {
  const stack = mount();
  const status = stack.querySelector('[data-posture-announcer]');
  assert.ok(status, 'status mounted before the first posture report');
  assert.equal(status.textContent, '');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.getAttribute('aria-atomic'), 'true');
  const filter = doc.createElement('button');
  doc.body.append(filter);
  filter.focus();
  mounted.render([posture()], false);
  assert.equal(doc.activeElement, filter);
  assert.equal(stack.querySelector('[data-posture-announcer]'), status);
  assert.ok(!status.querySelector('button'), 'unexpected element in posture surface');
  assert.match(status.textContent!, /Elevated posture.*Western Pacific.*strike capable/i);
});

test('only meaningful posture transitions mutate the status; returning from an empty state announces onset', () => {
  const stack = mount();
  const status = stack.querySelector('[data-posture-announcer]');
  assert.ok(status);
  const observer = new browser.MutationObserver(() => {});
  observer.observe(status, { subtree: true, childList: true, characterData: true });
  mounted.render([posture()], false);
  assert.ok(observer.takeRecords().length);
  mounted.render([posture({ headline: 'Revised details', theaterName: 'Western Pacific region', summary: 'Test', totalAircraft: 9 })], false);
  assert.equal(observer.takeRecords().length, 0, 'stats-only poll must not announce');
  assert.match(stack.querySelector('.banner-stats')!.textContent!, /9 aircraft/);
  mounted.render([posture({ postureLevel: 'critical' })], false);
  assert.match(status.textContent!, /Critical posture/);
  observer.takeRecords();
  mounted.render([posture({ postureLevel: 'critical', strikeCapable: false })], false);
  assert.ok(observer.takeRecords().length, 'the strike capability transition must announce');
  assert.doesNotMatch(status.textContent!, /Strike capable/i);
  mounted.render([posture({ theaterId: 'other', theaterName: '<i>Other</i>', postureLevel: 'critical', strikeCapable: false })], false);
  assert.match(status.textContent!, /<i>Other<\/i>/);
  assert.ok(!status.querySelector('i'), 'unexpected element in posture surface');
  observer.takeRecords();
  mounted.render([posture({ theaterId: 'another', theaterName: '<i>Other</i>', postureLevel: 'critical', strikeCapable: false })], false);
  assert.ok(observer.takeRecords().length, 'a distinct selected theater must announce even if its short label matches');
  mounted.render([], false);
  assert.equal(status.textContent, '', 'no unverified all-clear announcement');
  assert.ok(!stack.querySelector('.critical-posture-banner'), 'unexpected element in posture surface');
  mounted.render([posture()], false);
  assert.match(status.textContent!, /Western Pacific/);
  mounted.render([], false);
  mounted.render([posture()], false);
  assert.match(status.textContent!, /Western Pacific/, 'same material posture can start again after disappearance');
  observer.disconnect();
});

test('refresh keeps both action nodes and activates the current selected theater and coordinates', () => {
  const stack = mount();
  mounted.render([posture()], false);
  const view = stack.querySelector<HTMLButtonElement>('.banner-view')!;
  const dismiss = stack.querySelector<HTMLButtonElement>('.banner-dismiss')!;
  view.focus();
  mounted.render([posture({ theaterId: 'equator', centerLat: 0, centerLon: 0, headline: '<img src=x>' })], false);
  assert.ok(doc.activeElement === view, 'View Region focus survived refresh');
  assert.ok(stack.querySelector('.banner-dismiss') === dismiss, 'dismiss node identity survived');
  assert.equal(dismiss.getAttribute('aria-label'), 'Dismiss posture banner');
  assert.ok(!stack.querySelector('img'), 'unexpected element in posture surface');
  view.click();
  assert.deepEqual(views, [[0, 0]]);
  assert.deepEqual(actions, [['view','equator']]);
  dismiss.focus();
  mounted.render([posture({ theaterId: 'equator', totalAircraft: 19 })], false);
  assert.ok(doc.activeElement === dismiss, 'Dismiss focus survived refresh');
  dismiss.click();
  assert.deepEqual(actions[1], ['dismiss','equator']);
  assert.ok(browser.sessionStorage.getItem('banner-dismissed'));
  assert.equal(stack.querySelector('[data-posture-announcer]')?.textContent, '');
});

for (const gate of ['hidden', 'ghost', 'mobile', 'dismissed'] as const) {
  test(gate + ' posture suppression does not replay on return', () => {
    const stack = mount();
    const status = stack.querySelector('[data-posture-announcer]');
    assert.ok(status);
    mounted.render([posture()], false);
    if (gate === 'hidden') visibility(true);
    if (gate === 'ghost') setMode('ghost');
    if (gate === 'dismissed') stack.querySelector<HTMLButtonElement>('.banner-dismiss')!.click();
    const update = posture({ postureLevel: 'critical' });
    mounted.render([update], gate === 'mobile');
    assert.equal(status.textContent, '');
    if (gate === 'mobile' || gate === 'dismissed') assert.ok(!stack.querySelector('.critical-posture-banner'), 'unexpected element in posture surface');
    if (gate === 'hidden') visibility(false);
    if (gate === 'ghost') setMode(null);
    if (gate === 'dismissed') browser.sessionStorage.setItem('banner-dismissed', String(Date.now() - 31 * 60_000));
    mounted.render([update], false);
    assert.equal(status.textContent, '', 'no replay when suppression ends');
    mounted.render([posture()], false);
    assert.match(status.textContent!, /Elevated posture/);
  });
}

test('a visibility round-trip between polls clears the old speech and seeds the next update silently', () => {
  const stack = mount();
  const status = stack.querySelector('[data-posture-announcer]')!;
  mounted.render([posture()], false);
  visibility(true);
  assert.equal(status.textContent, '', 'clear immediately when hidden');
  visibility(false);
  mounted.render([posture({ postureLevel: 'critical' })], false);
  assert.equal(status.textContent, '', 'do not replay changes which may have occurred while hidden');
  mounted.render([posture()], false);
  assert.match(status.textContent!, /Elevated posture/);
});

test('dismissal lasts for this window when session storage is unavailable', () => {
  const stack = mount();
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')!;
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() { throw new Error('storage disabled'); },
  });
  try {
    mounted.render([posture()], false);
    stack.querySelector<HTMLButtonElement>('.banner-dismiss')!.click();
    mounted.render([posture({ postureLevel: 'critical' })], false);
    assert.ok(!stack.querySelector('.critical-posture-banner'), 'local dismissal survives another poll');
    assert.equal(stack.querySelector('[data-posture-announcer]')?.textContent, '');
  } finally {
    Object.defineProperty(globalThis, 'sessionStorage', saved);
  }
});

test('destroy removes the status and controls, and late reports do not remount them', t => {
  const released = t.mock.method(doc, 'removeEventListener');
  const stack = mount();
  mounted.render([posture()], false);
  mounted.destroy();
  assert.ok(released.mock.calls.some(call => call.arguments[0] === 'visibilitychange'), 'release the suppression listener');
  mounted.render([posture()], false);
  assert.equal(stack.childElementCount, 0);
  assert.equal(doc.body.classList.contains('has-critical-banner'), false);
});

test('panel layout mounts the status into the live stack, forwards current mobile state and map target, and tears it down', () => {
  const file = readFileSync(new URL('../../app/panel-layout.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('panel-layout.ts', file, ts.ScriptTarget.Latest, true);
  const layout = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PanelLayoutManager') as ts.ClassDeclaration;
  const methods = ['mountAlertShelf', 'renderCriticalBanner', 'destroyNavigationShortcuts', 'destroy'].map(name =>
    layout.members.find(node => node.name?.getText(source) === name)!.getText(source));
  const compiled = ts.transpileModule('class Layout {' + methods.join('\n') + '}', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const element = doc.createElement('div');
  const stack = { element, mount: () => doc.body.append(element) };
  class MountedBanner extends CriticalPostureBanner {
    constructor(...args: ConstructorParameters<typeof CriticalPostureBanner>) {
      assert.ok(element.isConnected, 'the empty status is primed in a mounted stack');
      super(...args);
    }
  }
  class InertRow { mount() {} destroy() {} }
  const centers: number[][] = [];
  const create = new Function('notificationStack', 'CriticalPostureBanner', 'trackCriticalBannerAction', 'TriageBar',
    'PersonalStormMode', 'destroyUniquePanels', compiled + ';return new Layout()');
  const owner = create(stack, MountedBanner, () => {}, InertRow, InertRow, () => {});
  const ctx = { isMobile: false, panels: {}, newsPanels: {}, map: { setCenter: (...point: number[]) => centers.push(point), destroy() {} } };
  Object.assign(owner, { ctx, panelDragCleanupHandlers: [], lazyFactories: new Map() });
  owner.mountAlertShelf();
  assert.ok(element.querySelector('[data-posture-announcer]'), 'production mount creates the empty status');
  owner.renderCriticalBanner([posture()]);
  element.querySelector<HTMLButtonElement>('.banner-view')?.click();
  assert.deepEqual(centers, [[12, 130, 4]], 'current target reaches map at the existing zoom');
  ctx.isMobile = true;
  owner.renderCriticalBanner([posture()]);
  assert.equal(element.querySelector('.critical-posture-banner') === null, true, 'live mobile state is forwarded');
  owner.destroy();
  assert.equal(element.querySelector('[data-posture-announcer]') === null, true, 'layout releases live status');
});

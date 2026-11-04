import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import ts from 'typescript';
import { Window } from 'happy-dom';

function compile(path: string) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const code = compile('../SummaryStrip.ts');
const suppressionCode = compile('../../utils/critical-ui-announcements.ts');
type Alert = { severity: string; acknowledged?: boolean };

function setup(t: TestContext, initial: Alert[] = [], attach = true) {
  const win = new Window({ url: 'https://crystalball.test/' });
  const doc = win.document;
  Object.assign(globalThis, { window: win, document: doc, localStorage: win.localStorage, CustomEvent: win.CustomEvent });
  const state = { alerts: initial, ghost: false, hidden: false, regimes: {}, age: 1 };
  Object.defineProperty(doc, 'hidden', { configurable: true, get: () => state.hidden });
  let poll = () => {};
  let status = (_value: object) => {};
  let stops = 0;
  const calls: string[] = [];
  const suppression: Record<string, unknown> = {};
  new Function('require', 'exports', suppressionCode)((id: string) => {
    assert.equal(id, '@/services/mode-manager');
    return { isGhostMode: () => state.ghost };
  }, suppression);
  const deps = {
    '@/utils/critical-ui-announcements': suppression,
    '@/utils/sanitize': { escapeHtml: (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') },
    './ui/icons': { icon: () => '<svg></svg>' },
    '@/services/unified-alerts': { unifiedAlertStore: { getAll: () => state.alerts, subscribe: (fn: typeof poll) => {
      poll = fn; return () => { stops++; poll = () => {}; };
    } } },
    '@/services/data-freshness': { dataFreshness: { getAllSources: () => [{ enabled: true, lastUpdate: new Date(Date.now() - state.age * 60_000) }] } },
    '@/services/cognition/regime-monitor': { getActiveRegimeShifts: () => state.regimes, REGIME_SHIFT_EVENT: 'regime' },
    '@/utils/format-duration': { formatDurationMinutes: (age: number) => String(Math.floor(age)) },
    '@/services/mode-manager': { isGhostMode: () => state.ghost },
  };
  const api: Record<string, any> = {};
  new Function('require', 'exports', code)((id: keyof typeof deps) => { assert.ok(id in deps, id); return deps[id]; }, api);
  const strip = new api.SummaryStrip({
    subscribeStatus: (fn: typeof status) => { status = fn; return () => { stops++; status = () => {}; }; },
    onStatusClick: () => calls.push('status'), onAlertsClick: () => calls.push('alerts'),
    onFreshnessClick: () => calls.push('fresh'), onRegimeClick: () => calls.push('regime'),
  });
  const el = strip.getElement() as HTMLElement;
  if (attach) doc.body.appendChild(el as never);
  const quiet = () => doc.dispatchEvent(new win.Event('visibilitychange'));
  const mode = () => doc.dispatchEvent(new win.CustomEvent('wm:mode-changed', { detail: { mode: state.ghost ? 'ghost' : null } }));
  const button = (key: string) => { const b = el.querySelector<HTMLButtonElement>(`[data-seg="${key}"]`); assert.ok(b); return b; };
  t.after(() => { strip.destroy(); return win.happyDOM.abort(); });
  return { win, doc, el, state, strip, calls, button, poll: () => poll(), status: (value: object) => status(value),
    quiet, mode, enable: api.setSummaryStripEnabled, stops: () => stops };
}

test('one pre-mounted, initially empty triage status announces count transitions including zero', t => {
  const h = setup(t, [{ severity: 'critical' }]);
  const live = h.el.querySelector<HTMLElement>('[role="status"]');
  assert.ok(live, 'the live region exists before the first update');
  assert.equal(live.getAttribute('aria-live'), 'polite'); assert.equal(live.getAttribute('aria-atomic'), 'true');
  assert.ok(!live.closest('button'), 'the live region stays outside controls');
  assert.equal(live.textContent, '');
  h.state.alerts = [{ severity: 'critical', acknowledged: true }, { severity: 'high' }, { severity: 'medium' }];
  h.poll();
  assert.equal(live.textContent, 'Unacknowledged alerts: 0 critical, 1 high, 1 medium.');
  h.state.alerts = [{ severity: 'low' }];
  h.poll();
  assert.equal(live.textContent, 'Unacknowledged alerts: 0 critical, 0 high, 0 medium.');
  assert.doesNotMatch(h.button('alerts').textContent ?? '', /no open alerts/i);
  assert.ok(Object.is(h.el.querySelector('[role="status"]'), live));
});

test('an update before the strip is attached seeds the baseline without preloading speech', t => {
  const h = setup(t, [], false);
  const live = h.el.querySelector('[role="status"]'); assert.ok(live);
  h.state.alerts = [{ severity: 'high' }]; h.poll();
  assert.equal(live.textContent, '');
  h.doc.body.appendChild(h.el as never);
  h.poll(); assert.equal(live.textContent, '');
  h.state.alerts.push({ severity: 'high' }); h.poll();
  assert.match(live.textContent ?? '', /2 high/);
});

test('identical polls, non-triage updates and counts beyond the display cap do not announce', t => {
  const h = setup(t);
  const live = h.el.querySelector<HTMLElement>('[role="status"]');
  assert.ok(live);
  h.state.alerts = Array.from({ length: 100 }, () => ({ severity: 'critical' }));
  h.poll();
  assert.match(live.textContent ?? '', /99\+ critical/);
  const observer = new h.win.MutationObserver(() => {});
  observer.observe(live as never, { childList: true, characterData: true, subtree: true });
  h.state.alerts.push({ severity: 'critical' }, { severity: 'info' }, { severity: 'high', acknowledged: true });
  h.state.age = 140; h.state.regimes = { seismic: {} };
  h.status({ color: 'red', label: 'Recent shaking' }); h.poll(); h.poll();
  assert.equal(observer.takeRecords().length, 0, 'same displayed tuple produces zero live region writes');
  observer.disconnect();
});

test('polling preserves actual action nodes, their focus and their activation handlers', t => {
  const h = setup(t); h.state.regimes = { market: {} }; h.poll();
  for (const key of ['status', 'alerts', 'fresh', 'regime']) {
    const before = h.button(key);
    before.focus();
    h.state.alerts.push({ severity: 'high' }); h.state.age++; h.status({ color: 'orange', label: 'Changed' });
    assert.ok(Object.is(h.doc.activeElement, before), key + ' keeps keyboard focus');
    assert.ok(Object.is(h.button(key), before));
    before.click();
  }
  assert.deepEqual(h.calls, ['status', 'alerts', 'fresh', 'regime']);
});

for (const gate of ['hidden', 'ghost', 'collapsed', 'disabled'] as const) {
  test(gate + ' suppresses triage changes and resumes silently before the next real change', t => {
    const h = setup(t);
    const live = h.el.querySelector('[role="status"]'); assert.ok(live);
    h.state.alerts = [{ severity: 'high' }]; h.poll();
    assert.match(live.textContent ?? '', /1 high/);
    function setGate(value: boolean) {
      if (gate === 'hidden') { h.state.hidden = value; h.quiet(); }
      if (gate === 'ghost') { h.state.ghost = value; h.mode(); }
      if (gate === 'collapsed') h.button('chevron').click();
      if (gate === 'disabled') h.enable(!value);
    }
    setGate(true);
    h.state.alerts = [{ severity: 'critical' }]; h.poll();
    assert.equal(live.textContent, '', 'suppressed changes produce no stale speech');
    setGate(false); h.poll();
    assert.equal(live.textContent, '', 'returning to the surface does not replay suppressed updates');
    h.state.alerts = [{ severity: 'medium' }]; h.poll();
    assert.match(live.textContent ?? '', /1 medium/);
  });
}

test('peer Ghost and storage denial suppress updates; unrelated storage leaves the baseline alone', t => {
  const h = setup(t);
  const live = h.el.querySelector('[role="status"]'); assert.ok(live);
  const notifyStorage = (key: string | null) => h.win.dispatchEvent(new h.win.StorageEvent('storage', { key }));
  h.state.alerts = [{ severity: 'high' }]; h.poll();
  assert.match(live.textContent ?? '', /1 high/);
  h.win.localStorage.setItem('wm-app-mode', 'ghost');
  notifyStorage('wm-app-mode');
  assert.equal(live.textContent, '', 'peer mode change clears pending speech');
  h.state.alerts = [{ severity: 'critical' }]; h.poll();
  assert.equal(live.textContent, '', 'persisted peer Ghost setting suppresses triage changes');
  h.win.localStorage.removeItem('wm-app-mode'); notifyStorage(null);
  assert.equal(live.textContent, '', 'clearing peer mode seeds silently');
  h.state.alerts.push({ severity: 'medium' }); h.poll();
  const message = live.textContent; assert.match(message ?? '', /1 medium/);
  notifyStorage('irrelevant');
  assert.equal(live.textContent, message, 'unrelated storage cannot reset the live status');
  const read = h.win.localStorage.getItem.bind(h.win.localStorage);
  t.mock.method(h.win.localStorage, 'getItem', (key: string) => {
    if (key === 'wm-app-mode') throw new Error('storage denied');
    return read(key);
  });
  h.state.alerts.push({ severity: 'medium' }); h.poll();
  assert.equal(live.textContent, '', 'unreadable mode cannot authorize speech');
});

test('peer strip settings update visibility immediately and never replay hidden counts', t => {
  const h = setup(t);
  const live = h.el.querySelector('[role="status"]'); assert.ok(live);
  const enabled = 'crystalball-summary-strip-enabled', collapse = 'crystalball-summary-strip-collapsed';
  const set = (key: string, value: string) => {
    h.win.localStorage.setItem(key, value);
    h.win.dispatchEvent(new h.win.StorageEvent('storage', { key }));
  };
  h.state.alerts = [{ severity: 'critical' }]; h.poll();
  set(enabled, '0'); assert.equal(h.el.style.display, 'none'); assert.equal(live.textContent, '');
  h.state.alerts.push({ severity: 'critical' }); h.poll();
  set(enabled, '1'); assert.equal(h.el.style.display, ''); assert.equal(live.textContent, '');
  set(collapse, '1'); assert.equal(h.button('chevron').getAttribute('aria-expanded'), 'false');
  h.state.alerts.push({ severity: 'medium' }); h.poll();
  set(collapse, '0'); assert.equal(live.textContent, '');
  h.state.alerts = []; h.poll(); assert.match(live.textContent ?? '', /0 critical/);
});

test('a disappearing focused regime moves to freshness; outside focus stays put', t => {
  const h = setup(t); h.state.regimes = { market: {} }; h.poll();
  const regime = h.button('regime');
  regime.focus();
  const matches = regime.matches.bind(regime);
  t.mock.method(regime, 'matches', (selector: string) => selector === ':focus' ? false : matches(selector));
  assert.ok(Object.is(h.doc.activeElement, regime), 'a background WKWebView retains DOM focus');
  h.state.regimes = {}; h.poll();
  assert.ok(Object.is(h.doc.activeElement, h.button('fresh')), 'freshness is the preceding visible action');
  assert.equal(h.button('regime').style.display, 'none');
  const outside = h.doc.createElement('button'); h.doc.body.append(outside); outside.focus();
  h.state.regimes = { market: {} }; h.poll(); h.state.regimes = {}; h.poll();
  assert.ok(Object.is(h.doc.activeElement, outside), 'a disappearing unfocused segment cannot pull focus');
});

test('peer collapse moves a disappearing focused action to the chevron only', t => {
  const h = setup(t);
  const collapse = (v: string) => {
    h.win.localStorage.setItem('crystalball-summary-strip-collapsed', v);
    h.win.dispatchEvent(new h.win.StorageEvent('storage', { key: 'crystalball-summary-strip-collapsed' }));
  };
  h.button('alerts').focus(); collapse('1');
  assert.ok(Object.is(h.doc.activeElement, h.button('chevron')), 'collapse leaves a focused, operable expand action');
  collapse('0'); h.button('status').focus(); collapse('1');
  assert.ok(Object.is(h.doc.activeElement, h.button('status')), 'a still-visible status button keeps focus');
  collapse('0'); const outside = h.doc.createElement('button'); h.doc.body.append(outside); outside.focus(); collapse('1');
  assert.ok(Object.is(h.doc.activeElement, outside), 'external focus survives a peer collapse');
});

test('identical renders leave the focused accessible name, description and control contents untouched', t => {
  const h = setup(t, [{ severity: 'high' }]);
  const alerts = h.button('alerts');
  alerts.focus();
  const observer = new h.win.MutationObserver(() => {});
  observer.observe(alerts as never, { attributes: true, childList: true, characterData: true, subtree: true });
  h.poll(); h.status({ color: 'orange', label: 'Different status' }); h.poll();
  assert.equal(observer.takeRecords().length, 0, 'the focused button is not rewritten or renamed on unrelated refreshes');
  assert.ok(Object.is(h.doc.activeElement, alerts));
  observer.disconnect();
});

test('destroy removes listeners and subscriptions', t => {
  const h = setup(t);
  const live = h.el.querySelector('[role="status"]'); assert.ok(live);
  h.state.alerts = [{ severity: 'high' }]; h.poll();
  h.strip.destroy(); assert.equal(h.stops(), 2);
  h.button('alerts').click(); assert.equal(h.calls.length, 0, 'detached controls cannot activate old actions');
  h.state.hidden = true; h.quiet(); h.mode(); h.enable(false);
  assert.match(live.textContent ?? '', /1 high/);
  assert.equal(h.el.isConnected, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { startGridIntelligenceLoader } from '../../src/services/infrastructure/grid-intelligence-loader.ts';
import { GridIntelligencePanel } from '../../src/components/GridIntelligencePanel.ts';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const iso = (time: number) => new Date(time).toISOString();
function envelope(id = 'UK-FIXTURE', customersAffected = 0) {
  return {
    schemaVersion: 1, provider: 'ukpn', scope: 'ukpn-regional', coverage: 'partial', state: 'reported', apiConsistency: 'verified',
    publishedAt: iso(NOW - 60_000), retrievedAt: iso(NOW), expiresAt: iso(NOW + 840_000),
    counts: { raw: 1, accepted: 1, excluded: 0, invalid: 0 }, exclusions: { restored: 0, planned: 0, multiple: 0, unknown: 0 },
    incidents: [{ id, customersAffected, operatingZone: 'London' }], reasonCode: null,
  };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((resolve) => setImmediate(resolve)); };

function environment(t: TestContext) {
  const window = new Window({ url: 'http://127.0.0.1/' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const originalNow = Date.now;
  const cleanup: Array<() => void> = [];
  const timers = new Map<number, { fn: () => void; delay: number; at: number; interval: boolean }>();
  let id = 0; let now = NOW;
  const install = (key: string, value: unknown) => { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  const add = (fn: () => void, delay: number, interval: boolean) => { timers.set(++id, { fn, delay, at: now + delay, interval }); return id; };
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'CustomEvent', 'localStorage', 'navigator']) install(key, key === 'window' ? window : (window as any)[key]);
  install('getComputedStyle', window.getComputedStyle.bind(window));
  install('setTimeout', (fn: () => void, delay = 0) => add(fn, delay, false));
  install('setInterval', (fn: () => void, delay = 0) => add(fn, delay, true));
  install('clearTimeout', (key: number) => timers.delete(key)); install('clearInterval', (key: number) => timers.delete(key));
  install('requestAnimationFrame', (fn: () => void) => add(fn, 16, false)); install('cancelAnimationFrame', (key: number) => timers.delete(key));
  install('fetch', () => { throw new Error('Unexpected fixture network'); });
  Date.now = () => now;
  Object.defineProperty(window, 'fetch', { configurable: true, value: () => { throw new Error('Unexpected fixture window network'); } });
  t.after(async () => {
    try { try { for (const dispose of cleanup) dispose(); }
    finally { timers.clear(); await window.happyDOM.abort(); } }
    finally { Date.now = originalNow; for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
  });
  const fire = (key: number) => {
    const timer = timers.get(key); assert.ok(timer, 'owned timer exists');
    now = Math.max(now, timer.at);
    if (timer.interval) timer.at = now + timer.delay; else timers.delete(key);
    timer.fn();
  };
  const render = async () => {
    for (let turn = 0; turn < 10; turn++) {
      const pending = [...timers].filter(([, timer]) => !timer.interval && timer.delay <= 200);
      if (!pending.length) return;
      for (const [key] of pending) if (timers.has(key)) fire(key);
      await flush();
    }
    assert.fail('bounded panel render drain exceeded');
  };
  return { window, timers, fire, render, cleanup, at: (value: number) => { now = value; } };
}

function runtime(t: TestContext) {
  const f = environment(t);
  const requests: Array<{ signal: AbortSignal | null | undefined; resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/api/ukpn-outages')) return new Promise<Response>((resolve, reject) => requests.push({ signal: init?.signal, resolve, reject }));
    assert.match(path, /\/api\/infrastructure\/(grid|bgp|radiation)$/);
    return Promise.resolve(Response.json({}, { status: 503 }));
  }) as typeof fetch;
  const updates: Array<Record<string, any>> = [];
  const handle = startGridIntelligenceLoader({ update: (patch: Record<string, any>) => updates.push(patch) } as never, { getActivePlaceId: () => null });
  f.cleanup.push(() => handle.stop());
  return { ...f, requests, updates, handle, latest: () => [...updates].reverse().find((patch) => patch.ukpn)?.ukpn };
}

test('UKPN starts independently without US county data and polls every five minutes', async (t) => {
  const f = runtime(t); assert.equal(f.requests.length, 1);
  f.requests[0]!.resolve(Response.json(envelope())); await flush();
  assert.equal(f.latest()?.state, 'reported'); assert.equal(f.latest()?.incidents[0]?.customersAffected, 0);
  assert.deepEqual(f.handle.getOverlayState().outageStates, []);
  for (const [key, timer] of [...f.timers]) if (timer.interval && timer.delay === 300_000) f.fire(key);
  await flush(); assert.equal(f.requests.length, 2);
  f.requests[1]!.resolve(Response.json(envelope())); await flush();
});

test('expiry clears current UK reports at the publication boundary even while refresh is pending', async (t) => {
  const f = runtime(t); f.requests[0]!.resolve(Response.json(envelope())); await flush();
  const expiry = [...f.timers].find(([, timer]) => !timer.interval && timer.delay === 840_000); assert.ok(expiry);
  f.at(NOW + 839_999); assert.equal(f.latest().state, 'reported');
  const pending = f.handle.refresh(); assert.equal(f.requests.length, 2);
  assert.ok(f.timers.has(expiry[0]), 'refresh does not remove the current expiry timer');
  f.fire(expiry[0]);
  assert.equal(f.latest().state, 'stale'); assert.equal(f.latest().incidents.length, 0);
  assert.equal(f.latest().expiresAt, iso(NOW + 840_000));
  f.requests[1]!.resolve(Response.json(envelope())); await pending;
  assert.equal(f.latest().state, 'stale');
});

test('new snapshots replace reports atomically and empty/failure never retain old records', async (t) => {
  const f = runtime(t); f.requests[0]!.resolve(Response.json(envelope('OLD'))); await flush();
  const replace = f.handle.refresh(); f.requests[1]!.resolve(Response.json(envelope('NEW'))); await replace;
  assert.deepEqual(f.latest().incidents.map((row: any) => row.id), ['NEW']);
  const empty = { ...envelope(), state: 'empty', incidents: [], counts: { raw: 0, accepted: 0, excluded: 0, invalid: 0 } };
  const clear = f.handle.refresh(); f.requests[2]!.resolve(Response.json(empty)); await clear;
  assert.equal(f.latest().state, 'empty'); assert.deepEqual(f.latest().incidents, []);
  const fail = f.handle.refresh(); f.requests[3]!.reject(new Error('fixture outage')); await fail;
  assert.equal(f.latest().state, 'unavailable'); assert.deepEqual(f.latest().incidents, []);
});

test('normalized HTTP errors retain bounded reason while old or stopped responses cannot overwrite', async (t) => {
  const f = runtime(t); const older = f.requests[0]!;
  const refresh = f.handle.refresh(); assert.equal(older.signal?.aborted, true);
  const unavailable = { ...envelope(), state: 'unavailable', apiConsistency: 'unverified', publishedAt: null, expiresAt: null, incidents: [], counts: { raw: 0, accepted: 0, excluded: 0, invalid: 0 }, reasonCode: 'rate_limited' };
  f.requests[1]!.resolve(Response.json(unavailable, { status: 503 })); await refresh;
  assert.equal(f.latest().reasonCode, 'rate_limited');
  const count = f.updates.length; older.resolve(Response.json(envelope('OBSOLETE'))); await flush(); assert.equal(f.updates.length, count);
  const staleRefresh = f.handle.refresh();
  f.requests[2]!.resolve(Response.json({ ...unavailable, state: 'stale', reasonCode: 'publication_stale', publishedAt: iso(NOW - 900_000), expiresAt: iso(NOW) }, { status: 503 })); await staleRefresh;
  assert.equal(f.latest().state, 'stale'); assert.equal(f.latest().reasonCode, 'publication_stale');
  const pending = f.handle.refresh(); const last = f.requests[3]!; const beforeStop = f.updates.length;
  f.handle.stop(); assert.equal(last.signal?.aborted, true);
  assert.equal([...f.timers.values()].filter((timer) => timer.interval || timer.delay === 840_000).length, 0);
  last.resolve(Response.json(envelope('LATE'))); await pending; assert.equal(f.updates.length, beforeStop); assert.equal(f.timers.size, 0);
  await f.handle.refresh(); assert.equal(f.requests.length, 4);
});

function panelFixture(t: TestContext) {
  const f = environment(t); f.window.localStorage.setItem('cb:grid-intel-tab', 'outages');
  const panel = new GridIntelligencePanel(); f.window.document.body.append(panel.getElement());
  f.cleanup.push(() => panel.destroy());
  return { ...f, panel, root: panel.getElement(), update: (value: any) => panel.update({ ukpn: value } as any) };
}

test('actual panel keeps UK reports separate, escapes untrusted text and preserves reported zero', async (t) => {
  const f = panelFixture(t);
  f.update({ ...envelope('<img src=x onerror=alert(1)>'), incidents: [{ id: '<img src=x onerror=alert(1)>', customersAffected: 0, operatingZone: '<script>bad</script>' }] }); await f.render();
  const section = f.root.querySelector('.gi-ukpn-outages'); assert.ok(section);
  assert.match(section.textContent ?? '', /UK Power Networks.*regional reports/i);
  assert.match(section.textContent ?? '', /not selected-place coverage/i); assert.match(section.textContent ?? '', /reported.*0|0.*reported/i);
  assert.equal(section.querySelector('img,script'), null); assert.match(section.textContent ?? '', /<img src=x/);
  assert.match(f.root.textContent ?? '', /ODIN/); assert.match(section.textContent ?? '', /partial/i);
  assert.equal((f.panel as any).computeAlertCount(), 0);
  assert.match(section.querySelector('[data-gi-focus="ukpn-source"]')?.getAttribute('href') ?? '', /^https:\/\/ukpowernetworks\.opendatasoft\.com\//);
  assert.ok(section.querySelector('[data-gi-focus="ukpn-licence"]'));
});

test('panel empty, stale and unavailable labels never present missing reports as healthy', async (t) => {
  const f = panelFixture(t); f.update({ ...envelope(), state: 'empty', incidents: [], counts: { raw: 0, accepted: 0, excluded: 0, invalid: 0 } }); await f.render();
  assert.match(f.root.textContent ?? '', /No usable unplanned incident reports; coverage remains partial/);
  f.update(envelope('EXPIRING')); await f.render(); f.at(NOW + 840_000); f.update(envelope('EXPIRING')); await f.render();
  assert.doesNotMatch(f.root.querySelector('.gi-ukpn-outages')?.textContent ?? '', /EXPIRING/);
  assert.match(f.root.querySelector('.gi-ukpn-outages')?.textContent ?? '', /stale|expired/i);
  f.update({ ...envelope(), state: 'unavailable', apiConsistency: 'unverified', incidents: [], counts: { raw: 0, accepted: 0, excluded: 0, invalid: 0 }, reasonCode: 'upstream_unavailable' }); await f.render();
  assert.match(f.root.querySelector('.gi-ukpn-outages')?.textContent ?? '', /unavailable/i);
});

test('actual deferred Panel rendering wires current tabs and preserves tab/provenance focus on polling', async (t) => {
  const f = panelFixture(t); f.update(envelope()); await f.render();
  const tab = f.root.querySelector<HTMLButtonElement>('[data-tab="internet"]'); assert.ok(tab); tab.focus(); tab.click(); await f.render();
  assert.equal(f.root.querySelector('[data-tab="internet"]')?.getAttribute('aria-selected'), 'true');
  f.update(envelope('SECOND')); await f.render(); assert.equal((f.window.document.activeElement as HTMLElement)?.dataset.tab, 'internet');
  const outages = f.root.querySelector<HTMLButtonElement>('[data-tab="outages"]'); assert.ok(outages); outages.click(); await f.render();
  const source = f.root.querySelector<HTMLAnchorElement>('[data-gi-focus="ukpn-source"]'); assert.ok(source); source.focus();
  f.update(envelope('THIRD')); await f.render(); assert.equal((f.window.document.activeElement as HTMLElement)?.dataset.giFocus, 'ukpn-source');
  const external = f.window.document.createElement('button'); f.window.document.body.append(external); external.focus();
  f.update(envelope('FOURTH')); await f.render(); assert.equal(f.window.document.activeElement, external);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Window } from 'happy-dom';
import { dataFreshness } from '../src/services/data-freshness.ts';

const source = readFileSync(new URL('../src/services/tropical-cyclones.ts', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../src/components/TropicalCyclonesPanel.ts', import.meta.url), 'utf8');
const emptyRss = '<rss version="2.0"><channel><title>JTWC</title></channel></rss>';
// Bounded synthetic reconstruction of reported live index structure, NOT raw upstream bytes.
const indexRss = '<rss version="2.0"><channel>' + ['NWPAC-NIO-WARNINGS', 'EPAC-CPAC-WARNINGS', 'SH-WARNINGS', 'TROPICAL-ADVISORIES'].map(id => `<item><guid>${id}</guid><title>${id}</title><description>Regional warning index</description><pubDate>Sun, 08 Nov 26 21:16:02 +0000</pubDate></item>`).join('') + '</channel></rss>';
// Legacy synthetic row only; current NHC field mapping is separately approved B.
const row = { id: 'fixture', atcf: 'AL012026', name: 'Fixture', wallet: 'fixture', intensity: '70', pressure: '980', lat: '12.5', lon: '-61.2', dateTime: '2026-11-08T20:00:00Z' };
function compile(text: string): string {
  return ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
async function fixture(run: (f: any) => Promise<void>): Promise<void> {
  const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, enableFileSystemHttpRequests: false } });
  const originalNow = Date.now;
  let now = 1_793_000_000_000;
  const calls: string[] = [];
  let nhc: () => Promise<Response> = async () => new Response(JSON.stringify({ activeStorms: [] }));
  let jtwc: () => Promise<Response> = async () => new Response(emptyRss);
  const exports: Record<string, any> = {};
  dataFreshness.recordUnknown('tropical-cyclones', 'isolated matrix');
  Date.now = () => now;
  try {
    vm.runInNewContext(compile(source), {
      exports, Date, AbortSignal, DOMParser: window.DOMParser,
      fetch: async (url: string) => { calls.push(url); assert.ok(url === 'https://www.nhc.noaa.gov/CurrentStorms.json' || url.startsWith('/api/rss-proxy?url=')); return url.startsWith('https:') ? nhc() : jtwc(); },
      require: (id: string) => { assert.equal(id, '@/services/data-freshness'); return { dataFreshness }; },
    }, { timeout: 1000 });
    await run({ api: exports, calls, state: () => dataFreshness.getSource('tropical-cyclones'), advance: (ms: number) => { now += ms; }, nhc: (fn: typeof nhc) => { nhc = fn; }, jtwc: (fn: typeof jtwc) => { jtwc = fn; } });
  } finally {
    Date.now = originalNow;
    dataFreshness.recordUnknown('tropical-cyclones', 'matrix restored');
    await window.happyDOM.close();
  }
}

test('cyclone matrix: JTWC index never becomes storm observations', async () => fixture(async f => {
  f.jtwc(async () => new Response(indexRss));
  const rows = await f.api.fetchTropicalCyclones();
  assert.equal(rows.length, 0, 'regional index must not become four fabricated storms');
  assert.equal(f.state().status, 'error');
  assert.equal(f.state().lastUpdate, null);
}));

test('cyclone matrix: RSS empty cannot certify aggregate absence', async () => fixture(async f => {
  assert.equal((await f.api.fetchTropicalCyclones()).length, 0);
  assert.equal(f.state().status, 'error', 'parseable empty RSS does not establish JTWC coverage');
  assert.equal(f.state().lastUpdate, null);
}));

test('cyclone matrix: failed NHC retains last-good rows and advisory time', async () => fixture(async f => {
  f.nhc(async () => new Response(JSON.stringify({ activeStorms: [row] })));
  f.jtwc(async () => new Response('', { status: 503 }));
  const first = await f.api.fetchTropicalCyclones();
  assert.equal(first.length, 1);
  f.advance(300_000);
  f.nhc(async () => { throw new Error('synthetic transport failure'); });
  const fallback = await f.api.fetchTropicalCyclones();
  assert.equal(fallback.length, 1, 'failed refresh must retain last-good NHC observation');
  assert.equal(fallback[0].advisoryTime.getTime(), first[0].advisoryTime.getTime());
  assert.equal(f.state().lastUpdate, null);
}));

test('cyclone matrix: partial refresh and successful empty never renew global freshness', async () => fixture(async f => {
  f.nhc(async () => new Response(JSON.stringify({ activeStorms: [row] })));
  f.jtwc(async () => new Response(indexRss));
  const first = await f.api.fetchTropicalCyclones();
  assert.equal(first.length, 1, 'only NHC observation is usable');
  assert.equal(f.state().lastUpdate, null, 'partial coverage cannot renew global success');
  f.advance(300_000);
  f.nhc(async () => new Response(JSON.stringify({ activeStorms: [] })));
  assert.equal((await f.api.fetchTropicalCyclones()).length, 0, 'successful NHC empty clears only its snapshot');
  assert.equal(f.state().status, 'error');
}));

test('cyclone matrix: five-minute failure cadence is measured after settlement', async () => fixture(async f => {
  f.nhc(async () => { f.advance(25_000); return new Response('', { status: 503 }); });
  f.jtwc(async () => new Response('', { status: 503 }));
  await f.api.fetchTropicalCyclones();
  f.advance(299_999);
  await f.api.fetchTropicalCyclones();
  assert.equal(f.calls.length, 2);
  f.advance(1);
  await f.api.fetchTropicalCyclones();
  assert.equal(f.calls.length, 4);
  assert.equal(f.state().lastUpdate, null, 'failed attempts never renew successful timestamp');
}));

test('cyclone matrix: concurrent callers coalesce one settled batch', async () => fixture(async f => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  f.nhc(async () => { await wait; return new Response(JSON.stringify({ activeStorms: [] })); });
  const one = f.api.fetchTropicalCyclones();
  const two = f.api.fetchTropicalCyclones();
  release();
  await Promise.all([one, two]);
  assert.equal(f.calls.length, 2, 'one batch should serve both simultaneous callers');
}));

test('cyclone matrix: actual panel render never declares no-active on unavailable data', () => {
  let html = '';
  class Panel { constructor() {} showLoading() {} setCount() {} setContent(value: string) { html = value; } }
  const exports: Record<string, any> = {};
  const state = { status: 'error', lastUpdate: null };
  vm.runInNewContext(compile(panelSource), { exports, Date, require: (id: string) => {
    if (id === './Panel') return { Panel };
    if (id === '@/services/tropical-cyclones') return { tcSeverityClass: () => 'eq-row', tcCategoryLabel: () => 'Cat 1' };
    if (id === '@/utils/sanitize') return { escapeHtml: (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;') };
    if (id === '@/services/data-freshness') return { dataFreshness: { getSource: () => state } };
    throw new Error('unadmitted panel import: ' + id);
  } }, { timeout: 1000 });
  const panel = new exports.TropicalCyclonesPanel();
  panel.update([]);
  assert.doesNotMatch(html, /No active tropical cyclones/, 'outage must not assert no active storms');
  assert.match(html, /unavailable|incomplete/i);
  panel.update([{ ...row, basin: 'atlantic', category: 'category_1', severity: 'medium', windKts: 70, movement: '', advisoryTime: new Date(row.dateTime) }]);
  assert.match(html, /Fixture/);
  assert.match(html, /incomplete|stale/i, 'retained rows must expose degraded coverage');
  for (const status of ['no_data', 'stale', 'error']) {
    state.status = status;
    panel.update([]);
    assert.doesNotMatch(html, /No active tropical cyclones/);
    assert.match(html, /unavailable|incomplete/i);
  }
  // Presentation boundary only: A never manufactures a healthy JTWC outcome.
  state.status = 'fresh';
  panel.update([]);
  assert.match(html, /No active tropical cyclones/);
  assert.doesNotMatch(html, /unavailable|incomplete/i);
});

test('cyclone matrix: malformed bodies and envelopes remain unavailable', async () => {
  const invalidNHC = [null, {}, { activeStorms: null }, { activeStorms: {} }];
  for (const body of invalidNHC) await fixture(async f => {
    f.nhc(async () => new Response(JSON.stringify(body)));
    f.jtwc(async () => new Response('<rss><channel>'));
    assert.equal((await f.api.fetchTropicalCyclones()).length, 0);
    assert.equal(f.state().status, 'error', 'invalid source envelope cannot create successful empty evidence');
    assert.equal(f.state().lastUpdate, null);
  });
  await fixture(async f => {
    f.nhc(async () => new Response('{invalid json'));
    f.jtwc(async () => { throw new Error('synthetic timeout'); });
    await f.api.fetchTropicalCyclones();
    assert.equal(f.state().status, 'error');
  });
});


test('cyclone matrix: retry after settled failure clears in-flight and successful empty clears retained rows', async () => fixture(async f => {
  f.nhc(async () => new Response(JSON.stringify({ activeStorms: [row] })));
  await f.api.fetchTropicalCyclones();
  f.advance(300_000);
  f.nhc(async () => { throw new Error('private synthetic transport detail'); });
  const retained = await f.api.fetchTropicalCyclones();
  assert.equal(retained.length, 1);
  assert.equal(f.calls.length, 4, 'settled initial promise must be cleared for retry');
  assert.equal(f.state().lastError, 'NHC response unavailable; JTWC observation coverage unavailable');
  f.advance(300_000);
  f.nhc(async () => new Response(JSON.stringify({ activeStorms: [] })));
  assert.equal((await f.api.fetchTropicalCyclones()).length, 0);
  assert.equal(f.calls.length, 6, 'settled failed source must not pin the old batch');
  assert.equal(f.state().lastError, 'JTWC observation coverage unavailable');
  assert.equal(f.state().lastUpdate, null);
}));

test('cyclone matrix: fixed errors hide transport bodies and preserve earlier successful tracker time', async () => fixture(async f => {
  dataFreshness.recordUpdate('tropical-cyclones', 1);
  const originalTime = f.state().lastUpdate;
  f.advance(42_000);
  f.nhc(async () => new Response('private body', { status: 503 }));
  f.jtwc(async () => new Response('private body', { status: 503 }));
  await f.api.fetchTropicalCyclones();
  assert.equal(f.state().lastError, 'NHC HTTP failure; JTWC HTTP failure');
  assert.equal(f.state().lastUpdate, originalTime);
  f.advance(300_000);
  f.nhc(async () => new Response('{broken'));
  f.jtwc(async () => { throw new Error('private token-shaped synthetic detail'); });
  await f.api.fetchTropicalCyclones();
  assert.equal(f.state().lastError, 'NHC response unavailable; JTWC response unavailable');
  assert.equal(f.state().lastUpdate, originalTime);
}));

test('cyclone matrix: severity order and original last-good observation bytes survive outage', async () => fixture(async f => {
  const rows = [
    { ...row, atcf: 'AL012026', name: 'Low', intensity: '20' },
    { ...row, atcf: 'AL022026', name: 'Critical', intensity: '160' },
    { ...row, atcf: 'AL032026', name: 'Medium', intensity: '70' },
  ];
  f.nhc(async () => new Response(JSON.stringify({ activeStorms: rows })));
  const first = await f.api.fetchTropicalCyclones();
  assert.deepEqual(Array.from(first, (storm: any) => storm.name), ['Critical', 'Medium', 'Low']);
  const original = JSON.stringify(first);
  f.advance(300_000);
  f.nhc(async () => new Response('', { status: 503 }));
  assert.equal(JSON.stringify(await f.api.fetchTropicalCyclones()), original);
  assert.equal(f.state().status, 'error');
}));

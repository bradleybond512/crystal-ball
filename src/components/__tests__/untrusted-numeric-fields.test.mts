// R3-SEC-009 / R4-LOW-005: numbers from feeds render as numbers or "—",
// never as markup, even if a provider sends a string.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import type { CountryMeta } from '../../services/rest-countries.ts';
import type { CountryBriefSignals } from '../../app/app-context.ts';
import type { CountryScore } from '../../services/country-instability.ts';
import { invalidateColorCache } from '../../utils/theme-colors.ts';
import '../../../tests/panels/register-hook.mjs';
import { happyWindow, POST_MOUNT_ERRORS, getFetchCalls, clearFetchCalls } from '../../../tests/panels/setup-dom.mts';

// Resource parsing stays local: relative print URLs are inspected, never fetched.
const originalResourceSettings = {
  disableCSSFileLoading: happyWindow.happyDOM.settings.disableCSSFileLoading,
  disableJavaScriptFileLoading: happyWindow.happyDOM.settings.disableJavaScriptFileLoading,
  disableIframePageLoading: happyWindow.happyDOM.settings.disableIframePageLoading,
  enableImageFileLoading: happyWindow.happyDOM.settings.enableImageFileLoading,
};
happyWindow.happyDOM.settings.disableCSSFileLoading = true;
happyWindow.happyDOM.settings.disableJavaScriptFileLoading = true;
happyWindow.happyDOM.settings.disableIframePageLoading = true;
happyWindow.happyDOM.settings.enableImageFileLoading = false;
after(() => Object.assign(happyWindow.happyDOM.settings, originalResourceSettings));

// Enrichment responses are deliberately absent; no metadata/wiki request is allowed.
register(`data:text/javascript,${encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('/src/services/rest-countries.ts')) return { format: 'module', shortCircuit: true, source: 'export async function fetchCountryMeta(code) { return globalThis.__countryEnrichment.meta(code); }' };
  if (url.endsWith('/src/services/wikipedia.ts')) return { format: 'module', shortCircuit: true, source: 'export async function fetchWikiSummary(name) { return globalThis.__countryEnrichment.wiki(name); }' };
  return nextLoad(url, context);
}`)}`);
type Enrichment = { meta: (code: string) => Promise<CountryMeta | null>; wiki: (name: string) => Promise<{ extract: string; pageUrl: string } | null> };
const defaultEnrichment: Enrichment = { meta: async () => null, wiki: async () => null };
(globalThis as Record<string, unknown>).__countryEnrichment = defaultEnrichment;
(globalThis as Record<string, unknown>).DOMParser = happyWindow.DOMParser;
const { CountryBriefPage } = await import('../CountryBriefPage.ts');
const { MapPopup } = await import('../MapPopup.ts');

const HOSTILE = '"><img src=x onerror=window.pwned=1>';

function mountPopup(): InstanceType<typeof MapPopup> {
  document.body.replaceChildren();
  const container = document.createElement('div');
  document.body.append(container);
  return new MapPopup(container);
}

test('raw-relay-shaped AIS fields bypassing proto coercion cannot carry markup', () => {
  const popup = mountPopup();
  popup.show({
    type: 'ais',
    data: { id: 'a', name: 'Hormuz', type: 'gap_spike', lat: 26.5, lon: 56.3, severity: 'high', changePct: HOSTILE, windowHours: HOSTILE, darkShips: HOSTILE, region: 'Gulf', description: 'd' } as never,
    x: 10,
    y: 10,
  });
  assert.equal(document.querySelector('img'), null);
  const values = [...document.querySelectorAll('.stat-value')].map((v) => v.textContent?.trim());
  assert.deepEqual(values.slice(0, 3), ['—% ↑', '—', '—H']);
  popup.hide();
});

test('AIS popup shows real numbers normally', () => {
  const popup = mountPopup();
  popup.show({
    type: 'ais',
    data: { id: 'a', name: 'Hormuz', type: 'chokepoint_congestion', lat: 26.5, lon: 56.3, severity: 'low', changePct: 42.25, windowHours: 6, vesselCount: 1250, description: 'd' } as never,
    x: 10,
    y: 10,
  });
  const values = [...document.querySelectorAll('.stat-value')].map((v) => v.textContent?.trim());
  assert.deepEqual(values.slice(0, 3), ['42.3% ↑', '1,250', '6H']);
  popup.hide();
});

test('protest fatalities cannot carry markup', () => {
  const popup = mountPopup();
  popup.show({
    type: 'protest',
    data: { id: 'p', title: 't', eventType: 'riot', country: 'X', lat: 1, lon: 2, time: new Date(0), severity: 'high', fatalities: HOSTILE, sources: [], sourceType: 'acled', confidence: 'high', validated: true } as never,
    x: 10,
    y: 10,
  });
  assert.equal(document.querySelector('img'), null);
  assert.equal(document.querySelector('.stat-value.alert')?.textContent, '—');
  popup.hide();
});

test('the adapters and other sinks coerce or escape at the source', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const maritime = read('../../services/maritime/index.ts');
  for (const field of ['changePct', 'windowHours']) assert.match(maritime, new RegExp(`${field}: finiteOr\\(proto\\.${field}, 0\\)`));
  for (const field of ['darkShips', 'vesselCount']) assert.match(maritime, new RegExp(`${field}: finiteOrUndefined\\(proto\\.${field}\\)`));
  assert.match(read('../../services/unrest/index.ts'), /fatalities: positiveCountOrUndefined\(e\.fatalities\)/);
  assert.match(read('../CountryIntelModal.ts'), /\$\{sign\}\$\{formatFiniteNumber\(pct, 2\)\}% \(1W\)/);
  assert.match(read('../S2UndergroundPanel.ts'), /Could not start Patreon connect: \$\{escapeHtml\(msg\)\}/);
  assert.match(read('../../services/survival-advisor.ts'), /partitionStoredItems\(req\.result as unknown\[\]\)\.items/);
});

test('active country page stock sink formats hostile, nonfinite and full numeric strings in actual DOM', async () => {
  const beforeErrors = POST_MOUNT_ERRORS.length; clearFetchCalls();
  const page = new CountryBriefPage();
  try {
    for (const [raw, text, up] of [[HOSTILE, '—', false], ['NaN', '—', false], ['Infinity', '—', false], ['1e309', '—', false], ['1junk', '—', false], ['12.345', '+12.35', true], ['-2.345', '-2.35', false], ['0', '+0', true]] as const) {
      page.show('Fixture', 'ZZ', null, { isTier1: false } as never);
      assert.ok(document.querySelector('.country-brief-overlay.active .stock-loading'));
      page.updateStock({ available: true, indexName: 'Index <img src=x onerror="boom">', weekChangePercent: raw } as never);
      const chip = document.querySelector('.country-brief-overlay.active .signal-chip.stock'); assert.ok(chip);
      assert.equal(chip.querySelector('img,script,[onerror]'), null);
      assert.equal(chip.textContent, `${up ? '📈' : '📉'} Index <img src=x onerror="boom">: ${text}% (1W)`);
      assert.ok(chip.classList.contains(up ? 'stock-up' : 'stock-down'));
    }
    page.show('Fixture', 'ZZ', null, { isTier1: false } as never); page.updateStock({ available: false } as never);
    assert.equal(document.querySelector('.country-brief-overlay.active .stock-loading'), null);
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(getFetchCalls(), [], 'enrichment is stubbed before import');
    assert.deepEqual(POST_MOUNT_ERRORS.slice(beforeErrors), [], 'no swallowed async errors');
  } finally { page.hide(); document.querySelector('.country-brief-overlay')?.remove(); }
});

const emptySignals = { isTier1: false } as CountryBriefSignals;
function countryPage(t: test.TestContext): InstanceType<typeof CountryBriefPage> {
  const errors = POST_MOUNT_ERRORS.length; clearFetchCalls();
  const page = new CountryBriefPage();
  t.after(() => {
    page.hide(); document.querySelector('.country-brief-overlay')?.remove();
    (globalThis as Record<string, unknown>).__countryEnrichment = defaultEnrichment;
    assert.deepEqual(POST_MOUNT_ERRORS.slice(errors), [], 'async failures cannot be swallowed');
    assert.deepEqual(getFetchCalls(), [], 'country fixtures cannot fetch');
  });
  return page;
}
const activePage = () => document.querySelector<HTMLElement>('.country-brief-overlay.active')!;
const scoreFixture = (trend = 'stable', value = 0, level = 'normal') => ({ code: 'ZZ', name: 'Fixture', score: 25, level, trend, components: { unrest: value, conflict: 0, security: 0, information: 0 } }) as CountryScore;
const settleEnrichment = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

// Independent legacy algorithm deliberately operates on UTF-16 units.
function legacyFlag(code: string): string {
  try { return code.toUpperCase().split('').map(unit => String.fromCodePoint(0x1F1E6 + unit.charCodeAt(0) - 65)).join(''); }
  catch { return '🌍'; }
}
test('country show retains legacy flags for ISO codes, empty and malformed Unicode inputs', (t) => {
  const page = countryPage(t);
  for (const code of ['US', 'us', 'GB', '', 'A', 'é', 'ß', '😀', '\uD800']) {
    page.show('Fixture', code, null, emptySignals);
    assert.equal(activePage().querySelector('.cb-flag')?.textContent, legacyFlag(code), JSON.stringify(code));
  }
});

test('risk, trends and component boundaries keep their existing DOM decisions', (t) => {
  const page = countryPage(t);
  const previous = document.documentElement.getAttribute('style');
  const colors = { '--semantic-critical': 'rgb(70, 0, 0)', '--semantic-high': 'rgb(50, 0, 0)', '--semantic-elevated': 'rgb(30, 0, 0)', '--semantic-normal': 'rgb(0, 0, 0)', '--text-dim': 'rgb(1, 1, 1)' };
  for (const [key, value] of Object.entries(colors)) document.documentElement.style.setProperty(key, value);
  invalidateColorCache();
  t.after(() => { if (previous === null) document.documentElement.removeAttribute('style'); else document.documentElement.setAttribute('style', previous); invalidateColorCache(); });
  for (const [value, color] of [[29.999, colors['--semantic-normal']], [30, colors['--semantic-elevated']], [49.999, colors['--semantic-elevated']], [50, colors['--semantic-high']], [69.999, colors['--semantic-high']], [70, colors['--semantic-critical']]] as const) {
    page.show('Fixture <angle>', 'ZZ', scoreFixture('stable', value), emptySignals);
    assert.equal(activePage().querySelector<HTMLElement>('.cb-comp-fill')?.style.background, color);
    assert.ok(activePage().querySelector('.cb-score-ring')); assert.equal(activePage().querySelector('.cb-not-tracked'), null);
    assert.equal(activePage().querySelector('.cb-country-name')?.textContent, 'Fixture <angle>');
  }
  for (const [trend, cls, arrow] of [['rising', 'trend-up', '↗'], ['falling', 'trend-down', '↘'], ['stable', 'trend-stable', '→'], ['unexpected', 'trend-stable', '→']] as const) {
    page.show('Fixture', 'ZZ', scoreFixture(trend), emptySignals);
    const el = activePage().querySelector('.cb-trend'); assert.ok(el?.classList.contains(cls));
    assert.equal(el?.textContent, `${arrow} countryBrief.trends.${trend}`);
  }
  page.show('Fixture', 'ZZ', scoreFixture('stable', 0, 'unexpected'), emptySignals);
  assert.equal(activePage().querySelector<HTMLElement>('.cb-score-value')?.style.color, colors['--text-dim']);
  page.show('Fixture', 'ZZ', null, { isTier1: true } as CountryBriefSignals); assert.equal(activePage().querySelector('.cb-risk-section'), null);
  page.show('Fixture', 'ZZ', null, emptySignals); assert.ok(activePage().querySelector('.cb-not-tracked'));
});

test('all activity, impact and recent chips retain exact order, text and classes', (t) => {
  const page = countryPage(t);
  const enabled = { isTier1: false, criticalNews: 1, protests: 2, militaryFlights: 3, militaryVessels: 4, outages: 5, aisDisruptions: 6, satelliteFires: 7, temporalAnomalies: 8, cyberThreats: 9, earthquakes: 10, displacementOutflow: 1000000, climateStress: 12, conflictEvents: 13, activeStrikes: 14, travelAdvisories: 15, travelAdvisoryMaxLevel: 'reconsider', orefSirens: 16, orefHistory24h: 17, aviationDisruptions: 18, gpsJammingHexes: 19 } as CountryBriefSignals;
  page.show('Fixture', 'ZZ', null, enabled);
  const chips = [...activePage().querySelectorAll('.signal-chip')];
  assert.deepEqual(chips.map(chip => chip.textContent), [
    '🚨 1 Critical News', '📢 2 modals.countryBrief.signals.protests', '✈️ 3 modals.countryBrief.signals.militaryAir', '⚓ 4 modals.countryBrief.signals.militarySea',
    '🌐 5 modals.countryBrief.signals.outages', '🚢 6 AIS Disruptions', '🔥 7 Satellite Fires', '⏱️ 8 Temporal Anomalies', '🛡️ 9 Cyber Threats', '🌍 10 modals.countryBrief.signals.earthquakes',
    '🌊 1.0M modals.countryBrief.signals.displaced', '🌡️ modals.countryBrief.signals.climate', '⚔️ 13 modals.countryBrief.signals.conflictEvents', '💥 14 modals.countryBrief.signals.activeStrikes',
    '⚠️ 15 Advisory: Reconsider Travel', '🚨 16 Active Sirens', '🕓 17 Sirens / 24h', '🚫 18 modals.countryBrief.signals.aviationDisruptions', '📡 19 modals.countryBrief.signals.gpsJammingZones', '📈 modals.countryBrief.loadingIndex',
  ]);
  assert.deepEqual(chips.map(chip => chip.className), ['conflict', 'protest', 'military', 'military', 'outage', 'outage', 'climate', 'outage', 'conflict', 'quake', 'displacement', 'climate', 'conflict', 'conflict', 'outage', 'conflict', 'conflict', 'outage', 'outage', 'stock-loading'].map(cls => `signal-chip ${cls}`));
  for (const value of [0, -1, NaN]) {
    const disabled = Object.fromEntries(Object.entries(enabled).map(([key, item]) => [key, typeof item === 'number' ? value : item]));
    page.show('Fixture', 'ZZ', null, disabled as unknown as CountryBriefSignals);
    assert.equal(activePage().querySelectorAll('.signal-chip').length, 1);
  }
  for (const [value, display] of [[999999, '1000K'], [1000000, '1.0M']] as const) {
    page.show('Fixture', 'ZZ', null, { ...emptySignals, displacementOutflow: value });
    assert.match(activePage().querySelector('.displacement')?.textContent ?? '', new RegExp(display));
  }
  for (const [level, cls, label] of [['do-not-travel', 'conflict', 'Do Not Travel'], ['reconsider', 'outage', 'Reconsider Travel'], ['unexpected', 'military', 'Exercise Caution']] as const) {
    page.show('Fixture', 'ZZ', null, { ...emptySignals, travelAdvisories: 1, travelAdvisoryMaxLevel: level } as CountryBriefSignals);
    const chip = activePage().querySelector('.signal-chip'); assert.equal(chip?.className, `signal-chip ${cls}`); assert.equal(chip?.textContent, `⚠️ 1 Advisory: ${label}`);
  }
  page.show('Fixture', 'ZZ', null, { ...emptySignals, travelAdvisories: 1 }); assert.equal(activePage().querySelectorAll('.signal-chip').length, 1);
});

test('brief fallbacks remain truthy and citation ranges and escaping remain unchanged', (t) => {
  const page = countryPage(t); page.show('Fixture', 'ZZ', null, emptySignals);
  for (const [error, reason, expected] of [['error <img>', 'reason', 'error <img>'], ['', 'reason', 'reason'], ['', '', 'modals.countryBrief.briefUnavailable'], [undefined, ' ', ' '], ['0', 'reason', '0']] as const) {
    page.updateBrief({ country: 'Fixture', code: 'ZZ', brief: '', error, reason });
    assert.equal(activePage().querySelector('.intel-error')?.textContent, expected); assert.equal(activePage().querySelector('.intel-error img'), null);
  }
  const news = Array.from({ length: 3 }, (_, index) => ({ title: `Source ${index + 1}`, source: 'Fixture', link: '', pubDate: new Date(0) }));
  page.updateNews(news as never);
  page.updateBrief({ country: 'Fixture', code: 'ZZ', brief: '**Safe** <img> [0] [1] [3] [99]' });
  assert.deepEqual([...activePage().querySelectorAll('.cb-citation')].map(link => link.getAttribute('href')), ['#cb-news-1', '#cb-news-3']);
  assert.equal(activePage().querySelector('.cb-brief-text img'), null); assert.match(activePage().querySelector('.cb-brief-text')?.textContent ?? '', /<img> \[0\] \[1\] \[3\] \[99\]/);
  for (const url of ['', 'https://example.test/market']) {
    page.updateMarkets([{ title: 'Market <img>', yesPrice: 50, url }] as never);
    assert.equal(activePage().querySelector('.cb-market-link')?.getAttribute('href') ?? '', url);
    assert.equal(activePage().querySelector('.cb-market-item img'), null);
  }
});

const metadata = (patch: Partial<CountryMeta> = {}): CountryMeta => ({ name: 'Fixture', capital: '', region: '', subregion: '', population: 0, area: 0, flag: '', flagUrl: '', currencies: [], languages: [], borders: [], latlng: [0, 0], timezones: [], tld: [], ...patch });
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test('facts preserve field order, truthiness, magnitude boundaries and escaping', async (t) => {
  const page = countryPage(t);
  for (const [population, display] of [[999999, (999999).toLocaleString()], [1000000, '1.0M'], [999999999, '1000.0M'], [1000000000, '1.0B']] as const) {
    (globalThis as Record<string, unknown>).__countryEnrichment = { meta: async () => metadata({ capital: 'Capital <img>', region: 'Region "quoted"', subregion: '<Subregion>', population, area: 12, currencies: ['First <b>', 'Second'], languages: ['One', 'Two', 'Three', 'Four'], tld: ['.first', '.second'], timezones: ['TZ1', 'TZ2'] }), wiki: async () => null } satisfies Enrichment;
    page.show('Fixture', 'ZZ', null, emptySignals); await settleEnrichment();
    const facts = activePage().querySelector('.cb-facts-content')!;
    assert.deepEqual([...facts.querySelectorAll('dt')].map(node => node.textContent), ['Capital', 'Region', 'Population', 'Area', 'Currency', 'Languages', 'TLD', 'Timezone']);
    assert.deepEqual([...facts.querySelectorAll('dd')].map(node => node.textContent), ['Capital <img>', 'Region "quoted" — <Subregion>', display, '12 km²', 'First <b>', 'One, Two, Three', '.first', 'TZ1']);
    assert.equal(facts.querySelector('img,b,subregion'), null); assert.equal(activePage().querySelector<HTMLElement>('.cb-facts-section')?.style.display, '');
  }
  (globalThis as Record<string, unknown>).__countryEnrichment = { meta: async () => metadata({ subregion: 'Should stay omitted' }), wiki: async () => null } satisfies Enrichment;
  page.show('Fixture', 'ZZ', null, emptySignals); await settleEnrichment(); assert.equal(activePage().querySelectorAll('.cb-facts-content dt').length, 0);
});

test('enrichment keeps Promise.all call order, independent rejection and newer-country guard', async (t) => {
  const page = countryPage(t); const calls: string[] = [];
  const oldMeta = deferred<CountryMeta | null>(); const oldWiki = deferred<{ extract: string; pageUrl: string } | null>();
  (globalThis as Record<string, unknown>).__countryEnrichment = { meta: (code: string) => { calls.push(`meta:${code}`); return oldMeta.promise; }, wiki: (name: string) => { calls.push(`wiki:${name}`); return oldWiki.promise; } } satisfies Enrichment;
  page.show('Old', 'AA', null, emptySignals); assert.deepEqual(calls, ['meta:AA', 'wiki:Old']);
  (globalThis as Record<string, unknown>).__countryEnrichment = defaultEnrichment; page.show('New', 'BB', null, emptySignals);
  oldWiki.resolve({ extract: 'OLD_WIKI', pageUrl: 'https://example.test/old' }); await settleEnrichment(); assert.doesNotMatch(activePage().textContent ?? '', /OLD_WIKI/);
  oldMeta.resolve(metadata({ capital: 'OLD_CAPITAL' })); await settleEnrichment(); assert.doesNotMatch(activePage().textContent ?? '', /OLD_CAPITAL|OLD_WIKI/);
  for (const rejected of ['meta', 'wiki'] as const) {
    const meta = deferred<CountryMeta | null>(); const wiki = deferred<{ extract: string; pageUrl: string } | null>();
    (globalThis as Record<string, unknown>).__countryEnrichment = { meta: async () => meta.promise, wiki: async () => wiki.promise } satisfies Enrichment;
    page.show('Fixture', 'ZZ', null, emptySignals);
    if (rejected === 'meta') { wiki.resolve({ extract: 'Valid <overview>', pageUrl: 'https://example.test/wiki' }); meta.reject(new Error('Fixture metadata unavailable')); }
    else { meta.resolve(metadata({ capital: 'Valid capital' })); wiki.reject(new Error('Fixture wiki unavailable')); }
    await settleEnrichment();
    assert.equal(activePage().querySelector<HTMLElement>(rejected === 'meta' ? '.cb-wiki-section' : '.cb-facts-section')?.style.display, '');
    assert.match(activePage().textContent ?? '', rejected === 'meta' ? /Valid <overview>/ : /Valid capital/);
    assert.equal(activePage().querySelector('overview'), null);
  }
  const hiddenMeta = deferred<CountryMeta | null>();
  (globalThis as Record<string, unknown>).__countryEnrichment = { meta: async () => hiddenMeta.promise, wiki: async () => null } satisfies Enrichment;
  page.show('Hidden', 'CC', null, emptySignals); page.hide(); hiddenMeta.resolve(metadata({ capital: 'HIDDEN_CAPITAL' })); await settleEnrichment();
  assert.doesNotMatch(document.querySelector('.country-brief-overlay')?.textContent ?? '', /HIDDEN_CAPITAL/);
});

test('news retains critical/high/medium/default color order and safe URL behavior', (t) => {
  const page = countryPage(t); page.show('Fixture', 'ZZ', null, emptySignals);
  const prior = document.documentElement.getAttribute('style');
  const levels = ['critical', 'high', 'medium', 'unexpected', undefined] as const;
  const colors = ['rgb(90, 0, 0)', 'rgb(60, 0, 0)', 'rgb(30, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)'];
  for (const [level, color] of [['critical', colors[0]], ['high', colors[1]], ['medium', colors[2]], ['info', colors[3]]] as const) document.documentElement.style.setProperty(`--threat-${level}`, color!);
  invalidateColorCache();
  t.after(() => { if (prior === null) document.documentElement.removeAttribute('style'); else document.documentElement.setAttribute('style', prior); invalidateColorCache(); });
  page.updateNews(levels.map((level, index) => ({ title: `News <img> ${index}`, source: 'Fixture', link: index % 2 ? 'https://example.test/news' : '', pubDate: new Date(0), threat: level ? { level } : undefined })) as never);
  assert.deepEqual([...activePage().querySelectorAll<HTMLElement>('.cb-news-threat')].map(el => el.style.background), colors);
  assert.equal(activePage().querySelectorAll('a.cb-news-card').length, 2); assert.equal(activePage().querySelector('.cb-news-content img'), null);
});

// Original intended print markup is an independent fixture; no legacy write or
// browser print is executed to obtain its oracle.
const LEGACY_PRINT_CSS = `
 @media print { body { margin: 0; padding: 16px; background: #fff; color: #111; }
 .cb-grid { display: block !important; }
 .cb-grid > * { break-inside: avoid; margin-bottom: 16px; }
 .cb-badge, .cb-trend { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
 canvas { max-width: 100% !important; }
 }
 body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
 .country-brief-overlay { position: static !important; background: none !important; }
 `;
function legacyPrintMarkup(header: string, content: string, styles: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${styles}
 <style>${LEGACY_PRINT_CSS}</style>
 </head><body>${header}${content}</body></html>`;
}
class FakeClock {
  now = 0;
  private id = 0;
  private tasks: { id: number; at: number; callback: () => void }[] = [];
  readonly delays: { scheduledAt: number; delay: number }[] = [];
  setTimeout = (callback: () => void, delay = 0): ReturnType<typeof setTimeout> => {
    const id = ++this.id; this.tasks.push({ id, at: this.now + delay, callback }); this.delays.push({ scheduledAt: this.now, delay });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  tick(duration: number): void {
    const end = this.now + duration;
    while (true) {
      this.tasks.sort((a, b) => a.at - b.at || a.id - b.id);
      const task = this.tasks[0]; if (!task || task.at > end) break;
      this.tasks.shift(); this.now = task.at; task.callback();
    }
    this.now = end;
  }
}

// Frame nodes are inert namespace elements, so happy-dom cannot navigate or
// fetch resources. They expose the exact document/window API consumed by export.
// The document models inherited about:blank URL/base separately, by design.
function printFixture(missingDocument = false, documentFallback = false) {
  const create = document.createElement.bind(document);
  const originalCreate = document.createElement;
  const originalTimer = globalThis.setTimeout;
  const parentWindow = happyWindow as unknown as Window;
  const originalPrint = parentWindow.print;
  parentWindow.print = () => { assert.fail('Parent/native print is prohibited in this fixture'); };
  const clock = new FakeClock();
  const frames: { node: HTMLIFrameElement; doc: Document; window: EventTarget & { document: Document | null; print: () => void }; baseURI: string }[] = [];
  const printedAt: number[] = [];
  document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    if (tag !== 'iframe') return create(tag, options);
    const node = document.createElementNS('urn:disposable-print-frame', 'iframe') as unknown as HTMLIFrameElement;
    const style = create('div').style;
    Object.defineProperty(node, 'style', { value: style });
    const doc = document.implementation.createHTMLDocument('');
    Object.defineProperty(doc, 'URL', { value: 'about:blank', configurable: true });
    const frameWindow = Object.assign(new happyWindow.EventTarget() as unknown as EventTarget, { document: missingDocument ? null : doc, print: () => { printedAt.push(clock.now); } });
    Object.defineProperty(node, 'contentDocument', { value: missingDocument || documentFallback ? null : doc });
    Object.defineProperty(node, 'contentWindow', { value: frameWindow });
    frames.push({ node, doc, window: frameWindow, baseURI: doc.baseURI });
    return node;
  }) as typeof document.createElement;
  globalThis.setTimeout = clock.setTimeout as typeof setTimeout;
  return {
    frames, clock, printedAt,
    restore: () => { document.createElement = originalCreate; globalThis.setTimeout = originalTimer; parentWindow.print = originalPrint; for (const frame of frames) frame.node.remove(); },
  };
}

for (const missingHeader of [false, true]) {
  test(`PDF export keeps original markup, inherited base and stable frame document (missing header=${missingHeader})`, async (t) => {
    const page = countryPage(t); page.show('Fixture <quoted>', 'ZZ', null, emptySignals); await settleEnrichment();
    const button = activePage().querySelector<HTMLButtonElement>('.cb-export-option[data-format="pdf"]'); assert.ok(button);
    if (missingHeader) activePage().querySelector('.cb-header')?.remove();
    const content = activePage().querySelector('.cb-body')!;
    content.insertAdjacentHTML('beforeend', '<div class="relative-fixture"><a href="relative/story">Story</a><img src="relative/image.png" alt="&quot;quoted&quot;"></div>');
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.setAttribute('href', 'relative/print.css');
    const style = document.createElement('style'); style.textContent = '.print-fixture { color: purple; }';
    document.head.append(link, style); t.after(() => { link.remove(); style.remove(); });
    const header = activePage().querySelector('.cb-header')?.outerHTML ?? '';
    const styles = [...document.querySelectorAll('link[rel="stylesheet"],style')].map(node => node.outerHTML).join('\n');
    const expected = new happyWindow.DOMParser().parseFromString(legacyPrintMarkup(header, content.outerHTML, styles), 'text/html');
    const fixture = printFixture(false, missingHeader);
    try {
      button.click(); assert.equal(fixture.frames.length, 1);
      const frame = fixture.frames[0]!; const frameWindow = frame.window; const targetDoc = frame.doc;
      assert.equal(frame.node.parentNode, document.body);
      assert.equal(frame.node.style.position, 'fixed'); assert.equal(frame.node.style.left, '-9999px'); assert.equal(frame.node.style.width, '0px'); assert.equal(frame.node.style.height, '0px'); assert.equal(frame.node.style.borderStyle, 'none');
      assert.equal(targetDoc.doctype?.name, 'html'); assert.equal(targetDoc.documentElement.outerHTML, expected.documentElement.outerHTML);
      assert.equal(targetDoc.querySelector('meta')?.getAttribute('charset'), 'utf-8');
      assert.equal(targetDoc.querySelector('style:last-child')?.textContent, LEGACY_PRINT_CSS);
      assert.equal(targetDoc.querySelector('.cb-header') !== null, !missingHeader);
      assert.equal(targetDoc.documentElement.ownerDocument, targetDoc); assert.equal(targetDoc.querySelector('.relative-fixture')?.ownerDocument, targetDoc);
      assert.equal(targetDoc.URL, 'about:blank'); assert.equal(targetDoc.baseURI, frame.baseURI); assert.equal(targetDoc.baseURI, document.baseURI);
      assert.equal(targetDoc.querySelector<HTMLLinkElement>('link')?.href, new URL('relative/print.css', document.baseURI).href);
      assert.equal(targetDoc.querySelector<HTMLAnchorElement>('.relative-fixture a')?.href, new URL('relative/story', document.baseURI).href);
      assert.equal(targetDoc.querySelector<HTMLImageElement>('.relative-fixture img')?.src, new URL('relative/image.png', document.baseURI).href);
      assert.equal(targetDoc.querySelector('base'), null); assert.equal(frame.node.getAttribute('srcdoc'), null);
      assert.equal(frame.node.contentWindow as unknown, frameWindow); assert.equal(frameWindow.document, targetDoc);
      assert.deepEqual(fixture.printedAt, []); assert.deepEqual(fixture.clock.delays, [{ scheduledAt: 0, delay: 300 }]);
      fixture.clock.tick(299); assert.deepEqual(fixture.printedAt, []);
      fixture.clock.tick(1); assert.deepEqual(fixture.printedAt, [300]); assert.deepEqual(fixture.clock.delays[1], { scheduledAt: 300, delay: 5000 });
      frameWindow.dispatchEvent(new Event('afterprint')); assert.equal(frame.node.parentNode, null);
      assert.doesNotThrow(() => frameWindow.dispatchEvent(new Event('afterprint')));
      assert.doesNotThrow(() => fixture.clock.tick(5000)); assert.deepEqual(fixture.printedAt, [300]);
    } finally { fixture.restore(); }
  });
}

test('PDF export falls back at 5,300ms without afterprint and handles absent content/document', async (t) => {
  const page = countryPage(t); page.show('Fixture', 'ZZ', null, emptySignals); await settleEnrichment();
  const fixture = printFixture();
  try {
    activePage().querySelector<HTMLButtonElement>('.cb-export-option[data-format="pdf"]')!.click();
    const frame = fixture.frames[0]!; fixture.clock.tick(5299); assert.equal(frame.node.parentNode, document.body);
    assert.deepEqual(fixture.printedAt, [300]); fixture.clock.tick(1); assert.equal(frame.node.parentNode, null);
  } finally { fixture.restore(); }
  const absentDocument = printFixture(true);
  try {
    activePage().querySelector<HTMLButtonElement>('.cb-export-option[data-format="pdf"]')!.click();
    assert.equal(absentDocument.frames.length, 1); assert.equal(absentDocument.frames[0]?.node.parentNode, null); assert.deepEqual(absentDocument.clock.delays, []);
  } finally { absentDocument.restore(); }
  const absentContent = printFixture();
  try {
    activePage().querySelector('.cb-body')?.remove(); activePage().querySelector<HTMLButtonElement>('.cb-export-option[data-format="pdf"]')!.click();
    assert.equal(absentContent.frames.length, 0); assert.deepEqual(absentContent.clock.delays, []);
  } finally { absentContent.restore(); }
});

test('enrichment applies successful facts and wiki only when both acquisitions settle, in either order', async (t) => {
  const page = countryPage(t);
  for (const first of ['meta', 'wiki'] as const) {
    const calls: string[] = []; const meta = deferred<CountryMeta | null>(); const wiki = deferred<{ extract: string; pageUrl: string } | null>();
    (globalThis as Record<string, unknown>).__countryEnrichment = {
      meta: (code: string) => { calls.push(`meta:${code}`); return meta.promise; },
      wiki: (name: string) => { calls.push(`wiki:${name}`); return wiki.promise; },
    } satisfies Enrichment;
    page.show('Fixture', 'ZZ', null, emptySignals); assert.deepEqual(calls, ['meta:ZZ', 'wiki:Fixture']);
    if (first === 'meta') meta.resolve(metadata({ capital: 'Complete facts' }));
    else wiki.resolve({ extract: 'Complete overview', pageUrl: 'https://example.test/wiki' });
    await settleEnrichment();
    assert.equal(activePage().querySelector<HTMLElement>('.cb-facts-section')?.style.display, 'none');
    assert.equal(activePage().querySelector<HTMLElement>('.cb-wiki-section')?.style.display, 'none');
    if (first === 'meta') wiki.resolve({ extract: 'Complete overview', pageUrl: 'https://example.test/wiki' });
    else meta.resolve(metadata({ capital: 'Complete facts' }));
    await settleEnrichment(); assert.deepEqual(calls, ['meta:ZZ', 'wiki:Fixture']);
    assert.equal(activePage().querySelector<HTMLElement>('.cb-facts-section')?.style.display, '');
    assert.equal(activePage().querySelector<HTMLElement>('.cb-wiki-section')?.style.display, '');
    assert.match(activePage().textContent ?? '', /Complete facts/); assert.match(activePage().textContent ?? '', /Complete overview/);
  }
});

/**
 * Tests for FinancialCrimesPanel + financial-crimes-helpers.
 *
 * Run with: tsx --import ./tests/panels/register-hook.mjs --test tests/components/financial-crimes-panel.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const G = globalThis as unknown as Record<string, unknown>;
G.__viteImportMetaEnv = { DEV: false, PROD: false, MODE: 'test', BASE_URL: '/', VITE_VARIANT: 'full' };
G.__POSTHOG_DISABLED = true;

const happyWindow = new Window({ url: 'http://127.0.0.1:46123/' });
G.window = happyWindow;
G.document = happyWindow.document;
G.HTMLElement = happyWindow.HTMLElement;
G.HTMLDivElement = (happyWindow as unknown as Record<string, unknown>).HTMLDivElement ?? happyWindow.HTMLElement;
G.HTMLButtonElement = (happyWindow as unknown as Record<string, unknown>).HTMLButtonElement ?? happyWindow.HTMLElement;
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;
G.CustomEvent = happyWindow.CustomEvent;
G.DOMException = (happyWindow as unknown as Record<string, unknown>).DOMException;
G.MutationObserver = (happyWindow as unknown as Record<string, unknown>).MutationObserver;
G.AbortController = happyWindow.AbortController;
G.localStorage = happyWindow.localStorage;
G.sessionStorage = happyWindow.sessionStorage;
G.getComputedStyle = happyWindow.getComputedStyle?.bind(happyWindow) ?? (() => ({ getPropertyValue: () => '', display: '', visibility: '' }));
G.matchMedia = (happyWindow as unknown as Record<string, unknown>).matchMedia ?? (() => ({
  matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
}));
G.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
G.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as NodeJS.Timeout);

if (typeof G.IntersectionObserver !== 'function') {
  G.IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] { return []; }
  };
}
if (typeof G.ResizeObserver !== 'function') {
  G.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

G.fetch = () => Promise.resolve(new Response('{}', { status: 200 }));

import {
  FinancialCrimesPanel,
  type FinancialCrimesData,
} from '../../src/components/FinancialCrimesPanel.ts';
import {
  caseStatusColor,
  caseStatusLabel,
  ransomTrendColor,
  ransomTrendLabel,
  fatfStatusColor,
  fatfStatusLabel,
  deRiskingColor,
  deRiskingLabel,
  shellRiskColor,
  shellRiskLabel,
  tbmlPatternLabel,
  fiuTrendColor,
  fiuTrendLabel,
  countActiveLaunderingCases,
  countRisingCryptoCrimes,
  countListedJurisdictions,
  countExpandingDeRisking,
  countHighShellRisk,
  countSurgingFiuAlerts,
  LAUNDERING_CASES,
  CRYPTO_CRIME_EVENTS,
  FATF_STATUS,
  DERISKING_EVENTS,
  SHELL_JURISDICTIONS,
  TBML_SIGNALS,
  FIU_ALERTS,
  type LaunderingCase,
  type CryptoCrimeEvent,
  type FatfEntry,
  type DeRiskingEvent,
  type ShellJurisdiction,
  type TbmlSignal,
  type FiuAlert,
} from '../../src/components/financial-crimes-helpers.ts';

function makePanel(): FinancialCrimesPanel {
  return new FinancialCrimesPanel();
}

function emptyData(): FinancialCrimesData {
  return {
    launderingCases: [],
    cryptoCrimes: [],
    fatfStatus: [],
    deRiskingEvents: [],
    shellJurisdictions: [],
    tbmlSignals: [],
    fiuAlerts: [],
  };
}

// ── Panel identity ────────────────────────────────────────────────────────

test('panel has id financial-crimes', () => {
  assert.equal(makePanel().getPanelId(), 'financial-crimes');
});

test('panel element has data-panel attribute financial-crimes', () => {
  assert.equal(makePanel().getElement().dataset.panel, 'financial-crimes');
});

test('panel title contains Financial', () => {
  const t = makePanel().getElement().querySelector('.panel-title');
  assert.ok(t?.textContent?.includes('Financial'), `got "${t?.textContent}"`);
});

// ── Section headers ───────────────────────────────────────────────────────

test('buildHtml includes Major Money Laundering Cases section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Major Money Laundering Cases/);
});

test('buildHtml includes Crypto Crime & Ransomware section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Crypto Crime &amp; Ransomware Payment Tracking/);
});

test('buildHtml includes FATF Grey / Black List Status section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /FATF Grey \/ Black List Status/);
});

test('buildHtml includes Correspondent Banking De-Risking section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Correspondent Banking De-Risking Events/);
});

test('buildHtml includes Shell Company Jurisdiction Risk section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Shell Company Jurisdiction Risk/);
});

test('buildHtml includes Trade-Based Money Laundering Signals section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Trade-Based Money Laundering Signals/);
});

test('buildHtml includes FIU Alert Patterns section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Financial Intelligence Unit Alert Patterns/);
});

// ── Empty-state fallbacks ─────────────────────────────────────────────────

test('empty laundering data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No active laundering cases tracked/);
});

test('empty crypto crime data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No crypto crime events tracked/);
});

test('empty FATF data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No FATF status data/);
});

test('empty de-risking data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No correspondent banking de-risking activity/);
});

test('empty shell data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No shell company jurisdiction data/);
});

test('empty TBML data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No trade-based money laundering signals/);
});

test('empty FIU data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No FIU alert pattern data/);
});

// ── Row rendering ─────────────────────────────────────────────────────────

test('laundering row renders case name, jurisdiction, amount, status, predicate, notes', () => {
  const c: LaunderingCase = {
    caseName: 'TD Bank AML',
    jurisdiction: 'US / Canada',
    amountUsdMillions: 3000,
    status: 'convicted',
    predicateOffense: 'Fentanyl proceeds',
    notes: 'DOJ + FinCEN',
  };
  const html = makePanel().buildHtml({ ...emptyData(), launderingCases: [c] });
  assert.match(html, /TD Bank AML/);
  assert.match(html, /US \/ Canada/);
  assert.match(html, /\$3,000M/);
  assert.match(html, /Convicted/);
  assert.match(html, /predicate: Fentanyl proceeds/);
  assert.match(html, /DOJ \+ FinCEN/);
});

test('crypto row renders incident, asset, amount, actor, trend, notes', () => {
  const e: CryptoCrimeEvent = {
    incidentName: 'Bybit hack',
    cryptoAsset: 'ETH',
    amountUsdMillions: 1500,
    attributedActor: 'Lazarus',
    paymentTrend: 'rising',
    notes: 'Tornado Cash',
  };
  const html = makePanel().buildHtml({ ...emptyData(), cryptoCrimes: [e] });
  assert.match(html, /Bybit hack/);
  assert.match(html, /ETH/);
  assert.match(html, /\$1,500M/);
  assert.match(html, /actor: Lazarus/);
  assert.match(html, /↑ Rising/);
  assert.match(html, /Tornado Cash/);
});

test('FATF row renders jurisdiction, status, effective date, driver', () => {
  const e: FatfEntry = {
    jurisdiction: 'Nigeria',
    status: 'grey-list',
    effectiveDate: '2023-02-24',
    driver: 'DNFBP gaps',
  };
  const html = makePanel().buildHtml({ ...emptyData(), fatfStatus: [e] });
  assert.match(html, /Nigeria/);
  assert.match(html, /Grey List/);
  assert.match(html, /effective 2023-02-24/);
  assert.match(html, /DNFBP gaps/);
});

test('de-risking row renders corridor, direction, affected banks, notes', () => {
  const e: DeRiskingEvent = {
    corridor: 'US → Caribbean',
    direction: 'expanding',
    affectedBanks: 14,
    notes: 'JPM exits',
  };
  const html = makePanel().buildHtml({ ...emptyData(), deRiskingEvents: [e] });
  assert.match(html, /US → Caribbean/);
  assert.match(html, /Expanding/);
  assert.match(html, /14 banks affected/);
  assert.match(html, /JPM exits/);
});

test('shell row renders jurisdiction, risk, UBO registry, notes', () => {
  const j: ShellJurisdiction = {
    jurisdiction: 'BVI',
    risk: 'extreme',
    beneficialOwnerRegistry: 'private',
    notes: 'UBO delayed',
  };
  const html = makePanel().buildHtml({ ...emptyData(), shellJurisdictions: [j] });
  assert.match(html, /BVI/);
  assert.match(html, /risk Extreme/);
  assert.match(html, /UBO: private/);
  assert.match(html, /UBO delayed/);
});

test('TBML row renders corridor, pattern, commodity, amount, notes', () => {
  const s: TbmlSignal = {
    corridor: 'UAE → HK gold',
    pattern: 'over-invoicing',
    commodity: 'Gold',
    estimatedUsdMillions: 6500,
    notes: 'DMCC inflation',
  };
  const html = makePanel().buildHtml({ ...emptyData(), tbmlSignals: [s] });
  assert.match(html, /UAE → HK gold/);
  assert.match(html, /Over-Invoicing/);
  assert.match(html, /Gold/);
  assert.match(html, /\$6,500M est\./);
  assert.match(html, /DMCC inflation/);
});

test('FIU row renders FIU name, category, trend, filings, notes', () => {
  const a: FiuAlert = {
    fiu: 'FinCEN',
    alertCategory: 'Fentanyl precursor',
    trend: 'surging',
    filingsLast30d: 1240,
    notes: 'SAR keyword 340%',
  };
  const html = makePanel().buildHtml({ ...emptyData(), fiuAlerts: [a] });
  assert.match(html, /FinCEN/);
  assert.match(html, /Fentanyl precursor/);
  assert.match(html, /⤴ Surging/);
  assert.match(html, /1,240 filings \/ 30d/);
  assert.match(html, /SAR keyword 340%/);
});

// ── Helper: case status ───────────────────────────────────────────────────

test('caseStatusLabel maps every variant', () => {
  assert.equal(caseStatusLabel('investigation'), 'Investigation');
  assert.equal(caseStatusLabel('indicted'), 'Indicted');
  assert.equal(caseStatusLabel('settled'), 'Settled');
  assert.equal(caseStatusLabel('convicted'), 'Convicted');
});

test('caseStatusColor: convicted is critical, settled is low', () => {
  assert.match(caseStatusColor('convicted'), /severity-critical/);
  assert.match(caseStatusColor('settled'), /severity-low/);
});

// ── Helper: ransom trend ──────────────────────────────────────────────────

test('ransomTrendLabel includes directional arrow', () => {
  assert.match(ransomTrendLabel('rising'), /↑/);
  assert.match(ransomTrendLabel('stable'), /→/);
  assert.match(ransomTrendLabel('falling'), /↓/);
});

test('ransomTrendColor: rising is critical, falling is low', () => {
  assert.match(ransomTrendColor('rising'), /severity-critical/);
  assert.match(ransomTrendColor('falling'), /severity-low/);
});

// ── Helper: FATF status ───────────────────────────────────────────────────

test('fatfStatusLabel maps every variant', () => {
  assert.equal(fatfStatusLabel('compliant'), 'Compliant');
  assert.equal(fatfStatusLabel('enhanced-monitoring'), 'Enhanced Monitoring');
  assert.equal(fatfStatusLabel('grey-list'), 'Grey List');
  assert.equal(fatfStatusLabel('black-list'), 'Black List');
});

test('fatfStatusColor: black-list is critical, compliant is low', () => {
  assert.match(fatfStatusColor('black-list'), /severity-critical/);
  assert.match(fatfStatusColor('compliant'), /severity-low/);
});

// ── Helper: de-risking ────────────────────────────────────────────────────

test('deRiskingLabel maps every direction', () => {
  assert.equal(deRiskingLabel('expanding'), 'Expanding');
  assert.equal(deRiskingLabel('reciprocal'), 'Reciprocal');
  assert.equal(deRiskingLabel('easing'), 'Easing');
});

test('deRiskingColor: expanding is critical, easing is low', () => {
  assert.match(deRiskingColor('expanding'), /severity-critical/);
  assert.match(deRiskingColor('easing'), /severity-low/);
});

// ── Helper: shell risk ────────────────────────────────────────────────────

test('shellRiskLabel maps every variant', () => {
  assert.equal(shellRiskLabel('low'), 'Low');
  assert.equal(shellRiskLabel('medium'), 'Medium');
  assert.equal(shellRiskLabel('high'), 'High');
  assert.equal(shellRiskLabel('extreme'), 'Extreme');
});

test('shellRiskColor: extreme is critical, low is low', () => {
  assert.match(shellRiskColor('extreme'), /severity-critical/);
  assert.match(shellRiskColor('low'), /severity-low/);
});

// ── Helper: TBML pattern ──────────────────────────────────────────────────

test('tbmlPatternLabel maps every pattern', () => {
  assert.equal(tbmlPatternLabel('over-invoicing'), 'Over-Invoicing');
  assert.equal(tbmlPatternLabel('under-invoicing'), 'Under-Invoicing');
  assert.equal(tbmlPatternLabel('multiple-invoicing'), 'Multiple-Invoicing');
  assert.equal(tbmlPatternLabel('phantom-shipment'), 'Phantom Shipment');
  assert.equal(tbmlPatternLabel('misclassification'), 'Misclassification');
});

// ── Helper: FIU trend ─────────────────────────────────────────────────────

test('fiuTrendLabel maps every variant with arrow', () => {
  assert.match(fiuTrendLabel('declining'), /↓/);
  assert.match(fiuTrendLabel('flat'), /→/);
  assert.match(fiuTrendLabel('rising'), /↑/);
  assert.match(fiuTrendLabel('surging'), /⤴/);
});

test('fiuTrendColor: surging is critical, declining is low', () => {
  assert.match(fiuTrendColor('surging'), /severity-critical/);
  assert.match(fiuTrendColor('declining'), /severity-low/);
});

// ── Count aggregations ────────────────────────────────────────────────────

test('countActiveLaunderingCases counts investigation + indicted', () => {
  const list: LaunderingCase[] = [
    { caseName: 'A', jurisdiction: '', amountUsdMillions: 1, status: 'investigation', predicateOffense: '', notes: '' },
    { caseName: 'B', jurisdiction: '', amountUsdMillions: 1, status: 'indicted',      predicateOffense: '', notes: '' },
    { caseName: 'C', jurisdiction: '', amountUsdMillions: 1, status: 'settled',       predicateOffense: '', notes: '' },
    { caseName: 'D', jurisdiction: '', amountUsdMillions: 1, status: 'convicted',     predicateOffense: '', notes: '' },
  ];
  assert.equal(countActiveLaunderingCases(list), 2);
});

test('countRisingCryptoCrimes counts only rising', () => {
  const list: CryptoCrimeEvent[] = [
    { incidentName: 'A', cryptoAsset: '', amountUsdMillions: 1, attributedActor: '', paymentTrend: 'rising',  notes: '' },
    { incidentName: 'B', cryptoAsset: '', amountUsdMillions: 1, attributedActor: '', paymentTrend: 'rising',  notes: '' },
    { incidentName: 'C', cryptoAsset: '', amountUsdMillions: 1, attributedActor: '', paymentTrend: 'stable',  notes: '' },
    { incidentName: 'D', cryptoAsset: '', amountUsdMillions: 1, attributedActor: '', paymentTrend: 'falling', notes: '' },
  ];
  assert.equal(countRisingCryptoCrimes(list), 2);
});

test('countListedJurisdictions counts grey-list + black-list', () => {
  const list: FatfEntry[] = [
    { jurisdiction: 'A', status: 'compliant',             effectiveDate: '', driver: '' },
    { jurisdiction: 'B', status: 'enhanced-monitoring',   effectiveDate: '', driver: '' },
    { jurisdiction: 'C', status: 'grey-list',             effectiveDate: '', driver: '' },
    { jurisdiction: 'D', status: 'black-list',            effectiveDate: '', driver: '' },
  ];
  assert.equal(countListedJurisdictions(list), 2);
});

test('countExpandingDeRisking counts only expanding', () => {
  const list: DeRiskingEvent[] = [
    { corridor: 'A', direction: 'expanding',  affectedBanks: 1, notes: '' },
    { corridor: 'B', direction: 'expanding',  affectedBanks: 1, notes: '' },
    { corridor: 'C', direction: 'easing',     affectedBanks: 1, notes: '' },
    { corridor: 'D', direction: 'reciprocal', affectedBanks: 1, notes: '' },
  ];
  assert.equal(countExpandingDeRisking(list), 2);
});

test('countHighShellRisk counts high + extreme', () => {
  const list: ShellJurisdiction[] = [
    { jurisdiction: 'A', risk: 'low',     beneficialOwnerRegistry: 'public',  notes: '' },
    { jurisdiction: 'B', risk: 'medium',  beneficialOwnerRegistry: 'public',  notes: '' },
    { jurisdiction: 'C', risk: 'high',    beneficialOwnerRegistry: 'private', notes: '' },
    { jurisdiction: 'D', risk: 'extreme', beneficialOwnerRegistry: 'none',    notes: '' },
  ];
  assert.equal(countHighShellRisk(list), 2);
});

test('countSurgingFiuAlerts counts only surging', () => {
  const list: FiuAlert[] = [
    { fiu: 'A', alertCategory: '', trend: 'declining', filingsLast30d: 1, notes: '' },
    { fiu: 'B', alertCategory: '', trend: 'flat',      filingsLast30d: 1, notes: '' },
    { fiu: 'C', alertCategory: '', trend: 'rising',    filingsLast30d: 1, notes: '' },
    { fiu: 'D', alertCategory: '', trend: 'surging',   filingsLast30d: 1, notes: '' },
    { fiu: 'E', alertCategory: '', trend: 'surging',   filingsLast30d: 1, notes: '' },
  ];
  assert.equal(countSurgingFiuAlerts(list), 2);
});

// ── Static datasets sanity ────────────────────────────────────────────────

test('static datasets are non-empty', () => {
  assert.ok(LAUNDERING_CASES.length > 0);
  assert.ok(CRYPTO_CRIME_EVENTS.length > 0);
  assert.ok(FATF_STATUS.length > 0);
  assert.ok(DERISKING_EVENTS.length > 0);
  assert.ok(SHELL_JURISDICTIONS.length > 0);
  assert.ok(TBML_SIGNALS.length > 0);
  assert.ok(FIU_ALERTS.length > 0);
});

test('FATF dataset includes Iran, DPRK, Myanmar on black list', () => {
  const blacks = new Set(FATF_STATUS.filter((e) => e.status === 'black-list').map((e) => e.jurisdiction));
  for (const j of ['Iran', 'DPRK', 'Myanmar']) assert.ok(blacks.has(j), `expected ${j} on FATF black list`);
});

// ── XSS prevention ────────────────────────────────────────────────────────

test('XSS: case name is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    launderingCases: [{
      caseName: '<script>x</script>', jurisdiction: '', amountUsdMillions: 1,
      status: 'settled', predicateOffense: '', notes: '',
    }],
  });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('XSS: crypto actor is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    cryptoCrimes: [{
      incidentName: '', cryptoAsset: '', amountUsdMillions: 1,
      attributedActor: '"><img src=x onerror=alert(1)>',
      paymentTrend: 'stable', notes: '',
    }],
  });
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;img/);
});

test('XSS: FATF driver is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    fatfStatus: [{ jurisdiction: '', status: 'compliant', effectiveDate: '', driver: '<iframe src=evil></iframe>' }],
  });
  assert.doesNotMatch(html, /<iframe/);
});

// ── refresh() defensive behavior ──────────────────────────────────────────

test('refresh() with no args uses static defaults and does not throw', () => {
  assert.doesNotThrow(() => makePanel().refresh());
});

test('refresh() with a throwing accessor falls back to defaults', () => {
  const panel = makePanel();
  const bad = {
    get launderingCases(): LaunderingCase[] { throw new Error('upstream'); },
    cryptoCrimes: [] as CryptoCrimeEvent[],
    fatfStatus: [] as FatfEntry[],
    deRiskingEvents: [] as DeRiskingEvent[],
    shellJurisdictions: [] as ShellJurisdiction[],
    tbmlSignals: [] as TbmlSignal[],
    fiuAlerts: [] as FiuAlert[],
  } satisfies FinancialCrimesData;
  assert.doesNotThrow(() => panel.refresh(bad));
});

// ── Count badge ───────────────────────────────────────────────────────────

test('setCount sums across all 6 stress surfaces', () => {
  const panel = makePanel();
  let lastCount = -1;
  const orig = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; orig(n); };
  panel.refresh({
    launderingCases: [
      { caseName: 'A', jurisdiction: '', amountUsdMillions: 1, status: 'investigation', predicateOffense: '', notes: '' },
    ], // +1
    cryptoCrimes: [
      { incidentName: 'A', cryptoAsset: '', amountUsdMillions: 1, attributedActor: '', paymentTrend: 'rising', notes: '' },
      { incidentName: 'B', cryptoAsset: '', amountUsdMillions: 1, attributedActor: '', paymentTrend: 'rising', notes: '' },
    ], // +2
    fatfStatus: [
      { jurisdiction: 'A', status: 'grey-list',   effectiveDate: '', driver: '' },
      { jurisdiction: 'B', status: 'black-list',  effectiveDate: '', driver: '' },
    ], // +2
    deRiskingEvents: [
      { corridor: 'A', direction: 'expanding', affectedBanks: 1, notes: '' },
    ], // +1
    shellJurisdictions: [
      { jurisdiction: 'A', risk: 'extreme', beneficialOwnerRegistry: 'none', notes: '' },
    ], // +1
    tbmlSignals: [],
    fiuAlerts: [
      { fiu: 'A', alertCategory: '', trend: 'surging', filingsLast30d: 1, notes: '' },
    ], // +1
  });
  assert.equal(lastCount, 8);
});

test('setCount is 0 when all surfaces are healthy', () => {
  const panel = makePanel();
  let lastCount = -1;
  const orig = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; orig(n); };
  panel.refresh({
    launderingCases: [
      { caseName: 'A', jurisdiction: '', amountUsdMillions: 1, status: 'settled', predicateOffense: '', notes: '' },
    ],
    cryptoCrimes: [
      { incidentName: 'A', cryptoAsset: '', amountUsdMillions: 1, attributedActor: '', paymentTrend: 'falling', notes: '' },
    ],
    fatfStatus: [
      { jurisdiction: 'A', status: 'compliant', effectiveDate: '', driver: '' },
    ],
    deRiskingEvents: [
      { corridor: 'A', direction: 'easing', affectedBanks: 1, notes: '' },
    ],
    shellJurisdictions: [
      { jurisdiction: 'A', risk: 'low', beneficialOwnerRegistry: 'public', notes: '' },
    ],
    tbmlSignals: [],
    fiuAlerts: [
      { fiu: 'A', alertCategory: '', trend: 'declining', filingsLast30d: 1, notes: '' },
    ],
  });
  assert.equal(lastCount, 0);
});

// ── Lifecycle ─────────────────────────────────────────────────────────────

test('destroy() does not throw', () => {
  assert.doesNotThrow(() => makePanel().destroy());
});

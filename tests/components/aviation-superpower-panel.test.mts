/**
 * Tests for AviationSuperpowerPanel.
 *
 * Run with: tsx --import ./tests/panels/register-hook.mjs --test tests/components/aviation-superpower-panel.test.mts
 * The register-hook strips Vite-only imports (?worker, ?url) so Panel.ts resolves under Node.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

// ── Vite env shim (register-hook.mjs rewrites import.meta.env refs) ───
const G = globalThis as unknown as Record<string, unknown>;
G.__viteImportMetaEnv = { DEV: false, PROD: false, MODE: 'test', BASE_URL: '/', VITE_VARIANT: 'full' };
G.__POSTHOG_DISABLED = true;

// ── happy-dom for DOM APIs required by Panel base class ────────────────
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

// No-op fetch so Panel's async summary feature doesn't reach the network
G.fetch = () => Promise.resolve(new Response('{}', { status: 200 }));

import {
  AviationSuperpowerPanel,
  type SquawkEntry,
  type AirspaceRestriction,
  type ConflictOverflightRisk,
  type AshAdvisory,
  type DiversionEntry,
  type AviationSuperpowerData,
} from '../../src/components/AviationSuperpowerPanel.ts';

function makePanel(): AviationSuperpowerPanel {
  return new AviationSuperpowerPanel();
}

function makeSquawk(overrides: Partial<SquawkEntry> = {}): SquawkEntry {
  return {
    callsign: 'UAL123',
    squawkCode: '7700',
    altitude: 35000,
    lat: 41.9,
    lon: -87.6,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeRestriction(overrides: Partial<AirspaceRestriction> = {}): AirspaceRestriction {
  return {
    id: 'TFR-001',
    type: 'TFR',
    name: 'Presidential TFR',
    region: 'Washington DC',
    activeUntil: 1_700_100_000_000,
    ...overrides,
  };
}

function makeConflictZone(overrides: Partial<ConflictOverflightRisk> = {}): ConflictOverflightRisk {
  return {
    region: 'Eastern Ukraine',
    riskLevel: 'CRITICAL',
    activeConflicts: 3,
    recommendation: 'Avoid completely',
    ...overrides,
  };
}

function makeAshAdvisory(overrides: Partial<AshAdvisory> = {}): AshAdvisory {
  return {
    volcanoName: 'Etna',
    severity: 'HIGH',
    affectedFlightLevels: 'FL200-FL350',
    region: 'Mediterranean',
    ...overrides,
  };
}

function makeDiversion(overrides: Partial<DiversionEntry> = {}): DiversionEntry {
  return {
    airport: "Chicago O'Hare",
    iata: 'ORD',
    reason: 'Ground stop — thunderstorms',
    delayMinutes: 120,
    diversionCount: 14,
    ...overrides,
  };
}

function emptyData(): AviationSuperpowerData {
  return { squawks: [], restrictions: [], conflictZones: [], ashAdvisories: [], diversions: [] };
}

// ── Panel identity ─────────────────────────────────────────────────────

test('panel has id aviation-superpower', () => {
  const panel = makePanel();
  assert.equal(panel.getPanelId(), 'aviation-superpower');
});

test('panel element has data-panel attribute set to aviation-superpower', () => {
  const panel = makePanel();
  assert.equal(panel.getElement().dataset.panel, 'aviation-superpower');
});

test('panel title text contains Aviation', () => {
  const panel = makePanel();
  const titleEl = panel.getElement().querySelector('.panel-title');
  assert.ok(titleEl?.textContent?.includes('Aviation'), `expected title to include "Aviation", got "${titleEl?.textContent}"`);
});

// ── Section headers ────────────────────────────────────────────────────

test('buildHtml includes Emergency Squawk Tracker section', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /Emergency Squawk/i);
});

test('buildHtml includes Airspace Restrictions section', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /Airspace Restriction/i);
});

test('buildHtml includes Conflict Zone Overflight Risk section', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /Conflict Zone/i);
});

test('buildHtml includes Volcanic Ash Advisory section', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /Volcanic Ash/i);
});

test('buildHtml includes Diversion and Delay Index section', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /Diversion|Delay/i);
});

// ── Squawk section data ────────────────────────────────────────────────

test('buildHtml renders squawk callsign and code', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), squawks: [makeSquawk({ callsign: 'UAL123', squawkCode: '7700' })] });
  assert.match(html, /UAL123/);
  assert.match(html, /7700/);
});

test('buildHtml renders empty squawk state fallback text', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /No active emergency squawk/i);
});

test('buildHtml renders multiple squawk entries', () => {
  const panel = makePanel();
  const html = panel.buildHtml({
    ...emptyData(),
    squawks: [makeSquawk({ callsign: 'AAL456', squawkCode: '7700' }), makeSquawk({ callsign: 'DAL789', squawkCode: '7600' })],
  });
  assert.match(html, /AAL456/);
  assert.match(html, /DAL789/);
});

// ── Airspace Restrictions section data ────────────────────────────────

test('buildHtml renders restriction name and type', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), restrictions: [makeRestriction({ name: 'Presidential TFR', type: 'TFR' })] });
  assert.match(html, /Presidential TFR/);
  assert.match(html, /TFR/);
});

test('buildHtml renders empty restrictions fallback text', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /No active restriction/i);
});

// ── Conflict Zone section data ─────────────────────────────────────────

test('buildHtml renders conflict zone region and risk level', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), conflictZones: [makeConflictZone({ region: 'Eastern Ukraine', riskLevel: 'CRITICAL' })] });
  assert.match(html, /Eastern Ukraine/);
  assert.match(html, /CRITICAL/);
});

test('buildHtml renders empty conflict zones fallback text', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /No active conflict/i);
});

test('buildHtml renders conflict zone recommendation', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), conflictZones: [makeConflictZone({ recommendation: 'Avoid completely' })] });
  assert.match(html, /Avoid completely/);
});

// ── Volcanic Ash Advisory section data ────────────────────────────────

test('buildHtml renders ash advisory volcano name and severity', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), ashAdvisories: [makeAshAdvisory({ volcanoName: 'Etna', severity: 'HIGH' })] });
  assert.match(html, /Etna/);
  assert.match(html, /HIGH/);
});

test('buildHtml renders ash advisory affected flight levels', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), ashAdvisories: [makeAshAdvisory({ affectedFlightLevels: 'FL200-FL350' })] });
  assert.match(html, /FL200-FL350/);
});

test('buildHtml renders empty ash advisories fallback text', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /No active ash advisor/i);
});

// ── Diversion & Delay Index section data ──────────────────────────────

test('buildHtml renders diversion airport and delay minutes', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), diversions: [makeDiversion({ airport: 'Dallas Fort Worth', iata: 'DFW', delayMinutes: 120 })] });
  assert.match(html, /Dallas Fort Worth/);
  assert.match(html, /120/);
});

test('buildHtml renders diversion reason', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), diversions: [makeDiversion({ reason: 'Ground stop — thunderstorms' })] });
  assert.match(html, /thunderstorm/i);
});

test('buildHtml renders empty diversions fallback text', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /No active diversion/i);
});

// ── XSS prevention ────────────────────────────────────────────────────

test('escapeHtml: XSS payload in callsign is escaped', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), squawks: [makeSquawk({ callsign: '<script>alert(1)</script>' })] });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('escapeHtml: XSS payload in restriction name is escaped', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), restrictions: [makeRestriction({ name: '"><img src=x onerror=alert(1)>' })] });
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;img/);
});

test('escapeHtml: XSS payload in conflict zone region is escaped', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), conflictZones: [makeConflictZone({ region: '<b onmouseover="evil()">Zone</b>' })] });
  assert.doesNotMatch(html, /<b onmouseover/);
  assert.match(html, /&lt;b/);
});

test('escapeHtml: XSS payload in volcano name is escaped', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), ashAdvisories: [makeAshAdvisory({ volcanoName: '<iframe src="evil"></iframe>' })] });
  assert.doesNotMatch(html, /<iframe/);
});

test('escapeHtml: XSS payload in airport name is escaped', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), diversions: [makeDiversion({ airport: '<svg onload="alert(1)">' })] });
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /&lt;svg/);
});

// ── safe() defensive wrapping ─────────────────────────────────────────

test('refresh() does not throw when called with no args', () => {
  const panel = makePanel();
  assert.doesNotThrow(() => { panel.refresh(); });
});

test('refresh() does not throw when a data field accessor throws', () => {
  const panel = makePanel();
  const badData = {
    get squawks(): SquawkEntry[] { throw new Error('source unavailable'); },
    restrictions: [] as AirspaceRestriction[],
    conflictZones: [] as ConflictOverflightRisk[],
    ashAdvisories: [] as AshAdvisory[],
    diversions: [] as DiversionEntry[],
  } satisfies AviationSuperpowerData;
  assert.doesNotThrow(() => { panel.refresh(badData); });
});

// ── Count tracking ────────────────────────────────────────────────────

test('setCount is called with number of 7700/7600/7500 squawks after refresh', () => {
  const panel = makePanel();
  let lastCount = -1;
  const origSetCount = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; origSetCount(n); };
  panel.refresh({
    ...emptyData(),
    squawks: [makeSquawk({ squawkCode: '7700' }), makeSquawk({ squawkCode: '7600' }), makeSquawk({ squawkCode: '1234' })],
  });
  assert.equal(lastCount, 2);
});

test('setCount is 0 when no emergency squawks are present', () => {
  const panel = makePanel();
  let lastCount = -1;
  const origSetCount = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; origSetCount(n); };
  panel.refresh({ ...emptyData(), squawks: [makeSquawk({ squawkCode: '1200' })] });
  assert.equal(lastCount, 0);
});

test('squawk code 7500 (hijack) is counted as an emergency squawk', () => {
  const panel = makePanel();
  let lastCount = -1;
  const origSetCount = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; origSetCount(n); };
  panel.refresh({ ...emptyData(), squawks: [makeSquawk({ squawkCode: '7500' })] });
  assert.equal(lastCount, 1);
});

// ── Lifecycle ─────────────────────────────────────────────────────────

test('destroy() does not throw', () => {
  const panel = makePanel();
  assert.doesNotThrow(() => { panel.destroy(); });
});

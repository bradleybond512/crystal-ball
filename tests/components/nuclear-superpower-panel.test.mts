/**
 * Tests for NuclearSuperpowerPanel.
 *
 * Run with: tsx --import ./tests/panels/register-hook.mjs --test tests/components/nuclear-superpower-panel.test.mts
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
  NuclearSuperpowerPanel,
  type NuclearIncident,
  type RadiationRelease,
  type NuclearThreat,
  type FacilityRisk,
  type NonProliferationEntry,
  type NuclearSuperpowerData,
} from '../../src/components/NuclearSuperpowerPanel.ts';

function makePanel(): NuclearSuperpowerPanel {
  return new NuclearSuperpowerPanel();
}

function makeIncident(overrides: Partial<NuclearIncident> = {}): NuclearIncident {
  return {
    facilityName: 'Zaporizhzhia NPP',
    country: 'Ukraine',
    inesLevel: 4,
    status: 'ongoing',
    onsetTimestamp: Date.now() - 3_600_000,
    ...overrides,
  };
}

function makeRelease(overrides: Partial<RadiationRelease> = {}): RadiationRelease {
  return {
    detectionPoint: 'Pripyat exclusion zone — sensor 12',
    doseRateMicroSvPerHour: 250,
    plumeDirection: 'NNE',
    affectedRadiusKm: 30,
    evacuationZoneKm: 10,
    ...overrides,
  };
}

function makeThreat(overrides: Partial<NuclearThreat> = {}): NuclearThreat {
  return {
    stateActor: 'DPRK',
    type: 'test',
    threatLevel: 'HIGH',
    diplomaticStatus: 'strained',
    unResolutionStatus: 'proposed',
    ...overrides,
  };
}

function makeFacility(overrides: Partial<FacilityRisk> = {}): FacilityRisk {
  return {
    region: 'Europe',
    riskScore: 3,
    facilityCount: 109,
    ...overrides,
  };
}

function makeNpEntry(overrides: Partial<NonProliferationEntry> = {}): NonProliferationEntry {
  return {
    state: 'Iran',
    treaty: 'JCPOA',
    status: 'concerns',
    inspectionStatus: 'overdue',
    ...overrides,
  };
}

function emptyData(): NuclearSuperpowerData {
  return { incidents: [], releases: [], threats: [], facilities: [], nonProliferation: [] };
}

// ── Panel identity ─────────────────────────────────────────────────────

test('panel has id nuclear-superpower', () => {
  const panel = makePanel();
  assert.equal(panel.getPanelId(), 'nuclear-superpower');
});

test('panel element has data-panel attribute set to nuclear-superpower', () => {
  const panel = makePanel();
  assert.equal(panel.getElement().dataset.panel, 'nuclear-superpower');
});

test('panel title text contains Nuclear', () => {
  const panel = makePanel();
  const titleEl = panel.getElement().querySelector('.panel-title');
  assert.ok(titleEl?.textContent?.includes('Nuclear'), `expected title to include "Nuclear", got "${titleEl?.textContent}"`);
});

// ── Section headers ────────────────────────────────────────────────────

test('buildHtml includes Global Incident Monitor section', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /Global Incident Monitor/i);
});

test('buildHtml includes Radiation Release Tracker section', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /Radiation Release Tracker/i);
});

test('buildHtml includes Nuclear Threat Watch section', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /Nuclear Threat Watch/i);
});

test('buildHtml includes Facility Risk Map section', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /Facility Risk Map/i);
});

test('buildHtml includes Non-Proliferation Status section', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /Non-Proliferation Status/i);
});

// ── Incident section data ──────────────────────────────────────────────

test('buildHtml renders facility name and country', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), incidents: [makeIncident({ facilityName: 'Fukushima Daiichi', country: 'Japan' })] });
  assert.match(html, /Fukushima Daiichi/);
  assert.match(html, /Japan/);
});

test('buildHtml renders INES level numeric label', () => {
  const html = makePanel().buildHtml({ ...emptyData(), incidents: [makeIncident({ inesLevel: 7 })] });
  assert.match(html, /INES 7/);
  assert.match(html, /Major Accident/i);
});

test('buildHtml renders incident status text', () => {
  const html = makePanel().buildHtml({ ...emptyData(), incidents: [makeIncident({ status: 'emergency' })] });
  assert.match(html, /emergency/);
});

test('buildHtml renders empty incidents fallback text', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /No active nuclear incidents/i);
});

test('buildHtml renders multiple incidents', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    incidents: [
      makeIncident({ facilityName: 'Plant A' }),
      makeIncident({ facilityName: 'Plant B' }),
    ],
  });
  assert.match(html, /Plant A/);
  assert.match(html, /Plant B/);
});

// ── Radiation release section data ────────────────────────────────────

test('buildHtml renders detection point and dose rate', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    releases: [makeRelease({ detectionPoint: 'Tokyo Bay sensor 4', doseRateMicroSvPerHour: 1250 })],
  });
  assert.match(html, /Tokyo Bay sensor 4/);
  assert.match(html, /1,250/);
  assert.match(html, /µSv\/h/);
});

test('buildHtml renders plume direction', () => {
  const html = makePanel().buildHtml({ ...emptyData(), releases: [makeRelease({ plumeDirection: 'SW' })] });
  assert.match(html, /plume SW/);
});

test('buildHtml renders affected radius and evacuation zone', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    releases: [makeRelease({ affectedRadiusKm: 50, evacuationZoneKm: 20 })],
  });
  assert.match(html, /radius 50 km/);
  assert.match(html, /evac 20 km/);
});

test('buildHtml renders empty releases fallback text', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /No detected radiation releases/i);
});

// ── Threat section data ───────────────────────────────────────────────

test('buildHtml renders state actor and threat type', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    threats: [makeThreat({ stateActor: 'Russia', type: 'deployment' })],
  });
  assert.match(html, /Russia/);
  assert.match(html, /deployment/);
});

test('buildHtml renders threat level text', () => {
  const html = makePanel().buildHtml({ ...emptyData(), threats: [makeThreat({ threatLevel: 'CRITICAL' })] });
  assert.match(html, /CRITICAL/);
});

test('buildHtml renders diplomatic and UN status', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    threats: [makeThreat({ diplomaticStatus: 'severed', unResolutionStatus: 'vetoed' })],
  });
  assert.match(html, /diplomacy: severed/);
  assert.match(html, /UN: vetoed/);
});

test('buildHtml renders empty threats fallback text', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /No active nuclear threats/i);
});

// ── Facility Risk section data ────────────────────────────────────────

test('buildHtml renders facility region and risk score', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    facilities: [makeFacility({ region: 'South Asia', riskScore: 4 })],
  });
  assert.match(html, /South Asia/);
  assert.match(html, /risk 4\/4/);
});

test('buildHtml renders facility count', () => {
  const html = makePanel().buildHtml({ ...emptyData(), facilities: [makeFacility({ facilityCount: 1234 })] });
  assert.match(html, /1,234 facilities/);
});

test('buildHtml renders empty facility data fallback text', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /No facility risk data/i);
});

// ── Non-Proliferation section data ────────────────────────────────────

test('buildHtml renders state and treaty', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    nonProliferation: [makeNpEntry({ state: 'Russia', treaty: 'New START' })],
  });
  assert.match(html, /Russia/);
  assert.match(html, /New START/);
});

test('buildHtml renders compliance status and IAEA inspection status', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    nonProliferation: [makeNpEntry({ status: 'withdrawn', inspectionStatus: 'denied' })],
  });
  assert.match(html, /withdrawn/);
  assert.match(html, /IAEA: denied/);
});

test('buildHtml renders optional note when present', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    nonProliferation: [makeNpEntry({ note: 'Snap inspection denied 2026-04-12' })],
  });
  assert.match(html, /Snap inspection denied 2026-04-12/);
});

test('buildHtml omits note element when not provided', () => {
  const entry = makeNpEntry();
  delete entry.note;
  const html = makePanel().buildHtml({ ...emptyData(), nonProliferation: [entry] });
  assert.doesNotMatch(html, /nsp-note/);
});

test('buildHtml renders empty non-proliferation fallback text', () => {
  const html = makePanel().buildHtml(emptyData());
  assert.match(html, /No non-proliferation status data/i);
});

// ── XSS prevention ────────────────────────────────────────────────────

test('escapeHtml: XSS payload in facility name is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    incidents: [makeIncident({ facilityName: '<script>alert(1)</script>' })],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('escapeHtml: XSS payload in detection point is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    releases: [makeRelease({ detectionPoint: '"><img src=x onerror=alert(1)>' })],
  });
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;img/);
});

test('escapeHtml: XSS payload in state actor is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    threats: [makeThreat({ stateActor: '<b onmouseover="evil()">Bad</b>' })],
  });
  assert.doesNotMatch(html, /<b onmouseover/);
  assert.match(html, /&lt;b/);
});

test('escapeHtml: XSS payload in non-proliferation note is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    nonProliferation: [makeNpEntry({ note: '<iframe src="evil"></iframe>' })],
  });
  assert.doesNotMatch(html, /<iframe/);
});

// ── safe() defensive wrapping ─────────────────────────────────────────

test('refresh() does not throw when called with no args', () => {
  const panel = makePanel();
  assert.doesNotThrow(() => { panel.refresh(); });
});

test('refresh() does not throw when a data field accessor throws', () => {
  const panel = makePanel();
  const badData = {
    get incidents(): NuclearIncident[] { throw new Error('source unavailable'); },
    releases: [] as RadiationRelease[],
    threats: [] as NuclearThreat[],
    facilities: [] as FacilityRisk[],
    nonProliferation: [] as NonProliferationEntry[],
  } satisfies NuclearSuperpowerData;
  assert.doesNotThrow(() => { panel.refresh(badData); });
});

// ── Count tracking ────────────────────────────────────────────────────

test('setCount equals the number of active (ongoing+emergency) incidents after refresh', () => {
  const panel = makePanel();
  let lastCount = -1;
  const origSetCount = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; origSetCount(n); };
  panel.refresh({
    ...emptyData(),
    incidents: [
      makeIncident({ status: 'emergency' }),
      makeIncident({ status: 'ongoing' }),
      makeIncident({ status: 'contained' }),
    ],
  });
  assert.equal(lastCount, 2);
});

test('setCount is 0 when only contained incidents are present', () => {
  const panel = makePanel();
  let lastCount = -1;
  const origSetCount = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; origSetCount(n); };
  panel.refresh({ ...emptyData(), incidents: [makeIncident({ status: 'contained' })] });
  assert.equal(lastCount, 0);
});

test('setCount is 0 when no incidents are present', () => {
  const panel = makePanel();
  let lastCount = -1;
  const origSetCount = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; origSetCount(n); };
  panel.refresh(emptyData());
  assert.equal(lastCount, 0);
});

// ── Lifecycle ─────────────────────────────────────────────────────────

test('destroy() does not throw', () => {
  const panel = makePanel();
  assert.doesNotThrow(() => { panel.destroy(); });
});

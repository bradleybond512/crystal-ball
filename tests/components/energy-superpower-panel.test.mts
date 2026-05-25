/**
 * Tests for EnergySuperpowerPanel.
 *
 * Run with: tsx --import ./tests/panels/register-hook.mjs --test tests/components/energy-superpower-panel.test.mts
 * The register-hook strips Vite-only imports (?worker, ?url) so Panel.ts resolves under Node.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

// ── Vite env shim ─────────────────────────────────────────────────────────
const G = globalThis as unknown as Record<string, unknown>;
G.__viteImportMetaEnv = { DEV: false, PROD: false, MODE: 'test', BASE_URL: '/', VITE_VARIANT: 'full' };
G.__POSTHOG_DISABLED = true;

// ── happy-dom for DOM APIs required by Panel base class ───────────────────
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
  EnergySuperpowerPanel,
  type GridStressIndex,
  type PowerOutage,
  type PipelineWatch,
  type EnergySupplyChain,
  type InfrastructureRiskRegion,
  type EnergySuperpowerData,
} from '../../src/components/EnergySuperpowerPanel.ts';

function makePanel(): EnergySuperpowerPanel { return new EnergySuperpowerPanel(); }

function makeGridStress(overrides: Partial<GridStressIndex> = {}): GridStressIndex {
  return { score: 30, tier: 'elevated', activeOutages: 2, pipelineDisruptions: 1, refineryIncidents: 0, ...overrides };
}

function makeOutage(overrides: Partial<PowerOutage> = {}): PowerOutage {
  return { id: 'OUT-1', region: 'Texas', customersAffected: 50000, cause: 'storm', ...overrides };
}

function makePipeline(overrides: Partial<PipelineWatch> = {}): PipelineWatch {
  return { id: 'PIPE-1', pipelineName: 'Colonial Pipeline', type: 'oil', disruptionType: 'shutdown', affectedCapacity: 500000, capacityUnit: 'bpd', ...overrides };
}

function makeSupplyChain(overrides: Partial<EnergySupplyChain> = {}): EnergySupplyChain {
  return { sprLevelPct: 60, importDependencyFlags: [], priceStressIndicators: [], ...overrides };
}

function makeInfraRisk(overrides: Partial<InfrastructureRiskRegion> = {}): InfrastructureRiskRegion {
  return { region: 'Gulf Coast', riskLevel: 3, topRiskDriver: 'Hurricane exposure', ...overrides };
}

function emptyData(): EnergySuperpowerData {
  return {
    gridStress: makeGridStress({ score: 0, tier: 'stable', activeOutages: 0, pipelineDisruptions: 0, refineryIncidents: 0 }),
    outages: [],
    pipelines: [],
    supplyChain: { importDependencyFlags: [], priceStressIndicators: [] },
    infraRisk: [],
  };
}

// ── Panel instantiation ───────────────────────────────────────────────────

test('new EnergySuperpowerPanel() does not throw', () => {
  assert.doesNotThrow(() => { makePanel(); });
});

test('panel id matches energy-superpower', () => {
  const panel = makePanel();
  assert.equal(panel.getPanelId(), 'energy-superpower');
});

test('panel title contains Energy Intelligence', () => {
  const panel = makePanel();
  const titleEl = panel.getElement().querySelector('.panel-title');
  assert.ok(titleEl?.textContent?.includes('Energy'), `expected title to include "Energy", got "${titleEl?.textContent}"`);
});

// ── Grid Stress section ───────────────────────────────────────────────────

test('buildHtml contains Grid Stress Index', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /Grid Stress Index/i);
});

test('grid score 85 → tier label contains CRITICAL', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), gridStress: makeGridStress({ score: 85, tier: 'critical' }) });
  assert.match(html, /CRITICAL/i);
});

test('grid score 55 → tier label contains STRESSED', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), gridStress: makeGridStress({ score: 55, tier: 'stressed' }) });
  assert.match(html, /STRESSED/i);
});

test('grid score 30 → tier label contains ELEVATED', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), gridStress: makeGridStress({ score: 30, tier: 'elevated' }) });
  assert.match(html, /ELEVATED/i);
});

test('grid score 10 → tier label contains STABLE', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), gridStress: makeGridStress({ score: 10, tier: 'stable' }) });
  assert.match(html, /STABLE/i);
});

// ── Outage section ────────────────────────────────────────────────────────

test('no outages → HTML contains "No active outages"', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /No active outages/i);
});

test('one outage → HTML contains region name', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), outages: [makeOutage({ region: 'Texas' })] });
  assert.match(html, /Texas/);
});

test('outage → HTML contains customers affected formatted', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), outages: [makeOutage({ customersAffected: 50000 })] });
  assert.match(html, /50[,.]?000/);
});

test('storm cause → HTML contains "Storm"', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), outages: [makeOutage({ cause: 'storm' })] });
  assert.match(html, /Storm/);
});

test('restorationEta undefined → HTML contains "Ongoing"', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), outages: [makeOutage({ restorationEta: undefined })] });
  assert.match(html, /Ongoing/);
});

// ── Pipeline section ──────────────────────────────────────────────────────

test('no pipelines → HTML contains "No active disruptions"', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /No active disruptions/i);
});

test('pipeline name appears in HTML', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), pipelines: [makePipeline({ pipelineName: 'Colonial Pipeline' })] });
  assert.match(html, /Colonial Pipeline/);
});

test('disruption type "rupture" → HTML contains "Rupture"', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), pipelines: [makePipeline({ disruptionType: 'rupture' })] });
  assert.match(html, /Rupture/);
});

test('capacity and unit appear in HTML', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), pipelines: [makePipeline({ affectedCapacity: 500000, capacityUnit: 'bpd' })] });
  assert.match(html, /500[,.]?000/);
  assert.match(html, /bpd/);
});

test('pipeline type "LNG" appears in HTML', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), pipelines: [makePipeline({ type: 'LNG' })] });
  assert.match(html, /LNG/);
});

// ── Supply chain section ──────────────────────────────────────────────────

test('sprLevelPct=60 → HTML contains "60"', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), supplyChain: makeSupplyChain({ sprLevelPct: 60 }) });
  assert.match(html, /60/);
});

test('lngExportCapacityPct=85 → HTML contains "85"', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), supplyChain: makeSupplyChain({ lngExportCapacityPct: 85 }) });
  assert.match(html, /85/);
});

test('flagged import dependency appears in HTML', () => {
  const panel = makePanel();
  const html = panel.buildHtml({
    ...emptyData(),
    supplyChain: makeSupplyChain({
      importDependencyFlags: [{ region: 'Middle East', flagged: true, reason: 'Strait of Hormuz risk' }],
    }),
  });
  assert.match(html, /Middle East/);
});

test('price stress indicator appears in HTML', () => {
  const panel = makePanel();
  const html = panel.buildHtml({
    ...emptyData(),
    supplyChain: makeSupplyChain({
      priceStressIndicators: [{ commodity: 'Natural Gas', stressLevel: 'high' }],
    }),
  });
  assert.match(html, /Natural Gas/);
});

// ── Infrastructure risk section ───────────────────────────────────────────

test('no infra risk → HTML contains "No infrastructure risk data"', () => {
  const panel = makePanel();
  const html = panel.buildHtml(emptyData());
  assert.match(html, /No infrastructure risk data/i);
});

test('region name appears in HTML', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), infraRisk: [makeInfraRisk({ region: 'Gulf Coast' })] });
  assert.match(html, /Gulf Coast/);
});

test('risk level 4 → output uses severity-critical color CSS var', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), infraRisk: [makeInfraRisk({ riskLevel: 4 })] });
  assert.match(html, /severity-critical/);
});

test('topRiskDriver text appears in HTML', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), infraRisk: [makeInfraRisk({ topRiskDriver: 'Hurricane exposure' })] });
  assert.match(html, /Hurricane exposure/);
});

// ── escapeHtml / XSS prevention ───────────────────────────────────────────

test('region name with <script> is escaped in outage section', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), outages: [makeOutage({ region: '<script>alert(1)</script>' })] });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('pipeline name with " is escaped', () => {
  const panel = makePanel();
  const html = panel.buildHtml({ ...emptyData(), pipelines: [makePipeline({ pipelineName: '"Dangerous" Pipeline' })] });
  assert.doesNotMatch(html, /"Dangerous"/);
  assert.match(html, /&quot;Dangerous&quot;/);
});

// ── safe() defensive wrapping ─────────────────────────────────────────────

test('refresh() does not throw when called with no args', () => {
  const panel = makePanel();
  assert.doesNotThrow(() => { panel.refresh(); });
});

test('refresh() does not throw when gridStress accessor throws', () => {
  const panel = makePanel();
  const badData = {
    get gridStress(): GridStressIndex { throw new Error('source unavailable'); },
    outages: [] as PowerOutage[],
    pipelines: [] as PipelineWatch[],
    supplyChain: { importDependencyFlags: [], priceStressIndicators: [] } as EnergySupplyChain,
    infraRisk: [] as InfrastructureRiskRegion[],
  } satisfies EnergySuperpowerData;
  assert.doesNotThrow(() => { panel.refresh(badData); });
});

// ── Count tracking ────────────────────────────────────────────────────────

test('setCount reflects outages + rupture/shutdown pipelines', () => {
  const panel = makePanel();
  let lastCount = -1;
  const origSetCount = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; origSetCount(n); };
  panel.refresh({
    ...emptyData(),
    outages: [makeOutage(), makeOutage({ id: 'OUT-2' })],
    pipelines: [makePipeline({ disruptionType: 'rupture' }), makePipeline({ id: 'PIPE-2', disruptionType: 'leak' })],
  });
  // 2 outages + 1 rupture (not the leak)
  assert.equal(lastCount, 3);
});

test('setCount is 0 when no outages and no severe pipeline disruptions', () => {
  const panel = makePanel();
  let lastCount = -1;
  const origSetCount = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; origSetCount(n); };
  panel.refresh({ ...emptyData(), pipelines: [makePipeline({ disruptionType: 'leak' })] });
  assert.equal(lastCount, 0);
});

// ── Lifecycle ─────────────────────────────────────────────────────────────

test('destroy() does not throw', () => {
  const panel = makePanel();
  assert.doesNotThrow(() => { panel.destroy(); });
});

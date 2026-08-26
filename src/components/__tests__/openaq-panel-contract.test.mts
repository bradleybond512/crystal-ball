import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import '../../../tests/panels/register-hook.mjs';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const globals = globalThis as unknown as Record<string, unknown>;
Object.assign(globals, {
  window: happyWindow,
  document: happyWindow.document,
  HTMLElement: happyWindow.HTMLElement,
  HTMLButtonElement: happyWindow.HTMLButtonElement,
  HTMLInputElement: happyWindow.HTMLInputElement,
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  Event: happyWindow.Event,
  CustomEvent: happyWindow.CustomEvent,
  MutationObserver: happyWindow.MutationObserver,
  localStorage: happyWindow.localStorage,
  sessionStorage: happyWindow.sessionStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  IntersectionObserver: class {
    observe(): void {}
    disconnect(): void {}
  },
  ResizeObserver: class {
    observe(): void {}
    disconnect(): void {}
  },
});
Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });
globals.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
globals.matchMedia = happyWindow.matchMedia.bind(happyWindow);

const { OpenaqMonitorPanel } = await import('../OpenaqMonitorPanel.ts');

type Tab = 'nearby' | 'worst';

const reading = {
  id: 'openaq:101',
  sensorId: 101,
  locationId: 202,
  station: 'Test Station',
  city: 'Test City',
  country: 'US',
  lat: 41.88,
  lon: -87.63,
  parameter: 'pm25',
  value: 42,
  unit: 'µg/m³',
  observedAt: Date.now(),
};

function envelope(readings: unknown[]) {
  return {
    schemaVersion: 2,
    provider: 'openaq-v3',
    coverage: 'best_effort_sample',
    complete: false,
    readings,
    sample: {
      windowStart: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      windowEnd: new Date().toISOString(),
      reportedFoundAtStart: readings.length,
      plannedPages: 1,
      fetchedPages: 1,
      rawRows: readings.length,
      uniqueSensorRows: readings.length,
      acceptedRows: readings.length,
      duplicateRows: 0,
      invalidRows: 0,
      rejectionReasons: {},
    },
  };
}

function setInitialTab(tab: Tab): void {
  localStorage.clear();
  localStorage.setItem('cb:openaq-tab', tab);
  localStorage.setItem('wm_proximity_config', JSON.stringify({
    enabled: true,
    radiusKm: 500,
    location: { lat: 41.88, lon: -87.63, label: 'Chicago', source: 'manual', setAt: Date.now() },
  }));
}

async function renderResult(tab: Tab, response: Response): Promise<string> {
  setInitialTab(tab);
  globals.fetch = async () => response;
  const panel = new OpenaqMonitorPanel();
  document.body.replaceChildren(panel.getElement());
  await new Promise((resolve) => setTimeout(resolve, 225));
  const text = panel.getElement().textContent ?? '';
  panel.destroy();
  return text;
}

for (const tab of ['nearby', 'worst'] as const) {
  const label = tab === 'nearby' ? 'Nearby' : 'Recent Highs';

  test(`${label} exits loading and renders a successful reading`, async () => {
    const text = await renderResult(tab, Response.json(envelope([reading])));

    assert.match(text, /Test Station/);
    assert.doesNotMatch(text, /Loading (nearby stations|recent high PM2\.5 readings)/);
  });

  test(`${label} exits loading and renders a valid-empty sample`, async () => {
    const text = await renderResult(tab, Response.json(envelope([])));

    assert.match(text, tab === 'nearby'
      ? /No nearby readings are present in this best-effort sample/
      : /current best-effort sample contains no usable PM2\.5 readings/);
    assert.doesNotMatch(text, /Loading (nearby stations|recent high PM2\.5 readings)/);
  });

  test(`${label} exits loading and renders an HTTP error`, async () => {
    const text = await renderResult(tab, new Response(null, { status: 503 }));

    assert.match(text, /OpenAQ unavailable \(HTTP 503\)/);
    assert.doesNotMatch(text, /Loading (nearby stations|recent high PM2\.5 readings)/);
  });
}

test('OpenAQ panel labels the bounded feed as Recent Highs and discloses sample coverage', async () => {
  const text = await renderResult('worst', Response.json(envelope([])));

  assert.match(text, /Recent Highs/);
  assert.match(text, /Best-effort sample from the last 2 hours; not complete global coverage/);
  assert.doesNotMatch(text, /Global Worst/);
});

test('OpenAQ search promises only fields present in the normalized sample', async () => {
  setInitialTab('nearby');
  localStorage.setItem('cb:openaq-tab', 'search');
  globals.fetch = async () => Response.json(envelope([]));
  const panel = new OpenaqMonitorPanel();
  document.body.replaceChildren(panel.getElement());
  await new Promise((resolve) => setTimeout(resolve, 175));
  const text = panel.getElement().textContent ?? '';

  assert.match(text, /Type a station or location ID to search loaded readings/);
  assert.doesNotMatch(text, /Search by station \/ city \/ country/);
  panel.destroy();
});

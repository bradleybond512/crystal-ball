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
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  Event: happyWindow.Event,
  MouseEvent: happyWindow.MouseEvent,
  CustomEvent: happyWindow.CustomEvent,
  localStorage: happyWindow.localStorage,
  sessionStorage: happyWindow.sessionStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });
globals.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
globals.matchMedia = happyWindow.matchMedia.bind(happyWindow);

const { MapPopup } = await import('../MapPopup.ts');

const NOW = Date.parse('2026-08-14T14:00:00.000Z');
const NODE = {
  id: 'fema:shelter:42',
  kind: 'shelter',
  category: 'shelter',
  name: 'County Shelter',
  lat: 41.6,
  lon: -86.7,
  distanceKm: 4.2,
  address: '100 Main St, La Porte, IN',
  publicPhone: '+1 (219) 555-0100',
  sourceRefs: [{ provider: 'fema', recordId: '42' }],
  capabilities: {},
  source: 'FEMA Open Shelters',
  freshness: 'fresh',
  hazardCompatibility: 'evacuation',
  fetchedAt: new Date(NOW - 60_000),
  operational: 'open',
  inventory: 'unknown',
  power: 'unknown',
  access: 'unknown',
  verification: 'official',
  observedAt: new Date(NOW - 60_000),
  retrievedAt: new Date(NOW - 60_000),
  sourceObservedAt: new Date(NOW - 5 * 60_000),
  expiresAt: new Date(NOW + 60_000),
  confidence: 'high',
  sourceUrl: 'https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/FeatureServer',
  directoryOnly: false,
};

function mountPopup(): InstanceType<typeof MapPopup> {
  document.body.replaceChildren();
  const container = document.createElement('div');
  document.body.append(container);
  return new MapPopup(container);
}

test('lifeline popup keeps external and clipboard actions inert until explicit clicks', async () => {
  const copied: string[] = [];
  const opened: string[] = [];
  Object.defineProperty(happyWindow.navigator, 'clipboard', {
    value: { writeText: async (value: string) => { copied.push(value); } },
    configurable: true,
  });
  happyWindow.open = ((url?: string | URL) => {
    opened.push(String(url));
    return null;
  }) as typeof happyWindow.open;

  const popup = mountPopup();
  popup.show({ type: 'lifeline', data: NODE, x: 100, y: 100 });

  assert.equal(opened.length, 0);
  assert.equal(copied.length, 0);
  assert.equal(document.querySelector<HTMLAnchorElement>('[data-lifeline-call]')?.getAttribute('href'), 'tel:+12195550100');

  document.querySelector<HTMLButtonElement>('[data-lifeline-copy="address"]')?.click();
  document.querySelector<HTMLButtonElement>('[data-lifeline-copy="coordinates"]')?.click();
  document.querySelector<HTMLButtonElement>('[data-lifeline-open-maps]')?.click();
  await Promise.resolve();

  assert.deepEqual(copied, ['100 Main St, La Porte, IN', '41.600000, -86.700000']);
  assert.equal(opened.length, 1);
  assert.match(opened[0] ?? '', /^https:\/\/www\.openstreetmap\.org\//);
  popup.hide();
});

test('lifeline popup surfaces evidence expiry as unknown rather than open', () => {
  const popup = mountPopup();
  popup.show({
    type: 'lifeline',
    data: { ...NODE, operational: 'open', expiresAt: new Date(Date.now() - 1) },
    x: 100,
    y: 100,
  });

  const text = document.querySelector('.map-popup')?.textContent ?? '';
  assert.match(text, /Verification expired/);
  assert.match(text, /status unknown/i);
  assert.doesNotMatch(text, /Official report: open/);
  popup.hide();
});

test('lifeline popup distinguishes retrieval time from an upstream report time', () => {
  const popup = mountPopup();
  popup.show({ type: 'lifeline', data: NODE, x: 100, y: 100 });

  const text = document.querySelector('.map-popup')?.textContent ?? '';
  assert.match(text, /Retrieved/);
  assert.match(text, /Source reported/);
  assert.doesNotMatch(text, /\bObserved\b/);
  popup.hide();
});

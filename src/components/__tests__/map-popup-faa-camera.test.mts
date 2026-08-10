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

const CAMERA = {
  id: 'faa-11526',
  name: 'Yampa Valley Regional - Camera 4',
  lat: 40.4812,
  lon: -107.2177,
  state: 'CO',
  category: 'remote',
  imageUrl: '/api/faa-camera-image?cameraId=11526',
  isOnline: true,
  lastUpdated: '2026-08-09T00:00:00.000Z',
  alertProximityMi: null,
  alertLabel: null,
  relevanceScore: 30,
  aiConditions: null,
};

function mountPopup(): InstanceType<typeof MapPopup> {
  document.body.replaceChildren();
  const container = document.createElement('div');
  document.body.append(container);
  return new MapPopup(container);
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('FAA map popup resolves the API pointer before loading the camera image', async () => {
  const originalFetch = globalThis.fetch;
  const resolvedUrl = 'https://images.wcams-static.faa.gov/11526/current.jpg';
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ imageUrl: resolvedUrl, frames: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const popup = mountPopup();
    popup.show({ type: 'faaCamera', data: CAMERA, x: 100, y: 100 });

    const image = document.querySelector<HTMLImageElement>('[data-faa-camera-image]');
    assert.ok(image, 'camera popup should mount an image element');
    assert.equal(image.getAttribute('src'), null, 'the JSON resolver pointer must never become img.src');
    assert.equal(image.loading, 'eager', 'a hidden popup image must not be deferred by lazy loading');

    await settle();

    assert.equal(requests.length, 1);
    assert.match(requests[0] ?? '', /\/api\/faa-camera-image\?cameraId=11526$/);
    assert.equal(image.src, resolvedUrl);
    assert.equal(image.hidden, true, 'loading state should remain until image bytes arrive');

    image.dispatchEvent(new Event('load'));

    assert.equal(image.hidden, false);
    assert.equal(document.querySelector('[data-faa-camera-status]'), null);
    popup.hide();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FAA map popup exposes dedicated viewer structure for constrained layout', () => {
  const popup = mountPopup();
  popup.show({
    type: 'faaCamera',
    data: { ...CAMERA, imageUrl: 'https://images.wcams-static.faa.gov/11526/current.jpg' },
    x: 100,
    y: 100,
  });

  assert.ok(document.querySelector('.map-popup.map-popup-faa-camera'));
  assert.ok(document.querySelector('.popup-header.faa-camera-popup-header'));
  assert.ok(document.querySelector('.popup-body.faa-camera-popup-body'));
  assert.ok(document.querySelector('.faa-camera-frame'));
  assert.ok(document.querySelector('.faa-camera-frame-image'));
  const close = document.querySelector<HTMLButtonElement>('.faa-camera-popup-header .popup-close');
  assert.equal(close?.type, 'button');
  assert.equal(close?.getAttribute('aria-label'), 'common.close');
  assert.equal(document.querySelector('time.faa-camera-updated')?.getAttribute('datetime'), CAMERA.lastUpdated);
  popup.hide();
});

test('FAA map popup replaces a failed image load with an unavailable state', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    imageUrl: 'https://images.wcams-static.faa.gov/missing.jpg',
  }), { status: 200 })) as typeof fetch;

  try {
    const popup = mountPopup();
    popup.show({ type: 'faaCamera', data: CAMERA, x: 100, y: 100 });
    await settle();

    const image = document.querySelector<HTMLImageElement>('[data-faa-camera-image]');
    const status = document.querySelector<HTMLElement>('[data-faa-camera-status]');
    assert.ok(image);
    assert.ok(status);
    image.dispatchEvent(new Event('error'));

    assert.equal(document.querySelector('[data-faa-camera-image]'), null);
    assert.equal(status.isConnected, true);
    assert.equal(status.textContent, 'common.noDataAvailable');
    popup.hide();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('closing an FAA map popup aborts an in-flight frame resolve', async () => {
  const originalFetch = globalThis.fetch;
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
    });
  }) as typeof fetch;

  try {
    const popup = mountPopup();
    popup.show({ type: 'faaCamera', data: CAMERA, x: 100, y: 100 });
    await settle();

    assert.ok(requestSignal, 'camera popup should begin resolving its frame');
    popup.hide();

    assert.equal(requestSignal.aborted, true);
    assert.equal(document.querySelector('.map-popup'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

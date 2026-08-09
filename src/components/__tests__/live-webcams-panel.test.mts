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
  HTMLDivElement: happyWindow.HTMLDivElement,
  HTMLButtonElement: happyWindow.HTMLButtonElement,
  HTMLIFrameElement: happyWindow.HTMLIFrameElement,
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  Event: happyWindow.Event,
  CustomEvent: happyWindow.CustomEvent,
  MutationObserver: happyWindow.MutationObserver,
  localStorage: happyWindow.localStorage,
  sessionStorage: happyWindow.sessionStorage,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
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

const { LiveWebcamsPanel } = await import('../LiveWebcamsPanel.ts');

type LiveInfo = { videoId: string | null; hlsUrl: string | null };
type Resolver = (channelHandle: string, forceRefresh?: boolean) => Promise<LiveInfo>;
type PanelInternals = {
  isVisible: boolean;
  render(): void;
  setViewMode(mode: 'grid' | 'single' | 'map'): void;
};

function mountVisiblePanel(resolver: Resolver): InstanceType<typeof LiveWebcamsPanel> {
  const panel = new LiveWebcamsPanel(resolver);
  document.body.replaceChildren(panel.getElement());
  const internals = panel as unknown as PanelInternals;
  internals.isVisible = true;
  internals.render();
  return panel;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('LiveWebcamsPanel embeds the currently resolved live video, not the stale registry fallback', async () => {
  const currentVideoId = 'N3wLive1234';
  const panel = mountVisiblePanel(async () => ({ videoId: currentVideoId, hlsUrl: null }));

  await settle();

  const iframe = panel.getElement().querySelector<HTMLIFrameElement>('.webcam-iframe');
  assert.ok(iframe, 'resolved live feed should mount an iframe');
  assert.match(iframe.src, new RegExp(currentVideoId));
  assert.doesNotMatch(iframe.src, /-zGuR1qVKrU/);
  panel.destroy();
});

test('LiveWebcamsPanel shows an honest unavailable state when the channel is not live', async () => {
  const panel = mountVisiblePanel(async () => ({ videoId: null, hlsUrl: null }));

  await settle();

  assert.equal(panel.getElement().querySelectorAll('.webcam-iframe').length, 0);
  const unavailable = panel.getElement().querySelector<HTMLElement>('.webcam-err-overlay');
  assert.ok(unavailable, 'offline feed should render an unavailable state');
  assert.match(unavailable.textContent ?? '', /stream unavailable/i);
  assert.match(unavailable.querySelector<HTMLAnchorElement>('a')?.href ?? '', /youtube\.com\/.+\/live/);
  panel.destroy();
});

test('LiveWebcamsPanel Retry refreshes only the unavailable feed', async () => {
  const calls: Array<{ channelHandle: string; forceRefresh: boolean }> = [];
  let unavailableHandle: string | undefined;
  const panel = mountVisiblePanel(async (channelHandle, forceRefresh = false) => {
    unavailableHandle ??= channelHandle;
    calls.push({ channelHandle, forceRefresh });
    return {
      videoId: channelHandle === unavailableHandle ? null : 'N3wLive1234',
      hlsUrl: null,
    };
  });

  await settle();
  const healthyIframes = Array.from(
    panel.getElement().querySelectorAll<HTMLIFrameElement>('.webcam-iframe'),
  );
  const callsBeforeRetry = calls.length;
  panel.getElement().querySelector<HTMLButtonElement>('.webcam-err-overlay button')?.click();
  await settle();

  const retryCalls = calls.slice(callsBeforeRetry);
  assert.deepEqual(retryCalls, [{ channelHandle: unavailableHandle, forceRefresh: true }]);
  assert.ok(healthyIframes.length > 0, 'the grid should contain healthy streams');
  assert.ok(healthyIframes.every((iframe) => iframe.isConnected), 'Retry should not restart healthy streams');
  panel.destroy();
});

test('LiveWebcamsPanel ignores a grid result after switching to map view', async () => {
  let resolveInfo!: (value: LiveInfo) => void;
  const pending = new Promise<LiveInfo>((resolve) => { resolveInfo = resolve; });
  const panel = mountVisiblePanel(() => pending);

  (panel as unknown as PanelInternals).setViewMode('map');
  resolveInfo({ videoId: 'N3wLive1234', hlsUrl: null });
  await settle();

  assert.ok(panel.getElement().querySelector('.webcam-map'));
  assert.equal(panel.getElement().querySelectorAll('.webcam-iframe').length, 0);
  panel.destroy();
});

test('LiveWebcamsPanel ignores a live-resolution result after destruction', async () => {
  let resolveInfo!: (value: LiveInfo) => void;
  let resolverCalls = 0;
  const pending = new Promise<LiveInfo>((resolve) => { resolveInfo = resolve; });
  const panel = mountVisiblePanel(() => {
    resolverCalls += 1;
    return pending;
  });

  assert.ok(resolverCalls > 0, 'visible feeds should start live resolution');
  panel.destroy();
  resolveInfo({ videoId: 'N3wLive1234', hlsUrl: null });
  await settle();

  assert.equal(panel.getElement().querySelectorAll('.webcam-iframe').length, 0);
});

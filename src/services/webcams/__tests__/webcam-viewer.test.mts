import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Window } from 'happy-dom';

// Install a DOM before importing the viewer module (buildSnapshotViewerCard uses document).
const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const G = globalThis as unknown as Record<string, unknown>;
G.window = happyWindow;
G.document = happyWindow.document;
G.HTMLElement = happyWindow.HTMLElement;
G.HTMLImageElement = happyWindow.HTMLImageElement;
G.HTMLButtonElement = happyWindow.HTMLButtonElement;
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;

const {
  formatRefreshCadence,
  formatDataAsOf,
  webcamAttribution,
  isDirectlyViewable,
  computeViewerModel,
  cacheBustedUrl,
  webcamSourceLabel,
  buildSnapshotViewerCard,
} = await import('../webcam-viewer.ts');
type WebcamFeed = import('../webcam-types.ts').WebcamFeed;

function feed(over: Partial<WebcamFeed> = {}): WebcamFeed {
  return {
    id: 'HAZECAM:acadia', source: 'HAZECAM', name: 'Acadia — visibility (CAMNET)',
    lat: 44.377, lon: -68.261, snapshotUrl: 'https://hazecam.net/images/large/acadia_left.jpg',
    refreshIntervalSec: 600, category: 'nature',
    metadata: { attribution: 'CAMNET / hazecam.net (NESCAUM)', pageUrl: 'https://hazecam.net/camsite.aspx?site=acadia' },
    ...over,
  };
}

// ── Pure formatters ───────────────────────────────────────────────────────

test('formatRefreshCadence: seconds under 90s, minutes above', () => {
  assert.equal(formatRefreshCadence(15), 'Updates every 15 s');
  assert.equal(formatRefreshCadence(60), 'Updates every 60 s');
  assert.equal(formatRefreshCadence(600), 'Updates every 10 min');
  assert.equal(formatRefreshCadence(900), 'Updates every 15 min');
});

test('formatDataAsOf: loading / just now / minutes / hours', () => {
  const now = 10_000_000;
  assert.equal(formatDataAsOf(null, now), 'Loading…');
  assert.equal(formatDataAsOf(now - 5_000, now), 'Updated just now');
  assert.equal(formatDataAsOf(now - 3 * 60_000, now), 'Updated 3 min ago');
  assert.equal(formatDataAsOf(now - 2 * 3_600_000, now), 'Updated 2 h ago');
});

test('webcamAttribution: trimmed string or null', () => {
  assert.equal(webcamAttribution(feed()), 'CAMNET / hazecam.net (NESCAUM)');
  assert.equal(webcamAttribution(feed({ metadata: {} })), null);
  assert.equal(webcamAttribution(feed({ metadata: { attribution: '   ' } })), null);
});

test('isDirectlyViewable: https image yes, /api resolver no', () => {
  assert.equal(isDirectlyViewable('https://hazecam.net/images/large/acadia_left.jpg'), true);
  assert.equal(isDirectlyViewable('/api/faa-cameras/frame?id=X'), false);
  assert.equal(isDirectlyViewable('http://127.0.0.1:46123/api/webcams/x'), false);
});

test('cacheBustedUrl: adds _cb with the right separator', () => {
  assert.equal(cacheBustedUrl('https://x/y.jpg', 3), 'https://x/y.jpg?_cb=3');
  assert.equal(cacheBustedUrl('https://x/y.jpg?a=1', 4), 'https://x/y.jpg?a=1&_cb=4');
});

test('webcamSourceLabel: known → human, unknown → raw', () => {
  assert.equal(webcamSourceLabel('HAZECAM'), 'Visibility');
  assert.equal(webcamSourceLabel('NPS'), 'Parks');
});

test('computeViewerModel: honest snapshot model with attribution + human source', () => {
  const m = computeViewerModel(feed());
  assert.equal(m.viewable, true);
  assert.equal(m.cadenceLabel, 'Updates every 10 min');
  assert.equal(m.attribution, 'CAMNET / hazecam.net (NESCAUM)');
  assert.equal(m.sourceLabel, 'Visibility');
  assert.equal(m.coords, '44.3770, -68.2610');
  assert.equal(m.pageUrl, 'https://hazecam.net/camsite.aspx?site=acadia');
});

// ── DOM viewer card ───────────────────────────────────────────────────────

test('buildSnapshotViewerCard: renders an auto-loading img with the snapshot URL', () => {
  const { el, destroy } = buildSnapshotViewerCard(feed());
  const img = el.querySelector('img.webcam-snapshot-viewer__img') as HTMLImageElement | null;
  assert.ok(img, 'img present');
  assert.match(img!.getAttribute('src') ?? '', /hazecam\.net\/images\/large\/acadia_left\.jpg\?_cb=/);
  assert.ok(el.textContent?.includes('Updates every 10 min'));
  assert.ok(el.textContent?.includes('CAMNET / hazecam.net (NESCAUM)'));
  assert.ok(el.querySelector('.webcam-snapshot-viewer__controls button'), 'manual refresh button present');
  destroy();
});

test('buildSnapshotViewerCard: close button invokes onClose and destroy stops cleanly', () => {
  let closed = 0;
  const { el, destroy } = buildSnapshotViewerCard(feed(), { onClose: () => { closed += 1; } });
  const close = el.querySelector('.webcam-snapshot-viewer__close') as HTMLButtonElement;
  close.click();
  assert.equal(closed, 1);
  destroy(); // idempotent / safe after close
});

test('buildSnapshotViewerCard: resolver feed (FAA /api/) resolves to a real image', async () => {
  const { el, destroy } = buildSnapshotViewerCard(
    feed({ id: 'FAA:x', source: 'FAA', snapshotUrl: '/api/faa-cameras/frame?id=x', metadata: {} }),
    { resolveFrame: async () => 'https://cams.faa.gov/x/current.jpg' },
  );
  await new Promise((r) => setTimeout(r, 0)); // flush the async resolve
  const img = el.querySelector('img.webcam-snapshot-viewer__img') as HTMLImageElement | null;
  assert.ok(img, 'img present after resolve');
  assert.match(img!.getAttribute('src') ?? '', /cams\.faa\.gov\/x\/current\.jpg\?_cb=/);
  destroy();
});

test('buildSnapshotViewerCard: resolver failure degrades to a note (no broken img)', async () => {
  const { el, destroy } = buildSnapshotViewerCard(
    feed({ id: 'FAA:y', source: 'FAA', snapshotUrl: '/api/faa-cameras/frame?id=y', metadata: {} }),
    { resolveFrame: async () => null },
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.querySelector('img'), null, 'broken img removed on resolve failure');
  assert.ok(el.querySelector('.webcam-snapshot-viewer__note'), 'fallback note shown');
  destroy();
});

test('buildSnapshotViewerCard: non-viewable feed shows a link-out, no img', () => {
  let opened = '';
  const { el } = buildSnapshotViewerCard(
    feed({ snapshotUrl: '/api/faa-cameras/frame?id=X', metadata: { pageUrl: 'https://example.gov/cam' } }),
    { openExternal: (u) => { opened = u; } },
  );
  assert.equal(el.querySelector('img'), null);
  const btn = [...el.querySelectorAll('button')].find((b) => /Open camera page/.test(b.textContent ?? ''));
  assert.ok(btn, 'open-page button present');
  (btn as HTMLButtonElement).click();
  assert.equal(opened, 'https://example.gov/cam');
});

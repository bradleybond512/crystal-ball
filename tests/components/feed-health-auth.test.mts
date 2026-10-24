import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import type { FeedSnapshot } from '../../src/services/diagnostics/feed-catalog.ts';

const browser = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, localStorage: browser.localStorage,
  sessionStorage: browser.sessionStorage, HTMLElement: browser.HTMLElement,
  Element: browser.Element, Node: browser.Node, Event: browser.Event,
  CustomEvent: browser.CustomEvent, MutationObserver: browser.MutationObserver,
  __viteImportMetaEnv: { DEV: false, PROD: false, MODE: 'test', BASE_URL: '/', VITE_VARIANT: 'full' },
  __POSTHOG_DISABLED: true,
});
const { FeedHealthPanel } = await import('../../src/components/FeedHealthPanel.ts');
const { FEED_CATALOG } = await import('../../src/services/diagnostics/feed-catalog.ts');

interface PanelProbe {
  snapshots: Record<string, FeedSnapshot>;
  lastFetchAt: number | null;
  lastFetchError: string | null;
  diagnosticsPending: boolean;
  fetchSidecarHealth(): Promise<void>;
  renderFooter(): string;
  render(): void;
}

test('the actual feed panel preserves snapshots while public diagnostics are pending, then consumes authenticated updates', async () => {
  const definition = FEED_CATALOG.find((feed) => feed.sidecarKey === 'usgs');
  assert.ok(definition);
  const snapshot: FeedSnapshot = { id: definition.id, lastSuccessAt: 100, lastAttemptAt: 100, lastError: null };
  // Exercise the real response method without starting the component's
  // polling timers or unrelated Panel UI services.
  const panel = Object.create(FeedHealthPanel.prototype) as PanelProbe;
  Object.assign(panel, { snapshots: { [definition.id]: snapshot }, lastFetchAt: 100,
    lastFetchError: null, diagnosticsPending: false, render() {} });
  const fetchBefore = globalThis.fetch;
  let payload: unknown = { ok: true, feeds: [{ key: 'usgs', lastError: 'must-not-merge' }] };
  globalThis.fetch = async () => Response.json(payload);
  try {
    await panel.fetchSidecarHealth();
    assert.deepEqual(panel.snapshots, { [definition.id]: snapshot });
    assert.equal(panel.lastFetchAt, 100, 'public liveness cannot refresh inventory freshness');
    assert.equal(panel.lastFetchError, null);
    assert.match(panel.renderFooter(), /authenticated diagnostics pending/);

    payload = { ok: true, authenticated: true, feeds: [
      { key: 'usgs', lastSuccessAt: 100, lastAttemptAt: 200, lastError: 'fixture failure' },
    ] };
    await panel.fetchSidecarHealth();
    assert.equal(panel.snapshots[definition.id]?.lastError, 'fixture failure');
    assert.equal(panel.snapshots[definition.id]?.lastAttemptAt, 200);
    assert.equal(panel.diagnosticsPending, false);
    assert.doesNotMatch(panel.renderFooter(), /diagnostics pending/);

    const successfulFetchAt = panel.lastFetchAt;
    const successfulSnapshots = structuredClone(panel.snapshots);
    payload = { ok: true };
    await panel.fetchSidecarHealth();
    assert.deepEqual(panel.snapshots, successfulSnapshots, 'a subsequent public response cannot erase a failure');
    assert.equal(panel.lastFetchAt, successfulFetchAt);
    assert.match(panel.renderFooter(), /diagnostics pending/);
  } finally {
    globalThis.fetch = fetchBefore;
    await browser.happyDOM.close();
  }
});

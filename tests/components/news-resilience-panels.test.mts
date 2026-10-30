import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import '../panels/setup-dom.mts';
const { Panel } = await import('../../src/components/Panel.ts');
const { NewsSnapshot } = await import('../../src/services/news-snapshot.ts');
const { SystemDiagnosticPanel } = await import('../../src/components/SystemDiagnosticPanel.ts');
const { disclosureService } = await import('../../src/services/ui/progressive-disclosure.ts');
const { MediastackNewsPanel } = await import('../../src/components/MediastackNewsPanel.ts');
after(() => Panel.stopHeartbeatTicker());
const settle = () => new Promise(resolve => setTimeout(resolve, 220));
function response(body: unknown) { return Promise.resolve({ ok: true, json: async () => body } as Response); }
test('legacy empty response remains unknown rather than verified empty', async () => {
  globalThis.fetch = () => response({ articles: [] });
  const panel = new MediastackNewsPanel();
  await settle();
  assert.match(panel.getElement().textContent ?? '', /GDELT status unknown/);
  panel.destroy();
});

const scope = { variant: 'full', language: 'en', query: '', configSignature: 'one' };
const configs = [{ sourceId: 'rss', label: 'Example feed', configuredUrl: 'https://news.google.com/rss/search?q=test', enabled: true, category: 'politics' }];
function populated(age = 0) {
  const snapshot = new NewsSnapshot();
  const generation = snapshot.setScope(scope, configs);
  const acquiredAt = Date.now() - age;
  const acquisition = { outcome: 'ok' as const, delivery: 'memory_cache' as const, attemptedAt: acquiredAt, acquiredAt, cacheStoredAt: acquiredAt, acceptedCount: 1 };
  const item = { title: 'Cyber attack report', link: 'https://example.com/report', source: 'Example publisher', pubDate: new Date(), isAlert: false,
    provenance: { ...acquisition, sourceId: 'rss', deliveryGroup: 'google-rss' as const, publicationState: 'missing' as const, publishedAt: null, observedAt: null } };
  snapshot.publish(generation, 'rss', [item], acquisition);
  return { snapshot, generation, item, acquisition };
}
test('verified empty GDELT uses eligible snapshot and subscriptions never fetch', async () => {
  let calls = 0;
  globalThis.fetch = () => { calls++; return response({ articles: [], acquisition: { outcome: 'empty', delivery: 'upstream', acquiredAt: Date.now() } }); };
  const { snapshot, generation, item, acquisition } = populated();
  const panel = new MediastackNewsPanel(snapshot);
  document.body.append(panel.getElement());
  await settle();
  assert.match(panel.getElement().textContent ?? '', /verified empty.*Fallback.*Example publisher/s);
  assert.match(panel.getElement().textContent ?? '', /Publication time unknown/);
  assert.doesNotMatch(panel.getElement().querySelector('.news-feed')?.textContent ?? '', /Breaking/);
  snapshot.publish(generation, 'rss', [item], acquisition);
  await settle();
  assert.equal(calls, 1);
  snapshot.setScope({ ...scope, language: 'fr' }, configs);
  await settle();
  assert.doesNotMatch(panel.getElement().textContent ?? '', /Cyber attack report/);
  assert.equal(calls, 1);
  panel.destroy(); snapshot.destroy();
});
test('expired snapshot cannot fill an unavailable request', async () => {
  globalThis.fetch = async () => { throw new Error('secret upstream failure'); };
  const { snapshot } = populated(2 * 60 * 60_000);
  const panel = new MediastackNewsPanel(snapshot);
  await settle();
  assert.match(panel.getElement().textContent ?? '', /GDELT unavailable.*No matching eligible fallback/s);
  assert.doesNotMatch(panel.getElement().textContent ?? '', /secret upstream|Cyber attack/);
  panel.destroy(); snapshot.destroy();
});
test('observed time is labelled separately and never makes breaking news', async () => {
  globalThis.fetch = () => response({ articles: [{ title: 'Cyber news', url: 'https://example.com/observed', seendate: '20261030T120000Z', provenance: { publicationState: 'missing', observedAt: Date.now() } }], acquisition: { outcome: 'ok', delivery: 'server_cache' } });
  const panel = new MediastackNewsPanel();
  await settle();
  const text = panel.getElement().textContent ?? '';
  assert.match(text, /Observed .*Publication time unknown/);
  assert.doesNotMatch(panel.getElement().querySelector('.news-feed')?.textContent ?? '', /Breaking/);
  panel.destroy();
});
test('destroy invalidates queued and in-flight completion', async () => {
  let resolve!: (value: Response) => void;
  globalThis.fetch = () => new Promise<Response>(done => { resolve = done; });
  const panel = new MediastackNewsPanel();
  await Promise.resolve();
  const before = panel.getElement().innerHTML;
  panel.destroy();
  resolve({ ok: true, json: async () => ({ articles: [{ title: 'Late news', url: 'https://example.com/late' }] }) } as Response);
  await settle();
  assert.equal(panel.getElement().innerHTML, before);
});
test('Overview reports passive acquisition coverage and shared delivery groups', async () => {
  let calls = 0;
  globalThis.fetch = () => { calls++; return response({}); };
  const { snapshot, generation, item, acquisition } = populated();
  disclosureService.setLevel('system-diagnostic', 'detail');
  const panel = new SystemDiagnosticPanel(snapshot);
  await settle();
  const section = panel.getElement().querySelector('.news-diagnostic-coverage');
  assert.ok(section);
  assert.match(section.textContent ?? '', /1 enabled feeds.*1 configured delivery groups.*1 eligible fallback rows/s);
  assert.match(section.textContent ?? '', /memory cache.*Acquired.*Cache stored.*google-rss/s);
  assert.match(section.textContent ?? '', /backend independence is unknown/);
  const before = calls;
  snapshot.publish(generation, 'rss', [item], acquisition);
  await settle();
  assert.equal(calls, before);
  panel.destroy(); snapshot.destroy();
});
test('topic and query filter fallback without additional query acquisition', async () => {
  let calls = 0;
  globalThis.fetch = () => { calls++; return response({ articles: [], acquisition: { outcome: 'empty' } }); };
  const { snapshot } = populated();
  const panel = new MediastackNewsPanel(snapshot);
  await settle();
  panel.getElement().querySelector<HTMLButtonElement>('[data-chip="health"]')?.click();
  await settle();
  assert.equal(calls, 2, 'chip retains its existing fetch behavior');
  assert.equal(panel.getElement().querySelector('.news-row'), null);
  panel.getElement().querySelector<HTMLButtonElement>('[data-chip="security"]')?.click();
  await settle();
  const input = panel.getElement().querySelector<HTMLInputElement>('.news-search-input')!;
  input.value = 'does not match';
  input.dispatchEvent(new Event('input'));
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(calls, 3, 'search only filters existing state');
  assert.equal(panel.getElement().querySelector('.news-row'), null);
  panel.destroy(); snapshot.destroy(); localStorage.clear();
});
test('later chip request wins over an older in-flight completion', async () => {
  const pending: ((response: Response) => void)[] = [];
  globalThis.fetch = () => new Promise<Response>(resolve => { pending.push(resolve); });
  const panel = new MediastackNewsPanel();
  await settle();
  panel.getElement().querySelector<HTMLButtonElement>('[data-chip="health"]')?.click();
  await Promise.resolve();
  assert.equal(pending.length, 2);
  pending[1]!({ ok: true, json: async () => ({ articles: [{ title: 'Vaccine current report', url: 'https://example.com/current' }], acquisition: { outcome: 'ok' } }) } as Response);
  await settle();
  pending[0]!({ ok: true, json: async () => ({ articles: [{ title: 'Vaccine stale report', url: 'https://example.com/stale' }], acquisition: { outcome: 'ok' } }) } as Response);
  await settle();
  const feed = panel.getElement().querySelector('.news-feed')?.textContent ?? '';
  assert.match(feed, /Vaccine current report/);
  assert.doesNotMatch(feed, /Vaccine stale report/);
  panel.destroy(); localStorage.clear();
});

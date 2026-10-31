import assert from 'node:assert/strict';
import test from 'node:test';
import { NewsSnapshot, NEWS_SNAPSHOT_MAX_AGE_MS, type NewsSnapshotScope, type NewsSnapshotSourceConfig } from '../../news-snapshot.ts';
import type { NewsItem } from '../../../types/index.ts';
import { normalizeAcquisition, type NewsAcquisition } from '../../news-provenance.ts';
import { aggregateHeadlines } from '../news-aggregator.ts';

const NOW = Date.now() - 1_000;
const scope: NewsSnapshotScope = { variant: 'full', language: 'en', query: 'world', configSignature: 'configured' };
const config: NewsSnapshotSourceConfig = { sourceId: 'Wire', label: 'Wire', configuredUrl: '/api/rss-proxy?url=https%3A%2F%2Fnews.google.com%2Frss', enabled: true, category: 'politics' };
const acquisition = (acquiredAt: number | null = NOW): NewsAcquisition => ({ outcome: 'ok', delivery: 'upstream', attemptedAt: NOW, acquiredAt, cacheStoredAt: null, acceptedCount: 1 });
function item(acquiredAt: number | null = NOW): NewsItem {
 return { title: 'NATO summit', source: 'Different publisher', link: 'https://publisher.example/story', pubDate: new Date(NOW), isAlert: false,
 provenance: { ...acquisition(acquiredAt), sourceId: 'Wire', deliveryGroup: 'google-rss', publicationState: 'known', publishedAt: NOW - 60_000, observedAt: NOW } };
}
function mounted() {
 const snapshot = new NewsSnapshot();
 const generation = snapshot.setScope(scope, [config]);
 return { snapshot, generation };
}

test('configured sources begin unknown; disabled sources are explicit before acquisition', () => {
 const snapshot = new NewsSnapshot();
 snapshot.setScope(scope, [config, { ...config, sourceId: 'Disabled', enabled: false }]);
 assert.deepEqual(snapshot.getSnapshot().sources.map(source => source.acquisition.outcome), ['unknown', 'disabled']);
 assert.deepEqual(snapshot.getEligibleItems(NOW), []);
});

test('fallback age uses original acquisition with a strict two hour boundary', () => {
 for (const [time, count] of [[NOW - NEWS_SNAPSHOT_MAX_AGE_MS + 1, 1], [NOW - NEWS_SNAPSHOT_MAX_AGE_MS, 0], [NOW + 1, 0], [null, 0], [NaN, 0]] as const) {
 const { snapshot, generation } = mounted();
 snapshot.publish(generation, 'Wire', [item(time)], acquisition(time));
 assert.equal(snapshot.getEligibleItems(NOW).length, count, `acquiredAt=${time}`);
 }
});

test('later failure retains eligible cache rows without advancing original acquisition', () => {
 const { snapshot, generation } = mounted();
 snapshot.publish(generation, 'Wire', [item(NOW - 1_000)], acquisition(NOW - 1_000));
 snapshot.publish(generation, 'Wire', [], normalizeAcquisition({ outcome: 'timeout', attemptedAt: NOW + 1 }));
 assert.equal(snapshot.getSnapshot().sources[0]?.acquisition.outcome, 'timeout');
 assert.equal(snapshot.getEligibleItems(NOW)[0]?.provenance?.acquiredAt, NOW - 1_000);
 const cached = item(NOW - 1_000);
 cached.provenance = { ...cached.provenance!, outcome: 'timeout', delivery: 'persistent_cache' };
 snapshot.publish(generation, 'Wire', [cached], { ...acquisition(NOW - 1_000), outcome: 'timeout', delivery: 'persistent_cache', attemptedAt: NOW + 2 });
 assert.equal(snapshot.getEligibleItems(NOW).length, 1, 'failed attempt with returned known cache rows remains eligible');
 snapshot.publish(generation, 'Wire', [], normalizeAcquisition({ outcome: 'empty', attemptedAt: NOW + 3, acquiredAt: NOW, acceptedCount: 0 }));
 assert.deepEqual(snapshot.getEligibleItems(NOW), []);
});

test('scope identity and disabled changes invalidate pending async publication', async () => {
 let activeScope = scope;
 let enabled = true;
 const snapshot = new NewsSnapshot();
 snapshot.bindScope(() => ({ scope: activeScope, sources: [{ ...config, enabled }] }));
 let calls = 0;
 snapshot.subscribe(() => { calls++; snapshot.getSnapshot(); });
 const generation = snapshot.getSnapshot().generation;
 let resolve!: (items: NewsItem[]) => void;
 const request = new Promise<NewsItem[]>(done => { resolve = done; });
 const pending = request.then(items => snapshot.publish(generation, 'Wire', items, acquisition()));
 enabled = false;
 snapshot.getSnapshot();
 resolve([item()]);
 assert.equal(await pending, false);
 assert.equal(snapshot.getSnapshot().sources[0]?.acquisition.outcome, 'disabled');
 assert.deepEqual(snapshot.getEligibleItems(NOW), []);
 assert.equal(calls, 1, 'reading during notification must not recursively change generation');
 enabled = true;
 snapshot.getSnapshot();
 const next = snapshot.getSnapshot().generation;
 snapshot.publish(next, 'Wire', [item()], acquisition());
 activeScope = { ...scope, language: 'fr' };
 assert.deepEqual(snapshot.getEligibleItems(NOW), []);
 assert.equal(snapshot.publish(next, 'Wire', [item()], acquisition()), false);
});

test('destroy suppresses late completion and releases subscribers', async () => {
 const { snapshot, generation } = mounted();
 let callbacks = 0;
 snapshot.subscribe(() => { callbacks++; });
 const pending = Promise.resolve().then(() => snapshot.publish(generation, 'Wire', [item()], acquisition()));
 snapshot.destroy();
 assert.equal(await pending, false);
 assert.deepEqual(snapshot.getEligibleItems(NOW), []);
 assert.equal(callbacks, 1);
 snapshot.reset();
 assert.equal(callbacks, 1);
});

test('delivery identity comes from configured URL, and malformed rows and unknown delivery never qualify', () => {
 const { snapshot, generation } = mounted();
 const row = item();
 row.provenance!.deliveryGroup = 'newsapi';
 snapshot.publish(generation, 'Wire', [row], acquisition());
 assert.equal(snapshot.getEligibleItems(NOW)[0]?.provenance?.deliveryGroup, 'google-rss');
 assert.equal(snapshot.getEligibleItems(NOW)[0]?.source, 'Different publisher');
 snapshot.publish(generation, 'Wire', [{ ...row, link: 'javascript:alert(1)' }], acquisition());
 assert.equal(snapshot.getEligibleItems(NOW).length, 0);
 snapshot.setScope(scope, [{ ...config, configuredUrl: 'unknown' }]);
 snapshot.publish(snapshot.getSnapshot().generation, 'Wire', [item()], acquisition());
 assert.equal(snapshot.getEligibleItems(NOW).length, 0);
});

test('snapshot caps retained rows and returns detached views', () => {
 const { snapshot, generation } = mounted();
 snapshot.publish(generation, 'Wire', Array.from({ length: 200 }, (_, i) => ({ ...item(), link: `https://publisher.example/${i}` })), acquisition());
 const view = snapshot.getSnapshot();
 assert.equal(view.sources[0]?.items.length, 80);
 view.sources[0]!.items[0]!.provenance!.acquiredAt = 1;
 view.sources[0]!.items[0]!.pubDate.setTime(1);
 assert.equal(snapshot.getEligibleItems(NOW)[0]?.provenance?.acquiredAt, NOW);
 assert.equal(snapshot.getSnapshot().sources[0]?.items[0]?.pubDate.getTime(), NOW);
});

test('aggregator preserves the selected entire provenance and trusts only its publication timestamp', () => {
 const first = item().provenance!;
 const second = { ...first, deliveryGroup: 'newsapi' as const, publishedAt: NOW - 1_000, observedAt: NOW };
 const [winner] = aggregateHeadlines([[
 { title: 'NATO summit', url: 'https://publisher.example/a', publishedAt: NOW, provenance: first },
 { title: 'NATO summit update', url: 'https://publisher.example/a?tracking=1', publishedAt: 1, provenance: second },
 ]]);
 assert.equal(winner?.publishedAt, second.publishedAt);
 assert.equal(winner?.provenance?.deliveryGroup, 'newsapi');
 assert.equal(winner?.provenance?.observedAt, NOW);
 const [unknown] = aggregateHeadlines([[{ title: 'Unknown time', url: 'https://publisher.example/b', publishedAt: NOW, provenance: { ...first, publicationState: 'missing', publishedAt: null } }]]);
 assert.equal(unknown?.publishedAt, null);
});


test('current supplemental feature toggles invalidate cached rows before another acquisition', () => {
 for (const provider of ['newsapi', 'newsdata']) {
 let enabled = true;
 const snapshot = new NewsSnapshot();
 snapshot.bindScope(() => ({ scope: { ...scope, configSignature: JSON.stringify({ enabled }) }, sources: [{ ...config, sourceId: provider, configuredUrl: provider, enabled }] }));
 const generation = snapshot.getSnapshot().generation;
 snapshot.publish(generation, provider, [item()], acquisition());
 assert.equal(snapshot.getEligibleItems(NOW).length, 1);
 enabled = false;
 assert.equal(snapshot.getEligibleItems(NOW).length, 0, `${provider} toggle is authoritative before fetch`);
 assert.equal(snapshot.getSnapshot().sources[0]?.acquisition.outcome, 'disabled');
 assert.equal(snapshot.publish(generation, provider, [item()], acquisition()), false);
 }
});

test('authoritative disabled and unconfigured adapter outcomes clear retained rows without an attempt timestamp', () => {
 for (const outcome of ['disabled', 'unconfigured'] as const) {
 const { snapshot, generation } = mounted();
 snapshot.publish(generation, 'Wire', [item()], acquisition());
 assert.equal(snapshot.getEligibleItems(NOW).length, 1);
 snapshot.publish(generation, 'Wire', [], normalizeAcquisition({ outcome }));
 assert.equal(snapshot.getEligibleItems(NOW).length, 0, outcome);
 assert.equal(snapshot.getSnapshot().sources[0]?.items.length, 0, outcome);
 assert.equal(snapshot.getSnapshot().sources[0]?.acquisition.outcome, outcome);
 }
});

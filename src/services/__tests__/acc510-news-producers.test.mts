import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyNewsDomain } from '../situation-news-domain.ts';
const NOW = Date.parse('2026-11-06T12:00:00Z');
const item = (id: string, source: string, category = 'protest', age = 60_000) => ({ source, title: 'Iran protests', link: `https://example.com/${id}`, pubDate: new Date(NOW - age), isAlert: false, threat: { level: 'high' as const, category, source: 'keyword' as const, confidence: 0.7 } });
const event = (id: string, articles = [item('one', 'wire'), item('two', 'gov'), item('three', 'intel')], title = 'Iran protests') => ({ id, primaryTitle: title, primarySource: articles[0].source, primaryLink: articles[0].link, sourceCount: articles.length, allItems: articles, topSources: articles.map(a => ({ name: a.source, tier: 1, url: a.link })), firstSeen: new Date(NOW - 60_000), lastUpdated: new Date(NOW), isAlert: false, velocity: { sourcesPerHour: 20 } });
Object.assign(globalThis, { window: { addEventListener: () => {} }, document: { dispatchEvent: () => true, addEventListener: () => {} }, localStorage: { getItem: () => null, setItem: () => {} } });
const { analyzeCorrelationsCore, detectConvergence } = await import('../analysis-core.ts');
const baseline = { newsVelocity: new Map(), marketChanges: new Map(), predictionChanges: new Map(), topicVelocityHistory: new Map(), timestamp: NOW - 60_000 };

test('convergence carries only articles in its existing window and validates malformed candidates', t => {
  t.mock.method(Date, 'now', () => NOW);
  const signal = detectConvergence([event('convergence', [item('one', 'wire'), item('two', 'gov'), item('three', 'intel'), item('old-tech', 'tech', 'tech', 7_200_000)])], s => s, () => false, () => {})[0];
  assert.equal(signal.type, 'convergence');
  assert.equal(signal.data.newsEvidence.articles.length, 3);
  assert.equal(classifyNewsDomain(signal.data.newsEvidence, NOW).domain, 'civil_unrest');
  const malformed = detectConvergence([event('invalid', [item('one', 'wire'), item('two', 'gov'), item('three', 'intel'), item('invalid', 'other', 'protest', NaN)])], s => s, () => false, () => {})[0];
  assert.equal(classifyNewsDomain(malformed.data.newsEvidence, NOW).reason, 'invalid_evidence');
});

test('velocity preserves all actual topic contributors and excludes unrelated current news', t => {
  t.mock.method(Date, 'now', () => NOW);
  const { signals } = analyzeCorrelationsCore([event('protest'), event('tech', [item('launch', 'tech', 'tech')], 'New coffee machine launch')], [], [], baseline, s => s, () => false, () => {});
  const signal = signals.find(s => s.type === 'velocity_spike' && s.data.relatedTopics.includes('iran'));
  assert.ok(signal, JSON.stringify(signals));
  assert.equal(signal.data.newsEvidence.articles.length, 3);
  assert.equal(classifyNewsDomain(signal.data.newsEvidence, NOW).domain, 'civil_unrest');
  const conflicting = analyzeCorrelationsCore([event('mixed', [item('one', 'wire'), item('two', 'gov'), item('tech', 'tech', 'tech')])], [], [], baseline, s => s, () => false, () => {}).signals.find(s => s.type === 'velocity_spike');
  assert.equal(classifyNewsDomain(conflicting.data.newsEvidence, NOW).reason, 'unsupported_category');
});

test('keyword spikes preserve classifications from every ingested contribution before display deduplication', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { ingestHeadlines, drainTrendingSignals, updateTrendingConfig } = await import('../trending-keywords.ts');
  updateTrendingConfig({ autoSummarize: false, minSpikeCount: 5, spikeMultiplier: 3 });
  const articles = Array.from({ length: 5 }, (_, i) => ({ ...item(`keyword-${i}`, i % 2 ? 'wire' : 'gov'), title: 'APT1234 protest report' }));
  articles[4].threat.category = 'tech';
  ingestHeadlines(articles);
  await new Promise(resolve => setImmediate(resolve));
  const signal = drainTrendingSignals().find(s => s.data.term === 'APT1234');
  assert.ok(signal);
  assert.equal(signal.data.newsEvidence.articles.length, 5);
  assert.equal(classifyNewsDomain(signal.data.newsEvidence, NOW).reason, 'unsupported_category');
});

test('worker correlation message preserves article classifications and provenance through serialization', async t => {
  t.mock.method(Date, 'now', () => NOW);
  let listener: (message: { data: unknown }) => void;
  const replies: any[] = [];
  Object.assign(globalThis, { self: { addEventListener: (_type: string, handler: typeof listener) => { listener = handler; }, postMessage: (message: unknown) => replies.push(message) } });
  await import('../../workers/analysis.worker.ts');
  listener({ data: { type: 'correlation', id: 'baseline', clusters: [], predictions: [], markets: [], sourceTypes: {} } });
  const articles = [item('worker-a', 'wire'), item('worker-b', 'gov'), item('worker-c', 'intel')];
  const clusters = [event('worker', articles)];
  const message = JSON.parse(JSON.stringify({ type: 'correlation', id: 'news', clusters, predictions: [], markets: [], sourceTypes: { wire: 'wire', gov: 'gov', intel: 'intel' } }));
  listener({ data: message });
  const response = replies.find(reply => reply.id === 'news');
  const signal = response.signals.find(s => s.type === 'velocity_spike');
  assert.equal(classifyNewsDomain(signal.data.newsEvidence, NOW).domain, 'civil_unrest');
  assert.deepEqual(signal.data.newsEvidence.articles.map(a => a.method), ['keyword', 'keyword', 'keyword']);
});

test('keyword evidence preserves malformed, future and missing publication uncertainty', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { ingestHeadlines, drainTrendingSignals, updateTrendingConfig } = await import('../trending-keywords.ts');
  updateTrendingConfig({ autoSummarize: false, minSpikeCount: 5, spikeMultiplier: 3 });
  const mutations = [
    { pubDate: new Date(Number.NaN) },
    { pubDate: new Date(NOW + 1) },
    { provenance: { sourceId: 'existing-source', publicationState: 'missing', publishedAt: null } },
  ];
  for (const [index, mutation] of mutations.entries()) {
    const term = `APT99${index}`;
    const headlines = Array.from({ length: 5 }, (_, i) => ({ ...item(`${term}-${i}`, i % 2 ? 'wire' : 'gov'), title: `${term} protest report` }));
    Object.assign(headlines[4], mutation);
    ingestHeadlines(headlines);
    await new Promise(resolve => setImmediate(resolve));
    const signal = drainTrendingSignals().find(s => s.data.term === term);
    assert.ok(signal);
    assert.equal(classifyNewsDomain(signal.data.newsEvidence, NOW).reason, 'invalid_evidence');
  }
});

test('ML entity boundary normalization preserves punctuation, whitespace and ASCII retention', async t => {
  const { mlWorker } = await import('../ml-worker.ts');
  const { extractEntitiesWithML } = await import('../trending-keywords.ts');
  t.mock.getter(mlWorker, 'isAvailable', () => true);
  const samples = ['##Acme', '...Acme!!!', '\t  Acme\n  Group \r', '---A B---', 'éAcmeé', '!!!', '##', '0', '123', '-A-', 'A-B', '界Org界', '.'.repeat(20_000) + 'Acme' + '.'.repeat(20_000)];
  for (const sample of samples) {
    const extraction = t.mock.method(mlWorker, 'extractEntities', async () => [[{ text: sample, type: 'ORG', confidence: 0.9 }]]);
    const normalized = sample.replace(/^##/, '').replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').trim();
    const expected = normalized.length >= 2 && !/^\d+$/.test(normalized) ? [normalized] : [];
    assert.deepEqual(await extractEntitiesWithML('ordinary placeholder'), expected);
    extraction.mock.restore();
  }
});

test('storage availability preserves missing-window-storage behavior and existing writes', async t => {
  const { updateTrendingConfig } = await import('../trending-keywords.ts');
  let writes = 0;
  t.mock.method(localStorage, 'setItem', () => { writes++; });
  const browser = window as unknown as { localStorage?: Storage };
  const previous = browser.localStorage;
  try {
    browser.localStorage = undefined;
    updateTrendingConfig({ autoSummarize: false });
    assert.equal(writes, 0);
    browser.localStorage = localStorage;
    updateTrendingConfig({ autoSummarize: false });
    assert.equal(writes, 1);
  } finally {
    browser.localStorage = previous;
  }
});

test('all-capital terms at headline start retain significance through every regex match', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { ingestHeadlines, drainTrendingSignals, updateTrendingConfig } = await import('../trending-keywords.ts');
  updateTrendingConfig({ autoSummarize: false, minSpikeCount: 5, spikeMultiplier: 3 });
  ingestHeadlines(Array.from({ length: 5 }, (_, i) => ({ ...item(`capital-${i}`, i % 2 ? 'wire' : 'gov'), title: 'FOOBARXYZ' })));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(drainTrendingSignals().some(s => s.data.term?.toLowerCase() === 'foobarxyz'));
});

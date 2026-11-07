import assert from 'node:assert/strict';
import { test } from 'node:test';
const NOW = Date.parse('2026-11-06T12:00:00Z');
const article = (id = 'one', sourceId = 'source-a', category = 'protest') => ({ articleId: id, sourceId, category, confidence: 0.7, method: 'keyword', publishedAt: NOW - 60_000 });
const pair = () => [article(), article('two', 'source-b')];
async function classify(articles: unknown[], extra = {}) {
  const { classifyNewsDomain } = await import('../situation-news-domain.ts');
  return classifyNewsDomain({ articles, ...extra }, NOW);
}

test('complete agreement across distinct articles and sources supports protest without confidence tuning', async () => {
  const result = await classify(pair().map(a => ({ ...a, confidence: Number.MIN_VALUE })));
  assert.equal(result.domain, 'civil_unrest');
  assert.equal(result.reason, 'supported');
  assert.equal(result.articleCount, 2);
  assert.equal(result.sourceCount, 2);
});

test('mapped categories retain their corresponding domain and unmapped categories abstain', async () => {
  for (const [category, domain] of Object.entries({ economic: 'economic', disaster: 'natural_hazard', conflict: 'military', military: 'military', terrorism: 'military', cyber: 'cyber', health: 'health', infrastructure: 'infrastructure' })) {
    assert.equal((await classify(pair().map(a => ({ ...a, category })))).domain, domain);
  }
  for (const category of ['general', 'tech', 'diplomatic', 'environmental', 'crime']) {
    assert.equal((await classify([...pair(), article('three', 'source-c', category)])).reason, 'unsupported_category');
  }
});

test('all contributing evidence is inspected before retaining bounded source-diverse references', async () => {
  const articles = Array.from({ length: 64 }, (_, i) => article(`article-${String(i).padStart(2, '0')}`, i === 63 ? 'source-b' : 'source-a'));
  const result = await classify(articles);
  assert.equal(result.domain, 'civil_unrest');
  assert.equal(result.evidence.length, 8);
  assert.equal(new Set(result.evidence.map(a => a.sourceId)).size, 2);
  assert.deepEqual(result, await classify([...articles].reverse()));
  assert.equal((await classify([...articles.slice(0, 63), { ...articles[63], category: 'tech' }])).reason, 'unsupported_category');
  assert.equal((await classify([...articles, article('extra')])).reason, 'evidence_overflow');
  assert.equal((await classify([], { overflow: true })).reason, 'evidence_overflow');
});

test('duplicates cannot manufacture article or source quorum', async () => {
  assert.equal((await classify([article(), article()])).reason, 'insufficient_evidence');
  assert.equal((await classify(Array.from({ length: 100 }, (_, i) => pair()[i % 2]))).domain, 'civil_unrest');
  assert.equal((await classify([article(), article('two')])).reason, 'insufficient_evidence');
  assert.equal((await classify([article(), article('one', 'source-b')])).reason, 'invalid_evidence');
});

test('missing, malformed, future and conflicting classifications abstain', async () => {
  const { classifyNewsDomain } = await import('../situation-news-domain.ts');
  assert.equal(classifyNewsDomain(undefined, NOW).reason, 'incomplete_evidence');
  assert.equal((await classify([article(), { articleId: 'two', sourceId: 'source-b', publishedAt: NOW - 1 }])).reason, 'incomplete_evidence');
  for (const patch of [{ confidence: 0 }, { confidence: -1 }, { confidence: 1.01 }, { confidence: NaN }, { method: 'invented' }, { category: 'constructor' }, { articleId: '' }, { articleId: 'x'.repeat(513) }, { articleId: '界'.repeat(171) }, { sourceId: '界'.repeat(43) }, { sourceId: 'x'.repeat(129) }, { publishedAt: NOW + 1 }, { publishedAt: NaN }, { publishedAt: 0 }]) {
    const result = await classify([article(), { ...article('two', 'source-b'), ...patch }]);
    assert.equal(result.domain, 'unknown');
    assert.equal(result.reason, 'invalid_evidence', JSON.stringify(patch));
  }
  assert.equal((await classify([article(), article('two', 'source-b', 'economic')])).reason, 'conflicting_evidence');
});

test('article collection preserves provenance failures and existing classification without inventing metadata', async () => {
  const { collectNewsEvidence } = await import('../situation-news-domain.ts');
  const item = { source: 'display-source', link: 'https://news.example/one', pubDate: new Date(NOW - 1), threat: { category: 'protest', confidence: 0.7, source: 'keyword', level: 'high' } };
  const result = collectNewsEvidence([item, { ...item, link: 'https://news.example/two', provenance: { sourceId: 'actual-source', publicationState: 'missing', publishedAt: null } }]);
  assert.equal(result.articles[0].method, 'keyword');
  assert.equal(result.articles[1].sourceId, 'actual-source');
  assert.equal((await classify(result.articles)).reason, 'invalid_evidence');
  assert.deepEqual(collectNewsEvidence(Array.from({ length: 65 }, (_, i) => ({ ...item, link: `https://news.example/${i}` }))), { articles: [], overflow: true });
  assert.equal(collectNewsEvidence(Array.from({ length: 65 }, () => item)).articles.length, 1);
});

test('restoration validates bounded assertions while never promoting truncated abstentions', async () => {
  const { restoreNewsDomainClassification } = await import('../situation-news-domain.ts');
  const many = await classify(Array.from({ length: 64 }, (_, i) => article(`article-${i}`, `source-${i % 3}`)));
  assert.deepEqual(restoreNewsDomainClassification(many, NOW), many);
  for (const patch of [{ version: 2 }, { basis: 'abstained' }, { domain: 'economic' }, { articleCount: 1 }, { articleCount: 65 }, { sourceCount: 1 }, { sourceCount: 65 }, { evidence: many.evidence.slice(0, 1) }]) {
    assert.equal(restoreNewsDomainClassification({ ...many, ...patch }, NOW).domain, 'unknown');
  }
  const two = await classify(pair());
  assert.equal(restoreNewsDomainClassification({ ...two, sourceCount: 3 }, NOW).domain, 'unknown');
  assert.equal(restoreNewsDomainClassification(two, NOW - 120_000).domain, 'unknown');
  assert.equal(restoreNewsDomainClassification({ ...many, domain: 'unknown', basis: 'abstained', reason: 'conflicting_evidence' }, NOW).domain, 'unknown');
});

test('restoration rejects missing or unrecognized supported domains even when references are unmapped', async () => {
  const { restoreNewsDomainClassification } = await import('../situation-news-domain.ts');
  const assertion = { version: 1, basis: 'article_classification', reason: 'supported', articleCount: 2, sourceCount: 2, evidence: pair().map(a => ({ ...a, category: 'tech' })) };
  for (const domain of [undefined, null, '', 'constructor', 'compound']) {
    const restored = restoreNewsDomainClassification({ ...assertion, domain }, NOW);
    assert.equal(restored.domain, 'unknown');
    assert.equal(restored.reason, 'invalid_evidence');
  }
});

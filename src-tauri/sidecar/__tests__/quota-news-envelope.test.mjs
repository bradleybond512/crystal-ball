import assert from 'node:assert/strict';
import test from 'node:test';
import { isPersistedNewsEnvelope } from '../quota-news-envelope.mjs';

function fixture() {
  const acquisition = { outcome: 'ok', delivery: 'upstream', attemptedAt: 1000, acquiredAt: 1100, cacheStoredAt: 1100, acceptedCount: 1 };
  return { format: 'tracked-v1', acquisition, items: [{ id: 'newsapi-0', source: 'Example', title: 'Story', link: 'https://example.com/story', pubDate: '1970-01-01T00:00:01.000Z', description: '', provenance: { sourceId: 'newsapi', deliveryGroup: 'newsapi', publicationState: 'known', publishedAt: 1000, observedAt: null, ...acquisition } }] };
}

test('valid saved envelope is accepted without refreshing or mutating provenance', () => {
  const value = fixture();
  const before = JSON.stringify(value);
  assert.equal(isPersistedNewsEnvelope(value, 2000), true);
  assert.equal(JSON.stringify(value), before);
  const empty = { format: 'tracked-v1', items: [], acquisition: { ...value.acquisition, outcome: 'empty', acceptedCount: 0 } };
  assert.equal(isPersistedNewsEnvelope(empty, 2000), true);
});

for (const [label, change] of [
  ['legacy items', () => []], ['null', () => null],
  ['wrong format', v => { v.format = 'legacy'; }],
  ['missing acquisition', v => { delete v.acquisition; }],
  ['missing items', v => { delete v.items; }],
  ['failure outcome', v => { v.acquisition.outcome = 'denied'; }],
  ['wrong count', v => { v.acquisition.acceptedCount = 2; }],
  ['empty outcome with items', v => { v.acquisition.outcome = 'empty'; }],
  ['future acquisition', v => { v.acquisition.acquiredAt = 3000; }],
  ['reverse acquisition', v => { v.acquisition.attemptedAt = 1200; }],
  ['missing provenance', v => { delete v.items[0].provenance; }],
  ['mismatched acquisition', v => { v.items[0].provenance.acquiredAt = 1099; }],
  ['foreign provider', v => { v.items[0].provenance.sourceId = 'newsdata'; }],
  ['foreign group', v => { v.items[0].provenance.deliveryGroup = 'other'; }],
  ['non-http link', v => { v.items[0].link = 'file:///private/example'; }],
  ['blank title', v => { v.items[0].title = ' '; }],
  ['non-string id', v => { v.items[0].id = {}; }],
  ['object description', v => { v.items[0].description = {}; }],
  ['object image URL', v => { v.items[0].imageUrl = {}; }],
  ['object display date', v => { v.items[0].pubDate = {}; }],
  ['invalid publication state', v => { v.items[0].provenance.publicationState = 'invented'; }],
  ['invalid state with parseable date', v => { v.items[0].provenance.publicationState = 'invalid'; v.items[0].provenance.publishedAt = null; }],
  ['mismatched published time', v => { v.items[0].provenance.publishedAt = 900; }],
  ['invented observation', v => { v.items[0].provenance.observedAt = 1200; }],
]) test(`disk envelope rejects ${label}`, () => {
  const value = fixture();
  const replacement = change(value);
  assert.equal(isPersistedNewsEnvelope(replacement === undefined ? value : replacement, 2000), false);
});

test('missing and invalid publication remain distinct from acquisition', () => {
  for (const [state, raw] of [['missing', ''], ['invalid', 'not-a-date']]) {
    const value = fixture();
    Object.assign(value.items[0].provenance, { publicationState: state, publishedAt: null });
    value.items[0].pubDate = raw;
    assert.equal(isPersistedNewsEnvelope(value, 2000), true);
  }
});

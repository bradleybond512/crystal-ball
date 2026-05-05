import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPrecedent,
  buildVocabulary,
  cosineSimilarity,
  eventTokens,
  findAnalogs,
  keyDifferences,
  severityHeuristic,
  tokenize,
  vectorize,
  type HistoricalEvent,
} from '../precedent-matcher.ts';

const NOW = '2026-04-01T00:00:00Z';

function event(overrides: Partial<HistoricalEvent> & { id: string }): HistoricalEvent {
  return {
    id: overrides.id,
    date: overrides.date ?? NOW,
    location: overrides.location ?? 'Mosul, Iraq',
    country: overrides.country ?? 'IQ',
    region: overrides.region ?? 'Middle East',
    eventType: overrides.eventType ?? 'airstrike',
    actors: overrides.actors ?? ['ISIL'],
    intensity: overrides.intensity ?? 'high',
    sector: overrides.sector ?? 'security',
    summary: overrides.summary ?? 'Coalition airstrike on militant compound.',
    aftermath30d: overrides.aftermath30d ?? '',
    aftermath90d: overrides.aftermath90d ?? '',
    source: overrides.source ?? 'fixture',
  };
}

// ── Tokenize ───────────────────────────────────────────────────────────

test('tokenize: lowercases, splits, drops stopwords + 1-char tokens', () => {
  assert.deepEqual(
    tokenize('The Coalition struck a compound in Mosul.'),
    ['coalition', 'struck', 'compound', 'mosul'],
  );
});

test('tokenize: empty / null returns empty', () => {
  assert.deepEqual(tokenize(''), []);
});

test('eventTokens: structured fields are duplicated for weighting', () => {
  const tokens = eventTokens(event({ id: 'a' }));
  // intensity_high should appear twice (structured field weight = 2).
  const high = tokens.filter((t) => t === 'intensity_high');
  assert.equal(high.length, 2);
  // sector_security similarly.
  const sector = tokens.filter((t) => t === 'sector_security');
  assert.equal(sector.length, 2);
});

// ── IDF ───────────────────────────────────────────────────────────────

test('buildVocabulary: rare terms get higher IDF than common ones', () => {
  const corpus = [
    event({ id: 'a', summary: 'common common common' }),
    event({ id: 'b', summary: 'common common common' }),
    event({ id: 'c', summary: 'common rare' }),
  ];
  const vocab = buildVocabulary(corpus);
  const common = vocab.get('common') ?? 0;
  const rare = vocab.get('rare') ?? 0;
  assert.ok(rare > common, `rare (${rare}) should outweigh common (${common})`);
});

test('buildVocabulary: term in every doc still has IDF >= 1 (smoothed)', () => {
  const corpus = [event({ id: 'a' }), event({ id: 'b' })];
  const vocab = buildVocabulary(corpus);
  for (const idf of vocab.values()) assert.ok(idf >= 1);
});

// ── Vectorize + cosine ────────────────────────────────────────────────

test('vectorize: identical events produce identical vectors', () => {
  const a = event({ id: 'a' });
  const b = event({ id: 'b' }); // same content modulo id
  const vocab = buildVocabulary([a, b]);
  const va = vectorize(a, vocab);
  const vb = vectorize(b, vocab);
  // Same token bag → same TF-IDF map.
  assert.equal(va.size, vb.size);
  for (const [t, w] of va) assert.equal(vb.get(t), w);
});

test('cosineSimilarity: identical vectors → 1', () => {
  const a = event({ id: 'a' });
  const vocab = buildVocabulary([a]);
  const va = vectorize(a, vocab);
  assert.ok(Math.abs(cosineSimilarity(va, va) - 1) < 1e-9);
});

test('cosineSimilarity: orthogonal vectors → 0', () => {
  // Fully disjoint structured fields + summaries so no token overlaps.
  const a = event({
    id: 'a', summary: 'apple banana cherry', actors: [], country: 'AAA',
    location: 'aaa', region: 'alpha', eventType: 'fruit', sector: 'food',
    intensity: 'low',
  });
  const b = event({
    id: 'b', summary: 'tractor wrench bolt', actors: [], country: 'BBB',
    location: 'bbb', region: 'beta', eventType: 'tool', sector: 'industrial',
    intensity: 'critical',
  });
  const vocab = buildVocabulary([a, b]);
  const va = vectorize(a, vocab);
  const vb = vectorize(b, vocab);
  assert.equal(cosineSimilarity(va, vb), 0);
});

test('cosineSimilarity: empty vector → 0', () => {
  assert.equal(cosineSimilarity(new Map(), new Map([['x', 1]])), 0);
});

// ── findAnalogs ───────────────────────────────────────────────────────

test('findAnalogs: ranks identical events first', () => {
  const current = event({ id: 'current', country: 'IQ', eventType: 'airstrike', summary: 'Coalition strike on city outskirts.' });
  const corpus = [
    event({ id: 'twin', country: 'IQ', eventType: 'airstrike', summary: 'Coalition strike on city outskirts.', aftermath90d: 'Insurgency reduced 50%.' }),
    event({ id: 'far', country: 'BR', eventType: 'drought', sector: 'food', actors: ['government'], summary: 'Severe drought reduces crop yields.', aftermath90d: 'Food prices up 30%.' }),
  ];
  const vocab = buildVocabulary([current, ...corpus]);
  const corpusVectors = corpus.map((e) => vectorize(e, vocab));
  const analogs = findAnalogs(current, corpus, vocab, corpusVectors, { k: 2, minSimilarity: 0 });
  assert.equal(analogs[0]?.id, 'twin');
  assert.ok((analogs[0]?.similarity ?? 0) > (analogs[1]?.similarity ?? 0));
});

test('findAnalogs: respects minSimilarity floor', () => {
  const current = event({ id: 'current', summary: 'apple banana' });
  const corpus = [
    event({ id: 'unrelated', country: 'XX', eventType: 'unrelated', actors: ['nobody'], summary: 'tractor wrench', sector: 'industrial' }),
  ];
  const vocab = buildVocabulary([current, ...corpus]);
  const corpusVectors = corpus.map((e) => vectorize(e, vocab));
  // High floor — no analogs.
  assert.equal(findAnalogs(current, corpus, vocab, corpusVectors, { minSimilarity: 0.9 }).length, 0);
});

test('findAnalogs: skips the current event when present in corpus', () => {
  const current = event({ id: 'shared' });
  const corpus = [event({ id: 'shared' })];
  const vocab = buildVocabulary([current, ...corpus]);
  const corpusVectors = corpus.map((e) => vectorize(e, vocab));
  assert.equal(findAnalogs(current, corpus, vocab, corpusVectors).length, 0);
});

test('findAnalogs: throws on length mismatch', () => {
  const current = event({ id: 'a' });
  const corpus = [event({ id: 'b' })];
  const vocab = buildVocabulary([current, ...corpus]);
  assert.throws(() => findAnalogs(current, corpus, vocab, [], {}), /length mismatch/);
});

// ── keyDifferences ────────────────────────────────────────────────────

test('keyDifferences: surfaces structured axes that diverge', () => {
  const cur = event({ id: 'a', country: 'IQ', eventType: 'airstrike', intensity: 'high', sector: 'security', actors: ['Coalition', 'ISIL'] });
  const ana = event({ id: 'b', country: 'SY', eventType: 'airstrike', intensity: 'critical', sector: 'security', actors: ['Coalition'] });
  const diffs = keyDifferences(cur, ana);
  assert.ok(diffs.some((d) => d.includes('country')));
  assert.ok(diffs.some((d) => d.includes('intensity')));
  assert.ok(diffs.some((d) => d.includes('actors absent')));
});

test('keyDifferences: identical events → empty', () => {
  const cur = event({ id: 'a' });
  const ana = event({ id: 'b' });
  assert.deepEqual(keyDifferences(cur, ana), []);
});

// ── severityHeuristic ─────────────────────────────────────────────────

test('severityHeuristic: more heavy terms → higher score', () => {
  const a = severityHeuristic('Famine, displacement, war.');
  const b = severityHeuristic('Markets stabilized.');
  assert.ok(a > b);
});

test('severityHeuristic: empty → 0', () => {
  assert.equal(severityHeuristic(''), 0);
});

test('severityHeuristic: counts big numbers (4+ digits or k/m/b)', () => {
  const a = severityHeuristic('5000 displaced');
  const b = severityHeuristic('Five displaced');
  assert.ok(a > b);
});

// ── buildPrecedent ────────────────────────────────────────────────────

test('buildPrecedent: empty aftermaths produces "unknown" worst/best', () => {
  const cur = event({ id: 'a' });
  const out = buildPrecedent(cur, []);
  assert.equal(out.worstCase, 'unknown');
  assert.equal(out.bestCase, 'unknown');
  assert.equal(out.analogs.length, 0);
});

test('buildPrecedent: worst-case is the most-severe analog', () => {
  const cur = event({ id: 'cur' });
  const analogs = [
    { id: 'a', date: NOW, location: 'X', country: 'X', similarity: 0.5,
      summary: '', aftermath30d: '', aftermath90d: 'Markets stabilized.',
      keyDifferences: [], source: 'fixture' as const },
    { id: 'b', date: NOW, location: 'Y', country: 'Y', similarity: 0.4,
      summary: '', aftermath30d: '', aftermath90d: 'Famine, war, 50000 displaced.',
      keyDifferences: [], source: 'fixture' as const },
  ];
  const out = buildPrecedent(cur, analogs);
  assert.match(out.worstCase, /Famine/);
  assert.match(out.bestCase, /stabilized/);
});

// ── JSON serializability ──────────────────────────────────────────────

test('analogs are JSON-serializable', () => {
  const cur = event({ id: 'cur' });
  const corpus = [event({ id: 'a', aftermath90d: 'Famine.' })];
  const vocab = buildVocabulary([cur, ...corpus]);
  const corpusVectors = corpus.map((e) => vectorize(e, vocab));
  const analogs = findAnalogs(cur, corpus, vocab, corpusVectors, { minSimilarity: 0 });
  const round = structuredClone(analogs);
  assert.equal(round[0]?.id, 'a');
});

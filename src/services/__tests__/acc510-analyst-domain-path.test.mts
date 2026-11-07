import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Window } from 'happy-dom';

const happy = new Window({ url: 'https://crystalball.test/' });
Object.assign(globalThis, { window: happy, document: happy.document, localStorage: happy.localStorage,
  Event: happy.Event, CustomEvent: happy.CustomEvent, requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {} });
const { SituationEngine, situationEngine } = await import('../situation-engine.ts');
const { runAnalystCycle } = await import('../analyst-loop.ts');
const { getCalibrationStore, _resetCalibrationForTests } = await import('../intelligence/forecast-calibration-adapter.ts');
const { eventOccurrenceCriteriaFor } = await import('../intelligence/hypothesis-prediction-bridge.ts');
after(async () => { await happy.happyDOM.abort(); });

test('actual analyst cycle carries qualified event types from current evidence without changing compound eligibility', t => {
  const now = 1_790_000_000_000;
  t.mock.method(Date, 'now', () => now);
  localStorage.clear(); _resetCalibrationForTests();
  const engine = new SituationEngine();
  const data = { placeIds: ['USA'], newsEvidence: { articles: [1, 2].map(i => ({ articleId: `article-${i}`,
    sourceId: `source-${i}`, publishedAt: now - 1000, category: 'protest' as const, confidence: 0.8, method: 'keyword' as const })) } };
  engine.observeSignals([
    { id: 'protest', type: 'keyword_spike', title: 'Verified protest reporting', description: '', confidence: 0.8, timestamp: new Date(now), data },
    { id: 'military', type: 'military_surge', title: 'Military observations', description: '', confidence: 0.8, timestamp: new Date(now), data: { placeIds: ['USA'] } },
  ]);
  const situation = engine.getSituations()[0]!;
  assert.equal(situation.domain, 'compound'); assert.equal(situation.domainDiversity, 2);
  t.mock.method(situationEngine, 'getSituations', () => engine.getSituations());
  const hypothesis = runAnalystCycle().hypotheses.find(h => h.kind === 'situation-escalation');
  assert.ok(hypothesis);
  assert.deepEqual(hypothesis.qualifiedEventTypes, ['military-activity', 'civil-unrest']);
  assert.deepEqual(hypothesis.domains, ['conflict']);
  assert.deepEqual(eventOccurrenceCriteriaFor(hypothesis)?.eventTypes, ['military-activity', 'civil-unrest']);
  const prediction = getCalibrationStore().all().find(record => record.sourceId === 'analyst-loop');
  assert.equal(prediction?.criteria?.kind, 'event_occurrence');
  assert.deepEqual(prediction?.criteria && 'eventTypes' in prediction.criteria ? prediction.criteria.eventTypes : null,
    ['military-activity', 'civil-unrest']);
  engine.observeSignals([{ id: 'protest', type: 'keyword_spike', title: 'Unconfirmed topic', description: '',
    confidence: 0.8, timestamp: new Date(now), data: { placeIds: ['USA'] } }]);
  assert.equal(engine.getSituations()[0]!.domainDiversity, 1);
  assert.equal(runAnalystCycle().hypotheses.some(h => h.kind === 'situation-escalation'), false);
});


test('actual analyst cycle preserves mixed-domain abstention and excludes unknown observations from domain support', t => {
  const now = 1_790_000_000_000; t.mock.method(Date, 'now', () => now);
  localStorage.clear(); _resetCalibrationForTests();
  const engine = new SituationEngine();
  engine.observeSignals([
    { id: 'protest', type: 'keyword_spike', title: 'Protest reporting', description: '', confidence: 0.8,
      timestamp: new Date(now), data: { placeIds: ['USA'], newsEvidence: { articles: [1, 2].map(i => ({
        articleId: `article-${i}`, sourceId: `source-${i}`, publishedAt: now - 1000,
        category: 'protest' as const, confidence: 0.8, method: 'keyword' as const })) } } },
    { id: 'economy', type: 'news_leads_markets', title: 'Market observations', description: '',
      confidence: 0.8, timestamp: new Date(now), data: { placeIds: ['USA'] } },
    { id: 'unknown', type: 'convergence', title: 'Unconfirmed topic', description: '',
      confidence: 0.8, timestamp: new Date(now), data: { placeIds: ['USA'] } },
  ]);
  t.mock.method(situationEngine, 'getSituations', () => engine.getSituations());
  const h = runAnalystCycle().hypotheses.find(h => h.kind === 'situation-escalation');
  assert.ok(h); assert.deepEqual(h.domains, ['conflict', 'markets']);
  assert.deepEqual(h.qualifiedEventTypes, ['civil-unrest']);
  assert.equal(eventOccurrenceCriteriaFor(h), undefined);
  assert.equal(getCalibrationStore().all().find(record => record.sourceId === 'analyst-loop')?.criteria, undefined);
});

test('unknown-only situations remain visible without generating analyst event forecasts', t => {
  const now = 1_790_000_000_000; t.mock.method(Date, 'now', () => now);
  localStorage.clear(); _resetCalibrationForTests();
  const engine = new SituationEngine();
  engine.observeSignals(['keyword_spike', 'velocity_spike', 'convergence'].map((type, index) => ({
    id: `unknown-${index}`, type: type as 'keyword_spike' | 'velocity_spike' | 'convergence',
    title: 'Topic not established', description: '', confidence: 0.9,
    timestamp: new Date(now), data: { placeIds: ['USA'] },
  })));
  assert.equal(engine.getSituations().length, 1); assert.equal(engine.getSituations()[0]!.domainDiversity, 0);
  t.mock.method(situationEngine, 'getSituations', () => engine.getSituations());
  assert.equal(runAnalystCycle().hypotheses.some(h => h.kind === 'situation-escalation'), false);
  assert.deepEqual(getCalibrationStore().all(), []);
});

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { CorrelationSignalCore } from '../analysis-core.ts';

const storage = new Map<string, string>();
const now = 1_790_000_000_000;
Object.assign(globalThis, {
  window: { setTimeout: () => 0, addEventListener: () => {} },
  document: { dispatchEvent: () => true, addEventListener: () => {}, hidden: false },
  localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key) },
});
const { SituationEngine } = await import('../situation-engine.ts');
const { identifySignal } = await import('../alert-identity.ts');
const { matchCausalChain, computeSituationConfidence } = await import('../situation-correlator.ts');
const { eventOccurrenceTypesForSignals, qualifiedEventOccurrenceTypes } = await import('../intelligence/event-occurrence-contract.ts');
const { eventOccurrenceCriteriaFor } = await import('../intelligence/hypothesis-prediction-bridge.ts');

beforeEach(t => { storage.clear(); t.mock.method(Date, 'now', () => now); });
function evidence(category = 'protest') {
  return { articles: [1, 2].map(i => ({ articleId: `article-${i}`, sourceId: `source-${i}`,
    publishedAt: now - 1000, category, confidence: 0.8, method: 'keyword' })) };
}
function signal(newsEvidence?: unknown, extra = {}): CorrelationSignalCore {
  return { id: 'same-observation', type: 'keyword_spike', title: 'A long description of correlated reporting that exceeds eighty characters and should get a domain title',
    description: '', confidence: 0.7, timestamp: new Date(now),
    data: { placeIds: ['USA'], newsEvidence, ...extra } } as CorrelationSignalCore;
}

test('generic signals without topical evidence stay visible without verification or a causal claim', () => {
  const engine = new SituationEngine(); engine.observeSignals([signal()]);
  const s = engine.getSituations()[0]!;
  assert.equal(s.domain, 'unknown'); assert.equal(s.domainDiversity, 0);
  assert.equal(s.confidence, 0);
  assert.equal(s.verificationDetails?.independentSources, 0);
  assert.equal(s.verificationDetails?.overallVerdict, 'unverified');
  assert.equal(s.causalChainId, null);
  assert.match(s.title, /Topic unconfirmed/);
});

test('same identity classification revisions replace current domains and titles across restart', () => {
  const original = signal(evidence()); const corrected = signal(evidence('economic'));
  assert.equal(identifySignal(original)?.key, identifySignal(corrected)?.key);
  assert.notEqual(identifySignal(original)?.revision, identifySignal(corrected)?.revision);
  const engine = new SituationEngine(); engine.observeSignals([original]);
  const id = engine.getSituations()[0]!.id;
  assert.equal(engine.getSituations()[0]!.domain, 'civil_unrest');
  engine.observeSignals([corrected]);
  let s = engine.getSituations()[0]!;
  assert.equal(s.id, id); assert.equal(s.signals.length, 1); assert.equal(s.domain, 'economic');
  assert.match(s.title, /Economic/);
  const restarted = new SituationEngine(); restarted.observeSignals([original, corrected]);
  s = restarted.getSituations()[0]!;
  assert.equal(s.domain, 'economic'); assert.equal(s.id, id); assert.equal(s.signals.length, 1);
});

test('unknown signals neither add domain diversity confidence nor match generic unrest triggers', () => {
  const base = { id: 'a', type: 'keyword_spike', title: '', confidence: 0.5, timestamp: now };
  const known = { ...base, domain: 'economic' as const };
  const unknown = { ...base, id: 'b', domain: 'unknown' as const };
  assert.equal(computeSituationConfidence([known, unknown]), computeSituationConfidence([known]));
  assert.equal(matchCausalChain([{ ...base, type: 'velocity_spike', domain: 'unknown' as const }, unknown]), null);
});

test('legacy generic snapshots migrate to unknown without touching rollback v2 history', () => {
  const seed = new SituationEngine(); seed.observeSignals([signal(evidence())]);
  const envelope = JSON.parse(storage.get('wm-situations-v3') ?? storage.get('wm-situations-v2')!);
  envelope.version = 2;
  delete envelope.situations[0].signals[0].newsEvidence;
  delete envelope.situations[0].signals[0].domainClassification;
  const legacy = JSON.stringify(envelope); storage.clear(); storage.set('wm-situations-v2', legacy);
  const restored = new SituationEngine(); const s = restored.getSituations()[0]!;
  assert.equal(s.domain, 'unknown'); assert.equal(s.domainDiversity, 0);
  assert.equal(s.id, envelope.situations[0].id); assert.equal(s.firstSeen, now);
  assert.equal(storage.get('wm-situations-v2'), legacy);
  assert.equal(JSON.parse(storage.get('wm-situations-v3')!).version, 3);
});

test('malformed v3 never falls back to older inferred domain snapshots', () => {
  const seed = new SituationEngine(); seed.observeSignals([signal()]);
  const prior = storage.get('wm-situations-v3') ?? storage.get('wm-situations-v2')!;
  storage.set('wm-situations-v2', prior); storage.set('wm-situations-v3', '{broken');
  const restored = new SituationEngine();
  assert.deepEqual(restored.getSituations(), []); assert.equal(restored.getIdentityDiagnostics().restartProtected, false);
});

test('generic signal type strings alone cannot create civil unrest resolution criteria', () => {
  assert.deepEqual(eventOccurrenceTypesForSignals(['velocity_spike', 'keyword_spike', 'convergence']), []);
  assert.deepEqual(eventOccurrenceTypesForSignals(['military_surge']), ['military-activity']);
  const hypothesis = { kind: 'situation-escalation', domains: ['conflict'], region: 'Ukraine',
    entitySlugs: ['ukraine'], signalTypes: ['keyword_spike'] } as never;
  assert.equal(eventOccurrenceCriteriaFor(hypothesis), undefined);
});


test('raw generic hints and precomputed assertions never bypass contributing article evidence', () => {
  for (const extra of [{ domainHint: 'civil_unrest' }, { domainClassification: {
    version: 1, domain: 'civil_unrest', basis: 'article_classification', reason: 'supported', evidence: evidence().articles,
    articleCount: 2, sourceCount: 2 } }]) {
    storage.clear(); const engine = new SituationEngine(); engine.observeSignals([signal(undefined, extra)]);
    assert.equal(engine.getSituations()[0]!.domain, 'unknown');
  }
});

test('unknown does not provide affinity when only a weak temporal and entity match exists', () => {
  const engine = new SituationEngine();
  engine.observeSignals([signal(undefined, { placeIds: [], relatedTopics: ['shared-topic'] })]);
  engine.observeSignals([{ ...signal(undefined, { placeIds: [], relatedTopics: ['shared-topic'] }),
    id: 'second', timestamp: new Date(now - 3 * 3_600_000) }]);
  assert.equal(engine.getSituations().length, 2);
});

test('current domain recomputation ignores unknown signals and explicitly represents multiple supported domains', () => {
  const engine = new SituationEngine();
  engine.observeSignals([signal(), { ...signal(evidence()), id: 'protest' }]);
  assert.equal(engine.getSituations().length, 1);
  assert.equal(engine.getSituations()[0]!.domain, 'civil_unrest');
  assert.equal(engine.getSituations()[0]!.domainDiversity, 1);
  assert.equal(engine.getSituations()[0]!.verificationDetails?.independentSources, 1);
  assert.equal(engine.getSituations()[0]!.verificationDetails?.crossDomainVerified, false);
  engine.observeSignals([{ ...signal(evidence('economic')), id: 'economy' }]);
  assert.equal(engine.getSituations()[0]!.domain, 'compound');
  assert.equal(engine.getSituations()[0]!.domainDiversity, 2);
});

test('unsupported revisions clear verification and causal output without retaining an old evidence pack', () => {
  const engine = new SituationEngine();
  const a = signal(evidence()); const b = { ...signal(evidence()), id: 'second', type: 'velocity_spike' as const };
  engine.observeSignals([a, b]);
  assert.equal(engine.getSituations()[0]!.causalChainId, 'unrest-economic');
  assert.ok(engine.getSituations()[0]!.evidence);
  engine.observeSignals([{ ...a, data: { placeIds: ['USA'] } }, { ...b, data: { placeIds: ['USA'] } }]);
  const s = engine.getSituations()[0]!;
  assert.equal(s.domain, 'unknown'); assert.equal(s.causalChainId, null); assert.equal(s.evidence, null);
  assert.equal(s.verificationDetails?.independentSources, 0); assert.equal(s.verificationDetails?.temporalCorroboration, false);
});

test('restore validates retained evidence and never upgrades an abstention from its supported subset', () => {
  const cases = [
    (classification: any) => { classification.evidence[0].publishedAt = now + 1; },
    (classification: any) => { classification.evidence[1].sourceId = classification.evidence[0].sourceId; },
    (classification: any) => { classification.domain = 'economic'; },
    (classification: any) => { classification.version = 99; },
    (classification: any) => { classification.domain = 'unknown'; classification.basis = 'abstained'; classification.reason = 'incomplete_evidence'; },
  ];
  for (const corrupt of cases) {
    storage.clear(); const seed = new SituationEngine(); seed.observeSignals([signal(evidence())]);
    const envelope = JSON.parse(storage.get('wm-situations-v3')!);
    corrupt(envelope.situations[0].signals[0].domainClassification);
    storage.set('wm-situations-v3', JSON.stringify(envelope));
    const s = new SituationEngine().getSituations()[0]!;
    assert.equal(s.domain, 'unknown'); assert.equal(s.domainDiversity, 0); assert.equal(s.causalChainId, null);
    assert.equal(s.verificationDetails?.independentSources, 0); assert.deepEqual(s.scenarios, []);
  }
});

test('v2 authoritative source hints are reconstructed rather than trusting stored inferred labels', () => {
  const seed = new SituationEngine(); seed.observeSignals([signal(undefined, { source: 'nws' })]);
  const envelope = JSON.parse(storage.get('wm-situations-v3')!); envelope.version = 2;
  envelope.situations[0].domain = 'civil_unrest'; envelope.situations[0].signals[0].domain = 'civil_unrest';
  storage.clear(); storage.set('wm-situations-v2', JSON.stringify(envelope));
  const s = new SituationEngine().getSituations()[0]!;
  assert.equal(s.domain, 'natural_hazard'); assert.equal(s.signals[0]!.domain, 'natural_hazard');
});

test('current v3 state wins over v2 and preserves dismissal ids across rederived forecasts', () => {
  const engine = new SituationEngine(); engine.observeSignals([signal()]);
  const envelope = JSON.parse(storage.get('wm-situations-v3')!);
  const action = envelope.situations[0].actions[0]; action.dismissed = true;
  storage.set('wm-situations-v3', JSON.stringify(envelope));
  const old = structuredClone(envelope); old.version = 2; old.situations[0].id = 'obsolete-v2';
  storage.set('wm-situations-v2', JSON.stringify(old));
  const s = new SituationEngine().getSituations()[0]!;
  assert.equal(s.id, envelope.situations[0].id); assert.equal(s.actions[0]!.id, action.id);
  assert.equal(s.actions[0]!.dismissed, true);
});

test('persisted provenance is bounded and the complete summary survives restart', () => {
  const articles = Array.from({ length: 64 }, (_, i) => ({ ...evidence().articles[0]!,
    articleId: `article-${i}`, sourceId: `source-${i}` }));
  const engine = new SituationEngine(); engine.observeSignals([signal({ articles })]);
  const s = engine.getSituations()[0]!;
  assert.equal(s.signals[0]!.domainClassification!.evidence.length, 8);
  assert.equal(s.signals[0]!.domainClassification!.articleCount, 64);
  const raw = JSON.parse(storage.get('wm-situations-v3')!);
  assert.equal(raw.situations[0].signals[0].newsEvidence, undefined);
  assert.equal(new SituationEngine().getSituations()[0]!.domain, 'civil_unrest');
});

test('supported topical evidence supplies qualified unrest criteria while retaining geography and entity gates', () => {
  const engine = new SituationEngine(); engine.observeSignals([signal(evidence())]);
  const eventTypes = qualifiedEventOccurrenceTypes(engine.getSituations()[0]!.signals);
  assert.deepEqual(eventTypes, ['civil-unrest']);
  const hypothesis = { kind: 'situation-escalation', domains: ['conflict'], region: 'USA',
    entitySlugs: ['usa'], signalTypes: ['keyword_spike'], qualifiedEventTypes: eventTypes } as any;
  assert.deepEqual(eventOccurrenceCriteriaFor(hypothesis), { kind: 'event_occurrence',
    domains: ['conflict', 'military', 'security'], eventTypes: ['civil-unrest'], entitySlugs: ['usa'], region: 'usa', minEvidence: 2 });
  assert.equal(eventOccurrenceCriteriaFor({ ...hypothesis, region: 'global' } as never), undefined);
  assert.equal(eventOccurrenceCriteriaFor({ ...hypothesis, entitySlugs: ['usa', 'canada'] } as never), undefined);
  assert.equal(eventOccurrenceCriteriaFor({ ...hypothesis, qualifiedEventTypes: ['unsupported'] } as never), undefined);
  assert.equal(eventOccurrenceCriteriaFor({ ...hypothesis, qualifiedEventTypes: ['civil-unrest', 'unsupported'] } as never), undefined);
});


test('typed non-news compound mappings survive restart and revisions', () => {
  const seed = new SituationEngine();
  seed.observeSignals([{ ...signal(), type: 'triangulation' }]);
  assert.equal(seed.getSituations()[0]!.domain, 'compound');
  const restored = new SituationEngine();
  assert.equal(restored.getSituations()[0]!.domain, 'compound');
  restored.observeSignals([{ ...signal(), type: 'triangulation', confidence: 0.8 }]);
  assert.equal(restored.getSituations()[0]!.domain, 'compound');
});


test('oversized or over-count v3 persistence is rejected with degraded restart diagnostics and no fallback', () => {
  const seed = new SituationEngine(); seed.observeSignals([signal()]);
  const good = JSON.parse(storage.get('wm-situations-v3')!);
  const tooManySignals = structuredClone(good);
  tooManySignals.situations[0].signals = Array.from({ length: 4097 }, () => ({ id: 'x', type: 'keyword_spike',
    title: '', confidence: 0.5, timestamp: now, domain: 'civil_unrest' }));
  const cases = [
    ' '.repeat(8 * 1024 * 1024 + 1),
    JSON.stringify({ version: 3, situations: Array.from({ length: 4097 }, () => null), identities: good.identities }),
    JSON.stringify(tooManySignals),
  ];
  for (const raw of cases) {
    storage.clear(); storage.set('wm-situations-v2', JSON.stringify({ ...good, version: 2 }));
    storage.set('wm-situations-v3', raw);
    const restored = new SituationEngine();
    assert.equal(restored.getSituations().length, 0);
    assert.equal(restored.getIdentityDiagnostics().restartProtected, false);
    assert.ok(restored.getIdentityDiagnostics().persistenceFailures > 0);
  }
});

test('persistence capacity failure retains the prior restart snapshot and reports degraded protection', () => {
  const engine = new SituationEngine(); engine.observeSignals([signal(undefined, { source: 'nws' })]);
  const prior = storage.get('wm-situations-v3');
  engine.getSituations()[0]!.summary = 'x'.repeat(8 * 1024 * 1024);
  engine.observeSignals([{ ...signal(undefined, { source: 'nws' }), id: 'separate-report' }]);
  assert.equal(engine.getSituations().length, 2);
  assert.equal(engine.getIdentityDiagnostics().restartProtected, false);
  assert.equal(engine.getIdentityDiagnostics().persistenceFailures, 1);
  assert.equal(storage.get('wm-situations-v3'), prior);
});


test('adding high-confidence unknown news cannot amplify or relabel a supported hazard', () => {
  const engine = new SituationEngine();
  engine.observeSignals([{ ...signal(evidence('disaster')), title: 'Flooding reported', confidence: 0.6 }]);
  const before = structuredClone(engine.getSituations()[0]!);
  engine.observeSignals([{ ...signal(), id: 'unrelated-news', type: 'velocity_spike',
    title: 'Unrelated product launch', confidence: 0.99 }]);
  const after = engine.getSituations()[0]!;
  assert.equal(engine.getSituations().length, 1);
  assert.equal(after.signals.length, 2);
  assert.equal(after.confidence, before.confidence);
  assert.equal(after.title, 'Flooding reported');
  assert.match(after.summary, /^1 correlated natural hazard signal detected:/);
  assert.match(after.summary, /1 signal with unconfirmed topic/);
  assert.equal(after.verificationDetails?.independentSources, before.verificationDetails?.independentSources);
  assert.deepEqual(after.scenarios.map(s => s.probability), before.scenarios.map(s => s.probability));
  const restored = new SituationEngine().getSituations()[0]!;
  assert.equal(restored.confidence, before.confidence);
  assert.equal(restored.title, 'Flooding reported');
});

test('valid v3 envelope above the serialized size limit fails closed independently of JSON validity', () => {
  const seed = new SituationEngine(); seed.observeSignals([signal()]);
  const envelope = JSON.parse(storage.get('wm-situations-v3')!);
  assert.equal(new SituationEngine().getSituations().length, 1);
  storage.set('wm-situations-v2', JSON.stringify({ ...envelope, version: 2 }));
  const raw = JSON.stringify({ ...envelope, padding: 'x'.repeat(8 * 1024 * 1024) });
  assert.ok(raw.length > 8 * 1024 * 1024);
  assert.equal(JSON.parse(raw).version, 3);
  storage.set('wm-situations-v3', raw);
  const restored = new SituationEngine();
  assert.equal(restored.getSituations().length, 0);
  assert.equal(restored.getIdentityDiagnostics().restartProtected, false);
  assert.equal(restored.getIdentityDiagnostics().persistenceFailures, 1);
});

test('valid v3 situations above the entry limit fail closed independently of row validation and size', () => {
  const seed = new SituationEngine(); seed.observeSignals([signal()]);
  const original = seed.getSituations()[0]!;
  const row = { ...original, title: '', summary: '', scenarios: [], actions: [], signals: [], signalIds: [] };
  const situations = Array.from({ length: 4097 }, (_, index) => ({ ...row, id: `entry-${index}` }));
  const identities = { version: 1, entries: [] };
  storage.set('wm-situations-v3', JSON.stringify({ version: 3, situations: situations.slice(0, 4096), identities }));
  const withinLimit = new SituationEngine();
  assert.equal(withinLimit.getSituations().length, 20);
  assert.equal(withinLimit.getIdentityDiagnostics().restartProtected, true);
  assert.equal(withinLimit.getIdentityDiagnostics().persistenceFailures, 0);
  const raw = JSON.stringify({ version: 3, situations, identities });
  assert.ok(raw.length < 8 * 1024 * 1024);
  storage.set('wm-situations-v3', raw);
  const restored = new SituationEngine();
  assert.equal(restored.getSituations().length, 0);
  assert.equal(restored.getIdentityDiagnostics().restartProtected, false);
  assert.equal(restored.getIdentityDiagnostics().persistenceFailures, 1);
});

test('valid v3 signals above the per-situation limit fail closed independently of signal validation', () => {
  const seed = new SituationEngine(); seed.observeSignals([signal()]);
  const envelope = JSON.parse(storage.get('wm-situations-v3')!);
  const signals = Array.from({ length: 4097 }, (_, index) => ({ id: `signal-${index}`, type: 'keyword_spike',
    title: '', confidence: 0.5, timestamp: now, domain: 'unknown' }));
  envelope.situations[0].signals = signals.slice(0, 4096);
  envelope.situations[0].signalIds = envelope.situations[0].signals.map((entry: { id: string }) => entry.id);
  envelope.identities = { version: 1, entries: [] };
  storage.set('wm-situations-v3', JSON.stringify(envelope));
  const withinLimit = new SituationEngine();
  assert.equal(withinLimit.getSituations()[0]!.signals.length, 4096);
  assert.equal(withinLimit.getIdentityDiagnostics().restartProtected, true);
  assert.equal(withinLimit.getIdentityDiagnostics().persistenceFailures, 0);
  envelope.situations[0].signals = signals;
  envelope.situations[0].signalIds = signals.map(entry => entry.id);
  const raw = JSON.stringify(envelope);
  assert.ok(raw.length < 8 * 1024 * 1024);
  storage.set('wm-situations-v3', raw);
  const restored = new SituationEngine();
  assert.equal(restored.getSituations().length, 0);
  assert.equal(restored.getIdentityDiagnostics().restartProtected, false);
  assert.equal(restored.getIdentityDiagnostics().persistenceFailures, 1);
});

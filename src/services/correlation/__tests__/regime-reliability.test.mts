import test, { before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as calibration from '../correlation-calibration';
import { islandLedgerMult } from '../island-calibration';
import { createForecastCalibrationStore } from '../../intelligence/forecast-calibration';
import { getCorrelationRegime, startRegimeMonitor, _resetRegimeMonitorForTests } from '../../cognition/regime-monitor';
import { startPressureHistory } from '../../pressure-history';
import { notificationDispatcher } from '../../notification-dispatcher';
import { setCognitionEnabled } from '../../cognition/cognition-settings';

const T0 = Date.UTC(2026, 10, 5);
const MINUTE = 60_000;
let now = T0;
const storage = new Map<string,string>();
const doc = new EventTarget();
const originals = new Map(['document', 'localStorage'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
before(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) } });
  mock.method(Date, 'now', () => now);
  mock.method(notificationDispatcher, 'dispatchNotification', () => undefined);
  startPressureHistory();
});
after(() => {
  _resetRegimeMonitorForTests(); mock.restoreAll();
  for (const [k,d] of originals) { if (d) Object.defineProperty(globalThis,k,d); else delete globalThis[k]; }
});
beforeEach(() => {
  now += 86_400_000; storage.clear(); calibration.resetCorrelationCalibration();
  _resetRegimeMonitorForTests(); startRegimeMonitor();
});
function regime(kind = 'calm') {
  for (let i=0;i<30;i++) {
    now += 120_000;
    doc.dispatchEvent(new CustomEvent('cb:mode-advisory', { detail: { timestamp: now, pressure: { finance: 0, security: 0, disaster: 0, cyber: 0 } } }));
  }
  if (kind === 'shifted') {
    now += 120_000;
    doc.dispatchEvent(new CustomEvent('cb:mode-advisory', { detail: { timestamp: now, pressure: { finance: 1, security: 0, disaster: 0, cyber: 0 } } }));
  }
  assert.equal(getCorrelationRegime(now),kind);
}
function prediction(id, overrides = {}) { return { id, sourceId: 'corr-rule:r', domain: 'weather', claim: id, probability: .9, predictedAt: now-1, resolveBy: now+MINUTE, status: 'pending', ...overrides }; }
function resolve(id, outcome, overrides = {}) {
  calibration.recordCalibrationPrediction(prediction(id,overrides));
  assert.equal(calibration.resolveCalibrationPrediction(id,outcome,now),true);
}
function diagnostic(rule='r', at=now) {
  assert.equal(typeof calibration.reliabilityDiagnosticsForRule,'function');
  return calibration.reliabilityDiagnosticsForRule(rule,at);
}

test('outcome writer tags at resolution and never rewrites an existing outcome', () => {
  regime(); resolve('a',true);
  assert.equal(calibration.getCorrelationCalibrationStore().get('a').outcomeRegime,'calm');
  regime('shifted');
  assert.equal(calibration.resolveCalibrationPrediction('a',false,now),false);
  assert.equal(calibration.getCorrelationCalibrationStore().get('a').outcomeRegime,'calm');
  resolve('b',false);
  assert.equal(calibration.getCorrelationCalibrationStore().get('b').outcomeRegime,'shifted');
  calibration.resetCorrelationCalibration();
  assert.equal(calibration.getCorrelationCalibrationStore().get('a').outcomeRegime,'calm');
  assert.equal(calibration.getCorrelationCalibrationStore().get('b').outcomeRegime,'shifted');
});

test('pair resolver stamps same outcome-time tag', () => {
  regime();
  const obs = id => ({ id, sourceId:'s',domain:'weather',timestamp:now,severity:'HIGH',title:id,raw:null,entityIds:[],tags:[] });
  const pair={ ruleId:'pair',edgeType:'causal-candidate',eventA:obs('a'),eventB:obs('b'),confidence:.9,detectedAt:new Date(now) };
  assert.equal(calibration.recordPairPrediction(pair,now),true);
  const result=calibration.resolvePairPredictions([{ observations:[obs('a'),obs('b'),obs('c')],edges:[{confidence:.8},{confidence:.7}],status:'active' }],now);
  assert.equal(result.resolved,1);
  assert.equal(calibration.getCorrelationCalibrationStore().all()[0].outcomeRegime,'calm');
});

test('five outcomes select the regime; four retain pooled reliability', () => {
  regime(); for(let i=0;i<6;i++)resolve(`c${i}`,true);
  regime('shifted'); for(let i=0;i<4;i++)resolve(`s${i}`,false);
  let d=diagnostic(); assert.equal(d.selected,'pooled'); assert.equal(d.reason,'sparse-regime');
  assert.equal(d.overall.resolvedCount,10); assert.equal(d.shifted.resolvedCount,4); assert.equal(d.multiplier,.84);
  resolve('s4',false); d=diagnostic(); assert.equal(d.selected,'shifted'); assert.equal(d.multiplier,.5);
  assert.equal(d.shifted.brier,.81); assert.equal(d.calm.brier,.01);
  regime(); assert.equal(calibration.reliabilityForRule('r',now),1.48);
});

test('unknown regimes and legacy data use the exact pooled score, sparse overall stays neutral', () => {
  for(let i=0;i<4;i++)resolve(`legacy${i}`,true);
  assert.equal(diagnostic().selected,'neutral'); assert.equal(diagnostic().multiplier,1);
  resolve('legacy4',true); assert.equal(diagnostic().selected,'pooled'); assert.equal(diagnostic().reason,'unknown-regime'); assert.equal(diagnostic().multiplier,1.48);
  regime(); assert.equal(diagnostic().selected,'pooled'); assert.equal(diagnostic().calm.resolvedCount,0,'no retroactive tagging');
});

test('current switch and staleness take effect inside the score cache lifetime', () => {
  regime(); for(let i=0;i<6;i++)resolve(`c${i}`,true);
  regime('shifted'); for(let i=0;i<6;i++)resolve(`s${i}`,false);
  assert.equal(diagnostic().multiplier,.5);
  setCognitionEnabled('bocpd',false);
  assert.equal(diagnostic().multiplier,.68); assert.equal(diagnostic().reason,'unknown-regime');
  setCognitionEnabled('bocpd',true);
  assert.equal(diagnostic().multiplier,.5);
  assert.equal(diagnostic('r',now+240_001).multiplier,.68);
});

test('pending, expired, malformed and missing-time tags never form regime cohorts', () => {
  regime(); const store=calibration.getCorrelationCalibrationStore();
  const rows=[prediction('pending',{outcomeRegime:'calm'}),prediction('expired',{status:'expired',outcomeRegime:'calm',resolvedAt:now}),prediction('bad',{status:'resolved_true',outcomeRegime:'invalid',resolvedAt:now}),prediction('untimed',{status:'resolved_true',outcomeRegime:'calm'})];
  store.loadJson(rows);
  for(const row of store.all())assert.equal(row.outcomeRegime,undefined,row.id);
  assert.equal(diagnostic().calm.resolvedCount,0);
  assert.equal(diagnostic().overall.resolvedCount,2);
  store.record(prediction('record-injection',{outcomeRegime:'shifted'}));
  assert.equal(store.get('record-injection').outcomeRegime,undefined);
  store.resolve('record-injection',true,now,undefined,'invalid');
  assert.equal(store.get('record-injection').outcomeRegime,undefined);
});

test('direct store writes and loads invalidate aggregate cache without waiting', () => {
  const store=calibration.getCorrelationCalibrationStore();
  assert.equal(diagnostic().overall.resolvedCount,0);
  for(let i=0;i<5;i++){store.record(prediction(`d${i}`));store.resolve(`d${i}`,false,now);}
  assert.equal(diagnostic().multiplier,.5);
  store.loadJson([]); assert.equal(diagnostic().overall.resolvedCount,0); assert.equal(diagnostic().multiplier,1);
});

test('rollback excludes future labels and forward time admits them at the exact boundary', () => {
  const store=calibration.getCorrelationCalibrationStore();
  for(let i=0;i<5;i++)store.record(prediction(`future${i}`,{predictedAt:now-1000,status:'resolved_false',resolvedAt:now+1000,outcomeRegime:'shifted'}));
  assert.equal(diagnostic().overall.resolvedCount,0);
  assert.equal(diagnostic('r',now+1000).multiplier,.5);
  assert.equal(diagnostic('r',now+999).overall.resolvedCount,0);
  assert.equal(diagnostic('r',now+1000).overall.resolvedCount,5);
  store.loadJson([prediction('future-issued',{predictedAt:now+1000,status:'resolved_true',resolvedAt:now})]);
  assert.equal(diagnostic().overall.resolvedCount,0);
});

test('future and historical resolution arguments cannot stamp current regime evidence', () => {
  regime();
  calibration.recordCalibrationPrediction(prediction('future'));
  calibration.resolveCalibrationPrediction('future',true,now+1);
  assert.equal(calibration.getCorrelationCalibrationStore().get('future').outcomeRegime,undefined);
  calibration.recordCalibrationPrediction(prediction('past',{predictedAt:now-1000}));
  calibration.resolveCalibrationPrediction('past',true,now-1);
  assert.equal(calibration.getCorrelationCalibrationStore().get('past').outcomeRegime,undefined);
});

test('directional keys stay independent and persistence retains the 400-record cap', () => {
  regime();
  for(let i=0;i<5;i++){ resolve(`up${i}`,true,{sourceId:'corr-rule:island:up'});resolve(`down${i}`,false,{sourceId:'corr-rule:island:down'}); }
  assert.equal(calibration.reliabilityForRule('island:up',now),1.48);assert.equal(calibration.reliabilityForRule('island:down',now),.5);
  for(let i=0;i<405;i++)calibration.recordCalibrationPrediction(prediction(`cap${i}`,{predictedAt:now+i}));
  assert.equal(calibration.getCorrelationCalibrationStore().all().length,400);
  calibration.resetCorrelationCalibration(); assert.equal(calibration.getCorrelationCalibrationStore().all().length,400);
});

test('shared store revisions advance only when state changes', () => {
  const store=createForecastCalibrationStore();
  assert.equal(typeof store.revision,'function');
  const start=store.revision();store.record(prediction('x'));assert.equal(store.revision(),start+1);
  store.record(prediction('x'));assert.equal(store.revision(),start+1);
  store.resolve('x',true,now);assert.equal(store.revision(),start+2);
  assert.equal(store.resolve('x',false,now),false);assert.equal(store.revision(),start+2);
  store.record(prediction('y',{resolveBy:now-1})); const beforeExpiry=store.revision();
  assert.equal(store.expirePending(now),1); assert.equal(store.revision(),beforeExpiry+1);
  store.loadJson([]);assert.equal(store.revision(),beforeExpiry+2);
});


test('cache expires at sixty seconds exactly and diagnostics cannot mutate it', t => {
  regime();
  for(let i=0;i<5;i++)resolve(`cached${i}`,true);
  const store=calibration.getCorrelationCalibrationStore();
  const originalAll=store.all; let reads=0;
  t.mock.method(store,'all',() => { reads++; return originalAll(); });
  const d=diagnostic(); assert.equal(reads,1);
  assert.equal(d.selected,'calm'); assert.equal(d.calm.resolvedCount,5);
  d.overall.multiplier=99; d.calm.multiplier=99; d.calm.resolvedCount=999; d.shifted.resolvedCount=999;
  const cached=diagnostic('r',now+59_999);
  assert.equal(cached.multiplier,1.48); assert.equal(cached.overall.multiplier,1.48);
  assert.equal(cached.calm.resolvedCount,5); assert.equal(cached.shifted.resolvedCount,0); assert.equal(reads,1);
  assert.equal(diagnostic('r',now+60_000).calm.resolvedCount,5); assert.equal(reads,2);
});


test('island crossfade counts only outcomes eligible at the same decision time', () => {
  const store=calibration.getCorrelationCalibrationStore();
  const sourceId='corr-rule:island:x|y';
  const row=(i,resolvedAt) => prediction(`crossfade${i}`, { sourceId, status:'resolved_false', predictedAt:now-1000, resolvedAt });
  store.loadJson(Array.from({length:5},(_,i) => row(i,now+1000)));
  assert.equal(diagnostic('island:x|y').overall.resolvedCount,0);
  assert.equal(islandLedgerMult('x|y',now),null,'future labels cannot replace existing feedback');
  store.loadJson(Array.from({length:5},(_,i) => row(i,i<4 ? now : now+1000)));
  assert.equal(calibration.resolvedCountForRule('island:x|y',now),4);
  assert.equal(islandLedgerMult('x|y',now),null,'four eligible outcomes retain existing feedback');
  assert.equal(calibration.resolvedCountForRule('island:x|y',now+1000),5);
  assert.equal(islandLedgerMult('x|y',now+1000),.5,'fifth label governs exactly when available');
  assert.equal(islandLedgerMult('x|y',now+999),null,'clock rollback restores the legacy path');
  assert.equal(islandLedgerMult('x|y',now+1000),.5);
});

test('future ledger outcomes cannot re-enable an actually dismissed island rule', async t => {
  const { unifiedAlertStore }=await import('../../unified-alerts');
  const { startCorrelationFeedback, getPairFeedbackMult }=await import('../../correlation-feedback');
  const { startAlertCorrelator, stopAlertCorrelator }=await import('../../alert-correlator');
  const pairKey='earthquake|tsunami';
  storage.set('crystalball-intel-provider','local-only');
  storage.set('crystalball-correlation-feedback-v1',JSON.stringify({[pairKey]:{ack:5,fastAck:5,pinned:0}}));
  const alert=(id,source,title,timestamp) => ({id,source,title,timestamp,body:'fixture',severity:'high',location:{lat:35,lon:139},relevanceScore:90,acknowledged:false,pinned:false});
  const alerts=[alert('review-quake','earthquake','M7.5 earthquake',now-2000),alert('review-wave','tsunami','Tsunami detected',now-1000)];
  const ingested=[];
  t.mock.method(unifiedAlertStore,'getAll',() => alerts);
  t.mock.method(unifiedAlertStore,'subscribe',() => () => undefined);
  t.mock.method(unifiedAlertStore,'ingest',rows => ingested.push(...rows));
  t.mock.method(globalThis,'fetch',async () => {throw new Error('network prohibited in regression');});
  startCorrelationFeedback();
  assert.equal(getPairFeedbackMult(pairKey),.5,'real legacy feedback contains five fast dismissals');
  const store=calibration.getCorrelationCalibrationStore();
  store.loadJson(Array.from({length:5},(_,i) => prediction(`dismissed${i}`,{sourceId:`corr-rule:island:${pairKey}`,status:'resolved_false',predictedAt:now-1000,resolvedAt:now+1000})));
  let initialScan;
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setInterval:() => 0,setTimeout:fn => {initialScan=fn;return 0;}}});
  try {
    startAlertCorrelator();
    assert.equal(typeof initialScan,'function');
    initialScan();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(ingested,[],'future outcomes must not revive the suppressed earthquake-to-tsunami rule');
  } finally {
    stopAlertCorrelator();
    if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;
  }
});

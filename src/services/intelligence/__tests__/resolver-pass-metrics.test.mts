import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createForecastCalibrationStore, type PredictionRecord } from '../forecast-calibration.ts';
import * as outcome from '../outcome-resolvers.ts';
import { settleCalibrationBridges } from '../calibration-bridge-wiring.ts';
import { getEvidenceOutbox } from '../evidence-outbox.ts';
import * as adapter from '../forecast-calibration-adapter.ts';

const now = 10_000_000;
const minute = 60_000;
function row(id: string, delay: number, symbol = 'MSFT'): PredictionRecord {
  return { id, predictedAt: 100, resolveBy: now - delay, probability: 0.55, status: 'pending',
    domain: 'markets', claim: 'private forecast', sourceId: 'private-source',
    criteria: { kind: 'market_move', symbol, direction: 'up', minAbsPct: 2, basisPrice: 100, basisObservedAt: 100 } };
}
const context = { now, spotHistoryFor: () => [], queryObservations: () => [] };

test('actual resolver calls distinguish overdue clocks, eligible writes, unsupported, open and evidence-blocked forecasts', () => {
  const store = createForecastCalibrationStore();
  const rows = [row('exact-deadline',0), row('diagnostic-boundary',15*minute), row('expiry-boundary',30*minute),
    row('mature-expire',30*minute+1), row('unsupported',40*minute), row('bad-criteria',42*minute,'??'),
    row('early-direct',-minute), row('also-direct',-minute), row('proxy',minute),row('denied',2*minute)];
  delete rows[4]!.criteria;
  rows.forEach(p => store.record(p));
  const seen: string[] = [];
  const resolver: outcome.OutcomeResolver = {
    id:'unit',canResolve: () => true,
    resolve: (r) => {
      seen.push(r.id);
      if (!['early-direct','also-direct','proxy','denied'].includes(r.id)) return null;
      const kind = r.id === 'proxy' ? 'proxy' : 'direct';
      return { outcome:true, metadata:{ note:kind + ': fixture',provenance:{kind,resolverId:'unit',evidence:[{sourceIds:['fixture'],observedAt:101,supportsOutcome:true}] } } };
    },
  };
  const realResolve = store.resolve;
  store.resolve = (id,...args) => id !== 'denied' && realResolve(id,...args);
  const m = outcome.measureOutcomeResolvers(store, context, [resolver]);
  assert.equal(seen.length,9);
  assert.equal(new Set(seen).size,9);
  assert.deepEqual(m,{
    pending:10,rawOverdueBefore:7,rawOverdueAfter:4,diagnosticOverdueBefore:4,diagnosticOverdueAfter:2,
    pastExpiryGrace:3,eligibleOverdueBefore:3,eligibleOverdueAfter:1,opportunities:5,
    unsupported:1,invalidCriteria:1,awaitingEvidence:3,windowOpen:0,rejectedWrites:1,
    expired:2,direct:2,proxy:1,unattributed:0,persistenceFailures:0,
  });
  assert.equal(store.get('bad-criteria')?.status,'expired','retain existing terminal policy independently of admissible opportunities');
  assert.doesNotMatch(JSON.stringify(m),/MSFT|private|early-direct|bad-criteria/);
});

test('due-only catch-up and quota refusal retain the original pending row and report no committed label', () => {
  const prev = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  let attempts = 0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:()=>null,
    setItem:()=>{ attempts++; throw Error('quota'); },
  }});
  try {
    adapter._resetCalibrationForTests();
    const store = adapter.getCalibrationStore();
    store.record(row('private',31*minute));
    assert.equal(adapter.hasDueCalibrationWork(now-32*minute),false);
    assert.equal(adapter.hasDueCalibrationWork(now-31*minute),true);
    assert.equal(adapter.isCalibrationSnapshotCurrent(),true);
    const m = adapter.dispatchMeasuredOutcomeResolvers(context, [outcome.marketMoveResolver]);
    assert.equal(attempts,1,'reaches the real storage write');
    assert.equal(m.persistenceFailures,1);
    assert.equal(m.pending,1);
    assert.equal(m.opportunities,1);
    assert.equal(m.eligibleOverdueAfter,1);
    assert.equal(m.expired,0);
    assert.equal(store.get('private')?.status,'pending');
  } finally {
    if(prev)Object.defineProperty(globalThis,'localStorage',prev);
    else Reflect.deleteProperty(globalThis,'localStorage');
    adapter._resetCalibrationForTests();
  }
});

test('hourly bridge counts actual expiries, partial failures and disabled generic sweeps separately', () => {
  const deps = { enabled:()=>true,settleShortage:()=>3,settleAdvisory:()=>{throw Error('x');},expirePending:()=>2 };
  assert.deepEqual(settleCalibrationBridges(deps),{enabled:true,shortageExpired:3,advisoryExpired:0,legacyExpired:2,failed:true});
  assert.deepEqual(settleCalibrationBridges({...deps,enabled:()=>false}),{enabled:false,shortageExpired:0,advisoryExpired:0,legacyExpired:2,failed:false});
});

test('a stale window cannot overwrite a peer ledger changed during a measured pass', t => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const key = 'crystalball-forecast-calibration-v1';
  const data = new Map<string,string>([[key, '[]']]);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(k:string)=>data.get(k) ?? null, setItem:(k:string,v:string)=>data.set(k,v),
  }});
  try {
    adapter._resetCalibrationForTests();
    assert.equal(adapter.isCalibrationSnapshotCurrent(),true);
    adapter.recordPrediction(row('in-window',minute));
    const old = adapter.getCalibrationStore().get('in-window')!;
    const peer = JSON.stringify([row('peer-only',minute)]);
    const probe = { id:'unit',canResolve:()=>true,resolve:()=>{
      data.set(key,peer);
      return {outcome: true, metadata:{note:'direct: fixture',provenance:{kind:'direct' as const,resolverId:'unit',evidence:[{sourceIds:['fixture'],observedAt:101,supportsOutcome:true}]}}};
    } };
    const capture = t.mock.method(getEvidenceOutbox(),'capture');
    const m = adapter.dispatchMeasuredOutcomeResolvers(context,[probe]);
    assert.equal(capture.mock.callCount(),0,'discarded labels never enter the evidence outbox');
    assert.equal(data.get(key),peer,'an in-flight peer write survives');
    assert.equal(m.persistenceFailures,1);
    assert.equal(m.direct,0,'a staged verdict is not a committed direct label');
    assert.ok(old.status === 'pending');
    assert.equal(adapter.getCalibrationStore().get('in-window'), undefined, 'honor peer deletion');
    assert.equal(adapter.getCalibrationStore().get('peer-only')?.status,'pending');
    adapter.recordPrediction(row('ordinary-writer', minute));
    const durable = JSON.parse(data.get(key)!);
    assert.ok(durable.some(r=>r.id==='peer-only'));
    assert.ok(!durable.some(r=>r.id==='in-window'));
    assert.ok(durable.some(r=>r.id==='ordinary-writer'));
    adapter._resetCalibrationForTests();
    assert.equal(adapter.isCalibrationSnapshotCurrent(),true);
    data.set(key,'not an array');
    assert.equal(adapter.isCalibrationSnapshotCurrent(),false);
    adapter._resetCalibrationForTests();
    assert.equal(adapter.isCalibrationSnapshotCurrent(),false);
  } finally {
    if(prev)Object.defineProperty(globalThis,'localStorage',prev);
    else Reflect.deleteProperty(globalThis,'localStorage');
    adapter._resetCalibrationForTests();
  }
});

test('a committed measured pass publishes only the changed row after durable direct provenance exists', t => {
  const key = 'crystalball-forecast-calibration-v1';
  const history = new Map<string,string>();
  const prev = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(k:string)=>history.get(k) ?? null,
    setItem:(k:string,v:string)=>history.set(k,v),
  }});
  try {
    adapter._resetCalibrationForTests();
    const store = adapter.getCalibrationStore();
    store.record(row('positive-control',0));
    const published: string[] = [];
    t.mock.method(getEvidenceOutbox(),'capture', change => {
      if (change.kind === 'forecast') {
        const durable = JSON.parse(history.get(key) ?? '[]');
        assert.equal(durable.find(r=>r.id===change.record.id)?.status,'resolved_true');
        published.push(change.record.id);
      }
    });
    const sample = { symbol:'MSFT',price:104,observedAt:now-1,providerIds:['fixture'],independentSourceCount:1,confidence:0.9 };
    const m = adapter.dispatchMeasuredOutcomeResolvers({...context,spotHistoryFor:()=>[sample]},[outcome.marketMoveResolver]);
    assert.deepEqual(published,['positive-control']);
    assert.equal(m.direct,1);
    assert.equal(m.persistenceFailures,0);
    assert.equal(store.get('positive-control')?.resolutionProvenance?.kind,'direct');
    assert.equal(adapter.isCalibrationSnapshotCurrent(),true);
  } finally {
    if(prev)Object.defineProperty(globalThis,'localStorage',prev);
    else Reflect.deleteProperty(globalThis,'localStorage');
    adapter._resetCalibrationForTests();
  }
});

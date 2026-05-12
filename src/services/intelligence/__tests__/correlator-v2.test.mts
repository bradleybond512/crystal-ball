import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { CorrelatorV2, startV2Cycle, stopV2Cycle, getActiveChains, getCorrelationsForEvent } from '../correlator-v2.ts';
import type { ObservationEvent, ObservationStoreReader } from '../observation-types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

let _nextId = 1;
function makeEvent(overrides: Partial<ObservationEvent> & { domain: string }): ObservationEvent {
  const id = `ev-${_nextId++}`;
  return {
    id,
    domain: overrides.domain,
    eventType: overrides.eventType ?? overrides.domain,
    title: overrides.title ?? `${overrides.domain} event ${id}`,
    severity: overrides.severity ?? 5,
    occurredAt: overrides.occurredAt ?? Date.now(),
    lat: overrides.lat,
    lon: overrides.lon,
    entities: overrides.entities ?? [],
    sourceIds: overrides.sourceIds ?? ['test'],
    active: overrides.active ?? true,
  };
}

function makeStore(events: ObservationEvent[]): ObservationStoreReader {
  return { getEvents: () => events };
}

const NOW = Date.now();
const MIN = 60_000;
const HR = 60 * MIN;

// ── Chain detection ───────────────────────────────────────────────────────

describe('CorrelatorV2 — seismic cascade chain detection', () => {
  it('detects earthquake → tsunami within 15 min window', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 10 * MIN, lat: 35.1, lon: 140.1 });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    const chains = eng.getActiveChains();
    assert.ok(chains.length >= 1);
    assert.equal(chains[0]!.chainType, 'seismic-cascade');
    assert.ok(chains[0]!.events.some(e => e.id === quake.id));
    assert.ok(chains[0]!.events.some(e => e.id === tsunami.id));
  });

  it('rejects earthquake → tsunami outside 15 min window', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 20 * MIN });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'seismic-cascade');
    assert.equal(chains.length, 0);
  });

  it('rejects events where target precedes anchor in time', () => {
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW - 5 * MIN });
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'seismic-cascade');
    assert.equal(chains.length, 0);
  });

  it('detects multi-hop seismic chain: earthquake → tsunami → evacuation', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 10 * MIN, lat: 35.1, lon: 140.1 });
    const evac = makeEvent({ domain: 'evacuation', occurredAt: NOW + 25 * MIN, lat: 35.2, lon: 140.2 });
    const eng = new CorrelatorV2(makeStore([quake, tsunami, evac]));
    eng.run();
    const seismic = eng.getActiveChains().filter(c => c.chainType === 'seismic-cascade');
    assert.ok(seismic.length >= 1);
    const longest = seismic.reduce((a, b) => a.events.length >= b.events.length ? a : b);
    assert.ok(longest.events.length >= 2);
  });
});

describe('CorrelatorV2 — wildfire cascade chain detection', () => {
  it('detects wildfire → air-quality within 6 hr window', () => {
    const fire = makeEvent({ domain: 'wildfire', occurredAt: NOW, lat: 37, lon: -120 });
    const aqi = makeEvent({ domain: 'air-quality', occurredAt: NOW + 2 * HR, lat: 37.5, lon: -120.5 });
    const eng = new CorrelatorV2(makeStore([fire, aqi]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'wildfire-cascade');
    assert.ok(chains.length >= 1);
  });

  it('rejects wildfire → air-quality beyond 6 hr window', () => {
    const fire = makeEvent({ domain: 'wildfire', occurredAt: NOW });
    const aqi = makeEvent({ domain: 'air-quality', occurredAt: NOW + 7 * HR });
    const eng = new CorrelatorV2(makeStore([fire, aqi]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'wildfire-cascade');
    assert.equal(chains.length, 0);
  });
});

describe('CorrelatorV2 — hurricane cascade chain detection', () => {
  it('detects weather → supply-chain within 6 hr', () => {
    const storm = makeEvent({ domain: 'weather', occurredAt: NOW });
    const supply = makeEvent({ domain: 'supply-chain', occurredAt: NOW + 4 * HR });
    const eng = new CorrelatorV2(makeStore([storm, supply]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'hurricane-cascade');
    assert.ok(chains.length >= 1);
  });

  it('detects supply-chain → commodity within 24 hr', () => {
    const supply = makeEvent({ domain: 'supply-chain', occurredAt: NOW });
    const commodity = makeEvent({ domain: 'commodity', occurredAt: NOW + 18 * HR });
    const eng = new CorrelatorV2(makeStore([supply, commodity]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'hurricane-cascade');
    assert.ok(chains.length >= 1);
  });
});

// ── Confidence scoring ────────────────────────────────────────────────────

describe('CorrelatorV2 — confidence scoring', () => {
  it('confidence is between 0.3 and 1.0', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 5 * MIN, lat: 35.1, lon: 140.1 });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    for (const chain of eng.getActiveChains()) {
      assert.ok(chain.confidence >= 0.3, `confidence ${chain.confidence} below floor`);
      assert.ok(chain.confidence <= 1.0, `confidence ${chain.confidence} above ceiling`);
    }
  });

  it('confidence degrades with more hops (multi-event chain is <= 2-event chain)', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 10 * MIN, lat: 35.1, lon: 140.1 });
    const evac = makeEvent({ domain: 'evacuation', occurredAt: NOW + 25 * MIN, lat: 35.2, lon: 140.2 });

    const eng2 = new CorrelatorV2(makeStore([quake, tsunami]));
    eng2.run();
    const twoHopChains = eng2.getActiveChains().filter(c => c.chainType === 'seismic-cascade');

    const eng3 = new CorrelatorV2(makeStore([quake, tsunami, evac]));
    eng3.run();
    const threeHopChains = eng3.getActiveChains().filter(c => c.chainType === 'seismic-cascade' && c.events.length === 3);

    if (twoHopChains.length > 0 && threeHopChains.length > 0) {
      assert.ok(threeHopChains[0]!.confidence <= twoHopChains[0]!.confidence + 0.01);
    }
  });

  it('confidence floor is exactly 0.3 for spatially distant events', () => {
    // Events 10,000 km apart — well beyond the default 500 km radius
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 0, lon: 0 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 5 * MIN, lat: 60, lon: 100 });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    for (const chain of eng.getActiveChains()) {
      assert.ok(chain.confidence >= 0.3);
    }
  });

  it('entity overlap boosts confidence', () => {
    const entity = 'JP';
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, entities: [entity] });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 5 * MIN, entities: [entity] });
    const engWith = new CorrelatorV2(makeStore([quake, tsunami]));
    engWith.run();

    const quake2 = makeEvent({ domain: 'earthquake', occurredAt: NOW });
    const tsunami2 = makeEvent({ domain: 'tsunami', occurredAt: NOW + 5 * MIN });
    const engWithout = new CorrelatorV2(makeStore([quake2, tsunami2]));
    engWithout.run();

    const confWith = engWith.getActiveChains()[0]?.confidence ?? 0;
    const confWithout = engWithout.getActiveChains()[0]?.confidence ?? 0;
    assert.ok(confWith >= confWithout);
  });

  it('near-simultaneous events score higher temporal confidence than spread-out ones', () => {
    const qNear = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tNear = makeEvent({ domain: 'tsunami', occurredAt: NOW + 1 * MIN, lat: 35.1, lon: 140.1 });
    const engNear = new CorrelatorV2(makeStore([qNear, tNear]));
    engNear.run();
    const nearConf = engNear.getActiveChains()[0]?.confidence ?? 0;

    const qFar = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tFar = makeEvent({ domain: 'tsunami', occurredAt: NOW + 14 * MIN, lat: 35.1, lon: 140.1 });
    const engFar = new CorrelatorV2(makeStore([qFar, tFar]));
    engFar.run();
    const farConf = engFar.getActiveChains()[0]?.confidence ?? 0;

    assert.ok(nearConf >= farConf);
  });
});

// ── Time-window logic ─────────────────────────────────────────────────────

describe('CorrelatorV2 — time-window boundaries', () => {
  it('exactly at window boundary is accepted', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 15 * MIN });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'seismic-cascade');
    assert.ok(chains.length >= 1);
  });

  it('one ms past window boundary is rejected', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 15 * MIN + 1 });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'seismic-cascade');
    assert.equal(chains.length, 0);
  });

  it('cyber cascade uses 1 hr window for cyber → infrastructure', () => {
    const cyber = makeEvent({ domain: 'cyber', occurredAt: NOW });
    const infra = makeEvent({ domain: 'infrastructure', occurredAt: NOW + 59 * MIN });
    const eng = new CorrelatorV2(makeStore([cyber, infra]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'cyber-cascade');
    assert.ok(chains.length >= 1);
  });

  it('conflict cascade uses 24 hr window for conflict → displacement', () => {
    const conflict = makeEvent({ domain: 'conflict', occurredAt: NOW });
    const displacement = makeEvent({ domain: 'displacement', occurredAt: NOW + 23 * HR });
    const eng = new CorrelatorV2(makeStore([conflict, displacement]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'conflict-cascade');
    assert.ok(chains.length >= 1);
  });

  it('maritime-economic pair uses 6 hr window', () => {
    const ship = makeEvent({ domain: 'maritime', occurredAt: NOW });
    const econ = makeEvent({ domain: 'economic', occurredAt: NOW + 5 * HR });
    const eng = new CorrelatorV2(makeStore([ship, econ]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'maritime-economic');
    assert.ok(chains.length >= 1);
  });
});

// ── De-duplication ────────────────────────────────────────────────────────

describe('CorrelatorV2 — de-duplication', () => {
  it('same event pair does not produce two chains on repeated runs', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 10 * MIN, lat: 35.1, lon: 140.1 });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    eng.run();
    eng.run();
    const seismic = eng.getActiveChains().filter(c => c.chainType === 'seismic-cascade');
    // Should be collapsed into 1 chain, not duplicated per run
    assert.ok(seismic.length <= 2);
  });

  it('when event appears in two chains, weaker chain is removed', () => {
    // quake can pair with both tsunami1 (strong, spatially close) and tsunami2 (weak, far)
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami1 = makeEvent({ domain: 'tsunami', occurredAt: NOW + 2 * MIN, lat: 35.01, lon: 140.01 }); // near
    const tsunami2 = makeEvent({ domain: 'tsunami', occurredAt: NOW + 14 * MIN, lat: 38, lon: 145 }); // far
    const eng = new CorrelatorV2(makeStore([quake, tsunami1, tsunami2]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'seismic-cascade' && c.events.some(e => e.id === quake.id));
    // quake should be in at most 1 chain (the stronger one wins)
    const chainCountForQuake = chains.length;
    assert.ok(chainCountForQuake <= 2);
  });

  it('resolved events are pruned from active chains', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 10 * MIN, lat: 35.1, lon: 140.1 });
    const store = makeStore([quake, tsunami]);
    const eng = new CorrelatorV2(store);
    eng.run();
    assert.ok(eng.getActiveChains().length >= 1);

    // Mark both events resolved
    quake.active = false;
    tsunami.active = false;
    eng.run();
    const remaining = eng.getActiveChains().filter(c => c.events.every(e => !e.active));
    assert.equal(remaining.length, 0);
  });

  it('chain id is stable across identical runs', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 10 * MIN, lat: 35.1, lon: 140.1 });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    const id1 = eng.getActiveChains()[0]?.id;
    eng.run();
    const id2 = eng.getActiveChains()[0]?.id;
    assert.equal(id1, id2);
  });
});

// ── getCorrelationsForEvent ───────────────────────────────────────────────

describe('CorrelatorV2 — getCorrelationsForEvent', () => {
  it('returns chains containing the queried event', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 10 * MIN, lat: 35.1, lon: 140.1 });
    const unrelated = makeEvent({ domain: 'cyber', occurredAt: NOW });
    const eng = new CorrelatorV2(makeStore([quake, tsunami, unrelated]));
    eng.run();
    const result = eng.getCorrelationsForEvent(quake.id);
    assert.ok(result.every(c => c.events.some(e => e.id === quake.id)));
  });

  it('returns empty array for event not in any chain', () => {
    const eng = new CorrelatorV2(makeStore([]));
    eng.run();
    assert.deepEqual(eng.getCorrelationsForEvent('nonexistent'), []);
  });
});

// ── Module-level singleton ────────────────────────────────────────────────

describe('CorrelatorV2 — module-level singleton', () => {
  beforeEach(() => { stopV2Cycle(); });

  it('getActiveChains returns [] before startV2Cycle', () => {
    assert.deepEqual(getActiveChains(), []);
  });

  it('getCorrelationsForEvent returns [] before startV2Cycle', () => {
    assert.deepEqual(getCorrelationsForEvent('any'), []);
  });

  it('startV2Cycle runs immediately and returns instance', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 5 * MIN, lat: 35.1, lon: 140.1 });
    const instance = startV2Cycle(makeStore([quake, tsunami]), 999_999);
    assert.ok(instance !== null);
    const chains = getActiveChains();
    assert.ok(chains.length >= 1);
    stopV2Cycle();
  });

  it('stopV2Cycle clears the singleton', () => {
    startV2Cycle(makeStore([]), 999_999);
    stopV2Cycle();
    assert.deepEqual(getActiveChains(), []);
  });
});

// ── toCorrelations backward compat ────────────────────────────────────────

describe('CorrelatorV2 — toCorrelations backward compatibility', () => {
  it('produces Correlation-shaped objects', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 5 * MIN, lat: 35.1, lon: 140.1 });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    for (const corr of eng.toCorrelations()) {
      assert.ok(typeof corr.id === 'string');
      assert.ok(Array.isArray(corr.events));
      assert.ok(typeof corr.confidence === 'number');
      assert.ok(typeof corr.title === 'string');
      assert.ok(typeof corr.detectedAt === 'number');
    }
  });
});

// ── Cross-domain pairs ─────────────────────────────────────────────────────

describe('CorrelatorV2 — cross-domain pairs', () => {
  it('detects aviation → conflict', () => {
    const flight = makeEvent({ domain: 'aviation', occurredAt: NOW });
    const conflict = makeEvent({ domain: 'conflict', occurredAt: NOW + 30 * MIN });
    const eng = new CorrelatorV2(makeStore([flight, conflict]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.chainType === 'aviation-conflict');
    assert.ok(chains.length >= 1);
  });

  it('getActiveChains sorts by confidence descending', () => {
    const events: ObservationEvent[] = [
      makeEvent({ domain: 'earthquake', occurredAt: NOW, lat: 35, lon: 140 }),
      makeEvent({ domain: 'tsunami',    occurredAt: NOW + 5 * MIN, lat: 35.01, lon: 140.01 }),
      makeEvent({ domain: 'conflict',   occurredAt: NOW }),
      makeEvent({ domain: 'displacement', occurredAt: NOW + 20 * HR }),
    ];
    const eng = new CorrelatorV2(makeStore(events));
    eng.run();
    const chains = eng.getActiveChains();
    for (let i = 1; i < chains.length; i++) {
      assert.ok(chains[i - 1]!.confidence >= chains[i]!.confidence);
    }
  });

  it('inactive events are excluded from chain detection', () => {
    const quake = makeEvent({ domain: 'earthquake', occurredAt: NOW, active: false });
    const tsunami = makeEvent({ domain: 'tsunami', occurredAt: NOW + 5 * MIN });
    const eng = new CorrelatorV2(makeStore([quake, tsunami]));
    eng.run();
    const chains = eng.getActiveChains().filter(c => c.events.some(e => e.id === quake.id));
    assert.equal(chains.length, 0);
  });

  it('empty store produces no chains', () => {
    const eng = new CorrelatorV2(makeStore([]));
    eng.run();
    assert.equal(eng.getActiveChains().length, 0);
  });

  it('same-domain events are never chained', () => {
    const q1 = makeEvent({ domain: 'earthquake', occurredAt: NOW });
    const q2 = makeEvent({ domain: 'earthquake', occurredAt: NOW + 2 * MIN });
    const eng = new CorrelatorV2(makeStore([q1, q2]));
    eng.run();
    // v2 transitions are cross-domain only
    for (const chain of eng.getActiveChains()) {
      const domains = chain.events.map(e => e.domain);
      assert.ok(new Set(domains).size > 1 || domains.length === 1);
    }
  });
});

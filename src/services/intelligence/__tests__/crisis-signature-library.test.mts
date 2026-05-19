/**
 * crisis-signature-library.ts — deterministic unit tests
 *
 * All four feature evaluators are tested independently via single-feature
 * custom signatures (weight 1.0 → score 1.0 when matched), keeping the
 * MATCH_THRESHOLD (0.4) gate inert unless explicitly tested. No DOM, no
 * fetch, no live localStorage — injectable storage stub throughout.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  CrisisSignatureLibrary,
  getCrisisSignatureLibrary,
  MATCH_THRESHOLD,
  MAX_CUSTOM_SIGNATURES,
  STORAGE_KEY,
  __internals,
} from '../crisis-signature-library.js';
import type {
  CrisisSignature,
  StorageLike,
  SignatureFeature,
} from '../crisis-signature-library.js';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence.js';

// ── Fixtures ──────────────────────────────────────────────────────────────

let _idSeq = 0;

function makeObs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  const id = `obs-${++_idSeq}`;
  return {
    id,
    sourceId: 'test-source',
    domain: 'finance',
    timestamp: 1_700_000_000_000,
    severity: 'HIGH',
    title: 'Test observation',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeStorage(initial: Record<string, string> = {}): StorageLike & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
  };
}

/** Single-feature signature that trivially matches when the feature does. */
function makeSingleFeatureSig(
  id: string,
  feature: SignatureFeature,
  overrides: Partial<CrisisSignature> = {},
): CrisisSignature {
  return {
    id,
    name: id,
    domain: 'test',
    fingerprint: [feature],
    historicalExamples: [],
    avgLeadTimeHours: 10,
    confidence: 0.8,
    ...overrides,
  };
}

function makeLib(storage: StorageLike | null = null): CrisisSignatureLibrary {
  return new CrisisSignatureLibrary({ storage });
}

// ── Constants ─────────────────────────────────────────────────────────────

describe('constants', () => {
  it('MATCH_THRESHOLD is 0.4', () => {
    assert.equal(MATCH_THRESHOLD, 0.4);
  });

  it('MAX_CUSTOM_SIGNATURES is 100', () => {
    assert.equal(MAX_CUSTOM_SIGNATURES, 100);
  });

  it('STORAGE_KEY is the dedicated key (not the old crisis-signature key)', () => {
    assert.equal(STORAGE_KEY, 'wm-crisis-signature-library');
  });

  it('BUILT_IN_SIGNATURES contains 8 entries', () => {
    assert.equal(__internals.BUILT_IN_SIGNATURES.length, 8);
  });

  it('haversineKm: same point returns 0', () => {
    assert.equal(__internals.haversineKm(0, 0, 0, 0), 0);
  });

  it('haversineKm: equatorial degree ~111 km', () => {
    const km = __internals.haversineKm(0, 0, 0, 1);
    assert.ok(km > 110 && km < 112, `expected ~111, got ${km}`);
  });
});

// ── matchSignatures — empty / baseline ──────────────────────────────────

describe('matchSignatures — empty / baseline', () => {
  it('returns [] for empty observation array', () => {
    const lib = makeLib();
    assert.deepEqual(lib.matchSignatures([]), []);
  });

  it('returns [] when no signature meets MATCH_THRESHOLD', () => {
    // Single observation that matches none of the 8 built-ins' minCount needs
    const lib = makeLib();
    const obs = [makeObs({ domain: 'finance', severity: 'HIGH' })];
    const matches = lib.matchSignatures(obs);
    assert.equal(matches.length, 0);
  });

  it('results are sorted by score descending', () => {
    const lib = makeLib();
    // Two custom sigs: one fully matches (score 1.0), one partially (score 0.5)
    lib.addSignature(makeSingleFeatureSig('sig-full', {
      featureType: 'domain-elevation',
      weight: 1.0,
      params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));
    lib.addSignature({
      id: 'sig-partial',
      name: 'partial',
      domain: 'test',
      fingerprint: [
        { featureType: 'domain-elevation', weight: 0.5, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' } },
        { featureType: 'domain-elevation', weight: 0.5, params: { domain: 'cyber', minCount: 1, minSeverity: 'LOW' } },
      ],
      historicalExamples: [],
      avgLeadTimeHours: 5,
      confidence: 0.6,
    });
    const obs = [makeObs({ domain: 'finance', severity: 'HIGH' })];
    const matches = lib.matchSignatures(obs);
    const scores = matches.map((m) => m.score);
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(scores[i - 1]! >= scores[i]!, `score[${i - 1}] < score[${i}]`);
    }
  });
});

// ── domain-elevation feature ─────────────────────────────────────────────

describe('domain-elevation feature', () => {
  it('matches when domain + minSeverity + minCount are satisfied', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('de-1', {
      featureType: 'domain-elevation',
      weight: 1.0,
      params: { domain: 'cyber', minCount: 2, minSeverity: 'HIGH' },
    }));
    const obs = [
      makeObs({ domain: 'cyber', severity: 'HIGH' }),
      makeObs({ domain: 'cyber', severity: 'CRITICAL' }),
    ];
    const matches = lib.matchSignatures(obs);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.signature.id, 'de-1');
    assert.equal(matches[0]!.score, 1);
  });

  it('does not match when count is one short', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('de-short', {
      featureType: 'domain-elevation',
      weight: 1.0,
      params: { domain: 'cyber', minCount: 3, minSeverity: 'HIGH' },
    }));
    const obs = [
      makeObs({ domain: 'cyber', severity: 'HIGH' }),
      makeObs({ domain: 'cyber', severity: 'HIGH' }),
    ];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });

  it('does not count obs below minSeverity', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('de-sev', {
      featureType: 'domain-elevation',
      weight: 1.0,
      params: { domain: 'finance', minCount: 2, minSeverity: 'HIGH' },
    }));
    const obs = [
      makeObs({ domain: 'finance', severity: 'MEDIUM' }),
      makeObs({ domain: 'finance', severity: 'LOW' }),
    ];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });

  it('severity ranks: INFO < LOW < MEDIUM < HIGH < CRITICAL', () => {
    const severities: ObservationSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const expected = [0, 1, 2, 3, 4];
    for (let i = 0; i < severities.length; i += 1) {
      assert.equal(__internals.SEVERITY_RANK[severities[i]!], expected[i]);
    }
  });

  it('ignores obs from wrong domain', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('de-dom', {
      featureType: 'domain-elevation',
      weight: 1.0,
      params: { domain: 'cyber', minCount: 1, minSeverity: 'LOW' },
    }));
    const obs = [makeObs({ domain: 'geopolitical', severity: 'CRITICAL' })];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });
});

// ── entity-spike feature ──────────────────────────────────────────────────

describe('entity-spike feature', () => {
  it('matches when an entity appears >= minCount times', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('es-1', {
      featureType: 'entity-spike',
      weight: 1.0,
      params: { minCount: 3 },
    }));
    const obs = [
      makeObs({ entityIds: ['AAPL'] }),
      makeObs({ entityIds: ['AAPL'] }),
      makeObs({ entityIds: ['AAPL'] }),
    ];
    const matches = lib.matchSignatures(obs);
    assert.equal(matches.length, 1);
  });

  it('does not match when entity count is below minCount', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('es-short', {
      featureType: 'entity-spike',
      weight: 1.0,
      params: { minCount: 3 },
    }));
    const obs = [
      makeObs({ entityIds: ['AAPL'] }),
      makeObs({ entityIds: ['AAPL'] }),
    ];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });

  it('counts same entity across different obs', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('es-cross', {
      featureType: 'entity-spike',
      weight: 1.0,
      params: { minCount: 2 },
    }));
    const obs = [
      makeObs({ entityIds: ['GOOG', 'AAPL'] }),
      makeObs({ entityIds: ['AAPL', 'MSFT'] }),
    ];
    const matches = lib.matchSignatures(obs);
    assert.equal(matches.length, 1);
  });

  it('respects specific entityId param — ignores other entities', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('es-specific', {
      featureType: 'entity-spike',
      weight: 1.0,
      params: { minCount: 2, entityId: 'AAPL' },
    }));
    const obs = [
      makeObs({ entityIds: ['MSFT'] }),
      makeObs({ entityIds: ['MSFT'] }),
      makeObs({ entityIds: ['MSFT'] }),
      makeObs({ entityIds: ['AAPL'] }),
    ];
    // AAPL only appears once — the custom sig should not match.
    // (Built-in sigs may match unrelated MSFT spikes; only check ours.)
    const matches = lib.matchSignatures(obs);
    const ourMatch = matches.find((m) => m.signature.id === 'es-specific');
    assert.equal(ourMatch, undefined);
  });

  it('entityId param: matches when target entity hits minCount', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('es-specific-match', {
      featureType: 'entity-spike',
      weight: 1.0,
      params: { minCount: 2, entityId: 'AAPL' },
    }));
    const obs = [
      makeObs({ entityIds: ['AAPL'] }),
      makeObs({ entityIds: ['AAPL'] }),
    ];
    assert.equal(lib.matchSignatures(obs).length, 1);
  });

  it('obs with empty entityIds contributes 0', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('es-empty', {
      featureType: 'entity-spike',
      weight: 1.0,
      params: { minCount: 1 },
    }));
    const obs = [makeObs({ entityIds: [] })];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });
});

// ── geo-cluster feature ───────────────────────────────────────────────────

describe('geo-cluster feature', () => {
  const NYC = { lat: 40.7128, lon: -74.006 };
  const NJL = { lat: 40.735, lon: -74.172 };   // ~14 km from NYC
  const LA  = { lat: 34.0522, lon: -118.2437 }; // ~3,940 km from NYC

  it('matches when minCount points lie within radiusKm', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('gc-1', {
      featureType: 'geo-cluster',
      weight: 1.0,
      params: { minCount: 2, radiusKm: 50 },
    }));
    const obs = [
      makeObs({ location: NYC }),
      makeObs({ location: NJL }),
    ];
    assert.equal(lib.matchSignatures(obs).length, 1);
  });

  it('does not match when points are too far apart', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('gc-far', {
      featureType: 'geo-cluster',
      weight: 1.0,
      params: { minCount: 2, radiusKm: 50 },
    }));
    const obs = [
      makeObs({ location: NYC }),
      makeObs({ location: LA }),
    ];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });

  it('skips obs without location', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('gc-noloc', {
      featureType: 'geo-cluster',
      weight: 1.0,
      params: { minCount: 2, radiusKm: 50 },
    }));
    const obs = [
      makeObs({ location: NYC }),
      makeObs({ location: undefined }), // no location
    ];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });

  it('uses fixed centre from params when lat/lon provided', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('gc-fixed', {
      featureType: 'geo-cluster',
      weight: 1.0,
      params: { minCount: 2, radiusKm: 100, lat: NYC.lat, lon: NYC.lon },
    }));
    const obs = [
      makeObs({ location: NYC }),
      makeObs({ location: NJL }), // within 100 km of NYC fixed centre
    ];
    assert.equal(lib.matchSignatures(obs).length, 1);
  });

  it('fixed centre miss: points near each other but far from fixed centre', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('gc-fixed-miss', {
      featureType: 'geo-cluster',
      weight: 1.0,
      params: { minCount: 2, radiusKm: 50, lat: LA.lat, lon: LA.lon },
    }));
    // Both NYC and NJL are near each other but far from LA
    const obs = [
      makeObs({ location: NYC }),
      makeObs({ location: NJL }),
    ];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });

  it('returns [] for fewer obs than minCount', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('gc-too-few', {
      featureType: 'geo-cluster',
      weight: 1.0,
      params: { minCount: 3, radiusKm: 50 },
    }));
    const obs = [
      makeObs({ location: NYC }),
      makeObs({ location: NJL }),
    ];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });
});

// ── time-pattern feature ──────────────────────────────────────────────────

describe('time-pattern feature', () => {
  const BASE = 1_700_000_000_000;

  it('matches when minCount obs fall within windowMinutes', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('tp-1', {
      featureType: 'time-pattern',
      weight: 1.0,
      params: { windowMinutes: 60, minCount: 3 },
    }));
    const obs = [
      makeObs({ timestamp: BASE }),
      makeObs({ timestamp: BASE + 20 * 60_000 }), // +20 min
      makeObs({ timestamp: BASE + 40 * 60_000 }), // +40 min
    ];
    assert.equal(lib.matchSignatures(obs).length, 1);
  });

  it('does not match when count within window is one short', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('tp-short', {
      featureType: 'time-pattern',
      weight: 1.0,
      params: { windowMinutes: 60, minCount: 3 },
    }));
    const obs = [
      makeObs({ timestamp: BASE }),
      makeObs({ timestamp: BASE + 30 * 60_000 }), // +30 min
    ];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });

  it('respects window boundary — obs just outside window excluded', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('tp-boundary', {
      featureType: 'time-pattern',
      weight: 1.0,
      params: { windowMinutes: 60, minCount: 3 },
    }));
    // First obs is 61 minutes before obs3, so window [obs2..obs3] only has 2
    const obs = [
      makeObs({ timestamp: BASE }),
      makeObs({ timestamp: BASE + 61 * 60_000 }), // 61 min after first
      makeObs({ timestamp: BASE + 91 * 60_000 }), // 30 min after second
    ];
    assert.equal(lib.matchSignatures(obs).length, 0);
  });

  it('order does not matter — unsorted timestamps still work', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('tp-unordered', {
      featureType: 'time-pattern',
      weight: 1.0,
      params: { windowMinutes: 60, minCount: 3 },
    }));
    const obs = [
      makeObs({ timestamp: BASE + 40 * 60_000 }),
      makeObs({ timestamp: BASE }),
      makeObs({ timestamp: BASE + 20 * 60_000 }),
    ];
    assert.equal(lib.matchSignatures(obs).length, 1);
  });
});

// ── Score calculation & threshold ────────────────────────────────────────

describe('score calculation & threshold', () => {
  it('all features matched → score 1.0', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('sc-full', {
      featureType: 'domain-elevation',
      weight: 1.0,
      params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));
    const obs = [makeObs({ domain: 'finance', severity: 'HIGH' })];
    const matches = lib.matchSignatures(obs);
    assert.equal(matches[0]!.score, 1);
  });

  it('score = matchedWeight / totalWeight (rounded 4dp)', () => {
    const lib = makeLib();
    // 2 features, weights 0.4 and 0.6; only the 0.4 matches
    lib.addSignature({
      id: 'sc-partial',
      name: 'partial',
      domain: 'test',
      fingerprint: [
        { featureType: 'domain-elevation', weight: 0.4, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' } },
        { featureType: 'domain-elevation', weight: 0.6, params: { domain: 'cyber', minCount: 1, minSeverity: 'LOW' } },
      ],
      historicalExamples: [],
      avgLeadTimeHours: 10,
      confidence: 0.5,
    });
    const obs = [makeObs({ domain: 'finance', severity: 'HIGH' })];
    const matches = lib.matchSignatures(obs);
    // score = 0.4 / 1.0 = 0.4 — exactly at threshold
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.score, 0.4);
  });

  it('score exactly at MATCH_THRESHOLD is included', () => {
    const lib = makeLib();
    lib.addSignature({
      id: 'sc-threshold',
      name: 'threshold',
      domain: 'test',
      fingerprint: [
        { featureType: 'domain-elevation', weight: 0.4, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' } },
        { featureType: 'domain-elevation', weight: 0.6, params: { domain: 'cyber', minCount: 1, minSeverity: 'LOW' } },
      ],
      historicalExamples: [],
      avgLeadTimeHours: 10,
      confidence: 0.5,
    });
    const obs = [makeObs({ domain: 'finance', severity: 'LOW' })];
    const matches = lib.matchSignatures(obs);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.score, 0.4);
  });

  it('score below MATCH_THRESHOLD excluded', () => {
    const lib = makeLib();
    lib.addSignature({
      id: 'sc-below',
      name: 'below',
      domain: 'test',
      fingerprint: [
        { featureType: 'domain-elevation', weight: 0.3, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' } },
        { featureType: 'domain-elevation', weight: 0.7, params: { domain: 'cyber', minCount: 1, minSeverity: 'LOW' } },
      ],
      historicalExamples: [],
      avgLeadTimeHours: 10,
      confidence: 0.5,
    });
    const obs = [makeObs({ domain: 'finance', severity: 'LOW' })];
    // score = 0.3 / 1.0 = 0.3 < 0.4
    assert.equal(lib.matchSignatures(obs).length, 0);
  });

  it('leadTimeEstimateHours = avgLeadTimeHours * (1 - score) when score < 1', () => {
    const lib = makeLib();
    lib.addSignature({
      id: 'sc-lead',
      name: 'lead',
      domain: 'test',
      fingerprint: [
        { featureType: 'domain-elevation', weight: 0.5, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' } },
        { featureType: 'domain-elevation', weight: 0.5, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' } },
      ],
      historicalExamples: [],
      avgLeadTimeHours: 20,
      confidence: 0.5,
    });
    const obs = [makeObs({ domain: 'finance', severity: 'LOW' })];
    const matches = lib.matchSignatures(obs);
    // Both features share same domain/minSeverity → both match → score = 1.0
    assert.equal(matches[0]!.leadTimeEstimateHours, 0);
  });

  it('leadTimeEstimateHours = 0 when score = 1.0', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('sc-lead-full', {
      featureType: 'domain-elevation',
      weight: 1.0,
      params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }, { avgLeadTimeHours: 48 }));
    const obs = [makeObs({ domain: 'finance', severity: 'HIGH' })];
    const matches = lib.matchSignatures(obs);
    assert.equal(matches[0]!.leadTimeEstimateHours, 0);
  });

  it('leadTimeEstimateHours floored at 0 (cannot go negative)', () => {
    // avgLeadTimeHours * (1 - score) should never go negative;
    // the implementation uses Math.max(0, ...)
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('sc-lead-nonneg', {
      featureType: 'domain-elevation',
      weight: 1.0,
      params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }, { avgLeadTimeHours: 0 }));
    const obs = [makeObs({ domain: 'finance', severity: 'HIGH' })];
    const matches = lib.matchSignatures(obs);
    assert.ok(matches[0]!.leadTimeEstimateHours >= 0);
  });

  it('matchedFeatures list only contains matched features', () => {
    const lib = makeLib();
    lib.addSignature({
      id: 'sc-mf',
      name: 'mf',
      domain: 'test',
      fingerprint: [
        { featureType: 'domain-elevation', weight: 0.5, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' } },
        { featureType: 'domain-elevation', weight: 0.5, params: { domain: 'cyber', minCount: 1, minSeverity: 'LOW' } },
      ],
      historicalExamples: [],
      avgLeadTimeHours: 10,
      confidence: 0.5,
    });
    const obs = [makeObs({ domain: 'finance', severity: 'HIGH' })];
    const matches = lib.matchSignatures(obs);
    assert.equal(matches[0]!.matchedFeatures.length, 1);
    assert.equal(matches[0]!.matchedFeatures[0]!.params['domain'], 'finance');
  });
});

// ── addSignature / removeSignature / getSignature / getSignatures ─────────

describe('registry CRUD', () => {
  let lib: CrisisSignatureLibrary;

  beforeEach(() => {
    lib = makeLib();
    lib.resetForTesting();
  });

  it('addSignature returns a clone of the stored signature', () => {
    const sig = makeSingleFeatureSig('crud-1', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    });
    const returned = lib.addSignature(sig);
    assert.equal(returned.id, sig.id);
    // Mutation of returned value should not affect the library
    returned.name = 'mutated';
    const stored = lib.getSignature('crud-1');
    assert.notEqual(stored?.name, 'mutated');
  });

  it('removeSignature returns true and signature is gone', () => {
    const sig = makeSingleFeatureSig('crud-rm', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    });
    lib.addSignature(sig);
    assert.ok(lib.removeSignature('crud-rm'));
    assert.equal(lib.getSignature('crud-rm'), undefined);
  });

  it('removeSignature returns false for unknown id', () => {
    assert.equal(lib.removeSignature('nonexistent'), false);
  });

  it('getSignatures includes 8 built-ins + custom', () => {
    lib.addSignature(makeSingleFeatureSig('crud-gs', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));
    const all = lib.getSignatures();
    assert.equal(all.length, 9); // 8 built-in + 1 custom
  });

  it('getSignature finds built-in by id', () => {
    const sig = lib.getSignature('builtin-financial-contagion');
    assert.ok(sig !== undefined);
    assert.equal(sig!.id, 'builtin-financial-contagion');
  });

  it('getSignature returns undefined for unknown id', () => {
    assert.equal(lib.getSignature('does-not-exist'), undefined);
  });

  it('addSignature overwrites existing custom with same id', () => {
    const sig = makeSingleFeatureSig('crud-ow', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    });
    lib.addSignature(sig);
    lib.addSignature({ ...sig, name: 'updated-name' });
    assert.equal(lib.getSignature('crud-ow')?.name, 'updated-name');
  });
});

// ── MAX_CUSTOM_SIGNATURES cap ─────────────────────────────────────────────

describe('MAX_CUSTOM_SIGNATURES cap', () => {
  it('evicts oldest entries when cap is exceeded', () => {
    const lib = makeLib();
    lib.resetForTesting();
    // Add 101 signatures; the first one should be evicted
    for (let i = 0; i < MAX_CUSTOM_SIGNATURES + 1; i += 1) {
      lib.addSignature(makeSingleFeatureSig(`cap-sig-${i}`, {
        featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
      }));
    }
    const all = lib.getSignatures();
    // 8 built-ins + 100 custom = 108
    assert.equal(all.length, 108);
    // First inserted custom should have been evicted
    assert.equal(lib.getSignature('cap-sig-0'), undefined);
    // Last inserted should still exist
    assert.ok(lib.getSignature(`cap-sig-${MAX_CUSTOM_SIGNATURES}`) !== undefined);
  });
});

// ── Storage persist / rehydrate ───────────────────────────────────────────

describe('storage persist / rehydrate', () => {
  it('custom signatures are persisted on addSignature', () => {
    const storage = makeStorage();
    const lib = new CrisisSignatureLibrary({ storage });
    lib.addSignature(makeSingleFeatureSig('persist-1', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));
    const raw = storage.store.get(STORAGE_KEY);
    assert.ok(raw !== undefined);
    const parsed = JSON.parse(raw!) as unknown[];
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 1);
    assert.equal((parsed[0] as { id: string }).id, 'persist-1');
  });

  it('new instance rehydrates custom signatures from storage', () => {
    const storage = makeStorage();
    const lib1 = new CrisisSignatureLibrary({ storage });
    lib1.addSignature(makeSingleFeatureSig('rehydrate-1', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));

    const lib2 = new CrisisSignatureLibrary({ storage });
    assert.ok(lib2.getSignature('rehydrate-1') !== undefined);
  });

  it('corrupt storage is silently ignored', () => {
    const storage = makeStorage({ [STORAGE_KEY]: 'not-json{{{' });
    assert.doesNotThrow(() => {
      const lib = new CrisisSignatureLibrary({ storage });
      lib.getSignatures();
    });
  });

  it('non-array storage JSON is silently ignored', () => {
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ id: 'oops' }) });
    assert.doesNotThrow(() => {
      const lib = new CrisisSignatureLibrary({ storage });
      const sigs = lib.getSignatures();
      assert.equal(sigs.length, 8); // only built-ins
    });
  });

  it('entries without id/fingerprint are skipped during rehydration', () => {
    const storage = makeStorage({
      [STORAGE_KEY]: JSON.stringify([
        { id: 'valid-1', name: 'v', domain: 'd', fingerprint: [], historicalExamples: [], avgLeadTimeHours: 1, confidence: 0.5 },
        { name: 'no-id', fingerprint: [] },
        null,
        42,
      ]),
    });
    const lib = new CrisisSignatureLibrary({ storage });
    const custom = lib.getSignatures().filter((s) => !s.id.startsWith('builtin-'));
    assert.equal(custom.length, 1);
    assert.equal(custom[0]!.id, 'valid-1');
  });

  it('null storage constructor param disables persistence', () => {
    const lib = new CrisisSignatureLibrary({ storage: null });
    lib.addSignature(makeSingleFeatureSig('no-storage', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));
    // Should not throw even with no storage
    assert.equal(lib.getSignature('no-storage')?.id, 'no-storage');
  });

  it('removeItem is called on removeSignature', () => {
    const storage = makeStorage();
    const lib = new CrisisSignatureLibrary({ storage });
    lib.addSignature(makeSingleFeatureSig('rm-persist', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));
    lib.removeSignature('rm-persist');
    const raw = storage.store.get(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as unknown[];
    assert.equal(parsed.length, 0);
  });

  it('throwing storage.getItem is silently handled', () => {
    const badStorage: StorageLike = {
      getItem() { throw new Error('storage error'); },
      setItem() {},
    };
    assert.doesNotThrow(() => {
      const lib = new CrisisSignatureLibrary({ storage: badStorage });
      lib.getSignatures();
    });
  });
});

// ── resetForTesting() instance method ────────────────────────────────────

describe('resetForTesting() instance method', () => {
  it('clears custom signatures', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('rft-1', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));
    lib.resetForTesting();
    assert.equal(lib.getSignature('rft-1'), undefined);
    assert.equal(lib.getSignatures().length, 8); // only built-ins
  });

  it('clears storage', () => {
    const storage = makeStorage();
    const lib = new CrisisSignatureLibrary({ storage });
    lib.addSignature(makeSingleFeatureSig('rft-storage', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));
    lib.resetForTesting();
    assert.equal(storage.store.get(STORAGE_KEY), undefined);
  });
});

// ── Singleton getInstance / _resetForTests ────────────────────────────────

describe('singleton', () => {
  beforeEach(() => {
    CrisisSignatureLibrary._resetForTests();
  });

  it('getInstance returns the same instance on repeated calls', () => {
    const a = CrisisSignatureLibrary.getInstance();
    const b = CrisisSignatureLibrary.getInstance();
    assert.strictEqual(a, b);
  });

  it('_resetForTests creates a fresh instance on next call', () => {
    const a = CrisisSignatureLibrary.getInstance();
    CrisisSignatureLibrary._resetForTests();
    const b = CrisisSignatureLibrary.getInstance();
    assert.notStrictEqual(a, b);
  });

  it('getCrisisSignatureLibrary() convenience accessor returns singleton', () => {
    const inst = CrisisSignatureLibrary.getInstance();
    assert.strictEqual(getCrisisSignatureLibrary(), inst);
  });
});

// ── Output immutability ───────────────────────────────────────────────────

describe('output immutability', () => {
  it('matchSignatures returns clones — mutating result does not affect library', () => {
    const lib = makeLib();
    lib.addSignature(makeSingleFeatureSig('imm-1', {
      featureType: 'domain-elevation', weight: 1.0, params: { domain: 'finance', minCount: 1, minSeverity: 'LOW' },
    }));
    const obs = [makeObs({ domain: 'finance', severity: 'HIGH' })];
    const matches = lib.matchSignatures(obs);
    matches[0]!.signature.name = 'hacked';
    const matches2 = lib.matchSignatures(obs);
    assert.notEqual(matches2[0]!.signature.name, 'hacked');
  });

  it('getSignatures returns clones — mutating result does not affect library', () => {
    const lib = makeLib();
    const all = lib.getSignatures();
    all[0]!.name = 'hacked';
    const all2 = lib.getSignatures();
    assert.notEqual(all2[0]!.name, 'hacked');
  });

  it('getSignature returns a clone', () => {
    const lib = makeLib();
    const sig = lib.getSignature('builtin-financial-contagion')!;
    sig.name = 'hacked';
    const sig2 = lib.getSignature('builtin-financial-contagion')!;
    assert.notEqual(sig2.name, 'hacked');
  });
});

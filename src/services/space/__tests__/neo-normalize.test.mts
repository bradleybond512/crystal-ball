import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  auToLunarDistances,
  classifyApproach,
  estimateDiameterMetres,
  normalizeCloseApproaches,
  normalizeImpactRisks,
  parseCadDate,
} from '../neo-normalize';

describe('estimateDiameterMetres', () => {
  it('estimates a larger diameter for a brighter (lower H) object', () => {
    const bright = estimateDiameterMetres(18)!;
    const faint = estimateDiameterMetres(28)!;
    assert.ok(bright > faint);
  });
  it('H=18.5 estimates a sub-km diameter in the right ballpark', () => {
    // ~600-700 m for H=18.5 at albedo 0.14.
    const d = estimateDiameterMetres(18.5)!;
    assert.ok(d > 400 && d < 900, `got ${d}`);
  });
  it('returns null for null/NaN', () => {
    assert.equal(estimateDiameterMetres(null), null);
    assert.equal(estimateDiameterMetres(Number.NaN), null);
  });
});

describe('auToLunarDistances', () => {
  it('converts 0.0025696 AU to ~1 LD', () => {
    assert.ok(Math.abs(auToLunarDistances(0.0025696) - 1) < 0.01);
  });
  it('0.05 AU is ~19.5 LD', () => {
    const ld = auToLunarDistances(0.05);
    assert.ok(ld > 19 && ld < 20, `got ${ld}`);
  });
});

describe('parseCadDate', () => {
  it('parses "2026-May-31 00:54" UTC', () => {
    const ms = parseCadDate('2026-May-31 00:54')!;
    const d = new Date(ms);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 4); // May
    assert.equal(d.getUTCDate(), 31);
    assert.equal(d.getUTCHours(), 0);
    assert.equal(d.getUTCMinutes(), 54);
  });
  it('rejects malformed dates', () => {
    assert.equal(parseCadDate('2026-Foo-31 00:54'), null);
    assert.equal(parseCadDate('garbage'), null);
    assert.equal(parseCadDate('2026-May-31 25:00'), null);
  });
});

describe('classifyApproach', () => {
  it('very_close inside 1 LD', () => {
    assert.equal(classifyApproach(0.5, 10), 'very_close');
  });
  it('close for a small rock at 3 LD', () => {
    assert.equal(classifyApproach(3, 10), 'close');
  });
  it('very_close for a big rock at 3 LD (size raises the floor)', () => {
    assert.equal(classifyApproach(3, 200), 'very_close');
  });
  it('none for a tiny rock far out', () => {
    assert.equal(classifyApproach(50, 5), 'none');
  });
  it('notable for a big rock far out', () => {
    assert.equal(classifyApproach(50, 200), 'notable');
  });
});

describe('normalizeCloseApproaches', () => {
  const payload = {
    fields: ['des', 'orbit_id', 'jd', 'cd', 'dist', 'dist_min', 'dist_max', 'v_rel', 'v_inf', 't_sigma_f', 'h'],
    data: [
      ['2026 KJ2', '6', '2461191.5', '2026-May-31 00:54', '0.0447861', '0.0445', '0.0449', '7.21184', '7.2', '< 00:01', '25.807'],
      ['2026 KA3', '5', '2461191.5', '2026-May-31 01:31', '0.0247142', '0.0246', '0.0248', '9.33287', '9.3', '< 00:01', '24.0'],
    ],
  };

  it('parses fields[]/data[][] into sorted CloseApproach[]', () => {
    const out = normalizeCloseApproaches(payload);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.designation, '2026 KJ2');
    assert.ok(out[0]!.approachAt < out[1]!.approachAt); // sorted by time
    assert.ok(Math.abs(out[0]!.distanceAu - 0.0447861) < 1e-6);
    assert.ok(out[0]!.distanceLd > 17 && out[0]!.distanceLd < 18);
    assert.equal(out[0]!.velocityKms, 7.21184);
  });

  it('returns [] for non-CAD payloads', () => {
    assert.deepEqual(normalizeCloseApproaches(null), []);
    assert.deepEqual(normalizeCloseApproaches({ data: [] }), []);
    assert.deepEqual(normalizeCloseApproaches({ fields: ['x'], data: [['y']] }), []);
  });

  it('skips rows with unparseable dates or distances', () => {
    const bad = {
      fields: ['des', 'cd', 'dist'],
      data: [
        ['ok', '2026-May-31 00:54', '0.01'],
        ['baddate', 'nope', '0.01'],
        ['baddist', '2026-May-31 00:54', 'NaN'],
      ],
    };
    const out = normalizeCloseApproaches(bad);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.designation, 'ok');
  });
});

describe('normalizeImpactRisks', () => {
  const payload = {
    data: [
      { des: '1979 XB', fullname: '(1979 XB)', ip: '8.5e-07', n_imp: 4, ps_cum: '-2.69', diameter: '0.66', h: '18.54', range: '2056-2113' },
      { des: '2022 KK2', fullname: '(2022 KK2)', ip: '0.00012', n_imp: 33, ps_cum: '-5.58', diameter: '0.0069', h: '28.45', range: '2060-2122' },
    ],
  };

  it('parses Sentry objects sorted by Palermo scale (highest first)', () => {
    const out = normalizeImpactRisks(payload);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.designation, '1979 XB'); // ps_cum -2.69 > -5.58
    assert.equal(out[0]!.impactCount, 4);
    assert.ok(Math.abs(out[0]!.impactProbability - 8.5e-7) < 1e-9);
    assert.equal(out[0]!.diameterM, 660); // 0.66 km
    assert.equal(out[0]!.yearRange, '2056-2113');
  });

  it('falls back to H-estimated diameter when diameter missing', () => {
    const out = normalizeImpactRisks({ data: [{ des: 'X', ip: '1e-6', h: '20' }] });
    assert.ok(out[0]!.diameterM! > 0);
  });

  it('returns [] for non-Sentry payloads', () => {
    assert.deepEqual(normalizeImpactRisks(null), []);
    assert.deepEqual(normalizeImpactRisks({ data: 'nope' }), []);
  });

  it('skips entries without designation or impact probability', () => {
    const out = normalizeImpactRisks({ data: [{ des: '', ip: '1e-6' }, { des: 'Y' }] });
    assert.equal(out.length, 0);
  });
});

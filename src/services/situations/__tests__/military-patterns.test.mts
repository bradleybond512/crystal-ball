import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MILITARY_PATTERNS,
  matchAllMilitaryPatterns,
  matchMilitaryPattern,
} from '../military-patterns';

describe('matchMilitaryPattern', () => {
  it('returns null when no features defined', () => {
    const r = matchMilitaryPattern({
      pattern: { id: 'air_campaign_buildup', name: 'X', features: [], confirmingSignals: [], invalidatingSignals: [] },
    });
    assert.equal(r, null);
  });

  it('returns null when matchPercent below minMatch', () => {
    const r = matchMilitaryPattern({
      pattern: {
        id: 'air_campaign_buildup',
        name: 'Air',
        features: [
          { id: 'a', observed: false, weight: 1, label: 'a' },
          { id: 'b', observed: false, weight: 1, label: 'b' },
        ],
        confirmingSignals: [],
        invalidatingSignals: [],
      },
      minMatch: 0.3,
    });
    assert.equal(r, null);
  });

  it('matches when enough features observed', () => {
    const r = matchMilitaryPattern({
      pattern: {
        id: 'air_campaign_buildup',
        name: 'Air',
        features: [
          { id: 'a', observed: true, weight: 1, label: 'a' },
          { id: 'b', observed: true, weight: 1, label: 'b' },
          { id: 'c', observed: false, weight: 1, label: 'c' },
        ],
        confirmingSignals: ['a', 'b', 'c'],
        invalidatingSignals: [],
      },
      minMatch: 0.5,
    });
    assert.ok(r);
    assert.equal(r?.matchPercent, 0.67);
    assert.ok((r?.confidence ?? 0) >= 0.67);
  });

  it('confidence caps at 0.95', () => {
    const features = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), observed: true, weight: 1, label: String(i),
    }));
    const r = matchMilitaryPattern({
      pattern: {
        id: 'air_campaign_buildup',
        name: 'Air',
        features,
        confirmingSignals: features.map((f) => f.id),
        invalidatingSignals: [],
      },
    });
    assert.ok((r?.confidence ?? 0) <= 0.95);
  });
});

describe('matchAllMilitaryPatterns', () => {
  it('returns matches sorted by confidence desc', () => {
    const observations = {
      'tanker-surge': true,
      'awacs-presence': true,
      'fighter-deployments': true,
      'NOTAM-massive-airspace': false,
      'carrier-group-positioned': true,
    };
    const matches = matchAllMilitaryPatterns(observations, DEFAULT_MILITARY_PATTERNS, 0.3);
    assert.ok(matches.length >= 1);
    // Sorted desc
    for (let i = 1; i < matches.length; i++) {
      assert.ok(matches[i - 1]!.confidence >= matches[i]!.confidence);
    }
  });

  it('empty observations → empty result', () => {
    const matches = matchAllMilitaryPatterns({});
    assert.deepEqual(matches, []);
  });

  it('air_campaign_buildup recognized when 3 of 4 confirming signals fire', () => {
    const observations = {
      'tanker-surge': true,
      'awacs-presence': true,
      'fighter-deployments': true,
      'NOTAM-massive-airspace': false,
    };
    const matches = matchAllMilitaryPatterns(observations);
    const air = matches.find((m) => m.patternId === 'air_campaign_buildup');
    assert.ok(air);
    assert.equal(air?.matchPercent, 0.75);
  });
});

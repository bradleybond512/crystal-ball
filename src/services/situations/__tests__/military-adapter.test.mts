import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { militaryPosturesToSituations, type TheaterPostureInput } from '../military-adapter';

const NOW = 1_745_000_000_000;

function fakePosture(overrides: Partial<TheaterPostureInput> = {}): TheaterPostureInput {
  return {
    theaterId: 'taiwan-strait',
    theaterName: 'Taiwan Strait',
    posture: 'elevated',
    postureScore: 0.4,
    priorScore: 0.3,
    evidence: [
      {
        id: 'e1',
        source: 'OpenSky',
        claim: 'Aircraft surge above baseline',
        observedAt: NOW,
        weight: 0.6,
      },
    ],
    agreeingSources: ['OpenSky', 'NOTAMs'],
    disagreeingSources: [],
    observedAt: NOW,
    ...overrides,
  };
}

describe('militaryPosturesToSituations — empty input', () => {
  it('returns empty for no postures', () => {
    assert.deepEqual(militaryPosturesToSituations({ postures: [], now: () => NOW }), []);
  });

  it('filters out normal posture', () => {
    assert.deepEqual(
      militaryPosturesToSituations({
        postures: [fakePosture({ posture: 'normal' })],
        now: () => NOW,
      }),
      [],
    );
  });
});

describe('militaryPosturesToSituations — posture floor', () => {
  it('strike_ready cannot drop below critical even with low raw score', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ posture: 'strike_ready', postureScore: 0.2 })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'critical');
  });

  it('active_escalation forces emergency tier', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ posture: 'active_escalation', postureScore: 0.5 })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'emergency');
  });

  it('elevated lands in watch tier when raw score is low', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ posture: 'elevated', postureScore: 0.3 })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'watch');
  });
});

describe('militaryPosturesToSituations — confidence scaling', () => {
  it('more independent agreeing sources → higher confidence', () => {
    const lo = militaryPosturesToSituations({
      postures: [fakePosture({ agreeingSources: ['A'] })],
      now: () => NOW,
    })[0];
    const hi = militaryPosturesToSituations({
      postures: [fakePosture({ agreeingSources: ['A', 'B', 'C', 'D'] })],
      now: () => NOW,
    })[0];
    assert.ok((hi?.confidence ?? 0) > (lo?.confidence ?? 1));
  });

  it('confidence caps at 0.95', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ agreeingSources: Array.from({ length: 20 }, (_, i) => `S${i}`) })],
      now: () => NOW,
    });
    assert.ok((s?.confidence ?? 0) <= 0.95);
  });
});

describe('militaryPosturesToSituations — diagnostics trace', () => {
  it('records the posture floor + raw score in severityRationale', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ posture: 'strike_ready', postureScore: 0.2 })],
      now: () => NOW,
    });
    assert.match(s?.diagnosticsTrace.severityRationale ?? '', /floor|score|tier/i);
  });

  it('includes posture and severity in thresholdsCrossed', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ posture: 'deployment' })],
      now: () => NOW,
    });
    assert.ok(s?.diagnosticsTrace.thresholdsCrossed.some((t) => t.startsWith('posture:')));
    assert.ok(s?.diagnosticsTrace.thresholdsCrossed.some((t) => t.startsWith('severity:')));
  });
});

describe('militaryPosturesToSituations — whatChanged narrative', () => {
  it('reports rising direction when score increased', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ priorScore: 0.3, postureScore: 0.5 })],
      now: () => NOW,
    });
    assert.match(s?.whatChanged[0]?.text ?? '', /rising/i);
  });

  it('reports falling direction when score decreased', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ posture: 'elevated', priorScore: 0.6, postureScore: 0.4 })],
      now: () => NOW,
    });
    assert.match(s?.whatChanged[0]?.text ?? '', /falling/i);
  });

  it('reports steady when delta is small', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ priorScore: 0.4, postureScore: 0.41 })],
      now: () => NOW,
    });
    assert.doesNotMatch(s?.whatChanged[0]?.text ?? '', /rising|falling/i);
  });
});

describe('militaryPosturesToSituations — output shape', () => {
  it('namespaces ids with military: prefix', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture({ theaterId: 'persian-gulf' })],
      now: () => NOW,
    });
    assert.equal(s?.id, 'military:persian-gulf');
  });

  it('produces JSON-serializable Situations', () => {
    const sits = militaryPosturesToSituations({
      postures: [fakePosture()],
      now: () => NOW,
    });
    assert.doesNotThrow(() => JSON.stringify(sits));
  });

  it('seeds expected and invalidation signals', () => {
    const [s] = militaryPosturesToSituations({
      postures: [fakePosture()],
      now: () => NOW,
    });
    assert.ok((s?.expectedNextSignals.length ?? 0) >= 3);
    assert.ok((s?.invalidationSignals.length ?? 0) >= 2);
  });
});

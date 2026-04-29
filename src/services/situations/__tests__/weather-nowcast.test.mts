import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateWeatherNowcast, type NowcastSignal } from '../weather-nowcast';

const NOW = 1_745_000_000_000;

function sig(kind: NowcastSignal['kind'], strength = 0.8, source = 'NWS'): NowcastSignal {
  return { kind, observedAt: NOW, strength, source };
}

describe('evaluateWeatherNowcast — empty', () => {
  it('zero signals → not escalating, slight urgency decay', () => {
    const e = evaluateWeatherNowcast({ signals: [] });
    assert.equal(e.escalate, false);
    assert.equal(e.confirmed, false);
    assert.ok(e.urgencyDelta < 0);
  });
});

describe('evaluateWeatherNowcast — escalation', () => {
  it('moderate weighted signals escalate but not confirm', () => {
    const e = evaluateWeatherNowcast({
      signals: [
        sig('radar_core_strengthening', 1.0),
        sig('lightning_density_rise', 1.0),
        // 0.25 + 0.15 = 0.40 — still below escalateAt 0.5 default
      ],
    });
    assert.equal(e.escalate, false);
    assert.equal(e.confirmed, false);
  });

  it('strong multi-kind signals reach escalate', () => {
    const e = evaluateWeatherNowcast({
      signals: [
        sig('radar_core_strengthening', 1.0),
        sig('lightning_density_rise', 1.0),
        sig('storm_reports', 1.0),
        // 0.25 + 0.15 + 0.20 = 0.60
      ],
    });
    assert.equal(e.escalate, true);
    assert.ok(e.urgencyDelta > 0);
  });

  it('saturated signals reach confirm', () => {
    const e = evaluateWeatherNowcast({
      signals: [
        sig('radar_core_strengthening', 1.0),
        sig('lightning_density_rise', 1.0),
        sig('storm_reports', 1.0),
        sig('power_outage_reports', 1.0),
        sig('airport_ground_stops', 1.0),
        // 0.25+0.15+0.20+0.15+0.10 = 0.85
      ],
    });
    assert.equal(e.confirmed, true);
  });
});

describe('evaluateWeatherNowcast — byKind tally', () => {
  it('counts each signal kind', () => {
    const e = evaluateWeatherNowcast({
      signals: [
        sig('storm_reports'),
        sig('storm_reports'),
        sig('radar_core_strengthening'),
      ],
    });
    assert.equal(e.byKind.storm_reports, 2);
    assert.equal(e.byKind.radar_core_strengthening, 1);
    assert.equal(e.byKind.lightning_density_rise, 0);
  });
});

describe('evaluateWeatherNowcast — urgencyDelta bounds', () => {
  it('urgencyDelta capped at +0.2 even with overwhelming signals', () => {
    const signals = Array.from({ length: 50 }, () => sig('storm_reports', 1.0));
    const e = evaluateWeatherNowcast({ signals });
    assert.ok(e.urgencyDelta <= 0.2);
  });
});

describe('evaluateWeatherNowcast — reason text', () => {
  it('confirmed → reason mentions confirmed', () => {
    const e = evaluateWeatherNowcast({
      signals: [
        sig('radar_core_strengthening', 1.0),
        sig('lightning_density_rise', 1.0),
        sig('storm_reports', 1.0),
        sig('power_outage_reports', 1.0),
        sig('airport_ground_stops', 1.0),
      ],
    });
    assert.match(e.reason, /Confirmed/i);
  });

  it('not escalating → reason mentions threshold', () => {
    const e = evaluateWeatherNowcast({ signals: [sig('storm_reports', 0.3)] });
    assert.match(e.reason, /below|threshold/i);
  });
});

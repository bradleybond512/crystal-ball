import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CivilizationPulseService,
  resetServiceForTests,
  SERVICE_STORAGE_KEY,
  SERVICE_MAX_HISTORY,
  SEVERITY_TO_SCORE,
  PULSE_DOMAIN_WEIGHTS,
  PULSE_STATUS_THRESHOLDS,
  type CivilizationPulse,
} from '../../src/services/intelligence/civilization-pulse.ts';

const T0 = 1_780_000_000_000;

function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(k: string): string | null { return data.get(k) ?? null; },
    setItem(k: string, v: string): void { data.set(k, v); },
  };
}

describe('CivilizationPulseService — seed domains', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('seeds 8 pulse domains with the expected weights', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    const domains = svc.getDomains().map((d) => d.domain).sort((a, b) => a.localeCompare(b));
    assert.deepEqual(
      domains,
      ['climate', 'cyber', 'economic', 'geopolitical', 'health', 'infrastructure', 'social', 'space'],
    );
  });

  it('seed weights match the spec', () => {
    assert.equal(PULSE_DOMAIN_WEIGHTS.geopolitical, 0.2);
    assert.equal(PULSE_DOMAIN_WEIGHTS.economic, 0.18);
    assert.equal(PULSE_DOMAIN_WEIGHTS.health, 0.15);
    assert.equal(PULSE_DOMAIN_WEIGHTS.cyber, 0.15);
    assert.equal(PULSE_DOMAIN_WEIGHTS.climate, 0.12);
    assert.equal(PULSE_DOMAIN_WEIGHTS.social, 0.1);
    assert.equal(PULSE_DOMAIN_WEIGHTS.infrastructure, 0.05);
    assert.equal(PULSE_DOMAIN_WEIGHTS.space, 0.05);
  });

  it('weights sum to 1.0', () => {
    const sum = Object.values(PULSE_DOMAIN_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  it('initial domain scores default to 1.0 (nominal)', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    for (const d of svc.getDomains()) assert.equal(d.currentScore, 1);
  });

  it('initial trend is stable for every seeded domain', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    for (const d of svc.getDomains()) assert.equal(d.trend, 'stable');
  });
});

describe('CivilizationPulseService — severity → score mapping', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('SEVERITY_TO_SCORE matches the spec', () => {
    assert.equal(SEVERITY_TO_SCORE[0], 1);
    assert.equal(SEVERITY_TO_SCORE[1], 0.8);
    assert.equal(SEVERITY_TO_SCORE[2], 0.6);
    assert.equal(SEVERITY_TO_SCORE[3], 0.3);
    assert.equal(SEVERITY_TO_SCORE[4], 0);
  });

  it('update with severity 0 sets domain score to 1.0', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('cyber', 0);
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.currentScore, 1);
  });

  it('update with severity 4 sets domain score to 0', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('cyber', 4);
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.currentScore, 0);
  });

  it('update with severity 2 rolls into the 10-sample mean', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    // First update overwrites the seed default 1.0
    svc.update('cyber', 2); // → 0.6 mean of [0.6]
    let cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.currentScore, 0.6);
    // Second update adds another sample
    svc.update('cyber', 2); // → mean of [0.6, 0.6] = 0.6
    cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.currentScore, 0.6);
  });

  it('update rolls mean across mixed severities', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('cyber', 0); // 1.0
    svc.update('cyber', 4); // 0.0  → mean 0.5
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.ok(Math.abs((cyber?.currentScore ?? 0) - 0.5) < 1e-9);
  });

  it('out-of-range severity clamps to nearest valid bucket', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('cyber', -1);
    let cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.currentScore, 1); // severity clamped to 0 → 1.0
    resetServiceForTests();
    const svc2 = new CivilizationPulseService({ now: () => T0, storage: null });
    svc2.update('cyber', 99);
    cyber = svc2.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.currentScore, 0); // severity clamped to 4 → 0.0
  });

  it('rolling window caps at 10 samples', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    for (let i = 0; i < 15; i++) svc.update('cyber', 4); // all 0.0
    // Adding two 1.0s should pull the mean up to (0*8 + 1*2)/10 = 0.2
    svc.update('cyber', 0);
    svc.update('cyber', 0);
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.ok(Math.abs((cyber?.currentScore ?? -1) - 0.2) < 1e-9);
  });

  it('update unknown domain auto-registers it with default weight', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('mystery-domain', 2);
    const m = svc.getDomains().find((d) => d.domain === 'mystery-domain');
    assert.ok(m);
    assert.equal(m?.currentScore, 0.6);
    assert.ok((m?.weight ?? 0) > 0);
  });

  it('update sets lastUpdated to clock()', () => {
    let t = T0;
    const svc = new CivilizationPulseService({ now: () => t, storage: null });
    t += 5000;
    svc.update('cyber', 2);
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.lastUpdated, T0 + 5000);
  });
});

describe('CivilizationPulseService — getPulse composite', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('initial pulse is 1.0 nominal (all domains at default score)', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    const pulse = svc.getPulse();
    assert.ok(Math.abs(pulse.compositeScore - 1) < 1e-9);
    assert.equal(pulse.status, 'nominal');
  });

  it('compositeScore is weighted across domains', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    // Knock cyber (weight 0.15) down to 0 — others stay at 1.0
    svc.update('cyber', 4);
    const pulse = svc.getPulse();
    const expected = 1 - PULSE_DOMAIN_WEIGHTS.cyber; // 0.85
    assert.ok(Math.abs(pulse.compositeScore - expected) < 1e-9);
  });

  it('status status bucket: nominal >= 0.7', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('cyber', 4); // drops 0.15 → composite 0.85
    assert.equal(svc.getPulse().status, 'nominal');
  });

  it('status status bucket: elevated 0.5..0.7', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    // Drop geopolitical(0.2) + economic(0.18) + health(0.15) → composite 1 - 0.53 = 0.47 (stressed)
    // Drop geopolitical(0.2) + cyber(0.15) → composite 1 - 0.35 = 0.65 (elevated)
    svc.update('geopolitical', 4);
    svc.update('cyber', 4);
    assert.equal(svc.getPulse().status, 'elevated');
  });

  it('status status bucket: stressed 0.3..0.5', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    // Drop geopolitical(0.2) + economic(0.18) + cyber(0.15) → 0.53 stressed
    svc.update('geopolitical', 4);
    svc.update('economic', 4);
    svc.update('cyber', 4);
    assert.equal(svc.getPulse().status, 'stressed');
  });

  it('status status bucket: critical < 0.3', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    // Drop all 8 seed domains to 0 → composite 0
    for (const domain of Object.keys(PULSE_DOMAIN_WEIGHTS)) svc.update(domain, 4);
    assert.equal(svc.getPulse().status, 'critical');
  });

  it('PULSE_STATUS_THRESHOLDS match the spec', () => {
    assert.equal(PULSE_STATUS_THRESHOLDS.nominal, 0.7);
    assert.equal(PULSE_STATUS_THRESHOLDS.elevated, 0.5);
    assert.equal(PULSE_STATUS_THRESHOLDS.stressed, 0.3);
  });

  it('compositeScore is between 0 and 1 inclusive', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('cyber', 2);
    svc.update('economic', 1);
    const p = svc.getPulse();
    assert.ok(p.compositeScore >= 0 && p.compositeScore <= 1);
  });
});

describe('CivilizationPulseService — deltaFromPrevious', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('first pulse has deltaFromPrevious 0', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    assert.equal(svc.getPulse().deltaFromPrevious, 0);
  });

  it('deltaFromPrevious reflects change since last persisted pulse', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.getPulse(); // persist baseline 1.0
    svc.update('cyber', 4); // → 0.85
    const next = svc.getPulse();
    assert.ok(Math.abs(next.deltaFromPrevious - (0.85 - 1)) < 1e-9);
  });

  it('deltaFromPrevious can be positive when recovering', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('cyber', 4); // 0.85
    svc.getPulse(); // persist 0.85
    svc.update('cyber', 0); // back toward 1.0 (rolling mean of [0,1] = 0.5 → composite 1 - 0.15*0.5 = 0.925)
    const next = svc.getPulse();
    assert.ok(next.deltaFromPrevious > 0);
  });
});

describe('CivilizationPulseService — trend detection', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('trend is stable when score barely moves', () => {
    let t = T0;
    const svc = new CivilizationPulseService({ now: () => t, storage: null });
    // Push the cyber domain's history with a tiny mid-range jitter
    for (let i = 0; i < 6; i++) {
      svc.update('cyber', 2); // 0.6
      t += 1000;
    }
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.trend, 'stable');
  });

  it('trend is degrading when current score is well below 5-back average', () => {
    let t = T0;
    const svc = new CivilizationPulseService({ now: () => t, storage: null });
    // 5 good samples
    for (let i = 0; i < 5; i++) { svc.update('cyber', 0); t += 1000; } // score 1.0
    // Then a worse sample drops the rolling mean
    svc.update('cyber', 4); t += 1000; // mean now ~ (1*5 + 0)/6 = 0.833
    svc.update('cyber', 4);            // mean now (1*5 + 0*2)/7 = 0.714 → still > 0.5 trip vs older 1.0
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.trend, 'degrading');
  });

  it('trend is improving when current score is well above 5-back average', () => {
    let t = T0;
    const svc = new CivilizationPulseService({ now: () => t, storage: null });
    for (let i = 0; i < 5; i++) { svc.update('cyber', 4); t += 1000; } // score 0
    svc.update('cyber', 0); t += 1000; // mean (0*5 + 1)/6 = 0.166
    svc.update('cyber', 0);            // mean (0*5 + 1*2)/7 = 0.285
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.trend, 'improving');
  });
});

describe('CivilizationPulseService — getDomains ordering', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('getDomains returns worst-first', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('cyber', 4);     // → 0
    svc.update('economic', 2);  // → 0.6
    const domains = svc.getDomains();
    assert.equal(domains[0]?.domain, 'cyber');
    assert.ok((domains[0]?.currentScore ?? 1) <= (domains[1]?.currentScore ?? 0));
  });

  it('getDomains returns defensive copies', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    const first = svc.getDomains();
    first[0]!.currentScore = -999;
    const second = svc.getDomains();
    assert.notEqual(second[0]?.currentScore, -999);
  });
});

describe('CivilizationPulseService — getHistory + ring buffer', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('SERVICE_MAX_HISTORY is 200', () => {
    assert.equal(SERVICE_MAX_HISTORY, 200);
  });

  it('history caps at maxHistory', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null, maxHistory: 3 });
    for (let i = 0; i < 6; i++) svc.getPulse();
    assert.equal(svc.getHistory().length, 3);
  });

  it('history is LIFO (latest first)', () => {
    let t = T0;
    const svc = new CivilizationPulseService({ now: () => t, storage: null });
    svc.getPulse(); t += 1000;
    svc.update('cyber', 4); svc.getPulse(); t += 1000;
    svc.update('cyber', 0); const last = svc.getPulse();
    const history = svc.getHistory();
    assert.equal(history[0]?.timestamp, last.timestamp);
  });
});

describe('CivilizationPulseService — persistence', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('domain state + history persists + hydrates', () => {
    const storage = memoryStorage();
    const svc1 = new CivilizationPulseService({ now: () => T0, storage });
    svc1.update('cyber', 4);
    svc1.getPulse();
    const svc2 = new CivilizationPulseService({ now: () => T0, storage });
    const cyber = svc2.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.currentScore, 0);
    assert.equal(svc2.getHistory().length, 1);
  });

  it('storage key is wm-civilization-pulse-service (sibling of legacy engine)', () => {
    assert.equal(SERVICE_STORAGE_KEY, 'wm-civilization-pulse-service');
  });

  it('malformed persisted state recovers gracefully', () => {
    const storage = memoryStorage();
    storage.setItem(SERVICE_STORAGE_KEY, '{not json');
    const svc = new CivilizationPulseService({ now: () => T0, storage });
    // Should re-seed defaults
    assert.equal(svc.getDomains().length, 8);
    assert.equal(svc.getPulse().status, 'nominal');
  });

  it('null storage means no persistence', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    svc.update('cyber', 4);
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.currentScore, 0);
  });
});

describe('CivilizationPulseService — getInstance singleton', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('getInstance returns the same instance across calls', () => {
    const a = CivilizationPulseService.getInstance();
    const b = CivilizationPulseService.getInstance();
    assert.equal(a, b);
  });

  it('resetServiceForTests clears the singleton', () => {
    const a = CivilizationPulseService.getInstance();
    resetServiceForTests();
    const b = CivilizationPulseService.getInstance();
    assert.notEqual(a, b);
  });
});

describe('CivilizationPulseService — clear', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('clear resets domain scores to defaults and empties history', () => {
    const storage = memoryStorage();
    const svc = new CivilizationPulseService({ now: () => T0, storage });
    svc.update('cyber', 4);
    svc.getPulse();
    svc.clear();
    const cyber = svc.getDomains().find((d) => d.domain === 'cyber');
    assert.equal(cyber?.currentScore, 1);
    assert.equal(svc.getHistory().length, 0);
    // Verify persisted state matches
    const svc2 = new CivilizationPulseService({ now: () => T0, storage });
    assert.equal(svc2.getHistory().length, 0);
  });
});

describe('CivilizationPulseService — pulse shape', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('getPulse returns a CivilizationPulse with all expected fields', () => {
    const svc = new CivilizationPulseService({ now: () => T0, storage: null });
    const pulse: CivilizationPulse = svc.getPulse();
    assert.ok(typeof pulse.compositeScore === 'number');
    assert.ok(typeof pulse.status === 'string');
    assert.ok(Array.isArray(pulse.domains));
    assert.equal(pulse.domains.length, 8);
    assert.ok(typeof pulse.deltaFromPrevious === 'number');
    assert.equal(pulse.timestamp, T0);
  });
});

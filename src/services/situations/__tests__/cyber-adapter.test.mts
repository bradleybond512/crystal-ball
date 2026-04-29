import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { cyberThreatsToSituations, type CyberThreatInput } from '../cyber-adapter';

const NOW = 1_745_000_000_000;

function fakeThreat(overrides: Partial<CyberThreatInput> = {}): CyberThreatInput {
  return {
    threatId: 'CVE-2026-12345',
    title: 'Critical macOS WebKit RCE',
    stagesReached: ['cve_published', 'exploit_observed'],
    affectedSectors: [],
    affectedVendors: ['Apple macOS'],
    evidence: [
      {
        id: 'cisa-1',
        source: 'CISA',
        claim: 'Active exploitation observed',
        observedAt: NOW,
        weight: 0.8,
      },
    ],
    agreeingSources: ['CISA', 'Apple'],
    disagreeingSources: [],
    observedAt: NOW,
    ...overrides,
  };
}

describe('cyberThreatsToSituations — empty input', () => {
  it('returns empty for no threats', () => {
    assert.deepEqual(cyberThreatsToSituations({ threats: [], now: () => NOW }), []);
  });
});

describe('cyberThreatsToSituations — lifecycle stage scoring', () => {
  it('cve_published only → fyi tier', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ stagesReached: ['cve_published'] })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'fyi');
  });

  it('exploit_observed → elevated tier', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ stagesReached: ['cve_published', 'exploit_observed'] })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'elevated');
  });

  it('user_exposed → emergency tier', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({
        stagesReached: ['cve_published', 'exploit_observed', 'kev_listed', 'user_exposed'],
      })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'emergency');
  });
});

describe('cyberThreatsToSituations — critical-infrastructure bump', () => {
  it('finance sector bumps the score above the bare lifecycle stage', () => {
    const baseline = cyberThreatsToSituations({
      threats: [fakeThreat({
        stagesReached: ['cve_published', 'exploit_observed'],
        affectedSectors: [],
      })],
      now: () => NOW,
    })[0];
    const withInfra = cyberThreatsToSituations({
      threats: [fakeThreat({
        stagesReached: ['cve_published', 'exploit_observed'],
        affectedSectors: ['finance'],
      })],
      now: () => NOW,
    })[0];
    // Both should be `elevated` — the +0.1 bump pushes inside the
    // same tier — but the diagnostics trace should record it.
    assert.match(withInfra?.diagnosticsTrace.severityRationale ?? '', /infra-bump \+0\.1/);
    assert.doesNotMatch(baseline?.diagnosticsTrace.severityRationale ?? '', /infra-bump \+0\.1/);
  });

  it('flags critical_infra in thresholdsCrossed when applicable', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ affectedSectors: ['power_grid'] })],
      now: () => NOW,
    });
    assert.ok(s?.diagnosticsTrace.thresholdsCrossed.includes('critical_infra'));
  });
});

describe('cyberThreatsToSituations — user vendor matching', () => {
  it('matching vendor bumps user exposure to high', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ affectedVendors: ['Apple macOS'] })],
      user: { userVendors: ['macos'] },
      now: () => NOW,
    });
    assert.ok((s?.userExposure ?? 0) >= 0.85);
    assert.equal(s?.personalImpact.level, 'high');
  });

  it('vendor mismatch keeps user exposure low', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ affectedVendors: ['Microsoft Windows'] })],
      user: { userVendors: ['macos'] },
      now: () => NOW,
    });
    assert.ok((s?.userExposure ?? 1) <= 0.2);
  });

  it('user vendor match flags user_vendor_match in thresholdsCrossed', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ affectedVendors: ['Apple macOS'] })],
      user: { userVendors: ['macos'] },
      now: () => NOW,
    });
    assert.ok(s?.diagnosticsTrace.thresholdsCrossed.includes('user_vendor_match'));
  });
});

describe('cyberThreatsToSituations — recommended actions', () => {
  it('user-vendor match → immediate patch action', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ stagesReached: ['cve_published', 'exploit_observed', 'kev_listed'] })],
      user: { userVendors: ['macos'] },
      now: () => NOW,
    });
    assert.ok(s?.recommendedActions.some((a) => a.urgency === 'immediate' && /patch/i.test(a.text)));
  });

  it('no user exposure + low severity → fyi only', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ stagesReached: ['cve_published'] })],
      now: () => NOW,
    });
    assert.ok(s?.recommendedActions.every((a) => a.urgency === 'fyi'));
  });
});

describe('cyberThreatsToSituations — diagnostics trace', () => {
  it('records stage and severity in thresholdsCrossed', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat()],
      now: () => NOW,
    });
    assert.ok(s?.diagnosticsTrace.thresholdsCrossed.some((t) => t.startsWith('stage:')));
    assert.ok(s?.diagnosticsTrace.thresholdsCrossed.some((t) => t.startsWith('severity:')));
  });

  it('records source contributions', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ agreeingSources: ['CISA', 'Apple'] })],
      now: () => NOW,
    });
    const total = Object.values(s?.diagnosticsTrace.sourceContributions ?? {}).reduce((a, b) => a + b, 0);
    assert.ok(total > 0.99 && total < 1.01); // sums to ~1.0
  });
});

describe('cyberThreatsToSituations — output shape', () => {
  it('namespaces ids with cyber: prefix', () => {
    const [s] = cyberThreatsToSituations({
      threats: [fakeThreat({ threatId: 'CVE-2026-99999' })],
      now: () => NOW,
    });
    assert.equal(s?.id, 'cyber:CVE-2026-99999');
  });

  it('produces JSON-serializable Situations', () => {
    const sits = cyberThreatsToSituations({
      threats: [fakeThreat()],
      now: () => NOW,
    });
    assert.doesNotThrow(() => JSON.stringify(sits));
  });
});

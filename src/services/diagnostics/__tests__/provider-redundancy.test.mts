import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessProviderRedundancy,
  type ProviderSnapshot,
} from '../provider-redundancy.ts';

const NOW = 1_745_000_000_000;

function snap(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    providerId: 'nws',
    domain: 'weather',
    label: 'NWS Alerts',
    primary: true,
    level: 'healthy',
    lastSuccessAt: NOW,
    successRate: 0.99,
    ...overrides,
  };
}

// ── Verdict matrix ─────────────────────────────────────────────────────

test('redundant agreement: 2+ providers up with matching fingerprints', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'nws', primary: true, recentFactFingerprint: 'abc' }),
      snap({ providerId: 'noaa-radar', primary: false, recentFactFingerprint: 'abc' }),
    ],
  });
  assert.equal(r.domains[0]?.verdict, 'redundant_agreement');
  assert.equal(r.domains[0]?.confidenceMultiplier, 1);
});

test('redundant disagreement: 2+ providers up but different fingerprints', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'nws', primary: true, recentFactFingerprint: 'abc' }),
      snap({ providerId: 'noaa-radar', primary: false, recentFactFingerprint: 'xyz' }),
    ],
  });
  assert.equal(r.domains[0]?.verdict, 'redundant_disagreement');
  assert.equal(r.domains[0]?.confidenceMultiplier, 0.6);
});

test('single_source: only one provider configured', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [snap()],
  });
  assert.equal(r.domains[0]?.verdict, 'single_source');
  assert.equal(r.domains[0]?.confidenceMultiplier, 0.7);
});

test('primary_down_with_backup: primary silent but backup healthy', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'nws', primary: true, level: 'silent' }),
      snap({ providerId: 'noaa-radar', primary: false, level: 'healthy' }),
    ],
  });
  assert.equal(r.domains[0]?.verdict, 'primary_down_with_backup');
});

test('all_down: every provider failing/silent', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'a', primary: true, level: 'silent' }),
      snap({ providerId: 'b', primary: false, level: 'failing' }),
    ],
  });
  assert.equal(r.domains[0]?.verdict, 'all_down');
  assert.equal(r.domains[0]?.confidenceMultiplier, 0);
});

// ── not_configured: never enabled ≠ broken ─────────────────────────────
// `all_down` says "you had these sources and they stopped answering", and its
// remediation sends the user to check the sidecar and the network. When the
// only provider is key-gated and the key was never entered, that advice is
// wrong — nothing is broken, the domain was simply never switched on.

test('domain whose only provider is key-gated and unconfigured reads not_configured', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({
        providerId: 'eia',
        domain: 'commodities',
        primary: true,
        level: 'failing',
        unconfiguredSecret: 'EIA_API_KEY',
      }),
    ],
  });
  const d = r.domains[0]!;
  assert.equal(d.verdict, 'not_configured');
  assert.equal(d.confidenceMultiplier, 0);
  assert.match(d.reason, /EIA_API_KEY/);
  assert.match(d.remediation, /EIA_API_KEY/);
  assert.match(d.remediation, /API Keys/);
  assert.doesNotMatch(d.remediation, /sidecar/);
});

test('not_configured names every missing key when several providers are gated', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({
        providerId: 'airnow',
        domain: 'air_quality',
        primary: true,
        level: 'failing',
        unconfiguredSecret: 'AIRNOW_API_KEY',
      }),
      snap({
        providerId: 'purpleair',
        domain: 'air_quality',
        primary: false,
        level: 'failing',
        unconfiguredSecret: 'PURPLEAIR_API_KEY',
      }),
    ],
  });
  const d = r.domains[0]!;
  assert.equal(d.verdict, 'not_configured');
  assert.match(d.remediation, /AIRNOW_API_KEY/);
  assert.match(d.remediation, /PURPLEAIR_API_KEY/);
});

test('an unconfigured provider next to a genuinely broken one stays all_down', () => {
  // Something here WAS enabled and stopped answering. "Add a key" would be the
  // wrong advice, so the outage verdict must win.
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'ioda', domain: 'internet_health', primary: true, level: 'silent' }),
      snap({
        providerId: 'cloudflare-radar',
        domain: 'internet_health',
        primary: false,
        level: 'failing',
        unconfiguredSecret: 'CLOUDFLARE_API_TOKEN',
      }),
    ],
  });
  assert.equal(r.domains[0]?.verdict, 'all_down');
});

test('a live outage outranks a config gap in sort and recommendation order', () => {
  // "Your primary broke" is a live problem; "you never added a key" is a gap to
  // close when convenient. The urgent one has to lead.
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({
        providerId: 'eia',
        domain: 'commodities',
        primary: true,
        level: 'failing',
        unconfiguredSecret: 'EIA_API_KEY',
      }),
      snap({ providerId: 'p', domain: 'weather', primary: true, level: 'silent' }),
      snap({ providerId: 'b', domain: 'weather', primary: false, level: 'healthy' }),
    ],
  });
  assert.equal(r.domains[0]?.verdict, 'primary_down_with_backup');
  assert.deepEqual(r.domains.map((d) => d.domain), ['weather', 'commodities']);
  assert.match(r.recommendations[0] ?? '', /investigate the primary/);
});

test('not_configured sorts ahead of a working domain but behind a real outage', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'a', domain: 'weather', primary: true, recentFactFingerprint: 'x' }),
      snap({ providerId: 'b', domain: 'weather', primary: false, recentFactFingerprint: 'x' }),
      snap({
        providerId: 'eia',
        domain: 'commodities',
        primary: true,
        level: 'failing',
        unconfiguredSecret: 'EIA_API_KEY',
      }),
      snap({ providerId: 'c', domain: 'adsb', primary: true, level: 'silent' }),
    ],
  });
  assert.deepEqual(r.domains.map((d) => d.domain), ['adsb', 'commodities', 'weather']);
});

// ── Multi-domain ───────────────────────────────────────────────────────

test('multi-domain: each gets its own verdict', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'nws', domain: 'weather', primary: true, recentFactFingerprint: 'a' }),
      snap({ providerId: 'noaa', domain: 'weather', primary: false, recentFactFingerprint: 'a' }),
      snap({ providerId: 'adsbexchange', domain: 'adsb', primary: true, level: 'silent' }),
    ],
  });
  const wx = r.domains.find((d) => d.domain === 'weather');
  const adsb = r.domains.find((d) => d.domain === 'adsb');
  assert.equal(wx?.verdict, 'redundant_agreement');
  assert.equal(adsb?.verdict, 'all_down');
});

// ── Sort order ─────────────────────────────────────────────────────────

test('domains sorted with worst-first', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'a', domain: 'weather', primary: true, recentFactFingerprint: 'x' }),
      snap({ providerId: 'b', domain: 'weather', primary: false, recentFactFingerprint: 'x' }),
      snap({ providerId: 'c', domain: 'adsb', primary: true, level: 'silent' }),
    ],
  });
  assert.equal(r.domains[0]?.domain, 'adsb');
});

test('providers within a domain sorted primary-first then by level', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'b', domain: 'x', primary: false, level: 'healthy' }),
      snap({ providerId: 'a', domain: 'x', primary: true, level: 'degraded' }),
    ],
  });
  assert.equal(r.domains[0]?.providers[0]?.providerId, 'a');
});

// ── Recommendations ────────────────────────────────────────────────────

test('redundant_agreement domains contribute no recommendation', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'a', primary: true, recentFactFingerprint: 'x' }),
      snap({ providerId: 'b', primary: false, recentFactFingerprint: 'x' }),
    ],
  });
  assert.equal(r.recommendations.length, 0);
});

test('disagreement contributes a manual-review recommendation', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'a', primary: true, recentFactFingerprint: 'x' }),
      snap({ providerId: 'b', primary: false, recentFactFingerprint: 'y' }),
    ],
  });
  assert.match(r.recommendations[0] ?? '', /disagree/);
});

// ── Summary ────────────────────────────────────────────────────────────

test('summary highlights stressed domain count', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'a', domain: 'weather', primary: true, recentFactFingerprint: 'x' }),
      snap({ providerId: 'b', domain: 'weather', primary: false, recentFactFingerprint: 'x' }),
      snap({ providerId: 'c', domain: 'adsb', primary: true }),
    ],
  });
  assert.match(r.summary, /stressed/);
});

test('all-healthy summary celebrates redundancy', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'a', primary: true, recentFactFingerprint: 'x' }),
      snap({ providerId: 'b', primary: false, recentFactFingerprint: 'x' }),
    ],
  });
  assert.match(r.summary, /redundant agreement/);
});

// ── JSON ───────────────────────────────────────────────────────────────

test('report is JSON-serializable', () => {
  const r = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [snap()],
  });
  const parsed = JSON.parse(JSON.stringify(r)) as { domains: unknown[] };
  assert.ok(Array.isArray(parsed.domains));
});

test('two providers up but NO comparable fingerprints → redundant_unverified (round-1 #12)', () => {
  // The bridges don't (yet) populate recentFactFingerprint, so without this the
  // verdict collapsed to a false full-confidence 'redundant_agreement'.
  const r = assessProviderRedundancy({
    generatedAt: 0,
    snapshots: [
      snap({ providerId: 'nws', primary: true }),
      snap({ providerId: 'noaa-radar', primary: false }),
    ],
  });
  assert.equal(r.domains[0].verdict, 'redundant_unverified');
  // Discounted from full confidence, but still better than a single source.
  assert.ok(r.domains[0].confidenceMultiplier < 1);
  assert.ok(r.domains[0].confidenceMultiplier > 0.7);
});

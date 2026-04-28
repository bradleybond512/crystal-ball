import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFeatureHealthRegistry,
  defaultConfidenceFor,
  defaultFeatureCatalog,
  type FeatureDefinition,
  type FeatureStatusContext,
} from '../feature-health-registry.ts';
import type { HealthStatus, PanelId, ProviderId, ServiceId, SourceId } from '../system-health-types.ts';

const NOW = 1_745_000_000_000;

function makeRegistry(now: number = NOW) {
  let t = now;
  const reg = createFeatureHealthRegistry({ now: () => t });
  return {
    reg,
    advance(ms: number) {
      t += ms;
    },
  };
}

function ctx(args: {
  panels?: Record<PanelId, HealthStatus>;
  services?: Record<ServiceId, HealthStatus>;
  sources?: Record<SourceId, HealthStatus>;
  providers?: Record<ProviderId, HealthStatus>;
} = {}): FeatureStatusContext {
  return {
    panelStatuses: args.panels ? new Map(Object.entries(args.panels)) : undefined,
    serviceStatuses: args.services ? new Map(Object.entries(args.services)) : undefined,
    sourceStatuses: args.sources ? new Map(Object.entries(args.sources)) : undefined,
    providerStatuses: args.providers ? new Map(Object.entries(args.providers)) : undefined,
  };
}

function weatherDef(overrides: Partial<FeatureDefinition> = {}): FeatureDefinition {
  return {
    featureId: 'weather_warning',
    label: 'Weather warnings',
    critical: true,
    dependencies: {
      panels: ['nws-alerts'],
      services: ['nws-polygon-match'],
      sources: ['weather'],
      providers: ['nws-alerts'],
    },
    userImpactWhenDegraded: 'Severe weather alerts may not reach you.',
    recommendedActionWhenDegraded: 'Check Settings → Locations.',
    ...overrides,
  };
}

// ── Registration invariants ────────────────────────────────────────────

test('register: rejects definitions missing user impact', () => {
  const { reg } = makeRegistry();
  assert.throws(
    () =>
      reg.register({
        featureId: 'x',
        label: 'X',
        critical: false,
        dependencies: { panels: [], services: [], sources: [], providers: [] },
        userImpactWhenDegraded: '',
        recommendedActionWhenDegraded: 'do thing',
      }),
    /userImpactWhenDegraded is required/,
  );
});

test('register: rejects definitions missing recommended action', () => {
  const { reg } = makeRegistry();
  assert.throws(
    () =>
      reg.register({
        featureId: 'x',
        label: 'X',
        critical: false,
        dependencies: { panels: [], services: [], sources: [], providers: [] },
        userImpactWhenDegraded: 'thing',
        recommendedActionWhenDegraded: '',
      }),
    /recommendedActionWhenDegraded is required/,
  );
});

test('register: idempotent — re-registering replaces definition', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef({ label: 'Weather' }));
  reg.register(weatherDef({ label: 'Weather warnings' }));
  const defs = reg.definitions();
  assert.equal(defs.length, 1);
  assert.equal(defs[0]?.label, 'Weather warnings');
});

// ── Healthy / blind base cases ─────────────────────────────────────────

test('blind when never observed and no deps reporting', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef());
  const h = reg.get('weather_warning');
  assert.equal(h?.status, 'blind');
  assert.equal(h?.userImpact, 'Severe weather alerts may not reach you.');
  assert.equal(h?.recommendedAction, 'Check Settings → Locations.');
});

test('healthy when local success recorded and deps healthy', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef());
  reg.recordSuccess('weather_warning');
  const h = reg.get(
    'weather_warning',
    ctx({
      panels: { 'nws-alerts': 'healthy' },
      services: { 'nws-polygon-match': 'healthy' },
      sources: { weather: 'healthy' },
      providers: { 'nws-alerts': 'healthy' },
    }),
  );
  assert.equal(h?.status, 'healthy');
  assert.equal(h?.userImpact, '');
  assert.equal(h?.recommendedAction, '');
  assert.equal(h?.confidenceMultiplier, 1);
});

// ── Critical escalation ────────────────────────────────────────────────

test('critical feature with failing dep escalates to unsafe', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef());
  reg.recordSuccess('weather_warning');
  const h = reg.get(
    'weather_warning',
    ctx({ providers: { 'nws-alerts': 'failing' } }),
  );
  assert.equal(h?.status, 'unsafe');
  assert.equal(h?.userImpact, 'Severe weather alerts may not reach you.');
  assert.equal(h?.recommendedAction, 'Check Settings → Locations.');
  assert.equal(h?.confidenceMultiplier, 0);
  assert.match(h?.reason ?? '', /nws-alerts/);
});

test('critical feature with local failure → unsafe', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef());
  reg.recordSuccess('weather_warning');
  reg.recordFailure('weather_warning', 'router crashed');
  const h = reg.get('weather_warning');
  assert.equal(h?.status, 'unsafe');
  assert.equal(h?.reason, 'router crashed');
});

test('non-critical feature with failing dep → failing (not unsafe)', () => {
  const { reg } = makeRegistry();
  reg.register(
    weatherDef({
      featureId: 'flights',
      label: 'Flights',
      critical: false,
      userImpactWhenDegraded: 'Flights stale.',
      recommendedActionWhenDegraded: 'Re-auth ADS-B.',
    }),
  );
  reg.recordSuccess('flights');
  const h = reg.get(
    'flights',
    ctx({ providers: { 'nws-alerts': 'failing' } }),
  );
  assert.equal(h?.status, 'failing');
  assert.equal(h?.confidenceMultiplier, 0.2);
});

// ── Stale / degraded propagation ───────────────────────────────────────

test('stale dep propagates to feature stale', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef());
  reg.recordSuccess('weather_warning');
  const h = reg.get(
    'weather_warning',
    ctx({ providers: { 'nws-alerts': 'stale' } }),
  );
  assert.equal(h?.status, 'stale');
  assert.equal(h?.confidenceMultiplier, 0.5);
});

test('degraded dep propagates to feature degraded', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef());
  reg.recordSuccess('weather_warning');
  const h = reg.get(
    'weather_warning',
    ctx({ providers: { 'nws-alerts': 'degraded' } }),
  );
  assert.equal(h?.status, 'degraded');
  assert.equal(h?.confidenceMultiplier, 0.7);
});

// ── Local freshness ────────────────────────────────────────────────────

test('feature goes stale when local success ages past 5 minutes with no deps tripping', () => {
  const { reg, advance } = makeRegistry();
  reg.register(weatherDef());
  reg.recordSuccess('weather_warning');
  advance(5 * 60 * 1000 + 1);
  const h = reg.get(
    'weather_warning',
    ctx({
      panels: { 'nws-alerts': 'healthy' },
      services: { 'nws-polygon-match': 'healthy' },
      sources: { weather: 'healthy' },
      providers: { 'nws-alerts': 'healthy' },
    }),
  );
  assert.equal(h?.status, 'stale');
});

// ── Disabled features ──────────────────────────────────────────────────

test('disabled feature reports unknown with empty remediation', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef());
  reg.setEnabled('weather_warning', false);
  const h = reg.get(
    'weather_warning',
    ctx({ providers: { 'nws-alerts': 'failing' } }),
  );
  assert.equal(h?.status, 'unknown');
  assert.equal(h?.userImpact, '');
  assert.equal(h?.recommendedAction, '');
});

// ── Remediation override ───────────────────────────────────────────────

test('setRemediationOverride wins over the default user impact', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef());
  reg.recordFailure('weather_warning', 'NWS 500');
  reg.setRemediationOverride('weather_warning', {
    userImpact: 'Right-now warnings are blocked because the NWS feed returned 500.',
    recommendedAction: 'Wait 60 seconds and try the diagnostics retry button.',
  });
  const h = reg.get('weather_warning');
  assert.match(h?.userImpact ?? '', /returned 500/);
  assert.match(h?.recommendedAction ?? '', /retry button/);
});

// ── all / byStatus ─────────────────────────────────────────────────────

test('all returns features in registration order; byStatus filters', () => {
  const { reg } = makeRegistry();
  reg.register(weatherDef());
  reg.register(
    weatherDef({
      featureId: 'flights',
      label: 'Flights',
      critical: false,
      userImpactWhenDegraded: 'x',
      recommendedActionWhenDegraded: 'y',
    }),
  );
  reg.recordSuccess('weather_warning');
  reg.recordFailure('flights', 'opensky 502');
  const list = reg.all();
  assert.deepEqual(list.map((f) => f.featureId), ['weather_warning', 'flights']);
  const failing = reg.byStatus('failing');
  assert.deepEqual(failing.map((f) => f.featureId), ['flights']);
});

// ── Confidence multiplier defaults ─────────────────────────────────────

test('defaultConfidenceFor maps every status to a deterministic multiplier', () => {
  assert.equal(defaultConfidenceFor('healthy'), 1);
  assert.equal(defaultConfidenceFor('unknown'), 1);
  assert.equal(defaultConfidenceFor('degraded'), 0.7);
  assert.equal(defaultConfidenceFor('stale'), 0.5);
  assert.equal(defaultConfidenceFor('failing'), 0.2);
  assert.equal(defaultConfidenceFor('blind'), 0);
  assert.equal(defaultConfidenceFor('unsafe'), 0);
});

// ── defaultFeatureCatalog ──────────────────────────────────────────────

test('defaultFeatureCatalog includes weather_warning + sidecar with required strings', () => {
  const catalog = defaultFeatureCatalog();
  const ids = new Set(catalog.map((d) => d.featureId));
  assert.equal(ids.has('weather_warning'), true);
  assert.equal(ids.has('personal_storm_mode'), true);
  assert.equal(ids.has('sidecar'), true);
  for (const def of catalog) {
    assert.notEqual(def.userImpactWhenDegraded, '');
    assert.notEqual(def.recommendedActionWhenDegraded, '');
  }
});

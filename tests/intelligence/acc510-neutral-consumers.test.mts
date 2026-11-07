import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as situationTypes from '../../src/services/situation-types.ts';
import * as newsDomain from '../../src/services/situation-news-domain.ts';
import type { Situation, SituationSignalSnapshot } from '../../src/services/situation-types.ts';
import { CAUSAL_TEMPLATES, projectScenarios } from '../../src/services/situation-forecaster.ts';
import { personalizeSituation, type UserContext } from '../../src/services/situation-personalizer.ts';

function loadService(name: string, dependencies: Record<string, unknown>, globals = {}) {
  const source = readFileSync(new URL(`../../src/services/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, { exports, Date, console, ...globals, require(id: string) {
    if (id === './situation-types') return situationTypes;
    if (id === './situation-news-domain') return newsDomain;
    assert.ok(id in dependencies, `unexpected dependency ${id}`);
    return dependencies[id];
  } });
  return exports;
}

function situation(domain: Situation['domain'], id = domain): Situation {
  return {
    id, domain, title: `${id} observations`, summary: '', phase: 'active', confidence: 0.9,
    geo: { kind: 'point', basis: 'reported-event', lat: 0, lon: 0, label: 'Region', countries: ['US'], radiusKm: 50 },
    signalIds: [], signals: [], domainDiversity: domain === 'unknown' ? 0 : 1, evidence: null,
    scenarios: [], actions: [], causalChainId: null, firstSeen: Date.now(), lastUpdated: Date.now(),
    latestEventAt: Date.now(), reassessmentCount: 0,
  };
}

function signal(type: string, domain: Situation['domain']): SituationSignalSnapshot {
  return { id: type, type, domain, title: type, confidence: 0.9, timestamp: Date.now() };
}

const context: UserContext = {
  location: { lat: 0, lon: 0 }, watchlistCountries: ['US'], watchlistTopics: [], savedPlaces: [], appMode: 'default',
};

test('unknown situations project no hazard scenarios, including stale causal chains', () => {
  const sit = situation('unknown');
  assert.deepEqual(projectScenarios(sit), []);
  for (const template of CAUSAL_TEMPLATES) {
    assert.deepEqual(projectScenarios({ ...sit, causalChainId: template.id }), [], template.id);
  }
});

test('unknown or mismatched generic evidence cannot boost causal scenario coverage', () => {
  const sit = { ...situation('civil_unrest'), causalChainId: 'unrest-economic' };
  const trigger = signal('keyword_spike', 'civil_unrest');
  const baseline = projectScenarios({ ...sit, signals: [trigger, signal('unmatched', 'unknown')] });
  for (const domain of ['unknown', 'economic'] as const) {
    assert.deepEqual(projectScenarios({ ...sit, signals: [trigger, signal('velocity_spike', domain)] }), baseline);
  }
  const qualified = projectScenarios({ ...sit, signals: [trigger, signal('velocity_spike', 'civil_unrest')] });
  assert.ok(qualified.find(s => s.id.endsWith('sc0'))!.probability > baseline.find(s => s.id.endsWith('sc0'))!.probability);
});

for (const domain of ['unknown', 'economic'] as const) {
  test(`fresh ${domain} news cannot increase supported hazard scenario probability`, () => {
    const olderHazard = { ...signal('flow_drop', 'infrastructure'), timestamp: Date.now() - 8 * 60 * 60 * 1000 };
    const sit = { ...situation('natural_hazard'), causalChainId: 'natural-compound', signals: [olderHazard] };
    const baseline = projectScenarios(sit);
    const freshNews = Array.from({ length: 16 }, (_, i) => ({ ...signal('velocity_spike', domain), id: `fresh-${i}` }));
    assert.deepEqual(projectScenarios({ ...sit, signals: [olderHazard, ...freshNews] }), baseline);
    const freshTypedSignals = freshNews.map(s => ({ ...s, type: 'flow_drop', domain: 'infrastructure' as const }));
    const supported = projectScenarios({ ...sit, signals: [olderHazard, ...freshTypedSignals] });
    assert.ok(supported.find(s => s.id.endsWith('sc0'))!.probability > baseline.find(s => s.id.endsWith('sc0'))!.probability);
  });

  test(`recent ${domain} news cannot alter the supported freshness age total`, () => {
    const now = Date.now();
    const supportedHazard = { ...signal('flow_drop', 'infrastructure'), timestamp: now - 30 * 60 * 1000 };
    const sit = { ...situation('natural_hazard'), causalChainId: 'natural-compound', signals: [supportedHazard] };
    const baseline = projectScenarios(sit);
    const recentNews = Array.from({ length: 4 }, (_, i) => ({
      ...signal('velocity_spike', domain), id: `recent-${i}`, timestamp: now - 15 * 60 * 1000,
    }));
    assert.deepEqual(projectScenarios({ ...sit, signals: [supportedHazard, ...recentNews] }), baseline);
  });
}

test('unknown situations offer only neutral information despite stale scenarios and nearby exposure', () => {
  const sit = situation('unknown');
  sit.causalChainId = 'cyber-escalation';
  sit.scenarios = [{ id: 'old-scenario', label: 'Targeted attack', description: '', probability: 0.9,
    severity: 'catastrophic', horizonHours: 24, confirmationIndicators: ['Attack reported'], invalidationIndicators: [] }];
  const actions = personalizeSituation(sit, context);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.category, 'information');
  assert.equal(actions[0]?.urgency, 'monitor');
  assert.equal(actions[0]?.scenarioId, null);
  assert.match(actions[0]!.rationale, /topic.*unconfirmed/i);
  assert.doesNotMatch(JSON.stringify(actions), /hedge|evacuation|patch|attack|physical_safety/i);
  assert.deepEqual(personalizeSituation(sit, { ...context, appMode: 'ghost' }), []);
});

test('supported unrest and authoritative natural hazards retain their forecast and action behavior', () => {
  const unrest = { ...situation('civil_unrest'), causalChainId: 'unrest-economic',
    signals: [signal('keyword_spike', 'civil_unrest'), signal('velocity_spike', 'civil_unrest')] };
  assert.ok(projectScenarios(unrest).some(s => s.label === 'Prolonged instability with capital flight'));
  assert.ok(personalizeSituation(unrest, context).some(a => a.category === 'physical_safety'));
  assert.ok(projectScenarios(situation('natural_hazard')).some(s => s.severity === 'severe'));
  const hazard = { ...situation('natural_hazard'), causalChainId: 'natural-compound' };
  const unsupported = projectScenarios({ ...hazard, signals: [signal('flow_drop', 'unknown')] });
  const typed = projectScenarios({ ...hazard, signals: [signal('flow_drop', 'infrastructure')] });
  assert.ok(typed.find(s => s.id.endsWith('sc0'))!.probability > unsupported.find(s => s.id.endsWith('sc0'))!.probability);
});

function synthesis(situations: Situation[]) {
  const hazards: unknown[] = [];
  const service = loadService('threat-synthesis', {
    './situation-engine': { situationEngine: { getSituations: () => situations } },
    './compound-threat': { detectCompoundThreats: (signals: unknown[]) => { hazards.push(...signals); return []; } },
    './situation-forecaster': { CAUSAL_TEMPLATES },
    './claude-agent': { runClaudeAgent: () => { throw new Error('AI disabled'); } },
    './runtime-config': { isFeatureAvailable: () => false },
  });
  return { service, hazards };
}

test('unknown situations cannot form, join, or bridge cross-domain synthesis clusters', async () => {
  const unknown = situation('unknown');
  const cyber = situation('cyber');
  const military = { ...situation('military'), geo: { ...cyber.geo, countries: ['CA'] } };
  unknown.geo.countries = ['US', 'CA'];
  const pair = synthesis([unknown, cyber]);
  assert.equal((await pair.service.synthesizeThreats()).clusters.length, 0);
  assert.equal(pair.hazards.length, 1);
  assert.equal((await synthesis([unknown, cyber, military]).service.synthesizeThreats()).clusters.length, 0);
  military.geo.countries = ['US'];
  const report = await synthesis([unknown, cyber, military]).service.synthesizeThreats();
  assert.equal(report.clusters.length, 1);
  assert.deepEqual(Array.from(report.clusters[0].situationIds), ['cyber', 'military']);
  assert.equal(report.clusters[0].signalsByDomain['Topic unconfirmed'], undefined);
  assert.equal(report.clusters[0].domains.includes('unknown'), false);
});

test('unknown evidence inside supported situations cannot match synthesis causal templates', async () => {
  const cyber = situation('cyber');
  cyber.signals = [signal('keyword_spike', 'unknown'), signal('convergence', 'unknown'), signal('velocity_spike', 'unknown')];
  const report = await synthesis([cyber, situation('economic')]).service.synthesizeThreats();
  assert.equal(report.clusters.length, 1);
  assert.equal(report.clusters[0].matchedTemplate, null);
  assert.doesNotMatch(JSON.stringify(report.recommendedActions), /patches|exposure|travel/);
});

test('supported generic evidence matches only the corresponding synthesis template domain', async () => {
  const economic = situation('economic');
  economic.signals = [signal('keyword_spike', 'economic'), signal('convergence', 'economic'), signal('velocity_spike', 'economic')];
  const report = await synthesis([economic, situation('health')]).service.synthesizeThreats();
  assert.equal(report.clusters[0].matchedTemplate, null);
  const unrest = situation('civil_unrest');
  unrest.signals = [signal('keyword_spike', 'civil_unrest'), signal('convergence', 'civil_unrest'), signal('velocity_spike', 'civil_unrest')];
  const supported = await synthesis([unrest, situation('economic')]).service.synthesizeThreats();
  assert.equal(supported.clusters[0].matchedTemplate, 'unrest-economic');
});

test('unknown situations add no mode pressure or advisories; supported unrest still adds security pressure', () => {
  let situations = [situation('unknown'), situation('unknown', 'second'), situation('unknown', 'third')];
  const service = loadService('mode-forecast', {
    './situation-engine': { situationEngine: { getSituations: () => situations } },
    './anomaly-detection': { anomalyEngine: { getActiveAnomalies: () => [] } },
    './pressure-baselines': { isAboveNormal: () => false, deviationSigma: () => 0, getBaseline: () => ({ sufficient: false }) },
    './reasoning-debug': { logDebug: () => {} },
    './reasoning-metrics': { recordLatency: () => {}, incrementCounter: () => {} },
    '../utils/format-duration': { formatDurationMinutes: () => '' },
  }, { performance: { now: () => 0 }, document: { dispatchEvent: () => {} }, CustomEvent: class {} });
  for (let i = 0; i < 10; i++) {
    const snapshot = service.runForecastCycle();
    assert.deepEqual(Object.values(snapshot.pressure), [0, 0, 0, 0]);
    assert.equal(snapshot.advisories.length, 0);
  }
  situations = [situation('civil_unrest')];
  assert.ok(service.runForecastCycle().pressure.security > 0);
});

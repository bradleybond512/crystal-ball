import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import '../../../tests/panels/register-hook.mjs';
import '../../../tests/panels/setup-dom.mts';
import type { AggregatedThreats, ThreatDomain } from '../../services/synthesis/threat-aggregator.ts';

const { ThreatDashboard } = await import('../ThreatDashboard.ts');
const { emptyAggregatedThreats, THREAT_LEVELS_EVENT, ThreatEvidenceStore } = await import('../../services/synthesis/threat-aggregator.ts');

function mount(t: import('node:test').TestContext) {
  const panel = new ThreatDashboard();
  document.body.append(panel.getElement());
  t.after(() => { panel.destroy(); panel.getElement().remove(); });
  return panel.getContentElement();
}

const rendered = () => new Promise((resolve) => setTimeout(resolve, 200));

function publish(threats: AggregatedThreats) {
  document.dispatchEvent(new CustomEvent(THREAT_LEVELS_EVENT, { detail: { threats, generatedAt: Date.now() } }));
}

function quiet() {
  const threats = emptyAggregatedThreats();
  for (const row of Object.values(threats)) {
    row.coverage = 'complete';
    row.lastUpdatedMs = Date.now() - (row.domain === 'seismic' ? 9 : 1) * 60_000;
    row.sources = [{ source: 'Fixture network', state: 'current', evidenceAtMs: row.lastUpdatedMs, ageKind: 'observed', reporting: true, lastAttempt: 'reported', attemptedAtMs: row.lastUpdatedMs }];
  }
  return threats;
}

function card(root: HTMLElement, domain: ThreatDomain) {
  const result = root.querySelector<HTMLElement>(`[data-domain="${domain}"]`);
  assert.ok(result, `missing ${domain} card`);
  return result;
}

test('startup exposes all eleven unknown rows with zero reporting', async (t) => {
  const root = mount(t);
  await rendered();
  assert.equal(root.querySelector('details') !== null, false);
  assert.equal(root.querySelectorAll('[data-domain]').length, 11);
  assert.equal(root.closest('[data-panel]')?.querySelector('.panel-heartbeat') !== null, false);
  assert.match(root.textContent, /0 of 11 domains reporting/i);
  assert.match(card(root, 'weather').textContent, /no observations/i);
  assert.doesNotMatch(root.textContent, /all sensors quiet|just now|\bNONE\b/i);
});

test('only eleven complete quiet domains can collapse, with the oldest evidence age', async (t) => {
  const root = mount(t);
  publish(quiet());
  await rendered();
  const summary = root.querySelector('details > summary')?.textContent ?? '';
  assert.match(summary, /all sensors quiet/i);
  assert.match(summary, /oldest evidence 9m ago/i);
  assert.match(summary, /11 of 11 domains reporting/i);
  assert.match(card(root, 'seismic').textContent, /quiet/i);
});

test('one failed domain breaks reassurance despite ten complete, quiet domains', async (t) => {
  const root = mount(t);
  const threats = quiet();
  publish(threats);
  await rendered();
  assert.match(root.querySelector('summary')?.textContent ?? '', /all sensors quiet/i);
  threats.weather.coverage = 'unavailable';
  threats.weather.sources = [{ source: 'Weather fixture', state: 'unavailable', evidenceAtMs: null, ageKind: null, reporting: false, lastAttempt: 'failed', attemptedAtMs: Date.now() }];
  publish(threats);
  await rendered();
  assert.equal(root.querySelector('details') !== null, false);
  assert.match(root.textContent, /10 of 11 domains reporting/i);
  assert.match(card(root, 'weather').textContent, /Weather fixture.*unavailable/is);
});

test('current partial hazard shows its source and acquisition age alongside the failed leg', async (t) => {
  const root = mount(t);
  const threats = emptyAggregatedThreats();
  threats.aviation = { ...threats.aviation,
    coverage: 'partial', level: 'HIGH', topAlert: 'Ground stop at EWR', signalSource: 'FAA', lastKnown: false,
    sources: [
      { source: 'FAA', state: 'degraded', reporting: true, ageKind: 'fetched', evidenceAtMs: Date.now() - 5 * 60_000, lastAttempt: 'reported', attemptedAtMs: Date.now() },
      { source: 'SIGMET', state: 'unavailable', reporting: false, ageKind: null, evidenceAtMs: null, lastAttempt: 'failed', attemptedAtMs: Date.now() },
    ],
  };
  publish(threats);
  await rendered();
  assert.match(root.textContent, /1 of 11 domains reporting/i);
  assert.match(root.textContent, /1 partial/i);
  const aviation = card(root, 'aviation');
  for (const text of [/partial/i, /ground stop at EWR/i, /FAA.*fetched 5m ago/is, /SIGMET.*unavailable/is]) {
    assert.match(aviation.textContent, text);
  }
  assert.doesNotMatch(aviation.textContent, /last known/i);
  const count = root.closest('[data-panel]')!.querySelector('.panel-count')!;
  assert.equal(count.textContent, '1');
  aviation.focus();
  threats.aviation.lastKnown = true;
  threats.aviation.sources[0]!.reporting = false;
  threats.aviation.sources[0]!.state = 'degraded';
  threats.aviation.sources[0]!.lastAttempt = 'failed';
  threats.aviation.coverage = 'unavailable';
  publish(threats);
  await rendered();
  assert.match(root.textContent, /0 of 11 domains reporting/i);
  assert.match(card(root, 'aviation').textContent, /last known/i);
  assert.equal(document.activeElement?.getAttribute('data-domain'), 'aviation');
  assert.equal(count.textContent, '0', 'a retained hazard is not counted as currently confirmed');
  assert.equal(card(root, 'aviation').classList.contains('pulse-high'), false);
});

test('a current SIGMET and a last-known ground stop remain distinct on the same card', async (t) => {
  const root = mount(t);
  const now = Date.now();
  const store = new ThreatEvidenceStore(() => now);
  for (const [source, level, topAlert] of [['FAA', 'HIGH', 'Ground stop at EWR'], ['SIGMET', 'ELEVATED', 'Ash advisory']] as const) {
    store.begin('aviation', source).report({
      evidenceAtMs: now - 120_000, expiresAtMs: now + 60_000, ageKind: 'fetched', scope: 'partial',
      evaluate: () => ({ domain: 'aviation', level, topAlert, lastUpdatedMs: now - 120_000 }),
    });
  }
  store.begin('aviation', 'FAA').fail();
  publish(store.sample());
  await rendered();
  const aviation = card(root, 'aviation');
  assert.match(aviation.textContent, /ELEVATED.*SIGMET.*Ash advisory/is);
  assert.match(aviation.textContent, /FAA.*last known.*HIGH.*Ground stop at EWR/is);
  assert.equal(aviation.textContent.split('Ash advisory').length - 1, 1);
  assert.equal(root.closest('[data-panel]')?.querySelector('.panel-count')?.textContent, '1');
});

test('a stale receipt retains its actual observation age without a quiet badge', async (t) => {
  const root = mount(t);
  const threats = emptyAggregatedThreats();
  threats.space_weather = { ...threats.space_weather, coverage: 'stale', sources: [
    { source: 'Kp', state: 'stale', reporting: false, evidenceAtMs: Date.now() - 4 * 3600_000, ageKind: 'observed', lastAttempt: 'failed', attemptedAtMs: Date.now() },
  ] };
  publish(threats);
  await rendered();
  const row = card(root, 'space_weather');
  assert.match(row.textContent, /stale/i);
  assert.match(row.textContent, /Kp.*observed 4h ago.*stale.*refresh failed/is);
  assert.doesNotMatch(row.textContent, /\bNONE\b|quiet/i);
});

test('limited Kp and AIS evidence names its scope and keeps source text inert', async (t) => {
  const root = mount(t);
  const threats = emptyAggregatedThreats();
  for (const [domain, ageKind] of [['space_weather', 'observed'], ['maritime', 'received']] as const) {
    threats[domain] = { ...threats[domain], coverage: 'partial', sources: [{
      source: '<img src=x onerror=alert(1)>', reporting: true, state: 'current',
      evidenceAtMs: Date.now() - 2 * 60_000, ageKind, lastAttempt: 'reported', attemptedAtMs: Date.now(),
    }] };
  }
  publish(threats);
  await rendered();
  const kp = card(root, 'space_weather');
  assert.match(kp.textContent, /Kp readings only.*flare coverage unavailable/is);
  assert.equal(kp.querySelector('img') !== null, false);
  const maritime = card(root, 'maritime');
  assert.match(maritime.textContent, /sample in four risk zones/i);
  assert.match(maritime.textContent, /received 2m ago/i);
});

test('keyboard navigation survives evidence updates', async (t) => {
  const root = mount(t);
  await rendered();
  const target = document.createElement('div');
  target.dataset.panel = 'aviation-intel';
  document.body.append(target);
  t.after(() => target.remove());
  let jumps = 0;
  target.scrollIntoView = () => { jumps++; };
  const row = card(root, 'aviation');
  assert.equal(row.tabIndex, 0);
  row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(jumps, 1);
  publish(quiet());
  await rendered();
  const disclosure = root.querySelector<HTMLDetailsElement>('details')!;
  disclosure.open = true;
  disclosure.dispatchEvent(new Event('toggle'));
  const threats = quiet();
  threats.seismic.lastUpdatedMs -= 3 * 60_000;
  publish(threats);
  await rendered();
  assert.equal(root.querySelector('details')!.open, true);
  card(root, 'aviation').dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(jumps, 2);
});

test('destroy stops the dashboard tick and remount creates just one producer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(window, 'setInterval', setInterval);
  let updates = 0;
  const onUpdate = () => { updates++; };
  document.addEventListener(THREAT_LEVELS_EVENT, onUpdate);
  t.after(() => document.removeEventListener(THREAT_LEVELS_EVENT, onUpdate));
  const first = new ThreatDashboard();
  await Promise.resolve();
  first.destroy();
  const second = new ThreatDashboard();
  try {
    await Promise.resolve();
    const before = updates;
    t.mock.timers.tick(30_000);
    await Promise.resolve();
    assert.equal(updates - before, 1, 'only the live dashboard emits');
  } finally {
    second.destroy();
  }
  const before = updates;
  t.mock.timers.tick(30_000);
  await Promise.resolve();
  assert.equal(updates, before);
});


test('panel layout leaves the threat poller lifetime exclusively to the dashboard', () => {
  const layout = readFileSync(new URL('../../app/panel-layout.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(layout, /\bstartThreatAggregator\b/, 'layout must not create an unowned second threat producer');
  assert.match(layout, /this\.ctx\.panels\['threat-dashboard'\] = new ThreatDashboard\(\)/);
});

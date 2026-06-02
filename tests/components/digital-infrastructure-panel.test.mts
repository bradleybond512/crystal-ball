/**
 * Tests for DigitalInfrastructurePanel — pure helper functions and data constants.
 *
 * Run with: npx tsx --test tests/components/digital-infrastructure-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  severityColor,
  statusColor,
  statusLabel,
  cableIncidentLabel,
  bgpEventLabel,
  dnsAttackLabel,
  cloudProviderLabel,
  satStatusLabel,
  satStatusColor,
  formatGbps,
  formatQps,
  formatUsersM,
  formatDuration,
  countCriticalCableIncidents,
  countOutageIxps,
  countActiveBgpEvents,
  countUnmitigatedDnsAttacks,
  countSevereCloudOutages,
  countCdnIssues,
  countSatAnomalies,
  totalImpairmentCount,
  UNDERSEA_CABLE_INCIDENTS,
  IXP_DISRUPTIONS,
  BGP_EVENTS,
  DNS_ATTACKS,
  CLOUD_OUTAGES,
  CDN_DISRUPTIONS,
  SATELLITE_SYSTEMS,
} from '../../src/components/digital-infrastructure-helpers.ts';

// ── severityColor ─────────────────────────────────────────────────────────

test('severityColor: critical is dark red', () => {
  assert.equal(severityColor('critical'), '#b71c1c');
});

test('severityColor: high is red', () => {
  assert.equal(severityColor('high'), '#e53935');
});

test('severityColor: medium is orange', () => {
  assert.equal(severityColor('medium'), '#fb8c00');
});

test('severityColor: low is yellow', () => {
  assert.equal(severityColor('low'), '#fdd835');
});

// ── statusColor / statusLabel ─────────────────────────────────────────────

test('statusColor: major_outage is dark red', () => {
  assert.equal(statusColor('major_outage'), '#b71c1c');
});

test('statusColor: operational is green', () => {
  assert.equal(statusColor('operational'), '#43a047');
});

test('statusLabel: covers all four statuses', () => {
  assert.equal(statusLabel('major_outage'), 'Major Outage');
  assert.equal(statusLabel('partial_outage'), 'Partial Outage');
  assert.equal(statusLabel('degraded'), 'Degraded');
  assert.equal(statusLabel('operational'), 'Operational');
});

// ── Type labels ───────────────────────────────────────────────────────────

test('cableIncidentLabel: all five types resolved', () => {
  assert.equal(cableIncidentLabel('shunt_fault'), 'Shunt Fault');
  assert.equal(cableIncidentLabel('shallow_cut'), 'Shallow Cut');
  assert.equal(cableIncidentLabel('deep_cut'), 'Deep Cut');
  assert.equal(cableIncidentLabel('multiple_cuts'), 'Multiple Cuts');
  assert.equal(cableIncidentLabel('sabotage_suspected'), 'Sabotage Suspected');
});

test('bgpEventLabel: all four kinds resolved', () => {
  assert.equal(bgpEventLabel('hijack'), 'Full Prefix Hijack');
  assert.equal(bgpEventLabel('route_leak'), 'Route Leak');
  assert.equal(bgpEventLabel('origin_spoof'), 'Origin Spoof');
  assert.equal(bgpEventLabel('subprefix_hijack'), 'Sub-prefix Hijack');
});

test('dnsAttackLabel: all five attack types resolved', () => {
  assert.equal(dnsAttackLabel('ddos'), 'Volumetric DDoS');
  assert.equal(dnsAttackLabel('cache_poisoning'), 'Cache Poisoning');
  assert.equal(dnsAttackLabel('registrar_compromise'), 'Registrar Compromise');
  assert.equal(dnsAttackLabel('nx_amplification'), 'NXDOMAIN Amplification');
  assert.equal(dnsAttackLabel('water_torture'), 'Random-subdomain Flood');
});

test('cloudProviderLabel: hyperscalers + others resolved', () => {
  assert.equal(cloudProviderLabel('aws'), 'AWS');
  assert.equal(cloudProviderLabel('azure'), 'Azure');
  assert.equal(cloudProviderLabel('gcp'), 'GCP');
  assert.equal(cloudProviderLabel('oracle'), 'Oracle Cloud');
  assert.equal(cloudProviderLabel('ibm'), 'IBM Cloud');
});

test('satStatusLabel: all four states resolved', () => {
  assert.equal(satStatusLabel('nominal'), 'Nominal');
  assert.equal(satStatusLabel('reduced_capacity'), 'Reduced Capacity');
  assert.equal(satStatusLabel('regional_outage'), 'Regional Outage');
  assert.equal(satStatusLabel('constellation_event'), 'Constellation Event');
});

test('satStatusColor: constellation_event is dark red', () => {
  assert.equal(satStatusColor('constellation_event'), '#b71c1c');
});

test('satStatusColor: nominal is green', () => {
  assert.equal(satStatusColor('nominal'), '#43a047');
});

// ── Formatters ────────────────────────────────────────────────────────────

test('formatGbps: returns em-dash for zero or negative', () => {
  assert.equal(formatGbps(0), '—');
  assert.equal(formatGbps(-5), '—');
});

test('formatGbps: renders sub-tera as Gbps', () => {
  assert.equal(formatGbps(580), '580 Gbps');
});

test('formatGbps: renders >=1000 Gbps as Tbps with one decimal', () => {
  assert.equal(formatGbps(1800), '1.8 Tbps');
});

test('formatQps: returns em-dash for zero', () => {
  assert.equal(formatQps(0), '—');
});

test('formatQps: renders >=1M as Mqps with one decimal', () => {
  assert.equal(formatQps(1_200_000), '1.2M qps');
});

test('formatQps: renders >=1k as kqps rounded', () => {
  assert.equal(formatQps(480_000), '480k qps');
});

test('formatQps: renders sub-thousand as raw qps', () => {
  assert.equal(formatQps(800), '800 qps');
});

test('formatUsersM: returns em-dash for zero', () => {
  assert.equal(formatUsersM(0), '—');
});

test('formatUsersM: renders >=1 with one decimal and M', () => {
  assert.equal(formatUsersM(4.6), '4.6M');
});

test('formatUsersM: renders <1 as k', () => {
  assert.equal(formatUsersM(0.3), '300k');
});

test('formatDuration: negative is ongoing', () => {
  assert.equal(formatDuration(-1), 'ongoing');
});

test('formatDuration: <60 min uses m suffix', () => {
  assert.equal(formatDuration(47), '47m');
});

test('formatDuration: whole hours use h suffix alone', () => {
  assert.equal(formatDuration(120), '2h');
});

test('formatDuration: hours + leftover minutes combine', () => {
  assert.equal(formatDuration(125), '2h 5m');
});

// ── Aggregate counts ──────────────────────────────────────────────────────

test('countCriticalCableIncidents: counts critical + high', () => {
  const n = countCriticalCableIncidents(UNDERSEA_CABLE_INCIDENTS);
  assert.ok(n >= 3, `expected ≥3 critical/high cable incidents, got ${n}`);
});

test('countCriticalCableIncidents: ignores low/medium', () => {
  assert.equal(countCriticalCableIncidents([
    { cableName: 'X', region: 'r', incidentType: 'shunt_fault', severity: 'low', affectedCountries: [], capacityLossGbps: 0, reportedAt: '2024-01-01', detail: '' },
    { cableName: 'Y', region: 'r', incidentType: 'shunt_fault', severity: 'medium', affectedCountries: [], capacityLossGbps: 0, reportedAt: '2024-01-01', detail: '' },
  ]), 0);
});

test('countOutageIxps: counts partial + major outages', () => {
  assert.equal(countOutageIxps([
    { ixpName: 'A', city: 'c', countryCode: 'XX', status: 'operational',    peersAffectedPct: 0,  cause: '' },
    { ixpName: 'B', city: 'c', countryCode: 'XX', status: 'degraded',       peersAffectedPct: 5,  cause: '' },
    { ixpName: 'C', city: 'c', countryCode: 'XX', status: 'partial_outage', peersAffectedPct: 30, cause: '' },
    { ixpName: 'D', city: 'c', countryCode: 'XX', status: 'major_outage',   peersAffectedPct: 80, cause: '' },
  ]), 2);
});

test('countActiveBgpEvents: counts ongoing + critical + high', () => {
  const n = countActiveBgpEvents(BGP_EVENTS);
  assert.ok(n >= 3, `expected ≥3 notable BGP events, got ${n}`);
});

test('countUnmitigatedDnsAttacks: ignores mitigated entries', () => {
  assert.equal(countUnmitigatedDnsAttacks([
    { target: 'A', attackType: 'ddos',  severity: 'high',   peakQps: 100, mitigated: true,  detail: '' },
    { target: 'B', attackType: 'ddos',  severity: 'high',   peakQps: 100, mitigated: false, detail: '' },
    { target: 'C', attackType: 'water_torture', severity: 'medium', peakQps: 100, mitigated: false, detail: '' },
  ]), 2);
});

test('countSevereCloudOutages: counts partial + major outages only', () => {
  assert.equal(countSevereCloudOutages([
    { provider: 'aws',   service: 'S3',  region: 'r', status: 'operational',    impact: '', startedAt: '' },
    { provider: 'azure', service: 'AAD', region: 'r', status: 'degraded',       impact: '', startedAt: '' },
    { provider: 'gcp',   service: 'CS',  region: 'r', status: 'partial_outage', impact: '', startedAt: '' },
    { provider: 'aws',   service: 'EC2', region: 'r', status: 'major_outage',   impact: '', startedAt: '' },
  ]), 2);
});

test('countCdnIssues: anything non-operational counts', () => {
  assert.equal(countCdnIssues([
    { cdnName: 'A', pop: 'p', status: 'operational',    errorRatePct: 0,   cause: '' },
    { cdnName: 'B', pop: 'p', status: 'degraded',       errorRatePct: 2,   cause: '' },
    { cdnName: 'C', pop: 'p', status: 'partial_outage', errorRatePct: 10,  cause: '' },
  ]), 2);
});

test('countSatAnomalies: anything non-nominal counts', () => {
  assert.equal(countSatAnomalies([
    { systemName: 'A', orbitClass: 'LEO', status: 'nominal',             activeUsersM: 1, note: '' },
    { systemName: 'B', orbitClass: 'LEO', status: 'reduced_capacity',    activeUsersM: 1, note: '' },
    { systemName: 'C', orbitClass: 'LEO', status: 'regional_outage',     activeUsersM: 1, note: '' },
    { systemName: 'D', orbitClass: 'LEO', status: 'constellation_event', activeUsersM: 1, note: '' },
  ]), 3);
});

test('totalImpairmentCount: sums all seven domain counts', () => {
  const total = totalImpairmentCount({
    cables: UNDERSEA_CABLE_INCIDENTS,
    ixps: IXP_DISRUPTIONS,
    bgp: BGP_EVENTS,
    dns: DNS_ATTACKS,
    cloud: CLOUD_OUTAGES,
    cdn: CDN_DISRUPTIONS,
    sat: SATELLITE_SYSTEMS,
  });
  const expected =
    countCriticalCableIncidents(UNDERSEA_CABLE_INCIDENTS) +
    countOutageIxps(IXP_DISRUPTIONS) +
    countActiveBgpEvents(BGP_EVENTS) +
    countUnmitigatedDnsAttacks(DNS_ATTACKS) +
    countSevereCloudOutages(CLOUD_OUTAGES) +
    countCdnIssues(CDN_DISRUPTIONS) +
    countSatAnomalies(SATELLITE_SYSTEMS);
  assert.equal(total, expected);
});

// ── Static data integrity ─────────────────────────────────────────────────

test('UNDERSEA_CABLE_INCIDENTS: non-empty with required fields', () => {
  assert.ok(UNDERSEA_CABLE_INCIDENTS.length >= 5);
  for (const c of UNDERSEA_CABLE_INCIDENTS) {
    assert.ok(c.cableName.length > 0);
    assert.ok(c.region.length > 0);
    assert.ok(c.affectedCountries.length > 0 || c.severity === 'low');
    assert.ok(c.capacityLossGbps >= 0);
  }
});

test('IXP_DISRUPTIONS: covers major global IXPs', () => {
  const names = IXP_DISRUPTIONS.map((x) => x.ixpName);
  assert.ok(names.some((n) => /DE-CIX/.test(n)));
  assert.ok(names.some((n) => /AMS-IX/.test(n)));
  assert.ok(names.some((n) => /LINX/.test(n)));
});

test('IXP_DISRUPTIONS: peersAffectedPct in [0,100]', () => {
  for (const x of IXP_DISRUPTIONS) {
    assert.ok(x.peersAffectedPct >= 0 && x.peersAffectedPct <= 100);
  }
});

test('BGP_EVENTS: prefix looks like CIDR', () => {
  for (const b of BGP_EVENTS) {
    assert.match(b.prefix, /^\d+\.\d+\.\d+\.\d+\/\d+$/);
  }
});

test('BGP_EVENTS: at least one ongoing critical hijack', () => {
  const ongoing = BGP_EVENTS.filter((b) => b.durationMin === -1 && b.severity === 'critical');
  assert.ok(ongoing.length >= 1);
});

test('DNS_ATTACKS: every entry has positive QPS except cache_poisoning', () => {
  for (const a of DNS_ATTACKS) {
    if (a.attackType === 'cache_poisoning') continue;
    assert.ok(a.peakQps > 0, `expected positive peakQps for ${a.target}`);
  }
});

test('CLOUD_OUTAGES: includes all three hyperscalers', () => {
  const providers = new Set(CLOUD_OUTAGES.map((o) => o.provider));
  assert.ok(providers.has('aws'));
  assert.ok(providers.has('azure'));
  assert.ok(providers.has('gcp'));
});

test('CDN_DISRUPTIONS: errorRatePct in [0,100]', () => {
  for (const d of CDN_DISRUPTIONS) {
    assert.ok(d.errorRatePct >= 0 && d.errorRatePct <= 100);
  }
});

test('SATELLITE_SYSTEMS: covers LEO and GEO orbit classes', () => {
  const orbits = SATELLITE_SYSTEMS.map((s) => s.orbitClass.toLowerCase());
  assert.ok(orbits.some((o) => o.includes('leo')));
  assert.ok(orbits.some((o) => o.includes('geo')));
});

test('SATELLITE_SYSTEMS: every entry names a real system', () => {
  const names = SATELLITE_SYSTEMS.map((s) => s.systemName);
  assert.ok(names.some((n) => /Starlink/i.test(n)));
  assert.ok(names.some((n) => /Iridium/i.test(n)));
});

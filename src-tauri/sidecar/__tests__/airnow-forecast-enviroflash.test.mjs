import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  normalizeForecastRow,
  normalizeAirnowForecast,
  peakForecastAqi,
} from '../airnow-forecast.mjs';
import {
  capTagText,
  parseCapAlert,
  parseEnviroflashCap,
  alertMatchesArea,
} from '../enviroflash-cap.mjs';

// ── AirNow forecast fixture (representative aq/forecast JSON) ──────────────
const AIRNOW_FORECAST = [
  { DateIssue: '2026-07-19', DateForecast: '2026-07-19', ReportingArea: 'Northwest Indiana', StateCode: 'IN', ParameterName: 'PM2.5', AQI: 151, Category: { Number: 3, Name: 'Unhealthy for Sensitive Groups' }, ActionDay: true, Discussion: 'Wildfire smoke aloft.' },
  { DateForecast: '2026-07-19', ReportingArea: 'Northwest Indiana', StateCode: 'IN', ParameterName: 'O3', AQI: -1, Category: { Number: -1, Name: '' }, ActionDay: false, Discussion: '' },
  { DateForecast: '2026-07-20', ReportingArea: 'Northwest Indiana', StateCode: 'IN', ParameterName: 'PM2.5', AQI: 95, Category: { Number: 2, Name: 'Moderate' }, ActionDay: false, Discussion: '' },
];

test('normalizeAirnowForecast: maps rows, surfaces ActionDay + reportingArea + discussion', () => {
  const n = normalizeAirnowForecast(AIRNOW_FORECAST);
  assert.equal(n.forecasts.length, 3);
  assert.equal(n.actionDay, true);
  assert.equal(n.reportingArea, 'Northwest Indiana');
  assert.equal(n.discussion, 'Wildfire smoke aloft.');
  assert.equal(n.forecasts[0].aqi, 151);
  assert.equal(n.forecasts[0].categoryName, 'Unhealthy for Sensitive Groups');
});

test('normalizeForecastRow: AirNow AQI=-1 becomes null (not forecast)', () => {
  const row = normalizeForecastRow(AIRNOW_FORECAST[1]);
  assert.equal(row.aqi, null);
  assert.equal(row.categoryNumber, null);
  assert.equal(row.parameter, 'O3');
});

test('normalizeForecastRow: rejects non-object / empty rows', () => {
  assert.equal(normalizeForecastRow(null), null);
  assert.equal(normalizeForecastRow(42), null);
  assert.equal(normalizeForecastRow({ AQI: -1 }), null);
});

test('normalizeAirnowForecast: actionDay false when no row declares it', () => {
  const n = normalizeAirnowForecast([{ DateForecast: '2026-07-20', ParameterName: 'PM2.5', AQI: 40, Category: { Number: 1, Name: 'Good' }, ActionDay: false }]);
  assert.equal(n.actionDay, false);
});

test('normalizeAirnowForecast: non-array input yields empty forecasts', () => {
  assert.deepEqual(normalizeAirnowForecast(null).forecasts, []);
  assert.deepEqual(normalizeAirnowForecast({ oops: true }).forecasts, []);
  assert.equal(normalizeAirnowForecast('x').actionDay, false);
});

test('peakForecastAqi: worst AQI across rows, ignoring nulls', () => {
  const n = normalizeAirnowForecast(AIRNOW_FORECAST);
  assert.equal(peakForecastAqi(n.forecasts), 151);
  assert.equal(peakForecastAqi([{ aqi: null }, { aqi: null }]), null);
});

// ── EnviroFlash CAP fixture (CAP 1.2 aggregate) ───────────────────────────
const CAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<alerts>
  <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>EF-2026-IN-001</identifier>
    <sender>enviroflash@epa.gov</sender>
    <sent>2026-07-19T06:00:00-05:00</sent>
    <status>Actual</status><msgType>Alert</msgType><scope>Public</scope>
    <info>
      <category>Health</category>
      <event>Air Quality Action Day</event>
      <urgency>Expected</urgency><severity>Moderate</severity><certainty>Likely</certainty>
      <effective>2026-07-19T06:00:00-05:00</effective>
      <expires>2026-07-20T06:00:00-05:00</expires>
      <senderName>Indiana DEM</senderName>
      <headline>Air Quality Action Day for Northwest Indiana</headline>
      <description>Fine particles expected to reach Unhealthy for Sensitive Groups.</description>
      <parameter><valueName>AQI</valueName><value>151</value></parameter>
      <parameter><valueName>ActionDay</valueName><value>Yes</value></parameter>
      <area>
        <areaDesc>Northwest Indiana</areaDesc>
        <geocode><valueName>FIPS</valueName><value>18089</value></geocode>
      </area>
    </info>
  </alert>
  <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>EF-2026-CA-002</identifier>
    <sent>2026-07-19T05:00:00-07:00</sent>
    <info>
      <event>Air Quality Alert</event>
      <severity>Severe</severity>
      <headline>Air Quality Alert for Central California</headline>
      <parameter><valueName>AQI</valueName><value>180</value></parameter>
      <area>
        <areaDesc>Central California</areaDesc>
        <geocode><valueName>AirNowReportingArea</valueName><value>Fresno</value></geocode>
      </area>
    </info>
  </alert>
</alerts>`;

test('parseEnviroflashCap: parses both alerts', () => {
  const alerts = parseEnviroflashCap(CAP_XML);
  assert.equal(alerts.length, 2);
});

test('parseCapAlert: extracts headline, severity, area, AQI, geocodes', () => {
  const alerts = parseEnviroflashCap(CAP_XML);
  const indiana = alerts.find((a) => a.id === 'EF-2026-IN-001');
  assert.equal(indiana.headline, 'Air Quality Action Day for Northwest Indiana');
  assert.equal(indiana.severity, 'Moderate');
  assert.equal(indiana.areaDesc, 'Northwest Indiana');
  assert.equal(indiana.aqi, 151);
  assert.deepEqual(indiana.geocodes, ['18089']);
  assert.equal(indiana.senderName, 'Indiana DEM');
});

test('parseCapAlert: detects Action Day from event text AND ActionDay parameter', () => {
  const indiana = parseEnviroflashCap(CAP_XML).find((a) => a.id === 'EF-2026-IN-001');
  assert.equal(indiana.actionDay, true);
});

test('parseCapAlert: a plain Air Quality Alert is not an action day', () => {
  const ca = parseEnviroflashCap(CAP_XML).find((a) => a.id === 'EF-2026-CA-002');
  assert.equal(ca.actionDay, false);
  assert.equal(ca.aqi, 180);
  assert.deepEqual(ca.geocodes, ['Fresno']);
});

test('parseCapAlert: severity defaults to Unknown when absent', () => {
  const xml = '<alert><identifier>X</identifier><info><event>Air Quality Alert</event><headline>h</headline></info></alert>';
  const a = parseCapAlert(xml);
  assert.equal(a.severity, 'Unknown');
});

test('parseEnviroflashCap: dedupes by identifier', () => {
  const dup = CAP_XML.replace('EF-2026-CA-002', 'EF-2026-IN-001');
  const alerts = parseEnviroflashCap(dup);
  assert.equal(alerts.length, 1);
});

test('parseEnviroflashCap: empty / non-CAP input yields []', () => {
  assert.deepEqual(parseEnviroflashCap(''), []);
  assert.deepEqual(parseEnviroflashCap('<html>not cap</html>'), []);
});

test('capTagText: CDATA-aware extraction', () => {
  assert.equal(capTagText('<headline><![CDATA[Smoke & haze]]></headline>', 'headline'), 'Smoke & haze');
  assert.equal(capTagText('<severity>Severe</severity>', 'severity'), 'Severe');
});

test('alertMatchesArea: substring match on areaDesc (case-insensitive)', () => {
  const indiana = parseEnviroflashCap(CAP_XML).find((a) => a.id === 'EF-2026-IN-001');
  assert.equal(alertMatchesArea(indiana, 'indiana'), true);
  assert.equal(alertMatchesArea(indiana, 'INDIANA'), true);
  assert.equal(alertMatchesArea(indiana, 'california'), false);
});

test('alertMatchesArea: exact geocode match + empty area matches all', () => {
  const ca = parseEnviroflashCap(CAP_XML).find((a) => a.id === 'EF-2026-CA-002');
  assert.equal(alertMatchesArea(ca, 'Fresno'), true);
  assert.equal(alertMatchesArea(ca, ''), true);
  assert.equal(alertMatchesArea(ca, '   '), true);
});

test('action-day filter: only the Indiana alert survives an area filter', () => {
  const alerts = parseEnviroflashCap(CAP_XML);
  const matched = alerts.filter((a) => alertMatchesArea(a, 'Indiana'));
  assert.equal(matched.length, 1);
  assert.equal(matched[0].actionDay, true);
});

// ── Codex-driven hardening: entity decode + non-CAP rejection ──────────────
import { decodeXmlEntities, fetchEnviroflashCap } from '../enviroflash-cap.mjs';

test('capTagText: XML entities are decoded in plain text (but not CDATA)', () => {
  assert.equal(capTagText('<areaDesc>St. Louis &amp; East</areaDesc>', 'areaDesc'), 'St. Louis & East');
  assert.equal(capTagText('<headline>&lt;b&gt;Ozone&lt;/b&gt;</headline>', 'headline'), '<b>Ozone</b>');
  // &amp;lt; must decode to &lt;, not <
  assert.equal(decodeXmlEntities('&amp;lt;'), '&lt;');
});

test('alertMatchesArea: matches after entity-decoded areaDesc', () => {
  const a = parseCapAlert('<alert><identifier>Z</identifier><info><event>Air Quality Alert</event><headline>h</headline><area><areaDesc>St. Louis &amp; East</areaDesc></area></info></alert>');
  assert.equal(a.areaDesc, 'St. Louis & East');
  assert.equal(alertMatchesArea(a, 'louis & east'), true);
});

const stubFetcher = (ok, bodyOrStatus) => async () => (ok
  ? { ok: true, text: async () => bodyOrStatus }
  : { ok: false, status: bodyOrStatus, text: async () => '' });

test('fetchEnviroflashCap: throws on a 200 non-CAP body (HTML error page)', async () => {
  await assert.rejects(fetchEnviroflashCap(stubFetcher(true, '<html><body>503 Service Unavailable</body></html>')), /not a CAP feed/);
});

test('fetchEnviroflashCap: parses a valid CAP body via the injected fetcher', async () => {
  const alerts = await fetchEnviroflashCap(stubFetcher(true, CAP_XML));
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].actionDay, true);
});

test('fetchEnviroflashCap: throws on non-ok upstream', async () => {
  await assert.rejects(fetchEnviroflashCap(stubFetcher(false, 502)), /upstream 502/);
});

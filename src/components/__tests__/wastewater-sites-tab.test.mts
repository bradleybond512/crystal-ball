import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderNationalSummary,
  renderStateTable,
  renderSparkline,
  renderTopSites,
  renderWastewaterSitesTab,
} from '../wastewater-sites-tab.ts';
import type { WastewaterSurveillance } from '@/services/biosurveillance/wastewater-service';

function snapshot(overrides: Partial<WastewaterSurveillance> = {}): WastewaterSurveillance {
  return {
    national: { trend: 'rising', medianPercentile15d: 65, activeStates: 25, risingStates: 12 },
    states: [
      {
        state: 'California', stateCode: 'CA', siteCount: 8, medianPercentile15d: 80, medianPtc15d: 35,
        trend: 'rising', level: 'high', sparkline4w: [40, 50, 65, 80], populationCovered: 1_200_000,
      },
      {
        state: 'New York', stateCode: 'NY', siteCount: 6, medianPercentile15d: 30, medianPtc15d: -40,
        trend: 'falling', level: 'low', sparkline4w: [70, 55, 40, 30], populationCovered: 600_000,
      },
    ],
    topSites: [
      {
        siteId: 'ca-1', siteName: 'LA WWTP 1', stateCode: 'CA', state: 'California',
        county: 'Los Angeles', populationServed: 200_000, lastReport: '2026-05-04',
        percentile15d: 92, ptc15d: 40, trend: 'rising', level: 'high',
      },
    ],
    asOfDate: '2026-05-04',
    fetchedAt: '2026-05-05T00:00:00Z',
    ...overrides,
  };
}

test('renderNationalSummary: includes trend label and rising-state count', () => {
  const html = renderNationalSummary(snapshot());
  assert.match(html, /RISING/);
  assert.match(html, /12 rising/);
  assert.match(html, /As of 2026-05-04/);
});

test('renderNationalSummary: degraded payload renders explanation', () => {
  const html = renderNationalSummary(snapshot({ degraded: true, reason: 'HTTP 503' }));
  assert.match(html, /unavailable/i);
  assert.match(html, /HTTP 503/);
});

test('renderNationalSummary: empty states → "no wastewater data" message', () => {
  const html = renderNationalSummary(snapshot({ states: [], degraded: false }));
  assert.match(html, /No wastewater data/i);
});

test('renderStateTable: emits one row per state with code + level + sparkline', () => {
  const html = renderStateTable(snapshot().states);
  assert.match(html, /CA/);
  assert.match(html, /NY/);
  assert.match(html, /HIGH/);
  assert.match(html, /<svg/);
});

test('renderStateTable: empty input → empty string', () => {
  assert.equal(renderStateTable([]), '');
});

test('renderSparkline: SVG polyline, stroke turns red on rising series', () => {
  const html = renderSparkline([20, 40, 60, 80]);
  assert.match(html, /<svg/);
  assert.match(html, /<polyline/);
  assert.match(html, /stroke="#dc2626"/);
});

test('renderSparkline: stroke turns green on falling series', () => {
  const html = renderSparkline([80, 60, 40, 20]);
  assert.match(html, /stroke="#10b981"/);
});

test('renderSparkline: empty series → empty string', () => {
  assert.equal(renderSparkline([]), '');
});

test('renderTopSites: renders site list with state code + percentile', () => {
  const html = renderTopSites(snapshot().topSites);
  assert.match(html, /CA/);
  assert.match(html, /LA WWTP 1/);
  assert.match(html, /92/);
});

test('renderTopSites: empty list → empty string', () => {
  assert.equal(renderTopSites([]), '');
});

test('renderWastewaterSitesTab: null snapshot → loading message', () => {
  const html = renderWastewaterSitesTab(null);
  assert.match(html, /Loading/i);
});

test('renderWastewaterSitesTab: full snapshot includes summary + table + topSites', () => {
  const html = renderWastewaterSitesTab(snapshot());
  assert.match(html, /National wastewater/i);
  assert.match(html, /CA/);
  assert.match(html, /Top sites by percentile/i);
});

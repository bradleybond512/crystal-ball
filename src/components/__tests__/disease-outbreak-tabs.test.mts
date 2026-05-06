import assert from 'node:assert/strict';
import test from 'node:test';
import {
  levelClass,
  trendArrow,
  sortWastewaterSignals,
  renderWastewaterTab,
  renderCrossReferencedTab,
} from '../disease-outbreak-tabs.ts';
import type { WastewaterData, WastewaterSignal } from '@/services/wastewater';
import type { WhoDonAlert, WhoProMedCrossReference } from '@/services/disease-intel';

const baseSignal: WastewaterSignal = {
  pathogen: 'COVID-19',
  jurisdiction: 'California',
  level: 'high',
  trend: 'increasing',
  percentile15d: 90,
  ptc15d: 50,
  lastUpdated: '2025-02-18',
};

function makeData(overrides: Partial<WastewaterData> = {}): WastewaterData {
  return {
    signals: [baseSignal],
    surgeWatches: [],
    lastUpdated: '2025-02-18',
    fetchedAt: new Date('2025-02-18T12:00:00Z'),
    ...overrides,
  };
}

test('levelClass maps to existing severity classes', () => {
  assert.equal(levelClass('high'), 'eq-major');
  assert.equal(levelClass('elevated'), 'eq-strong');
  assert.equal(levelClass('moderate'), 'eq-moderate');
  assert.equal(levelClass('low'), '');
});

test('trendArrow uses unicode arrows', () => {
  assert.equal(trendArrow('increasing'), '↑');
  assert.equal(trendArrow('decreasing'), '↓');
  assert.equal(trendArrow('stable'), '→');
});

test('sortWastewaterSignals: highest level first, then increasing trend, then alpha', () => {
  const data = makeData({
    signals: [
      { ...baseSignal, jurisdiction: 'California', level: 'low', trend: 'stable', percentile15d: 30 },
      { ...baseSignal, jurisdiction: 'Texas', level: 'high', trend: 'increasing' },
      { ...baseSignal, jurisdiction: 'Alaska', level: 'high', trend: 'stable' },
      { ...baseSignal, jurisdiction: 'Florida', level: 'elevated', trend: 'increasing' },
    ],
  });
  const sorted = sortWastewaterSignals(data);
  assert.deepEqual(sorted.map(s => s.jurisdiction), ['Texas', 'Alaska', 'Florida', 'California']);
});

test('renderWastewaterTab: empty signals renders empty state', () => {
  const html = renderWastewaterTab(makeData({ signals: [] }));
  assert.match(html, /No wastewater signals/);
});

test('renderWastewaterTab: degraded payload surfaces reason', () => {
  const data = makeData({ signals: [], degraded: true, reason: 'NWSS upstream returned HTTP 503' });
  const html = renderWastewaterTab(data);
  assert.match(html, /Wastewater data unavailable/);
  assert.match(html, /HTTP 503/);
});

test('renderWastewaterTab: surge banner renders when surgeWatches present', () => {
  const data = makeData({
    surgeWatches: ['COVID-19 increasing in 4 states'],
  });
  const html = renderWastewaterTab(data);
  assert.match(html, /COVID-19 increasing in 4 states/);
  assert.match(html, /eq-major/);
});

test('renderWastewaterTab: signal row contains pathogen, jurisdiction, level, percentile', () => {
  const html = renderWastewaterTab(makeData());
  assert.match(html, /COVID-19/);
  assert.match(html, /California/);
  assert.match(html, /high/);
  assert.match(html, /p90/);
  assert.match(html, /↑\s*\+50%/);
});

test('renderWastewaterTab: handles null percentile/ptc gracefully', () => {
  const data = makeData({
    signals: [{ ...baseSignal, percentile15d: null, ptc15d: null }],
  });
  const html = renderWastewaterTab(data);
  assert.match(html, /p—/);
});

test('renderWastewaterTab: null input renders empty state', () => {
  const html = renderWastewaterTab(null);
  assert.match(html, /No wastewater signals/);
});

test('renderCrossReferencedTab: empty list renders empty state', () => {
  const html = renderCrossReferencedTab([], []);
  assert.match(html, /No WHO DON × ProMED cross-references/);
});

test('renderCrossReferencedTab: matches WHO DON by id and renders ProMED ids', () => {
  const whoDon: WhoDonAlert[] = [{
    id: 'who-1',
    title: 'Mpox - DRC',
    disease: 'Mpox',
    country: 'DRC',
    date: new Date('2026-04-20'),
    url: 'https://www.who.int/foo',
  }];
  const refs: WhoProMedCrossReference[] = [{
    whoDonId: 'who-1',
    promedIds: ['12345', '12346'],
  }];
  const html = renderCrossReferencedTab(refs, whoDon);
  assert.match(html, /Mpox - DRC/);
  assert.match(html, /DRC/);
  assert.match(html, /12345/);
  assert.match(html, /12346/);
  assert.match(html, /href="https:\/\/www\.who\.int\/foo"/);
});

test('renderCrossReferencedTab: falls back to whoDonId text when no matching alert found', () => {
  const refs: WhoProMedCrossReference[] = [{
    whoDonId: 'unknown-who-id',
    promedIds: ['p1'],
  }];
  const html = renderCrossReferencedTab(refs, []);
  assert.match(html, /unknown-who-id/);
});

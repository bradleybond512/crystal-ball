import assert from 'node:assert/strict';
import test from 'node:test';

import { computeSugarShortageRisk } from '../sugar-shortage-risk.ts';
import { computeCoffeeShortageRisk } from '../coffee-shortage-risk.ts';
import { computeCocoaShortageRisk } from '../cocoa-shortage-risk.ts';
import {
  SUGAR_PLAYBOOK,
  COFFEE_PLAYBOOK,
  COCOA_PLAYBOOK,
  ALL_PLAYBOOKS,
  getPlaybook,
} from '../commodity-playbooks.ts';

const NOW = 1_745_000_000_000;

function input(value: number, source = 'eia', staleMin = 0) {
  return {
    value,
    source,
    observedAt: NOW - staleMin * 60_000,
  };
}

// ── Playbook coverage ──────────────────────────────────────────────────

test('ALL_PLAYBOOKS now includes sugar, coffee, cocoa', () => {
  const ids = ALL_PLAYBOOKS.map((p) => p.commodity);
  assert.ok(ids.includes('sugar'));
  assert.ok(ids.includes('coffee'));
  assert.ok(ids.includes('cocoa'));
});

test('getPlaybook finds soft commodities by name', () => {
  assert.equal(getPlaybook('sugar')?.commodity, 'sugar');
  assert.equal(getPlaybook('coffee')?.commodity, 'coffee');
  assert.equal(getPlaybook('cocoa')?.commodity, 'cocoa');
});

test('soft commodity playbooks declare seasonal risk windows', () => {
  assert.ok(SUGAR_PLAYBOOK.seasonalRiskMonths.length > 0);
  assert.ok(COFFEE_PLAYBOOK.seasonalRiskMonths.includes(7)); // Brazil frost
  assert.ok(COCOA_PLAYBOOK.seasonalRiskMonths.includes(12)); // Harmattan
});

// ── Sugar risk ─────────────────────────────────────────────────────────

test('sugar: drought + ethanol diversion + India ban → high risk', () => {
  const r = computeSugarShortageRisk(
    {
      rainfall_pct_of_normal: input(50),
      cane_yield_anomaly: input(-10),
      ethanol_diversion_pct: input(60),
      india_export_quota_pct: input(20),
      raw_sugar_futures_mom: input(8),
      oil_price_brent: input(95),
    },
    { region: 'BR', now: NOW },
  );
  assert.equal(r.commodity, 'sugar');
  assert.equal(r.domain, 'food');
  assert.ok(r.riskScore >= 50, `expected risk >= 50, got ${r.riskScore}`);
  assert.ok(r.drivers.length >= 5);
});

test('sugar: clean inputs → low risk', () => {
  const r = computeSugarShortageRisk(
    {
      rainfall_pct_of_normal: input(105),
      cane_yield_anomaly: input(2),
      ethanol_diversion_pct: input(40),
      india_export_quota_pct: input(100),
      raw_sugar_futures_mom: input(0),
    },
    { region: 'BR', now: NOW },
  );
  assert.ok(r.riskScore < 30, `expected low risk, got ${r.riskScore}`);
});

// ── Coffee risk ────────────────────────────────────────────────────────

test('coffee: Brazilian frost dominates the risk score', () => {
  const r = computeCoffeeShortageRisk(
    {
      rainfall_pct_of_normal: input(95),
      frost_risk_index_brazil: input(85),
      arabica_futures_mom: input(8),
      roaster_inventory_weeks: input(4),
    },
    { region: 'BR', now: NOW },
  );
  assert.equal(r.commodity, 'coffee');
  assert.ok(r.riskScore >= 50);
  const frostDriver = r.drivers.find((d) => d.label.includes('frost'));
  assert.ok(frostDriver);
});

test('coffee: low frost + healthy inventory → low risk', () => {
  const r = computeCoffeeShortageRisk(
    {
      rainfall_pct_of_normal: input(110),
      frost_risk_index_brazil: input(0),
      arabica_futures_mom: input(0),
      roaster_inventory_weeks: input(12),
    },
    { region: 'BR', now: NOW },
  );
  assert.ok(r.riskScore < 30);
});

// ── Cocoa risk ─────────────────────────────────────────────────────────

test('cocoa: West African disease + low export pace + futures rally → high', () => {
  const r = computeCocoaShortageRisk(
    {
      rainfall_pct_of_normal: input(60),
      black_pod_disease_index: input(70),
      ghana_cote_divoire_export_pace: input(60),
      cocoa_futures_mom: input(10),
    },
    { region: 'CI', now: NOW },
  );
  assert.equal(r.commodity, 'cocoa');
  assert.ok(r.riskScore >= 50);
});

test('cocoa: data gaps lower confidence', () => {
  const r = computeCocoaShortageRisk(
    {
      rainfall_pct_of_normal: input(60),
    },
    { region: 'CI', now: NOW },
  );
  assert.ok(r.dataGaps.length > 0);
});

// ── Common shape sanity ────────────────────────────────────────────────

test('every soft commodity returns the standard ShortageForecast shape', () => {
  const sugar = computeSugarShortageRisk({}, { region: 'BR', now: NOW });
  const coffee = computeCoffeeShortageRisk({}, { region: 'BR', now: NOW });
  const cocoa = computeCocoaShortageRisk({}, { region: 'CI', now: NOW });
  for (const r of [sugar, coffee, cocoa]) {
    assert.equal(r.domain, 'food');
    assert.ok(Array.isArray(r.confirmingIndicators));
    assert.ok(Array.isArray(r.invalidatingIndicators));
    assert.ok(typeof r.horizonDays === 'number');
    assert.ok(typeof r.lastUpdated === 'string');
  }
});

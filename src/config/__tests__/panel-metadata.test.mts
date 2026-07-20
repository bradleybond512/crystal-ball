import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIBRARY_DOMAIN_LABELS,
  PANEL_METADATA,
} from '../panel-metadata.ts';
import { DEFAULT_PANELS } from '../panels.ts';
import { DEFAULT_DECK_PINS } from '../../services/home-shell/deck-view.ts';

const DOMAINS = Object.keys(LIBRARY_DOMAIN_LABELS);

test('every FULL_PANELS key has exactly one metadata entry and vice versa', () => {
  const metaKeys = Object.keys(PANEL_METADATA).sort();
  const panelKeys = Object.keys(DEFAULT_PANELS).sort();
  assert.deepEqual(metaKeys, panelKeys);
});

test('every entry has a known domain and lowercase non-empty tags', () => {
  for (const [key, meta] of Object.entries(PANEL_METADATA)) {
    assert.ok(DOMAINS.includes(meta.domain), `${key}: unknown domain ${meta.domain}`);
    assert.ok(meta.tags.length > 0, `${key}: no tags`);
    for (const t of meta.tags) {
      assert.equal(t, t.toLowerCase(), `${key}: tag '${t}' not lowercase`);
      assert.ok(t.trim().length > 0, `${key}: empty tag`);
    }
  }
});

test('system tier is populated and confined to the system-health domain', () => {
  const system = Object.entries(PANEL_METADATA).filter(([, m]) => m.tier === 'system');
  assert.ok(system.length >= 25, `expected >=25 system panels, got ${system.length}`);
  for (const [key, meta] of system) {
    assert.equal(meta.domain, 'system-health', `${key}: system tier outside system-health domain`);
  }
});

test('every domain has at least 4 featured panels', () => {
  for (const domain of DOMAINS) {
    const featured = Object.entries(PANEL_METADATA).filter(
      ([, m]) => m.domain === domain && m.featured,
    );
    assert.ok(featured.length >= 4, `${domain}: only ${featured.length} featured`);
  }
});

test('aliasOf targets exist', () => {
  for (const [key, meta] of Object.entries(PANEL_METADATA)) {
    if (meta.aliasOf) {
      assert.ok(PANEL_METADATA[meta.aliasOf], `${key}: aliasOf '${meta.aliasOf}' missing`);
    }
  }
});

test('deck defaults are covered by the registry', () => {
  for (const pin of DEFAULT_DECK_PINS) {
    assert.ok(PANEL_METADATA[pin], `deck default '${pin}' missing from registry`);
  }
});

const PLAYBOOK_CATEGORIES = [
  'severe_weather', 'wildfire', 'oil_fuel_shortage', 'food_shortage',
  'cyber_campaign', 'banking_outage', 'conflict_escalation',
  'travel_disruption', 'grid_outage', 'disease_outbreak', 'earthquake',
] as const;

test('evidenceFor values are known playbook categories', () => {
  for (const [key, meta] of Object.entries(PANEL_METADATA)) {
    for (const cat of meta.evidenceFor ?? []) {
      assert.ok(
        (PLAYBOOK_CATEGORIES as readonly string[]).includes(cat),
        `${key}: unknown evidenceFor category '${cat}'`,
      );
    }
  }
});

test('every playbook category has at least 6 evidence panels', () => {
  for (const cat of PLAYBOOK_CATEGORIES) {
    const count = Object.values(PANEL_METADATA).filter(
      (m) => m.evidenceFor?.includes(cat),
    ).length;
    assert.ok(count >= 6, `${cat}: only ${count} evidence panels`);
  }
});

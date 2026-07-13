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

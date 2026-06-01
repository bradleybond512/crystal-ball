/**
 * Panel data contracts gate test.
 *
 * Reports panels in the smoke registry that have not been classified
 * in `panel-data-contracts.mts`. Currently a TODO surface — newly-added
 * panels show up as warnings, not failures, so the contract registry
 * can be filled in incrementally.
 *
 * Tightening path: when the registry is complete, flip the TODO check
 * to a hard `assert.equal(unclassified.length, 0)`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PANEL_SMOKE_REGISTRY, PANEL_SMOKE_EXCLUSIONS } from './panel-smoke-registry.mts';
import {
  PANEL_DATA_CONTRACTS,
  hasPanelContract,
  panelsByContract,
} from './panel-data-contracts.mts';
import { PANEL_FIXTURES } from './panel-fixtures.mts';

describe('panel data contracts', () => {
  it('every classified panel exists in the smoke registry or is excluded', () => {
    const orphans: string[] = [];
    for (const id of Object.keys(PANEL_DATA_CONTRACTS)) {
      const inRegistry = id in PANEL_SMOKE_REGISTRY;
      const excluded = id in PANEL_SMOKE_EXCLUSIONS;
      if (!inRegistry && !excluded) orphans.push(id);
    }
    assert.deepEqual(
      orphans,
      [],
      `panels listed in PANEL_DATA_CONTRACTS but absent from smoke registry: ${orphans.join(', ')}`,
    );
  });

  it('every updated-by-data-loader panel records its update method + loader file', () => {
    const malformed: string[] = [];
    for (const id of panelsByContract('updated-by-data-loader')) {
      const entry = PANEL_DATA_CONTRACTS[id];
      if (!entry?.updateMethod || !entry?.loaderFile) {
        malformed.push(`${id} (missing ${!entry?.updateMethod ? 'updateMethod' : 'loaderFile'})`);
      }
    }
    assert.deepEqual(malformed, [], `incomplete data-loader contract entries:\n  ${malformed.join('\n  ')}`);
  });

  it('reports unclassified panels (TODO surface, currently non-failing)', () => {
    const unclassified = Object.keys(PANEL_SMOKE_REGISTRY)
      .filter((id) => !hasPanelContract(id))
      .sort();
    if (unclassified.length > 0) {
      console.log(`\n[panel-contracts] TODO: ${unclassified.length} unclassified panel(s)`);
      console.log(`  Add each to tests/panels/panel-data-contracts.mts when its data flow is reviewed.`);
      console.log(`  Sample (first 10): ${unclassified.slice(0, 10).join(', ')}`);
    }
    // Bootstrap: do not fail. Tighten to assert.equal(unclassified.length, 0)
    // once the registry is complete.
  });

  it('every panel with a fixture entry also has a contract classification', () => {
    const fixturedWithoutContract = Object.keys(PANEL_FIXTURES)
      .filter((id) => !hasPanelContract(id));
    assert.deepEqual(
      fixturedWithoutContract,
      [],
      `panels with fixtures but no contract:\n  ${fixturedWithoutContract.join('\n  ')}`,
    );
  });
});

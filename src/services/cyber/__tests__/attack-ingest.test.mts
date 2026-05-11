/**
 * Pure-transformer tests for src/services/cyber/attack-ingest.ts
 *
 * The fetch wrapper is a thin shell around HTTP — covered by route-level
 * tests in api/__tests__/attack-groups.test.mjs. What's worth testing
 * here is that the route's slim-bundle contract round-trips through
 * apt-tracker's parseAttackBundle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAttackBundle } from '../apt-tracker.ts';

// Mirrors the slim shape returned by /api/attack/groups.
const SLIM_BUNDLE = {
  type: 'bundle',
  id: 'bundle--abc',
  objects: [
    {
      type: 'intrusion-set', id: 'intrusion-set--1',
      name: 'APT28', aliases: ['Fancy Bear', 'Sofacy'],
      x_mitre_attributed_to: 'Russia',
      external_references: [{ source_name: 'mitre-attack', external_id: 'G0007' }],
    },
    {
      type: 'intrusion-set', id: 'intrusion-set--2',
      name: 'Lazarus Group', aliases: ['HIDDEN COBRA'],
      x_mitre_attributed_to: 'North Korea',
      external_references: [{ source_name: 'mitre-attack', external_id: 'G0032' }],
    },
  ],
};

test('parseAttackBundle: slim bundle from route round-trips into AptGroup[]', () => {
  const groups = parseAttackBundle(SLIM_BUNDLE);
  assert.equal(groups.length, 2);
  const apt28 = groups.find((g) => g.id === 'G0007');
  assert.ok(apt28);
  assert.equal(apt28!.name, 'APT28');
  assert.deepEqual(apt28!.aliases, ['Fancy Bear', 'Sofacy']);
  assert.equal(apt28!.country, 'Russia');
});

test('parseAttackBundle: malformed/empty bundle from route degrades to []', () => {
  assert.deepEqual(parseAttackBundle(null), []);
  assert.deepEqual(parseAttackBundle({ type: 'bundle', objects: [] }), []);
  assert.deepEqual(parseAttackBundle({ type: 'not-a-bundle' }), []);
});

test('parseAttackBundle: drops intrusion-set without G-code external_id', () => {
  const groups = parseAttackBundle({
    type: 'bundle',
    objects: [
      { type: 'intrusion-set', id: 'is--missing', name: 'No G-code' },
      { type: 'intrusion-set', id: 'is--good', name: 'OK', external_references: [{ source_name: 'mitre-attack', external_id: 'G9999' }] },
    ],
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'G9999');
});

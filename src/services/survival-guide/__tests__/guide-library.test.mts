import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allGuides, getGuide, guidesByKind } from '../guide-library.ts';

test('library holds all 24 guides with unique ids', () => {
  const guides = allGuides();
  assert.equal(guides.length, 24);
  const ids = new Set(guides.map((g) => g.id));
  assert.equal(ids.size, 24);
});

test('17 hazards + 7 preparedness', () => {
  assert.equal(guidesByKind('hazard').length, 17);
  assert.equal(guidesByKind('preparedness').length, 7);
});

test('every guide is well-formed', () => {
  const seenChecklistIds = new Set<string>();
  for (const g of allGuides()) {
    assert.ok(g.summary.length > 0, `${g.id} summary`);
    assert.ok(g.signs.length > 0, `${g.id} signs`);
    assert.ok(g.prepare.length > 0, `${g.id} prepare`);
    assert.ok(g.during.length > 0, `${g.id} during`);
    assert.ok(g.after.length > 0, `${g.id} after`);
    assert.ok(g.mistakes.length > 0, `${g.id} mistakes`);
    assert.ok(g.sources.length > 0, `${g.id} sources`);
    for (const item of g.checklist) {
      assert.ok(item.id.startsWith(`${g.id}.`), `${item.id} must be prefixed by guide id`);
      assert.ok(!seenChecklistIds.has(item.id), `duplicate checklist id ${item.id}`);
      seenChecklistIds.add(item.id);
    }
    for (const rel of g.relatedGuides) {
      assert.notEqual(rel, g.id, `${g.id} relatedGuides must not self-reference`);
      assert.ok(getGuide(rel), `${g.id} relatedGuides -> unknown ${rel}`);
    }
  }
});

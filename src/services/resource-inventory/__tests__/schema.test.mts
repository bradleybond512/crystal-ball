// R4-SEC-005: inventory rows are rebuilt from an allowlist before they reach
// the main window's HTML or the Survival Advisor prompt.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ITEMS,
  MAX_LOG_ENTRIES,
  describeImportResult,
  parseInventoryImport,
  partitionStoredItems,
  validateResourceItem,
} from '../schema.ts';

const ITEM = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'Water',
  quantity: 20,
  unit: 'L',
  dailyRate: 4,
  category: 'Water',
  lastUpdated: 1_790_000_000_000,
  consumptionLog: [{ timestamp: 1_790_000_000_000, amount: 2 }, { timestamp: 1_790_000_100_000, amount: -10 }],
  alertedThresholds: ['7-day'],
};

test('a well-formed row (and a legacy row without a log) passes unchanged', () => {
  assert.deepEqual(validateResourceItem(ITEM), { ok: true, item: ITEM });
  const legacy = { id: 'legacy_1', name: 'Rice', quantity: 5, unit: 'kg', dailyRate: 0.5, category: 'Food', lastUpdated: 1 };
  assert.deepEqual(validateResourceItem(legacy), { ok: true, item: legacy });
});

test('a script-bearing or malformed id is rejected', () => {
  for (const id of ['"><img src=x onerror=alert(1)>', "a' onmouseover='x", '', 'x'.repeat(65), 7, null, 'a b']) {
    const result = validateResourceItem({ ...ITEM, id });
    assert.deepEqual(result, { ok: false, field: 'id' }, String(id));
  }
});

test('wrong types, NaN, Infinity and negatives are rejected field by field', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ quantity: '20' }, 'quantity'],
    [{ quantity: Number.NaN }, 'quantity'],
    [{ quantity: Number.POSITIVE_INFINITY }, 'quantity'],
    [{ quantity: -1 }, 'quantity'],
    [{ quantity: 2e9 }, 'quantity'],
    [{ dailyRate: '4' }, 'dailyRate'],
    [{ name: '' }, 'name'],
    [{ name: 42 }, 'name'],
    [{ name: 'n'.repeat(121) }, 'name'],
    [{ unit: { toString: () => 'L' } }, 'unit'],
    [{ category: 'c'.repeat(41) }, 'category'],
    [{ lastUpdated: 'yesterday' }, 'lastUpdated'],
    [{ consumptionLog: 'none' }, 'consumptionLog'],
    [{ consumptionLog: [{ timestamp: 1, amount: '2' }] }, 'consumptionLog'],
    [{ consumptionLog: Array.from({ length: MAX_LOG_ENTRIES + 1 }, () => ({ timestamp: 1, amount: 1 })) }, 'consumptionLog'],
    [{ alertedThresholds: ['<script>'] }, 'alertedThresholds'],
  ];
  for (const [patch, field] of cases) {
    assert.deepEqual(validateResourceItem({ ...ITEM, ...patch }), { ok: false, field }, JSON.stringify(patch).slice(0, 60));
  }
  assert.deepEqual(validateResourceItem('not a row'), { ok: false, field: 'not-an-object' });
  assert.deepEqual(validateResourceItem([ITEM]), { ok: false, field: 'not-an-object' });
});

test('labels are trimmed, control and bidi characters removed, defaults kept', () => {
  const result = validateResourceItem({ ...ITEM, name: '  Water\u0000‮\n ', unit: '', category: undefined });
  assert.ok(result.ok);
  assert.equal(result.item.name, 'Water');
  assert.equal(result.item.unit, 'units');
  assert.equal(result.item.category, 'Misc');
  assert.equal(validateResourceItem({ ...ITEM, name: '\u0007\u0008' }).ok, false, 'a name of only control characters is empty');
});

test('only allowlisted fields survive', () => {
  const result = validateResourceItem({ ...ITEM, onclick: 'x', __proto__: { polluted: true }, extra: '<b>' });
  assert.ok(result.ok);
  assert.deepEqual(Object.keys(result.item).sort(), Object.keys(ITEM).sort());
});

test('stored rows are split into visible items and hidden keys', () => {
  const poisoned = { id: '"><img src=x onerror=alert(1)>', name: 'x', quantity: 1 };
  const brokenType = { id: 'ok-id', name: 'Fuel', quantity: 'lots' };
  const { items, hiddenKeys } = partitionStoredItems([ITEM, poisoned, brokenType, null]);
  assert.deepEqual(items.map((i) => i.id), [ITEM.id]);
  assert.deepEqual(hiddenKeys, [poisoned.id, 'ok-id', undefined]);
});

test('an import with any invalid row is rejected whole, with a count and the first problem', () => {
  const file = JSON.stringify([ITEM, { ...ITEM, id: 'b' }, { ...ITEM, id: '"><svg onload=1>' }, { ...ITEM, id: 'd', quantity: 'x' }]);
  const result = parseInventoryImport(file);
  assert.deepEqual(result, { ok: false, reason: 'invalid-items', invalidCount: 2, total: 4, firstIndex: 2, firstField: 'id' });
  assert.equal(describeImportResult(result), 'Import rejected: 2 of 4 items are invalid (first: item 3, id). Nothing was imported.');
});

test('valid imports pass; malformed, oversized, empty and duplicate files do not', () => {
  const ok = parseInventoryImport(JSON.stringify([ITEM, { ...ITEM, id: 'second' }]));
  assert.ok(ok.ok);
  assert.equal(ok.items.length, 2);
  assert.equal(describeImportResult(ok), 'Imported 2 items.');
  assert.deepEqual(parseInventoryImport('{not json'), { ok: false, reason: 'not-json' });
  assert.deepEqual(parseInventoryImport(JSON.stringify(ITEM)), { ok: false, reason: 'not-a-list' });
  assert.deepEqual(parseInventoryImport('[]'), { ok: false, reason: 'empty' });
  assert.deepEqual(parseInventoryImport(' '.repeat(MAX_IMPORT_BYTES + 1)), { ok: false, reason: 'too-large' });
  assert.deepEqual(parseInventoryImport(JSON.stringify(Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, i) => ({ ...ITEM, id: `i${i}` })))), { ok: false, reason: 'too-many' });
  assert.deepEqual(parseInventoryImport(JSON.stringify([ITEM, ITEM])), { ok: false, reason: 'duplicate-id', id: ITEM.id });
});

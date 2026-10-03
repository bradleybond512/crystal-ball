// R3-SEC-009: feed numbers are coerced at the provider boundary and
// formatted for HTML so markup can never ride along.
import assert from 'node:assert/strict';
import test from 'node:test';

import { finiteOr, finiteOrUndefined, formatFiniteNumber, positiveCountOrUndefined } from '../finite-number.ts';

test('only finite numbers and numeric strings become numbers', () => {
  assert.equal(finiteOrUndefined(12.5), 12.5);
  assert.equal(finiteOrUndefined('12.5'), 12.5);
  assert.equal(finiteOrUndefined(' 7 '), 7);
  for (const bad of ['', '  ', '12<img src=x>', '<b>1</b>', Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}, [], true]) {
    assert.equal(finiteOrUndefined(bad), undefined, String(bad));
  }
  assert.equal(finiteOr('nope', 0), 0);
  assert.equal(positiveCountOrUndefined('4.6'), 5);
  assert.equal(positiveCountOrUndefined(0), undefined);
  assert.equal(positiveCountOrUndefined(-3), undefined);
});

test('display output is digits, sign and separators, or a dash', () => {
  assert.equal(formatFiniteNumber(1234.56), '1,234.6');
  assert.equal(formatFiniteNumber(-2.345, 2), '-2.35');
  assert.equal(formatFiniteNumber('"><script>alert(1)</script>'), '—');
  assert.equal(formatFiniteNumber(undefined), '—');
  for (const value of [0, 1e21, -0.0001, '3', 99_999.999]) {
    assert.match(formatFiniteNumber(value, 2), /^[-\d.,]+$|^—$/, String(value));
  }
});

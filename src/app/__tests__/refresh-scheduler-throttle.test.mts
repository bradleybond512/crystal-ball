import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenMultiplier } from '../refresh-scheduler.ts';

describe('hiddenMultiplier', () => {
  it('is 1 when not hidden', () => {
    assert.equal(hiddenMultiplier(false, false), 1);
    assert.equal(hiddenMultiplier(false, true), 1);
  });
  it('is 10 when hidden and always-on is OFF', () => {
    assert.equal(hiddenMultiplier(true, false), 10);
  });
  it('is 1 when hidden but always-on is ON', () => {
    assert.equal(hiddenMultiplier(true, true), 1);
  });
});

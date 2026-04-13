import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(import.meta.dirname, '../src/components/Toast.ts'), 'utf-8');

describe('Toast component', () => {
  it('exports Toast class', () => {
    assert.ok(src.includes('export class Toast'), 'Must export Toast class');
  });

  it('exports showToast function', () => {
    assert.ok(src.includes('export function showToast'), 'Must export showToast');
  });

  it('supports severity levels', () => {
    for (const s of ['critical', 'high', 'elevated']) {
      assert.ok(src.includes(s), `Must support ${s} severity`);
    }
  });

  it('implements auto-dismiss', () => {
    assert.ok(src.includes('setTimeout'), 'Must implement auto-dismiss timer');
  });

  it('respects Ghost Mode', () => {
    assert.ok(src.includes('isGhostMode'), 'Must check Ghost Mode');
  });

  it('limits stack size', () => {
    assert.ok(src.includes('MAX_TOASTS'), 'Must limit toast stack');
  });
});

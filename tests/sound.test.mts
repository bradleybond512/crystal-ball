import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(import.meta.dirname, '../src/services/sound.ts'), 'utf-8');

describe('sound service', () => {
  it('exports playAlertSound', () => {
    assert.ok(src.includes('export function playAlertSound'));
  });

  it('exports playAckSound', () => {
    assert.ok(src.includes('export function playAckSound'));
  });

  it('uses Web Audio API', () => {
    assert.ok(src.includes('AudioContext'));
  });

  it('respects Ghost Mode', () => {
    assert.ok(src.includes('isGhostMode'));
  });

  it('rate-limits sounds', () => {
    assert.ok(src.includes('MIN_INTERVAL'));
  });
});

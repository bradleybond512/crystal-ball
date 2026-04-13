// tests/motion.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(import.meta.dirname, '../src/services/motion.ts'), 'utf-8');

describe('motion.ts exports', () => {
  const requiredExports = [
    'staggerIn', 'crossfadeContent', 'animateNumber',
    'animateIn', 'animateOut', 'revealContent', 'prefersReducedMotion',
  ];

  for (const name of requiredExports) {
    it(`exports ${name}`, () => {
      assert.ok(
        src.includes(`export function ${name}`) || src.includes(`export const ${name}`),
        `Missing export: ${name}`,
      );
    });
  }

  it('checks prefers-reduced-motion', () => {
    assert.ok(src.includes('prefers-reduced-motion'), 'Must check reduced motion preference');
  });

  it('checks body.animations-paused', () => {
    assert.ok(src.includes('animations-paused'), 'Must respect animations-paused class');
  });
});

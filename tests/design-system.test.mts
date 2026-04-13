import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(import.meta.dirname, '../src/styles/design-system.css'), 'utf-8');

describe('design-system.css tokens', () => {
  const requiredTokens = [
    '--font-ui', '--font-mono',
    '--text-2xs', '--text-xs', '--text-sm', '--text-base',
    '--text-md', '--text-lg', '--text-xl', '--text-2xl',
    '--fw-regular', '--fw-medium', '--fw-semibold', '--fw-bold',
    '--space-1', '--space-2', '--space-3', '--space-4',
    '--space-6', '--space-8', '--space-12', '--space-16',
    '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
    '--duration-fast', '--duration-normal', '--duration-moderate', '--duration-slow',
    '--ease-default', '--ease-spring', '--ease-out', '--ease-in',
    '--surface-base', '--surface-raised', '--surface-overlay', '--surface-popover',
    '--accent', '--hover-bg', '--active-bg', '--focus-ring',
    '--elevation-1', '--elevation-2', '--elevation-3', '--elevation-4',
    '--border-subtle', '--border-medium', '--border-strong',
  ];

  for (const token of requiredTokens) {
    it(`defines ${token}`, () => {
      assert.ok(css.includes(`${token}:`), `Missing token: ${token}`);
    });
  }

  const severityLevels = ['critical', 'high', 'elevated', 'normal', 'positive'];
  const severityVariants = ['', '-bg', '-border', '-glow'];

  for (const level of severityLevels) {
    for (const variant of severityVariants) {
      const token = `--severity-${level}${variant}`;
      it(`defines ${token}`, () => {
        assert.ok(css.includes(`${token}:`), `Missing severity token: ${token}`);
      });
    }
  }

  it('includes light theme overrides', () => {
    assert.ok(css.includes('[data-theme="light"]'), 'Missing light theme selector');
  });

  it('includes shimmer keyframe', () => {
    assert.ok(css.includes('@keyframes cb-shimmer'), 'Missing shimmer animation');
  });
});

describe('design-system.css component primitives', () => {
  const requiredClasses = [
    '.cb-card', '.cb-badge', '.cb-button', '.cb-input', '.cb-list-row',
    '.cb-separator', '.cb-skeleton', '.cb-pill-group',
  ];

  for (const cls of requiredClasses) {
    it(`defines ${cls}`, () => {
      assert.ok(css.includes(cls), `Missing class: ${cls}`);
    });
  }

  it('defines severity badge variants', () => {
    for (const level of ['critical', 'high', 'elevated', 'normal', 'positive']) {
      assert.ok(
        css.includes(`[data-severity="${level}"]`),
        `Missing badge variant: ${level}`,
      );
    }
  });
});

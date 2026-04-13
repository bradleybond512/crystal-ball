import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(import.meta.dirname, '../src/components/EmptyState.ts'), 'utf-8');

describe('EmptyState component', () => {
  it('exports renderEmptyState function', () => {
    assert.ok(src.includes('export function renderEmptyState'));
  });
  it('exports getEmptyStateDefaults function', () => {
    assert.ok(src.includes('export function getEmptyStateDefaults'));
  });
  it('exports EmptyState class', () => {
    assert.ok(src.includes('export class EmptyState'));
  });
  it('supports icon, title, message', () => {
    assert.ok(src.includes('icon') && src.includes('title') && src.includes('message'));
  });
  it('supports optional CTA button', () => {
    assert.ok(src.includes('cta'));
  });
  it('has category defaults', () => {
    for (const cat of ['geopolitical', 'infrastructure', 'cyber', 'markets', 'weather']) {
      assert.ok(src.includes(cat), `Missing category: ${cat}`);
    }
  });
});

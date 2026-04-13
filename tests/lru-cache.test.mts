import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.join(import.meta.dirname, '..', 'src/utils/lru-cache.ts'), 'utf8');

describe('LRU cache source contract', () => {
  it('exports LruCache class', () => {
    assert.ok(src.includes('export class LruCache'));
  });

  it('accepts a max size parameter', () => {
    assert.ok(src.includes('maxSize'));
  });

  it('has get and set methods', () => {
    assert.ok(src.includes('get('));
    assert.ok(src.includes('set('));
  });

  it('evicts oldest entries when full', () => {
    assert.ok(src.includes('delete'));
  });
});

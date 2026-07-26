import { strict as assert } from 'node:assert';
import { beforeEach, test } from 'node:test';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
});

const { isSpatialLayerEnabled } = await import('../../sound-manager.ts');

beforeEach(() => {
  storage.clear();
});

test('ticker spatial audio defaults off to avoid continuous background playback', () => {
  assert.equal(isSpatialLayerEnabled('ticker'), false);
});

test('ticker spatial audio honors an explicit opt-in', () => {
  storage.setItem('wm-spatial-ticker', '1');
  assert.equal(isSpatialLayerEnabled('ticker'), true);
});

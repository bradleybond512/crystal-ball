import assert from 'node:assert/strict';
import { test } from 'node:test';

test('rehydrateDate preserves dates, restores strings, and rejects null as invalid', async () => {
  const { rehydrateDate } = await import('../cache-hydration.ts');
  const date = new Date('2026-08-10T01:02:03.000Z');

  assert.equal(rehydrateDate(date), date);
  assert.equal(rehydrateDate('2026-08-10T01:02:03.000Z').getTime(), date.getTime());
  assert.ok(Number.isNaN(rehydrateDate(null).getTime()));
  assert.ok(Number.isNaN(rehydrateDate(undefined).getTime()));
});

test('fetchWithContext adds context only to the exact WebKit load failure', async () => {
  const { fetchWithContext } = await import('../fetch-with-context.ts');
  const originalFetch = globalThis.fetch;
  const webkitError = new TypeError('Load failed');
  globalThis.fetch = (async () => { throw webkitError; }) as typeof globalThis.fetch;

  try {
    await assert.rejects(
      fetchWithContext('test feed', 'https://example.com/feed'),
      (error: unknown) => error instanceof Error
        && error.message === 'Failed to fetch test feed: TypeError: Load failed'
        && error.cause === webkitError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchWithContext rethrows unexpected errors unchanged', async () => {
  const { fetchWithContext } = await import('../fetch-with-context.ts');
  const originalFetch = globalThis.fetch;
  const unexpectedError = new TypeError('Unexpected response coercion');
  globalThis.fetch = (async () => { throw unexpectedError; }) as typeof globalThis.fetch;

  try {
    await assert.rejects(
      fetchWithContext('test feed', 'https://example.com/feed'),
      (error: unknown) => error === unexpectedError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

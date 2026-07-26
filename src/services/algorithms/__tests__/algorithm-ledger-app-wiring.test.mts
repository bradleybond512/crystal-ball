import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../../../App.ts', import.meta.url), 'utf8');

test('App hydrates algorithm evidence before panels can record new evaluations', () => {
  const preloadAt = appSource.indexOf('await preloadIdbBackedStores()');
  const persistenceAt = appSource.indexOf('await startAlgorithmLedgerPersistence(');
  const panelsAt = appSource.indexOf('this.panelLayout.init()');

  assert.ok(preloadAt >= 0);
  assert.ok(persistenceAt > preloadAt);
  assert.ok(panelsAt > persistenceAt);
});

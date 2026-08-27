import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelLayoutSource = readFileSync(new URL('../panel-layout.ts', import.meta.url), 'utf8');

test('the application constructs and registers the UCDP panel only on desktop', () => {
  assert.match(
    panelLayoutSource,
    /if \(isDesktopRuntime\(\)\) \{\s*const ucdpEventsPanel = new UcdpEventsPanel\(\);[\s\S]*?this\.ctx\.panels\['ucdp-events'\] = ucdpEventsPanel;\s*\}/,
  );
  assert.equal((panelLayoutSource.match(/new UcdpEventsPanel\(\)/g) ?? []).length, 1);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { destroyUniquePanels } from '../panel-lifecycle.ts';

test('panel teardown destroys every mounted panel exactly once', () => {
  let firstCalls = 0;
  let secondCalls = 0;
  const first = { destroy: () => { firstCalls += 1; } };
  const second = { destroy: () => { secondCalls += 1; } };

  destroyUniquePanels([first, second, first, null, undefined]);

  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
});

test('layout and shared ticker release their panel ownership on teardown', () => {
  const layoutSource = readFileSync(new URL('../panel-layout.ts', import.meta.url), 'utf8');
  const panelSource = readFileSync(
    new URL('../../components/Panel.ts', import.meta.url),
    'utf8',
  );

  assert.match(layoutSource, /destroyUniquePanels/);
  assert.match(layoutSource, /Object\.values\(this\.ctx\.panels\)/);
  assert.match(layoutSource, /Object\.values\(this\.ctx\.newsPanels\)/);
  assert.match(layoutSource, /private eewStatusBar: EEWStatusBar \| null/);
  assert.match(layoutSource, /this\.eewStatusBar\?\.destroy\(\)/);
  assert.match(layoutSource, /this\.spaceWeatherStatusBarPoller\?\.stop\(\)/);
  assert.match(panelSource, /Panel\.instances\.size === 0/);
  assert.match(panelSource, /Panel\.stopHeartbeatTicker\(\)/);
});

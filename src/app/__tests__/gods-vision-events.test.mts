import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Window } from 'happy-dom';

import { bindGodsVisionControls } from '../gods-vision-events.ts';

test('God\'s Vision button toggles once and teardown detaches both listeners', () => {
  const window = new Window({ url: 'http://127.0.0.1/' });
  const document = window.document;
  document.body.innerHTML = '<button id="godsVisionBtn"><span>Open globe</span></button>';
  let toggles = 0;

  const release = bindGodsVisionControls(document, () => {
    toggles += 1;
  });
  const label = document.querySelector('#godsVisionBtn span');
  assert.ok(label);

  label.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(toggles, 1);

  release();
  label.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  document.dispatchEvent(new window.CustomEvent('cb:toggle-gods-vision'));
  assert.equal(toggles, 1);
});

test('App owns and releases the God\'s Vision control binding', () => {
  const appSource = readFileSync(new URL('../../App.ts', import.meta.url), 'utf8');

  assert.match(appSource, /this\.releaseGodsVisionControls = bindGodsVisionControls\(/);
  assert.match(appSource, /this\.releaseGodsVisionControls\(\)/);
});

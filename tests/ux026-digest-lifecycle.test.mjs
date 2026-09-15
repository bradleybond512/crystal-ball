import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
const faaWeatherCamsPanel = readFileSync(
  new URL('../src/components/FAAWeatherCamsPanel.ts', import.meta.url),
  'utf8',
);

test('digest dismissal invalidates the generation and aborts its pending request', () => {
  const setupStart = layout.indexOf('this.digestOverlay = new DigestOverlay');
  const requestStart = layout.indexOf('const requestDigest', setupStart);
  assert.ok(setupStart >= 0 && requestStart > setupStart, 'digest setup block must remain discoverable');
  const setup = layout.slice(setupStart, requestStart);

  assert.match(setup, /new DigestOverlay\(\{[\s\S]*?onDismiss:/,
    'the overlay must notify panel lifecycle ownership when the user dismisses');
  assert.match(setup, /onDismiss:[\s\S]*?this\.digestGeneration\s*\+=\s*1/,
    'dismissal must invalidate the captured generation');
  assert.match(setup, /onDismiss:[\s\S]*?this\.digestAbortController\?\.abort\(\)/,
    'dismissal must abort the pending model request');
});

test('on-demand completion checks generation and visibility before reopening the overlay', () => {
  const completionStart = layout.indexOf('void generateDigest(controller.signal).then');
  const showStart = layout.indexOf('overlay.show(cards)', completionStart);
  assert.ok(completionStart >= 0 && showStart > completionStart, 'digest completion block must remain discoverable');
  const beforeShow = layout.slice(completionStart, showStart);

  assert.match(beforeShow, /generation\s*!==\s*this\.digestGeneration/,
    'stale generations must remain inert');
  assert.match(beforeShow, /onDemand[\s\S]*?!this\.digestOverlay\?\.isVisible\(\)/,
    'a dismissed on-demand request must not reopen the overlay when it resolves');
});

test('alert and saved-place subscriptions reproject locally without another model request', () => {
  const projectionStart = layout.indexOf('const reprojectDigest');
  const requestStart = layout.indexOf('const requestDigest', projectionStart);
  assert.ok(projectionStart >= 0 && requestStart > projectionStart, 'local reprojection block must remain discoverable');
  const projection = layout.slice(projectionStart, requestStart);

  assert.match(projection, /projectDigestStories\(/);
  assert.match(projection, /unifiedAlertStore\.subscribe\(reprojectDigest\)/);
  assert.match(projection, /subscribeSavedPlaces\(reprojectDigest\)/);
  assert.doesNotMatch(projection, /generateDigest|runIntel/,
    'local alert/place changes must not cause another model call');
});

test('panel teardown cancels digest work and removes every owned subscription', () => {
  const cleanupStart = layout.indexOf('this.cancelScheduledDigest?.()');
  const cleanupEnd = layout.indexOf('// Clean up datacenter strip', cleanupStart);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'digest teardown block must remain discoverable');
  const cleanup = layout.slice(cleanupStart, cleanupEnd);

  assert.match(cleanup, /this\.digestGeneration\s*\+=\s*1/);
  assert.match(cleanup, /this\.digestAbortController\?\.abort\(\)/);
  assert.match(cleanup, /this\.unsubDigestAlerts\?\.\(\)/);
  assert.match(cleanup, /this\.unsubDigestPlaces\?\.\(\)/);
  assert.match(cleanup, /removeEventListener\('cb:show-digest'/);
  assert.match(cleanup, /this\.digestOverlay\?\.destroy\(\)/);
});

test('FAA weather-cam fire-and-forget loading handles rejection without clearing existing cameras', () => {
  const loadStart = faaWeatherCamsPanel.indexOf('private async load()');
  const loadEnd = faaWeatherCamsPanel.indexOf('public refresh()', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'FAA weather-cam load method must remain discoverable');
  const load = faaWeatherCamsPanel.slice(loadStart, loadEnd);

  assert.match(load, /try\s*\{[\s\S]*?await Promise\.all\([\s\S]*?\}\s*catch(?:\s*\([^)]*\))?\s*\{/,
    'the fire-and-forget load method must contain its own rejection boundary');
  const catchBody = load.match(/catch(?:\s*\([^)]*\))?\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.doesNotMatch(catchBody, /this\.cameras\s*=/,
    'a failed refresh must preserve the last successfully loaded camera data');
});

/**
 * Loading-honesty budget decision (pure). The DOM/timer wiring lives in Panel.ts
 * (untestable here because the base class pulls Vite `?worker` imports); this
 * covers the branch that decides how a stalled spinner resolves.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { decideStalledResolution } from '../panel-loading-budget.ts';

test('a keyless source that never responded resolves to unreachable', () => {
  assert.equal(
    decideStalledResolution({ hasPendingContent: false, requiresFeature: false, featureAvailable: true }),
    'unreachable',
  );
});

test('a keyed source with the key missing resolves to waiting-on-key (not "unreachable")', () => {
  assert.equal(
    decideStalledResolution({ hasPendingContent: false, requiresFeature: true, featureAvailable: false }),
    'waiting-on-key',
  );
});

test('a keyed source whose key IS present but still stalled resolves to unreachable', () => {
  assert.equal(
    decideStalledResolution({ hasPendingContent: false, requiresFeature: true, featureAvailable: true }),
    'unreachable',
  );
});

test('data pending (deferred by the off-screen gate) is not a stall — do not resolve', () => {
  assert.equal(
    decideStalledResolution({ hasPendingContent: true, requiresFeature: false, featureAvailable: true }),
    null,
  );
  // Pending content wins even for a keyed source with a missing key.
  assert.equal(
    decideStalledResolution({ hasPendingContent: true, requiresFeature: true, featureAvailable: false }),
    null,
  );
});

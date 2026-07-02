import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRunConsolidation, CONSOLIDATION_INTERVAL_MS } from '../consolidation-cadence.ts';

test('runs when never run', () => assert.equal(shouldRunConsolidation(null, 0), true));
test('waits within interval', () => assert.equal(shouldRunConsolidation(1_000_000, 1_060_000), false));
test('runs after interval', () => assert.equal(shouldRunConsolidation(0, CONSOLIDATION_INTERVAL_MS + 1), true));

import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixedSuite } from './helpers/mcp-suite-entry.mjs';

test('MCP companion suite executes its isolated inner tests with a genuine clean TAP result', { timeout: 180_000 }, async (t) => {
  const results = await runFixedSuite('companion', t);
  assert.equal(results.length, 1);
});

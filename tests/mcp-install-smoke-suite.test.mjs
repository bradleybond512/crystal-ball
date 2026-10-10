import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixedSuite } from './helpers/mcp-suite-entry.mjs';

test('MCP installed smoke executes the genuine isolated offline installer and installed-child tests', { timeout: 180_000 }, async (t) => {
  const results = await runFixedSuite('install-smoke', t);
  assert.equal(results.length, 1);
});

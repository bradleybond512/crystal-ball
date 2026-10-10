import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixedSuite } from './helpers/mcp-suite-entry.mjs';

test('MCP untrusted suite executes both isolated inner stages with genuine clean TAP results', { timeout: 330_000 }, async (t) => {
  const results = await runFixedSuite('untrusted', t);
  assert.equal(results.length, 2);
});

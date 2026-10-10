import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { sourceFixture } from '../../../tests/helpers/mcp-runtime-fixture.mjs';
import { TOOL_CATALOG } from '../tool-registry.mjs';

const READ_ONLY_TOOL_COUNT = Object.values(TOOL_CATALOG)
  .filter((metadata) => metadata.annotations.readOnlyHint === true).length;

function startClient(t, profile) {
  const fixture = sourceFixture({ packageOnly: true });
  t.after(() => fixture.cleanup());
  const client = new Client({ name: 'crystalball-test', version: '1.0.0' });
  const env = { ...fixture.env };
  if (profile) env.CRYSTALBALL_MCP_PROFILE = profile;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', join(fixture.repo, 'tests/helpers/loopback-only.mjs'), join(fixture.serverRoot, 'index.mjs')],
    cwd: fixture.repo, env, stderr: 'pipe',
  });
  return { client, transport };
}

test('stdio server defaults to the read-only profile', async (t) => {
  const { client, transport } = startClient(t, undefined);
  try {
    await client.connect(transport);
    const listed = await client.listTools();

    assert.equal(READ_ONLY_TOOL_COUNT, 53);
    assert.equal(listed.tools.length, READ_ONLY_TOOL_COUNT);
    for (const tool of listed.tools) assert.equal(tool.annotations.readOnlyHint, true, tool.name);
    assert.equal(listed.tools.some((tool) => tool.name === 'generate_weekly_evaluation_report'), false);
  } finally {
    await client.close();
  }
});

test('stdio server exposes the canonical registry with annotations and structured results', async (t) => {
  const { client, transport } = startClient(t, 'analyst');

  try {
    await client.connect(transport);
    const listed = await client.listTools();

    assert.equal(listed.tools.length, 61);
    for (const tool of listed.tools) {
      assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', tool.name);
      assert.ok(tool.outputSchema.properties.result, tool.name);
    }

    for (const name of ['submit_hypothesis_feedback', 'dismiss_hypothesis']) {
      const tool = listed.tools.find((item) => item.name === name);
      assert.match(tool.description, /pending/i);
      assert.match(tool.description, /Confirm.*Analyst HUD/i);
    }
    const help = await client.callTool({ name: 'help', arguments: {} });
    assert.ok(help.structuredContent.result.data.categories.Analyst);
    assert.match(help.content[0].text, /Crystal Ball MCP Tools/);
    for (const name of ['submit_hypothesis_feedback', 'dismiss_hypothesis']) {
      const page = await client.callTool({ name: 'help', arguments: { tool: name } });
      assert.match(page.structuredContent.result.data.description, /pending/i);
      assert.match(page.structuredContent.result.data.description, /Confirm.*Analyst HUD/i);
    }

    const weekly = listed.tools.find((tool) => tool.name === 'get_weekly_evaluation_report');
    const generate = listed.tools.find((tool) => tool.name === 'generate_weekly_evaluation_report');
    assert.equal(weekly.annotations.readOnlyHint, true);
    assert.equal(weekly.annotations.openWorldHint, false);
    assert.equal(generate.annotations.readOnlyHint, false);
    assert.equal(generate.annotations.openWorldHint, false);
    assert.equal(generate.annotations.idempotentHint, true);
  } finally {
    await client.close();
  }
});

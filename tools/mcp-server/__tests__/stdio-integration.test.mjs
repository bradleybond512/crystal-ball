import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { TOOL_CATALOG } from '../tool-registry.mjs';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const READ_ONLY_TOOL_COUNT = Object.values(TOOL_CATALOG)
  .filter((metadata) => metadata.annotations.readOnlyHint === true).length;

function startClient(profile) {
  const client = new Client({ name: 'crystalball-test', version: '1.0.0' });
  const installedExecutable = process.env.CRYSTALBALL_MCP_EXECUTABLE;
  const env = { ...process.env };
  delete env.CRYSTALBALL_MCP_PROFILE;
  if (profile) env.CRYSTALBALL_MCP_PROFILE = profile;
  const transport = new StdioClientTransport({
    command: installedExecutable || process.execPath,
    args: installedExecutable ? [] : [join(serverRoot, 'index.mjs')],
    env,
    stderr: 'pipe',
  });
  return { client, transport };
}

test('stdio server defaults to the read-only profile', async () => {
  const { client, transport } = startClient(undefined);
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

test('stdio server exposes the canonical registry with annotations and structured results', async () => {
  const { client, transport } = startClient('analyst');

  try {
    await client.connect(transport);
    const listed = await client.listTools();

    assert.equal(listed.tools.length, 61);
    for (const tool of listed.tools) {
      assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', tool.name);
      assert.ok(tool.outputSchema.properties.result, tool.name);
    }

    const help = await client.callTool({ name: 'help', arguments: {} });
    assert.ok(help.structuredContent.result.data.categories.Analyst);
    assert.match(help.content[0].text, /Crystal Ball MCP Tools/);

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

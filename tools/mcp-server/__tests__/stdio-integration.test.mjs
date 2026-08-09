import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('stdio server exposes the canonical registry with annotations and structured results', async () => {
  const client = new Client({ name: 'crystalball-test', version: '1.0.0' });
  const installedExecutable = process.env.CRYSTALBALL_MCP_EXECUTABLE;
  const transport = new StdioClientTransport({
    command: installedExecutable || process.execPath,
    args: installedExecutable ? [] : [join(serverRoot, 'index.mjs')],
    stderr: 'pipe',
  });

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

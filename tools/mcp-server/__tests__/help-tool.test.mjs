import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHelpTools } from '../tools/help.mjs';

describe('help tool', () => {
  const { help } = makeHelpTools();

  test('no args returns tool index', async () => {
    const result = await help({});
    assert.ok(result.data.categories);
    assert.ok(Object.keys(result.data.categories).length > 0);
  });

  test('tool param returns man page', async () => {
    const result = await help({ tool: 'query_raw' });
    assert.ok(result.data.name);
    assert.ok(result.data.synopsis);
    assert.ok(result.data.description);
    assert.ok(result.data.examples);
  });

  test('topic param returns conceptual guide', async () => {
    const result = await help({ topic: 'getting-started' });
    assert.ok(result.data.title);
    assert.ok(result.data.content);
  });

  test('examples param returns cookbook', async () => {
    const result = await help({ examples: 'cross-domain' });
    assert.ok(result.data.title);
    assert.ok(Array.isArray(result.data.examples));
  });

  test('unknown tool returns helpful error', async () => {
    const result = await help({ tool: 'nonexistent' });
    assert.ok(result.warnings.length > 0);
  });
});

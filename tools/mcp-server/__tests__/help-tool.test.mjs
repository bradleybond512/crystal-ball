import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHelpTools } from '../tools/help.mjs';

describe('help tool', () => {
  const { help } = makeHelpTools();

  test('no args returns tool index', async () => {
    const result = await help({});
    assert.ok(result.data.categories);
    assert.ok(Object.keys(result.data.categories).length > 0);
    assert.equal(
      result.data.categories.Diagnostics.tools.diagnose_runtime,
      'Ranked live runtime findings with optional deep route probes.',
    );
  });

  test('tool param returns man page', async () => {
    const result = await help({ tool: 'query_raw' });
    assert.ok(result.data.name);
    assert.ok(result.data.synopsis);
    assert.ok(result.data.description);
    assert.ok(result.data.examples);
  });

  test('diagnostics tools have agent-ready man pages', async () => {
    const result = await help({ tool: 'get_algorithm_diagnostics' });
    assert.equal(result.data.name, 'get_algorithm_diagnostics');
    assert.match(result.data.description, /tuning/i);
    assert.ok(result.data.examples.length > 0);
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

// Each loader is imported from current packaged bytes in its own disposable copy.
import { readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceFixture } from '../../../tests/helpers/mcp-runtime-fixture.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const OUTSIDE_MARKER = 'OUTSIDE_HELP_JSON_MUST_NEVER_BE_TRUSTED';
async function copiedHelp(t, modify = () => {}) {
  const fixture = sourceFixture({ packageOnly: true });
  t.after(() => fixture.cleanup());
  modify(fixture);
  const { makeHelpTools } = await import(pathToFileURL(join(fixture.serverRoot, 'tools/help.mjs')).href);
  return { ...fixture, help: makeHelpTools().help };
}

test('copied actual help preserves all 14 detailed pages, six topics, four examples and precedence', async (t) => {
  const { serverRoot, help } = await copiedHelp(t);
  const index = await help({});
  assert.equal(Object.keys(index.data.categories).length, 9);
  const pages = readdirSync(join(serverRoot, 'docs/tools')).filter((name) => name.endsWith('.json'));
  assert.equal(pages.length, 14);
  for (const file of pages) {
    const name = file.slice(0, -5);
    assert.deepEqual((await help({ tool: name })).data, JSON.parse(readFileSync(join(serverRoot, 'docs/tools', file), 'utf8')), name);
  }
  assert.equal(index.data.topics.length, 6);
  assert.equal(index.data.examples.length, 4);
  for (const topic of index.data.topics) assert.deepEqual((await help({ topic })).data, JSON.parse(readFileSync(join(serverRoot, 'docs/topics', `${topic}.json`), 'utf8')), topic);
  for (const examples of index.data.examples) assert.deepEqual((await help({ examples })).data, JSON.parse(readFileSync(join(serverRoot, 'docs/examples', `${examples}.json`), 'utf8')), examples);
  assert.equal((await help({ tool: 'query_raw', topic: 'getting-started', examples: 'cross-domain' })).data.name, 'query_raw');
  assert.ok((await help({ tool: '', topic: 'getting-started', examples: 'cross-domain' })).data.content);
  assert.ok((await help({ tool: '', topic: '', examples: 'cross-domain' })).data.examples);
  const fallback = await help({ tool: 'get_analyst_hypotheses' });
  assert.equal(fallback.data.name, 'get_analyst_hypotheses');
  assert.equal(fallback.warnings.length, 1);
});

test('actual help rejects unknown, prototype, traversal and uncataloged resources before trust', async (t) => {
  const { help, root } = await copiedHelp(t, ({ serverRoot, root }) => {
    for (const category of ['tools', 'topics', 'examples']) writeFileSync(join(serverRoot, 'docs', category, 'uncataloged.json'), JSON.stringify({ marker: OUTSIDE_MARKER }));
    writeFileSync(join(root, 'outside.json'), JSON.stringify({ marker: OUTSIDE_MARKER }));
  });
  for (const field of ['tool', 'topic', 'examples']) {
    for (const value of ['unknown', 'uncataloged', 'constructor', '__proto__', 'toString', '../uncataloged', '../../outside', join(root, 'outside'), '..\\outside', 'query_raw\0', '%2e%2e%2foutside', 'query_raw.json']) {
      const result = await help({ [field]: value });
      assert.deepEqual(result.data, {}, `${field}:${value}`);
      assert.ok(result.warnings.length, `${field}:${value}`);
      assert.equal(JSON.stringify(result).includes(OUTSIDE_MARKER), false);
    }
  }
});

test('missing and malformed admitted pages retain metadata fallback and topic warnings', async (t) => {
  const { help } = await copiedHelp(t, ({ serverRoot }) => {
    rmSync(join(serverRoot, 'docs/tools/query_raw.json'));
    writeFileSync(join(serverRoot, 'docs/tools/correlate.json'), '{malformed');
    writeFileSync(join(serverRoot, 'docs/topics/getting-started.json'), '{malformed');
  });
  for (const tool of ['query_raw', 'correlate']) {
    const result = await help({ tool });
    assert.equal(result.data.name, tool);
    assert.ok(result.data.annotations);
    assert.equal(result.warnings.length, 1);
  }
  assert.deepEqual((await help({ topic: 'getting-started' })).data, {});
});

for (const redirect of ['file', 'category', 'docs']) {
  test(`actual help denies an admitted ${redirect} symlink to outside fixture JSON`, async (t) => {
    const { help } = await copiedHelp(t, ({ serverRoot, root }) => {
      const outside = join(root, 'outside.json');
      writeFileSync(outside, JSON.stringify({ marker: OUTSIDE_MARKER }));
      if (redirect === 'file') {
        rmSync(join(serverRoot, 'docs/tools/query_raw.json'));
        symlinkSync(outside, join(serverRoot, 'docs/tools/query_raw.json'));
      } else {
        const target = redirect === 'docs' ? join(serverRoot, 'docs') : join(serverRoot, 'docs/tools');
        const moved = join(root, 'redirected');
        renameSync(target, moved);
        writeFileSync(join(moved, redirect === 'docs' ? 'tools/query_raw.json' : 'query_raw.json'), JSON.stringify({ marker: OUTSIDE_MARKER }));
        symlinkSync(moved, target, 'dir');
      }
    });
    const result = await help({ tool: 'query_raw' });
    assert.equal(result.data.name, 'query_raw');
    assert.ok(result.warnings.length);
    assert.equal(JSON.stringify(result).includes(OUTSIDE_MARKER), false);
  });
}

test('actual packaged help permits a legitimate installed package ancestor symlink', async (t) => {
  const fixture = sourceFixture({ packageOnly: true });
  t.after(() => fixture.cleanup());
  const linked = join(fixture.root, 'installed-package');
  symlinkSync(fixture.serverRoot, linked, 'dir');
  const { makeHelpTools } = await import(pathToFileURL(join(linked, 'tools/help.mjs')).href);
  assert.equal((await makeHelpTools().help({ tool: 'query_raw' })).data.name, 'query_raw');
});

test('real index stdio help stays ordinary and excludes outside JSON from text and structured output', async (t) => {
  const fixture = await copiedHelp(t, ({ serverRoot, root }) => {
    const outside = join(root, 'outside.json');
    writeFileSync(outside, JSON.stringify({ marker: OUTSIDE_MARKER }));
    rmSync(join(serverRoot, 'docs/tools/query_raw.json'));
    symlinkSync(outside, join(serverRoot, 'docs/tools/query_raw.json'));
    writeFileSync(join(serverRoot, 'docs/topics/uncataloged.json'), JSON.stringify({ marker: OUTSIDE_MARKER }));
  });
  const client = new Client({ name: 'help-provenance-test', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', join(fixture.repo, 'tests/helpers/loopback-only.mjs'), join(fixture.serverRoot, 'index.mjs')], cwd: fixture.repo, env: fixture.env, stderr: 'pipe' }));
    for (const args of [{}, { tool: 'query_raw' }, { topic: 'uncataloged' }, { tool: '../../outside' }]) {
      const result = await client.callTool({ name: 'help', arguments: args });
      assert.equal(result.isError, undefined);
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent.result);
      assert.equal(result.structuredContent.result.notice, undefined);
      assert.equal(result.structuredContent.result.untrusted_external_data, undefined);
      assert.equal(JSON.stringify(result).includes(OUTSIDE_MARKER), false);
      assert.deepEqual(Object.keys(result.structuredContent.result), ['summary', 'data', 'sources', 'warnings', 'timestamp', 'healthy']);
    }
  } finally { await client.close(); }
});

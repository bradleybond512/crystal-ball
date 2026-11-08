import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = new URL('../', import.meta.url);
const contractURL = new URL('../.github/tools/filesystem-mcp/launch-contract.mjs', import.meta.url);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Contract imports are deliberately inside tests. An absent implementation is
// setup failure, NOT a qualified behavioral red or a passing security test.
const contract = () => import(contractURL.href);
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'cb-filesystem-contract-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('filesystem template removes floating installation and preserves one explicit workspace', () => {
  const { filesystem } = JSON.parse(readFileSync(new URL('.github/mcp.json', repo), 'utf8')).mcpServers;
  assert.equal(filesystem.command, 'node');
  assert.deepEqual(filesystem.args, ['${workspaceFolder}/.github/tools/filesystem-mcp/launch.mjs', '${workspaceFolder}']);
  assert.equal(filesystem.type, 'stdio');
  assert.equal(filesystem.env, undefined);
  const pkg = JSON.parse(readFileSync(new URL('package.json', repo), 'utf8'));
  assert.equal(pkg.scripts['test:filesystem-mcp-launch'],
    'node --test tests/filesystem-mcp-launch-contract.test.mjs tests/filesystem-mcp-launch-runtime.test.mjs tests/filesystem-mcp-child-lifecycle.test.mjs tests/filesystem-mcp-child-error.test.mjs');
});

test('workspace validation rejects ambiguous arguments and returns only the canonical supplied directory', async (t) => {
  const { validateWorkspace } = await contract();
  const root = fixture(t), workspace = path.join(root, 'workspace 雪 "quotes"');
  mkdirSync(workspace);
  const alias = path.join(root, 'alias'); symlinkSync(workspace, alias);
  assert.equal(validateWorkspace([alias]), realpathSync(workspace));
  for (const argv of [[], [''], ['relative'], ['${workspaceFolder}'], [workspace, root], [path.join(root, 'absent')]]) {
    assert.throws(() => validateWorkspace(argv), /workspace|argument|placeholder|directory/i);
  }
  writeFileSync(path.join(root, 'file'), 'not a directory');
  assert.throws(() => validateWorkspace([path.join(root, 'file')]), /directory/i);
});

test('fixed tool storage ignores environment relocation and rejects unsupported runtime platforms', async (t) => {
  const { fixedToolRoot } = await contract();
  const home = fixture(t), contentSha256 = 'a'.repeat(64);
  const request = { home, platform: 'darwin', arch: 'arm64', contentSha256 };
  const expected = path.join(home, '.local/share/crystalball/tools/filesystem-mcp/2.2.0-node24.22.2/darwin-arm64', contentSha256);
  assert.equal(fixedToolRoot(request), expected);
  assert.equal(fixedToolRoot({ ...request, env: { XDG_DATA_HOME: '/untrusted', CRYSTALBALL_FILESYSTEM_MCP_HOME: '/untrusted' } }), expected);
  for (const change of [{ home: '' }, { home: 'relative' }, { home: '/' }, { platform: 'linux' }, { arch: 'x64' }, { contentSha256: '../escape' }]) {
    assert.throws(() => fixedToolRoot({ ...request, ...change }));
  }
});

test('spawn specification uses only verified Node and confined workspace with minimal non-injectable environment', async (t) => {
  const { buildSpawnSpec } = await contract();
  const root = fixture(t), workspace = path.join(root, 'workspace ; echo never'); mkdirSync(workspace);
  const runtime = path.join(root, 'runtime/bin/node'), server = path.join(root, 'server/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js');
  const spec = buildSpawnSpec({ runtime, server, workspace: realpathSync(workspace), env: {
    LANG: 'en_US.UTF-8', LC_ALL: 'C', TMPDIR: root,
    NODE_OPTIONS: '--require=/untrusted', NODE_PATH: '/untrusted', PATH: '/untrusted', HOME: '/untrusted',
    NPM_CONFIG_USERCONFIG: '/untrusted', GITHUB_PERSONAL_ACCESS_TOKEN: 'synthetic-not-a-secret',
    ANTHROPIC_API_KEY: 'synthetic-not-a-secret', CRYSTALBALL_FILESYSTEM_MCP_HOME: '/untrusted',
  } });
  assert.equal(spec.command, runtime);
  assert.deepEqual(spec.args, [server, '--confine-roots', '--', realpathSync(workspace)]);
  assert.equal(spec.options.shell, false);
  assert.equal(spec.options.detached, false);
  assert.deepEqual(spec.options.stdio, ['inherit', 'inherit', 'inherit']);
  assert.deepEqual(spec.options.env, { LANG: 'en_US.UTF-8', LC_ALL: 'C', TMPDIR: root });
  assert.deepEqual(buildSpawnSpec({ runtime, server, workspace, env: {} }).options.env, {});
  for (const env of [{ LANG: 1 }, { LC_ALL: 'C\0injection' }, { TMPDIR: null }]) {
    assert.throws(() => buildSpawnSpec({ runtime, server, workspace, env }));
  }
  for (const bad of ['node', '${runtime}/node', '']) {
    assert.throws(() => buildSpawnSpec({ runtime: bad, server, workspace, env: {} }));
  }
});

test('content verification detects changed missing extra and escaping installed bytes without executing them', async (t) => {
  const { verifyContent } = await contract();
  const root = fixture(t), bytes = 'fixture data only, never executable';
  mkdirSync(path.join(root, 'runtime/bin'), { recursive: true });
  const member = 'runtime/bin/node', file = path.join(root, member);
  writeFileSync(file, bytes);
  const manifest = { schemaVersion: 1, files: [{ path: member, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) }], symlinks: [] };
  assert.doesNotThrow(() => verifyContent(root, manifest));
  const identity = manifest.files[0];
  for (const malformed of [null, [], {}, { ...manifest, schemaVersion: 2 },
    { ...manifest, extra: true }, { ...manifest, files: [] },
    { ...manifest, files: [identity, identity] },
    { ...manifest, files: [{ ...identity, bytes: -1 }] },
    { ...manifest, files: [{ ...identity, sha256: 'A'.repeat(64) }] },
    { ...manifest, files: [{ ...identity, path: 'runtime//bin/node' }] },
    { ...manifest, symlinks: [{ path: identity.path, target: 'other' }] },
    { ...manifest, symlinks: [{ path: 'alias', target: '../escape' }] },
    { ...manifest, symlinks: [{ path: 'alias', target: '/escape' }] },
    { ...manifest, symlinks: [{ path: 'alias', target: identity.path }, { path: 'alias', target: identity.path }] },
  ]) assert.throws(() => verifyContent(root, malformed));
  mkdirSync(path.join(root, 'empty-extra')); assert.throws(() => verifyContent(root, manifest));
  rmSync(path.join(root, 'empty-extra'), { recursive: true });
  const link = path.join(root, 'alias'), linked = { ...manifest, symlinks: [{ path: 'alias', target: identity.path }] };
  symlinkSync(identity.path, link); assert.doesNotThrow(() => verifyContent(root, linked));
  rmSync(link); symlinkSync('missing', link); assert.throws(() => verifyContent(root, linked));
  assert.throws(() => verifyContent(root, { ...linked, symlinks: [{ path: 'alias', target: 'missing' }] }));
  rmSync(link);
  writeFileSync(file, bytes + 'tamper'); assert.throws(() => verifyContent(root, manifest));
  writeFileSync(file, 'X' + bytes.slice(1)); assert.throws(() => verifyContent(root, manifest));
  writeFileSync(file, bytes); writeFileSync(path.join(root, 'unexpected.js'), 'throw new Error("must never run")');
  assert.throws(() => verifyContent(root, manifest)); rmSync(path.join(root, 'unexpected.js'));
  rmSync(file); assert.throws(() => verifyContent(root, manifest));
  symlinkSync('/outside-owned-fixture', file); assert.throws(() => verifyContent(root, manifest));
  assert.throws(() => verifyContent(root, { ...manifest, files: [{ ...manifest.files[0], path: '../escape' }] }));
});

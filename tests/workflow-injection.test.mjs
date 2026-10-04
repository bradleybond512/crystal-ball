// Q20 (R4-LOW-002, R4-LOW-003): workflow expressions never reach script text,
// the zizmor audit stays wired and pinned, and agent MCP servers are pinned.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

/** Lines of every `run: |` / `script: |` block scalar in a workflow. */
function scriptBlocks(yaml) {
  const lines = yaml.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(?:- )?(?:run|script):\s*[|>]-?\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() !== '' && line.search(/\S/) <= indent) break;
      body.push({ line: j + 1, text: line });
    }
    blocks.push(body);
  }
  return blocks;
}

const HARDENED = [
  '.github/workflows/auto-merge-agent-branches.yml',
  '.github/workflows/lint.yml',
];

test('hardened workflows never paste ${{ }} expressions into script text', () => {
  for (const file of HARDENED) {
    for (const block of scriptBlocks(read(file))) {
      for (const { line, text } of block) {
        assert.equal(text.includes('${{'), false, `${file}:${line} expands an expression inside a script`);
      }
    }
  }
});

test('build-desktop resolves the release ref through env', () => {
  const wf = read('.github/workflows/build-desktop.yml');
  const start = wf.indexOf('- name: Resolve release context');
  const step = wf.slice(start, wf.indexOf('\n\n', start));
  assert.match(step, /RELEASE_REF: \$\{\{ inputs\.release_tag \|\| github\.ref_name \}\}/);
  for (const block of scriptBlocks(step)) {
    for (const { text } of block) assert.equal(text.includes('${{'), false, text);
  }
});

test('the PAT value never enters a script, only whether it exists', () => {
  const wf = read('.github/workflows/auto-merge-agent-branches.yml');
  assert.match(wf, /HAS_PAT: \$\{\{ secrets\.AUTO_MERGE_PAT != '' \}\}/);
  assert.equal(wf.includes("Boolean('${{ secrets.AUTO_MERGE_PAT }}')"), false);
});

test('zizmor runs in CI, pinned by version and hash, failing on high findings', () => {
  const wf = read('.github/workflows/actionlint.yml');
  assert.match(wf, /pip" install --require-hashes --only-binary=:all: -r \.github\/tools\/zizmor\/requirements\.txt/);
  assert.match(wf, /zizmor" --offline --min-severity high --format github \.github\/workflows/);
  const req = read('.github/tools/zizmor/requirements.txt');
  assert.match(req, /^zizmor==\d+\.\d+\.\d+ \\$/m);
  assert.ok((req.match(/--hash=sha256:[0-9a-f]{64}/g) ?? []).length >= 4, 'hashes for every platform wheel');
});

test('agent MCP servers are pinned to exact versions or digests', () => {
  const { mcpServers } = JSON.parse(read('.github/mcp.json'));
  assert.match(mcpServers.github.args.at(-1), /^ghcr\.io\/github\/github-mcp-server@sha256:[0-9a-f]{64}$/);
  assert.ok(mcpServers.filesystem.args.some((a) => /^@modelcontextprotocol\/server-filesystem@\d+\.\d+\.\d+$/.test(a)));
  assert.deepEqual(mcpServers.fetch.args, [mcpServers.fetch.args[0]]);
  assert.match(mcpServers.fetch.args[0], /^mcp-server-fetch==\d+\.\d+\.\d+$/);
});

test('Pages write and OIDC permissions are granted only to the deploy job', () => {
  const wf = read('.github/workflows/pages.yml');
  const top = wf.slice(wf.indexOf('\npermissions:'), wf.indexOf('\njobs:'));
  assert.match(top, /contents: read/);
  assert.doesNotMatch(top, /pages: write|id-token: write/);
  const deploy = wf.slice(wf.indexOf('\n  deploy:'));
  assert.match(deploy, /permissions:\n {6}pages: write\n {6}id-token: write/);
});

test('release builds restore no package or Rust cache', () => {
  const wf = read('.github/workflows/build-desktop.yml');
  const setups = wf.split('uses: actions/setup-node@').slice(1).map((s) => s.slice(0, 400));
  assert.ok(setups.length >= 3);
  for (const s of setups) {
    assert.match(s, /package-manager-cache: false/);
    assert.doesNotMatch(s.split('\n\n')[0], /cache: 'npm'/);
  }
  const rust = wf.slice(wf.indexOf('- name: Rust cache'), wf.indexOf('- name: Rust cache') + 200);
  assert.match(rust, /if: needs\.release-context\.outputs\.publish != 'true'/);
});

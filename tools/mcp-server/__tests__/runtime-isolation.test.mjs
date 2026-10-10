import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync, chmodSync, readFileSync, realpathSync, readdirSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceFixture, npmCli } from '../../../tests/helpers/mcp-runtime-fixture.mjs';
import { lockedTarballs, prepareLockedCache, verifyLockedCache } from '../../../tests/helpers/mcp-locked-cache.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('actual child isolation ignores poisoned inherited executable, monitor, token, paths and provider controls', async (t) => {
  const poison = sourceFixture({ packageOnly: true });
  t.after(() => poison.cleanup());
  const marker = join(poison.root, 'inherited-executable-ran');
  const executable = join(poison.root, 'poison-executable');
  writeFileSync(executable, `#!/bin/sh\n/bin/echo poison > '${marker}'\n`);
  chmodSync(executable, 0o700);
  const poisoned = {
    HOME: poison.env.HOME, CRYSTALBALL_MCP_EXECUTABLE: executable, CRYSTALBALL_MCP_PROFILE: 'analyst',
    CRYSTALBALL_MCP_MONITOR_INTERVAL_MINUTES: '1', LOCAL_API_TOKEN: 'poison-token',
    LOCAL_API_DATA_DIR: poison.root, LOCAL_API_RESOURCE_DIR: poison.root, LOCAL_API_PORT_FILE: marker,
    LOCAL_API_CLOUD_FALLBACK: 'true', GROQ_API_KEY: 'poison-provider', AISSTREAM_API_KEY: 'poison-provider',
    S2U_XMPP_JID: 'poison@invalid.test', S2U_XMPP_SECRET: 'poison-provider',
    NODE_OPTIONS: `--import=${executable}`, HTTPS_PROXY: 'http://127.0.0.1:1',
  };
  writeFileSync(join(poison.repo, '.env.local'), 'AISSTREAM_API_KEY=ignored-fixture-poison\n');
  const { sourceFixture: copyPoisonedSource } = await import(pathToFileURL(join(poison.repo, 'tests/helpers/mcp-runtime-fixture.mjs')).href);
  const saved = Object.fromEntries(Object.keys(poisoned).map((key) => [key, process.env[key]]));
  let fixture;
  try {
    Object.assign(process.env, poisoned);
    fixture = copyPoisonedSource({ packageOnly: true });
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  t.after(() => fixture.cleanup());
  assert.equal(existsSync(join(fixture.repo, '.git')), false);
  assert.equal(existsSync(join(fixture.repo, '.env.local')), false);
  assert.equal(existsSync(join(fixture.env.HOME, '.config/crystalball/sms-config.json')), false);
  const probe = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({env:process.env,cwd:process.cwd()}))'], { cwd: fixture.repo, env: fixture.env, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const actual = JSON.parse(probe.stdout);
  assert.equal(realpathSync(actual.cwd), realpathSync(fixture.repo));
  assert.equal(actual.env.HOME, fixture.env.HOME);
  assert.equal(actual.env.LOCAL_API_TOKEN, 'fixture-only-sidecar-token');
  assert.equal(actual.env.CRYSTALBALL_MCP_MONITOR_INTERVAL_MINUTES, '0');
  for (const key of ['NODE_OPTIONS', 'HTTPS_PROXY', 'GROQ_API_KEY', 'AISSTREAM_API_KEY', 'S2U_XMPP_JID', 'S2U_XMPP_SECRET', 'CRYSTALBALL_MCP_EXECUTABLE', 'CRYSTALBALL_MCP_PROFILE']) assert.equal(actual.env[key], undefined, key);
  assert.equal(readFileSync(actual.env.npm_config_userconfig, 'utf8'), '');
  assert.equal(readFileSync(actual.env.npm_config_globalconfig, 'utf8'), '');
  const client = new Client({ name: 'isolation-oracle', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', join(fixture.repo, 'tests/helpers/loopback-only.mjs'), join(fixture.serverRoot, 'index.mjs')], cwd: fixture.repo, env: fixture.env, stderr: 'pipe' }));
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 53, 'poisoned profile is not inherited');
    assert.ok(listed.tools.every((tool) => tool.annotations.readOnlyHint === true));
    const help = await client.callTool({ name: 'help', arguments: {} });
    assert.ok(help.structuredContent.result.data.categories);
  } finally { await client.close(); }
  assert.equal(existsSync(marker), false, 'poisoned executable and port file never run or write');
  assert.deepEqual(readdirSync(join(fixture.root, 'data')), []);
});

test('the actual preload fails unexpected provider and unrelated local-service fetches', (t) => {
  const fixture = sourceFixture({ packageOnly: true });
  t.after(() => fixture.cleanup());
  for (const url of ['https://provider.invalid.test/data', 'http://127.0.0.1:11434/api/tags']) {
    const probe = spawnSync(process.execPath, ['--import', join(fixture.repo, 'tests/helpers/loopback-only.mjs'), '-e', `void (async () => { try { await fetch(${JSON.stringify(url)}); } catch {} })();`], { cwd: fixture.repo, env: fixture.env, encoding: 'utf8' });
    assert.equal(probe.status, 1, 'unexpected attempts cannot silently pass after callers catch errors');
    assert.match(probe.stderr, /Unexpected real network attempt|ISOLATION VIOLATIONS/);
  }
});

test('the owned node PATH shim guards npm-style shell descendants without NODE_OPTIONS', (t) => {
  const fixture = sourceFixture({ packageOnly: true }); t.after(() => fixture.cleanup());
  const script = join(fixture.root, 'shell-descendant.mjs');
  writeFileSync(script, 'try { await fetch("https://provider.invalid.test/shell-descendant"); } catch {}\n');
  const probe = spawnSync('/bin/sh', ['-c', 'node "$1"', 'fixture-shell', script], {
    cwd: fixture.repo, env: fixture.env, encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(fixture.env.NODE_OPTIONS, undefined);
  assert.equal(probe.status, 1, 'the actual shell-launched node cannot swallow a forbidden fetch');
  assert.match(probe.stderr, /ISOLATION VIOLATIONS/);
});

test('ordinary fixtures keep an empty cache and propagate only the selected tarball source through fake HOME', (t) => {
  const fixture = sourceFixture({ packageOnly: true }); t.after(() => fixture.cleanup());
  assert.deepEqual(readdirSync(fixture.env.npm_config_cache), [], 'no whole cache or resource preparation in ordinary suites');
  assert.equal(fixture.env.CB_TEST_NPM_CACHE, undefined, 'the destination is never mislabeled as admission authority');
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `import { sourceFixture } from './tests/helpers/mcp-runtime-fixture.mjs'; const f=sourceFixture({packageOnly:true}); try { console.log(JSON.stringify({source:f.env.CB_TEST_MCP_TARBALL_SOURCE,home:f.env.HOME,cache:f.env.npm_config_cache})); } finally { f.cleanup(); }`], { cwd: fixture.repo, env: fixture.env, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const nested = JSON.parse(probe.stdout);
  assert.equal(nested.source, fixture.env.CB_TEST_MCP_TARBALL_SOURCE);
  assert.notEqual(nested.home, fixture.env.HOME);
  assert.notEqual(nested.cache, fixture.env.npm_config_cache);
});

test('installed alias descendants receive the explicit owned guard even when SDK-like child env drops test variables', (t) => {
  const fixture = sourceFixture({ packageOnly: true }); t.after(() => fixture.cleanup());
  const prefix = join(fixture.root, 'prefix'); const installed = join(prefix, 'lib/node_modules/crystalball-mcp'); const bin = join(prefix, 'bin');
  mkdirSync(installed, { recursive: true }); mkdirSync(bin, { recursive: true });
  writeFileSync(join(installed, 'index.mjs'), 'try { await fetch("https://provider.invalid.test/descendant"); } catch {}\n');
  symlinkSync('../lib/node_modules/crystalball-mcp/index.mjs', join(bin, 'crystalball-mcp'));
  writeFileSync(join(installed, 'cli.mjs'), `import {spawnSync} from 'node:child_process'; const r=spawnSync(${JSON.stringify(join(bin, 'crystalball-mcp'))}, [], {encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME}}); console.error(r.stderr); process.exitCode=r.status ?? 99;`);
  symlinkSync('../lib/node_modules/crystalball-mcp/cli.mjs', join(bin, 'crystalball'));
  const probe = spawnSync(process.execPath, ['--import', join(fixture.repo, 'tests/helpers/loopback-only.mjs'), join(bin, 'crystalball')], {
    cwd: fixture.repo, env: { ...fixture.env, CB_TEST_INSTALLED_ROOT: installed }, encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(probe.status, 1, 'caught forbidden fetch still fails the actual guarded alias descendant');
  assert.match(probe.stderr, /ISOLATION VIOLATIONS/);
});

test('locked cache admission filters unrelated bytes, verifies SRI and leaves its source untouched', async (t) => {
  const fixture = sourceFixture({ packageOnly: true }); t.after(() => fixture.cleanup());
  const source = join(fixture.root, 'source-cache'); const prepared = join(fixture.root, 'prepared-cache');
  mkdirSync(source); mkdirSync(prepared);
  const requireNpm = createRequire(npmCli()); const cacache = requireNpm('cacache');
  const body = Buffer.from('harmless synthetic cache-body oracle; never unpacked');
  const integrity = `sha512-${createHash('sha512').update(body).digest('base64')}`;
  const locked = { name: 'crystalball-mcp', version: '0.3.0', lockfileVersion: 3, packages: { '': { name: 'crystalball-mcp', version: '0.3.0' }, 'node_modules/fixture-package': { version: '1.0.0', resolved: 'https://registry.npmjs.org/fixture-package/-/fixture-package-1.0.0.tgz', integrity } } };
  const lockfile = join(fixture.root, 'oracle-lock.json'); writeFileSync(lockfile, JSON.stringify(locked));
  await cacache.put(join(source, '_cacache'), 'selected', body, { integrity });
  await cacache.put(join(source, '_cacache'), 'unrelated-secret-key', Buffer.from('unrelated-cache-body'));
  writeFileSync(join(source, '.npmrc'), 'unrelated config sentinel'); writeFileSync(join(source, 'unrelated.log'), 'unrelated log sentinel');
  const sourceBefore = directoryHashes(source);
  const manifest = await prepareLockedCache({ source, destination: prepared, lockfile });
  assert.equal(manifest.nodeCount, 1); assert.equal(manifest.uniqueBodyCount, 1);
  assert.deepEqual(manifest.tuples.map((entry) => entry.location), ['node_modules/fixture-package']);
  assert.deepEqual(directoryHashes(source), sourceBefore, 'admission never mutates source bytes');
  assert.equal(existsSync(join(prepared, '.npmrc')), false); assert.equal(existsSync(join(prepared, 'unrelated.log')), false);
  const admitted = await cacache.ls(join(prepared, '_cacache'));
  assert.deepEqual(Object.keys(admitted), [`locked-mcp-tarball:${integrity}`], 'only own exact-lock keys admitted');
  assert.deepEqual(await cacache.get.byDigest(join(prepared, '_cacache'), integrity), body);
  await verifyLockedCache({ destination: prepared, lockfile });
  locked.packages['node_modules/fixture-package'].resolved = 'https://other.invalid.test/p.tgz';
  assert.throws(() => lockedTarballs(locked), /Non-public locked tarball/);
});

test('locked cache admission fails missing and corrupted exact bodies without network or false manifests', async (t) => {
  const fixture = sourceFixture({ packageOnly: true }); t.after(() => fixture.cleanup());
  const source = join(fixture.root, 'missing-cache'); mkdirSync(source);
  const requireNpm = createRequire(npmCli()); const cacache = requireNpm('cacache');
  const body = Buffer.from('synthetic exact body'); const integrity = `sha512-${createHash('sha512').update(body).digest('base64')}`;
  const lockfile = join(fixture.root, 'oracle-lock.json');
  writeFileSync(lockfile, JSON.stringify({ name: 'crystalball-mcp', version: '0.3.0', lockfileVersion: 3, packages: { '': { name: 'crystalball-mcp', version: '0.3.0' }, 'node_modules/fixture-package': { version: '1.0.0', resolved: 'https://registry.npmjs.org/fixture-package/-/fixture-package-1.0.0.tgz', integrity } } }));
  for (const corrupt of [false, true]) {
    const destination = join(fixture.root, corrupt ? 'corrupt-destination' : 'missing-destination'); mkdirSync(destination);
    if (corrupt) {
      await cacache.put(join(source, '_cacache'), 'selected', body, { integrity });
      const files = Object.keys(directoryHashes(join(source, '_cacache/content-v2')));
      assert.equal(files.length, 1); writeFileSync(join(source, '_cacache/content-v2', files[0]), 'corrupt body');
    }
    await assert.rejects(prepareLockedCache({ source, destination, lockfile }), /Missing\/corrupt exact locked resource/);
    assert.equal(existsSync(join(destination, 'locked-tarballs.json')), false, 'no success manifest on absent/corrupt body');
  }
});

function directoryHashes(root) {
  const result = {};
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), name + '/');
      else result[name] = createHash('sha256').update(readFileSync(join(directory, entry.name))).digest('hex');
    }
  }
  visit(root); return result;
}

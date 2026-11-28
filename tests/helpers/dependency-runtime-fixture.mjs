import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

export const runtimeRepo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function assertHostedLinux(env = process.env, platform = process.platform) {
  if (platform !== 'linux' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('Dependency native execution requires disposable hosted Linux.');
  }
}

export function ownedRuntimeFixture(t) {
  const inherited = { ...process.env };
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cb-dependency-runtime-')));
  const home = join(root, 'home');
  const temp = join(root, 'temp');
  const control = join(root, 'cb-control');
  for (const dir of [home, temp, control]) mkdirSync(dir);
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp,
    CB_CONTROL_DIR: control, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'),
    GITHUB_ACTIONS: inherited.GITHUB_ACTIONS ?? '', RUNNER_ENVIRONMENT: inherited.RUNNER_ENVIRONMENT ?? '',
  };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  let cleaned = false;
  t.after(() => {
    if (cleaned) return;
    cleaned = true;
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, inherited);
    rmSync(root, { recursive: true, force: true });
  });
  return { root, home, env };
}

export function graphRequire(graph, repo = runtimeRepo) {
  const graphs = { scripts: 'scripts', 'cb-control': 'tools/cb-control' };
  if (!Object.hasOwn(graphs, graph)) throw new Error('Unknown runtime graph.');
  const graphPath = graphs[graph];
  const root = join(repo, graphPath);
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const require = createRequire(join(root, 'package.json'));
  return (request) => {
    const name = request.split('/')[0];
    assert.match(request, /^[a-z0-9-]+(?:\/[A-Za-z0-9_.-]+)*$/);
    assert.ok(!request.split('/').includes('..'));
    const locked = lock.packages[`node_modules/${name}`];
    assert.ok(locked?.version, 'dependency must appear in the installed graph lock');
    const packagePath = join(root, 'node_modules', name, 'package.json');
    let installed;
    try { installed = JSON.parse(readFileSync(packagePath, 'utf8')); }
    catch { throw new Error('Dependency is missing from its installed graph.'); }
    assert.equal(installed.version, locked.version, 'installed dependency must match lockfile version');
    const resolved = realpathSync(require.resolve(request));
    const expected = realpathSync(dirname(packagePath)) + sep;
    assert.ok(resolved.startsWith(expected), 'dependency resolution escaped its installed graph');
    return require(request);
  };
}

export function tapCounts(text) {
  const values = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((key) => {
    const matches = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))];
    return [key, matches.length === 1 ? Number(matches[0][1]) : NaN];
  }));
  assert.ok(Object.values(values).every(Number.isSafeInteger) && values.tests > 0
    && values.pass + values.fail === values.tests && values.cancelled === 0 && values.skipped === 0 && values.todo === 0,
  'Expected complete positive TAP execution without skipped/cancelled/todo cases.');
  return { tests: values.tests, pass: values.pass, fail: values.fail };
}

export async function websocketExchange(t, ws, response) {
  const server = new ws.WebSocketServer({ host: '127.0.0.1', port: 0 });
  let client;
  t.after(async () => {
    client?.terminate();
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolveClose) => server.close(resolveClose));
  });
  await once(server, 'listening', { signal: AbortSignal.timeout(3000) });
  const connection = once(server, 'connection', { signal: AbortSignal.timeout(3000) });
  client = new ws.WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const opened = once(client, 'open', { signal: AbortSignal.timeout(3000) });
  const [peer] = await connection;
  await opened;
  const request = once(peer, 'message', { signal: AbortSignal.timeout(3000) });
  client.send('dependency-fixture-request');
  assert.equal((await request)[0].toString(), 'dependency-fixture-request');
  const reply = once(client, 'message', { signal: AbortSignal.timeout(3000) });
  peer.send(response);
  return (await reply)[0].toString();
}

export function runtimeMutations(graph) {
  const mutations = {
    scripts: [
      { id: 'ws-response', before: "require('ws'), 'scripts-fixture-response'", after: "require('ws'), 'wrong-fixture-response'" },
      { id: 'telegram-port', before: "session.setDC(2, '127.0.0.1', 443)", after: "session.setDC(2, '127.0.0.1', 444)" },
    ],
    'cb-control': [
      { id: 'sqlite-event', before: "storage.appendEvent('runtime-fixture', 'output', { text: 'dependency constellation marker' })", after: "storage.appendEvent('runtime-fixture', 'output', { text: 'wrong fixture text' })" },
      { id: 'ws-response', before: "require('ws'), 'control-fixture-response'", after: "require('ws'), 'wrong-fixture-response'" },
      { id: 'pty-output', before: "process.stdout.write('dependency-pty-marker')", after: "process.stdout.write('wrong-pty-marker')" },
    ],
  };
  if (!Object.hasOwn(mutations, graph)) throw new Error('Unknown runtime mutation graph.');
  return mutations[graph];
}

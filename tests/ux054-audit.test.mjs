import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditLocks } from '../scripts/audit-npm-locks.mjs';

const roots = ['.', '.github/tools/codex', 'marketing-site', 'scripts', 'tools/cb-control', 'tools/mcp-server'];
const vendors = { '.': 'vendor/texture-compressor-safe', 'marketing-site': 'vendor/braces' };

function git(repo, ...args) {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, stdio: 'pipe' });
}

function put(repo, file, data) {
  const target = join(repo, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data));
}

function read(repo, file) { return JSON.parse(readFileSync(join(repo, file), 'utf8')); }

function fixture(t, edit = () => {}) {
  const repo = mkdtempSync(join(tmpdir(), 'ux054-repo-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, 'init', '--quiet');
  for (const root of roots) {
    const manifest = { name: 'project-' + roots.indexOf(root), version: '1.0.0', devDependencies: { tool: '^1.0.0' } };
    const packages = { '': manifest, 'node_modules/tool': { version: '1.1.0', resolved: 'https://registry.npmjs.org/tool/-/tool-1.1.0.tgz', dev: true } };
    if (vendors[root]) {
      const vendor = vendors[root], name = root === '.' ? 'texture-compressor' : 'braces';
      manifest.devDependencies[name] = 'file:' + vendor;
      packages['node_modules/' + name] = { link: true, resolved: vendor };
      packages[vendor] = { version: '1.0.0', name };
      put(repo, join(root, vendor, 'package.json'), { name, version: '1.0.0' });
    }
    put(repo, join(root, 'package.json'), { ...manifest, scripts: { preinstall: 'exit 42' } });
    put(repo, join(root, 'package-lock.json'), { name: manifest.name, version: manifest.version, lockfileVersion: 3, packages });
    put(repo, join(root, '.npmrc'), 'registry=https://evil.invalid/\nomit=dev\n');
  }
  put(repo, 'src-tauri/sidecar/package.json', { name: 'sidecar', version: '1.0.0', type: 'module' });
  edit(repo);
  git(repo, 'add', '--', ...roots.slice(1), 'src-tauri', 'vendor', 'package.json', 'package-lock.json', '.npmrc');
  // Include deliberately unclassified test inputs, if supplied.
  for (const file of ['new', 'npm-shrinkwrap.json', 'pnpm-lock.yaml']) if (existsSync(join(repo, file))) git(repo, 'add', '--', file);
  git(repo, 'commit', '--quiet', '-m', 'fixture');
  return repo;
}

function response(cwd, severity) {
  const count = Object.keys(read(cwd, 'package-lock.json').packages).length - 1;
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const vulnerabilities = {};
  if (severity) {
    counts[severity]++; counts.total++;
    vulnerabilities.tool = { name: 'tool', severity, via: [{name:'tool', severity, title:'test advisory'}], nodes: ['node_modules/tool'] };
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { dependencies: { total: count, dev: count, prod: 0, peer: 0, optional: 0, peerOptional: 0 }, vulnerabilities: counts } };
}

function run(repo, mock, lines = [], registryFetch = async () => Response.json({})) {
  return auditLocks(repo, mock, (line) => lines.push(line), registryFetch);
}

test('scans all six committed locks separately with isolated public-registry commands', async (t) => {
  const repo = fixture(t);
  put(repo, 'scripts/package-lock.json', 'worktree tampering');
  const calls = [];
  const lines = [];
  const ok = await run(repo, (bin, args, { cwd, env, timeout, maxBuffer }) => {
    calls.push(read(cwd, 'package.json').name);
    assert.ok(isAbsolute(bin)); assert.ok(basename(bin) === 'npm' || basename(bin) === 'node');
    assert.ok(!cwd.startsWith(repo)); assert.ok(!existsSync(join(cwd, '.npmrc')));
    for (const arg of ['audit', '--ignore-scripts', '--json', '--package-lock-only', '--audit-level=high', '--include=dev', '--include=optional', '--include=peer']) assert.ok(args.includes(arg), arg);
    assert.ok(args.some(arg => /^--registry=https:\/\/registry\.npmjs\.org\/?$/.test(arg)));
    assert.ok(env.HOME && env.HOME !== process.env.HOME && isAbsolute(env.HOME));
    assert.ok(!Object.keys(env).some(k => /token|secret|node_options|proxy|node_env/i.test(k)));
    assert.ok(timeout > 0 && maxBuffer > 0);
    const vendor = vendors[roots[Number(calls.at(-1).split('-').at(-1))]];
    if (vendor) assert.ok(existsSync(join(cwd, vendor, 'package.json')));
    return { status: 0, stdout: JSON.stringify(response(cwd, 'moderate')) };
  }, lines);
  assert.equal(ok, true, lines.join('\n'));
  assert.deepEqual(calls.sort(), roots.map((_, i) => 'project-' + i));
  assert.match(lines.join('\n'), /moderate/i);
});

test('one non-root high or critical fails without hiding later project results', async (t) => {
  const repo = fixture(t);
  for (const severity of ['high', 'critical']) {
    let calls = 0;
    const lines = [];
    assert.equal(await run(repo, (_bin, _args, { cwd }) => {
      calls++;
      const hit = read(cwd, 'package.json').name === 'project-2';
      return { status: hit ? 1 : 0, stdout: JSON.stringify(response(cwd, hit ? severity : 'low')) };
    }, lines), false);
    assert.equal(calls, 6);
    assert.match(lines.join('\n'), /marketing-site/);
    assert.match(lines.join('\n'), /tool/);
  }
});

test('registry, subprocess and malformed/partial/contradictory reports cannot pass', async (t) => {
  const repo = fixture(t);
  const bad = [
    () => ({ status: 1, stdout: '{"error":{"code":"E500"}}' }),
    () => ({ status: null, signal: 'SIGTERM', stdout: '' }),
    () => ({ status: 0, stdout: 'not json' }),
    (r) => ({ status: 1, stdout: JSON.stringify(r) }),
    (r) => { delete r.vulnerabilities; return { status: 0, stdout: JSON.stringify(r) }; },
    (r) => { delete r.metadata.vulnerabilities.low; return { status: 0, stdout: JSON.stringify(r) }; },
    (r) => { r.metadata.dependencies.total = 0; return { status: 0, stdout: JSON.stringify(r) }; },
    (r) => { delete r.metadata.dependencies.dev; return { status: 0, stdout: JSON.stringify(r) }; },
    (r) => { r.metadata.dependencies.total++; return { status: 0, stdout: JSON.stringify(r) }; },
    (r) => { r.metadata.vulnerabilities.total++; return { status: 0, stdout: JSON.stringify(r) }; },
    (r) => { r.vulnerabilities.tool = { name: 'tool', severity: 'high' }; return { status: 0, stdout: JSON.stringify(r) }; },
  ];
  for (const change of bad) {
    assert.equal(await run(repo, (_bin, _args, { cwd }) => change(response(cwd))), false);
  }
});

test('inventory rejects unclassified graphs, missing locks, and nonregular files before npm', async (t) => {
  for (const change of [
    r => put(r, 'new/package.json', { name: 'new' }),
    r => put(r, 'new/package-lock.json', {}),
    r => put(r, 'npm-shrinkwrap.json', {}),
    r => put(r, 'pnpm-lock.yaml', 'lockfileVersion: 9'),
    r => rmSync(join(r, 'scripts/package-lock.json')),
    r => { const f = join(r, 'scripts/package-lock.json'); rmSync(f); symlinkSync('../package-lock.json', f); },
    r => put(r, 'src-tauri/sidecar/package.json', { ...read(r, 'src-tauri/sidecar/package.json'), dependencies:{ x:'1' } }),
  ]) {
    const repo = fixture(t, change);
    let calls = 0;
    assert.equal(await run(repo, () => { calls++; throw Error('must not spawn'); }), false);
    assert.equal(calls, 0);
  }
});

test('unsafe package inputs, mismatched manifests, absent packages and unexpected links cannot pass', async (t) => {
  for (const change of [
    (l) => { l.packages['node_modules/tool'].resolved = 'https://evil.invalid/tool.tgz'; },
    (l) => { l.packages['node_modules/tool'] = { link:true, resolved:'../../outside' }; },
    (l) => { l.packages['../outside'] = { version:'1.0.0' }; },
    (l) => { delete l.packages['node_modules/tool']; l.packages['node_modules/unrelated'] = {version:'1.0.0'}; },
    (l) => { l.packages[''].devDependencies.tool = '^9'; },
    (l) => { l.packages['node_modules/tool'].dependencies = { bad:'https://evil.invalid/pkg' }; },
    (l) => { l.lockfileVersion = 1; },
    (l) => { delete l.packages['node_modules/tool'].version; },
    (l) => { l.packages['node_modules/tool'].version = 'not-a-version'; },
    (l) => { l.packages['node_modules/tool'].name = 'git+https://evil.invalid/tool'; },
    (l) => { l.packages['node_modules/tool'].name = 'innocent'; l.packages['node_modules/tool'].resolved = 'https://registry.npmjs.org/innocent/-/innocent-1.1.0.tgz'; },
    (l) => { l.packages['node_modules/tool'].dependencies = { missing: '^1' }; },
    (l) => { l.packages['node_modules/tool'].optionalDependencies = { missing: '^1' }; },
    (l) => { l.packages['node_modules/tool'].version = '9.0.0'; l.packages['node_modules/tool'].resolved = 'https://registry.npmjs.org/tool/-/tool-9.0.0.tgz'; },
  ]) {
    const repo = fixture(t, r => { const l = read(r, 'scripts/package-lock.json'); change(l); put(r, 'scripts/package-lock.json', l); });
    let unsafeRan = false;
    assert.equal(await run(repo, (_bin,_args,{cwd}) => {
      if (read(cwd, 'package.json').name === 'project-3') unsafeRan = true;
      return {status:0,stdout:JSON.stringify(response(cwd))};
    }), false);
    assert.equal(unsafeRan, false);
  }
});

test('CLI exits nonzero for an incomplete checked out Git inventory', t => {
  const repo = fixture(t, r => put(r, 'src-tauri/sidecar/package.json', {}));
  const checker = fileURLToPath(new URL('../scripts/audit-npm-locks.mjs', import.meta.url));
  const alias = join(repo, 'linked-checker-directory');
  symlinkSync(dirname(checker), alias, 'dir');
  const result = spawnSync(process.execPath, [join(alias, basename(checker))], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /inventory unavailable/);
});

test('a missing root name cannot masquerade as a valid registry name', async t => {
  const repo = fixture(t, r => {
    const manifest = read(r, 'scripts/package.json');
    const lock = read(r, 'scripts/package-lock.json');
    delete manifest.name; delete lock.name; delete lock.packages[''].name;
    put(r, 'scripts/package.json', manifest); put(r, 'scripts/package-lock.json', lock);
  });
  const calls = [];
  assert.equal(await run(repo, (_bin, _args, {cwd}) => {
    calls.push(read(cwd, 'package.json').name);
    return {status:0,stdout:JSON.stringify(response(cwd))};
  }), false);
  assert.ok(!calls.includes(undefined));
});

test('validates the actual public bulk advisory response and matches installed versions before trusting npm counts', async t => {
  const repo = fixture(t);
  const advisory = {id: 123, severity: 'high', title: 'tool advisory', vulnerable_versions: '>=1 <2'};
  const clean = (_bin, _args, {cwd}) => ({status:0,stdout:JSON.stringify(response(cwd))});
  for (const bad of [null, false, 1, [], {unknown:[advisory]}, {tool:[]}, {tool:[{}]}, {tool:[{...advisory, vulnerable_versions:'bad range'}]}]) {
    let calls = 0;
    assert.equal(await run(repo, () => { calls++; }, [], async () => Response.json(bad)), false);
    assert.equal(calls, 0);
  }
  for (const severity of ['high','critical','moderate']) {
    const log = [];
    assert.equal(await run(repo, clean, log, async (url, options) => {
      assert.equal(url, 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk');
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body).tool, ['1.1.0']);
      return Response.json({tool:[{...advisory,severity}]});
    }), false, 'npm cannot conceal a direct advisory');
    assert.match(log.join('\n'), /bulk.*npm|npm.*bulk/i);
  }
  assert.equal(await run(repo, clean, [], async () => Response.json({tool:[{...advisory,vulnerable_versions:'<1'}]})), true);
  assert.equal(await run(repo, clean, [], async () => Response.json({}, {status: 503})), false);
});

test('checks unselected nested override destinations before contacting the registry', async t => {
  for (const [spec, allowed] of [['1.2.3', true], ['https://evil.invalid/pkg.tgz', false]]) {
    const repo = fixture(t, r => {
      const manifest = read(r, 'scripts/package.json');
      manifest.overrides = { unused: { child: spec } };
      put(r, 'scripts/package.json', manifest);
    });
    let inspected = false;
    const passed = await run(repo, (_bin, _args, {cwd}) => {
      if (read(cwd, 'package.json').name === 'project-3') inspected = true;
      return {status:0,stdout:JSON.stringify(response(cwd))};
    });
    assert.equal(inspected, allowed, 'a foreign override must never reach npm');
    assert.equal(passed, allowed);
  }
});

test('bulk reads have a bounded deadline and size even when excess bytes are valid JSON whitespace', async t => {
  const repo = fixture(t);
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const bounded = new WeakSet();
  t.mock.method(AbortSignal, 'timeout', ms => {
    const signal = timeout(ms);
    if (ms > 0 && ms <= 120_000) bounded.add(signal);
    return signal;
  });
  let requested = 0, scans = 0;
  const lines = [];
  const ok = await run(repo, (_bin, _args, {cwd}) => {
    scans++;
    return {status:0, stdout:JSON.stringify(response(cwd))};
  }, lines, async (_url, {signal}) => {
    assert.ok(bounded.has(signal), 'each bulk request must have a time-bounded abort signal');
    requested++;
    return requested === 1 ? new Response(' '.repeat(8 * 1024 * 1024) + '{}') : Response.json({});
  });
  assert.equal(ok, false);
  assert.equal(requested, 6);
  assert.equal(scans, 5, 'oversized reply fails before npm');
  assert.match(lines[0], /bulk advisory response too large/);
});

test('preserves the strongest matching advisory when npm reports a downgraded finding', async t => {
  const repo = fixture(t);
  const rows = ['high','low'].map((severity, i) => ({
    id: i + 1, severity, title: 'test risk', vulnerable_versions: '>=1 <2',
  }));
  const lines = [];
  const ok = await run(repo, (_bin, _args, {cwd}) => ({status:0, stdout:JSON.stringify(response(cwd, 'moderate'))}),
    lines, async () => Response.json({tool:rows}));
  assert.equal(ok, false, 'a moderate npm report cannot lower a matching high advisory');
  assert.match(lines[0], /bulk finding tool:high/);
});

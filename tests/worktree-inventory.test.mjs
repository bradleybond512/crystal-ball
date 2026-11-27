import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/worktree-inventory.mjs', import.meta.url));
const marker = 'PRIVATE_FIXTURE_CONTENT_8f2d';
const filename = 'private-file-name-8f2d.txt';
const fixtureEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
for (const key of Object.keys(fixtureEnv)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|TRACE|CONFIG_COUNT|CONFIG_KEY_|CONFIG_VALUE_)/.test(key)) delete fixtureEnv[key];

function git(repo, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env: fixtureEnv, encoding: 'utf8' });
  assert.equal(result.status, 0, `fixture git ${args[0]}: ${result.stderr}`);
  return result.stdout.trimEnd();
}

function put(repo, name, value) {
  const path = join(repo, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function commit(repo, name, value, message = marker) {
  put(repo, name, value);
  git(repo, 'add', '--', name);
  git(repo, 'commit', '--quiet', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ux068-fixture-')));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(repo, 'init', '--quiet', '--initial-branch=main');
  const base = commit(repo, filename, `${marker}\n`);
  git(repo, 'remote', 'add', 'fixture', 'https://github.com/example/inventory-fixture.git');
  return { root, repo, base };
}

function savedState(repo) {
  return {
    refs: git(repo, 'for-each-ref', '--format=%(refname)%00%(objectname)'),
    registration: git(repo, 'worktree', 'list', '--porcelain', '-z'),
    index: createHash('sha256').update(readFileSync(join(repo, '.git/index'))).digest('hex'),
    config: readFileSync(join(repo, '.git/config'), 'utf8'),
  };
}

function cli(repo, args = [], options = {}) {
  return spawnSync(process.execPath, [script, '--repo', repo, '--base-ref', 'refs/heads/main', ...args], { encoding: 'utf8', env: fixtureEnv, timeout: 15_000, ...options });
}

function confidential(report) {
  const output = JSON.stringify(report);
  for (const secret of [marker, filename, 'https://github.com/', 'safeToDelete']) assert.ok(!output.includes(secret), `manifest leaked ${secret}`);
}

function fixtureSpawn(bin, args, options) {
  return spawnSync(bin, args, { ...options, env: { ...options.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
}

async function collect(repo, options = {}, dependencies = {}) {
  const { collectInventory } = await import('../scripts/worktree-inventory.mjs');
  return collectInventory({ repos: [repo], baseRef: 'refs/heads/main', ...options }, { spawn: fixtureSpawn, ...dependencies });
}

function repository(report) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.repositories.length, 1, JSON.stringify(report.errors));
  return report.repositories[0];
}

function ref(report, name) {
  const found = repository(report).refs.find(item => item.ref === `refs/heads/${name}`);
  assert.ok(found, `missing ref ${name}`);
  return found;
}

function status(report, path) {
  const found = repository(report).worktrees.find(item => item.path === path);
  assert.ok(found, `missing worktree ${path}`);
  return found.status;
}

test('metadata pins baseline, preserves all fixture state and emits no deletion authority or contents', async t => {
  const { repo, base } = fixture(t);
  const before = savedState(repo);
  const report = await collect(repo);
  const entry = repository(report);
  assert.equal(report.exitCode, 0);
  assert.equal(report.complete, true);
  assert.deepEqual(entry.base, { ref: 'refs/heads/main', oid: base });
  assert.equal(entry.identity, 'example/inventory-fixture');
  assert.equal(ref(report, 'main').ancestry.state, 'equal');
  assert.equal(entry.worktrees.length, 1);
  assert.deepEqual(savedState(repo), before);
  confidential(report);
});

test('explicit aliases sharing a common repository are deduplicated', async t => {
  const { root, repo } = fixture(t);
  const alias = join(root, 'alias');
  symlinkSync(repo, alias, 'dir');
  const report = await collect(repo, { repos: [repo, alias, repo] });
  assert.equal(report.repositories.length, 1);
  assert.ok(repository(report).aliases.includes(repo));
  assert.ok(repository(report).aliases.includes(alias));
});

test('worktree registration safely retains newline paths, detached state and lock flags', async t => {
  const { root, repo } = fixture(t);
  const linked = join(root, 'linked\nworktree');
  git(repo, 'worktree', 'add', '--quiet', '--detach', linked);
  git(repo, 'worktree', 'lock', '--reason', marker, linked);
  const report = await collect(repo);
  const entry = repository(report).worktrees.find(item => item.path === linked);
  assert.ok(entry);
  assert.equal(entry.detached, true);
  assert.equal(entry.locked, true);
  confidential(report);
});

test('missing registered worktree stays prunable metadata and status unknown without pruning', async t => {
  const { root, repo } = fixture(t);
  const linked = join(root, 'missing');
  git(repo, 'worktree', 'add', '--quiet', '--detach', linked);
  rmSync(linked, { recursive: true, force: true });
  const before = savedState(repo);
  const report = await collect(repo, { statusWorktrees: [linked] });
  const entry = repository(report).worktrees.find(item => item.path === linked);
  assert.equal(entry.prunable, true);
  assert.equal(entry.status.complete, false);
  assert.equal(report.exitCode, 2);
  assert.deepEqual(savedState(repo), before);
});

test('ancestry distinguishes contained, ahead and diverged histories using pinned OIDs', async t => {
  const { repo, base } = fixture(t);
  git(repo, 'branch', 'contained');
  const main = commit(repo, 'main.txt', 'main\n');
  git(repo, 'checkout', '--quiet', '-b', 'ahead');
  const ahead = commit(repo, 'ahead.txt', 'ahead\n');
  git(repo, 'checkout', '--quiet', '-b', 'diverged', base);
  const diverged = commit(repo, 'other.txt', 'other\n');
  git(repo, 'checkout', '--quiet', 'main');
  const report = await collect(repo);
  assert.equal(ref(report, 'contained').ancestry.state, 'tip-ancestor');
  assert.equal(ref(report, 'ahead').ancestry.state, 'base-ancestor');
  assert.equal(ref(report, 'diverged').ancestry.state, 'diverged');
  for (const [name, oid] of [['contained', base], ['ahead', ahead], ['diverged', diverged]]) {
    assert.equal(ref(report, name).ancestry.baseOid, main);
    assert.equal(ref(report, name).ancestry.tipOid, oid);
  }
});

test('status counts staged and unstaged overlap without exposing names or changing the index', async t => {
  const { repo } = fixture(t);
  put(repo, filename, 'staged\n');
  git(repo, 'add', '--', filename);
  put(repo, filename, 'unstaged\n');
  put(repo, `untracked-${filename}`, marker);
  const before = savedState(repo);
  const report = await collect(repo, { statusWorktrees: [repo] });
  const result = status(report, repo);
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.deepEqual(result.counts, { staged: 1, unstaged: 1, conflicted: 0, untracked: 1 });
  assert.equal(report.exitCode, 0);
  assert.deepEqual(savedState(repo), before);
  confidential(report);
});

test('clean observed status retains ignored-file and submodule limitations', async t => {
  const { repo } = fixture(t);
  commit(repo, '.gitignore', 'ignored-private\n');
  put(repo, 'ignored-private', marker);
  const report = await collect(repo, { statusWorktrees: [repo] });
  const result = status(report, repo);
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.deepEqual(result.counts, { staged: 0, unstaged: 0, conflicted: 0, untracked: 0 });
  assert.match(JSON.stringify(result), /ignored/);
  assert.match(JSON.stringify(result), /submodule/);
  confidential(report);
});

test('conflict status records conflicts rather than a clean worktree', async t => {
  const { repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'other');
  commit(repo, filename, 'other\n');
  git(repo, 'checkout', '--quiet', 'main');
  commit(repo, filename, 'main\n');
  const merged = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'core.hooksPath=/dev/null', 'merge', '--no-edit', 'other'], { cwd: repo, env: fixtureEnv, encoding: 'utf8' });
  assert.equal(merged.status, 1);
  const report = await collect(repo, { statusWorktrees: [repo] });
  assert.equal(status(report, repo).counts.conflicted, 1);
});

for (const filter of ['clean', 'process']) {
  test(`configured ${filter} filter cannot execute while checking status`, async t => {
    const { root, repo } = fixture(t);
    const sentinel = join(root, 'filter-ran');
    commit(repo, '.gitattributes', `* filter=private\n`);
    git(repo, 'config', `filter.private.${filter}`, `touch '${sentinel}'`);
    put(repo, filename, 'changed\n');
    const report = await collect(repo, { statusWorktrees: [repo] });
    assert.equal(status(report, repo).complete, false);
    assert.equal(status(report, repo).reason, 'external-filter-configured');
    assert.equal(report.exitCode, 2);
    assert.equal(existsSync(sentinel), false);
  });
}

test('unregistered status requests cannot scan arbitrary directories', async t => {
  const { root, repo } = fixture(t);
  const arbitrary = join(root, 'arbitrary');
  mkdirSync(arbitrary);
  put(arbitrary, filename, marker);
  const commands = [];
  const report = await collect(repo, { statusWorktrees: [arbitrary] }, { spawn(bin, args, options) {
    commands.push({ args, cwd: options.cwd });
    return fixtureSpawn(bin, args, options);
  } });
  assert.equal(report.complete, false);
  assert.equal(report.exitCode, 2);
  assert.ok(!commands.some(call => call.cwd === arbitrary));
  confidential(report);
});

test('all collector commands use bounded read-only arguments and a sanitized Git environment', async t => {
  const { repo } = fixture(t);
  const hostile = { GIT_TRACE: 'private-trace', GIT_DIR: '/private/wrong', GIT_WORK_TREE: '/private/wrong', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'private-executable' };
  const previous = Object.fromEntries(Object.keys(hostile).map(key => [key, process.env[key]]));
  Object.assign(process.env, hostile);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const commands = [];
  const report = await collect(repo, { statusWorktrees: [repo], patchRefs: ['refs/heads/main'] }, { spawn(bin, args, options) {
    commands.push(args);
    assert.equal(bin, '/usr/bin/git');
    assert.notEqual(options.shell, true);
    assert.ok(options.timeout > 0 && options.timeout <= 5000);
    assert.ok(options.maxBuffer > 0 && options.maxBuffer <= 16 * 1024 * 1024);
    for (const [key, value] of Object.entries({ GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' })) assert.equal(options.env[key], value);
    for (const key of Object.keys(hostile)) assert.equal(options.env[key], undefined);
    assert.ok(args.includes('protocol.allow=never'));
    assert.ok(args.includes('core.fsmonitor=false'));
    assert.ok(args.includes('maintenance.auto=false'));
    return fixtureSpawn(bin, args, options);
  } });
  assert.equal(report.exitCode, 0);
  assert.ok(commands.length > 0);
  assert.ok(!commands.some(args => args.some(arg => ['fetch', 'push', 'checkout', 'reset', 'clean', 'prune', 'gc', 'repack', 'update-ref', 'stash'].includes(arg))));
});

test('CLI emits one JSON document and no output files', t => {
  const { repo } = fixture(t);
  const before = savedState(repo);
  const result = cli(repo);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(savedState(repo), before);
  confidential(report);
});

for (const args of [['--base-ref', '--upload-pack=evil'], ['--patch-ref', 'HEAD'], ['--unknown'], ['--repo']]) {
  test(`CLI rejects malformed or option-like input ${args.join(' ')}`, t => {
    const { repo } = fixture(t);
    const result = cli(repo, args);
    assert.equal(result.status, 1);
    assert.ok(!result.stdout.includes(marker));
  });
}

function patch(report, name = 'topic') {
  const value = ref(report, name).patchEvidence;
  assert.ok(value, 'selected ref needs patch evidence');
  return value;
}

test('equal trees with different history are reported separately from ancestry', async t => {
  const { repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'topic');
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', marker);
  git(repo, 'checkout', '--quiet', 'main');
  const report = await collect(repo, { patchRefs: ['refs/heads/topic'] });
  assert.equal(ref(report, 'topic').ancestry.state, 'base-ancestor');
  assert.equal(patch(report).treeEquality, 'equal');
  assert.equal(patch(report).complete, true);
  confidential(report);
});

test('cherry-picked commits match normalized patches without claiming identical final trees', async t => {
  const { repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'topic');
  const tipCommit = commit(repo, 'topic.txt', 'patch-content\n');
  git(repo, 'checkout', '--quiet', 'main');
  commit(repo, 'main-only.txt', 'main-only\n');
  git(repo, 'cherry-pick', tipCommit);
  const baseCommit = git(repo, 'rev-parse', 'HEAD');
  const report = await collect(repo, { patchRefs: ['refs/heads/topic'] });
  const evidence = patch(report);
  assert.equal(evidence.treeEquality, 'different');
  assert.equal(evidence.complete, true);
  assert.equal(evidence.matches.length, 1);
  assert.equal(evidence.matches[0].tipCommit, tipCommit);
  assert.equal(evidence.matches[0].baseCommit, baseCommit);
  assert.ok(evidence.unmatched.every(item => item.state === 'unmatched-in-examined-scope'));
  confidential(report);
});

test('squash-equivalent changes remain unmatched in examined scope rather than unique work', async t => {
  const { repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'topic');
  commit(repo, 'first.txt', 'first\n');
  commit(repo, 'second.txt', 'second\n');
  git(repo, 'checkout', '--quiet', 'main');
  commit(repo, 'main-only.txt', 'main-only\n');
  git(repo, 'merge', '--squash', 'topic');
  git(repo, 'commit', '--quiet', '-m', marker);
  const report = await collect(repo, { patchRefs: ['refs/heads/topic'] });
  const evidence = patch(report);
  assert.equal(evidence.treeEquality, 'different');
  assert.equal(evidence.matches.length, 0);
  assert.equal(evidence.unmatched.filter(item => item.side === 'tip').length, 2);
  assert.ok(evidence.unmatched.every(item => item.state === 'unmatched-in-examined-scope'));
  assert.ok(!JSON.stringify(evidence).includes('unique-work'));
});

test('merge commits are explicitly unassessed rather than silently covered', async t => {
  const { repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'feature');
  commit(repo, 'feature.txt', 'feature\n');
  git(repo, 'checkout', '--quiet', 'main');
  git(repo, 'checkout', '--quiet', '-b', 'topic');
  commit(repo, 'topic.txt', 'topic\n');
  git(repo, 'merge', '--quiet', '--no-ff', 'feature', '-m', marker);
  const merge = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '--quiet', 'main');
  const report = await collect(repo, { patchRefs: ['refs/heads/topic'] });
  const evidence = patch(report);
  assert.equal(evidence.complete, false);
  assert.ok(evidence.omitted.some(item => item.oid === merge && /merge/.test(item.reason)));
  assert.equal(report.exitCode, 2);
});

for (const kind of ['empty', 'binary']) {
  test(`${kind} commits are explicit unsupported patch evidence`, async t => {
    const { repo } = fixture(t);
    git(repo, 'checkout', '--quiet', '-b', 'topic');
    commit(repo, 'other.txt', 'other\n');
    if (kind === 'empty') git(repo, 'commit', '--quiet', '--allow-empty', '-m', marker);
    else commit(repo, 'private-binary.bin', Buffer.from([0, 1, 2, 3, 4, 0, 255]));
    const oid = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '--quiet', 'main');
    const report = await collect(repo, { patchRefs: ['refs/heads/topic'] });
    assert.equal(patch(report).complete, false);
    assert.ok(patch(report).omitted.some(item => item.oid === oid && item.reason.includes(kind)));
    assert.equal(report.exitCode, 2);
    confidential(report);
  });
}

test('patch subprocesses forbid external diff and text conversion without executing sentinels', async t => {
  const { root, repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'topic');
  commit(repo, 'topic.txt', 'topic\n');
  git(repo, 'checkout', '--quiet', 'main');
  const sentinel = join(root, 'external-diff-ran');
  git(repo, 'config', 'diff.external', `touch '${sentinel}'`);
  git(repo, 'config', 'diff.private.textconv', `touch '${sentinel}'`);
  put(repo, '.gitattributes', '* diff=private\n');
  const report = await collect(repo, { patchRefs: ['refs/heads/topic'] });
  assert.equal(patch(report).complete, true);
  assert.equal(existsSync(sentinel), false);
});

function prSnapshot(oid, changes = {}) {
  return {
    schemaVersion: 1, repository: 'example/inventory-fixture', generatedAt: new Date().toISOString(),
    complete: true, truncated: false, pagination: { complete: true, pages: 1 },
    pullRequests: [{ number: 42, state: 'OPEN', head: { repository: 'example/inventory-fixture', ref: 'refs/heads/main', oid }, base: { repository: 'example/inventory-fixture', ref: 'refs/heads/main' } }],
    ...changes,
  };
}

test('matching PR evidence remains explicitly supplied and pins head identity', async t => {
  const { repo, base } = fixture(t);
  const report = await collect(repo, { prSnapshot: prSnapshot(base) });
  const ownership = ref(report, 'main').ownership;
  assert.equal(ownership.state, 'matched');
  assert.equal(ownership.source, 'supplied-snapshot');
  assert.equal(ownership.supplierDeclaredComplete, true);
  assert.deepEqual(ownership.prs, [{ number: 42, state: 'OPEN', oidMatches: true }]);
});

test('same short branch name in another fork cannot establish local PR ownership', async t => {
  const { repo, base } = fixture(t);
  const snapshot = prSnapshot(base);
  snapshot.pullRequests[0].head.repository = 'other/inventory-fixture';
  const report = await collect(repo, { prSnapshot: snapshot });
  assert.equal(ref(report, 'main').ownership.state, 'no-matching-open-pr-in-snapshot');
  assert.equal(ref(report, 'main').ownership.prs.length, 0);
});

test('matching PR ref with a different OID retains the mismatch', async t => {
  const { repo } = fixture(t);
  const report = await collect(repo, { prSnapshot: prSnapshot('a'.repeat(40)) });
  const ownership = ref(report, 'main').ownership;
  assert.equal(ownership.state, 'unknown');
  assert.equal(ownership.reason, 'head-oid-mismatch');
  assert.equal(ownership.prs[0].oidMatches, false);
});

for (const [label, change] of [
  ['missing', () => undefined],
  ['incomplete', snapshot => ({ ...snapshot, complete: false })],
  ['truncated', snapshot => ({ ...snapshot, truncated: true })],
  ['pagination incomplete', snapshot => ({ ...snapshot, pagination: { complete: false, pages: 1 } })],
  ['stale', snapshot => ({ ...snapshot, generatedAt: '2000-01-01T00:00:00.000Z' })],
  ['future', snapshot => ({ ...snapshot, generatedAt: '2099-01-01T00:00:00.000Z' })],
  ['wrong repository', snapshot => ({ ...snapshot, repository: 'other/project' })],
  ['unknown fields', snapshot => ({ ...snapshot, token: marker })],
]) {
  test(`${label} PR evidence remains unknown`, async t => {
    const { repo, base } = fixture(t);
    const report = await collect(repo, { prSnapshot: change(prSnapshot(base)) });
    assert.equal(ref(report, 'main').ownership.state, 'unknown');
    confidential(report);
  });
}

test('ambiguous remote repository identity cannot authorize fork-sensitive PR matching', async t => {
  const { repo, base } = fixture(t);
  git(repo, 'remote', 'add', 'other', 'https://github.com/other/project.git');
  const report = await collect(repo, { prSnapshot: prSnapshot(base) });
  assert.equal(repository(report).identity, null);
  assert.equal(ref(report, 'main').ownership.state, 'unknown');
});

test('supplied recovery verification is not represented as collector-verified or a backup', async t => {
  const { repo, base } = fixture(t);
  const report = await collect(repo, { recoverySnapshot: {
    schemaVersion: 1, generatedAt: new Date().toISOString(), provenance: 'fixture independent audit',
    records: [{ repository: 'example/inventory-fixture', oid: base, verifiedAt: new Date().toISOString(), independentCopy: true, verification: { method: 'read-back', digest: 'a'.repeat(64) }, coversCommitted: true, coversUntracked: false, coveredFiles: [filename] }],
  } });
  const recovery = ref(report, 'main').recovery;
  assert.equal(recovery.state, 'supplied-verification-record');
  assert.equal(recovery.collectorVerified, false);
  assert.equal(recovery.coveredOid, base);
  assert.equal(recovery.coveredFileCount, 1);
  assert.equal(recovery.coversUntracked, false);
  confidential(report);
});

test('a checksum or ref alone cannot establish recovery', async t => {
  const { repo, base } = fixture(t);
  for (const records of [[], [{ oid: base, checksum: 'a'.repeat(64) }], [{ repository: 'example/inventory-fixture', oid: base, verifiedAt: new Date().toISOString(), independentCopy: false, verification: { method: 'read-back', digest: 'a'.repeat(64) }, coversCommitted: true, coversUntracked: false, coveredFiles: [] }]]) {
    const report = await collect(repo, { recoverySnapshot: { schemaVersion: 1, generatedAt: new Date().toISOString(), provenance: 'fixture', records } });
    assert.equal(ref(report, 'main').recovery.state, 'unknown');
  }
});

test('ref cap reports omitted IDs and partial evidence', async t => {
  const { repo } = fixture(t);
  git(repo, 'branch', 'extra-a');
  git(repo, 'branch', 'extra-b');
  const report = await collect(repo, { limits: { maxRefs: 1 } });
  assert.equal(report.complete, false);
  assert.equal(report.exitCode, 2);
  assert.equal(repository(report).refs.length, 1);
  assert.equal(report.skipped.filter(item => item.dimension === 'refs').length, 2);
  assert.ok(report.skipped.every(item => typeof item.id === 'string' && item.reason));
});

test('worktree cap never silently drops registered paths', async t => {
  const { root, repo } = fixture(t);
  const linked = join(root, 'linked');
  git(repo, 'worktree', 'add', '--quiet', '--detach', linked);
  const report = await collect(repo, { limits: { maxWorktrees: 1 } });
  assert.equal(report.complete, false);
  assert.equal(report.exitCode, 2);
  assert.equal(repository(report).worktrees.length, 1);
  assert.equal(report.skipped.filter(item => item.dimension === 'worktrees').length, 1);
});

test('ancestry investigation cap leaves unexamined tips unknown', async t => {
  const { repo } = fixture(t);
  for (const name of ['one', 'two', 'three']) {
    git(repo, 'checkout', '--quiet', '-b', name, 'main');
    commit(repo, `${name}.txt`, `${name}\n`);
  }
  git(repo, 'checkout', '--quiet', 'main');
  const report = await collect(repo, { limits: { maxAncestryTips: 1 } });
  assert.equal(report.complete, false);
  assert.equal(report.exitCode, 2);
  assert.ok(repository(report).refs.some(item => item.ancestry.state === 'unknown'));
  assert.ok(report.skipped.some(item => item.dimension === 'ancestry'));
});

test('per-ref commit cap preserves explicit omissions and incomplete patch evidence', async t => {
  const { repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'topic');
  for (let i = 0; i < 3; i++) commit(repo, `commit-${i}.txt`, `${i}\n`);
  git(repo, 'checkout', '--quiet', 'main');
  const report = await collect(repo, { patchRefs: ['refs/heads/topic'], limits: { commitsPerRef: 1 } });
  assert.equal(report.counters.examinedPatchCommits, 1);
  assert.equal(patch(report).complete, false);
  assert.equal(report.exitCode, 2);
  assert.ok(report.skipped.some(item => item.dimension === 'patches'));
});

test('per-patch byte cap does not turn oversized content into equivalent or empty evidence', async t => {
  const { repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'topic');
  commit(repo, 'big.txt', `${marker.repeat(200)}\n`);
  git(repo, 'checkout', '--quiet', 'main');
  const report = await collect(repo, { patchRefs: ['refs/heads/topic'], limits: { patchBytes: 200 } });
  assert.equal(patch(report).complete, false);
  assert.equal(patch(report).matches.length, 0);
  assert.equal(report.exitCode, 2);
  confidential(report);
});

test('command timeout yields partial status and redacts subprocess error text', async t => {
  const { repo } = fixture(t);
  const report = await collect(repo, { statusWorktrees: [repo] }, { spawn(bin, args, options) {
    if (args.includes('status')) return { status: null, error: Object.assign(new Error(marker), { code: 'ETIMEDOUT' }), stdout: '', stderr: `${marker}:${filename}` };
    return fixtureSpawn(bin, args, options);
  } });
  assert.equal(status(report, repo).complete, false);
  assert.equal(report.exitCode, 2);
  confidential(report);
});

test('malformed status cannot be accepted as a clean observation', async t => {
  const { repo } = fixture(t);
  const report = await collect(repo, { statusWorktrees: [repo] }, { spawn(bin, args, options) {
    if (args.includes('status')) return { status: 0, stdout: `invalid ${filename}\0`, stderr: '' };
    return fixtureSpawn(bin, args, options);
  } });
  assert.equal(status(report, repo).complete, false);
  assert.equal(report.exitCode, 2);
  confidential(report);
});

test('status warnings do not become an unsupported clean-status claim', async t => {
  const { repo } = fixture(t);
  const report = await collect(repo, { statusWorktrees: [repo] }, { spawn(bin, args, options) {
    if (args.includes('status')) return { status: 0, stdout: '', stderr: `warning: unable to read ${filename}` };
    return fixtureSpawn(bin, args, options);
  } });
  assert.equal(status(report, repo).complete, false);
  assert.equal(report.exitCode, 2);
  confidential(report);
});

test('HEAD/index movement during status invalidates consistency', async t => {
  const { repo } = fixture(t);
  let changed = false;
  const report = await collect(repo, { statusWorktrees: [repo] }, { spawn(bin, args, options) {
    const result = fixtureSpawn(bin, args, options);
    if (args.includes('status') && !changed) {
      changed = true;
      put(repo, filename, 'concurrent edit\n');
      git(repo, 'add', '--', filename);
    }
    return result;
  } });
  assert.equal(changed, true);
  assert.equal(status(report, repo).complete, false);
  assert.equal(report.exitCode, 2);
  assert.match(JSON.stringify(status(report, repo)), /changed|inconsistent/);
});

test('ref movement after capture invalidates repository snapshot consistency', async t => {
  const { repo, base } = fixture(t);
  const newer = commit(repo, 'newer.txt', 'newer\n');
  git(repo, 'branch', 'moving', base);
  let changed = false;
  const report = await collect(repo, {}, { spawn(bin, args, options) {
    const result = fixtureSpawn(bin, args, options);
    if (args.includes('for-each-ref') && !changed) {
      changed = true;
      git(repo, 'update-ref', 'refs/heads/moving', newer);
    }
    return result;
  } });
  assert.equal(changed, true);
  assert.equal(report.complete, false);
  assert.equal(report.exitCode, 2);
  assert.match(JSON.stringify(repository(report).consistency), /changed|inconsistent/);
});

test('missing promisor blobs cannot invoke transport during patch comparison', async t => {
  const { root, repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'topic');
  commit(repo, 'missing.txt', 'unique missing blob\n');
  const blob = git(repo, 'rev-parse', 'HEAD:missing.txt');
  git(repo, 'checkout', '--quiet', 'main');
  const sentinel = join(root, 'transport-ran');
  const helper = join(root, 'git-remote-fixture');
  writeFileSync(helper, `#!/bin/sh\ntouch '${sentinel}'\nexit 1\n`, { mode: 0o755 });
  git(repo, 'config', 'remote.fixture.url', 'fixture::private-address');
  git(repo, 'config', 'remote.fixture.promisor', 'true');
  git(repo, 'config', 'remote.fixture.partialclonefilter', 'blob:none');
  rmSync(join(repo, '.git/objects', blob.slice(0, 2), blob.slice(2)));
  const report = await collect(repo, { patchRefs: ['refs/heads/topic'] }, { spawn(bin, args, options) {
    return fixtureSpawn(bin, args, { ...options, env: { ...options.env, PATH: `${root}:${options.env.PATH}` } });
  } });
  assert.equal(patch(report).complete, false);
  assert.equal(report.exitCode, 2);
  assert.equal(existsSync(sentinel), false);
  confidential(report);
});

test('budgets cannot be raised beyond approved limits or supplied as nonfinite values', async t => {
  const { repo } = fixture(t);
  for (const limits of [{ commandMs: 5001 }, { totalCommits: Infinity }, { maxRefs: -1 }, { metadataMs: NaN }, { surprise: 1 }]) {
    const report = await collect(repo, { limits });
    assert.equal(report.exitCode, 1);
    assert.equal(report.complete, false);
  }
});

for (const malformed of ['1 ..\0', '? \0', '2 R. N... 100644 100644 100644 a a R100 name\0']) {
  test(`truncated porcelain record ${JSON.stringify(malformed)} stays unavailable`, async t => {
    const { repo } = fixture(t);
    const report = await collect(repo, { statusWorktrees: [repo] }, { spawn(bin, args, options) {
      if (args.includes('status')) return { status: 0, stdout: malformed, stderr: '' };
      return fixtureSpawn(bin, args, options);
    } });
    assert.equal(status(report, repo).complete, false);
    assert.equal(report.exitCode, 2);
  });
}

for (const [limit, property] of [['maxRefs', 'refs'], ['maxWorktrees', 'worktrees']]) {
  test(`${limit} is an invocation-wide limit across separate repositories`, async t => {
    const first = fixture(t);
    const second = fixture(t);
    const report = await collect(first.repo, { repos: [first.repo, second.repo], limits: { [limit]: 1 } });
    assert.equal(report.repositories.length, 2);
    assert.equal(report.repositories.reduce((count, item) => count + item[property].length, 0), 1);
    assert.equal(report.complete, false);
    assert.equal(report.exitCode, 2);
    assert.ok(report.skipped.some(item => item.dimension === property));
  });
}

test('ancestry tip budget is shared across separate repositories', async t => {
  const first = fixture(t);
  const second = fixture(t);
  for (const [index, { repo }] of [first, second].entries()) {
    git(repo, 'checkout', '--quiet', '-b', 'aaa-topic');
    commit(repo, `topic-${index}.txt`, `${index}\n`);
    git(repo, 'checkout', '--quiet', 'main');
  }
  let investigations = 0;
  const report = await collect(first.repo, { repos: [first.repo, second.repo], limits: { maxAncestryTips: 1 } }, {
    spawn(bin, args, options) {
      if (args.includes('merge-base')) investigations++;
      return fixtureSpawn(bin, args, options);
    },
  });
  assert.ok(investigations <= 2, `one tip investigation permits at most two ancestry commands, got ${investigations}`);
  assert.equal(report.exitCode, 2);
  assert.ok(report.skipped.some(item => item.dimension === 'ancestry'));
  assert.ok(report.repositories.flatMap(item => item.refs).some(item => item.ancestry.state === 'unknown'));
});

test('total patch commit budget is shared by every requested ref', async t => {
  const { repo } = fixture(t);
  for (const name of ['topic', 'other']) {
    git(repo, 'checkout', '--quiet', '-b', name, 'main');
    commit(repo, `${name}.txt`, `${name}\n`);
  }
  git(repo, 'checkout', '--quiet', 'main');
  const report = await collect(repo, { patchRefs: ['refs/heads/topic', 'refs/heads/other'], limits: { totalCommits: 1 } });
  assert.equal(report.counters.examinedPatchCommits, 1);
  assert.equal(report.exitCode, 2);
  assert.ok(['topic', 'other'].some(name => patch(report, name).omitted.some(item => /commit-limit/.test(item.reason))));
});

test('aggregate patch byte budget remains partial without leaking truncated content', async t => {
  const { repo } = fixture(t);
  git(repo, 'checkout', '--quiet', '-b', 'topic');
  commit(repo, 'large.txt', `${marker.repeat(100)}\n`);
  git(repo, 'checkout', '--quiet', 'main');
  const report = await collect(repo, { patchRefs: ['refs/heads/topic'], limits: { totalPatchBytes: 100 } });
  assert.equal(patch(report).complete, false);
  assert.equal(report.exitCode, 2);
  assert.ok(report.counters.patchBytes <= 100);
  confidential(report);
});

for (const phase of ['metadata', 'status', 'patch']) {
  test(`${phase} phase cannot continue past its total time budget`, async t => {
    const { repo } = fixture(t);
    git(repo, 'checkout', '--quiet', '-b', 'topic');
    commit(repo, 'topic.txt', 'topic\n');
    git(repo, 'checkout', '--quiet', 'main');
    let tick = 0;
    const report = await collect(repo, { statusWorktrees: [repo], patchRefs: ['refs/heads/topic'], limits: { [`${phase}Ms`]: 1 } }, {
      now: () => tick,
      spawn(bin, args, options) { tick += 2; return fixtureSpawn(bin, args, { ...options, timeout: 5000 }); },
    });
    assert.equal(report.complete, false);
    assert.equal(report.exitCode, phase === 'metadata' ? 1 : 2);
    if (phase === 'status') assert.equal(status(report, repo).complete, false);
    if (phase === 'patch') assert.equal(patch(report).complete, false);
  });
}

test('nonregular snapshot input is rejected without waiting for a writer', t => {
  const { root, repo } = fixture(t);
  const fifo = join(root, 'snapshot.fifo');
  const created = spawnSync('/usr/bin/mkfifo', [fifo], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  const result = cli(repo, ['--pr-snapshot', fifo], { timeout: 2000 });
  assert.equal(result.error, undefined, 'snapshot reader blocked on a named pipe');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).complete, false);
});

test('nonregular index cannot block the collector or produce observed status', t => {
  const { repo } = fixture(t);
  const index = join(repo, '.git/index');
  rmSync(index);
  const created = spawnSync('/usr/bin/mkfifo', [index], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  const code = `
    import { collectInventory } from ${JSON.stringify(new URL('../scripts/worktree-inventory.mjs', import.meta.url).href)};
    import { spawnSync } from 'node:child_process';
    const repo = process.argv[1];
    const report = collectInventory({ repos: [repo], baseRef: 'refs/heads/main', statusWorktrees: [repo] }, {
      spawn(bin, args, options) { return spawnSync(bin, args, { ...options, env: { ...options.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }); }
    });
    process.stdout.write(JSON.stringify(report)); process.exitCode = report.exitCode;
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, repo], { encoding: 'utf8', env: fixtureEnv, timeout: 2000 });
  assert.equal(result.error, undefined, 'index reader blocked on a named pipe');
  assert.equal(result.status, 2);
  assert.equal(status(JSON.parse(result.stdout), repo).complete, false);
});

test('rename status is NUL-safe for original and destination paths containing newlines', async t => {
  const { repo } = fixture(t);
  const destination = `renamed\n${filename}`;
  git(repo, 'mv', filename, destination);
  const report = await collect(repo, { statusWorktrees: [repo] });
  assert.equal(status(report, repo).complete, true);
  assert.equal(status(report, repo).counts.staged, 1);
  assert.equal(status(report, repo).counts.untracked, 0);
  confidential(report);
});

test('snapshot symlinks are rejected rather than following an unverified target', t => {
  const { root, repo, base } = fixture(t);
  const target = join(root, 'snapshot.json');
  const linked = join(root, 'snapshot-link.json');
  writeFileSync(target, JSON.stringify(prSnapshot(base)));
  symlinkSync(target, linked);
  const result = cli(repo, ['--pr-snapshot', linked]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).complete, false);
});

test('dirty submodule contents remain explicitly unassessed and are never enumerated', async t => {
  const { repo } = fixture(t);
  const child = join(repo, 'child');
  mkdirSync(child);
  git(child, 'init', '--quiet', '--initial-branch=main');
  const childOid = commit(child, filename, `${marker}\n`);
  put(repo, '.gitmodules', '[submodule "child"]\n\tpath = child\n\turl = https://example.invalid/never-fetch\n');
  git(repo, 'add', '--', '.gitmodules');
  git(repo, 'update-index', '--add', '--cacheinfo', `160000,${childOid},child`);
  git(repo, 'commit', '--quiet', '-m', marker);
  put(child, filename, `${marker} changed\n`);
  put(child, `untracked-${filename}`, marker);
  const report = await collect(repo, { statusWorktrees: [repo] });
  const observed = status(report, repo);
  assert.equal(observed.complete, true);
  assert.deepEqual(observed.counts, { staged: 0, unstaged: 0, conflicted: 0, untracked: 0 });
  assert.ok(observed.limitations.includes('submodule-contents-unassessed'));
  confidential(report);
});

test('explicit linked-worktree aliases share one repository identity', async t => {
  const { root, repo } = fixture(t);
  const linked = join(root, 'linked');
  git(repo, 'worktree', 'add', '--quiet', '--detach', linked);
  const report = await collect(repo, { repos: [repo, linked] });
  assert.equal(report.repositories.length, 1);
  assert.deepEqual(repository(report).aliases.sort(), [repo, linked].sort());
  assert.equal(repository(report).worktrees.length, 2);
});

test('explicit malformed falsey supplied evidence cannot count as completed requested coverage', async t => {
  const { repo } = fixture(t);
  for (const field of ['prSnapshot', 'recoverySnapshot']) {
    for (const value of [null, false, 0]) {
      const report = await collect(repo, { [field]: value });
      assert.equal(report.exitCode, 2, `${field} ${value}`);
      assert.equal(report.complete, false);
      const evidence = field === 'prSnapshot' ? ref(report, 'main').ownership : ref(report, 'main').recovery;
      assert.equal(evidence.state, 'unknown');
    }
  }
});

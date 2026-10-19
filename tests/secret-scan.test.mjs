import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, constants, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SystemGit } from '../scripts/secret-scan.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'secret-scan.mjs');
const syntheticValue = 'Q7m2R9v4N8k6P3s5L1d0';

function runSecretScan(...args) {
  return spawnSync('node', [scriptPath, ...args], {
 cwd: repoRoot,
 encoding: 'utf8',
  });
}

function scanFixture(relativePath, content) {
  const dir = mkdtempSync(path.join(tmpdir(), 'crystalball-secret-scan-'));
  const filePath = path.join(dir, relativePath);

  try {
 mkdirSync(path.dirname(filePath), { recursive: true });
 writeFileSync(filePath, content, 'utf8');
 return runSecretScan('--files', filePath);
  } finally {
 rmSync(dir, { recursive: true, force: true });
  }
}

test('secret scan fails on committed credential-looking values', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crystalball-secret-scan-'));
  const filePath = path.join(dir, 'leak.env');

  try {
 writeFileSync(filePath, 'OPENAI_API_KEY=prod-super-secret-key\n', 'utf8'); // secret-scan: allow -- synthetic fixture literal; generated file is unwaived

 const result = runSecretScan('--files', filePath);

 assert.equal(result.status, 1, result.stdout + result.stderr);
 assert.match(result.stderr, /OPENAI_API_KEY/, 'scanner should report the leaked key name');
  } finally {
 rmSync(dir, { recursive: true, force: true });
  }
});

for (const relativePath of [
  'config.env',
  'test/config.env',
  'tests/config.env',
  'e2e/config.env',
  'src/config.test.ts',
  'src/config.spec.ts',
]) {
  test(`secret scan detects structured assignments in ${relativePath}`, () => {
 const result = scanFixture(relativePath, `OPENAI_API_KEY=${syntheticValue}\n`);

 assert.equal(result.status, 1, result.stdout + result.stderr);
 assert.match(result.stderr, /Structured secret assignment for OPENAI_API_KEY/);
  });
}

for (const relativePath of ['client.env', 'tests/client.test.ts']) {
  test(`secret scan detects VITE token assignments in ${relativePath}`, () => {
 const result = scanFixture(relativePath, `VITE_SESSION_TOKEN=${syntheticValue}\n`);

 assert.equal(result.status, 1, result.stdout + result.stderr);
 assert.match(result.stderr, /Structured secret assignment for VITE_SESSION_TOKEN/);
  });
}

for (const { label, value, content, reason } of [
  {
 label: 'structured assignments',
 value: syntheticValue,
 content: `VITE_SESSION_TOKEN=${syntheticValue}\n`,
 reason: /Structured secret assignment for VITE_SESSION_TOKEN/,
  },
  {
 label: 'provider tokens',
 value: `ghp_${syntheticValue}`,
 content: `ghp_${syntheticValue}\n`,
 reason: /GitHub personal token/,
  },
]) {
  test(`secret scan redacts ${label} from diagnostics`, () => {
 const result = scanFixture('redacted.env', content);
 const output = result.stdout + result.stderr;

 assert.equal(result.status, 1, output);
 assert.match(result.stderr, /redacted\.env:1 /);
 assert.match(result.stderr, reason);
 assert.equal(output.includes(value), false, 'scanner diagnostics must not contain the credential value');
  });
}

test('secret scan allows placeholders and explicit waivers', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crystalball-secret-scan-'));
  const placeholderPath = path.join(dir, 'placeholder.env');
  const waivedPath = path.join(dir, 'waived.ts');

  try {
 writeFileSync(placeholderPath, 'OPENAI_API_KEY=your-openai-key-here\n', 'utf8');
 writeFileSync(
 waivedPath,
 'const fixture = "OPENAI_API_KEY=prod-super-secret-key"; // secret-scan: allow -- intentional synthetic fixture\n',
 'utf8',
 );

 const result = runSecretScan('--files', placeholderPath, waivedPath);

 assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
 rmSync(dir, { recursive: true, force: true });
  }
});

for (const relativePath of ['config.env', 'tests/config.env', 'src/config.spec.ts']) {
  for (const [label, value] of [
 ['placeholders', 'your-token-here'],
 ['shell environment references', '${SESSION_TOKEN}'],
 ['command substitutions', '$(get-token)'],
 ['process environment references', 'process.env.SESSION_TOKEN'],
 ['Vite environment references', 'import.meta.env.VITE_SESSION_TOKEN'],
  ]) {
 test(`secret scan allows ${label} in ${relativePath}`, () => {
 const content = ['OPENAI_API_KEY', 'VITE_SESSION_TOKEN']
 .map((name) => `${name}=${value}\n`)
 .join('');
 const result = scanFixture(relativePath, content);

 assert.equal(result.status, 0, result.stdout + result.stderr);
 });
  }
}

for (const relativePath of ['waived.env', 'tests/waived.test.ts']) {
  test(`secret scan preserves explicit line waivers in ${relativePath}`, () => {
 const result = scanFixture(
 relativePath,
 `VITE_SESSION_TOKEN=${syntheticValue} // secret-scan: allow -- intentional synthetic fixture\n`,
 );

 assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}

for (const [relativePath, content] of [
  [
 'adjacent.env',
 `OPENAI_API_KEY=${syntheticValue} # secret-scan: allow -- intentional synthetic fixture\nANTHROPIC_API_KEY=${syntheticValue}\n`,
  ],
  [
 'tests/adjacent.test.ts',
 `const waived = "OPENAI_API_KEY=${syntheticValue}"; // secret-scan: allow -- intentional synthetic fixture\nconst adjacent = "ANTHROPIC_API_KEY=${syntheticValue}";\n`,
  ],
]) {
  test(`secret scan applies waivers only to the assignment line in ${relativePath}`, () => {
 const result = scanFixture(relativePath, content);

 assert.equal(result.status, 1, result.stdout + result.stderr);
 assert.match(result.stderr, /:2 Structured secret assignment for ANTHROPIC_API_KEY/);
 assert.doesNotMatch(result.stderr, /Structured secret assignment for OPENAI_API_KEY/);
  });
}

test('secret scan fails on private key material', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crystalball-secret-scan-'));
  const filePath = path.join(dir, 'private-key.pem');

  try {
 writeFileSync(
 filePath,
 '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\n', // secret-scan: allow
 'utf8',
 );

 const result = runSecretScan('--files', filePath);

 assert.equal(result.status, 1, result.stdout + result.stderr);
 assert.match(result.stderr, /Private key material/, 'scanner should block private key material');
  } finally {
 rmSync(dir, { recursive: true, force: true });
  }
});

function withSyntheticRepository(callback) {
  const dir = mkdtempSync(path.join(tmpdir(), 'crystalball-system-git-'));
  const ownedRepo = path.join(dir, 'owned repo');
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('GIT_')) delete env[name];
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = path.join(dir, 'absent-gitconfig');

  try {
    execFileSync('/usr/bin/git', ['init', '--quiet', '--template=', ownedRepo], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    return callback({ dir, ownedRepo, env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const searchPath of ['empty', 'missing', 'relative', 'malicious']) {
  test(`secret scan ignores ${searchPath} PATH for Git selection`, () => {
    withSyntheticRepository(({ dir, ownedRepo, env }) => {
      const cleanPath = path.join(ownedRepo, 'clean.env');
      const markerPath = path.join(dir, 'project-git-executed');
      const projectBin = path.join(ownedRepo, 'project-bin');
      mkdirSync(projectBin);
      const projectGit = path.join(projectBin, 'git');
      writeFileSync(projectGit, [
        `#!${process.execPath}`,
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(markerPath)}, 'unexpected Git execution');`,
        'process.exitCode = 42;',
        '',
      ].join('\n'));
      chmodSync(projectGit, 0o755);
      writeFileSync(cleanPath, 'APP_MODE=local\n');
      if (searchPath === 'missing') delete env.PATH;
      if (searchPath === 'empty') env.PATH = '';
      if (searchPath === 'relative') env.PATH = 'project-bin';
      if (searchPath === 'malicious') env.PATH = projectBin;

      const result = spawnSync(process.execPath, [scriptPath, '--files', cleanPath], {
        cwd: ownedRepo,
        env,
        encoding: 'utf8',
      });

      assert.equal(existsSync(markerPath), false, 'project-supplied Git must never execute');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Secret scan passed for 1 file\(s\)\./);
    });
  });
}

function installationFixture(platform = 'darwin', callerUid = 501) {
  const entries = new Map(['/', '/usr', '/usr/bin', '/usr/bin/git'].map((filePath) => [filePath, {
    kind: filePath === '/usr/bin/git' ? 'file' : 'directory',
    uid: 0,
    mode: 0o755,
  }]));
  const writable = new Set();
  const accessErrors = new Map();
  const calls = [];
  const options = {
    platform,
    callerUid,
    realpath(filePath) {
      calls.push(['realpath', filePath]);
      return filePath;
    },
    lstat(filePath) {
      calls.push(['lstat', filePath]);
      const entry = entries.get(filePath);
      if (!entry) throw Object.assign(new Error('Synthetic missing installation'), { code: 'ENOENT' });
      return {
        uid: entry.uid,
        mode: entry.mode,
        isFile: () => entry.kind === 'file',
        isDirectory: () => entry.kind === 'directory',
      };
    },
    access(filePath, mode) {
      calls.push(['access', filePath, mode]);
      const error = accessErrors.get(`${filePath}:${mode}`);
      if (error) throw error;
      if (mode === constants.W_OK && !writable.has(filePath)) {
        throw Object.assign(new Error('Synthetic write denial'), { code: 'EACCES' });
      }
    },
  };
  return { entries, writable, accessErrors, calls, options };
}

for (const platform of ['darwin', 'linux']) {
  test(`system Git accepts a protected ${platform} installation`, () => {
    const fixture = installationFixture(platform);

    assert.doesNotThrow(() => SystemGit.validateInstallation(fixture.options));
    assert.deepEqual(fixture.calls, [
      ['realpath', '/usr/bin/git'],
      ['lstat', '/'], ['access', '/', constants.W_OK],
      ['lstat', '/usr'], ['access', '/usr', constants.W_OK],
      ['lstat', '/usr/bin'], ['access', '/usr/bin', constants.W_OK],
      ['lstat', '/usr/bin/git'], ['access', '/usr/bin/git', constants.X_OK],
      ['access', '/usr/bin/git', constants.W_OK],
    ]);
  });
}

for (const platform of ['win32', 'freebsd', 'aix']) {
  test(`system Git explicitly rejects unsupported ${platform}`, () => {
    const fixture = installationFixture(platform);

    assert.throws(() => SystemGit.validateInstallation(fixture.options), /native Windows and custom Git installations are unsupported/);
    assert.deepEqual(fixture.calls, [], 'unsupported platforms must not probe installation paths');
  });
}

for (const callerUid of [null, -1, 1.5, Number.NaN]) {
  test(`system Git rejects invalid caller identity ${callerUid}`, () => {
    const fixture = installationFixture('linux', callerUid);

    assert.throws(() => SystemGit.validateInstallation(fixture.options), /requires protected/);
    assert.deepEqual(fixture.calls, []);
  });
}

test('system Git rejects a canonical path outside the fixed installation', () => {
  const fixture = installationFixture();
  fixture.options.realpath = () => '/opt/homebrew/bin/git';

  assert.throws(() => SystemGit.validateInstallation(fixture.options), /canonical/);
  assert.deepEqual(fixture.calls, []);
});

test('system Git fails closed when canonicalization fails', () => {
  const fixture = installationFixture();
  const failure = Object.assign(new Error('Synthetic missing Git'), { code: 'ENOENT' });
  fixture.options.realpath = () => { throw failure; };

  assert.throws(() => SystemGit.validateInstallation(fixture.options), failure);
});

for (const filePath of ['/', '/usr', '/usr/bin', '/usr/bin/git']) {
  for (const [label, change] of [
    ['non-root ownership', { uid: 501 }],
    ['group writability', { mode: 0o775 }],
    ['world writability', { mode: 0o757 }],
    ['symlink', { kind: 'symlink' }],
    ['wrong object type', { kind: filePath === '/usr/bin/git' ? 'directory' : 'file' }],
  ]) {
    test(`system Git rejects ${label} at ${filePath}`, () => {
      const fixture = installationFixture();
      Object.assign(fixture.entries.get(filePath), change);

      assert.throws(() => SystemGit.validateInstallation(fixture.options), /protected root-owned/);
    });
  }

  test(`system Git rejects missing ${filePath}`, () => {
    const fixture = installationFixture();
    fixture.entries.delete(filePath);

    assert.throws(() => SystemGit.validateInstallation(fixture.options), { code: 'ENOENT' });
  });

  test(`system Git rejects effective caller write access at ${filePath}`, () => {
    const fixture = installationFixture();
    fixture.writable.add(filePath);

    assert.throws(() => SystemGit.validateInstallation(fixture.options), /caller-writable/);
  });
}

test('system Git rejects an inaccessible executable', () => {
  const fixture = installationFixture();
  fixture.accessErrors.set(`/usr/bin/git:${constants.X_OK}`, Object.assign(new Error('Synthetic execute denial'), { code: 'EACCES' }));

  assert.throws(() => SystemGit.validateInstallation(fixture.options), { code: 'EACCES' });
});

for (const code of ['EPERM', 'EROFS']) {
  test(`system Git accepts explicit ${code} write denial`, () => {
    const fixture = installationFixture();
    fixture.accessErrors.set(`/usr/bin/git:${constants.W_OK}`, Object.assign(new Error('Synthetic write denial'), { code }));

    assert.doesNotThrow(() => SystemGit.validateInstallation(fixture.options));
  });
}

test('system Git fails closed on unexpected write-check errors', () => {
  const fixture = installationFixture();
  const failure = Object.assign(new Error('Synthetic I/O failure'), { code: 'EIO' });
  fixture.accessErrors.set(`/usr/bin/git:${constants.W_OK}`, failure);

  assert.throws(() => SystemGit.validateInstallation(fixture.options), failure);
});

test('privileged callers still require protected metadata without an impossible write denial', () => {
  const fixture = installationFixture('linux', 0);

  assert.doesNotThrow(() => SystemGit.validateInstallation(fixture.options));
  assert.equal(fixture.calls.some(([operation, , mode]) => operation === 'access' && mode === constants.W_OK), false);
  fixture.entries.get('/usr/bin/git').mode = 0o777;
  assert.throws(() => SystemGit.validateInstallation(fixture.options), /protected root-owned/);
});

test('system Git validates trust before executing a command', (context) => {
  withSyntheticRepository(({ ownedRepo, env }) => {
    const failure = new Error('Synthetic untrusted installation');
    context.mock.method(SystemGit, 'validateInstallation', () => { throw failure; });

    assert.throws(() => SystemGit.execute(['rev-parse', '--show-toplevel'], {
      cwd: ownedRepo, env, encoding: 'utf8',
    }), failure);
  });
});

test('system Git preserves all three commands, working directories, encoding and output parsing', (context) => {
  const ownedRepo = path.join(tmpdir(), 'synthetic owned repo');
  const calls = [];
  context.mock.method(SystemGit, 'execute', (args, options) => {
    calls.push({ args, options });
    return args[0] === 'rev-parse' ? `${ownedRepo}\n` : 'first.env\n\nnested/second.env\n';
  });

  assert.equal(SystemGit.findRepoRoot(), ownedRepo);
  assert.deepEqual(SystemGit.listRepoFiles(ownedRepo), [path.join(ownedRepo, 'first.env'), path.join(ownedRepo, 'nested/second.env')]);
  assert.deepEqual(SystemGit.listStagedFiles(ownedRepo), [path.join(ownedRepo, 'first.env'), path.join(ownedRepo, 'nested/second.env')]);
  assert.deepEqual(calls, [
    { args: ['rev-parse', '--show-toplevel'], options: { encoding: 'utf8' } },
    { args: ['ls-files', '--cached', '--others', '--exclude-standard'], options: { cwd: ownedRepo, encoding: 'utf8' } },
    { args: ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], options: { cwd: ownedRepo, encoding: 'utf8' } },
  ]);
});

test('real CLI preserves explicit, staged and repository selection from a nested working directory', () => {
  withSyntheticRepository(({ ownedRepo, env }) => {
    const nested = path.join(ownedRepo, 'nested');
    mkdirSync(nested);
    writeFileSync(path.join(ownedRepo, 'clean.env'), 'APP_MODE=local\n');
    writeFileSync(path.join(ownedRepo, 'untracked.env'), `OPENAI_API_KEY=${syntheticValue}\n`);
    execFileSync('/usr/bin/git', ['add', '--', 'clean.env'], { cwd: ownedRepo, env, encoding: 'utf8' });
    const run = (...args) => spawnSync(process.execPath, [scriptPath, ...args], { cwd: nested, env, encoding: 'utf8' });

    for (const args of [['--files', '../clean.env'], ['--staged'], ['--staged', '--files', '../clean.env']]) {
      const result = run(...args);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Secret scan passed for 1 file\(s\)\./);
    }
    const result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /untracked\.env:1 Structured secret assignment for OPENAI_API_KEY/);
    assert.equal(result.stdout, '', 'failed repository scan must never print success');
    assert.equal(result.stderr.includes(syntheticValue), false);
  });
});

test('module import does not run the scanner', () => {
  withSyntheticRepository(({ dir, env }) => {
    env.PATH = '';
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(scriptPath).href)});`], {
      cwd: dir, env, encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout + result.stderr, '');
  });
});

for (const nodeArgs of [[], ['--preserve-symlinks-main']]) {
  test(`direct symlink invocation still enforces scanning with ${nodeArgs.join(' ') || 'default resolution'}`, () => {
    withSyntheticRepository(({ ownedRepo, env }) => {
      const entry = path.join(ownedRepo, 'scanner-link.mjs');
      const fixture = path.join(ownedRepo, 'leak.env');
      symlinkSync(scriptPath, entry);
      writeFileSync(fixture, `OPENAI_API_KEY=${syntheticValue}\n`);
      const result = spawnSync(process.execPath, [...nodeArgs, entry, '--files', fixture], { cwd: ownedRepo, env, encoding: 'utf8' });

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /Structured secret assignment for OPENAI_API_KEY/);
      assert.equal(result.stdout, '');
    });
  });
}

for (const [label, body, detected] of [
  ['19 characters', 'A'.repeat(19), false],
  ['20 characters', 'A'.repeat(20), true],
  ['21 characters', 'A'.repeat(21), true],
  ...['_', 'a', 'Z', '0', 'é', 'K', '-', '\\', ']', '^'].map((character) => [
    `internal ${character}`, `${'A'.repeat(9)}${character}${'7'.repeat(10)}`, /^[A-Za-z0-9_]$/.test(character),
  ]),
]) {
  test(`fine-grained GitHub character class preserves ${label}`, () => {
    const token = `${'github'}_pat_${body}`;
    const result = scanFixture('fine-grained.txt', `${token}\n`);

    assert.equal(result.status, detected ? 1 : 0, result.stdout + result.stderr);
    assert.equal(result.stderr.includes('GitHub fine-grained token'), detected);
    assert.equal((result.stdout + result.stderr).includes(token), false);
  });
}

test('fine-grained GitHub detection preserves the initial word boundary', () => {
  const result = scanFixture('boundary.txt', `x${'github'}_pat_${'A'.repeat(20)}\n`);

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const [prefix, detected] of [
  ['', true], ['RSA ', true], ['EC ', true], ['DSA ', true], ['OPENSSH ', true], ['PGP ', true],
  ['ED25519 ', false], ['rsa ', false], ['RSA  ', false], [' RSA ', false],
]) {
  test(`private-key prefix equivalence for ${JSON.stringify(prefix)}`, () => {
    const header = ['-----BEGIN', `${prefix}PRIVATE KEY-----`].join(' ');
    const result = scanFixture('header.pem', `${header}\nsynthetic-body\n`);

    assert.equal(result.status, detected ? 1 : 0, result.stdout + result.stderr);
    assert.equal(result.stderr.includes('Private key material'), detected);
    assert.equal((result.stdout + result.stderr).includes(header), false);
  });
}

for (const [character, detected] of [
  ['A', true], ['0', true], ['\\', true], [']', true], ['^', true], ['_', true],
  ['-', false], ['[', false], ['é', false], ['~', false],
]) {
  test(`untouched Google character class preserves internal ${JSON.stringify(character)}`, () => {
    const token = `${'AI'}za${'A'.repeat(17)}${character}${'8'.repeat(17)}`;
    const result = scanFixture('google.txt', `${token}\n`);

    assert.equal(result.status, detected ? 1 : 0, result.stdout + result.stderr);
    assert.equal(result.stderr.includes('Google API key'), detected);
    assert.equal((result.stdout + result.stderr).includes(token), false);
  });
}

test('failure status waits for the complete redacted report and never prints success', () => {
  const findingCount = 1600;
  const result = scanFixture('complete.env', `VITE_SESSION_TOKEN=${syntheticValue}\n`.repeat(findingCount));

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`complete\\.env:${findingCount} Structured secret assignment for VITE_SESSION_TOKEN`));
  assert.equal(result.stderr.match(/Structured secret assignment for VITE_SESSION_TOKEN/g)?.length, findingCount);
  assert.equal(result.stderr.includes(syntheticValue), false);
});

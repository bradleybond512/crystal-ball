// R4-BUG-006: backup-keys.sh / restore-keys.sh against the consolidated
// `secrets-vault` item. Every Keychain and crypto tool is a STUB on PATH in a
// throwaway HOME: the real Keychain is never reachable from this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeVaults, normalizeVault, supportedKeys } from '../scripts/vault-json.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BACKUP = path.join(ROOT, 'scripts/backup-keys.sh');
const RESTORE = path.join(ROOT, 'scripts/restore-keys.sh');
const SECRET_A = 'gsk-TEST-secret-value-aaaa';
const SECRET_B = 'na-TEST-secret-value-bbbb';
const SECRET_C = 'or-TEST-secret-value-cccc';
const SECRETS = [SECRET_A, SECRET_B, SECRET_C, 'old-TEST-value'];

// security stub: items are files in $STUB/items/<account>; every invocation's
// argv is logged; `-i` commands are read from stdin and logged separately.
const SECURITY_STUB = `#!/bin/bash
echo "$*" >> "$STUB/argv.log"
if [[ "$1" == "-i" ]]; then
  while IFS= read -r line; do
    echo "$line" >> "$STUB/interactive.log"
    set -- $line
    [[ "$1" == "add-generic-password" ]] || continue
    [[ -n "$STUB_WRITE_FAIL" ]] && continue
    shift; account=""; hex=""
    while [[ $# -gt 0 ]]; do
      case "$1" in -a) account="$2"; shift 2;; -X) hex="$2"; shift 2;; *) shift;; esac
    done
    node -e 'process.stdout.write(Buffer.from(process.argv[1], "hex"))' "$hex" > "$STUB/items/$account"
  done
  exit 0
fi
if [[ "$1" == "find-generic-password" ]]; then
  [[ -n "$STUB_DENY" ]] && exit 51
  account=""
  while [[ $# -gt 0 ]]; do case "$1" in -a) account="$2"; shift 2;; *) shift;; esac; done
  [[ -f "$STUB/items/$account" ]] || exit 44
  cat "$STUB/items/$account"; exit 0
fi
exit 2
`;
// age stub: "encrypts" by base64 with a marker; -d reverses it. STUB_AGE_FAIL
// fails decryption, and fails encryption after writing a partial output file
// (an interrupted run).
const AGE_STUB = `#!/bin/bash
if [[ -n "$STUB_AGE_FAIL" ]]; then
  [[ "$1" == "-d" ]] && exit 1
  while [[ $# -gt 0 ]]; do case "$1" in -o) echo PARTIAL > "$2"; shift 2;; *) shift;; esac; done
  exit 1
fi
if [[ "$1" == "-d" ]]; then
  tail -n +2 "\${@: -1}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(Buffer.from(s,"base64")))'
  exit 0
fi
out=""
while [[ $# -gt 0 ]]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done
{ echo "AGE-STUB"; node -e 'let b=[];process.stdin.on("data",d=>b.push(d)).on("end",()=>process.stdout.write(Buffer.concat(b).toString("base64")))'; } > "$out"
`;
const PGREP_STUB = `#!/bin/bash
[[ -f "$STUB/running" ]] && exit 0
exit 1
`;

function sandbox(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-keys-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const stub = path.join(dir, 'stub');
  const home = path.join(dir, 'home');
  const tmp = path.join(dir, 'tmp');
  for (const d of [bin, path.join(stub, 'items'), path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs'), tmp]) mkdirSync(d, { recursive: true });
  for (const [name, body] of [['security', SECURITY_STUB], ['age', AGE_STUB], ['pgrep', PGREP_STUB]]) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const env = {
    PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home,
    TMPDIR: tmp,
    STUB: stub,
    LANG: 'C',
  };
  // Hard stop: the scripts must only ever reach the stub, never /usr/bin/security.
  for (const tool of ['security', 'age', 'pgrep']) {
    const resolved = spawnSync('bash', ['-c', `command -v ${tool}`], { env, encoding: 'utf8' }).stdout.trim();
    if (resolved !== path.join(bin, tool)) throw new Error(`${tool} resolves to ${resolved}, not the stub; refusing to run`);
  }
  const icloud = path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs/CrystalBall');
  return {
    stub,
    icloud,
    tmp,
    setItem(account, content) { writeFileSync(path.join(stub, 'items', account), content); },
    item(account) {
      const file = path.join(stub, 'items', account);
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
    log(name) {
      const file = path.join(stub, name);
      return existsSync(file) ? readFileSync(file, 'utf8') : '';
    },
    run(script, args = [], { input = '', extraEnv = {} } = {}) {
      const r = spawnSync('bash', [script, ...args], { env: { ...env, ...extraEnv }, input, encoding: 'utf8', cwd: ROOT });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    },
    backups() { return existsSync(icloud) ? readdirSync(icloud) : []; },
    decodeBackup(file) {
      const body = readFileSync(path.join(icloud, file), 'utf8').split('\n').slice(1).join('\n');
      return JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
    },
    writeBackup(name, content) {
      const file = path.join(dir, name);
      writeFileSync(file, `AGE-STUB\n${Buffer.from(content).toString('base64')}`);
      return file;
    },
  };
}

function assertNoSecrets(text, label) {
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, `${label} leaked a secret value`);
}

function assertTmpClean(box) {
  for (const entry of readdirSync(box.tmp, { recursive: true })) {
    const file = path.join(box.tmp, entry);
    if (lstatSync(file).isFile()) assertNoSecrets(readFileSync(file, 'utf8'), `TMPDIR file ${entry}`);
  }
}

const VAULT = JSON.stringify({ NEWSAPI_KEY: SECRET_B, GROQ_API_KEY: SECRET_A });

test('backup reads the secrets-vault item and encrypts it from memory', (t) => {
  const box = sandbox(t);
  box.setItem('secrets-vault', VAULT);
  const r = box.run(BACKUP);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Found 2 keys in the secrets-vault item/);
  assert.match(r.out, /GROQ_API_KEY/);
  assertNoSecrets(r.out, 'backup output');
  const files = box.backups();
  assert.equal(files.length, 1);
  assert.match(files[0], /^keys-backup-\d{8}-age\.enc$/);
  assert.equal(lstatSync(path.join(box.icloud, files[0])).mode & 0o777, 0o600);
  assert.deepEqual(box.decodeBackup(files[0]), { GROQ_API_KEY: SECRET_A, NEWSAPI_KEY: SECRET_B });
  assert.doesNotMatch(box.log('argv.log'), /-a (GROQ|NEWSAPI)/, 'no per-key reads when the vault exists');
  assertNoSecrets(box.log('argv.log'), 'security argv');
  assertTmpClean(box);
});

test('backup decodes the hex form security prints for non-ASCII data', (t) => {
  const box = sandbox(t);
  box.setItem('secrets-vault', Buffer.from(VAULT).toString('hex'));
  const r = box.run(BACKUP);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(box.decodeBackup(box.backups()[0]), { GROQ_API_KEY: SECRET_A, NEWSAPI_KEY: SECRET_B });
});

test('without a vault item, backup falls back to legacy per-key items', (t) => {
  const box = sandbox(t);
  box.setItem('GROQ_API_KEY', SECRET_A);
  box.setItem('OPENROUTER_API_KEY', SECRET_C);
  const r = box.run(BACKUP);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /legacy per-key items/);
  assert.deepEqual(box.decodeBackup(box.backups()[0]), { GROQ_API_KEY: SECRET_A, OPENROUTER_API_KEY: SECRET_C });
  assertNoSecrets(r.out, 'backup output');
});

test('no vault and no legacy items: exit 2, nothing written', (t) => {
  const box = sandbox(t);
  const r = box.run(BACKUP);
  assert.equal(r.status, 2, r.out);
  assert.deepEqual(box.backups(), []);
});

test('a malformed vault is rejected without echoing it and without writing a file', (t) => {
  const box = sandbox(t);
  box.setItem('secrets-vault', `{"GROQ_API_KEY": "${SECRET_A}", broken`);
  const r = box.run(BACKUP);
  assert.equal(r.status, 1, r.out);
  assertNoSecrets(r.out, 'error output');
  assert.deepEqual(box.backups(), []);
});

test('denied Keychain access never falls back to a stale legacy subset', (t) => {
  const box = sandbox(t);
  box.setItem('GROQ_API_KEY', SECRET_A);
  const r = box.run(BACKUP, [], { extraEnv: { STUB_DENY: '1' } });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Could not read the secrets-vault/);
  assert.doesNotMatch(box.log('argv.log'), /-a GROQ_API_KEY/);
  assert.deepEqual(box.backups(), []);
});

test('a failed encryption removes its partial file and keeps an existing backup', (t) => {
  const box = sandbox(t);
  box.setItem('secrets-vault', VAULT);
  assert.equal(box.run(BACKUP).status, 0);
  const [file] = box.backups();
  const before = readFileSync(path.join(box.icloud, file), 'utf8');
  const r = box.run(BACKUP, [], { extraEnv: { STUB_AGE_FAIL: '1' } });
  assert.notEqual(r.status, 0);
  assert.deepEqual(box.backups(), [file], 'no partial file left behind');
  assert.equal(readFileSync(path.join(box.icloud, file), 'utf8'), before, 'the good backup survived');
});

test('--dry-run lists names and writes nothing', (t) => {
  const box = sandbox(t);
  box.setItem('secrets-vault', VAULT);
  const r = box.run(BACKUP, ['--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /\[dry-run\]/);
  assert.deepEqual(box.backups(), []);
});

test('restore --verify lists names without touching the Keychain', (t) => {
  const box = sandbox(t);
  const file = box.writeBackup('keys-backup-20260930-age.enc', VAULT);
  const r = box.run(RESTORE, ['--verify', file]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Total: 2 keys/);
  assert.match(r.out, /NEWSAPI_KEY/);
  assertNoSecrets(r.out, 'verify output');
  assert.equal(box.log('argv.log'), '', 'zero security calls');
});

test('restore merges by default: backup wins on the same name, newer keys are kept', (t) => {
  const box = sandbox(t);
  box.setItem('secrets-vault', JSON.stringify({ GROQ_API_KEY: 'old-TEST-value', OPENROUTER_API_KEY: SECRET_C }));
  const file = box.writeBackup('keys-backup-20260930-age.enc', VAULT);
  const r = box.run(RESTORE, [file], { input: 'y\n' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /1 added \(NEWSAPI_KEY\), 1 updated \(GROQ_API_KEY\), 1 kept from the current vault \(OPENROUTER_API_KEY\)/);
  assert.deepEqual(JSON.parse(box.item('secrets-vault')), { GROQ_API_KEY: SECRET_A, NEWSAPI_KEY: SECRET_B, OPENROUTER_API_KEY: SECRET_C });
  assert.match(r.out, /now holds 3 keys \(confirmed by reading it back\)/);
  assertNoSecrets(r.out, 'restore output');
  assertNoSecrets(box.log('argv.log'), 'security argv');
  assert.match(box.log('interactive.log'), /^add-generic-password -U -s crystal-ball -a secrets-vault -X [0-9a-f]+$/m);
  assertNoSecrets(box.log('interactive.log'), 'security stdin (hex only)');
  assertTmpClean(box);
});

test('restore --replace writes the backup exactly', (t) => {
  const box = sandbox(t);
  box.setItem('secrets-vault', JSON.stringify({ OPENROUTER_API_KEY: SECRET_C }));
  const file = box.writeBackup('keys-backup-20260930-age.enc', VAULT);
  const r = box.run(RESTORE, ['--replace', file], { input: 'y\n' });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(JSON.parse(box.item('secrets-vault')), { GROQ_API_KEY: SECRET_A, NEWSAPI_KEY: SECRET_B });
});

test('restore refuses while Crystal Ball is running', (t) => {
  const box = sandbox(t);
  writeFileSync(path.join(box.stub, 'running'), '');
  box.setItem('secrets-vault', JSON.stringify({ OPENROUTER_API_KEY: SECRET_C }));
  const file = box.writeBackup('keys-backup-20260930-age.enc', VAULT);
  const r = box.run(RESTORE, [file], { input: 'y\n' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Quit it first/);
  assert.equal(box.log('interactive.log'), '');
  assert.deepEqual(JSON.parse(box.item('secrets-vault')), { OPENROUTER_API_KEY: SECRET_C });
});

test('answering anything but yes writes nothing', (t) => {
  const box = sandbox(t);
  const file = box.writeBackup('keys-backup-20260930-age.enc', VAULT);
  for (const answer of ['n\n', '\n', 'yess\n', '']) {
    const r = box.run(RESTORE, [file], { input: answer });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Aborted/);
  }
  assert.equal(box.item('secrets-vault'), null);
});

test('restore accepts the manual vault-YYYYMMDD.age backup and the legacy KEY=value format', (t) => {
  const box = sandbox(t);
  const manual = box.writeBackup('vault-20260929.age', VAULT);
  assert.equal(box.run(RESTORE, [manual], { input: 'y\n' }).status, 0);
  assert.deepEqual(JSON.parse(box.item('secrets-vault')), { GROQ_API_KEY: SECRET_A, NEWSAPI_KEY: SECRET_B });
  const legacy = box.writeBackup('keys-backup-20260101-age.enc', `OPENROUTER_API_KEY=${SECRET_C}\n`);
  const r = box.run(RESTORE, [legacy], { input: 'yes\n' });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(JSON.parse(box.item('secrets-vault')), { GROQ_API_KEY: SECRET_A, NEWSAPI_KEY: SECRET_B, OPENROUTER_API_KEY: SECRET_C });
});

test('a write that did not land (security -i swallowing an error) is reported, not claimed', (t) => {
  const box = sandbox(t);
  box.setItem('secrets-vault', JSON.stringify({ OPENROUTER_API_KEY: SECRET_C }));
  const file = box.writeBackup('keys-backup-20260930-age.enc', VAULT);
  const r = box.run(RESTORE, [file], { input: 'y\n', extraEnv: { STUB_WRITE_FAIL: '1' } });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /does not match/);
  assert.doesNotMatch(r.out, /Restored:/);
  assertNoSecrets(r.out, 'failure output');
});

test('a wrong passphrase or corrupt backup writes nothing', (t) => {
  const box = sandbox(t);
  const file = box.writeBackup('keys-backup-20260930-age.enc', VAULT);
  const r = box.run(RESTORE, [file], { input: 'y\n', extraEnv: { STUB_AGE_FAIL: '1' } });
  assert.equal(r.status, 1, r.out);
  assert.equal(box.item('secrets-vault'), null);
});

test('vault helper: normalization, merge and the app key list', () => {
  assert.deepEqual(normalizeVault(' {"B":" x ","A":"y","E":""} '), { A: 'y', B: 'x' });
  assert.deepEqual(normalizeVault(Buffer.from('{"A":"y"}').toString('hex')), { A: 'y' });
  assert.deepEqual(normalizeVault('A=1\nB=x=y\n'), { A: '1', B: 'x=y' });
  for (const [bad, message] of [
    ['{"a":"lowercase"}', /invalid key name/],
    ['{"A":1}', /value for A is not a string/],
    ['{"A":{"nested":"x"}}', /value for A is not a string/],
    ['[]', /not an object/],
    ['{bad', /not valid JSON/],
    ['no-equals-line', /not KEY=value/],
  ]) {
    assert.throws(() => normalizeVault(bad), message, bad);
  }
  assert.deepEqual(mergeVaults({ A: '1', C: '3' }, { A: '9', B: '2' }), {
    merged: { A: '9', B: '2', C: '3' }, added: ['B'], updated: ['A'], kept: ['C'],
  });
  const names = supportedKeys(readFileSync(path.join(ROOT, 'src-tauri/src/main.rs'), 'utf8'));
  assert.ok(names.length >= 70 && names.includes('ANTHROPIC_API_KEY'), 'reads SUPPORTED_SECRET_KEYS from main.rs');
});

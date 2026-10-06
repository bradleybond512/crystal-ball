// R4-BUG-006: backup-keys.sh / restore-keys.sh against the consolidated
// `secrets-vault` item. Every Keychain and crypto tool is a STUB on PATH in a
// throwaway HOME: the real Keychain is never reachable from this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  [[ -n "$STUB_DENY_ACCOUNTS" && ",$STUB_DENY_ACCOUNTS," == *",$account,"* ]] && exit 51
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
// openssl stub: "enc" stores base64 behind a marker (-d reverses it;
// STUB_OPENSSL_FAIL fails after writing a partial file). "dgst -hmac" is a real
// HMAC-SHA256 over the file, so a wrong passphrase or a mismatched sidecar is
// rejected by restore exactly as with the real tool.
const OPENSSL_STUB = `#!/bin/bash
cmd="$1"; shift
if [[ "$cmd" == "enc" ]]; then
  decrypt=0; out=""; in=""
  while [[ $# -gt 0 ]]; do case "$1" in -d) decrypt=1; shift;; -out) out="$2"; shift 2;; -in) in="$2"; shift 2;; *) shift;; esac; done
  if (( decrypt == 1 )); then
    tail -n +2 "$in" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(Buffer.from(s,"base64")))'
    exit 0
  fi
  if [[ -n "$STUB_OPENSSL_FAIL" ]]; then echo PARTIAL > "$out"; exit 1; fi
  { echo "OPENSSL-STUB"; node -e 'let b=[];process.stdin.on("data",d=>b.push(d)).on("end",()=>process.stdout.write(Buffer.concat(b).toString("base64")))'; } > "$out"
  exit 0
fi
if [[ "$cmd" == "dgst" ]]; then
  key=""; file=""
  while [[ $# -gt 0 ]]; do case "$1" in -hmac) key="$2"; shift 2;; -*) shift;; *) file="$1"; shift;; esac; done
  node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHmac("sha256",process.argv[1]).update(f.readFileSync(process.argv[2])).digest())' "$key" "$file"
  exit 0
fi
exit 2
`;
const REAL_MV = ['/bin/mv', '/usr/bin/mv'].find((p) => existsSync(p));
// mv stub (OpenSSL scenarios): the real mv, except that STUB_MV_FAIL,
// STUB_MV_TERM or STUB_MV_KILL fire when a partial file is about to be
// published onto the final -openssl.enc name, i.e. between the sidecar and the
// ciphertext renames.
const MV_STUB = `#!/bin/bash
src=""; dst=""
for a in "$@"; do
  case "$a" in -*) ;; *) if [[ -z "$src" ]]; then src="$a"; else dst="$a"; fi ;; esac
done
if [[ "$src" == *.partial.* && "$dst" == *-openssl.enc ]]; then
  [[ -n "$STUB_MV_FAIL" ]] && exit 1
  if [[ -n "$STUB_MV_TERM" ]]; then kill -TERM "$PPID"; sleep 1; exit 1; fi
  if [[ -n "$STUB_MV_KILL" ]]; then kill -KILL "$PPID"; exit 1; fi
fi
exec ${REAL_MV} "$@"
`;
// OpenSSL scenarios get the system tools minus every encryption engine and the
// stubbed commands, so the script can only pick the openssl stub even on hosts
// that have age, gpg or openssl in /usr/bin.
const HIDDEN_TOOLS = new Set(['security', 'age', 'gpg', 'gpg2', 'openssl', 'pgrep', 'mv']);
function systemBin(dir) {
  const out = path.join(dir, 'sysbin');
  mkdirSync(out);
  const seen = new Set();
  for (const src of ['/usr/bin', '/bin']) {
    if (!existsSync(src)) continue;
    for (const name of readdirSync(src)) {
      if (HIDDEN_TOOLS.has(name) || seen.has(name)) continue;
      seen.add(name);
      symlinkSync(path.join(src, name), path.join(out, name));
    }
  }
  return out;
}

function sandbox(t, { engine = 'age' } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-keys-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const stub = path.join(dir, 'stub');
  const home = path.join(dir, 'home');
  const tmp = path.join(dir, 'tmp');
  for (const d of [bin, path.join(stub, 'items'), path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs'), tmp]) mkdirSync(d, { recursive: true });
  const stubs = engine === 'openssl'
    ? [['security', SECURITY_STUB], ['openssl', OPENSSL_STUB], ['pgrep', PGREP_STUB], ['mv', MV_STUB]]
    : [['security', SECURITY_STUB], ['age', AGE_STUB], ['pgrep', PGREP_STUB]];
  for (const [name, body] of stubs) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const env = {
    PATH: `${bin}:${path.dirname(process.execPath)}:${engine === 'openssl' ? systemBin(dir) : '/usr/bin:/bin'}`,
    HOME: home,
    TMPDIR: tmp,
    STUB: stub,
    LANG: 'C',
  };
  // Hard stop: the scripts must only ever reach the stub, never /usr/bin/security.
  for (const [tool] of stubs) {
    const resolved = spawnSync('bash', ['-c', `command -v ${tool}`], { env, encoding: 'utf8' }).stdout.trim();
    if (resolved !== path.join(bin, tool)) throw new Error(`${tool} resolves to ${resolved}, not the stub; refusing to run`);
  }
  for (const tool of engine === 'openssl' ? ['age', 'gpg'] : []) {
    const resolved = spawnSync('bash', ['-c', `command -v ${tool}`], { env, encoding: 'utf8' }).stdout.trim();
    if (resolved !== '') throw new Error(`${tool} resolves to ${resolved}; the OpenSSL scenarios must not see it`);
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

test('a denied legacy key fails the backup instead of being skipped, and keeps the existing backup', (t) => {
  const box = sandbox(t);
  box.setItem('GROQ_API_KEY', SECRET_A);
  box.setItem('OPENROUTER_API_KEY', SECRET_C);
  assert.equal(box.run(BACKUP).status, 0);
  const [file] = box.backups();
  const before = readFileSync(path.join(box.icloud, file));
  const r = box.run(BACKUP, [], { extraEnv: { STUB_DENY_ACCOUNTS: 'OPENROUTER_API_KEY' } });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Could not read the legacy Keychain item OPENROUTER_API_KEY \(security exit 51\)/);
  assert.doesNotMatch(r.out, /Done\./);
  assert.deepEqual(box.backups(), [file], 'nothing new was published');
  assert.deepEqual(readFileSync(path.join(box.icloud, file)), before, 'the complete backup survived');
  assertNoSecrets(r.out, 'backup output');
  assertNoSecrets(box.log('argv.log'), 'security argv');
  assertTmpClean(box);
});

const PW_OLD = 'TEST-pass-old';
const PW_NEW = 'TEST-pass-new';
const VAULT_3 = JSON.stringify({ ...JSON.parse(VAULT), OPENROUTER_API_KEY: SECRET_C });
const opensslBackup = (box, pw, extraEnv = {}) => box.run(BACKUP, [], { input: `${pw}\n${pw}\n`, extraEnv });
const verify = (box, file, pw) => box.run(RESTORE, ['--verify', path.join(box.icloud, file)], { input: `${pw}\n` });
/** Every file in the backup folder with its exact bytes. */
const folderState = (box) => Object.fromEntries(box.backups().sort().map((f) => [f, readFileSync(path.join(box.icloud, f)).toString('base64')]));

function opensslWithPair(t) {
  const box = sandbox(t, { engine: 'openssl' });
  box.setItem('secrets-vault', VAULT);
  const first = opensslBackup(box, PW_OLD);
  assert.equal(first.status, 0, first.out);
  const before = folderState(box);
  const [enc] = Object.keys(before);
  assert.match(enc, /^keys-backup-\d{8}-openssl\.enc$/);
  assert.deepEqual(Object.keys(before), [enc, `${enc}.hmac`]);
  box.setItem('secrets-vault', VAULT_3);
  return { box, before, enc };
}

test('openssl: a successful re-run replaces both files and leaves no snapshot behind', (t) => {
  const { box, enc } = opensslWithPair(t);
  const r = opensslBackup(box, PW_NEW);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(box.backups().sort(), [enc, `${enc}.hmac`]);
  const v = verify(box, enc, PW_NEW);
  assert.equal(v.status, 0, v.out);
  assert.match(v.out, /Total: 3 keys/);
  assert.notEqual(verify(box, enc, PW_OLD).status, 0, 'the old passphrase no longer matches the new sidecar');
});

test('openssl: a failure or SIGTERM between publishing the sidecar and the ciphertext keeps the previous pair restorable', (t) => {
  for (const extraEnv of [{ STUB_MV_FAIL: '1' }, { STUB_MV_TERM: '1' }]) {
    const { box, before, enc } = opensslWithPair(t);
    const r = opensslBackup(box, PW_NEW, extraEnv);
    assert.notEqual(r.status, 0, `${JSON.stringify(extraEnv)}: ${r.out}`);
    assert.deepEqual(folderState(box), before, `${JSON.stringify(extraEnv)}: the previous pair is back in place and nothing else is left`);
    const v = verify(box, enc, PW_OLD);
    assert.equal(v.status, 0, `${JSON.stringify(extraEnv)}: ${v.out}`);
    assert.match(v.out, /Total: 2 keys/);
    assertNoSecrets(r.out, 'backup output');
    assertTmpClean(box);
  }
});

test('openssl: a run killed between the two renames keeps the previous pair restorable, and the next run refuses to touch it', (t) => {
  const { box, before, enc } = opensslWithPair(t);
  const prior = enc.replace(/-openssl\.enc$/, '-prior-openssl.enc');
  const killed = opensslBackup(box, PW_NEW, { STUB_MV_KILL: '1' });
  assert.notEqual(killed.status, 0);
  const after = folderState(box);
  assert.equal(after[prior], before[enc], 'the previous ciphertext is kept');
  assert.equal(after[`${prior}.hmac`], before[`${enc}.hmac`], 'the previous sidecar is kept');
  const v = verify(box, prior, PW_OLD);
  assert.equal(v.status, 0, v.out);
  assert.match(v.out, /Total: 2 keys/);
  const next = opensslBackup(box, PW_NEW);
  assert.equal(next.status, 1, next.out);
  assert.match(next.out, /interrupted/);
  assert.deepEqual(folderState(box), after, 'the refused run changes nothing');
  for (const [name, bytes] of Object.entries(after)) assertNoSecrets(Buffer.from(bytes, 'base64').toString('utf8'), name);
});

test('openssl: a first backup of the day that fails between the two renames leaves no half pair', (t) => {
  const box = sandbox(t, { engine: 'openssl' });
  box.setItem('secrets-vault', VAULT);
  const r = opensslBackup(box, PW_OLD, { STUB_MV_FAIL: '1' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(box.backups(), [], 'no sidecar without its ciphertext');
});

test('openssl: a failed encryption leaves the existing pair untouched and no partial files', (t) => {
  const { box, before } = opensslWithPair(t);
  const r = opensslBackup(box, PW_NEW, { STUB_OPENSSL_FAIL: '1' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(folderState(box), before);
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

# R4-BUG-006: backup and restore the consolidated `secrets-vault`

Status: approved by Bradley on September 30, 2026 ("Merge by default").
Branch `claude/r4-bug-006-vault-backup` from `a255546ee`.
Classification: High Assurance (secrets). Queue item Q5.

**Keychain rule.** Per the CLAUDE.md Keychain prohibition, agents write and
test these scripts only against a stub `security` binary. Only Bradley runs
them against the real Keychain.

## Problem (verified at a255546ee)

- The app keeps every secret in **one** Keychain item: service
  `crystal-ball`, account `secrets-vault`, a JSON object mapping key names to
  values (`main.rs:361-382`, `save_vault` at `:729`). After migrating, it
  deletes the per-key items (`:441-452`).
  `SUPPORTED_SECRET_KEYS` has 77 names.
- `scripts/backup-keys.sh` reads **29 hard-coded per-key items**. On a
  migrated install it finds 0 and exits 2, or it backs up a stale subset.
- `scripts/restore-keys.sh` writes per-key items. The app ignores those once
  a vault exists.
- Additional defects found in discovery:
  - The backup writes the plaintext to a temp file before encrypting it.
  - The restore passes each secret as `security … -w "$value"`, so every
    value is visible in `ps` while it runs.
  - The restore uses `${ans,,}`, which is a syntax error in macOS's
    built-in bash 3.2.

Your September 29 interim backup (`vault-YYYYMMDD.age`, a raw vault JSON
encrypted with age) is the right shape. The new scripts produce and accept
that shape.

## Design

**Backup (`scripts/backup-keys.sh`)**

1. Read `security find-generic-password -s crystal-ball -a secrets-vault -w`
   into a shell variable. The plaintext never goes to disk.
2. Normalize and validate with a small Node helper
   (`scripts/lib/vault-json.mjs`, stdin only):
   - it must be a JSON object of non-empty string values;
   - `security` prints hex for non-ASCII data, so hex is decoded;
   - it reports **names and a count**, never values;
   - it warns about names the app does not support.
3. Encrypt from stdin with the best engine (age, then gpg, then openssl). The
   passphrase is never in argv:
   - age and gpg prompt on the terminal;
   - openssl reads the passphrase from a pipe file descriptor.

   The output is `keys-backup-YYYYMMDD-{engine}.enc` in the iCloud
   `CrystalBall` folder, mode 0600. It is removed if encryption fails.
4. **Legacy fallback:** only when **no vault item exists**, collect the old
   per-key items. The list is the app's supported names, parsed from
   `main.rs` at run time rather than a stale hard-coded copy. They are
   converted to the same JSON shape.
5. `--dry-run` prints the count and names only, and writes nothing.

**Restore (`scripts/restore-keys.sh [--verify] [--replace] <file>`)**

1. Detect the engine from the suffix (`-age.enc`, `-gpg.enc`,
   `-openssl.enc`). A bare `.age` file (your interim backup) is also
   accepted.
2. Decrypt **to stdout into memory**, with no temp file. For openssl, the
   existing HMAC check still runs before decrypting.
3. The helper accepts either the vault JSON or the legacy `KEY=value`
   format, normalized to JSON.
4. `--verify` lists names and a count, then exits. It writes nothing and
   makes no Keychain call.
5. A real restore:
   - **refuses while Crystal Ball is running** (`pgrep -x crystalball`);
   - by default **merges**: it reads the current vault, lets backup values
     override the same names, and keeps names only present in the current
     vault. It reports added, updated and kept counts, names only.
   - `--replace` writes the backup exactly instead;
   - it asks for confirmation. The answer is parsed in bash 3.2-safe form.
6. The write uses `security -i` with the command on **stdin** and the vault
   as `-X <hex>`, so no secret appears in any process's arguments. It
   updates the existing item (`-U`), which keeps the item's existing access
   list, so the app keeps reading it without a new prompt. If the vault item
   did not exist, macOS asks once on the app's next launch. A read-back then
   confirms the written key count before the script reports success.
   (Implementation note: `-T "<app path>"` was dropped from the design because
   the app path contains a space, and `security -i` quoting could not be
   verified without the real tool.)

**Tests (`tests/keys-backup-restore.test.mjs`)**

Everything runs with stub `security`, `age`, `pgrep` and so on, first on
`PATH` in a temp HOME. The real Keychain is never reachable. Cases:

- vault present;
- legacy only;
- neither;
- malformed JSON;
- hex output;
- the plaintext never lands in `TMPDIR`, and the output file is 0600;
- no secret value in any output or in the stub's recorded argv;
- `--verify` makes zero Keychain calls;
- restore refuses while the app runs;
- merge and replace semantics;
- the interim `.age` file is accepted;
- a bash 3.2-safe confirmation.

Each behavior gets a mutation proof.

**Docs.** Update the CLAUDE.md backup and restore sections to describe the
vault.

## Non-goals

- Retiring the shadow vault (R3-SEC-003 phase B, queue item 16b).
- Any change to the app's own Keychain code.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves this design.

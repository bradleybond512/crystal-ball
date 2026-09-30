# R4-BUG-006 validation — backup and restore the `secrets-vault`

Validated September 30, 2026 on branch `claude/r4-bug-006-vault-backup`
(base `a255546ee`). Approved design (merge by default):
[plan](../plans/2026-09-30-r4-bug-006-vault-backup.md).

**No real Keychain access.** Every run used stub `security`, `age` and `pgrep`
binaries first on `PATH` in a throwaway HOME. The test refuses to start unless
`command -v security` resolves to the stub. Only Bradley runs the scripts for
real.

## Behavior

- **`backup-keys.sh`**
  - It reads the `secrets-vault` item into memory, validates it
    (`scripts/vault-json.mjs`: names and count only, hex form decoded,
    unsupported names noted) and pipes it into age, gpg or openssl. There is
    no plaintext temp file.
  - It encrypts to a `.partial` name and moves the file into place only on
    success. A failed or interrupted run removes the partial file and never
    clobbers the day's good backup.
  - It falls back to legacy per-key items (names from `SUPPORTED_SECRET_KEYS`
    in `main.rs`) **only** on item-not-found (exit 44). Denied access is an
    error.
  - `--dry-run` lists names only.
- **`restore-keys.sh`**
  - It decrypts into memory and accepts `-age.enc`, `-gpg.enc`,
    `-openssl.enc` and a bare `.age` file (the manual September 29 backup), in
    both the vault JSON and the legacy `KEY=value` format.
  - `--verify` lists names and count with zero Keychain calls.
  - It refuses while Crystal Ball runs.
  - It **merges** by default: backup values win on the same name, and newer
    keys are kept. The added, updated and kept names are reported.
    `--replace` restores the backup exactly.
  - The confirmation is bash 3.2-safe. The old `${ans,,}` failed on macOS's
    `/bin/bash`.
  - It writes via `security -i` on stdin with `-X <hex>`, so no key is in
    any argv. The old script passed each value as `-w "$value"`, visible in
    `ps`.
  - It reads the vault back and fails loudly if it does not match.
- **`CLAUDE.md`** now describes the vault backup and restore. It also corrects
  "Argon2id" to scrypt, which is what age uses for passphrases.

## Actual validation

- `npm run test:keys-backup` on macOS, where the tests run under
  `/bin/bash` 3.2.57, the shell `npm run` scripts get without Homebrew bash:
  17/17 pass.
  - The same suite passes under bash 5 in Linux.
  - Every scenario asserts that no secret value appears in output, in the
    stub's recorded argv, or in any `TMPDIR` file. It also asserts that the
    written stdin command is hex-only.
- `lint:shell`, `lint:md` and ESLint on the new files: clean.
- Agentic gate: see the PR description.

## Mutation proof

Each mutation was applied alone against `npm run test:keys-backup` (baseline
17/0 before and after). The table records the SHA-256 prefix of the file
before mutating. Every file was restored and its hash re-verified.

| Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|
| Legacy fallback on denied access | `backup-keys.sh` (`d0c22b0ebbdc`) | 16/1 | denied access never falls back |
| Plaintext staged on disk | `backup-keys.sh` | 16/1 | encrypts from memory (TMPDIR clean) |
| Encrypts straight to the final name | `backup-keys.sh` | 13/4 | partial cleanup + good backup kept, and others |
| Partial file not cleaned up | `backup-keys.sh` | 16/1 | partial cleanup |
| Hex vault not decoded | `vault-json.mjs` (`5cf423d22936`) | 15/2 | hex vault; helper |
| Restore while the app runs | `restore-keys.sh` (`bf178a99a0c5`) | 16/1 | refuses while running |
| Replace by default | `restore-keys.sh` | 15/2 | merge by default; manual/legacy formats |
| Vault in `security` argv (`-w`) | `restore-keys.sh` | 13/4 | argv/stdin leak checks, write paths |
| `--verify` touches the Keychain | `restore-keys.sh` | 16/1 | zero security calls |
| Any answer proceeds | `restore-keys.sh` | 16/1 | only yes writes |
| No read-back check | `restore-keys.sh` | 16/1 | a write that did not land is reported |
| Merge drops newer keys | `vault-json.mjs` | 14/3 | merge semantics |
| Non-string values accepted | `vault-json.mjs` | 16/1 | helper validation message |

All 13 mutations went red, and every file was restored to its original hash.
The first pass surfaced a surviving mutant: a non-string value was still
rejected, but by an accidental `TypeError` rather than by the validation. The
helper test now pins the exact validation messages.

## For Bradley (manual, when convenient)

1. `npm run backup-keys -- --dry-run`. Choose **Allow** if macOS asks. You
   should see all your key names and the count.
2. `npm run backup-keys`, then
   `npm run restore-keys -- --verify "<the printed path>"`.
3. Keep the passphrase somewhere other than this Mac.

## Rollback

Revert the commit. The old scripts return, and they back up nothing on a
migrated install.

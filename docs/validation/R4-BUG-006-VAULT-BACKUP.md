# R4-BUG-006 validation — backup and restore the `secrets-vault`

Validated September 30, 2026 on branch `claude/r4-bug-006-vault-backup`
(base `a255546ee`). On October 6 it was rebased onto `main` at `0c83415a6`
and re-validated (see "Rebase (October 6)"). Approved design (merge by
default):
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
  - **openssl pair:** the ciphertext and its `.hmac` sidecar are published
    with the previous pair kept as hard links
    (`keys-backup-YYYYMMDD-prior-openssl.enc` + `.hmac`).
    - A failure or SIGTERM between the two renames puts the previous pair
      back exactly.
    - A run killed outright leaves that snapshot, which restore-keys accepts
      directly. The next run then refuses until it is checked.
    - Only the run holding the per-output lock (`<backup>.lock`, created
      with `mkdir`) publishes, snapshots or rolls back. A concurrent run
      that cannot take the lock exits 1 and changes nothing.
  - It falls back to legacy per-key items (names from `SUPPORTED_SECRET_KEYS`
    in `main.rs`) **only** on item-not-found (exit 44). Denied access is an
    error, both for the vault item and for every legacy key. A legacy key it
    cannot read aborts the backup before anything is written.
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

## Rebase (October 6)

- **Rebase range:** only this PR's commit was replayed:
  `git -c rerere.enabled=false rebase --onto 0c83415a6 a255546ee`.
  - The one conflict, `scripts/targeted-tests-overrides.json`, was resolved
    as the union of `main`'s mappings and this PR's three `test:keys-backup`
    mappings, with nothing dropped.
  - `package.json` and CLAUDE.md merged without conflicts. The only
    `package.json` change against `main` is the `test:keys-backup` script.
- **Unchanged since September 30:**
  - `backup-keys.sh`, `restore-keys.sh`, `vault-json.mjs` and the test file
    are byte-identical, with the same hashes as in the table below.
  - `src-tauri/src/main.rs`, which supplies the supported key names, has not
    changed since the old base.
- **Results on Bradley's Mac** (Node 22.23.1; the tests run the scripts
  with `/bin/bash` 3.2.57 and stub `security`, `age` and `pgrep`):
  - `test:keys-backup`: 17/17.
  - The other suites and the agentic gate are listed in the task's result
    file.

## Repair cycle 1 (Sol's review of `96611cc3d`)

Sol (`gpt-6.1-sol`, medium) found two P2 blockers in `backup-keys.sh`. Both
are fixed within the approved design. The formats, names and engines are
unchanged.

1. **A denied legacy key was skipped.** Every failed per-key read counted as
   absent, so a denied key produced a successful but incomplete backup.
   - Now only exit 44 (item not found) skips a key. Any other status exits 1
     before encryption.
   - New test: no vault item, one readable key and one denied key. It
     asserts exit 1, the error message, no secret in output, argv or
     `TMPDIR`, and that the existing complete backup is byte-identical.
2. **The OpenSSL sidecar was published first.** The new `.hmac` replaced the
   old one before the ciphertext moved, so a failure in between left the old
   ciphertext with the new sidecar, which cannot be restored.
   - The previous pair is now kept as hard links during publication, as
     described in Behavior.
   - Rollback uses `-ef`, because macOS `mv` between two links to the same
     file does nothing.
   - New OpenSSL scenarios use stub `openssl` (a real HMAC-SHA256 over the
     file) and a stub `mv` that fails, sends SIGTERM or SIGKILL exactly
     between the two renames. The OpenSSL sandbox hides any system age, gpg
     or openssl.
   - The scenarios cover:
     - a successful re-run;
     - failure and SIGTERM, where the previous pair is byte-identical and
       verifies with the old passphrase;
     - SIGKILL, where the previous pair is kept and verifiable, and the next
       run refuses and changes nothing;
     - an encryption failure.

**Red first:** with only the new tests added, the unchanged script failed 3
of 22. The two new coverage-only tests (the successful re-run and the
encryption failure) already passed. After the fix, 22/22 passed. The raw
logs are in `repair1-logs/` in the task folder.

## Repair cycle 2 (Sol's review of `c15f8d520`)

Sol confirmed that both cycle-1 fixes are in place for a single run, and
found one remaining P2: two concurrent openssl runs could both pass the
early snapshot check.

- **The race:** A takes the snapshots and publishes its new sidecar. B, whose
  own snapshot `ln` then fails, rolled back A's snapshots in its cleanup. A
  then published its ciphertext and reported success, leaving A's
  ciphertext with the old sidecar and no kept copy of the old ciphertext.
- **Fix:**
  - Each openssl run takes an exclusive per-output lock (`mkdir
    <backup>.lock`) before encrypting.
  - The snapshot check now runs under the lock.
  - Cleanup releases the lock only if this run owns it, and rollback runs
    only inside publication, which only the lock holder can reach.
  - The formats, names, engines and refusal behavior are unchanged. A
    killed run leaves the lock, so the next run refuses.
- **New deterministic tests:** they use file barriers in the stub `openssl`
  (paused during encryption) and stub `mv` (paused between the two renames),
  rather than timing.
  - Two overlapping runs, over an existing pair and as the first backup of
    the day: exactly one publishes, and the pair it leaves is coherent and
    restorable with the winner's passphrase.
  - A run started while another is mid-publication exits 1 and leaves every
    file, snapshot and the lock byte-identical.
  - A failed snapshot of the sidecar (stub `ln`) leaves the existing pair,
    no snapshot and no lock.
  - After a killed run: removing only the lock still refuses and keeps the
    pair; removing the kept pair as well lets backups resume.
- **Red first:** against repair cycle 1, the new overlap test failed with
  "HMAC mismatch". The suite was 25/26. After the fix, 26/26 passed. The raw
  logs are in `repair2-logs/`.

## Mutation proof

**First run (September 30):** each mutation was applied alone against
`npm run test:keys-backup` (baseline 17/0 before and after). That run kept
only a summary table, with no applied diffs, raw output or post-restore
hashes; it is preserved as `original-q5-evidence/`.

**Regenerated proof (October 6):**

- **Where it ran:** an isolated QA worktree (`.worktrees/claude-pr1763-qa`)
  detached at the rebased commit `96611cc3d`.
- **Command:** `node --test --test-reporter=tap
  tests/keys-backup-restore.test.mjs`, with the same stub fixtures.
- **Each mutation:**
  1. Checks that `git status` is clean.
  2. Applies one edit and records a non-empty `git diff`.
  3. Keeps the raw TAP output and the failing assertions.
  4. Restores the file, then checks its SHA-256 and that `git status` is
     clean again.
- **Baseline:** 17/17 before and after.
- **Evidence location:**
  `~/Documents/Codex/2026-10-04/task/approved-batch/pr1763/mutation-evidence/`:
  - `<id>.diff`;
  - `<id>.test.log`;
  - `<id>.restore.log`;
  - `manifest.json`.
- **Result:** all 13 turned red again, with the same pass/fail counts as the
  first run.

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

**Repair cycle 1 proof:**

- **Where it ran:** the same isolated QA worktree, detached at `c15f8d520`
  (the repair commit), with stub fixtures only.
- **Baseline:** 23/23 before and after.
- **Evidence location:**
  `~/Documents/Codex/2026-10-04/task/approved-batch/pr1763/mutation-evidence-repair1/`:
  - `<id>.diff`;
  - `<id>.test.log`;
  - `<id>.restore.log`;
  - `manifest.json`.
- **Proofs re-run, because `backup-keys.sh` changed** (now
  `6b8ea6ded7e1`):
  - E1, E2 and E3;
  - E3b, with an adapted edit because `cleanup()` was rewritten.
- **New proofs:**
  - R1–R2 cover the legacy error handling.
  - R3–R9 cover the openssl pair: rollback, both snapshots, the `-ef` check,
    the refusal after a killed run, snapshot removal on success, and no half
    pair on a first-run failure.
- **Proofs reused:** E4–E12 from the October 6 run at `96611cc3d`
  (`mutation-evidence/`). Their guarded code is byte-identical
  (`restore-keys.sh` `bf178a99a0c5`, `vault-json.mjs` `5cf423d22936`), and
  the tests that turn red are unchanged. The fixture's default (age) setup
  behaves the same; the repair only added opt-in stub switches.

**Result: all 13 new proofs turned red.**

| Id | Mutation | Pass/fail |
|---|---|---|
| E1 | legacy fallback on denied vault access | 22/1 |
| E2 | plaintext staged on disk | 21/2 |
| E3 | encrypts straight to the final name | 18/5 |
| E3b | partial file not cleaned up | 19/4 |
| R1 | denied legacy key skipped again | 22/1 |
| R2 | missing legacy key treated as an error | 20/3 |
| R3 | no rollback of a half-published pair | 21/2 |
| R4 | previous ciphertext not snapshotted | 22/1 |
| R5 | previous sidecar not snapshotted | 21/2 |
| R6 | rollback without the `-ef` check | 22/1 |
| R7 | no refusal after an interrupted publication | 22/1 |
| R8 | snapshot left after a successful publication | 22/1 |
| R9 | new file without a predecessor kept on rollback | 22/1 |

**Repair cycle 2 proof:**

- **Where it ran:** the isolated QA worktree, detached at `3ed732e4c`. That
  commit is the fix `16ab6a0a6` plus a test-harness-only hardening;
  `backup-keys.sh` is unchanged by the hardening.
- **Baseline:** 26/26 before and after.
- **Evidence location:**
  `~/Documents/Codex/2026-10-04/task/approved-batch/pr1763/mutation-evidence-repair2/`.
- **All proofs on `backup-keys.sh` were re-run,** because the file changed
  again (now `48f82b819b51`):
  - E1–E3, plus E3b with an adapted edit because `cleanup()` now also
    releases the lock;
  - R1–R9, with R7 now targeting the snapshot check under the lock.
- **New proofs:**
  - L1, a non-exclusive lock (`mkdir -p`): red in the overlap,
    mid-publication and killed-run tests.
  - L2, a run that releases a lock it does not own: red in the
    mid-publication and killed-run tests.
  - L3, a lock that is never released: red in 8 openssl tests.
- **Result:** all 16 turned red, and each restored hash matched with a clean
  status before and after.
- **Proofs reused:** E4–E12 from the run at `96611cc3d`
  (`mutation-evidence/`), as in cycle 1. `restore-keys.sh` and
  `vault-json.mjs` are still byte-identical.
- **Aborted run, not used:** a first attempt at `16ab6a0a6` is kept in
  `mutation-evidence-repair2-aborted-16ab6a0/`.
  - Under L1, the mid-publication test failed before releasing its barrier,
    so the paused stub run never exited and `node --test` hung.
  - The runner was stopped, and the QA worktree was restored with `git
    checkout` and verified clean.
  - That led to the hardening: barriers are now always released in
    `t.after`, and the stub wait loops also stop when the sandbox is
    removed.

## For Bradley (manual, when convenient)

1. `npm run backup-keys -- --dry-run`. Choose **Allow** if macOS asks. You
   should see all your key names and the count.
2. `npm run backup-keys`, then
   `npm run restore-keys -- --verify "<the printed path>"`.
3. Keep the passphrase somewhere other than this Mac.

## Rollback

Revert the commit. The old scripts return, and they back up nothing on a
migrated install.

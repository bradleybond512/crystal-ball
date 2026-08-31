# UX-017 pinned Node toolchain brief

Status: implementation and exact-tip validation complete; final review pending.

## Goal

Make the Mac main-sync coordinator and every npm/package-script subprocess use
the same supported Node 22 toolchain while keeping Cargo available to the Tauri
build and preserving every existing fail-closed verification and install gate.

## Acceptance criteria

- Setup refuses to replace the LaunchAgent when its own runtime is not Node 22.
- Sync refuses before clone mutation, build, or install when its runtime is not
  Node 22 or the selected Node directory has no executable npm sibling.
- A sync toolchain failure replaces any stale successful status with
  `phase: failed` while leaving the repository and installed app untouched.
- Every npm command uses the absolute sibling npm path and a subprocess `PATH`
  beginning with the selected Node directory while retaining
  `/Users/bradleybond/.cargo/bin` and the existing system paths.
- Required GitHub checks, lockfile validation, clean-clone preparation,
  typechecks, web build, desktop packaging, signing, installer verification,
  and the canonical `~/Applications/Crystal Ball.app` destination remain
  unchanged.
- A controlled candidate run records `phase: installed`, the exact canonical
  commit, required-check provenance, matching app hashes, and a valid strict
  code signature without an `EBADENGINE` warning.

## Constraints and non-goals

- Do not install or upgrade Node, npm, Homebrew, or Rust.
- Do not relax the repository engine requirement (`>=22.0.0 <23.0.0`).
- Do not change the status/state schemas, GitHub gates, signing, or installer.
- Do not add dependencies, copy the app manually, or broaden executable trust
  to an ambient `PATH`.

## Observed defect

The LaunchAgent invokes the coordinator through the absolute Node 22 binary,
but its Cargo-first `PATH` next resolves `/opt/homebrew/bin/node` and npm from
Node 26. The sync script invokes bare `npm` for all six verification/build
commands, so nested package scripts run outside the repository engine range.
The exact evidence is recorded in
`docs/validation/UX-017-MAIN-SYNC-EVIDENCE.md`.

## Approved implementation boundary

The proposed change is limited to:

- `scripts/setup-main-sync-agent.mjs`
- `scripts/sync-main-to-mac.mjs`
- `tests/main-sync-agent.test.mjs`

Add a shared Node-major guard and a toolchain builder derived from
`process.execPath`. The toolchain builder resolves npm as the executable
sibling of the selected Node binary and creates the npm subprocess environment
with the selected Node directory first, followed by the existing Cargo-first
LaunchAgent path. Setup runs the guard before writing or reloading the plist.
Sync runs the guard and executable check before network, clone, build, or
install work, then supplies the absolute npm path and pinned environment to all
six existing npm commands.

No CLI, plist, state, or status schema changes are required.

## Failure behavior

- Unsupported setup runtime: fail before replacing the existing LaunchAgent.
- Unsupported sync runtime or missing sibling npm: acquire the sync lock,
  record `phase: failed`, and leave the repository and installed app untouched.
- Any existing check, build, signing, or install failure remains fail closed.
- A removed versioned Node keg is repaired by rerunning setup with a valid Node
  22 executable; automatic toolchain installation is out of scope.

## Tests and mutation proofs

Focused tests must prove:

- Node 22 is accepted and Node 21, 23, and 26 are rejected.
- npm is the sibling of the selected Node executable.
- npm subprocess `PATH` starts with the selected Node directory and retains the
  Cargo and system paths.
- missing sibling npm fails before command execution.
- CLI toolchain validation records a failed status before repository mutation.
- setup calls the Node guard before plist installation.
- every existing npm verification/build command behaviorally receives the
  pinned executable and environment.

Mutation proofs must remove, one at a time, the Node-major rejection, absolute
npm selection, Node-first subprocess path, Cargo preservation, missing-npm
check, and setup guard. Each proof must record the confirmed diff, exact red
count and assertion, restored checksum, and clean tracked tree.

## Validation and rollout

Run:

```bash
/opt/homebrew/opt/node@22/bin/node --test tests/main-sync-agent.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:data
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
  bash scripts/agentic-validate.sh --tests "test:data"
```

The candidate LaunchAgent may remain bound to the UX-017 worktree only until
the PR merges. Do not remove that worktree while launchd references it. After
merge, stop the loaded job and relocate its controller to the agent-owned clean
checkout at `~/.crystalball-main-sync/controller`. This standalone checkout is
separate from the disposable target/build clone at
`~/.crystalball-main-sync/repo`; the sync job must never reset, clean, or update
its own controller:

1. Require PR #1693 to be merged. Record the installed app signature and the
   checksums of `state.json` and `status.json` without moving any of them.
2. Boot out `com.bradleybond.crystalball.main-sync` and require `launchctl
   print` to report that it is absent. An already-absent job is acceptable; any
   other bootout failure blocks relocation.
3. Create or update `~/.crystalball-main-sync/controller` manually from the
   canonical remote, then detach it at the exact reviewed and merged canonical
   SHA. Require a clean tree, exact SHA identity, and the PR merge commit to be
   an ancestor of that SHA. Do not make this checkout track moving `main`.
   Before setup, require the reviewed blobs for
   `sync-main-to-mac.mjs`, `setup-main-sync-agent.mjs`, and
   `main-sync-agent.test.mjs` to be `2d2bd5bfa08242ab42f8638eb02efd42ef4831e7`,
   `26810200336006ee407e3c9b70cc8ba00807021e`, and
   `a685833560faea5dc369f84832d2536306625f0e`, respectively; blob identities
   remain stable when a rebase merge rewrites commit SHAs.
4. Run the focused main-sync suite in the controller checkout with absolute
   Node 22. Then run
   `/opt/homebrew/opt/node@22/bin/node scripts/setup-main-sync-agent.mjs
   --no-start` so the new plist can be inspected before launchd loads it.
5. Fail closed unless the plist selects an executable Node 22 and sibling npm,
   points its script and working directory into
   `~/.crystalball-main-sync/controller`, retains Cargo and system paths, uses
   `~/.crystalball-main-sync` as the sync root, and contains neither a
   `.worktrees` path nor `repo` as its controller path. The sibling `repo`
   remains the only checkout the sync process may force-reset and clean.
6. Bootstrap, enable, and kickstart the plist. Verify launchd's loaded program,
   arguments, working directory, and runtime rather than trusting the plist
   alone. Require a terminal result for canonical `main`, required-check
   provenance, matching installed/build executable hashes, and a valid strict
   code signature before removing the UX-017 worktree.

Rollback is operational, never a revert to the pre-pinning implementation. If
any relocation or verification gate fails, boot out the agent and leave it
stopped. Preserve `~/Applications/Crystal Ball.app`, both sync checkouts,
`state.json`, `status.json`, and the UX-017 worktree for diagnosis. Resume only
by detaching the controller checkout at the recorded last-known-good reviewed
SHA and repeating the blob, focused-test, `--no-start`, plist, and loaded-state
gates. Never reset the controller to moving `main`, restore the old worktree
plist, revert the Node/npm pinning, or reinstall pre-pinning bytes. The existing
app remains usable while automatic sync is disabled, and only the verified
installer may replace it after every normal gate succeeds.

The controlled candidate run completed on 2026-08-31 against canonical main
`702dc5b0521f49542d1c6cb73238841006b9a793`: it recorded `phase: installed`,
used Node 22.23.1 with npm 10.9.8 and Cargo 1.93.1, emitted no `EBADENGINE`,
installed through the verified installer, matched installed/build executable
hashes, and passed strict code-signature verification.

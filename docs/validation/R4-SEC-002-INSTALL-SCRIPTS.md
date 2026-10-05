# R4-SEC-002 steps 1-2 validation — install scripts off, drift gate on

Validated September 30, 2026 on branch `claude/r4-sec-002-install-scripts`
(base `a255546ee`). Approved design:
[plan](../plans/2026-09-30-r4-sec-002-install-scripts.md).

## Behavior

- **Install scripts are off everywhere.**
  - `.npmrc` and `tools/mcp-server/.npmrc` set `ignore-scripts=true`, which
    covers agents, developers, CI and main-sync.
  - An explicit `--ignore-scripts` is also passed in:
    - main-sync's `NPM_VERIFICATION_COMMANDS`;
    - `install-mcp-deps.mjs`;
    - `mcp:install`;
    - the global `install-crystalball-mcp.mjs` (global installs ignore the
      project `.npmrc`);
    - the `tools/mcp-server` installs in `smoke.yml` and `targeted-tests.yml`.
  - Deleting `.npmrc` alone therefore doesn't turn scripts back on for the
    automatic install.
- **Our own hooks are explicit.** `desktop:build:full` runs
  `scripts/desktop-build-full.mjs` instead of the `predesktop:`/`postdesktop:`
  hooks that `ignore-scripts` would skip. It downloads the textures, packages
  with every flag npm forwards (`--sign`, `--app-only`, ...), and installs
  only after packaging succeeded. `--help`, `--h` and `-h` print packaging
  help without downloading, building or installing. A test fails on any
  future pre/post hook or install lifecycle script. After a fresh
  clone, run `npm run prepare` (git hooks and MCP deps); this is documented in
  README and CLAUDE.md.
- **Drift gate** (`scripts/check-install-script-drift.mjs`) runs in the
  required `integrity-checks` job on pull requests.
  - It compares both lockfiles against the base branch via `git show`, so
    there is no baseline file to tamper with.
  - It fails when:
    - a package gains an install script;
    - a scripted package changes version;
    - a package gains a `bin` command name.
  - Removals pass. An unreadable base fails closed (exit 2).
  - The `install-scripts-reviewed` label, Bradley only, approves a flagged
    change. The workflow re-runs on `labeled`/`unlabeled`.
- **Rebuild allowlist: empty.** Evidence: every worktree in this session was
  installed with `--ignore-scripts`, and typecheck, `vite build`, `tsx`
  (esbuild), `cargo test` and all agentic gates passed. Against today's
  `origin/main`, the live gate reports "no new install scripts or commands".

## Actual validation

At the repaired tip, on Bradley's Mac with Node 22.23.1
(`PATH=/opt/homebrew/opt/node@22/bin:$PATH`):

- `test:install-scripts` (drift, main-sync, MCP deps, packaging and the new
  `desktop:build:full` behavior tests): **56/56**. The two main-sync failures
  noted on the first push came from running Node 26 on the Mac; under Node 22
  they pass.
- `test:agentic-pipeline` (reviewer policy and targeted-test selection) and
  `agentic-validate.sh` with both suites pass. Exact outputs are in the repair
  result for this cycle.
- ESLint on the changed files is clean, and `npm config get ignore-scripts`
  returns `true` in both projects.
- `node_modules` was not reinstalled for this repair. The evidence does not
  prove a fresh install builds against the current lockfile; CI's `npm ci` is
  that check.

## Mutation proof

**The original raw evidence was not found.** The first table recorded 11 red
mutations with hash prefixes, but no applied diffs, raw failing output or
restore proof. Those logs could not be found, so the proof was regenerated
for the review of `b299e18`.

**How it was run:**

- In an isolated QA worktree (`.worktrees/claude-pr1764-qa`), detached at
  the repaired code commit, with the runner `mutate-qa.mjs`.
- The suite: `node --test --test-reporter=tap` over the five
  `test:install-scripts` files.
- No dependencies were installed (these tests use only Node built-ins and
  npm).

**Each mutation:**

1. Checks that `git status` is clean.
2. Applies exactly one edit and records `git diff`, which must be non-empty.
3. Runs the suite and keeps the raw TAP output.
4. Restores the file, then checks its SHA-256 and that `git status` is clean
   again.

The baseline is **56/56** before and after.

**Evidence:**

- Location: `~/Documents/Codex/2026-10-04/task/pr1764/mutation-evidence/`.
- Per mutation: `<id>.diff`, `<id>.test.log` (raw output with the failing
  assertions) and `<id>.restore.log`.
- `manifest.json` holds the machine-readable summary.

**Superseded run:** the first run (in `mutation-evidence-superseded-5828c16/`)
is not used. Its baseline was red: the orchestrator's entry-module guard
skipped every step when reached through macOS's `/var` symlink. That guard is
removed.

**Result: all 16 mutations turned red.**

| Id | Mutation | File (SHA-256 before) | Pass/fail | Red test(s) |
|---|---|---|---|---|
| M01 | Root `.npmrc` allows scripts | `.npmrc` (`6419ddc02dda`) | 55/1 | scripts disabled for every project |
| M02 | MCP `.npmrc` allows scripts | `tools/mcp-server/.npmrc` (`47451c784d19`) | 55/1 | scripts disabled for every project |
| M03 | main-sync runs install scripts | `sync-main-to-mac.mjs` (`3a1c3e2f8a72`) | 53/3 | explicit flag, pinned toolchain commands |
| M04 | MCP deps install runs scripts | `install-mcp-deps.mjs` (`dcbf998e894a`) | 53/3 | explicit flag, installer argv |
| M05 | New install script not flagged | `check-install-script-drift.mjs` (`3fd104e8e517`) | 53/3 | worm move (unit and both CLI) |
| M06 | Scripted version change not flagged | same | 55/1 | scripted version change |
| M07 | New `bin` not flagged | same | 55/1 | new command names |
| M08 | Any label approves | same | 55/1 | only the review label approves |
| M09 | Unreadable base passes | same | 55/1 | fails closed |
| M10 | Gate missing from the required job | `release-integrity.yml` (`0f5c6afda778`) | 55/1 | wired into integrity-checks |
| M11 | Build relies on a skipped pre/post hook | `package.json` (`551d6183e5a4`) | 55/1 | no silent lifecycle hooks |
| N12 | `desktop:build:full` back to the shell chain | `package.json` (`551d6183e5a4`) | 50/6 | entry point, forwarding, help, failure order |
| N13 | Orchestrator continues after a failed step | `desktop-build-full.mjs` (`77d7aa0b9b3c`) | 53/3 | failure stops install, download stops packaging, exit codes |
| N14 | Help runs download, build and install | same | 55/1 | help only |
| N15 | Forwarded flags also reach the install | same | 55/1 | flags go to packaging only |
| N16 | Rebuild guidance drops `--ignore-scripts=false` | `.npmrc` (`6419ddc02dda`) | 55/1 | documented per-package override |

The hashes are the files at the repaired commit, so M01–M11 do not match the
old table's prefixes: those files changed in this repair or since.

## Correction during CI

The first push overwrote the existing root `.npmrc`, which carries
`legacy-peer-deps=true` for the vite-plugin-pwa peer range, instead of
appending to it. CI's `npm ci` then failed lockfile validation. The follow-up
commit restores the original content above the new block and adds a test
that keeps `legacy-peer-deps=true`. The original 11-mutation table was re-run afterwards. That
run's raw logs are among those that could not be found (see Mutation proof).

## Correction after Sol's review of `b299e18`

Sol (`gpt-6.1-sol`, medium) found two blockers and one documentation issue.

1. **Packaging flags reached the install.** The shell chain that replaced
   the pre/post hooks sent npm's appended `--sign`, `--help` and other flags
   to `local-install.mjs`. `scripts/desktop-build-full.mjs` now sends every
   forwarded flag to packaging, prints help without side effects, and stops
   at the first failure.
   - Proven by `tests/desktop-build-full.test.mjs` and mutations N12–N15.
   - No desktop build, package or install was run. The tests use stub child
     scripts.
2. **Mutation evidence could not be audited.** It was regenerated as
   described in Mutation proof above.
3. **Rebuild guidance.** A plain `npm rebuild <pkg>` inherits
   `ignore-scripts=true`, so it would still skip the install step.
   - `.npmrc`, `tools/mcp-server/.npmrc` and CLAUDE.md now name the reviewed
     per-package `npm rebuild <pkg> --ignore-scripts=false` and its risk: it
     runs that package's scripts with full user access.
   - A test guards this guidance (mutation N16).

## Not in this change (queue item Q14)

- Release-age cooldown.
- `npm audit signatures`.
- CODEOWNERS and the auto-merge skip for dependency paths.

GitHub cannot restrict who applies a label, so the review label depends on
process until Q14.

## Rollback

Revert the commit. Install scripts then run on every install again.

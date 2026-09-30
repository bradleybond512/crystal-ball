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
- **Our own hooks are explicit.** `desktop:build:full` now chains the
  texture download, the packaging and the local install, instead of the
  `predesktop:`/`postdesktop:` hooks that `ignore-scripts` would skip. A test
  fails on any future pre/post hook or install lifecycle script. After a fresh
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

- `test:install-scripts` (drift, main-sync, MCP deps, packaging):
  - **49/49** on Linux.
  - On Bradley's Mac, 47/49. The two failures,
    `main sync rejects a selected Node toolchain…` and
    `main sync CLI records failure…`, are **pre-existing and host-specific**:
    the Mac runs Node 26 and main-sync requires 22. They fail identically on
    the unmodified base.
- ESLint on the changed files is clean, `lint:yaml` passes, and
  `npm config get ignore-scripts` returns `true` in both projects.
- Agentic gate: see the PR description.

## Mutation proof

Each mutation was applied alone against the four suites (baseline 49/0
before and after, Linux). The table records the SHA-256 prefix of the file
before mutating. Every file was restored and its hash re-verified.

| Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|
| Root `.npmrc` allows scripts | `.npmrc` (`24c13a4dbc40`) | 48/1 | scripts disabled for every project |
| MCP `.npmrc` allows scripts | `tools/mcp-server/.npmrc` (`e16b6c8904ee`) | 48/1 | scripts disabled for every project |
| main-sync runs install scripts | `sync-main-to-mac.mjs` (`3a1c3e2f8a72`) | 46/3 | explicit flag + main-sync contract |
| MCP deps install runs scripts | `install-mcp-deps.mjs` (`dcbf998e894a`) | 46/3 | explicit flag + installer argv |
| New install script not flagged | `check-install-script-drift.mjs` (`3fd104e8e517`) | 46/3 | worm move (unit + both CLI) |
| Scripted version change not flagged | same | 48/1 | scripted version change |
| New `bin` not flagged | same | 48/1 | new command names |
| Any label approves | same | 48/1 | only the review label approves |
| Unreadable base passes | same | 48/1 | fails closed |
| Gate missing from the required job | `release-integrity.yml` (`0f5c6afda778`) | 48/1 | wired into integrity-checks |
| Build relies on skipped pre/post hooks | `package.json` (`9c347adb811c`) | 48/1 | no silent lifecycle hooks |

All 11 mutations went red, and every file was restored to its original hash.

## Not in this change (queue item Q14)

- Release-age cooldown.
- `npm audit signatures`.
- CODEOWNERS and the auto-merge skip for dependency paths.

GitHub cannot restrict who applies a label, so the review label depends on
process until Q14.

## Rollback

Revert the commit. Install scripts then run on every install again.

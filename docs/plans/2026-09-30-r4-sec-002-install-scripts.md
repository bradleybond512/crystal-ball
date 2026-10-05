# R4-SEC-002 steps 1-2: no dependency install scripts, and a drift gate

Status: approved by Bradley on September 30, 2026 ("Approve as designed"). Branch `claude/r4-sec-002-install-scripts` from `a255546ee`.
Classification: High Assurance (supply chain, install logic). Queue item Q6.

## Problem (verified at a255546ee)

- **main-sync** (`scripts/sync-main-to-mac.mjs:21-28`) runs plain `npm ci`
  from a LaunchAgent as Bradley for every new green `main`. Every
  dependency's `preinstall`/`install`/`postinstall` runs with full access to
  the home directory: tokens, `~/.ssh`, the shadow vault, and the ability to
  prompt for Keychain items.
- The same is true of every agent and every developer `npm ci`/`npm install`
  in a worktree, of `npm ci` in `tools/mcp-server` (the root `prepare` →
  `install-mcp-deps.mjs`), and of the global `mcp:install-local`.
- There is no `.npmrc`, and nothing notices when a dependency starts shipping
  an install script, which is the defining move of the 2025 npm worms.
- Today the root lockfile has **9** packages with install scripts:
  - `bufferutil`, `utf-8-validate`: optional native accelerators for `ws`,
    with JS fallbacks;
  - `core-js`, `es5-ext`: donation banners;
  - `esbuild`: a binary check; the binary comes from the platform optional
    dependency;
  - `protobufjs`: a version check;
  - `fsevents` ×3: prebuilt, optional, dev-only.

  `tools/mcp-server` has none.
- **Evidence that nothing needs them.** Every worktree in this session was
  installed with `npm ci --ignore-scripts`. `typecheck:all`, `vite build`,
  the full agentic gate, `tsx` (esbuild), `cargo test` and 640+ sidecar
  tests all passed.

## Design

1. **No lifecycle scripts by default.**
   - Root `.npmrc` and `tools/mcp-server/.npmrc` get `ignore-scripts=true`,
     which covers agents, developers, CI and main-sync.
   - Belt and braces: an explicit `--ignore-scripts` in
     - main-sync's `NPM_VERIFICATION_COMMANDS` (`['ci', '--ignore-scripts']`);
     - `install-mcp-deps.mjs`;
     - `mcp:install`;
     - the global `install-crystalball-mcp.mjs`;
     - `smoke.yml`'s MCP install.

   A malicious PR that deletes `.npmrc` still doesn't turn scripts on for
   main-sync.
2. **Keep our own pre/post scripts working.** `ignore-scripts` also skips
   `pre*`/`post*` hooks of explicitly run scripts. `desktop:build:full`
   becomes an explicit chain: textures → package → local install, replacing
   the `predesktop:build:full` / `postdesktop:build:full` hooks. `prepare`
   (git hooks and MCP deps) no longer runs on `npm ci`:
   - Existing checkouts and worktrees already share `core.hooksPath`.
   - A fresh clone runs `npm run prepare` once. This is documented in the
     README and CLAUDE.md.
   - CI already installs `tools/mcp-server` deps explicitly where tests need
     them.
3. **Rebuild allowlist: empty.** If a future package genuinely needs its
   install step, it goes on an explicit `npm rebuild <pkg>` allowlist, in a
   reviewed PR.
4. **Install-script drift gate** (`scripts/check-install-script-drift.mjs`):
   - It compares the PR's lockfiles (`package-lock.json`,
     `tools/mcp-server/package-lock.json`) with the **base branch's**
     versions, using `git show`. So there is no baseline file to tamper
     with.
   - It **fails** when a package gains `hasInstallScript`, when a scripted
     package changes version, or when any package gains or changes a `bin`
     entry (a new command name can shadow tools used by npm scripts).
   - Removals pass and are reported.
   - It runs in the **required** `integrity-checks` job, on pull requests.
   - An override label, `install-scripts-reviewed`, is for Bradley only
     (documented; GitHub cannot restrict who applies it). The workflow
     re-runs on `labeled`/`unlabeled`.
   - Pure functions, unit-tested with fixture lockfiles, plus a CLI test
     against a temporary git repo.

## Non-goals (later queue items)

- Release-age cooldown, `npm audit signatures`, CODEOWNERS and the
  auto-merge skip (Q14).
- Running the main-sync build as an unprivileged user.

## Tests and proof

- `install-script-drift.test.mjs`:
  - added script, scripted version bump, new or changed `bin`;
  - a removal passes;
  - a non-scripted bump passes;
  - the label override;
  - the CLI against a temporary git repo.
- Update `main-sync-agent.test.mjs`, and add a gate that no install command
  in main-sync or the MCP installers can run scripts.
- A source gate that `.npmrc` files set `ignore-scripts=true`.
- `desktop:build:full` contains the texture download and the local-install
  steps.
- A mutation per behavior, and the agentic gate.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves this design.

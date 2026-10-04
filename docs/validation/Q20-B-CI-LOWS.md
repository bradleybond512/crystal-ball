# Q20 PR B validation: CI lows (R4-LOW-002, R4-LOW-003)

Plan: `docs/plans/2026-10-04-q20-remaining-lows.md` (on #1779), approved by
Bradley on October 4, 2026. Decision C: add a version-pinned zizmor job.
Stacked on #1772, which already edits the auto-merge workflow and
Dependabot.

## What changed

- **R4-LOW-002: expression injection.**
  - **`auto-merge-agent-branches.yml`:** the branch name, step outputs and PR
    number now reach scripts only through `env:` (`"$BRANCH"`,
    `process.env.BRANCH`). The `AUTO_MERGE_PAT` secret no longer appears in
    script text; scripts only receive whether it exists (`HAS_PAT`).
    `pull-requests: write` moved from the workflow to the job that needs it.
  - **`build-desktop.yml`:** the release ref, event, variant, publish mode
    and SHA are passed through `env:`.
  - **`lint.yml`:** `github.base_ref` is passed through `env:`.
  - **`pages.yml`:** `pages: write` and `id-token: write` were already set on
    the deploy job; they are now removed from the workflow level.
  - **zizmor found two more release risks, both fixed:**
    - A publishing build no longer restores a Rust cache. Build-only runs
      keep it.
    - Every `setup-node` in `build-desktop.yml` sets
      `package-manager-cache: false`.
  - **`dependency-change-gate.yml`** (#1772's `pull_request_target` gate)
    carries an inline `zizmor: ignore[dangerous-triggers]` with its
    justification. It never checks out PR code and has a read-only token.
- **New CI job: `zizmor`** in `actionlint.yml`.
  - zizmor 1.30.1 is installed into a venv with `--require-hashes
    --only-binary=:all:` from `.github/tools/zizmor/requirements.txt`. That
    file is generated from PyPI's release metadata and pins every wheel's
    SHA-256.
  - The job runs offline and fails on any high-severity finding.
  - Dependabot (pip) proposes updates under the same 7- and 14-day cooldown.
- **R4-LOW-003: `.github/mcp.json` pins** (each at least 7 days old, per the
  cooldown policy):

  | Server | Pin |
  |---|---|
  | `@modelcontextprotocol/server-filesystem` | `@2026.8.31` (published August 31) |
  | `mcp-server-fetch` | `==2026.8.18` |
  | `github-mcp-server` | the image digest of v1.12.2, released September 16 (v1.13 and v1.14 are under 7 days old) |

  Dependabot can't parse `mcp.json`, so these are bumped by hand.
- **Policy:** `.github/tools/` and `.github/mcp.json` are now sensitive
  paths (`dependency-change-policy.mjs`) and are listed in `CODEOWNERS`.

## Audit before and after

- **Before:** zizmor 1.30.1 at high severity reported 15 high findings across
  the workflows: 7 template injection, 4 cache poisoning, 3 excessive
  permissions and 1 dangerous trigger.
- **After:** "No findings to report" (high). The one documented ignore is the
  `pull_request_target` gate above.
- **actionlint:** 1.7.8 passes on all workflows, run locally without
  shellcheck; CI runs it with shellcheck.

## Tests

- `tests/workflow-injection.test.mjs`: 7 tests, including no `${{ }}` inside
  script blocks of the hardened workflows.
- `tests/dependency-change-gate.test.mjs`: 9 tests, updated intentionally
  for the new sensitive paths, the fourth Dependabot ecosystem, and the
  trigger's ignore comment.
- `tests/lint-workflow.test.mjs`: its regex now also accepts
  `"origin/$BASE_REF...HEAD"`. CI's ESLint job caught that it had pinned the
  old interpolated form.
- New script: `test:workflow-security`. It runs these and the four other
  workflow-pinning suites, all passing.

`bash scripts/agentic-validate.sh --tests "test:workflow-security"` on the
Mac printed "Agentic validation gate passed." It covered lint:strict
(including YAML and JSON), typecheck:all, secrets:scan, cross-agent:check,
docs:check, roadmap:check, the build, and `test:workflow-security` (16 pass,
0 fail). Changed-file ESLint is clean.

## Mutation proof (13 mutations, all red, all restored by SHA)

| ID | Mutation | Result |
|---|---|---|
| B01 | branch pasted into bash | red (1 failing), restored `66c0b3a7ec0c` |
| B02 | branch pasted into JS | red (1 failing), restored `66c0b3a7ec0c` |
| B03 | PAT pasted into JS | red (2 failing), restored `66c0b3a7ec0c` |
| B04 | base_ref pasted into bash | red (1 failing), restored `a3d4644e92cc` |
| B05 | release ref pasted into bash | red (1 failing), restored `c98b1e6d4530` |
| B06 | zizmor severity gate dropped | red (1 failing), restored `219cd9ad5af3` |
| B07 | zizmor installed without hashes | red (1 failing), restored `219cd9ad5af3` |
| B08 | filesystem MCP unpinned | red (1 failing), restored `c0e1cac4d1dd` |
| B09 | github MCP image by tag | red (1 failing), restored `c0e1cac4d1dd` |
| B10 | tool pins not sensitive | red (1 failing), restored `0751389b73b7` |
| B11 | Pages write at workflow level | red (1 failing), restored `78b12b309f85` |
| B12 | Rust cache restored when publishing | red (1 failing), restored `c98b1e6d4530` |
| B13 | npm cache in release build | red (1 failing), restored `c98b1e6d4530` |

## Follow-ups

- **Medium and lower zizmor findings**, chiefly `artipacked`: about 30
  checkouts don't set `persist-credentials: false`. They are reported but
  not yet blocking. A ratchet is a good next step.
- **R4 status table:** mark R4-LOW-002/003 when the handoff branch merges.

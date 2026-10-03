# R4-SEC-002 steps 3–5 validation — cooldown, signatures, human gate

Validated October 2, 2026 on branch `claude/r4-sec-002-supply-chain-gates`.
It is stacked on PR #1764 (steps 1–2). Approved design:
[plan](../plans/2026-10-02-r4-sec-002-supply-chain-gates.md). Bradley's
choices: 7 days, 14 for major versions; npm and Cargo; the sandboxed build
(step 6) is deferred.

## Behavior

- **Dependabot cooldown:**
  - `default-days: 7` on npm, cargo and GitHub Actions.
  - `semver-major-days: 14` on npm and cargo. It is left off GitHub Actions,
    because the docs do not confirm that ecosystem supports semver-specific
    days.
  - Security updates are not delayed.
- **Release-age gate** (`scripts/check-dependency-age.mjs`, in the required
  `integrity-checks` job):
  - It compares `package-lock.json`, `tools/mcp-server/package-lock.json` and
    `src-tauri/Cargo.lock` with the base branch's copies (`git show`).
  - Every registry version that is new in the PR is looked up:
    - npm: `time[version]`;
    - crates.io: `created_at`, with a User-Agent.
  - Lookups run 6 at a time, with a 10-second timeout.
  - A version under 7 days old, or one whose publish time cannot be read,
    fails the job, unless the PR carries `dependency-age-reviewed`.
  - Git and path sources are listed and reviewed as code.
  - Unchanged lockfiles cause no network calls.
- **Registry signatures:** `npm audit signatures` runs after `npm ci` in
  `npm-audit`. I checked it locally: 946 packages have verified signatures,
  and 127 have verified attestations.
- **`dependency-change-gate`** (`pull_request_target`, read-only, never checks
  out PR code):
  - It lists the PR's files through the API. Renames count both names, and a
    PR too large to list counts as sensitive.
  - It fails if any of these is touched without `dependency-change-approved`:
    - lockfiles or `.npmrc`;
    - Cargo manifests;
    - CI workflows, Dependabot policy or CODEOWNERS;
    - the gate scripts.
- **Auto-merge** skips sensitive PRs and makes a best-effort attempt to turn
  auto-merge off.
- **CODEOWNERS** covers the same files.
- **CLAUDE.md** documents the labels and that agents never apply them.

## Changes to the approved design

- `package.json` is not on the sensitive list. Lockfiles decide what is
  installed; most PRs edit `package.json` only for test scripts.
- The gate check stays read-only and does not turn auto-merge off itself.

## Bradley's settings (part of the deferred GitHub settings work)

1. Make `dependency-change-gate` (and `integrity-checks`, if it is not
   already) **required** status checks on `main`. Until then they are
   visible but advisory, and the auto-merge skip is the only stop.
2. Do not turn on "Require review from Code Owners" for these paths. Agent
   PRs are authored by your account, and GitHub does not allow approving your
   own PR, so it would block them. The label gate is the workable
   equivalent.

## Actual validation

All network is faked, except one local spot check of real registry lookups
(npm and crates.io) and of `npm audit signatures`.

| Suite | Result |
|---|---|
| `test:supply-chain-gates` (new) | 16/16 (Bradley's Mac) |
| `test:install-scripts` (steps 1–2) | 49/49 on Node 22. On the Mac's Node 26 two main-sync tests fail, as they do on the base branch: they require Node 22. |

- ESLint is clean on the new scripts and tests.
- The agentic gate (`test:supply-chain-gates`) passed, including
  `lint:strict`, `typecheck:all`, `secrets:scan`, `docs:check` and
  `npm run build`.
- `actionlint` runs in CI on the changed workflows.

## Mutation proof

Each mutation was applied alone, and each file was restored and re-verified
by SHA-256. Baselines were green. M07 first survived, because the
"nothing new" case passed either way. The test now asserts that unchanged
lockfiles cause no lookups at all, and the mutation is red.

| # | Mutation | File (sha before) | Red test file(s) |
|---|---|---|---|
| M01 | threshold off by a day | `check-dependency-age.mjs` (`7d530fb5aaf5`) | dependency-age (1) |
| M02 | unknown publish time passes | `check-dependency-age.mjs` (`7d530fb5aaf5`) | dependency-age (2) |
| M03 | override always on | `check-dependency-age.mjs` (`7d530fb5aaf5`) | dependency-age (1) |
| M04 | Cargo.lock not checked | `check-dependency-age.mjs` (`7d530fb5aaf5`) | dependency-age (1) |
| M05 | MCP lockfile not checked | `check-dependency-age.mjs` (`7d530fb5aaf5`) | dependency-age (1) |
| M06 | git sources treated as registry | `check-dependency-age.mjs` (`7d530fb5aaf5`) | dependency-age (1) |
| M07 | base lockfile ignored | `check-dependency-age.mjs` (`7d530fb5aaf5`) | dependency-age (1) |
| M08 | npm document refetched per version | `check-dependency-age.mjs` (`7d530fb5aaf5`) | dependency-age (1) |
| M09 | bad base ref not fatal | `check-dependency-age.mjs` (`7d530fb5aaf5`) | dependency-age (1) |
| M10 | lockfiles not sensitive | `dependency-change-policy.mjs` (`060f80fd5fe8`) | dependency-change-gate (3) |
| M11 | workflows not sensitive | `dependency-change-policy.mjs` (`060f80fd5fe8`) | dependency-change-gate (2) |
| M12 | rename source ignored | `dependency-change-policy.mjs` (`060f80fd5fe8`) | dependency-change-gate (1) |
| M13 | only the first page read | `dependency-change-policy.mjs` (`060f80fd5fe8`) | dependency-change-gate (2) |
| M14 | oversized PR not sensitive | `dependency-change-policy.mjs` (`060f80fd5fe8`) | dependency-change-gate (1) |
| M15 | any label approves | `dependency-change-policy.mjs` (`060f80fd5fe8`) | dependency-change-gate (1) |
| M16 | gate checks out PR head | `dependency-change-gate.yml` (`55ce597a5e0a`) | dependency-change-gate (1) |
| M17 | gate token can write | `dependency-change-gate.yml` (`55ce597a5e0a`) | dependency-change-gate (1) |
| M18 | auto-merge not skipped | `auto-merge-agent-branches.yml` (`04147642ed3e`) | dependency-change-gate (1) |
| M19 | no signature check | `security-audit.yml` (`3ece0b530b43`) | dependency-change-gate (1) |
| M20 | no age check in CI | `release-integrity.yml` (`b305a61b17e6`) | dependency-change-gate (1) |
| M21 | Cargo cooldown 3 days | `dependabot.yml` (`aeb4fdabff9f`) | dependency-change-gate (1) |
| M22 | policy script not code-owned | `CODEOWNERS` (`5b2aa056f273`) | dependency-change-gate (1) |

All 22 mutations went red, with no survivors.

## Rollback

Revert the commit. Dependabot returns to its 3-day default, and the age gate,
the signature check and the dependency-change gate stop running.

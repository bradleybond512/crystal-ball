# Q14: R4-SEC-002 steps 3–6 — dependency cooldown, signatures, human gate

Status: **approved by Bradley on October 2, 2026** ("Approve as designed";
A: 7 days, 14 for majors; B: npm and Cargo; D: defer the sandbox). Stacked on
PR #1764 (steps 1–2: `ignore-scripts` and the install-script drift gate).

Refined during implementation:

- **`package.json` is not on the sensitive list.** Lockfiles decide what gets
  installed, and a dependency edit in `package.json` without a matching
  lockfile change fails `npm ci`. `package.json` is edited in most PRs (test
  scripts), so gating it would put a label on nearly every PR for no extra
  protection.
- **The gate check does not turn auto-merge off itself.** It stays read-only.
  The auto-merge workflow skips sensitive PRs and makes a best-effort attempt
  to turn auto-merge off. A failing **required** check is what finally blocks
  the merge.
Classification: High Assurance (supply chain, CI policy).

## Where we are

After #1764, a malicious dependency version **cannot run code at install
time** anywhere: not under main-sync, CI, agents or developers. A new install
script or command name fails CI.

What remains open: a hijacked version with *no* install script but with
malicious **runtime** code can still be bumped in by Dependabot or an agent's
`dep-bumps` branch, pass green CI, auto-merge, and run the next time the app,
a test or a build script imports it.

The defenses below make that slow, visible and human-gated. In GitHub's
review of major incidents (axios, Solana web3.js, ua-parser-js, Ledger
Connect Kit), malicious versions were pulled within hours of publication.

## Design

### Step 3 — release-age cooldown

- **Dependabot:**
  - `cooldown` on the existing npm, cargo and GitHub Actions entries, with
    `default-days: 7` and `semver-major-days: 14` (decision A). Dependabot
    now defaults to 3 days.
  - Security updates are not delayed: GitHub says cooldowns apply to
    version updates only.
- **CI gate** `scripts/check-dependency-age.mjs`, in the required
  `integrity-checks` job on pull requests:
  - It compares the PR's `package-lock.json`, `tools/mcp-server/package-lock.json`
    and `src-tauri/Cargo.lock` with the **base branch's** copies (`git show`),
    as the drift gate does.
  - For every **added or version-changed** registry package, it reads the
    publish time:
    - npm: the registry document's `time[version]`;
    - crates.io: `/api/v1/crates/<name>/<version>` `created_at`.
  - It **fails** if any is younger than 7 days, or if a publish time cannot
    be read. It fails closed and names each package with its age.
  - Override label: `dependency-age-reviewed`, for urgent security fixes.
  - Lookups run 6 at a time, with a 10-second timeout each. Git and path
    dependencies (no registry) are skipped and listed.
  - Pure diff and decision functions are unit-tested; network calls go
    through an injectable `fetch`.

### Step 4 — registry integrity

- **`npm audit signatures`** runs in the existing `npm-audit` job after
  `npm ci`. It fails on an invalid or missing registry signature, or an
  invalid provenance attestation.
  - I checked it locally: all 946 installed packages have verified
    signatures, and 127 have verified attestations.

### Step 5 — human gate on dependency changes

- **New workflow `dependency-change-gate.yml`** on `pull_request_target`.
  - It runs the **base branch's** workflow, so a PR cannot edit it away.
  - It never checks out PR code. It only lists the PR's files through the
    API.
  - The **sensitive paths**:
    - `package-lock.json` and `**/package-lock.json`;
    - `.npmrc` and `**/.npmrc`;
    - `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`;
    - `.github/dependabot.yml`, `.github/workflows/**` and `.github/CODEOWNERS`;
    - the gate scripts themselves.
  - If any of these is touched and the PR lacks the
    `dependency-change-approved` label, the check **fails**. It re-runs on
    label changes.
  - Ordinary code PRs are untouched.
- **Auto-merge workflow:** before it enables auto-merge, it applies the same
  path list and skips sensitive PRs. That is defense in depth, because push
  workflows run from the branch.
- **CODEOWNERS** gains the same paths, so they are visible in review.

### Step 6 — sandboxed main-sync build (decision D)

Recommended: **defer.** It needs a dedicated macOS user (or a VM) and
changes to the LaunchAgent on your machine. Steps 1–5 already close the
install-time path and gate the runtime one.

## Honest limits

- **Labels are a policy, not a technical lock.** The agents push and comment
  with your GitHub account, so GitHub cannot tell your label from an
  agent's. AGENTS.md already forbids agents from applying approval labels.
  The gate makes a bypass a deliberate, visible act, not an accident.
- **Two GitHub settings only you can change** (part of the deferred GitHub
  settings work; nothing here depends on them):
  1. Mark `dependency-change-gate` and `integrity-checks` as **required**
     status checks on `main`. Until then they are visible but advisory.
  2. Code-owner review cannot be satisfied on your own PRs (agent PRs are
     authored by your account). So "Require review from Code Owners" would
     block those paths entirely, unless you bypass as admin. The label gate
     above is the workable equivalent.

## Decisions for you

- **A. Cooldown length** (recommended: 7 days, 14 for major versions, and
  7 for the CI age gate). The alternative is Dependabot's 3-day default:
  faster updates, less margin.
- **B. CI age gate scope** (recommended: npm and Cargo). The alternative is
  npm only.
- **C. Human gate** (recommended: the `pull_request_target` gate check plus
  the auto-merge skip). The alternative is only skipping auto-merge for
  sensitive PRs, with no failing check.
- **D. Sandboxed build** (recommended: defer).

## Tests (fakes only; mutation proof per behavior)

- **Age gate:**
  - lockfile diffs for npm and Cargo: added, changed, removed, and git/path
    sources;
  - the age threshold boundary;
  - a fetch error fails closed;
  - the label override;
  - the CLI against a temporary git repo, with the network faked.
- **Path policy:** the sensitive-path matcher, shared by the gate and the
  auto-merge workflow, unit-tested.
- **Workflow source gates:**
  - the gate uses `pull_request_target` and never checks out PR code;
  - its permissions are minimal;
  - `npm audit signatures` is present;
  - Dependabot has `cooldown` on every ecosystem;
  - CODEOWNERS covers the paths.
- **`actionlint`** passes on the new workflow.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves (decisions A–D).

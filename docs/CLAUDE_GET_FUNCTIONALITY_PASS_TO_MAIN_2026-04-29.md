# Claude Handoff: Fix Remaining Functionality Gaps And Get To Main

Date: 2026-04-29

## Goal

Finish the Crystal Ball functionality, diagnostics, performance, algorithm, and UI hardening pass, then get the completed work into `main` through the required PR and auto-merge path.

Do not direct-merge locally. Do not bypass GitHub required checks. Do not use a REST merge endpoint. The target branch is `main`.

## Current Reality

The original review findings are fixed on current `origin/main`:

- Missing algorithm metadata now fails closed in `src/services/governance/policy-gate.ts`.
- Strategic diagnostics export sections are structurally redacted in `src/services/diagnostics/export-bundle.ts`.
- Panel smoke now detects async offenders and no longer hides node:test failures in `tests/panels/run-harness.mjs`.

Fresh verification from Codex:

```bash
npx tsx --test \
  src/services/governance/__tests__/policy-gate.test.mts \
  src/services/diagnostics/__tests__/export-bundle.test.mts
```

Result: `37` passed, `0` failed.

```bash
npm run test:panels:smoke
```

Result:

- `234` tests passed, `0` failed
- `230` panels checked
- `32` rendered
- `197` degraded
- `0` silent
- `0` errored
- `0` async-error panels
- `1` skipped: `map`

```bash
npm run test:diagnostics
npm run test:algorithms
npm run typecheck:all
```

Results:

- diagnostics: `151` passed, `0` failed
- algorithms: `55` passed, `0` failed
- typecheck: passed

The broader functionality pass is currently on:

```bash
claude/functionality-pass
```

That branch is already pushed as `origin/claude/functionality-pass` and is currently `11` commits ahead of `origin/main`:

```text
f42a393 test(routes): allowlist sidecar-only routes; fail on new unclassified ones
0fc06b8 fix(rust): remove no-op std::mem::forget on retained Objective-C pointer
cd992c4 ux(panels): empty/degraded states name the data source + required action
25c9221 perf(build): split panels chunk into 5 themed chunks for parallel loading
5a7125a feat(diagnostics): named recurring-loop registry + visibility-aware pause
ab45f74 feat(panels): fixture-backed functional smoke proves rendered states
15c6e1d feat(quality): live quality-debt collector + System Diagnostic UI surface
d7a17b3 feat(algorithms): policy-gated proposals in AlgorithmDiagnostic UI
1ad4b2d feat(diagnostics): Cmd+Shift+D copies schema-v2 frontend bundle + Rust appendix
38e5011 docs: track functionality/diagnostics/performance roadmap
a5b7b56 feat(diagnostics): live snapshot aggregator wires real source/provider/sidecar/feed state
```

## Branch And Remote Rules

Start by checking the actual remotes:

```bash
git remote -v
git status --short --branch
git fetch --all --prune
```

In this Codex workspace, the available remote was:

```text
origin https://github.com/bradleybond512/crystal-ball.git
```

If Claude's workspace has a `macos` remote, follow `AGENTS.md` and use `macos/main` as the base. If Claude only has `origin` pointing at `bradleybond512/crystal-ball`, treat `origin` as Bradley's user-owned repo remote. Do not push to any upstream remote owned by another account.

Never commit directly to local `main`. If work is needed, stay on or create an agent branch:

```bash
git checkout claude/functionality-pass
git rebase origin/main
```

If the branch does not exist locally:

```bash
git checkout -b claude/functionality-pass origin/main
git pull origin claude/functionality-pass
```

If the remote branch does not exist in Claude's environment, recreate the work from this document and `docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md`.

## What To Verify Or Fix Before PR

### 1. Diagnostics Truthfulness

Verify these files exist and are wired:

- `src/services/diagnostics/live-diagnostics-snapshot.ts`
- `src/services/diagnostics/sidecar-probe.ts`
- `src/components/SystemDiagnosticPanel.ts`
- `src/components/CommandCenterPanel.ts`

Expected behavior:

- System Diagnostic uses real panel, source, provider, sidecar, feed, notification, and event snapshots.
- Command Center no longer passes `sources: []`, `providers: []`, or a hard-coded unknown sidecar into system health.
- Sidecar failures can influence system health.
- Feed snapshots can appear in sentinel feed audit output.

Verification:

```bash
npm run test:diagnostics
npm run test:panels:smoke
npm run typecheck:all
```

### 2. Structured Export Path

Verify `Cmd+Shift+D` diagnostics include the schema-v2 frontend export plus the Rust/log appendix.

Files:

- `src/services/diagnostics/frontend-export-composer.ts`
- `src/services/log-bridge.ts`
- `src/services/diagnostics/export-bundle.ts`

Expected behavior:

- Frontend diagnostics export contains the live diagnostics snapshot.
- Strategic sections remain redacted.
- Rust/Tauri logs are appended as supporting evidence, not used as the only diagnostics bundle.

Verification:

```bash
npm run test:diagnostics
npx tsx --test src/services/diagnostics/__tests__/frontend-export-composer.test.mts
npm run typecheck:all
```

### 3. Algorithm UI Policy Gating

Verify Algorithm Diagnostic UI does not show raw safe-adjustment proposals as if they are automatically safe.

Files:

- `src/components/AlgorithmDiagnosticPanel.ts`
- `src/services/governance/policy-gate.ts`
- `src/services/algorithms/algorithm-registry.ts`

Expected behavior:

- Adjustment proposals are run through `gateAdjustmentProposal()`.
- Unknown algorithm metadata requires user approval.
- Safety-critical tuning is denied or escalated according to policy.
- UI shows the policy verdict and required evidence.

Verification:

```bash
npm run test:algorithms
npx tsx --test src/services/governance/__tests__/policy-gate.test.mts
npm run test:panels:smoke
npm run typecheck:all
```

### 4. Functional Panel Smoke

The current non-crash smoke result is good, but `197` degraded panels means the app still needs meaningful functional checks.

Verify these files exist:

- `tests/panels/panel-fixtures.mts`
- `tests/panels/panel-fixtures.test.mts`

Expected behavior:

- Fixture-backed panels prove important panels can reach rendered states with representative data.
- The smoke harness still fails on silent, errored, and async-error panels.
- Known-broken baseline stays empty unless there is a justified follow-up issue.

Verification:

```bash
npm run test:panels:fixtures
npm run test:panels:smoke
```

Record the final panel counts in the PR.

### 5. Panel UX For Degraded States

Verify degraded and empty states tell the user what source is missing and what action is needed.

Files already touched by the current pass:

- `src/components/FearGreedPanel.ts`
- `src/components/FuelPricesPanel.ts`
- `src/components/GdeltIntelPanel.ts`
- `src/components/InternetDisruptionsPanel.ts`
- `src/components/NationalDebtPanel.ts`

Expected behavior:

- Error/degraded states are actionable.
- No panel should show a vague blank, spinner-only, or unexplained "error" state after refresh fails.

Verification:

```bash
npm run test:panels:smoke
npm run typecheck:all
```

### 6. Quality Debt And Self-Diagnosis

Verify live quality debt is populated from real system state and surfaced in diagnostics.

Files:

- `src/services/quality/quality-debt-state.ts`
- `src/services/quality/__tests__/quality-debt-state.test.mts`
- `src/components/SystemDiagnosticPanel.ts`

Expected behavior:

- Quality debt collector identifies recurring degraded panels, failing providers, feed staleness, algorithm uncertainty, and export/diagnostic gaps.
- System Diagnostic gives a useful summary rather than a static placeholder.

Verification:

```bash
npm run test:strategic-self-improvement
npm run test:diagnostics
npm run typecheck:all
```

### 7. Performance And Bundle Shape

Verify the current panel chunk split is useful and does not regress bundle policy.

Files:

- `vite.config.ts`
- `src/app/panel-layout.ts`

Expected behavior:

- Panel code is split into themed chunks.
- Invisible or low-priority recurring work can pause.
- Bundle check stays under policy.

Verification:

```bash
npm run build
npm run bundle:check
```

Record the largest chunks in the PR.

### 8. Timer And Listener Hygiene

Verify recurring work is named, observable, and visibility-aware.

Files:

- `src/services/diagnostics/recurring-loops.ts`
- `src/services/diagnostics/__tests__/recurring-loops.test.mts`
- `src/app/panel-layout.ts`

Expected behavior:

- Named recurring loops are registered.
- Low-priority loops can pause when hidden.
- Diagnostics can show loop health/counts.

Verification:

```bash
npx tsx --test src/services/diagnostics/__tests__/recurring-loops.test.mts
npm run test:diagnostics
npm run typecheck:all
```

### 9. Route Audit

Verify sidecar-only routes are classified and new unclassified routes fail tests.

Files:

- `tests/panels/sidecar-routes-audit.test.mts`
- `tests/panels/sidecar-routes-allowlist.json`

Expected behavior:

- Renderer route calls have matching sidecar handlers.
- Existing sidecar-only routes are classified as intentional, future UI, or deprecated.
- New unclassified sidecar-only routes fail CI.

Verification:

```bash
npm run test:panels:smoke
```

### 10. Desktop/Rust Warning Cleanup

Verify the no-op `std::mem::forget(mgr)` warning remains fixed.

File:

- `src-tauri/src/main.rs`

Expected behavior:

- Rust build no longer warns about forgetting a `Copy` value.
- No behavior regression in menu/activation pointer retention.

Verification:

```bash
npm run desktop:build:app:full
```

If the desktop build is too slow locally, at minimum run:

```bash
npm run build
npm run typecheck:all
```

Then rely on CI/main-sync for the full desktop package gate.

## Required Full Verification Before PR Ready

Run this set before marking the PR ready:

```bash
npm run lint:ci
npm run lint:md
npm run secrets:scan
npm run typecheck:all
npm run test:diagnostics
npm run test:algorithms
npm run test:strategic-self-improvement
npm run test:panels:fixtures
npm run test:panels:smoke
npm run scenarios:check
npm run build
npm run bundle:check
```

Run if local environment can support it:

```bash
npm run desktop:build:app:full
node scripts/release-doctor.mjs --allow-existing-target-release --variant full
```

If any command is skipped, document the exact reason in the PR.

## Commit Rules

Stage files by explicit path only. Never use `git add .` or `git add -A`.

Every commit must include:

```text
Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>
```

Keep commit messages concise and explain why.

Example:

```bash
git add src/components/SystemDiagnosticPanel.ts \
  src/services/diagnostics/live-diagnostics-snapshot.ts \
  src/services/diagnostics/__tests__/live-diagnostics-snapshot.test.mts

git commit -m "feat(diagnostics): surface live system truth" \
  -m "Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>"
```

## PR And Main Delivery Path

Push only the agent branch to Bradley's repo remote:

```bash
git push origin claude/functionality-pass
```

Create or update the PR:

```bash
gh pr create \
  --base main \
  --head claude/functionality-pass \
  --title "Harden diagnostics, panel smoke, algorithms, and performance" \
  --body-file /tmp/crystalball-functionality-pass-pr.md
```

If the PR already exists:

```bash
gh pr view --web
gh pr edit --body-file /tmp/crystalball-functionality-pass-pr.md
```

PR body must include:

- What changed.
- Which original review findings were already fixed.
- Final verification command results.
- Final panel smoke counts.
- Bundle check largest chunks.
- Any skipped checks and why.
- Any accepted residual risk.

Enable auto-merge only after required checks are green or queued:

```bash
gh pr checks --watch
gh pr merge --auto --squash
```

If the repo requires a different merge method, use the configured GitHub auto-merge method. Do not merge locally and do not call the REST merge endpoint.

After auto-merge completes:

```bash
git checkout main
git pull --ff-only origin main
git log --oneline -1
```

Then verify local main-sync if available:

```bash
npm run main-sync:run
cat ~/.crystalball-main-sync/status.json
```

Expected final state:

- PR merged into `main`.
- Required checks passed.
- Local `main` fast-forwarded to remote `main`.
- Main sync status is idle/successful.
- `installedSha` equals the merged `main` SHA.

## Stop Conditions

Stop and ask Bradley before proceeding if:

- Required checks fail for reasons not understood.
- Any test reveals a safety, redaction, policy-gate, or diagnostics integrity regression.
- The branch has drifted far enough that rebase causes non-trivial conflicts in diagnostics, panels, export, or algorithm policy files.
- GitHub auto-merge is unavailable and the only path seems to be a direct merge.
- Any secret scan reports a real finding.

## Ready-To-Paste Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Goal: finish the functionality/diagnostics/performance/algorithm/UI hardening pass and get it merged to main through the required PR + GitHub auto-merge path. Do not direct-merge locally. Do not bypass required checks.

Start by reading:
- AGENTS.md
- docs/CLAUDE_GET_FUNCTIONALITY_PASS_TO_MAIN_2026-04-29.md
- docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md

Current branch to inspect first:
- claude/functionality-pass

Current known state:
- The original review findings for policy-gate fail-closed behavior, strategic export redaction, and panel smoke async/node:test handling are fixed on origin/main.
- The broader functionality pass is on claude/functionality-pass and is 11 commits ahead of origin/main.
- Fresh Codex verification passed:
  - policy/export targeted tests: 37 passed
  - npm run test:panels:smoke: 234 passed, 0 failed; 32 rendered, 197 degraded, 0 silent, 0 errored, 0 async-error panels, map skipped
  - npm run test:diagnostics: 151 passed
  - npm run test:algorithms: 55 passed
  - npm run typecheck:all: passed

Your tasks:
1. Re-check branch/remotes and make sure you are not on local main for work.
2. Verify the functionality pass still contains:
   - live diagnostics snapshot wiring
   - frontend schema-v2 diagnostics export plus Rust/log appendix
   - policy-gated Algorithm Diagnostic proposals
   - fixture-backed panel functional smoke tests
   - actionable degraded/empty panel states
   - live quality-debt collector and System Diagnostic surface
   - panel chunk/performance split
   - named recurring-loop diagnostics
   - sidecar-only route classification
   - Rust no-op warning cleanup
3. Fix any regressions or missing pieces you find.
4. Run the required verification suite:
   npm run lint:ci
   npm run lint:md
   npm run secrets:scan
   npm run typecheck:all
   npm run test:diagnostics
   npm run test:algorithms
   npm run test:strategic-self-improvement
   npm run test:panels:fixtures
   npm run test:panels:smoke
   npm run scenarios:check
   npm run build
   npm run bundle:check
5. Run desktop build/release doctor if the local environment supports it:
   npm run desktop:build:app:full
   node scripts/release-doctor.mjs --allow-existing-target-release --variant full
6. Stage only explicit file paths. Do not use git add . or git add -A.
7. Include this commit trailer on every commit:
   Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>
8. Push the agent branch to Bradley's repo remote.
9. Create or update the PR targeting main.
10. Wait for required checks and enable GitHub auto-merge. Do not direct-merge.
11. After merge, fast-forward local main and run main-sync if available. Confirm installedSha equals the merged main SHA.

In the PR body include exact verification results, panel smoke counts, bundle-check summary, skipped checks if any, and remaining risks.
```

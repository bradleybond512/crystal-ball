# Crystal Ball Agent Rules

## Active Roadmap

- Desktop delivery, worker reliability, diagnostics, UI readiness, QA-gate,
  feed-health, native-quality, or release-proof work must start with
  `docs/QUALITY_RELIABILITY_ROADMAP.md`.
- Claim one `REL-NNN` task through a draft PR before production implementation
  and update its status and evidence in the completing PR.
- Prediction, calibration, correlation, or self-tuning work must start with
  `docs/PREDICTION_ACCURACY_ROADMAP.md`.
- Claim one `ACC-NNN` task through a draft PR before implementation and update
  its status and evidence in the same PR that completes the work.
- `docs/PREDICTION_UPLIFT_PLAN.md` is a reference design, not the live tracker.

## Delivery Path

- `main` is the only merge target.
- Agent branches (`claude/*`, `codex/*`, `copilot/*`) must go through PRs and GitHub auto-merge after required checks pass.
- Do not merge agent PRs directly with the REST merge endpoint or local `git merge` unless explicitly told.
- Finish every agent PR with `bash scripts/pr-closeout.sh`: it verifies every
  commit is pushed, the PR head equals the local tip, and the review verdict
  pins that tip — then arms auto-merge. Arming by hand skips those checks and
  has lost the race twice.

## Review Verdict Protocol (replaces the PR-body marker)

The cross-agent review gate verifies a SHA-pinned verdict commit, not free
text. A marker sentence in the PR body proves nothing and is no longer read.

1. Run the real cross-agent review (`claude/*` → Codex; `codex/*` → Claude)
   against the branch tip.
2. When it concludes with zero blocking findings, save the reviewer's actual
   concluding output to a file and record it:

   ```bash
   node scripts/verify-review-verdict.mjs --record --reviewer codex --evidence-file /path/to/conclusion.txt
   ```

   This writes `.agentic/reviews/<tip-sha>.json` and commits it as the new tip.
   The commit may touch nothing else.
3. Push. CI re-derives everything: the tip must be a verdict-only commit whose
   parent is the exact reviewed sha, the reviewer must be the required
   cross-agent (self-review is rejected), and the evidence must be quoted
   reviewer output.

Pushing any code after the verdict makes the check red until a fresh review is
recorded — a stale approval cannot ride a new push into main. That is the
failure that merged #1601 mid-review. If the `CI_CODEX_REVIEW` repo variable is
`on` (requires an `OPENAI_API_KEY` Actions secret), CI runs the Codex review
itself and the verdict commit is not consulted.

## Branch Discipline (MANDATORY — start every session here)

**Never commit directly to local `main`.** Every session must start from a fresh branch.

The canonical repo is `bradleybond512/crystal-ball`. Its remote is named `macos`
on Bradley's Mac and `origin` in most other clones — **resolve the name, never
assume it**, or every command below fails with `'macos' does not appear to be a
git repository`:

```bash
REMOTE=$(git remote -v | awk '/bradleybond512\/crystal-ball.*\(fetch\)/{print $1; exit}')
git fetch "$REMOTE"
git checkout -b codex/your-feature-name "$REMOTE/main"  # use claude/* for Claude sessions
# ... do work, commit freely ...
git push "$REMOTE" codex/your-feature-name
# open PR → auto-merge lands it
```

- Local `main` is read-only — only ever fast-forward it to the canonical `main`
- Committing directly to local `main` causes divergence that is painful to reconcile across sessions
- If you find yourself on `main` with changes, move to a branch before pushing: `git checkout -b codex/rescue-YYYYMMDD`

**Re-sync before your first commit.** Several agent sessions run in parallel and
`main` moves during long tasks — it has moved mid-task by 2+ commits inside a
single hour. Rebase onto the freshly-fetched canonical `main` before committing,
not after, so conflicts surface while the work is still in your head.

## Release And Main Sync

- Official desktop releases are tag-driven.
- Continuous install to Bradley's Mac is handled locally by `npm run main-sync:setup`, which installs a macOS LaunchAgent that polls `macos/main`.
- The sync clone lives at `~/.crystalball-main-sync/repo`. Never develop there; it is disposable and owned by the sync agent.
- The local Mac sync path must:
  - run `npm run lockfile:check`
  - run `npm ci`
  - run `npm run typecheck:all`
  - run `npm run build`
  - run `npm run desktop:build:app:full`
  - install via `node scripts/install-built-app.mjs --relaunch`
  - refuse to install unless GitHub required checks for `main` are green

## Local Sync Agent

- Bootstrap or repair the sync agent with `npm run main-sync:setup`.
- Setup must resolve a stable Node executable whose major matches
  `.node-version`; never persist a Homebrew `Cellar` version path in the plist.
- Trigger a one-off sync manually with `npm run main-sync:run`.
- The agent state lives under `~/.crystalball-main-sync/`:
  - `repo/` clean clone
  - `state.json` last installed commit
  - `status.json` last sync result
  - `logs/` LaunchAgent stdout/stderr
- If `/scripts/sync-main-to-mac.mjs` or `/scripts/setup-main-sync-agent.mjs` changes, rerun `npm run main-sync:setup`.
- Do not add any `self-hosted` jobs to PR-triggered workflows in this public repo.

## Safety

- Prefer fail-closed behavior. If signing, verification, packaging, or install checks fail, stop the sync instead of falling back to a weaker path.
- Keep `~/Applications/Crystal Ball.app` as the canonical install target.
- This is a user-owned repo on GitHub, so non-provider patterns and validity checks are unavailable. The compensating control is mandatory repo secret scan coverage in local hooks and CI; keep `npm run secrets:scan:staged` and `npm run secrets:scan` enabled and passing.

## Agentic Engineering Workflow

Use `.agents/skills/crystal-ball-feature-workflow/SKILL.md` for every nontrivial feature, multi-file bug fix, provider integration, prediction-system change, Tauri/native change, or security-sensitive task.

### Work classification

- **Fast:** isolated documentation, copy, style, or obvious one-file fixes.
- **Standard:** normal features, multi-file fixes, provider work, UI behavior, performance work, and test additions.
- **High assurance:** prediction/calibration logic, security boundaries, secrets, Tauri IPC, filesystem or network permissions, migrations, destructive operations, release/install logic, and architecture changes.

High-assurance work must stop for human approval after discovery and design, before production implementation.

### Required sequence

For Standard and High Assurance work:

1. Create a structured feature brief with goals, acceptance criteria, constraints, non-goals, unknowns, and risk.
2. Delegate read-only repository exploration to `repository_analyst`.
3. Delegate design to `architect` before editing production code.
4. Decompose the approved design into bounded tasks with owners, dependencies, file scope, and validation commands.
5. Delegate implementation to the narrowest suitable specialist.
6. Require behavior-focused tests for every behavior change, each carrying a mutation proof (see "Mutation proof").
7. Run the relevant targeted test scripts, then `bash scripts/agentic-validate.sh --tests "<the scripts you ran>"`.
8. Delegate the completed diff to `independent_reviewer`; the reviewer must not be the implementer.
9. Repair confirmed findings and rerun affected checks. Allow at most two automatic review/repair cycles.
   If a finding survives the second cycle, **stop and escalate to the human** with the finding, both
   attempted repairs, and why they failed. Do not start a third cycle, silently drop the finding,
   downgrade its severity, or reclassify it as pre-existing to close it out.
10. Prepare a draft PR summary. Do not push, merge, publish, deploy, install, or alter production data without explicit approval.

### Crystal Ball architecture boundaries

- Preserve existing module and provider conventions before introducing new abstractions.
- Validate and normalize external data at provider boundaries.
- **Never record a healthy vote for a provider that contributed nothing.** This is the
  repository's most-repeated defect class, shipped twice and caught in review a third
  time. `recordDomainObservations(id, obs, ok)` must derive `ok` from the **adapter
  output**, not from the raw fetch: a provider whose rows are all dropped downstream —
  unrecognized enum, sentinel value, missing coordinate — reads green while contributing
  zero observations, so the domain silently runs single-source while the UI claims
  "verified by N independent sources". A fail-*closed* miss costs one vote; a fail-*open*
  phantom vote corrupts the corroboration count itself. Reference implementations:
  `kpVote()` in `spaceweather/kp-fusion-observations.ts`, `tempVote()` in
  `weather/weather-fusion-observations.ts`. Deliberate inversions must say so at the call
  site and explain why — see the `recordDomainObservations('ioda', ...)` call in
  `src/app/data-loader.ts`, where `ok` comes from the fetch precisely because an internet
  with no outages anywhere is a real, healthy observation.
- **Filter untrusted external fields with allowlists, never denylists.** `level !== 'normal'`
  admits `undefined`, a renamed level, and a typo as real observations; `LEVELS[value]`
  admits only what you have seen.
- **Never truthiness-test a coordinate or a numeric reading.** `!lat || !lon` rejects
  longitude 0 (London, Accra) and latitude 0. Use an explicit range check.
- Never cache a malformed-but-HTTP-200 body. Caching one pins the domain dark for the
  full TTL, and the feed reports healthy the whole time.
- Use bounded timeouts, retries, caches, and rate-limit handling for network providers.
- Keep provider-specific schemas out of presentation components.
- Treat forecast, calibration, correlation, scoring, self-tuning, and promotion logic as high assurance.
- Prediction changes must include measurable evidence, benchmark or replay impact where applicable, and rollback behavior.
- Tauri commands and sidecar endpoints must validate input, constrain privileged access, avoid leaking secrets/internal errors, and fail closed.
- Avoid expensive work in render loops and repeated computation over large intelligence datasets.
- Never add dependencies without explaining necessity, maintenance, licensing, bundle/build impact, and security impact.

### Testing and validation

- Never delete tests merely because they fail.
- Never weaken assertions, linting, type checking, secret scanning, CSP checks, or security tests to obtain a pass.
- Prefer focused behavioral tests over broad snapshots.
- Run targeted tests first, then the repository agentic validation gate.
- If any command cannot run, state why; never claim it passed.
- Never assert coverage from reading the code. A test you did not run is not a result.

### Mutation proof

A green suite proves nothing about a test you just wrote. A test that passes both
with and without the fix is worse than no test: it certifies a bug as fixed.
Every behavior change must therefore ship a mutation proof:

1. Start from a clean tree (`git status --short` empty) and record `shasum -a 256` of the file to mutate.
2. Revert only the fix — the guard clause, the filter, the allowlist.
3. **Confirm the mutation applied by looking at `git diff`.** Non-negotiable: an edit that
   silently matched nothing leaves the suite green and reads exactly like a passing
   test. This has already produced a false green in this repo — a `perl -0pi`
   substitution assumed standard indentation on a single-space-indented file, matched
   zero bytes, and the suite stayed green at 124 pass / 0 fail.
4. Run the targeted suite and record the actual fail count and the failing assertion.
5. Restore, then verify the same `shasum` and an empty `git status --short`.

Report the before/after counts as numbers (`22 pass / 0 fail` → `19 pass / 3 fail`).
"Tests confirm the fix" without a recorded red is not a mutation proof.

Two traps specific to this codebase:

- **Source-scoped tests guard the call site, not the function body.** `tests/data-sources-wiring.test.mjs`
  asserts against the *text* of `data-loader.ts`. Mutating the imported helper's body will not turn it
  red. Mutate what the test actually reads.
- Node's test runner reports `ℹ pass N` / `ℹ fail N`. Read those lines, not the exit code alone.

### Completion report

Every completed coding task must report:

- summary and user-visible behavior;
- files and architecture changed;
- validation commands and actual results, quoted as real output — never paraphrased,
  never predicted, never a command you did not run;
- mutation proof per behavior change: file mutated, confirmed-applied diff, red counts, restored checksum;
- independent review outcome;
- unresolved risks;
- manual verification steps;
- rollback considerations;
- proposed commit and draft PR description.

### Live-probe evidence (external data sources)

`independent_reviewer` runs `sandbox_mode = "read-only"` and cannot reach the network,
so no reviewer in this pipeline can catch *"this filter matches zero rows in
production."* Code review cannot substitute for a probe. Every plan-breaking defect
found in the recent provider program came from curling the live API, and each was
invisible in the diff:

- A documented "keep rows with no end date" filter matched **zero** rows — every ongoing
  record carries a non-empty end date, often already in the past.
- Omitting one required-in-practice query parameter returned HTTP 200 with an empty
  collection **forever** — a permanently-dark feed reporting perfect health.
- A source returned HTTP 200 serving a bot-challenge page, not data.
- A documented endpoint did not exist; the real one was discoverable only from the
  body of a 400 response.

So any task adding or changing an external data source must paste, in the completion
report, the live response shape it was built against: the request URL (secrets
redacted), the row count, and the specific fields consumed. Probe the **body**, never
the status code. Calibrate any numeric tolerance from a distribution of samples, never
from one — a single sample is as likely to be the median as the tail.

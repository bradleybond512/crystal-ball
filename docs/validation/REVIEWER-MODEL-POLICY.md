# Reviewer model policy validation

Bradley's decisions (October 4, 2026):

- Claude-written code (`claude/*`) is reviewed by Codex on the newest GPT Sol
  model.
- Codex-written code (`codex/*`) is reviewed by Claude on **Sonnet** only. No
  Opus reviewers.
- Reviewer roles run at **medium** effort, to keep token use down.
- Enforcement: "Pin + gate check". The models are pinned in the reviewer
  configs, and the verdict gate rejects any other model.
- Scope: reviewer routing only. Agents that are not reviewers keep their
  settings.

The newest Sol model is `gpt-6.1-sol`, released September 29, 2026. It is
the newest Sol slug in the local Codex model catalog (after `gpt-5.6-sol` and
`gpt-6-sol`) and already Bradley's global Codex default.

## What changed

- **`scripts/verify-review-verdict.mjs`** (the gate CI runs from `origin/main`):
  - `--record` requires `--model <id>`, refuses a disallowed model before
    writing anything, and stores `model` in `.agentic/reviews/<sha>.json`.
  - The check rejects a verdict whose model is missing or not allowed:
    - Codex: `gpt-<major>[.<minor>]-sol` at `MIN_SOL_VERSION` (6.1) or newer.
      Variants such as `-mini` and other families such as Luna are rejected.
    - Claude: `sonnet` or `claude-sonnet-<version>`. Opus and Haiku are
      rejected.
  - Reasoning effort is a cost setting pinned in `.codex/`, not a gate
    condition, so one hard PR can still get a deeper review.
- **`scripts/ci-codex-review.mjs`** (the CI-side path, currently off): runs
  `codex exec --model gpt-6.1-sol --config model_reasoning_effort="medium"`.
  CI extracts each script on its own, so the model id is repeated there, and a
  test keeps the two copies in step.
- **`scripts/cross-agent-check.mjs`:** the recording advice includes
  `--model` and states the policy.
- **`.codex/config.toml`:** `review_model = "gpt-6.1-sol"`, used by Codex's
  own `/review`. Nothing else there changes.
- **The two Codex reviewer roles** (`independent-reviewer`, `sidecar-reviewer`)
  pin `model = "gpt-6.1-sol"` and `model_reasoning_effort = "medium"`. The
  other nine agents are unchanged.
- **New `.claude/agents/cross-agent-reviewer.md`:** a Claude Code subagent
  pinned to `model: sonnet` and `effort: medium`, used for every Claude
  cross-agent review.
- **`.gitignore`:** `.claude/` becomes `.claude/*`, with an exception for that
  one file so every checkout receives it. Local Claude files such as
  `settings.local.json` stay ignored.
- **Docs:** `AGENTS.md`, `CLAUDE.md` and `docs/UI_PERF_HANDOFF_FOR_CODEX.md`
  describe the policy and the `--model` flag.

## Correction after Sol's review of e28c64624

Sol (`gpt-6.1-sol`, medium) reviewed the first commit and found one blocking
routing issue, plus two follow-ups:

- **Blocking: CI routing.** With `CI_CODEX_REVIEW=on`, the workflow sent
  every same-repo agent branch to the CI Sol review. That included `codex/*`,
  which bypassed the Sonnet requirement.
  - **Workflow:** `.github/workflows/cross-agent-review.yml` now routes only
    `claude/*` and `copilot/*` to that path. `codex/*` always takes the
    SHA-pinned verdict check.
  - **Script:** `ci-codex-review.mjs` refuses a branch that a Codex reviewer
    may not approve (`codexMayReview`), so a misrouted `codex/*` run fails
    closed.
- **Sonnet validator:** it accepted malformed ids (`sonnet-4-opus`,
  `sonnet-4..`, `claude-sonnet-4-6-evil`). It now accepts exactly `sonnet`
  or `claude-sonnet-<major>[-<minor>][-<yyyymmdd>]`, optionally with
  `[1m]`.
  - The Sol validator also rejects leading zeros (`gpt-06.1-sol`).
- **Migration guidance:** the old text said to re-record a verdict, but
  `--record` refuses to stack verdicts. `AGENTS.md` now gives a concrete
  migration that replaces the old verdict commit (see Rollout).

The routing test runs the workflow's real "Review gate" script against
stubbed `git`, `npm` and `node`, and checks which verifier each branch
reaches.

## Limit

Without CI-side review, the recording agent reports the model itself, just
as it reports the reviewer. The check stops a review that ran on the wrong
model by mistake, not a deliberately false record. Turning on
`CI_CODEX_REVIEW` would close that gap for Codex reviews.

## Upgrading

When a newer Sol model ships, raise `MIN_SOL_VERSION` and the four pins in
one PR:

- `.codex/config.toml`;
- the two reviewer agents;
- `CI_REVIEW_MODEL`.

The tests fail if any pin falls below the floor. Raising the floor makes
unmerged verdicts from the older model fail; migrate them as described in
Rollout.

## Tests

`tests/agentic-pipeline.test.mjs` (`test:agentic-pipeline`), 65 tests, all green:

- the model allow and reject lists for both reviewers, including the
  malformed ids from Sol's review and leading-zero Sol ids;
- verdicts without an allowed model are rejected;
- a Sonnet verdict on `codex/*` passes, and an Opus one fails;
- end to end, `--record` with no model or an old model commits nothing;
- CI arguments and recording advice use the policy model at medium;
- both reviewer roles are pinned at medium, and the Claude reviewer is on
  Sonnet at medium and is not git-ignored;
- CI Sol review applies only where a Codex reviewer may approve, and the
  script refuses `codex/*`;
- the workflow's real routing script, run against stubs, sends `codex/*` to
  the verdict check even with CI Codex on. `claude/*` and `copilot/*` go to
  CI Sol, and non-agent branches go nowhere.

The existing fixtures now carry `model`.

## Mutation proof

Each mutation was applied, the suite run, the file restored, and the SHA-256
verified. Runs were on the Mac, where the git-ignore test can call git.

First round (M01–M17): all 17 turned red at `e28c64624`. They were re-run on
the corrected code. M02 and M03 targeted the two validator regexes that the
correction replaced, so they no longer apply; C06–C08 cover them. The other
15 are still red.

| ID | Mutation | Fails |
|---|---|---|
| M01 | Sol floor lowered to 6.0 | 3 |
| M02 | Sol id not anchored (accepts `-mini`) | 1 |
| M03 | any Claude model accepted | 2 |
| M04 | gate skips the model check | 2 |
| M05 | record skips the model check | 1 |
| M06 | `--model` optional on record | 1 |
| M07 | CI review effort high | 1 |
| M08 | CI review on an older Sol | 1 |
| M09 | reviewer agent unpinned | 1 |
| M10 | Codex reviewer role back to high | 1 |
| M11 | Claude reviewer on Opus | 1 |
| M12 | `/review` on an older Sol | 1 |
| M13 | advice suggests an old model | 1 |
| M14 | floor model itself rejected | 5 |
| M15 | record omits the model | 1 |
| M16 | Claude reviewer effort high | 1 |
| M17 | Claude reviewer git-ignored again | 1 |

Correction round (C01–C08): all 8 red.

| ID | Mutation | Fails |
|---|---|---|
| C01 | workflow lets `codex/*` take the CI Sol path | 1 |
| C02 | workflow ignores the routing flag | 1 |
| C03 | `copilot/*` dropped from the gate | 1 |
| C04 | script would review `codex/*` | 1 |
| C05 | script refusal removed | 1 |
| C06 | old loose Sonnet validator | 1 |
| C07 | Sonnet id with a trailing suffix accepted | 1 |
| C08 | Sol major with a leading zero accepted | 1 |

## Rollout

The gate runs from `origin/main`, so once this merges every agent PR is
checked against the policy.

- **No verdict yet** (#1762 today): record it with `--model`, using the
  model the review actually ran on.
- **Tip is a verdict recorded without `--model`:** it fails, and `--record`
  will not stack a second verdict on it. Follow the "Migrating a verdict"
  steps in `AGENTS.md`:
  1. `git reset --keep HEAD^` drops only the verdict commit.
  2. Re-record on the same reviewed sha with the original evidence and
     `--model`. Re-run the review first if it did not run on an allowed
     model.
  3. `git push --force-with-lease`.
- **Alternative:** merge such PRs before this one lands.

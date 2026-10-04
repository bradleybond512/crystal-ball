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

The tests fail if any pin falls below the floor.

## Tests

`tests/agentic-pipeline.test.mjs` (`test:agentic-pipeline`), 63 tests:

- the model allow and reject lists for both reviewers;
- verdicts without an allowed model are rejected;
- a Sonnet verdict on `codex/*` passes, and an Opus one fails;
- end to end, `--record` with no model or an old model commits nothing;
- CI arguments and recording advice use the policy model at medium;
- both reviewer roles are pinned at medium, and the Claude reviewer is on
  Sonnet at medium and is not git-ignored.

The existing fixtures now carry `model`.

## Mutation proof

Each mutation was applied, the suite run, the file restored, and the SHA-256
verified. All 17 turned red (run on the Mac, where the git-ignore test can call git).

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

## Rollout

The gate runs from `origin/main`, so the policy applies to every verdict
recorded after this PR merges. Verdicts recorded earlier without `--model`
must be recorded again. The merge plan puts this PR second, right after
the npm-audit fix (#1762), so only #1762 is affected.

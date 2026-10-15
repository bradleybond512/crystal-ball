# Roadmap Consolidation — Handoff for Codex

- **Status:** PROPOSED — waiting for Bradley's approval (D1)
- **Written:** October 14, 2026, by Claude (Opus planning session; read-only
  review of `main` @ `5e1bfa0`, re-checked at `76b1d44`; no code changed)
- **Implements:** Codex, one PR per `RC-N`, branch `codex/rc-N-<slug>`
- **Reviews:** Claude on Sonnet at medium effort (Codex-written work gets a
  Claude review), recorded through the cross-agent gate in `AGENTS.md`
- **Classification:** RC-1 to RC-5 are Standard. RC-6 is High Assurance and
  stops for approval after design.

## Why this exists

Four findings, each verified at `5e1bfa0` and re-checked at `76b1d44`:

1. **The controller steers work to the wrong task.** `npm run roadmap:check`
   reports `Next eligible task is UX-014: Fuel operational evidence`.
   `eligibleTask()` returns the first `TODO` UX task in Progress Tracker order,
   so eleven not-started safety and security tasks (UX-047 national warnings
   current, UX-058 deferred and updated warnings, UX-049 quiet sensors versus
   missing data, and the rest of Tier S below) wait behind feature work.
2. **Status lives in too many places and goes stale.** `ROADMAP.md` calls itself
   canonical, was last updated 2026-07-26 and names none of the live boards.
   `CLAUDE.md` sends agents to `ELITE_REMAINING_GAPS_FOR_CLAUDE.md` (April 28)
   as the "current remaining gaps". `COGNITIVE_ENHANCEMENT_PLAN.md` says
   `PLANNED` in its header while its tracker shows 13 of 16 PRs shipped.
   Sixteen WAITING, MONITOR or BLOCKED tasks are past their `Review after:`
   date.
3. **Agent context costs too many tokens.** `CLAUDE.md` is about 38 KB (about
   9k tokens) and loads into every Claude session. The prediction board is
   110 KB, of which 88 KB is design prose for finished tasks. The usability
   board is 67 KB, of which 27 KB is finished-task prose.
4. **The public repo tracks private and runtime files.** `tmp/security-stack-*.sh`
   and `tmp/tune-security-stack.sh` document Bradley's host defense stack
   (Suricata, Zeek, LuLu, Little Snitch and `socketfilterfw` tuning).
   `api-cache.json` holds 20 KB of cached LLM briefs and theater-posture data
   that no code reads. `verbose-mode.json` is sidecar runtime state.
   `tmp/videos/` holds about 17 MB of demo media.

The rule behind every fix is **one fact, one place**. Task status lives only in
the two controller-checked boards. Every other document points to them and
never restates a status or a count.

## Guardrails (every RC PR)

- Before branching, list open PRs and their files. Do not edit any file that an
  open PR touches; wait for it to land and rebase. Never edit
  `docs/SECURITY_SCAN_ROUND_4_FOR_CODEX.md` or anything under `src-tauri/`.
- Never change a `DONE` or `REJECTED` status. Never set `DONE` or `MONITOR`
  without merged-PR evidence.
- Keep every line the controller parses character-for-character unless a step
  below changes it: task headings (`### UX-NNN — <title>`,
  `### ACC-NNN — <title>`), the
  `Status:`, `Priority:`, `Dependencies:`, `Exit condition:` and
  `Review after:` fields, every line starting `Evidence:`, `Verification:`,
  `Verify:`, `PR:`, `Merged:` or `Landed:`, the Progress Tracker, the Phase 0
  table and the Phase 5 mirror.
- This repository is public. Commit aggregate metrics only: never forecast
  text, entity names linked to saved places, locations or credentials.
- Never apply `dependency-change-approved`, `install-scripts-reviewed` or
  `dependency-age-reviewed`. None of these PRs should need one; if a gate
  fires, stop and report.
- To save tokens, do not read `docs/archive/`, the Round 4 doc,
  `docs/PREDICTION_UPLIFT_PLAN.md` or the overhaul and capstone docs unless a
  step names them. Use low reasoning effort for RC-2 to RC-5 (mechanical) and
  medium for RC-1 and RC-6.

## Queue

| PR | Scope | Class | Depends on | Bradley gate | Status | PR # |
|---|---|---|---|---|---|---|
| RC-1 | Priority-aware next-task selection | Standard | — | D1 | TODO | |
| RC-2 | Board triage: priorities, overdue reviews, ACC-008, UX-062, ACC-703 | Standard | RC-1 | D1, D2, D3 | TODO | |
| RC-3 | Public-repo hygiene | Standard | — | D5 before merge | TODO | |
| RC-4 | Slim both boards | Standard | RC-2 | — | TODO | |
| RC-5 | Archive superseded plans; `ROADMAP.md` becomes an index | Standard | RC-4 | D4, D6 | TODO | |
| RC-6 | `CLAUDE.md` as rules plus pointers | High Assurance | RC-5 | D1, design stop, D7 | TODO | |

Merge one at a time. RC-3 can go whenever D5 is satisfied.

### RC-1 — Priority-aware next-task selection

Change surface: `scripts/roadmap-controller.mjs` and
`tests/roadmap-controller.test.mjs`. No workflow edit is needed; editing
`.github/workflows/` would trip the dependency gate.

- `taskFrom()`: read `field(body, 'Priority')`, trim and uppercase it. Allowed
  values are `S`, `A`, `B` and `C`. A missing field means `C`. Anything else is
  a blocking error: `<id> has unrecognized priority <value>`. Phase 0 table
  rows have no body, so they are `C`.
- `eligibleTask()`: keep the eligibility filter. Order the eligible tasks by
  priority (S, then A, B, C), then by the existing UX-before-ACC preference,
  then by current insertion order. Use a stable sort.
- Show the tier in the advisory and in `renderWatchdog`, for example
  `Next eligible task is UX-047 [S]: Keep national weather warnings current`.
- Leave `compareRoadmaps()` alone. Priority is not a terminal fact and may
  change freely.
- Add tests: missing gives `C`; lowercase normalizes; an invalid value is
  blocking; an `S` task beats an earlier-listed `C` task; ties keep tracker
  order; a dependency-blocked `S` task is skipped; an eligible ACC `S` task
  beats a UX `A` task.
- Verify: `npm run test:roadmap-controller`, then `npm run roadmap:check` on
  the unchanged boards. Output should match `main` apart from the new tier tag;
  every task defaults to `C`, so UX-014 stays next until RC-2.

### RC-2 — Board triage

Docs only: `docs/USABILITY_UPLIFT_FOR_CODEX.md`,
`docs/PREDICTION_ACCURACY_ROADMAP.md`, `docs/COGNITIVE_ENHANCEMENT_PLAN.md`
(header line) and `AGENTS.md` (one bullet).

**1. Priorities (D2).** Add a `Priority:` line next to `Dependencies:` in each
listed task block. Tasks not listed keep the default `C`.

| Tier | Meaning | Tasks |
|---|---|---|
| S | Safety, security, or a user-visible truthfulness defect | UX-033, UX-038, UX-040, UX-047, UX-049, UX-050, UX-052, UX-053, UX-054, UX-055, UX-058, ACC-008 (new), UX-062 (new) |
| A | Forecast trust and calibration | UX-018, UX-019, UX-020, UX-044, ACC-505, ACC-506, ACC-508, ACC-510 |
| B | Performance, battery, quotas | UX-035, UX-036, UX-043, UX-051, UX-056, UX-057 |
| C | Product features | UX-001, UX-002, UX-014, UX-015, UX-016, UX-037 |

UX-018 and UX-019 already specify the analyst-loop recalibration. Do not create
a duplicate task for it.

**2. Overdue reviews.** At `76b1d44` these are overdue: ACC-506, ACC-601 to
ACC-605, ACC-703, ACC-704, UX-000, UX-005, UX-021, UX-026, UX-031, UX-032,
UX-034 and UX-042. Re-run `npm run roadmap:check` for the current list. For
each one:

- If merged evidence meets its `Exit condition:`, advance the status and cite
  that evidence.
- Otherwise add one line, `Reviewed YYYY-MM-DD: <what is still missing>`, and
  set `Review after:` no more than 30 days out.
- If what's missing is Bradley's packaged-app check, say so and leave the
  status unchanged.
- For ACC-601 to ACC-605, set `Review after:` to 30 days after ACC-008 merges,
  so the readiness decision uses fresh sample counts.

**3. New task ACC-008.** Insert this block right after Phase 0's
`Phase exit:` line and before `## Phase 1`. Do not add a Phase 0 table row; a
task must be defined once. Change the `Phase exit:` line to
`Phase exit: ACC-001 through ACC-007 are on main; ACC-008 refreshes the baseline.`

```markdown
### ACC-008 — Refresh the production baseline

Status: `TODO`

Priority: S

Dependencies: none

Measure the installed app read-only, the way ACC-404 did
(`scripts/acc404-first-decision.mts` and its decision record), or use the
latest ACC-702 scheduled evaluation report if it covers every field below.
Add a new dated table under "Current production baseline" and keep the
2026-07-26 table unchanged.

- Per forecaster: resolved count (direct and proxy separate), Brier, the
  ACC-303 paired-baseline Brier, Brier skill, and the ACC-403
  champion/challenger state.
- Aggregates only: no forecast text, entities, places or locations.
- If neither the installed app nor the report is reachable read-only, stop and
  hand off to Bradley. Never substitute dev or fixture data.
- Done when the table and a decision-log row land, and the PR names the exact
  command that reproduces the numbers.
```

ACC-008 is read-only and short, so it can run in parallel with the first Tier S
UX task even though the controller lists UX tasks first.

**4. New task UX-062.** Insert this block after the UX-061 block, and add the
tracker row
`| UX-062 | Label forecasts that trail their baseline | NOT STARTED — HIGH ASSURANCE | |`.

```markdown
### UX-062 — Label forecasts that trail their own baseline *(High Assurance)*

Priority: S

Dependencies: ACC-008

The 2026-07-26 baseline put the analyst loop at Brier 0.569 over 32 resolved
forecasts. Answering 50% every time scores 0.25. Until UX-019 records a
promote, retain or reject decision, people should not see those probabilities
presented as calibrated.

- Change surface: the surfaces that show forecaster probabilities to the user
  (analyst HUD hypotheses, situation dossier, Command Center), reading the
  existing ACC-303 pairings and ACC-403 status. No new scoring code.
- Rule: where matched-cohort Brier skill is at or below 0 and the cohort meets
  the existing minimum-evidence floor, show "Trails base rate" and the paired
  baseline's probability next to the forecast. Below the floor, show
  "Unverified".
- Fail closed: unknown or stale skill shows "Unverified", never nothing. Never
  hide, round or change a forecast, and never suppress a warning. This task
  only adds labels.
- If ACC-008 shows every user-visible forecaster beating its baseline, close
  this task as `REJECTED` with that evidence.
- Done when fixture tests cover beats, trails, unverified and stale on each
  surface, and `npm run test:intelligence`, `npm run test:insights` and
  `npm run typecheck:all` pass.
```

**5. Open the ACC-703 proof window now (D3).** A 30-day window costs calendar
time, not tokens, and should not wait on unrelated correlation work. In the
ACC-703 block, replace the `Dependencies:` and `Exit condition:` lines with:

```markdown
Dependencies: none (calendar window; see Exit condition)

Exit condition: thirty consecutive days of ACC-702 scheduled evaluation reports
exist, starting with the first report after this change merged, for every
forecast cohort recorded in ACC-008. Correlation tasks ACC-505, ACC-506,
ACC-508 and ACC-510 are reported separately and do not hold the window.
```

Set `Review after:` to the merge date plus 31 days. Add a decision-log row:
`| <date> | Open the 30-day forecast proof window now | A calendar-bound proof should not wait on unrelated correlation work |`.
Leave ACC-704 unchanged.

**6. Headers.** Set the prediction board's `> Updated:` line to the PR date.
Change the cognitive plan header to `Status: ACTIVE — see the Progress Tracker`.

**7. `AGENTS.md`.** Under "Active Roadmap", add: "Pick work with
`npm run roadmap:check`. It names the next eligible task by `Priority:` (S, A,
B, C). Do not start a lower tier while a higher-tier task is eligible and
unclaimed unless Bradley says so."

Verify: `npm run roadmap:check` shows zero blocking errors, zero overdue
reviews, and a Tier S task as next eligible. Also run
`npm run test:roadmap-controller` and `npm run lint:md`.

### RC-3 — Public-repo hygiene (gated by D5)

- **Bradley first:** copy `tmp/*.sh` somewhere private. Once this PR merges,
  the next main sync deletes them from the canonical clone.
- Confirm nothing reads these files. At `76b1d44` nothing references
  `api-cache.json` or `tmp/`. The sidecar writes its own `verbose-mode.json`
  under its data directory (`src-tauri/sidecar/local-api-server.mjs:2966`), so
  the root copy is a stray. If you find a reader, stop and report.
- `git rm` all twelve tracked files under `tmp/`, plus the root
  `api-cache.json` and `verbose-mode.json`.
- Add `/tmp/`, `/api-cache.json` and `/verbose-mode.json` to `.gitignore`.
- Do not rewrite history. The files are already public in existing clones;
  removing them from `HEAD` stops further exposure. A history purge is
  destructive and Bradley's call alone.
- Leave `page-load-baseline.png` and `website-screenshots/` alone; they may be
  test baselines.
- Verify: `npm run secrets:scan`, `npm run smoke:offline`, `npm run lint:md`.

### RC-4 — Slim both boards

For every task block whose status is `DONE` or `REJECTED`, in both boards:

- Move the block's design prose verbatim to
  `docs/archive/roadmap-history/<ID>.md`. Start that file with
  `# <ID> — <title>` and
  `> Archived <date> from <board path>. Final status: <STATUS>.`
- In the board, keep the heading, every controller-parsed line (see
  Guardrails), and add one line: `Details: docs/archive/roadmap-history/<ID>.md`.
- Keep open tasks complete; they are the specs agents work from. Keep every
  section that isn't a finished-task block: coordination protocol, status
  values, key systems, delivery order, baselines, verification matrix, risks,
  decision log and findings.

**Proof that nothing the controller sees changed.** Run this on `main` and on
the branch. The two outputs must be identical; put the diff command and its
empty result in the PR body.

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { parseRoadmaps } from './scripts/roadmap-controller.mjs';
const UX = 'docs/USABILITY_UPLIFT_FOR_CODEX.md';
const ACC = 'docs/PREDICTION_ACCURACY_ROADMAP.md';
const s = parseRoadmaps({ [UX]: readFileSync(UX, 'utf8'), [ACC]: readFileSync(ACC, 'utf8') });
console.log(JSON.stringify({ errors: s.errors, programs: s.programs,
  tasks: [...s.tasks].sort((a, b) => a.id.localeCompare(b.id)) }, null, 1));
" > roadmap-parse.json
```

Targets: prediction board at most 30 KB (from 110 KB), usability board at most
45 KB (from 67 KB). State the before and after sizes in the PR body.

### RC-5 — Archive superseded plans; `ROADMAP.md` becomes an index

**Archive rule.** Move a document only when every open item in it is either
shipped (cite the PR) or represented by a live UX or ACC task. If an item is
neither, leave the document in place and list the orphaned item in the PR body
for Bradley. Do not create tasks in this PR.

- **Archive candidates:** `CRYSTAL_BALL_OVERHAUL_ROADMAP.md`,
  `CRYSTAL_BALL_OVERHAUL_CAPSTONE.md`, `CRYSTAL_BALL_WAVE_2_ESTIMATION_CORE.md`
  (reconciled; shipped parts landed in #1233), `ELITE_CRYSTAL_BALL_GAMEPLAN.md`,
  `ELITE_REMAINING_GAPS_FOR_CLAUDE.md`, `ENHANCEMENT_ROADMAP_2026-05.md`, and the
  dated handoffs `docs/CLAUDE_*_2026-04-*.md` and `docs/CLAUDE_*_2026-05-*.md`.
- **Also evaluate with the same rule:** `MISSED_FEATURES_FOR_CLAUDE.md`,
  `WORLD_CLASS_UPGRADE_PLAN_FOR_SONNET.md`, `TRIPLE_CHECK_FINDINGS_2026-06-10.md`,
  `docs/architecture/ROADMAP.md` and
  `docs/superpowers/plans/2026-04-14-master-roadmap.md`.
- **Keep:** both boards, `COGNITIVE_ENHANCEMENT_PLAN.md`,
  `PREDICTION_UPLIFT_PLAN.md` (reference design per `AGENTS.md`), every
  `SECURITY_SCAN_*` doc, and the dated audits (`SECURITY_AUDIT_*`,
  `PRIVACY_*`, `PERFORMANCE_*`), which are records, not plans.

**Mechanics.**

- `git mv` each document to `docs/archive/planning-2026/` and prepend
  `> Archived <date>. Superseded by ROADMAP.md. Historical record; do not act on it.`
- Update every reference, including header comments in `src/` and `tests/`.
  Afterwards, a search for each old `docs/<name>.md` path outside
  `docs/archive/` must find nothing.
- Add a dated section to `docs/archive/README.md` listing the moves.
- Replace `ROADMAP.md` with Appendix A, filling in the date.
- In `CLAUDE.md`, change only the lines that name moved files. The "Current
  remaining gaps" bullet becomes a pointer to `ROADMAP.md`.

Verify: `npm run lint:md`, `npm run docs:check`, `npm run typecheck:all`
(source comments changed), `npm run roadmap:check`, and the zero-reference
search.

### RC-6 — `CLAUDE.md` as rules plus pointers (High Assurance)

**Design stop.** Open a draft PR containing the proposed outline and the rule
inventory below. Wait for Bradley's approval before editing `CLAUDE.md`.

- **Target:** `CLAUDE.md` at most 12 KB (from 38 KB).
- **Rules stay loaded; descriptions load on demand.** Keep these sections
  verbatim: Keychain prohibition (the whole section), the install-scripts and
  dependency-label paragraph, Release Management, Canonical Repo, Git Remotes,
  Branch Discipline, CSP Posture, Tauri/WKWebView Gotchas, Persistence
  Identifiers, Secret Scan Guardrail, and Commands.
- **Move verbatim** to a new `docs/architecture/AGENT_CONTEXT.md`: the plan
  bullets in Project Overview, Orchestration Layer, Home Shell, Foundation
  Intelligence Layers, the Architecture tree, Analyst Reasoning Layer, Web Key
  Vault, Desktop Chrome Activation, Basemap Switcher, App Modes, and Settings /
  API Keys detail. Leave one pointer line per moved section, for example
  `Touching the web key vault? Read docs/architecture/AGENT_CONTEXT.md#web-key-vault first.`
- **Rule inventory.** List every line of the current `CLAUDE.md` that matches
  `never|must|always|only|do not|don't|mandatory|prohibit|required`
  (case-insensitive). Each must still appear verbatim in the new `CLAUDE.md`
  or in `AGENTS.md`. Rule lines from moved sections (for example the web vault's
  "never localStorage") go into a short "Domain invariants" list in `CLAUDE.md`.
  Put the full inventory, with where each line ended up, in the PR body.
  Missing lines must be zero. The only allowed exception is D7.
- Do not slim `AGENTS.md` in this PR.

Verify: the inventory shows zero missing rules, plus `npm run lint:md` and
`npm run docs:check`.

## Bradley's decisions

| ID | Decision | Default if you just approve the plan |
|---|---|---|
| D1 | Approve this plan. Covers RC-1 to RC-5 as Standard and RC-6's design. | — |
| D2 | Tier assignments in RC-2 | As listed |
| D3 | Open ACC-703's 30-day forecast window now, independent of correlation work | Yes |
| D4 | Backlog rescopes in Appendix A | As listed |
| D5 | Keep private copies of `tmp/*.sh` before RC-3 merges; no history rewrite | Copies required; no rewrite |
| D6 | Status of the separate Rust/Kalman/Valhalla build described in the overhaul docs | Appendix A says only that it is not part of this repository |
| D7 | Replace "Always commit with: Co-Authored-By: Claude Sonnet 4.6" with "Commit with the Co-Authored-By trailer for the model actually running this session" | Yes |

**Outside this plan, listed so it isn't lost:** the unanswered disclosure
question holding Round 4 PRs #1760, #1771, #1777 and #1784 (see that doc's
October 11 checkpoint), and the human-only labels on #1776, #1781 and #1785.

## Definition of done

- `npm run roadmap:check`: zero blocking errors, zero overdue reviews, and the
  next eligible task is Tier S.
- `npm run test:roadmap-controller` passes, including the new priority tests.
- `CLAUDE.md` at most 12 KB, prediction board at most 30 KB, usability board at
  most 45 KB.
- No path outside `docs/archive/` references an archived document.
- `tmp/`, `api-cache.json` and `verbose-mode.json` are untracked and ignored,
  and Bradley has confirmed his copies.
- RC-6 rule inventory shows zero missing rules.
- Every RC PR carries a recorded Claude (Sonnet, medium) cross-agent review.
- This file's `Status:` reads `COMPLETE` and it moves to
  `docs/archive/planning-2026/`.

## Copy/Paste Prompt For Codex

```text
Read docs/ROADMAP_CONSOLIDATION_FOR_CODEX.md and AGENTS.md. Do not read
docs/archive/, docs/SECURITY_SCAN_ROUND_4_FOR_CODEX.md, or the overhaul and
capstone docs.

Take the lowest-numbered RC-N in the Queue whose dependencies have merged and
whose Bradley gate is satisfied. Do one RC per PR on codex/rc-N-<slug> from a
fresh origin/main. Before branching, list open PRs and avoid their files.
Follow the Guardrails exactly.

RC-6 is High Assurance: open a draft PR with the outline and rule inventory,
then stop for Bradley's approval before editing CLAUDE.md.

Finish with that RC's verification commands, paste their results into the PR
body, update this file's Queue row (Status and PR #), and request the Claude
(Sonnet, medium) cross-agent review.

Stop and report instead of guessing if a gate fires, a check fails, a file you
need is in an open PR, or a step would change a DONE or REJECTED status.
```

## Appendix A — Proposed `ROADMAP.md`

```markdown
# Crystal Ball — Roadmap

> This file is an index. It holds no task status: status lives only in the two
> controller-checked boards below. Run `npm run roadmap:check` for live status
> and the next eligible task. Last restructured: <date>.

## Live boards

| Board | Covers | IDs |
|---|---|---|
| [Usability uplift](docs/USABILITY_UPLIFT_FOR_CODEX.md) | Warnings, feeds, surfaces, performance | `UX-NNN` |
| [Prediction accuracy](docs/PREDICTION_ACCURACY_ROADMAP.md) | Outcomes, calibration, correlation, promotion | `ACC-NNN` |

Programs with their own trackers:
[cognitive enhancement](docs/COGNITIVE_ENHANCEMENT_PLAN.md) and
[security round 4](docs/SECURITY_SCAN_ROUND_4_FOR_CODEX.md) (read its latest
checkpoint first).

## How work is chosen

Every open task has a `Priority:`. The controller offers the highest tier first.

| Tier | Meaning |
|---|---|
| S | Safety, security, or a user-visible truthfulness defect |
| A | Forecast trust and calibration |
| B | Performance, battery, quotas |
| C | Product features |

High Assurance tasks stop for Bradley's approval after design (see AGENTS.md).

## Principles every task keeps

1. Local-first: private data (location, saved places, watchlists, keys) stays
   on this Mac unless Bradley enables a cloud path, and a cloud fallback is
   never silent.
2. Stale or missing data lowers confidence and stays visible; it never
   silently disappears.
3. Every probability shown to a person is calibrated against outcomes or
   labeled as not yet verified.
4. Baselines before models; learned models only when resolved outcomes
   support them.
5. Safety-critical alerts are never suppressed by quiet hours, rate limits or
   modes without a visible trace.

## Not on this repository's path

Real-time kinematic tracking (IMM, JPDA) and route-based intent prediction need
a tracker and trajectory data this codebase does not have. The Rust, Kalman and
Valhalla build described in the 2026 overhaul documents is not part of this
repository. Record: docs/archive/planning-2026/.

## Backlog ideas (not tasks)

An idea becomes work only as a board task with a priority and acceptance
checks, plus Bradley's decision if it touches a principle above.

| Idea | Constraint |
|---|---|
| Voice commands | On-device speech recognition and synthesis only |
| Satellite imagery on demand | Account-free public sources such as Sentinel-2; tell the user a fetch reveals the area viewed; no identity-linked commercial providers |
| Team collaboration | Not planned: a sync service conflicts with principle 1. Revisit only as end-to-end-encrypted sharing Bradley approves |
| Paste and leak monitoring | Only through aggregated breach APIs already in use (such as HIBP); no direct crawling of criminal forums |
| Historical playback persistence | Use the existing IndexedDB store (`crystalball_db`), not a new SQLite store |

## History

Shipped work: [CHANGELOG.md](CHANGELOG.md). Superseded plans:
[docs/archive/](docs/archive/README.md).
```

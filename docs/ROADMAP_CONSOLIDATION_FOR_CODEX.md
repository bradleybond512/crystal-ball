# Roadmap Consolidation — Handoff for Codex

- **Status:** PROPOSED — waiting for Bradley's approval (D1)
- **Written:** October 14, 2026, by Claude (Opus planning session; read-only
  review of `main` @ `5e1bfa0`, re-checked at `76b1d44`; no code changed)
- **Implements:** Codex, one PR per `RC-N`, branch `codex/rc-N-<slug>`
- **Reviews:** Claude on Sonnet at medium effort (Codex-written work gets a
  Claude review), recorded through the cross-agent gate in `AGENTS.md`
- **Classification:** RC-1 to RC-5 are Standard. RC-6 is High Assurance and
  stops for approval after design.

Reviewing or correcting this document does not approve D1–D7 or start any RC.
All queue entries, product rescopes, evidence collection, cleanup and agent-rule
changes remain proposed. Record Bradley's explicit decisions and the scope of
each authorized RC before execution. Existing design, privacy/disclosure,
human-label, review, publication and installation gates in `AGENTS.md` remain
binding. If cleanup needs destructive operations or a runtime/security change,
stop for the applicable High Assurance design approval instead of treating the
Standard classification as permission.

## Why this exists

Four findings, each verified at `5e1bfa0` and re-checked at `76b1d44`:

1. **The controller steers work to the wrong task.** `npm run roadmap:check`
   reports `Next eligible task is UX-014: Fuel operational evidence`.
   `eligibleTask()` prefers the first eligible `TODO` UX task in ID order,
   after the parser and reconciliation have sorted tasks by ID,
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
  table and the Phase 5 mirror. Preserve the complete paragraphs and wrapped
  continuations containing evidence, scope qualifications, integration holds
  and native-acceptance caveats; parser equality alone does not prove these
  survived. A narrative paragraph moved by RC-4 must move intact behind an
  explicit board link, never be truncated to meet a byte target.
- Keep `Review after:` values as bare `YYYY-MM-DD` calendar dates. Put
  provisional/pending explanations on a separate prose or `Reviewed` line,
  never inside the controller's date field.
- This repository is public. Commit aggregate metrics only: never forecast
  text, entity names linked to saved places, locations or credentials.
- Never apply `dependency-change-approved`, `install-scripts-reviewed` or
  `dependency-age-reviewed`. None of these PRs should need one; if a gate
  fires, stop and report.
- To save tokens, do not read `docs/archive/`, the Round 4 doc,
  `docs/PREDICTION_UPLIFT_PLAN.md` or the overhaul and capstone docs unless a
  step names them. Keep the session's authorized implementation model and
  effort unchanged; this document does not authorize changing those settings.
  Reviewer routing and medium review effort remain as required by `AGENTS.md`.

## Queue

| PR | Scope | Class | Depends on | Bradley gate | Status | PR # |
|---|---|---|---|---|---|---|
| RC-1 | Priority-aware next-task selection | Standard | — | D1 | TODO | |
| RC-2 | Board triage: priorities, overdue reviews, ACC-008, UX-062, ACC-703 | Standard | RC-1 | D1, D2, D3 | TODO | |
| RC-3 | Public-repo hygiene | Standard | Consumer/backup review | D1, D5 before changes | TODO | |
| RC-4 | Slim both boards | Standard | RC-2 | D1 | TODO | |
| RC-5 | Archive superseded plans; `ROADMAP.md` becomes an index | Standard | RC-4, orphan reconciliation | D1, D4, D6; no open-file overlap | TODO | |
| RC-6 | `CLAUDE.md` as rules plus pointers | High Assurance | RC-5 | D1, design stop, D7 | TODO | |

After explicit authorization, merge one at a time through the normal protected
path. RC-3 can proceed separately only after its consumer and backup gates.
The `CLAUDE.md` link edits in RC-5 and the RC-6 rewrite overlap open draft #1781
at the October 15 checkpoint. Wait or obtain an explicit overlap-resolution
decision; do not close, retarget or delete that draft or a held checkout merely
to clear this queue.

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
  then by ascending task ID using the existing `id.localeCompare` comparison.
  This is the least invasive deterministic tie-break: the parser and
  reconciliation already sort by ID. Do not claim physical tracker/insertion
  order is preserved. Introducing source order would be a separate explicit
  implementation choice, carrying that order through both transformations and
  testing it end to end.
- Show the tier in the advisory and in `renderWatchdog`, for example
  `Next eligible task is UX-047 [S]: Keep national weather warnings current`.
- Leave `compareRoadmaps()` alone. Priority is not a terminal fact and may
  change freely.
- Add tests: missing gives `C`; lowercase normalizes; an invalid value is
  blocking; an `S` task beats an earlier-listed `C` task; ties choose ascending
  ID regardless of physical tracker row order; a dependency-blocked `S`
  task is skipped; an eligible ACC `S` task beats a UX `A` task. Feed deliberately
  out-of-ID-order rows through `parseRoadmaps()` and `reconcileRoadmaps()` to
  verify the actual tie-break rather than only an already-sorted fixture.
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
- For ACC-601 to ACC-605, record that the ACC-008 refresh is still pending and
  set a provisional exact UTC calendar date at most 30 days after the actual
  review. For example, a review on 2026-10-15 may use 2026-11-14. This is a
  reminder, not a prediction of ACC-008's merge or a readiness claim.
- In ACC-008's completion PR, reassess those five tasks using its measured
  sample counts, record the actual measurement/review date, and update each
  exact `Review after:` date to at most 30 days after that assessment. Refresh
  stale dates before merge if necessary; never invent a future merge date.

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
- Include an aggregate required-cohort manifest (forecaster, domain, horizon,
  model/evaluation version) and actual UTC measurement/manifest-recorded
  timestamps for ACC-703. Identify unavailable metadata explicitly; an
  incomplete manifest does not qualify a proof window.
- Aggregates only: no forecast text, entities, places or locations.
- If neither the installed app nor the report is reachable read-only, stop and
  hand off to Bradley. Never substitute dev or fixture data.
- Done when the table, manifest and a decision-log row land, and the PR names
  the exact command that reproduces the numbers and manifest. Its completion PR must also reassess
  ACC-601 to ACC-605, record the actual measurement/review UTC date, and set
  each exact review date no more than 30 days after that assessment, never an
  unknown future merge date.
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

**5. Separate early collection from ACC-703 completion (proposed D3).** Early
collection may avoid waiting for correlation work, but only Bradley's separate
D3 authorization can start it. RC-2's document edits do not collect anything,
create schedules, call providers or authorize new access. Keep ACC-703's
existing `Dependencies:` line and the earlier-phase closure requirement. Clarify
its `Exit condition:` as follows, and add the coverage policy below to its body:

```markdown
Exit condition: All earlier required phases are terminal and a complete,
fresh production evidence window spanning at least thirty consecutive days is
available for every required cohort and the existing closure checks, using the
post-merge UTC coverage policy below. Early collection alone does not complete
ACC-703, any correlation task, or ACC-704.
```

Coverage policy for the later, explicitly authorized evidence task:

- Record the actual UTC RC-2 merge timestamp and the timestamp of the ACC-008
  aggregate cohort/version manifest. A qualifying window starts at the first
  UTC Monday 00:00 not earlier than either timestamp or the authorized
  collection start. Reports generated after merge may contain pre-merge
  observations; generation time alone never qualifies them. Earlier collection
  may be retained as context but does not backfill this proof window.
- ACC-702 emits weekly UTC reports, not daily reports. Use five consecutive
  complete weekly intervals (35 days) to establish at least 30 days of
  contiguous coverage. The latest interval must be the most recently ended
  UTC week at assessment time. Do not count an unfinished boundary week,
  duplicate interval, gap or missing report; do not create a new daily cadence.
- Validate the actual reports from the production compiler. Each must have
  `availability: complete`, fresh observations equal to total observations,
  no stale/unavailable observations, and cadence coverage meeting the existing
  ACC-702 compiler thresholds. A file's existence or `period.complete: true`
  is insufficient: the compiler also persists partial/unavailable reports and
  sets that period flag independently of observation completeness.
- Cover every required forecaster/domain/horizon cohort and model version in
  the ACC-008 manifest. Explain additions, removals and version transitions;
  restart the affected cohort's qualifying window after a version or material
  monitoring-policy change. Partial/unavailable weeks or gaps break continuity.
  Preserve the completion definition's no-overdue-resolver requirement for
  seven consecutive days and no unexplained prediction cohort loss, together
  with all other closure evidence and promotion/rejection gates.
- If the available aggregates cannot prove a cohort, freshness, resolver or
  coverage condition, leave the proof incomplete and identify the missing
  evidence. Do not infer health from missing fields, fabricate results or
  change the collector, providers or reporting schema in this docs-only PR.
  Any additional access, collection or implementation needs its own approval.

Use a provisional exact `Review after:` date no more than 30 days after the
actual RC-2 review, explicitly marked as a progress check rather than the end
of a future window. In the later authorized ACC-703 evidence-update PR, record
the actual qualifying start/end and assessment date, and refresh the review
date from that assessment if proof is still incomplete. Do not guess a merge
date or mark the task done merely because time passed. Add a dated decision-log
row only when D3 is actually decided; record whether early collection is
authorized, pending or declined. Leave ACC-704 unchanged.

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

- **Bradley first (D5):** review an exact manifest of the twelve tracked files
  under `tmp/` and the two root JSON files. Confirm a private backup outside
  every repository/worktree and sync directory, or an explicit per-file
  discard decision. Include shell scripts, both HTML prototypes, demo media
  and any wanted runtime/cache data. Do not publish their contents or copy
  them to another public path. No copying, deletion or untracking is authorized
  by this proposal. Later pulls/main sync may remove tracked copies from their
  clones, even when the editing checkout retains an untracked local copy.
- Review readers and writers before proposing each untracking operation. At
  `76b1d44`, no code consumer was found for `api-cache.json` or `tmp/`; repeat
  the bounded check on the actual implementation base. `verbose-mode.json`
  has a real reader and writer: `loadVerboseState()` reads it under `dataDir`
  (`src-tauri/sidecar/local-api-server.mjs:2965–2975`). `resolveConfig()` falls
  back through `resourceDir` to `process.cwd()` (:3040–3046), so root-based
  development can consume the root file. Packaged app-data state and a root
  development copy are distinct; do not call the latter unused.
- The runtime file needs an explicit consumer/preservation decision before
  untracking. Preserve the required local runtime contents/location or defer
  that file and report the prerequisite; do not change runtime code, settings
  or data paths in RC-3. If a migration or destructive operation is needed,
  return for the applicable design approval and a separately bounded task.
- Only after those gates, propose `git rm --cached` for the exact approved
  manifest, retaining the editing checkout's local copies. Do not use a broad
  filesystem delete, `git clean`, reset, prune, branch removal or history rewrite
  as cleanup. An unresolved consumer blocks that file's removal and RC-3's
  completion; do not silently count it as finished.
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
- In the board, keep the heading, every controller-parsed line and complete
  evidence/verification/caveat paragraphs including wrapped continuations (see
  Guardrails), and add one line: `Details: docs/archive/roadmap-history/<ID>.md`.
  Narrative moved out of the board must remain verbatim and complete in the
  archive, with an explicit link identifying the preserved evidence or limits.
  Keep partial-delivery qualifications, integration holds and unverified
  native-acceptance statements intact; a finished status does not erase them.
- Keep open tasks complete; they are the specs agents work from. Keep every
  section that isn't a finished-task block: coordination protocol, status
  values, key systems, delivery order, baselines, verification matrix, risks,
  decision log and findings.

**Proof that nothing the controller sees changed.** Run this on the exact
accepted base and on the branch. The two outputs must be identical; put the diff
command and its empty result in the PR body. This checks parsed metadata only.
Also inventory each retained or relocated evidence/verification paragraph and
caveat, including all wrapped lines; show byte-preserving comparisons and its
final board/archive location. Review the complete Markdown diff and resolve
intended links. Parser equality cannot replace this human evidence audit.

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

Advisory size targets: prediction board 30 KB (from 110 KB), usability board
45 KB (from 67 KB). State the before and after sizes and explain any shortfall.
Preserving rules, evidence and caveats takes precedence over byte reduction;
never cut content merely to meet the targets.

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
  Afterwards, searches outside `docs/archive/` must find no stale original
  path for any moved document (including its actual root or `docs/` spelling).
  Intended board, index and source pointers into the archive are required and
  must resolve; they are not forbidden references.
- Add a dated section to `docs/archive/README.md` listing the moves.
- Replace `ROADMAP.md` with Appendix A, filling in the date.
- In `CLAUDE.md`, change only the lines that name moved files. The "Current
  remaining gaps" bullet becomes a pointer to `ROADMAP.md`.

Verify: `npm run lint:md`, `npm run docs:check`, `npm run typecheck:all`
(source comments changed), `npm run roadmap:check`, and the no-stale-path and
resolved-archive-link checks.

### RC-6 — `CLAUDE.md` as rules plus pointers (High Assurance)

**Design stop.** Open a draft PR containing the proposed outline and the rule
inventory below. Wait for Bradley's approval before editing `CLAUDE.md`.

- **Advisory target:** `CLAUDE.md` 12 KB (from 38 KB). Report sizes and explain
  shortfalls; preserving every rule and caveat takes precedence.
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
- Treat the keyword search as a minimum, not a complete semantic inventory.
  Review every section for operational constraints and caveats without those
  keywords. Preserve review model/effort routing, genuine SHA-pinned reviews,
  normal hooks, human-only labels, privacy/disclosure and design/publication/
  installation gates, and fail-closed domain invariants. Neither a byte target
  nor D1 waives a rule. Leave implementation settings unchanged.
- Do not slim `AGENTS.md` in this PR.

Verify: the inventory shows zero missing rules, plus `npm run lint:md` and
`npm run docs:check`.

## Bradley's decisions

All decisions below remain pending unless Bradley explicitly selects them.
Approval to correct/review this document selects none of these defaults. D1
authorizes only the agreed program scope and RC-6 discovery/design; it never
waives the separate gates or turns D3–D5 into permission for live actions.

| ID | Decision | Proposed recommendation, pending explicit selection |
|---|---|---|
| D1 | Approve the corrected program scope and RC-6 discovery/design, retaining every later gate | Pending; document review/correction alone is not approval |
| D2 | Tier assignments in RC-2 | As listed |
| D3 | Separately authorize early ACC-702 collection, independent of correlation work, with the corrected ACC-703 coverage/closure policy | Proposed; no new collection, schedule or provider access authorized here |
| D4 | Product/backlog rescopes in Appendix A, each recorded explicitly | Proposed ideas only; no product implementation authorized |
| D5 | Approve the exact cleanup manifest, private backups/discard choices and runtime-consumer preservation before RC-3 changes | Pending for every affected file; no history rewrite |
| D6 | Status of the separate Rust/Kalman/Valhalla build described in the overhaul docs | Appendix A says only that it is not part of this repository |
| D7 | Replace "Always commit with: Co-Authored-By: Claude Sonnet 4.6" with "Commit with the Co-Authored-By trailer for the model actually running this session" | Yes |

**Dated delivery reconciliation — checked October 15, 2026, not a live queue.**
The Round 4 document's October 11 checkpoint is historical. The owner's
reconciled original 28-scope ledger records 22 delivered and six remaining
scopes: #1761, #1769, #1770, #1778, #1781 and #1783. Reconfirm against that maintained
scope ledger before future work; do not publish its private evidence or infer
scope completion from a PR's open/closed state alone.

- #1760, #1771, #1777 and #1784 merged on October 11; their old disclosure holds
  are not current blockers. #1776 merged on October 13 with the required human
  label. #1785 is closed; replacement #1799 delivered its approved CI-ratchet
  scope on October 14 and counts once as original #1785.
- Replacement #1793 counts once as original #1765, whose broad source PR still
  appears as an open draft. Supplemental #1794 is #1771 test-readiness repair,
  not another original scope. #1795 delivered a bounded workflow-security slice
  of #1781 and #1800 a bounded key-comparison slice of #1783; neither completes
  its original remaining scope or adds a delivered original scope. The original
  denominator stays 28.
  Later Settings #1801 and map cleanup #1802 are separate UI work, not extra
  completions in that original count.
- Preserve the six residual scopes, their exact provider/dependency/disclosure/
  human-approval gates, and all preserved branches, private integration
  checkouts and evidence. Historical holds are not permission to retry external
  review, request new credentials, relabel or redo delivered work. In particular,
  #1781's remaining scope is not cleared by #1795's label or partial delivery.
  No cleanup in this plan reaches those checkouts or resolves their holds.

## Definition of done

- `npm run roadmap:check`: zero blocking errors, zero overdue reviews, and the
  next eligible task is Tier S.
- `npm run test:roadmap-controller` passes, including the new priority tests.
- Before/after sizes are reported against the advisory targets (`CLAUDE.md`
  12 KB, prediction board 30 KB, usability board 45 KB), with any shortfall
  explained; preservation of rules and complete evidence is demonstrated.
- No stale original paths remain for moved documents; intended archive links
  from boards, indexes, source and tests resolve.
- `tmp/`, `api-cache.json` and `verbose-mode.json` are untracked and ignored,
  and Bradley has confirmed the per-file backup/discard and consumer decisions.
  An unresolved runtime consumer leaves RC-3 incomplete.
- RC-6's semantic and keyword rule inventories show zero missing rules, apart
  from an explicitly approved D7 attribution change.
- Every RC PR carries a recorded Claude (Sonnet, medium) cross-agent review.
- This file's `Status:` reads `COMPLETE` and it moves to
  `docs/archive/planning-2026/`.

## Copy/Paste Prompt For Codex

```text
Read docs/ROADMAP_CONSOLIDATION_FOR_CODEX.md and AGENTS.md. Do not read
docs/archive/, docs/SECURITY_SCAN_ROUND_4_FOR_CODEX.md, or the overhaul and
capstone docs.

Use this prompt only after Bradley explicitly authorizes the particular RC and
its listed decisions/gates. Reading, reviewing or correcting the proposal does
not authorize implementation, evidence collection, cleanup, product changes,
agent-rule edits, external review publication or installation. Keep the current
implementation model/effort unchanged and preserve every existing safety gate.

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
checks and the applicable explicit Bradley decision. The following constraints
remain proposals until D4 is decided; including them in this index does not
approve a product rescope or implementation.

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

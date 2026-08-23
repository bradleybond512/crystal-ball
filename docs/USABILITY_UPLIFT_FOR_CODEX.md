# Usability Uplift — Handoff for Codex

- **Date:** 2026-08-23
- **Author:** Claude (structural review of `origin/main` @ `3bf6d23e`)
- **Status:** OPEN — no task claimed yet
- **Audience:** Codex / ChatGPT sessions working this repo
- **Companion docs:** [`docs/superpowers/specs/2026-06-14-grand-strategy-survival-os-design.md`](superpowers/specs/2026-06-14-grand-strategy-survival-os-design.md) (the north star this measures against)

---

## How to use this document

1. Read the **Verified findings** section. It is evidence, not opinion — every
   claim has a command you can re-run. Do not re-derive it from scratch; if a
   command now returns something different, say so in your PR and update this doc.
2. Pick ONE `UX-NNN` task. Claim it by opening a draft PR whose title names the
   task, and set its row in the Progress Tracker to `IN PROGRESS` in the same PR.
3. Follow the normal delivery path in [`AGENTS.md`](../AGENTS.md): `codex/*` branch,
   PR, cross-agent review verdict (`codex/*` → reviewed by **Claude**), then
   `bash scripts/pr-closeout.sh`.
4. Update the tracker row to `DONE` with the PR number in the same PR that
   completes the work.

**Do not** bundle multiple `UX-NNN` tasks into one PR. They are ordered so each
one ships a visible surface on its own.

---

## The single finding that frames all of this

**The app's stated centerpiece is not on its default screen.**

The north star defines success as: *open it, and within ~10 seconds you know your
survival posture across every domain, the top threats with time-to-impact and
confidence, the single best move — and you can commit it.*

Measured against the current default surface, posture scores zero. The survival
engine is real, wired, and fed by live data. It is funnelled through one
library-tier panel and one concatenated HTML string.

**This is a surfacing problem, not an engine problem. Do not write new engines.**
The repo's own guardrail from the Surfacing & Coherence cycle — *no engine merges
without a read-surface* — is nominally satisfied and functionally violated here.

---

## Verified findings

Each row was verified against `origin/main` @ `3bf6d23e`. Re-run the command to confirm.

### F1 — Posture has zero presence on the default surface

```bash
grep -ci posture src/components/HomeShellOverlay.ts src/services/home-shell/*.ts
```

Returns `0` for all eight files. The Home Shell (default surface since Phase 2 for
the full desktop variant) renders three briefing bands — `personal`, `changed`,
`critical` (see `src/services/home-shell/briefing-view.ts`) — and none of them
carry posture, moves, or time-to-impact.

### F2 — Exactly one surface renders survival posture

```bash
grep -rln "survival-outlook\|SurvivalOutlook" src/components src/app --include="*.ts"
```

Returns only `src/components/StormPosturePanel.ts` (257 lines). Its registration:

- `src/config/panels.ts:321` → `'storm-posture': { name: 'Storm Posture', enabled: true, priority: 1 }`
- `src/config/panel-metadata.ts:403` → `tier: 'library'`, `domain: 'hazards-weather'`

So the multi-axis survival posture is discoverable only by knowing to look for a
weather panel, in the Library tier, among 502 panels.

### F3 — 17 modules collapse into one string

`StormPosturePanel.ts:126-129` calls `renderSurvivalOutlook(...)` and string-concatenates
the result: `` `${banner}${modeChips}${overall}${cards}${movesCard}${outlook}` ``.

`src/services/survival/survival-outlook.ts` aggregates:

```
comms-fallback  comms-fallback-view  decision-consequence  decision-consequence-view
grid-down-certify  grid-down-certify-view  offline-playbook  offline-playbook-view
posture-calibration  posture-trajectory  posture-trajectory-view  projection-calibration
retrospective-digest  retrospective-view  world-branches  world-branches-view
```

That is the entire user-visible output of epics **E5** (world branches,
decision-consequence), **E6** (grid-down certification, offline playbook, comms
fallback) and **E7** (retrospective digest, calibration) — rendered as a fragment
at the bottom of one panel.

### F4 — The engine itself is healthy; only 5 modules are dead

Reachability walk from real app entry points over `src/services/survival/`
(56 modules): **51 reachable, 5 unreachable.**

Entry points (imported by non-test app code): `board-events`, `scrubber-view`,
`storm-posture-state`, `survival-map-modes`, `survival-moves`, `survival-outlook`,
`survival-outlook-render`, `survival-types`, `time-scrubber`, `world-snapshot`.

Unreachable: `lens-board`, `lens-marker-apply`, `lens-marker-style`,
`scrubber-loop`, `survival-posture-view`.

Those five are cornerstone #2 of the north star ("world stage, personal lens") —
fully built, fully tested, and unreachable. The known blocker is that Cesium
entities are created anonymously, so there are no stable `eventId`s to key the
lens/scrubber against.

> **Note on method:** an earlier pass of this walk reported 46 unreachable. That
> was wrong — the edge regex missed the `.ts` extension used in relative imports
> (`from './survival-posture.ts'`). If you re-run a reachability check, match
> `from '\./([A-Za-z0-9._-]+?)(?:\.ts|\.js)?'`.

### F5 — Panel count is now a usability liability

```bash
awk 'NR>9 && /^  [a-zA-Z0-9_'"'"'-]+: *\{/ {n++} END {print n}' src/config/panels.ts
```

Returns **502**. A single `PANEL_CATEGORY_MAP` entry in `src/config/panels.ts:1239`
holds roughly 290 panel keys. Library's 12 domains and ⌘K make panels *searchable*,
but you must already know what to search for.

### F6 — `CLAUDE.md` is stale on this point

`CLAUDE.md` states 406 panels in the Home Shell / Library sections. The actual
count is 502 (F5). The Phase 2/3/4 shell notes were written against the smaller
number.

---

## Tasks

### UX-001 — Posture band on the Home Shell *(highest impact, lowest cost — do this first)*

Add survival posture to the default surface as a fourth briefing band.

- **Read from:** `storm-posture-state` — already an entry point, already fed live
  by `src/app/data-loader.ts`. No new data plumbing.
- **Build:** a pure view-model beside `src/services/home-shell/briefing-view.ts`
  projecting `SurvivalPosture` → a band view, then render it in
  `src/components/HomeShellOverlay.ts`.
- **Show:** overall band + the worst 2–3 axes, each with band, trend, and
  `ConfidenceBreakdown`-derived confidence.
- **Constraint:** the Home Shell is a **read-only** consumer of shared state
  (CommandCenterPanel is the single what-changed snapshot writer). Do not add a
  second writer.
- **Done when:** opening the app with no navigation shows current posture.

### UX-002 — "Best move now" + commit on the posture band

- **Read from:** `survival-moves` / `move-provider` / `survival-plan` — these
  already rank moves with modeled effects.
- **Reuse:** `StormPosturePanel.ts` already implements working commit UI. Extract
  it rather than reimplementing; the commit path must stay identical so
  after-action grading keeps working.
- **Show:** the single top-ranked move with its modeled effect, plus commit.
- **Done when:** the north star's "single best move to make now — and you can
  commit it" is true from the default surface.

### UX-003 — Give grid-down its own reachable surface

Cornerstone #4 is "works at zero bars." Today `grid-down-certify`,
`offline-playbook`, and `comms-fallback` render as a fragment of a string inside a
weather panel (F3). The one thing that must be findable in an emergency is
currently the least findable thing in the app.

- Split them out of `renderSurvivalOutlook` into a first-class surface reachable
  without knowing the weather panel exists.
- Must degrade correctly with the network disabled — that is the whole point of
  the feature. Verify offline, not just in tests.

### UX-004 — Make panels contextual instead of topical

Reuse what already exists rather than adding taxonomy: `src/config/panel-metadata.ts`
already carries `evidenceFor` keyed by `PlaybookCategory` (the situation dossier
consumes it).

- Add an **axis → panels** mapping so a degraded posture axis reveals its
  relevant panels on the Deck.
- Goal: panels stop being a 502-item catalog and become consequences of state.
- This is the task that actually pays down the panel count instead of managing it.

### UX-005 — Mount the personal lens and scrubber

Unblock the five dead modules from F4 by assigning stable `eventId`s at the Cesium
entity-creation sites, then mount `lens-board` / `lens-marker-apply` /
`lens-marker-style` / `scrubber-loop` / `survival-posture-view`.

Largest surface payoff of the five tasks, but it is genuinely blocked until the
`eventId` work lands — do not start here.

### UX-006 — Correct the stale panel count in `CLAUDE.md` *(housekeeping)*

Update 406 → 502 (F5/F6). `CLAUDE.md` is a known conflict magnet; keep this to the
single factual correction and do not reflow surrounding prose.

---

## What was NOT verified

State these as open questions rather than treating them as settled:

- **Cold start / first-run experience is unmeasured.** There are 77 entries in
  `SUPPORTED_SECRET_KEYS` (`src-tauri/src/main.rs:41`). Nobody measured how much of
  the app is useful at zero keys. **If first run shows mostly empty panels, that
  outranks every task above** — measure it before committing to this ordering.
- This review covered **structure and reachability, not runtime behavior.** The app
  was not launched. No claim here is based on observed rendering.
- Mobile and the non-full site variants were not examined at all.

---

## Progress Tracker

Update the row in the same PR that does the work.

| Task | Title | Status | PR |
|---|---|---|---|
| UX-001 | Posture band on Home Shell | NOT STARTED | — |
| UX-002 | Best move + commit on band | NOT STARTED | — |
| UX-003 | Grid-down own surface | NOT STARTED | — |
| UX-004 | Contextual panel reveal | NOT STARTED | — |
| UX-005 | Mount lens + scrubber | BLOCKED (needs stable Cesium `eventId`s) | — |
| UX-006 | Fix stale panel count in CLAUDE.md | NOT STARTED | — |

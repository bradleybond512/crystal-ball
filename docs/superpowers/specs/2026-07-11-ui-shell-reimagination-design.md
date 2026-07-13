# UI Shell Re-imagination — Design Spec

**Date:** 2026-07-11
**Status:** Approved design, pending implementation plan
**Scope:** Full re-imagination of the dashboard shell, navigation model, and panel presentation for the `full` variant

## Problem

Crystal Ball has **499 unique panels** organized into 19 sidebar categories. The "Intelligence"
category alone holds **305 panels** as one flat list; Data Tracking holds 75. Category-based
navigation stopped scaling long ago:

1. **Findability is broken.** A panel is reachable only if you already remember its name and
   which category it landed in.
2. **No prioritization.** A critical storm alert and an idle reference panel get equal visual
   weight; the app never says what matters *now*.
3. **The model itself is wrong at this scale.** Panels-in-a-sidebar was fine at 30 panels. At
   499, adding hierarchy inside the same model just reorganizes the junk drawer.

Confirmed user mandate: fix findability, add prioritization, and rethink the shell —
**not** primarily a panel-consolidation exercise (overlapping panels are flagged as aliases,
never force-merged).

## Decisions taken during brainstorm

| Question | Decision |
|---|---|
| Core pain | Findability + no prioritization + wrong shell model |
| Home screen answers | "Am I safe?" → "What changed?" → "What's critical globally?" (in that order) |
| Appetite | Full re-imagination: new shell + panel tiering + panel presentation redesign, phased |
| Shell concept | **A + B hybrid**: Briefing home + situation-centric drill-down; workspace curation (C) survives as the Library's internal organization |
| Map's role | **Map as canvas** — the home screen background; situations plot on it; camera flies on selection |
| Direct panel access | Preserved: scroll below the fold into **The Deck** (user-pinned panel grid); ⌘K + Library for the long tail |
| Aesthetic | Near-black, dense, professional instrument (Bloomberg-terminal discipline) |

## The model — five shell elements

Replaces the sidebar entirely (old shell remains behind a feature flag until Phase 4).

### 1. Map canvas

The DeckGL map is the home screen's background — always present, plotting live situations as
severity-colored markers. Clicking a marker or briefing row flies the camera and opens the
situation dossier. God's Eye remains the 3D upgrade of the same canvas.

### 2. Briefing overlay

Three floating bands, top-left, in priority order:

| Band | Source services |
|---|---|
| **PERSONAL** — saved-places impact, Storm Mode entry, local status line | `personal-impact.ts`, `personal-storm-mode.ts`, `insights-state.ts` |
| **WHAT CHANGED** — deltas since last session, polarity-sorted | `what-changed-digest.ts`, `change-memory.ts` |
| **CRITICAL WORLDWIDE** — ranked situations with severity dots | `big-event-detector.ts`, `confidence-urgency-matrix.ts`, `situation-clustering.ts` |

When nothing is active, bands collapse to a single "all clear" line — the map breathes.
A **status ribbon** (bottom-left: feed health, fusion verification, last sweep) keeps
diagnostics visible but demoted; clicking it opens the System area.

### 3. The Deck (below the fold)

One continuous scroll from the map viewport into a user-pinned panel grid. Each pinned panel
renders as a dense S-size live card (headline number, trend, sparkline, top drivers,
confidence + age). Pin/unpin from ⌘K or Library; drag to reorder; optional collapsible
sections. Ships with ~12 defaults (markets, NWS alerts, live news, shortage radar, air
quality, cyber threats, space weather, …). Deck state persists locally (same
`crystalball-*` localStorage / IDB conventions as existing panel state).

A scroll affordance at the bottom of the map viewport ("▼ Your Deck — N pinned panels")
makes the second surface discoverable.

### 4. Situations spine

Opening any situation composes its evidence: relevant panels rendered as M-size cards,
selected by `evidenceFor` metadata + relevance ranking. Panels stop being destinations;
they become evidence fetched by context. See "Situation view" below.

### 5. ⌘K palette + Library + dock

- **⌘K** reaches all 499 panels (name + tag synonyms), saved places, entities, and live
  situations. The escape hatch that makes the radical model safe.
- **Library** organizes the long tail into 8 domains, curated "best of" first, long tail
  behind "all N panels →".
- **Dock** (top bar): God's Eye · Analyst HUD · Library · Settings.

## Information architecture — the metadata registry

New file `src/config/panel-metadata.ts`:

```ts
interface PanelMeta {
  domain: LibraryDomain;        // one of 8
  tags: string[];               // ⌘K synonyms ("wheat", "grain", "bosphorus", …)
  evidenceFor: SituationKind[]; // situation kinds this panel illuminates
  deckCard: boolean;            // can render an S card
  tier: 'deck-default' | 'evidence' | 'library' | 'system';
  aliasOf?: string;             // duplicate flagging, consolidation optional
}
```

**Tiers** (every panel is in Library; tiers add roles):

1. **Deck defaults (~12)** — the out-of-box pinned set, fully user-editable.
2. **Evidence (~150)** — composed into situation views via `evidenceFor`. Most of the
   305-panel Intelligence pile belongs here.
3. **Library (all 499)** — 8 domains: Personal Safety · Global Intel · Markets & Economy ·
   Hazards & Weather · Cyber & Infrastructure · Space & Aviation · Health & Environment ·
   System Health.
4. **System (~40)** — diagnostics, self-tests, algo eval, feed health. These live in the
   Library's System Health domain but are excluded from Library front-page curation and
   default ⌘K ranking; the status ribbon is their primary entry point.

The registry is **script-generated first** (panel key → best-guess domain/tags derived from
`PANEL_CATEGORY_MAP` + panel titles), then **hand-curated** for the ~150 panels that matter
most. Obvious duplicates (`assumption-tracker`/`-v2`, `self-test`/`self-test-runner`) get
`aliasOf` flags only.

## Panel presentation — the three-size contract

Every panel renders at three sizes:

| Size | Where | Content |
|---|---|---|
| **S — Deck card** | The Deck | Headline number, trend delta, sparkline, top 2 drivers with weights, confidence + source count + age |
| **M — Evidence card** | Situation views | + driver table with per-driver provenance, confidence bar, data-gap callouts, "why this score →" |
| **L — Focus view** | Opened from anywhere | Full panel: history chart, complete driver breakdown, 100-point confidence breakdown, provenance list, actions (pin/export/ask) |

### Design language

- Surfaces: `#05070a` base, `#0b0f14` cards. True near-black, no blue-gray wash.
- Hairline borders at ~9% white; 9–11px micro-type; letterspaced uppercase labels.
- Monospace tabular numerals for all data.
- **Color is information only**: amber/red severity, cyan confidence, green improving.
  Chrome is grayscale.
- The intelligence layer's invariants become the visual signature: driver weights,
  confidence breakdowns, and provenance are visible at every size.

### Migration strategy (honest)

- 499 bespoke S/M cards will not happen. A **`PanelCardAdapter`** auto-derives a
  serviceable S card from each panel's existing summary/health data.
- Bespoke S/M treatments are hand-built for the 12 deck defaults + top ~20 evidence panels
  first, expanding over time.
- L view = existing panel component wrapped in new chrome on day one; restyled progressively.

## Situation view — the dossier

**Entry:** briefing row / map marker / ⌘K → camera flies to location, polygon lights up,
dossier drawer slides in from the right (~60% width). Map stays live underneath.
`⇧↵` expands to full screen.

**Anatomy:**

- **Header** — title, Confidence × Urgency verdict as one badge ("ACT SOON · HIGH CONF"),
  arrival window / status, share + export actions.
- **Why this surfaced** — big-event-detector triggers with weights, in plain language.
  No situation without its reasoning.
- **Evidence grid** — M cards chosen by `evidenceFor` + relevance ranking. Runner-up
  panels listed as "+ low relevance, tap to add" so composition failures are one-tap
  correctable, never black-box.
- **Right rail** — Action Brief (`reaction-playbooks.ts` + `action-briefs.ts`, with
  `action-memory.ts` "done last time" hooks) and Timeline (situation lifecycle from first
  observation → notification → expiry self-clear).
- **Ask bar** — `⌘/` wired to `ask-the-data.ts`'s six intents, in situation context.

One skeleton serves every domain: a storm composes Storm Mode / Saved Places / Power Grid /
Radar; a Black Sea escalation composes ORBAT / sanctions / chokepoints / shortage models.

## Data flow

All composition logic lives in pure view-models (house `*-view.ts` pattern): no DOM, no
fetch, fixture-testable. The shell reads existing singletons — `insights-state`,
`diagnostics-state`, `providers-state`, `datacenter-state` — through three new view-models:

- `briefing-view.ts` — three bands + all-clear collapse + staleness lines
- `deck-view.ts` — pinned set, ordering, S-card data extraction
- `situation-composition.ts` — evidenceFor ranking + runner-up list

Existing bridges (`data-bridge.ts`) already translate live data into the insights state;
no new ingestion paths are required for Phase 1.

## Phasing — four shippable phases

**Phase 1 — Shell foundation** (feature flag, old sidebar default)
Home surface: map canvas + 3 briefing bands + status ribbon + Deck with adapter S cards +
pin/unpin persistence. ⌘K v1 over panel names. No behavior change for existing users.

**Phase 2 — Metadata + Library** (flip default to new shell)
`panel-metadata.ts` registry (generated + curated), 8-domain Library, ⌘K v2
(tags/places/entities), System-tier separation. Old sidebar becomes the fallback flag.
**[SHIPPED — see docs/superpowers/plans/2026-07-13-phase2-library-metadata.md; ⌘K entities deferred to Phase 3 (entity dossiers own that surface).]**

**Phase 3 — Situations**
Dossier drawer, evidence composition, action brief + timeline + ask bar, map fly-to +
marker plotting. Bespoke M cards for top ~20 evidence panels.
**[SHIPPED — see docs/superpowers/plans/2026-07-13-phase3-situation-dossier.md; deferred: map-marker entry (shell map is a non-interactive backdrop), situation-scoped ask (AskContext has no situation slot), BigEvent trigger-rationale persistence, bespoke M-cards.]**

**Phase 4 — Full skin + retirement**
Near-black tokens across all L views, bespoke S cards for deck defaults, God's Eye
integration polish, mobile adaptation, reduced-motion + perf passes, old shell removed.
**[PARTIALLY SHIPPED — focus view + skin harmonization via docs/superpowers/plans/2026-07-13-phase4-focus-view.md: deck/dossier/Library open real panels in-shell (PanelFocusHost reparenting + `ensurePanelMounted`), `--hs-*` variable overrides skin hosted panels. Deferred: classic retirement (pending Phases 1-3 soak), mobile adaptation, bespoke S-cards (no per-panel data getters; narrative path is LLM-dependent).]**

## Degradation & error handling

- Every band/card renders staleness honestly: "digest unavailable · last good 14:20" —
  never a silent blank. (Existing invariant: stale reduces confidence, never disappears.)
- Cold start / empty clustering: Critical band falls back to top unified alerts. The Deck
  never depends on intelligence-layer health.
- Feature flag = instant rollback to old shell through Phase 3.
- Deck cards update on data events, not timers; hidden-tab ×10 refresh rules and the render
  gating from the July 2026 perf cycle apply unchanged. The redesign must not reintroduce
  idle CPU burn.

## Testing

- Pure view-model fixture tests for `briefing-view`, `deck-view`, `situation-composition`
  (no DOM), matching the 600+-test house pattern.
- Replay harness: the five missed-event fixtures must surface through the new briefing —
  e.g. silent-tornado-polygon must light the PERSONAL band and produce a notification trace.
- `npm run typecheck:all` at zero errors and the renderer sweep green, per phase.

## Non-goals

- No panel deletions or forced merges — `aliasOf` flags only.
- `tech` / `finance` / `happy` variants keep the old shell until after Phase 4.
- No changes to the notification ladder, sidecar, or data ingestion.
- Mobile gets an adapted (stacked) home in Phase 4, not before.

## Brainstorm artifacts

Interactive mockups from the design session (gitignored, local):
`.superpowers/brainstorm/88742-1783826395/content/` — shell concepts, home v1/v2,
panel presentation, situation view.

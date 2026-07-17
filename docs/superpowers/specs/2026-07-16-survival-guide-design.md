# Survival Guide — Design Spec

**Date:** 2026-07-16
**Status:** Approved design, pending implementation plan
**Owner surface:** `src/services/survival-guide/` + `src/components/SurvivalGuidePanel.ts`

## Problem

Crystal Ball's guidance today is entirely *reactive*: reaction playbooks
(`src/services/insights/reaction-playbooks.ts`), per-hazard weather actions
(`src/services/weather/preparedness-actions.ts`), and Action Briefs fire when a
situation is already active, and each hands the user roughly five one-line
imperatives. There is no browsable *reference* material — nothing that answers
"how do I actually handle a tornado / flood / conflict escalation," nothing on
shelter selection, go-bag contents, water storage, or what to do *after* an
event. A survival guide matters most when it can be read calmly ahead of time
and pulled up instantly (and offline) when things go wrong.

## Goals

1. A browsable, always-available survival guide library covering hazards
   (weather, disaster, infrastructure, conflict) and preparedness basics.
2. Structured, scannable-under-stress format — the same phase skeleton for
   every guide.
3. Interactive supply/prep checklists with persisted state and a per-guide +
   overall readiness score, surfaced on the Command Center.
4. Deep links so live surfaces (Action Brief, Situation Dossier, Storm Mode)
   hand the user the *right* guide in one tap.
5. Fully offline: static typed content, zero fetch, fixture-tested like the
   other foundation service layers.

## Non-Goals

- No LLM-generated or fetched content. Guides are hand-authored static data.
- No per-user personalization of guide *content* (region-aware ordering can
  come later; v1 shows the full library to everyone).
- No integration with the E1 storm-posture engine or E6 offline-playbook
  certification (`src/services/survival/`) in v1. The guide is complementary
  reference content; E6 can consume it later.
- No markdown/HTML content pipeline — content is typed TS data (avoids a new
  HTML sink; see the security hardening docs).

## Relationship to existing layers

| Existing | Role | Survival guide relationship |
|---|---|---|
| `reaction-playbooks.ts` (11 `PlaybookCategory`) | Reactive: what to do about a live event | Each category maps to one or more guides via `guide-links.ts` |
| `preparedness-actions.ts` (17 `WeatherHazardKind`) | Reactive: per-hazard imperatives for alerts | Each hazard maps to a guide via `guide-links.ts` |
| Action Briefs / Situation Dossier / Storm Mode | Live-event surfaces | Gain a "Full guide →" deep link |
| Grand-Strategy Survival OS E6 (offline playbooks) | Future program epic | Guide library is a ready-made content source; no v1 coupling |

The reactive/reference distinction is deliberate and stays clean: playbooks
answer "what now, about this event"; guides answer "how does one handle this
kind of event, start to finish."

## Content model

### Guide inventory (v1: 24 guides)

**Hazard guides (17)** — `kind: 'hazard'`:
tornado, flood, hurricane, severe_thunderstorm, winter_storm, extreme_heat,
wildfire, wildfire_smoke, earthquake, power_grid_outage, fuel_shortage,
food_shortage, disease_outbreak, cyber_banking_outage, civil_unrest,
armed_conflict, nuclear_radiological.

**Preparedness basics (7)** — `kind: 'preparedness'`:
go_bag, water_storage, food_storage, family_comms_plan, first_aid_basics,
evacuation_planning, shelter_in_place.

### Schema

```ts
export type GuideId = /* 24-member union above */;

export interface ChecklistItem {
  /** Globally unique, stable forever — persistence keys on this, never index. */
  id: string;           // e.g. 'go_bag.water_3day'
  label: string;
  detail?: string;
  weight: 1 | 2 | 3;    // importance; readiness scoring honors it
}

export interface GuideStep {
  label: string;        // imperative, execution order
  detail?: string;      // the "why" / how-to depth the playbooks lack
}

export interface SurvivalGuide {
  id: GuideId;
  kind: 'hazard' | 'preparedness';
  title: string;
  summary: string;          // one paragraph: what this is, why it kills people
  signs: string[];          // early indicators / how you'll know
  prepare: GuideStep[];     // days-to-hours ahead
  during: GuideStep[];      // act-now, ordered most-urgent-first
  after: GuideStep[];       // first minutes-to-hours after
  recovery: string[];       // days-to-weeks
  mistakes: string[];       // deadly mistakes to avoid (rendered loud)
  checklist: ChecklistItem[]; // supplies/prep; may be empty for pure-response hazards
  relatedGuides: GuideId[];
  sources: string[];        // provenance: e.g. 'Ready.gov — Tornadoes', 'NWS', 'FEMA P-320', 'CDC'
}
```

Content is distilled from public-domain US government guidance (Ready.gov,
FEMA, NWS, CDC). Every guide's `sources` is non-empty — the project's
"every claim carries provenance" invariant. Every guide detail view renders a
disclaimer footer: *reference guidance distilled from public materials; always
follow instructions from local emergency officials.*

## Files

```
src/services/survival-guide/
  guide-types.ts        # GuideId, SurvivalGuide, ChecklistItem, GuideStep, readiness types
  guide-library.ts      # aggregates + validates the per-guide content files; getGuide/allGuides
  guides/               # one file per guide (shortage-model precedent), pure data
    tornado-guide.ts
    ...                 # 24 files
  guide-links.ts        # PlaybookCategory → GuideId[]; WeatherHazardKind → GuideId
  checklist-store.ts    # persisted checked-item ids + subscribe(); singleton
  readiness-score.ts    # pure: (guide, checkedIds) → GuideReadiness; overall rollup
  __tests__/            # fixture-only unit tests
src/components/SurvivalGuidePanel.ts
src/services/command-palette/guide-commands.ts   # ⌘K 'Guide: <title>' entries
```

### checklist-store

- One localStorage key `cb-survival-checklist` holding
  `{ v: 1, checked: string[] }` — a few hundred bytes at full tick.
- Written via the quota-safe storage layer (`src/utils/safe-storage.ts`). The
  key is **not** added to `EVICTABLE` (that allowlist is for re-fetchable
  caches only; everything off-list is precious by default), so quota-pressure
  eviction can never wipe the user's prep state.
- Unknown/stale item ids (from content edits) are ignored at read time and
  pruned at the next write.
- If storage is unavailable or quota-latched, the store degrades to in-memory:
  guides stay fully readable, ticks last for the session, no throw.
- `subscribe(listener)` notifies on any change; the Command Center readiness
  row and the panel both subscribe.

### readiness-score

Pure functions, no state:

- `computeGuideReadiness(guide, checkedIds)` →
  `{ guideId, percent, checkedWeight, totalWeight, checkedCount, totalCount }`.
  Weighted ratio: `sum(weight of checked) / sum(weight of all)`, rounded to
  whole percent. Guides with an empty checklist return `null` (excluded from
  rollups, panel shows no ring).
- `computeOverallReadiness(guides, checkedIds)` →
  `{ percent, weakest: GuideId | null }`. Mean of per-guide percents across
  guides that have checklists; `weakest` is the lowest-percent guide
  (ties: first in library order).

The weighting decision (whether 1/2/3 weights meaningfully spread, and what
the default authoring guidance is) is finalized during implementation — the
function contract above is fixed.

## UI surfaces

### SurvivalGuidePanel (`panel id: survival-guide`)

Two views inside one panel:

- **Index:** cards grouped *Hazards* / *Preparedness Basics*; each card shows
  title, one-line summary, and a readiness ring (guides with checklists only).
  Click → detail view.
- **Detail:** back link; phase sections in reading order (Signs → Prepare →
  During → After → Recovery); interactive checklist with persistent
  checkboxes and a per-guide readiness header; a visually loud "Deadly
  mistakes" callout; related-guide chips (navigate in place); sources +
  disclaimer footer.

Registration (all four required for visibility — see the panel wiring audit):
`FULL_PANELS` + `PANEL_CATEGORY_MAP` in `src/config/panels.ts`, instantiation
in `src/app/panel-layout.ts`, Library metadata in
`src/config/panel-metadata.ts` under domain **`personal-safety`** (hand-edit;
do not re-run the metadata generator).

### Deep links: `cb:open-survival-guide`

A window CustomEvent with `{ guideId: GuideId }`, following the
`cb:open-dossier` pattern:

- **Home Shell:** handler calls `ensurePanelMounted('survival-guide')` and
  opens the panel in the focus host, navigated to the guide detail.
- **Classic:** falls back to classic panel navigation (existing
  `ensurePanelMounted` null-fallback + toast convention applies).
- Unknown/unmapped `guideId` → open the index view + toast, never throw.

Three emitters:

1. **Action Brief** rendering in the Command Center and the Situation
   Dossier: a "Full guide →" link resolved via
   `guidesForPlaybookCategory(category)` (first guide; chips if multiple).
2. **Storm Mode strip** (`src/components/PersonalStormMode.ts`): link resolved
   via `guideForWeatherHazard(hazard)`.
3. **⌘K:** `guide-commands.ts` registers `Guide: Tornado`-style commands for
   all 24 guides (pattern: `place-commands.ts`).

### Command Center readiness row

One compact row in the Command Center: overall readiness percent + weakest
guide ("Preparedness 64% · weakest: Go-bag"). Subscribes to
`checklist-store`; click emits `cb:open-survival-guide` for the weakest guide
(or the index when no checklist has been started). No new registry.

## Data flow

Static guide library → panel renders (no fetch, no async).
Checkbox toggle → `checklist-store` persists + notifies → panel readiness
header and Command Center row recompute via `readiness-score`. Deep-link
event → panel mounts/fronts → detail view for the target guide.

## Error handling

| Failure | Behavior |
|---|---|
| localStorage unavailable / quota-latched | In-memory checklist for the session; guides fully readable; no throw |
| Stale checklist ids after content edits | Ignored at read, pruned at next write |
| Deep link with unknown guideId | Index view + toast |
| `ensurePanelMounted` returns null (panel disabled/failed) | Existing classic-navigation fallback + toast convention |
| Playbook category with no mapped guide | Link simply not rendered (mapping totality is also unit-tested, so this is a test failure first) |

## Testing

New fixture-only suite, `npm run test:survival-guide` (pattern:
`test:shortage`):

1. **Schema completeness:** every guide has non-empty `summary`, `signs`,
   `prepare`, `during`, `after`, `mistakes`, `sources`; `checklist` item ids
   globally unique across all guides; `relatedGuides` reference valid ids and
   never self-reference.
2. **Mapping totality:** every `PlaybookCategory` maps to ≥1 valid `GuideId`;
   every `WeatherHazardKind` maps to a valid `GuideId`.
3. **Readiness math:** empty checklist → null; 0 checked → 0%; all → 100%;
   weights respected; unknown checked ids ignored; overall rollup + weakest
   selection incl. tie-break.
4. **checklist-store:** round-trip with mocked storage; stale-id pruning;
   quota-latched fallback to memory; subscriber notification.

No DOM tests in v1 (repo convention: panels are exercised by the e2e layer,
service layers by fixtures).

## Rollout

Single feature branch, ordered commits: service layer + tests → panel +
registration → deep links + ⌘K → Command Center row. Ships behind no flag —
the panel is additive and the Command Center row renders only when the
registry mounts it.

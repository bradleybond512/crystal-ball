# Crystal Ball — Grand-Strategy Survival OS (Design / Gameplan)

- **Date:** 2026-06-14
- **Status:** Approved shape; first vertical slice ready to spec into an implementation plan.
- **Author:** Claude (brainstorming session with Bradley)

This document is both the **north-star gameplan** (Parts I–II) and a **focused
spec for the first vertical slice** (Part III). Only Part III becomes the first
implementation plan; Parts I–II frame the program the slice belongs to.

---

## Part I — North Star

### One sentence

> A living save-file of the world that you sit above like a grand-strategy game —
> every domain an overlay, every event scored by what it does to *you and yours*,
> and a **survival posture you actively defend** through moves whose consequences
> the engine models and then grades.

### The core realization

Crystal Ball is not short on ingredients. It already has ~80 service domains,
hundreds of live feeds, an always-on analyst reasoning layer, deterministic
intelligence / weather / shortage / datacenter scoring stacks, a Command Center,
`scenario-simulator` + `cascade-simulator` + escalation engines, a
`survival-advisor`, `country-consequence-engine`, and the God's Vision 3D globe.
The vision is even already written down in
[`crystal-ball-world-state-simulation-and-survivability.md`](../../crystal-ball-world-state-simulation-and-survivability.md)
and [`ELITE_CRYSTAL_BALL_GAMEPLAN.md`](../../ELITE_CRYSTAL_BALL_GAMEPLAN.md).

**~80% of this leap is connective tissue over assets that already exist.** Four
genuinely new things bind those assets into one loop:

1. a local-first **snapshot spine** (the "save file"),
2. a **unified survival-posture model** (your "nation's stats"),
3. the globe **promoted from optional mode to the primary surface**, and
4. a **move → modeled-effect → graded-outcome** mechanic (the game loop).

### The four locked cornerstones (from brainstorming)

1. **Fuse all three** — grand-strategy interface + world-state brain + survival
   spine become one instrument, not three features.
2. **World stage, personal lens** — the globe/map is the board; everything is
   scored and colored by personal survival relevance; the camera snaps between
   "whole board" and "my position."
3. **Full strategic loop + survival posture** — a persistent multi-axis posture
   the world threatens and your decisions improve; consequences feed back.
4. **Grid-down hard requirement** — a local-first survival kernel from day one;
   the app remains a survival tool at zero bars, on battery.

### The five-layer architecture

| Layer | What it is | Built from (exists) | Genuinely new |
|---|---|---|---|
| **0 · Survival Kernel** | Local-first "save file." A versioned, append-only **World Snapshot** persisted on-device; every UI view is a pure projection of it. Grid-down = last snapshot + age/confidence + your offline plan, maps, routes, playbooks, comms plan. | `offline-*-cache`, `comms-plan`, `evacuation-router`, `offline-map-cache`, pure deterministic services | Snapshot format + projection model + the "survival works at zero bars" guarantee |
| **1 · World-State Brain** | Reduces domains into a few **world-pressure axes**, projects escalation/cascade, and runs **what-if simulation** (world branches *and* your moves). | `mode-forecast`, `pressure-baselines`, `escalation-forecast`, `cascade-simulator`, `country-consequence-engine`, intelligence stack | Unified pressure model + decision-consequence sim |
| **2 · World Stage** | God's Vision globe as **primary surface**. Domains become toggleable **map modes**. **Personal lens** tints by survival relevance; your places/family/assets/routes are your "realm." **Time control**: replay ⟵ now ⟶ projected futures. | God's Vision (Cesium), `timeline-scrubber`, every existing panel (→ overlay) | Board paradigm + personal-lens scoring + unified time axis |
| **3 · Survival Spine** | Persistent **multi-axis posture** (physical safety, supply, financial, mobility, comms, health, energy/water, security). World events project **threats** onto axes; a library of **moves** each model an **effect**. Commit a plan; posture evolves. | `survival-advisor`, `action-cards`, `watchlist-playbooks`, `storm-preparedness`, `after-action-review` | Posture state + move→effect modeling + commit/track |
| **4 · Closed Loop** | Every threat projection and every move's predicted-vs-actual effect becomes calibration/training evidence. "Here's what I got wrong last time." | self-improvement loop, calibration, replay fixtures, outcome grading (live) | Wiring posture/moves into the existing loop |

### The game loop

```
world shifts → projects threats onto your posture → you plan & commit moves
   → posture responds → outcome observed → engine grades itself → you sharpen
```

This *is* "grand strategy." It is also exactly the
`sense → understand → forecast → personalize → warn → explain → act → observe → learn`
loop the existing gameplan already named — but for the first time with a **board
to see it on** and a **posture to defend.**

### What "the most intelligent survival app in the world" means (success definition)

> Open it, and within ~10 seconds you know: the state of your world, your
> survival posture across every domain, the top threats bearing on *you* with
> time-to-impact and confidence, the single best move to make now — and you can
> commit it. And it all still works with the internet off.

---

## Part II — Decomposition (program epics)

The program is too large for one implementation plan. It decomposes into seven
epics. **Each epic after E1 reuses the template E1 establishes.**

| Epic | Scope | Sequencing rationale |
|---|---|---|
| **E1 · Storm Posture vertical slice** *(first; specced in Part III)* | Weather → physical-safety, the **full five-layer loop end-to-end** for one domain. | Prove the whole loop *narrow* before *wide*. De-risks snapshot format, posture model, move model, threat-projection, board overlay, grid-down, and after-action wiring simultaneously on the most mature, most viscerally-survival data. |
| **E2 · Posture engine generalization** | Promote the slice's single axis to the full multi-axis posture; extract the move→effect framework into a reusable contract. | Turn the bespoke slice pieces into the general engine *after* they are validated, not before. |
| **E3 · Domain fan-out** | Add domains as repeats of the template: supply/shortage, financial, comms/energy/water, health. | Each is a vertical slice using the proven E1/E2 template — additive, low-novelty, parallelizable. |
| **E4 · The World Stage proper** | Promote God's Vision to primary surface; build the map-mode overlay system (every panel → overlay), the personal lens as a global scoring filter, the unified time control. | A board is only worth sitting above once enough domains feed it (post-E3). |
| **E5 · World-State Brain deepening** | Unified world-pressure model across all domains; escalation/cascade projection; full what-if/decision-consequence simulation (world branches + your moves together). | Depth pays off once breadth (E3) and the surface (E4) exist to express it. |
| **E6 · Survival Kernel hardening** | Full grid-down across *all* domains: offline reasoning, snapshot export/import, offline playbooks everywhere, comms/radio fallback, "zero bars" certification + replay tests. | E1 proves grid-down for one domain; E6 generalizes the guarantee. |
| **E7 · Closed-loop integration** | Posture/move outcomes feed the existing self-improvement loop comprehensively; calibrate threat projections + move effects; surface "what I got wrong last time" on the board. | Closes the learning loop once there is enough loop history to learn from. |

---

## Part III — First Vertical Slice Spec: "Storm Posture" (E1)

### Goal

Prove the entire grand-strategy survival loop on one domain: a real severe-weather
alert near a saved place becomes a **physical-safety posture threat**, renders on
the board, offers **moves with modeled posture effects**, lets the user **commit**
one, **works with the network disabled**, and is **graded after the fact**.

### Design principles (inherited, non-negotiable)

Honor the existing Foundation-layer invariants (see `CLAUDE.md`):

- Services are **pure** (no DOM, no fetch, no globals) — input→output, fixture-tested.
- Every score carries a **`ConfidenceBreakdown`**; every claim carries **provenance**.
- **Stale data reduces confidence**, never silently disappears.
- **Contradictions surface**, not averaged away.
- Every output is testable with **static fixtures**.

### New units (build these)

All under a new `src/services/survival/` directory. Each unit states *what it
does, how you use it, what it depends on.*

1. **`world-snapshot.ts`** (pure)
   - *Does:* defines the on-device save-file and pure build/serialize/project fns.
   - *Interface:*

     ```ts
     interface WorldSnapshot {
       version: number;            // schema version for migration
       capturedAt: string;         // ISO
       freshness: Record<Domain, { fetchedAt: string; ageMs: number; ok: boolean }>;
       weatherAlerts: NwsAlertMinimal[];   // reuse weather-threat-types
       savedPlaces: SavedPlace[];          // reuse
       posture: SurvivalPosture;
       plan: SurvivalPlan;
     }
     buildSnapshot(inputs): WorldSnapshot;
     serializeSnapshot(s): string;          // for export/import + IDB
     deserializeSnapshot(json): WorldSnapshot;
     projectView(s): StormPostureViewModel;  // pure projection the UI renders
     ```

   - *Depends on:* the type modules only. **No IDB/DOM here.**

2. **`snapshot-store.ts`** (adapter — IDB/DOM allowed)
   - *Does:* persists/loads the latest snapshot to `crystalball_db`; the only
     impure unit in the slice.
   - *Interface:* `saveSnapshot(s): Promise<void>`, `loadLatestSnapshot(): Promise<WorldSnapshot | null>`.

3. **`survival-posture.ts`** (pure)
   - *Does:* defines the posture model and computes it from a snapshot.
   - *Interface:*

     ```ts
     type Axis = 'physical_safety' | 'supply' | 'financial' | 'mobility'
               | 'comms' | 'health' | 'energy_water' | 'security';
     interface AxisState {
       axis: Axis;
       level: number;            // 0–100
       band: 'secure'|'guarded'|'elevated'|'high'|'critical';
       trend: 'improving'|'steady'|'worsening';
       threats: PostureThreat[];
       evidence: EvidenceRef[];  // provenance
       confidence: ConfidenceBreakdown;
     }
     interface SurvivalPosture { axes: AxisState[]; overall: AxisState; capturedAt: string }
     computePosture(s: WorldSnapshot): SurvivalPosture;
     ```

   - *E1 scope:* `physical_safety` computed fully from weather threats; the other
     seven axes present-but-flat (so the multi-axis UI is real but only one axis
     moves). This makes E2 generalization a fill-in, not a rebuild.

4. **`threat-projection.ts`** (pure)
   - *Does:* turns a matched weather alert into posture threats.
   - *Interface:*

     ```ts
     interface PostureThreat {
       sourceEventId: string;
       axis: Axis;
       severity: number;          // 0–100
       timeToImpact: { window: string; arrivalAt?: string };
       confidence: ConfidenceBreakdown;
       why: string;               // plain-language rationale
       provenance: EvidenceRef[];
     }
     projectWeatherThreats(matched: PolygonMatchResult[], places: SavedPlace[]): PostureThreat[];
     ```

   - *Depends on:* `nws-polygon-match`, `weather-urgency`, `personal-storm-mode`.

5. **`survival-moves.ts`** (pure)
   - *Does:* the move library + effect modeling.
   - *Interface:*

     ```ts
     interface SurvivalMove {
       id: string;
       label: string;
       affects: Axis[];
       prereqs: string[];
       leadTimeMinutes: number;
       cost: 'free'|'low'|'medium'|'high';
       playbookRef?: string;      // links to storm-preparedness / action-cards
     }
     interface PostureDelta { axis: Axis; deltaLevel: number; rationale: string }
     availableMoves(p: SurvivalPosture, s: WorldSnapshot): SurvivalMove[];
     projectMoveEffect(m: SurvivalMove, p: SurvivalPosture): PostureDelta[];
     ```

   - *E1 scope:* storm-relevant moves only (shelter-in-place, evacuate via route,
     secure property, charge devices / fill water / fuel up, pre-position go-bag),
     seeded from `storm-preparedness` + `action-cards`.

6. **`survival-plan.ts`** (pure)
   - *Does:* commit/track moves; the plan lives inside the snapshot.
   - *Interface:* `commitMove(plan, move): SurvivalPlan`,
     `moveStatus(plan, moveId): 'planned'|'in_progress'|'done'|'skipped'`.

7. **`StormPosturePanel.ts`** (`src/components/`, UI)
   - *Does:* the first concrete grand-strategy survival surface — shows the
     physical-safety posture (level + band + trend), the incoming storm threat
     (what / why / when / confidence), recommended moves with their modeled
     posture effect, a **Commit** action, and a **grid-down / data-age banner.**

### Reused units (do not rebuild)

`nws-polygon-match`, `weather-urgency`, `personal-storm-mode`,
`preparedness-actions`/`storm-preparedness`, `evacuation-router`,
`saved-places`, `offline-map-cache`, `after-action-review`, the intelligence
`ConfidenceBreakdown` / `EvidenceRef` types, replay-fixtures + replay-harness.

### Board overlay (kept modest for E1)

A weather **map-mode** on the God's Vision globe: render the alert polygon, the
user's saved place(s), the evacuation route, and an **arrival-window timeline**
(now → projected impact). Full map-mode system + global personal lens is E4 — E1
only needs *this domain* visible and personally highlighted on the board.

### Grid-down guarantee (the survival proof)

With the network disabled, the slice must still render — entirely from the last
`WorldSnapshot` — the last alert polygon, your place, your evacuation route
(`offline-map-cache`), your storm playbook, and your posture, each **clearly
marked with data age**. This is the slice's most important acceptance test.

### Closed-loop wiring

Add one replay fixture (`storm-posture-loop`): severe wind / tornado polygon near
a saved place → posture threat → committed move → outcome. Run it through
`replay-harness` and `after-action-review` to grade warning lead time and whether
the committed move improved posture. This seeds E7.

### Acceptance criteria (definition of done for E1)

- [ ] A real NWS alert near a saved place yields a `physical_safety` posture
      threat with time-to-impact + `ConfidenceBreakdown`, shown on the board and
      in `StormPosturePanel`.
- [ ] ≥3 storm moves are offered, each with a modeled `PostureDelta`; committing
      one updates posture *and* the plan in the snapshot.
- [ ] **Network disabled:** the slice renders last alert + place + route +
      playbook + posture from the snapshot, with visible data age.
- [ ] The `storm-posture-loop` replay fixture passes and after-action grading runs.
- [ ] All new services are pure, deterministic, provenance-aware, fixture-tested.
- [ ] `npm run typecheck:all` passes with zero errors.

### Out of scope for E1 (deferred to later epics)

- The other seven posture axes computing for real (E2/E3).
- The full map-mode overlay system + global personal lens (E4).
- Cross-domain what-if / decision-consequence simulation (E5).
- Grid-down for non-weather domains (E6).
- Comprehensive closed-loop calibration UI (E7).

---

## Part IV — Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Posture score feels gimmicky / arbitrary** | Every axis level carries a `ConfidenceBreakdown` + evidence refs; the band, trend, and the move's projected delta are all explainable in plain language. The number is never shown without its "why." |
| **Beautiful shell over shaky foundation** (the cockpit-first trap) | Vertical-slice approach builds Layer 0 (kernel) *inside* E1, not after. Grid-down is an E1 acceptance test, not a later retrofit. |
| **Scope sprawl** (80 domains tempting to wire at once) | E1 is one domain. E3 fan-out is gated on E1+E2 proving the template. Each epic is independently shippable. |
| **Shared canonical-dir git hazard** (~10 parallel sessions) | All work in `.worktrees/grand-strategy-survival-os` on `claude/grand-strategy-survival-os`; never develop on the canonical dir's branch. |
| **Move-effect modeling overclaims certainty** | `projectMoveEffect` returns deltas with rationale + confidence, and after-action grading compares predicted vs actual so overconfident effects get corrected over time. |

## Part V — Open questions

None blocking E1. Two to revisit before E4:

1. Does the World Stage stay desktop-only (command desk), or is a field/mobile
   companion in scope? (Survival execution often happens away from the desk.)
2. Is "family" modeled as tracked entities within your realm, or as
   coordinated multi-user accounts?

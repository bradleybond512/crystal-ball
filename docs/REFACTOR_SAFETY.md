# Refactor Safety Methodology

**Purpose**: A reusable, repeatable process for performing risky refactors
(large-file splits, God-class decomposition, infrastructure swaps) without
silently breaking live functionality.

**When to use**: Any change that moves, renames, splits, or replaces
production code paths where the behavioral surface is broad and the
blast-radius of a regression is high. Examples:

- TODO-001: Decomposing `App.ts` (4 357 lines) into controllers
- TODO-013: Splitting `MapPopup.ts` (113 KB) and `DeckGLMap.ts` (156 KB) into
  per-layer modules
- TODO-002: Moving client-side RSS fetching to a server-side aggregator

**When NOT required**: additive work (new services, new panels, new data
sources), bug fixes, and isolated module rewrites whose public API is
stable.

---

## Core Principles

1. **Parallel, not in-place.** Build the new implementation alongside the old.
   Never delete the old until the new has run in production behind a flag for
   a meaningful window.
2. **Characterize before you change.** Capture the current behavior (inputs
   → outputs, DOM snapshots, event sequences, timing) as tests BEFORE you
   touch the code. This is the contract your refactor must preserve.
3. **Migrate one responsibility at a time.** Extracting one method,
   controller, or popup type per commit keeps diffs reviewable and blast
   radius bounded.
4. **Gate with feature flags.** Use `runtime-config.ts` or a dedicated
   refactor flag key (e.g. `refactor:app-controllers`, `refactor:map-popups`).
   The old path stays reachable via `?flag=refactor-off` or equivalent until
   the migration is complete.
5. **Verify at every gate.** `npm run typecheck:all`, `npm run lint`, full
   e2e (`npm run test:e2e:runtime`), and manual smoke tests before each
   commit. No "fix-forward after push."
6. **Reversibility is a feature.** Keep commits small and atomic so `git
   revert <sha>` can unwind a single problem step without losing unrelated
   progress.
7. **Observation before deletion.** After the new path is default, leave
   the old code in-tree for at least one release cycle before deleting.

---

## The Eight-Step Playbook

Apply this sequence to every qualifying refactor.

### Step 1 — Inventory and Contract Capture

Before writing a line of new code:

1. **Catalog the surface.** List every public export, every event listener,
   every DOM selector the target module touches, every `document.dispatchEvent`
   and `addEventListener` call, every storage key, and every timer.
2. **Document the contract.** Record input types, output types, side
   effects, and timing guarantees for each entry point. Put this in a
   short `refactor-notes/<date>-<target>.md` file in the branch.
3. **Identify hidden couplings.** Grep the codebase for every call site.
   Note any reliance on mutation semantics, reference identity, or
   initialization order.

**Gate:** A reviewer can see exactly what will be preserved.

### Step 2 — Characterization Tests

Capture current behavior as executable truth.

1. **Snapshot-level tests.** For UI code (e.g. `MapPopup`), use Playwright
   snapshots: render each layer type with a deterministic data fixture,
   capture the resulting HTML/CSS, pin as a golden file.
2. **Functional-level tests.** For logic code (e.g. `App` methods), write
   unit tests that seed state, call the method, assert observable state,
   fired events, and persisted data.
3. **Behavioral-level tests.** For integration paths, write a Playwright
   scenario that walks a user journey (open app → click thing → assert
   outcome). Pin the current behavior, even if imperfect.

**Gate:** Tests pass against the *current* (unrefactored) code. These
become the oracle the refactor is judged against.

### Step 3 — Feature Flag Introduction

Wire a runtime flag that decides which implementation is active.

```typescript
// src/services/runtime-config.ts
export type RefactorFlag =
  | 'refactor:app-controllers'
  | 'refactor:map-popups'
  | 'refactor:rss-aggregate';

export function isRefactorEnabled(flag: RefactorFlag): boolean {
  // Read from localStorage or URL param `?refactor=app-controllers`.
  // Default OFF in production builds until migration is complete.
}
```

The entry point that the refactor targets becomes a dispatcher:

```typescript
// BEFORE
export function handleFooClick(ctx) { /* big body */ }

// AFTER
export function handleFooClick(ctx) {
  if (isRefactorEnabled('refactor:app-controllers')) {
    return controllers.foo.handleClick(ctx); // new path
  }
  return legacyHandleFooClick(ctx);           // old path, untouched
}
```

**Gate:** Flag defaults to OFF. All tests still pass. Old path is
byte-identical to pre-refactor.

### Step 4 — Incremental Extraction

Extract ONE responsibility per commit. For `App.ts`:

- Commit A: create `controllers/RefreshScheduler.ts`, copy 3 methods,
  wire behind flag, add unit tests, push.
- Commit B: create `controllers/DataLoader.ts`, copy next 8 methods, etc.

Each commit:

1. Adds new code.
2. Leaves the old code in place.
3. Gates the new code behind the flag.
4. Passes characterization tests with flag ON *and* flag OFF.
5. Includes a 1-2 line "migration note" in the commit body saying which
   contract entries are now served by the new module.

**Gate:** Incremental commits merge into the refactor branch. No
single commit is larger than ~300 lines of net change.

### Step 5 — Dual-Run Verification

Before making the new path the default, run it alongside the old in dev
for at least one day:

1. Force the flag ON locally.
2. Use the app through normal workflows.
3. Watch the dev console for differences (add diagnostic logging that
   compares new-path output to old-path output where feasible).
4. Fix any deltas.

For pure-function extractions, add a self-verification helper:

```typescript
function dualRun<T>(old: () => T, next: () => T, label: string): T {
  const a = old();
  if (!isRefactorEnabled(...)) return a;
  const b = next();
  if (!deepEqual(a, b)) console.warn(`[dual-run] ${label} drift`, { a, b });
  return b;
}
```

**Gate:** Dev session with flag ON produces no console warnings for 24
hours of normal use.

### Step 6 — Flip the Default

Only when all characterization tests pass, dual-run shows no drift, and
the change has been reviewed:

1. Change the flag default from OFF to ON.
2. Keep the old path reachable via `?refactor=legacy-<name>`.
3. Commit with title `refactor(<target>): flip default to new implementation`.
4. Do NOT delete old code in this commit.

**Gate:** All e2e tests pass. No change to CHANGELOG beyond a bump note.

### Step 7 — Observation Window

Leave the old path in-tree for at least one release cycle after the flip.
During this time:

- Monitor error reports and user feedback.
- Keep the escape hatch (`?refactor=legacy-<name>`) documented in the
  CHANGELOG.
- Resist the urge to delete the old code immediately.

**Gate:** One full release cycle completes with no rollbacks and no bug
reports traceable to the refactor.

### Step 8 — Cleanup

After the observation window:

1. Remove the old code path and its feature flag.
2. Remove the dual-run helpers.
3. Rename the new modules to their final names if they were prefixed.
4. Update CHANGELOG with "[target] legacy implementation removed."

**Gate:** Post-cleanup, the full test suite (unit + e2e) still passes.
PR description links back to the observation-window release notes.

---

## Tooling

The repo already has most of what's needed:

| Tool | Where | Use for |
|------|-------|---------|
| `isFeatureAvailable` | `src/services/runtime-config.ts` | Production feature flags |
| Playwright snapshots | `e2e/*.spec.ts-snapshots/` | Step 2 characterization |
| `npm run typecheck:all` | `package.json` | Gate at every commit |
| `.husky/pre-commit` | `.husky/` | Automatic lint/type gates |
| Circuit breakers | `src/utils/` (see `createCircuitBreaker`) | Graceful degradation during dual-run |

**What we need to add** (scaffolded in this session):

- `src/utils/refactor-flags.ts` — centralized refactor flag registry with
  localStorage + URL-param resolution
- `src/utils/dual-run.ts` — `dualRun()` helper that executes both
  implementations and logs deltas when the flag is on
- `refactor-notes/` directory — contract documentation per refactor

---

## Applying the Playbook to the Remaining TODOs

### TODO-001 — Decompose `App.ts`

**Complexity**: High. 4 357 lines, ~40 methods, many event listeners.

**Recommended segmentation**:

1. Phase 1: Extract `RefreshScheduler` (pure timer/interval logic). ~1 day.
2. Phase 2: Extract `DataLoader` (fetch orchestration). ~1 day.
3. Phase 3: Extract `PanelManager` (panel instantiation, drag, persist). ~1 day.
4. Phase 4: Extract `MapController`. ~0.5 day.
5. Phase 5: Extract `DeepLinkRouter`. ~0.5 day.
6. Phase 6: Flip default, observe, clean up. ~1 release cycle.

Each phase = its own flag, its own characterization tests, its own PR.
**Do NOT batch.**

### TODO-013 — Split `MapPopup` / `DeckGLMap`

**Complexity**: Medium. Popup output is easy to snapshot-test per layer
type (deterministic input → deterministic HTML).

**Recommended segmentation**:

1. Phase 1: Snapshot every popup variant under `e2e/map-popup-snapshots.spec.ts`.
2. Phase 2: Create `src/components/popups/PopupFactory.ts` that dispatches
   to the monolith by default.
3. Phase 3: Extract one popup type per commit (`ConflictPopup`,
   `MilitaryBasePopup`, etc.), snapshot-verified.
4. Phase 4: Flip default when all popup types are extracted and snapshots
   remain stable.

### TODO-002 — Server-side RSS aggregation

**Complexity**: Medium. Infrastructure-heavy but API-bounded.

**Recommended segmentation**:

1. Phase 1: Build `api/news.js` that returns the same shape the client
   already consumes, fed by live RSS (no Redis yet).
2. Phase 2: Add Redis caching to the endpoint with a bypass env var.
3. Phase 3: Introduce a client-side flag that routes fetches through the
   new endpoint. Default OFF.
4. Phase 4: Parallel run — client fetches both paths, compares counts and
   content sample, logs drift. Once drift is zero for 48 hours, flip
   default.
5. Phase 5: Remove direct RSS proxy rules from `vite.config.ts`.

### TODO-004 — API handler test suite

**Complexity**: Low per handler, high volume (52 handlers).

Not a refactor — use a test generator script that walks `api/*.js`, reads
each handler's signature, and emits a characterization test scaffold. Then
fill in handler-specific assertions manually.

### TODO-019 — A11y audit

**Complexity**: Medium, lots of touch points.

Treat as a characterization pass: run `axe-core` against every panel once
(as part of e2e), record current violations as a baseline, then drive the
baseline down one panel at a time. Each fix is a tiny commit with an
axe-verified delta.

---

## Go/No-Go Gates

Before starting any refactor on this list:

- [ ] Step 1 inventory complete and committed to `refactor-notes/`
- [ ] Step 2 characterization tests committed and passing
- [ ] Feature flag registered in `refactor-flags.ts`
- [ ] PR description cites this document and lists which phases are in scope
- [ ] Rollback plan is a single `git revert <sha>`, verified locally

If any gate fails, do not start. Escalate instead.

---

*Maintained alongside `CHANGELOG.md` and `docs/ALERTS_ENHANCEMENT_ROADMAP.md`.
Revise when the playbook produces a regression that the methodology should
have caught.*

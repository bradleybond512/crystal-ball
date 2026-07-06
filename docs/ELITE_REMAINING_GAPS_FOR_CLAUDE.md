# Elite Remaining Gaps For Claude

Checked: April 28, 2026.

This document is the current "what are we still missing?" handoff for Claude.
Crystal Ball now has a lot of strong deterministic service code. The main gap is
that the intelligence is still fragmented across services and open PRs instead
of feeling like one elite, native, high-trust Crystal Ball experience.

## Copy/Paste Prompt For Claude

```text
Read docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md, CLAUDE.md, and
docs/ELITE_CRYSTAL_BALL_GAMEPLAN.md.

First, verify the open PR state and rebase or supersede dirty/behind branches
instead of duplicating work. Then implement the next smallest high-impact batch:
wire the existing intelligence, weather, insights, diagnostics, ops, and
shortage services into a unified Command Center surface with diagnostics-backed
confidence. Prefer product wiring over new isolated algorithms.

Do not broad-refactor. Keep outputs deterministic, provenance-aware, and
fixture-tested. Run npm run typecheck:all before claiming completion.
```

## Current State Summary

Merged or present locally:

- Intelligence services: truth scoring, evidence graph, clustering, negative
  evidence, baseline deviation, compound risk, calibration, and watchlist logic.
- Weather services: NWS polygon matching, urgency ladder, Personal Storm Mode
  payloads, warning router, and warning diagnostics.
- Insights services: Big Event Detector, Confidence/Urgency Matrix, What Changed
  Digest, Action Briefs, reaction playbooks, and presentation export.
- Diagnostics services: diagnostic event bus, panel health registry, feature
  health registry, system health aggregator, notification trace registry, export
  bundles, diagnostics state, and sentinel feed audit.
- Ops services: mission types, mission ledger, and time-to-warn scoring.
- Algorithm diagnostics: algorithm health and evaluation ledger.
- Shortage services: multiple food, energy, and soft commodity forecast models.
- UI pieces: Ask Crystal Ball panel, API diagnostic panel, Weather Radar panel,
  Personal Storm Mode component, command palette, and existing panel shell.

The app is no longer missing raw ingredients. It is missing the orchestration
layer that makes the ingredients feel inevitable, fast, and useful.

## Local Typecheck Blockers Found

`npm run typecheck:all` currently fails on untracked local UI files, which means
Claude should treat the latest UI wiring as unfinished until these are resolved:

- `src/components/CommandCenterPanel.ts`: unused `refreshTimer`.
- `src/components/SystemDiagnosticPanel.ts`: missing
  `@/services/diagnostics/self-test`, unused `refreshTimer`, and implicit `any`
  parameters.

These failures reinforce the main gap: Command Center and diagnostics UI are in
progress locally, but not yet complete enough to claim working.

## Open PRs To Reconcile First

These were open at the latest check and should be reconciled before new work
duplicates them:

- PR #170: shortage batch 6, fertilizer/crude/propane/electricity. State:
  dirty.
- PR #168: closed-loop ops PRs 3-7, explanation QA/effectiveness/near-miss/
  replay/capability readiness. State: dirty.
- PR #166: algorithm safe adjustment engine. State: dirty.
- PR #164: algorithm evaluation ledger. State: dirty.
- PR #162: diagnostics self-test runner. State: dirty.
- PR #158: algorithm registry and shared health types. State: dirty.
- PR #153: macOS native design tokens and reusable styles. State: behind.
- PR #150: shortage batch 4, rice/soybeans. State: dirty.
- PR #148: shortage batch 3, natural gas/jet fuel. State: dirty.
- PR #146: insights action briefs and reaction playbooks. State: dirty.
- PR #144: intelligence watchlist relevance. State: dirty.
- PR #142: intelligence compound risk. State: dirty.
- PR #138: What Changed Digest and change-memory store. State: dirty.
- PR #136: weather urgency notification ladder. State: dirty.
- PR #128: ADS-B frontend wiring. State: behind.
- PR #114, #64, #61, #60: older UI/perf salvage branches. Inspect before
  reusing; likely superseded or require careful cherry-picking.
- Dependabot PR #155 is blocked by bundle-size and typecheck failures.

Claude should treat dirty/behind PRs as possible duplicates of already-merged
work. Rebase, close, or supersede them deliberately.

## Highest-Impact Missing Product Surfaces

### 1. Command Center Default Screen

Missing: a first-screen experience that answers "what matters right now?"

Build a native-feeling `CriticalEventCommandCenter` or equivalent and wire it
into the app shell. It should combine:

- top 3 events that matter to the user
- current personal risk level
- What Changed since last look
- why each event matters
- confidence and uncertainty
- recommended action
- time-to-warn
- diagnostics health hints
- next update time

This should be the default elite surface, not another optional panel.

### 2. Diagnostics UI And Self-Test Visibility

Missing or incomplete: a user-facing system diagnostics panel that proves all
panels, feeds, services, algorithms, and notification paths are healthy.

Build or finish:

- `SystemDiagnosticPanel`
- self-test runner UI
- diagnostics export button
- panel/service health table
- "why did or did not I get warned?" trace view
- feed freshness and failure reason display
- last successful evaluation timestamp per algorithm

The app should make technical health visible without requiring a terminal.

### 3. Notification Ladder End-To-End Wiring

Missing: the app should consistently route risk through a single delivery
ladder.

Wire weather, insights, shortages, and ops events into:

- native notification
- in-app banner
- persistent critical banner
- menu bar status
- repeat suppression
- quiet-hours bypass for life-safety conditions
- notification trace registry

No high-risk event should be "computed but not delivered."

### 4. Native macOS Design Finish

Missing: a cohesive black, high-tech, Apple-native visual system applied across
the real app.

Continue from PR #153 or supersede it with:

- dark macOS materials
- compact toolbar polish
- native segmented controls
- icon-first action buttons
- inspector drawer
- menu bar risk status
- fast transitions
- no marketing-style cards or decorative filler

The app should feel like a professional macOS command instrument.

### 5. Ask-The-Data Mode

> **STATUS 2026-07-04 — WIRED.** The deterministic engine
> (`src/services/insights/ask-the-data.ts`) is now connected to the running
> app: `src/services/insights/ask-context.ts` snapshots the live feature /
> panel / mission registries and the Command Center renders an "Ask the data"
> input with answer packet, evidence rows, and follow-up chips. LLM prose
> remains optional and un-wired (deterministic packet first, per this doc).

Missing: a local structured query mode over Crystal Ball's normalized data.

Add an "Ask Crystal Ball" path that can answer:

- Why is this risk high?
- What changed since yesterday?
- Which sources disagree?
- What would make confidence rise?
- What should I watch next?
- Did we warn late last time?

Do the deterministic retrieval and evidence assembly first. Use LLM prose only
after structured data has produced a grounded answer packet.

## Missing Closed-Loop Intelligence

### 6. Outcome Grading And Miss Learning

The system needs to learn from misses and noisy alerts.

Complete or reconcile the open closed-loop PRs for:

- mission effectiveness scoring
- explanation QA
- near-miss detection
- replay fixture generation
- capability readiness
- missed-warning capture
- late-warning capture
- noisy-alert capture

Every important prediction should eventually become training evidence,
calibration evidence, or a regression fixture.

### 7. Algorithm Self-Improvement Guardrails

The app needs a safe improvement loop, not opaque self-modification.

Complete or reconcile:

- algorithm registry
- evaluation ledger
- safe adjustment engine
- adjustment audit trail
- rollback to previous thresholds
- confidence impact reports
- A/B or shadow-mode evaluation before enabling changes

Algorithms may recommend threshold changes, but the system should retain
explainability and rollback.

### 8. Replay And Scenario Harness

> **STATUS 2026-07-04 — BUILT + VISIBLE.** `replay-harness.ts` +
> `replay-fixtures-catalog.ts` run in CI (smoke tier 1) against the committed
> baseline (`src/services/ops/replay-baseline.json`), and the System
> Diagnostic Self-Test tab now has a `replay_baseline` probe running the same
> check in-app. Remaining from the fixture wishlist below: crop failure,
> contradictory geopolitical sources, stale provider failure.

Missing: a way to replay historical or synthetic events through the full stack.

Add fixtures for:

- severe wind outbreak near a saved place
- tornado warning polygon overlap
- fuel shortage early warning
- crop failure and food shortage forecast
- ADS-B data outage
- contradictory sources on a geopolitical event
- stale provider failure
- notification suppression bug

The app should be able to prove it would warn better next time.

## Missing Data-To-Insight Bridges

### 9. Shortage Radar UI

Shortage models exist, but users need a visual surface.

Build:

- Shortage Radar panel or Command Center section
- commodity cards
- driver breakdowns
- confidence and data gaps
- "what changed" for each commodity
- likely impact window
- user impact mapping
- source freshness

This should translate crop, energy, shipping, inventory, policy, and price data
into plain consequences.

### 10. ADS-B Frontend Integration

Backend aggregate work exists, but PR #128 is still behind.

Finish:

- frontend fetch from `/api/adsb-aggregate`
- provider freshness display
- provider fallback display
- confidence scoring
- map overlay integration
- degraded-state messaging

Airspace intelligence should not require inspecting backend logs.

### 11. Provider Redundancy Health

Missing: a first-class view of whether redundant APIs agree.

For each data domain, show:

- primary source
- backups
- last successful fetch
- disagreement score
- stale source penalty
- provider outage status
- confidence impact

The user should know when Crystal Ball is confident because multiple sources
agree, and when it is cautious because the data layer is weak.

## Missing Presentation And Action Layer

### 12. Action Briefs In The Actual Experience

Action Briefs should not stay as service outputs.

Wire them into:

- Command Center event cards
- high-urgency notifications
- Storm Mode
- shortage alerts
- share/export packets
- Ask Crystal Ball answers

Every major event should answer: what happened, why it matters, what to do, what
to watch, and how confidence could change.

### 13. Shareable Intelligence Packets

Presentation export exists, but the product needs a one-click "send this to
someone" flow.

Add:

- concise markdown export
- clipboard summary
- Claude debug packet
- PDF or native print path later
- source/provenance appendix
- diagnostics appendix when warning delivery is questioned

### 14. Personal Impact Engine

Missing: a generalized personal relevance layer.

Use saved places, watched entities, user interests, routes, and settings to map
events to:

- immediate personal risk
- financial/commodity exposure
- travel impact
- outage or utility impact
- family/place impact
- "ignore unless this changes" suppression

This is how Crystal Ball becomes personal instead of merely global.

## Missing Reliability And Release Hygiene

### 15. PR Queue Cleanup

The open queue has many dirty/behind PRs. This creates duplicate work and makes
Claude easy to confuse.

Recommended cleanup:

1. Rebase or close stale dirty PRs that are already represented on current main.
2. Re-open only the smallest remaining product-wiring PRs.
3. Keep branches focused by surface: Command Center, Diagnostics UI,
   Notification Delivery, Shortage Radar, ADS-B UI, macOS polish.
4. Avoid more "service only" branches until the user can see the value in-app.

### 16. Cross-Agent Review And Docs Freshness

There are local untracked cross-agent review and docs freshness files. Claude
should inspect whether these need to be formalized:

- `.github/workflows/cross-agent-review.yml`
- `scripts/cross-agent-check.mjs`
- `scripts/check-docs-freshness.mjs`

If kept, wire them into CI intentionally. If not, remove or archive them on a
branch so they do not linger as ambiguous local state.

## Best Next PR Sequence

### PR A: Command Center Skeleton

- Add a Command Center component.
- Feed it from existing weather, insights, diagnostics, ops, and shortage
  service outputs using static fixture data first.
- Add tests for ranking and rendering payload assembly.
- Make it reachable from the current app shell.

### PR B: Diagnostics Panel Plus Self-Test

- Add `SystemDiagnosticPanel`.
- Show service, panel, feed, notification, and algorithm health.
- Add self-test run/summary/export.
- Connect diagnostic traces to "why was I not warned?"

### PR C: Notification Delivery Router

- Route high-risk events through the shared ladder.
- Record delivery attempts in notification trace.
- Add repeat suppression and quiet-hours policy.
- Add fixture tests for life-safety bypass.

### PR D: Native Design Pass

- Rebase or supersede PR #153.
- Apply native dark styling to Command Center, diagnostics, Storm Mode, and
  Ask Crystal Ball.
- Add menu bar risk status if the Tauri hooks are already available.

### PR E: Shortage Radar

- Bring commodity forecasts into a product surface.
- Show confidence, drivers, data gaps, time horizon, and recommended user action.

### PR F: Replay Harness

- Convert misses and near-misses into deterministic replay fixtures.
- Run replay against warning, insight, and notification paths.
- Use output to calibrate the algorithm ledger.

## Definition Of Done

Claude should not call this phase complete until:

- the default screen shows the top risks and actions
- severe weather warnings surface visibly and explainably
- diagnostics can prove feed, service, algorithm, and notification health
- user-facing outputs include confidence, provenance, and uncertainty
- at least one missed-event replay fixture exists
- open dirty/behind PRs are reconciled or explicitly superseded
- `npm run typecheck:all` passes

# UX-062 — Label unmatched forecast estimates

Status: Bradley approved this bounded slice, amended acceptance, documentation-only draft claim and local implementation on 2026-11-08. Draft [#1886](https://github.com/bradleybond512/crystal-ball/pull/1886) claims this slice. Full UX-062 remains open; later production-code publication requires separate approval. Merging, auto-merge, releases, build dispatch, deployment and installation remain paused.

## Brief and verified selection

Goal: prevent displayed estimates from implying verified baseline performance without supporting evidence. Preserve every existing forecast value, numerical format, bar, warning and action.

Discovery on canonical main `f657f813d4c556249df7210ebf76290ca637abf9` selected UX-062, priority S/high assurance (81 referenced PRs/97 total PRs). Before claiming, the branch was rebased to `4432188fedbaba28938608cc07da6a25d11ca0c9`; the relevant production surfaces and workflow instructions were unchanged. The fresh complete snapshot again selected UX-062, with 81 referenced PRs/87 total PRs and no blocking findings. Evidence is retained under `~/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/ux062/` (original discovery under `next-nov7/`). The task is not eligible for rejection: ACC-008 reports insufficient analyst-loop pairs, negative disaster skill and unavailable champion state. These historical aggregates are not current per-forecast evaluations.

Repository exploration and architect review found an acceptance mismatch that must be approved explicitly before implementation:

- The HUD's adjusted 6h/24h/72h probabilities differ from recorded analyst-loop raw confidence at a fixed 2h horizon.
- Raw HUD confidence also lacks an exact emission identifier. The recorder deduplicates a signature plus six-hour bucket and stamps its own time; later displayed confidence can differ from the retained emission.
- Expanded Superforecast results lack a recorded prediction ID/time and have independent cache/deduplication behavior.
- SituationPanel renders scenario probabilities without calibration identity. The actual SituationDossier renders categorical confidence, not forecast probabilities.
- Command Center renders pooled historical calibration statistics, not an individual forecast with a matched baseline.
- ACC-303 runtime joins pool models and discard identity needed here. ACC-403 status is not per-forecast skill; composing it also performs replay/bootstrap. ACC-008's stronger partitioned projection is private to Node acquisition tooling. No baseline-skill freshness TTL exists.

Consequently, the literal beats/trails fixtures on every originally named surface cannot be reached honestly through a labels-only change. This proposal implements the supported Unverified fallback and leaves those remaining requirements open.

## Proposed visible behavior

| Surface | Addition |
|---|---|
| HUD raw confidence | Adjacent **Unverified**; explanation: baseline skill is unverified for this displayed estimate. |
| HUD adjusted forecast bar | Adjacent **Unverified**, separately scoped from raw confidence; explanation: no exact matching baseline evaluation for this adjusted forecast. |
| Expanded Superforecast | **Unverified** beside its headline probability; explanation: no exact recorded identity for this displayed result. |
| SituationPanel scenarios | **Unverified** beside each existing scenario probability; explanation: no matching baseline evidence. |
| Command Center calibration card | **Baseline comparison: Unverified.** Explain that this summary combines historical forecasts and does not verify individual forecast skill. Preserve existing historical assessments. |
| SituationDossier | No forecast badge added; categorical confidence and urgency remain unchanged and get a negative regression check. |

Labels are visible without hovering. Explanations must be available to keyboard and screen-reader users. Use neutral presentation, existing text/escaping conventions and minimal styling for contrast and wrapping. Do not introduce another alert or notification.

## Architecture and invariants

Use the existing render paths in `AnalystHUD.ts`, `SituationPanel.ts` and `CommandCenterPanel.ts`. Use `forecast-provenance-view.ts` only if the existing expanded Superforecast formatter is the appropriate integration point. At most introduce a small shared presentation helper if repeated markup warrants it; do not create speculative scoring states or an unused evaluation service.

Static Unverified labels cannot be promoted by favorable, unfavorable, stale, malformed, unrelated or pooled records. Existing empty states remain unchanged when no forecast/card exists. No additional ledger read, replay, bootstrap, timer, request or subscription is needed. Cost is constant per rendered item.

No new freshness policy is introduced because this slice consumes no baseline evidence. The paired Brier metric floor of 20 remains distinct from promotion floors of 200 overall/100 per domain and the historical calibration card's minimum of 12. No floor, scoring formula or champion decision changes.

Non-goals: forecast emission/alignment, probabilities/horizons, DTOs, calibration or ledger schemas, persistence, model tuning, providers, warnings, notification policy, native permissions, dependencies, and delivery. No installed-app data acquisition is needed.

## Owners, validation and evidence

| Owner | Bounded responsibility | Dependency |
|---|---|---|
| UI specialist | Three component integrations, existing provenance formatter if needed, minimal existing styles | Approved design and test contract |
| Test engineer | Focused real-renderer fixtures and browser checks; owns test files | Approved acceptance; coordinate red tests before implementation |
| Root integration owner | Named test script, additive mappings, tracker and evidence, validation | Frozen source/tests |
| Independent reviewer | Complete diff and evidence; not the implementer | Validation and mutation proofs |

Add `test:ux062` covering raw versus transformed HUD estimates, expanded Superforecast, each scenario probability, historical calibration wording and unchanged categorical dossier confidence. Assert unchanged numeric strings/bar widths, warnings/actions, and no invented comparator probability or beats/trails claim. Where practical, favorable/unfavorable/missing/old unrelated evidence must not change the fallback. These are fallback-invariance tests, not completion of the full four-state acceptance.

Run focused tests, `test:intelligence`, `test:insights`, `typecheck:all`, then `bash scripts/agentic-validate.sh --tests 'test:ux062 test:intelligence test:insights'` and trusted selected suites. Use relevant existing dossier/provenance fixtures as needed. Chromium fixtures verify actual rendering, wrapping, keyboard access, explanations and warning preservation. Native acceptance remains distinct. These are planned checks; none has been run for this design.

Every added labeling behavior needs a clean-tree, confirmed-applied mutation with actual failing assertions/counts and matching restored checksum. Require independent Sol and actual Sonnet reviews, with at most two repair cycles. Record the final SHA-pinned verdict; obtain separate code-push approval. Do not run closeout while auto-merge is paused.

## Remaining full-task acceptance and rollback

The same UX-062 claim must remain IN PROGRESS/IN REVIEW, never DONE or REJECTED on this slice. Record the original beats/trails/current-comparator/stale requirements as unmet. Do not silently treat incomplete S-priority work as permission to skip to a lower-priority task.

A separately designed and approved prerequisite must establish exact emitted forecast identity (model/version, target/window, domain and probability), resolve transformed/deduplicated forecast semantics, expose correctly partitioned paired evidence/current comparator, and define freshness. ACC-008's exact joins/exclusions are a reference; its Node acquisition entry point must not be imported into the renderer. Only then can full UX-062 provide reachable beats/trails states and the corresponding surface fixtures.

Rollback reverts presentation/tests only; no records, scoring or production data require migration or restoration. The principal residual limit is explicit: Unverified communicates lack of a valid comparison, not proof that a forecast is wrong.

Bradley's approval covers this concrete partial scope and acceptance amendment, the documentation-only draft claim and local implementation. AGENTS.md's high-assurance design gate is satisfied. A later code push remains separate; the delivery holds remain in force.

# ACC-510 — Evidence-based domains for news-derived situations

Status: policy, documentation-only draft claim and local implementation approved by Bradley on 2026-11-06. Draft [#1858](https://github.com/bradleybond512/crystal-ball/pull/1858) claims the work. Local implementation and validation are complete; see the [QA report](../validation/ACC-510-NEWS-DOMAIN-EVIDENCE.md). Code publication requires separate approval. Installation, auto-merge and delivery remain paused.

## Brief and discovery

Goal: stop generic news bursts from becoming civil-unrest claims without supporting topic evidence, while preserving supported unrest and authoritative warnings. Classification must explain its evidence and uncertainty; unsupported evidence must not generate unrest forecasts indirectly.

The complete roadmap snapshot selects ACC-510, priority A, with ACC-509 complete and no blocking findings. Risk: high assurance (inference and persisted-state semantics), despite the checker's generic highAssurance flag. The task's own roadmap text explicitly requires approval.

Repository discovery found unconditional civil_unrest mappings for velocity_spike, keyword_spike and convergence in situation-types.ts. Synthetic technology-launch, coffee-price and research-paper spikes all became unrest. updateSituation retains the creation-time domain after evidence revisions. A separate generic-type mapping reaches civil-unrest resolution criteria through analyst-loop, Hypothesis and hypothesis-prediction-bridge. Fixing labels alone therefore leaves an inference defect.

Compound cannot represent uncertainty: it currently grants wildcard affinity and participates in cross-domain reasoning. Existing convergence relatedTopics identify source types, not subjects. Topic strings and source counts are insufficient topical evidence.

Non-goals: new feeds, dependencies, classifier calls, model tuning, production-accuracy claims, notification policy, delivery settings, installation or merging. Existing article acquisition and classification scheduling stay intact.

## Approved policy

Add an explicit unknown situation domain, displayed as **Topic unconfirmed**. Preserve known authoritative source hints and existing non-news mappings. Stored inferred labels are not authoritative hints.

For the three generic news types, use existing classifications from the articles that actually contributed to that signal. Do not substitute unrelated current news, geographic proximity, source-type labels or a keyword match for this provenance.

Require complete agreement across all contributing articles after deduplication, with at least two distinct article identifiers and two existing source identifiers. These establish source diversity, not proven independence. This is an engineering policy requiring evaluation, not a calibrated probability of unrest.

Map existing categories conservatively:

| Existing article category | Situation domain |
|---|---|
| protest | civil_unrest |
| economic | economic |
| disaster | natural_hazard |
| conflict, military, terrorism | military |
| existing corresponding cyber, health and infrastructure categories | corresponding domain |
| other categories | abstain |

Use existing allowlists for category and classifier method. Validate finite, positive confidence in its existing range, publication time, and bounded identifiers. Confidence remains evidence metadata, never a probability that unrest occurred. Add no new numerical confidence threshold beyond rejecting invalid/zero evidence.

Only articles in the producer's existing topic/time window participate; validate timestamps for actual contributing candidates and abstain on malformed or future values. Deduplicate before counting. Inspect at most 64 contributing articles; overflow abstains. Inspect every article within the bound before retaining at most eight deterministically selected provenance references.

| Evidence condition | Result/reason |
|---|---|
| Missing classification metadata | unknown / incomplete_evidence |
| Valid but unmapped category, including general or technology | unknown / unsupported_category |
| Invalid classification, identifiers or publication time | unknown / invalid_evidence |
| Different supported domains | unknown / conflicting_evidence |
| Fewer than two articles or two source identifiers | unknown / insufficient_evidence |
| More than 64 contributing articles | unknown / evidence_overflow |
| Complete agreement and quorum | supported domain with provenance |

Two protest articles plus one technology article must abstain. This conservative rule can miss genuine unrest; replay must expose every added miss rather than hiding abstentions.

## Architecture and consumer closure

Introduce one pure classifier beside situation-types.ts returning a versioned `{domain, basis, reason, evidence}` result. Attach bounded existing article classifications in analysis-core.ts for velocity/convergence. Preserve optional classification metadata through rss.ts, data-loader.ts and trending-keywords.ts so keyword spikes carry the evidence already available locally. No additional provider or classifier work is scheduled.

Update situation-correlator.ts, alert-identity.ts and situation-engine.ts so material evidence revisions recompute classification and titles while preserving observation keys, IDs, TTLs and ledger bounds. No supported current domain means unknown; one supported domain means that domain; multiple distinct supported domains mean compound. Never promote unknown evidence into support for a known domain.

Unknown contributes no domain-affinity bonus, domain-diversity bonus, verification vote or causal trigger. A generic signal can satisfy a domain-specific causal template only with a supported matching domain. Preserve other correlation requirements rather than using unknown as a wildcard.

Unknown situations remain visible. situation-forecaster.ts and situation-personalizer.ts provide information-only behavior, with no hazard-escalation scenarios or hazard-specific instructions. SituationPanel exposes the neutral label and classification reason. Exclude unknown evidence from threat-synthesis cross-domain claims and verify mode-forecast does not turn it into security pressure.

Close the connected forecast path: derive bounded, allowlisted qualified event types from current situation evidence, carry them through Hypothesis, and use them in hypothesis-prediction-bridge. Derive the existing Hypothesis.domains field from current supported snapshot domains rather than the situation presentation label: protest plus military stays in the existing conflict pool, protest plus economic retains mixed conflict/markets semantics, and unknown contributes no domain. Keep domainForHypothesis and its mixed-domain gate unchanged. Remove generic-string-only civil-unrest mapping in event-occurrence-contract. Legacy hypotheses containing only generic signalTypes cannot acquire unrest criteria. Preserve typed non-news mappings, geographic/entity requirements and resolver thresholds.

## Persistence and rollback

Use a version-3 situation envelope/key, retaining the existing v2 snapshot untouched. Older readers reject unknown domains, so overwriting v2 would make rollback lose history.

Read v3 first; migrate v2/v1 only when v3 is absent. Malformed v3 must not silently revive older inferred labels. During migration, generic snapshots without valid topical provenance become unknown; reconstruct authoritative hints only from known source mappings. Preserve IDs, timestamps, identity retention and dismissed actions. Recompute derived domains, diversity, verification, scenarios and causal output; never invent provenance.

Validate evidence again on restoration. Raw evidence for up to 64 articles is transient; persisted results retain at most eight deterministic, source-diverse references plus bounded article/source counts. A recognized supported v1 result is a locally produced assertion that the full input was checked, not a fresh classification of its truncated references. Restore requires coherent version/basis/domain/reason, 2–64 total articles, at least two sources, 2–8 distinct valid references demonstrating source quorum and matching domain, counts consistent with retained references, and original observation-time validity. If all articles are retained, counts must match exactly. Unknown results never become supported by reclassifying retained references. Fresh signal ingress must pass the full classifier and cannot submit a precomputed assertion. Restore cannot independently prove discarded article metadata; this limitation is explicit. Bound storage and evidence sizes. Rollback restores prior code reading retained v2 history; newer v3-only history stays preserved but unavailable to that older binary. This limitation must remain explicit. No production storage is touched during local implementation/testing.

## Acceptance and validation

Build a frozen labeled replay before production edits. Include generic earnings, sports, technology and weather news; ambiguous strike; source-type convergence; mixed topics; missing, invalid, duplicate and future evidence; genuine protests, riots and labor unrest. Report old/new false unrest positives, missed unrest, abstentions and each case's outcome. Require fewer false positives and explicit review of every added miss; do not silently redefine labels to pass.

Behavior tests must cover authoritative warning preservation; supported protest reaching qualified unrest criteria; same-identity evidence revisions and corrected titles; every unknown exclusion above; legacy hypotheses; restart, legacy migration, malformed v3, bounded retention and rollback compatibility. Preserve ACC-509's late evidence, duplicate handling and dismissal behavior.

Discovery's actual focused baseline:

```text
tsx --test tests/intelligence/situation-engine-identity.test.mts src/services/__tests__/acc509-replay.test.mts
# tests 33
# pass 33
# fail 0
```

Implementation validation: new focused ACC-510 suite, test:acc509, affected situation/correlation/forecast/hypothesis suites, typecheck:all and `bash scripts/agentic-validate.sh --tests "<actual targeted scripts>"`. Determine existing exact suite names during implementation, then record actual output. Run trusted selected CI suites. Each behavior change needs an applied-diff mutation proof with actual red counts, clean restoration and matching checksums. Require independent Sol and Sonnet reviews; at most two automatic repair cycles.

No new external source is added. Synthetic replay is evidence of regression behavior, not a production error-rate or accuracy-uplift estimate.

## Bounded execution tasks

| Owner | Scope | Dependency and validation |
|---|---|---|
| Prediction specialist | Pure classifier, types, producer evidence; analysis-core, rss/data-loader, trending-keywords | Approved policy and frozen replay; classifier/producer tests and typecheck |
| Intelligence specialist | Correlator, identity revisions, engine persistence and forecast-contract path | Classifier contract; ACC-509, causal/bridge, migration and rollback tests |
| UI specialist | SituationPanel neutral label and reason only | Stable classification result; presentation/accessibility tests |
| Prediction specialist | Forecaster/personalizer, synthesis/mode exclusions | Stable unknown semantics; no escalation/action/diversity regression tests |
| Test specialist | Frozen replay and clean-tree mutation evidence | Frozen implementation; measured false positives/misses/abstentions, red counts and checksums |
| Root and independent reviewers | Integration, exact-scope test mapping, QA report and reviews | All targeted checks; no publication without explicit approval |

Serialize overlapping inference/engine work; delegate in parallel only when file ownership is disjoint. Preserve existing module conventions and avoid broad refactoring.

## Approved decisions

Bradley approved the complete-agreement/two-article/two-source policy, explicit unknown behavior, connected forecast-contract correction, v3 persistence/rollback policy, documentation-only draft claim and local implementation. A later code push requires its own reviewable approval. Installation, auto-merge and delivery remain paused.

## Existing CI transport repair

Reuse the separately approved and reviewed metadata-only roadmap transport repair from drafts #1856/#1857 (`7ca713721`): the same workflow/tests and additive mapping are included so this draft can build its historical PR snapshot. No new roadmap policy or permission change is introduced. The prior repair passed 126 roadmap tests, 61 workflow-security tests, 11 mutation reversals and hosted PR validation on both drafts. Final ACC-510 validation will rerun the affected tests.

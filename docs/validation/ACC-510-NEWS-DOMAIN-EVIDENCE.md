# ACC-510 — News-domain evidence

Implemented and published to PR #1858. Bradley authorized reconciliation and merging on 2026-11-07. Installation, tags, releases, build dispatch and deployment remain paused. This is synthetic regression evidence, not measured production accuracy.

## Behavior and architecture

Generic news now requires unanimous supporting classifications from at least two unique articles and two source identifiers. Missing, invalid, mixed, insufficient or overflowing evidence stays **Topic unconfirmed**, remains visible, and cannot create unsupported hazard forecasts. Source diversity does not establish independence.

- `situation-news-domain.ts` owns the bounded classifier and restoration contract. `situation-types.ts`, `analysis-core.ts`, `rss.ts`, `trending-keywords.ts` and `data-loader.ts` carry existing classifications without new requests.
- `situation-correlator.ts`, `situation-engine.ts` and `alert-identity.ts` recompute evidence revisions while preserving identity, retention and dismissals. Unknown evidence supplies no hazard confidence, affinity, diversity or verification vote.
- `analyst-loop.ts`, `event-occurrence-contract.ts` and `hypothesis-prediction-bridge.ts` carry supported domains through the actual hypothesis path. Existing mixed-domain, geography and entity gates remain intact; generic strings alone cannot create unrest criteria.
- `SituationPanel.ts`, `situation-forecaster.ts`, `situation-personalizer.ts` and `threat-synthesis.ts` show uncertainty and exclude unsupported escalation. Forecast coverage and freshness use the same eligible evidence. Ghost Mode remains intact.
- Version 3 storage preserves version 2 for rollback. Raw evidence is transient; at most eight references persist. Restored supported summaries are validated local assertions, not independent reclassification of discarded metadata. Malformed v3 cannot revive legacy labels. The envelope limit is 8,388,608 serialized characters and 4,096 entries/signals; browser quota may fail earlier.
- Existing changed-file lint findings were repaired without weakening rules. Diagnostics contain fixed messages, not article contents or error payloads. No dependencies, feeds or notification policies changed.

The previously reviewed metadata-only roadmap CI transport repair is included unchanged, with additive test mappings. Its 11 mutation proofs are reused with verified matching file hashes, not claimed as new executions. Both sibling drafts #1856/#1857 passed all 15 hosted workflows with this repair. See `ROADMAP-CI-MUTATIONS.json` and `ROADMAP-CI-LIVE-PROBE.json` for body-level probe evidence.

## Frozen replay

The 20-case fixture was frozen before production changes. SHA256: `28284a984f9b8202173c8cc93a06d10efc942c55199fff9168dc52ba3f21dc05`.

| Measurement | Baseline | Implemented |
|---|---:|---:|
| False unrest positives | 13 | 0 |
| Missed genuine unrest | 0 | 4 |
| Abstentions | 0 | 15 |

Baseline behavior was independently rerun from detached `fd01a579d2f0409594bbce08a2975e987c048084`, through both the old domain function and correlator. All 20 outcomes matched the original baseline. The four added misses are `mixed-protest-tech`, `one-source-unrest`, `conflicting-supported` and `overflow-unrest`. These are retained labels and explicit conservative-policy costs. Supported protest, riot and labor-unrest cases remain supported. Machine-readable outcomes: `ACC510-REPLAY-BASELINE.json` and `ACC510-REPLAY-RESULT.json`.

## Commands and actual results

Production source froze at `13b4312beb7ec9e2e1465fe3e0c27db9c74db911`. Test-only supplement `65ba8bd80b16622f7b78e93a2469ce963863ca39` strengthens independently isolated size, count, allowlist and freshness checks; production hashes are unchanged.

On the frozen implementation:

```sh
bash scripts/agentic-validate.sh --tests 'test:acc510 test:acc509 test:intelligence test:roadmap-controller test:workflow-security'
```

Actual respective test-run summaries:

```text
# pass 80
# fail 0
# pass 126
# fail 0
# pass 589
# fail 0
# pass 126
# fail 0
# pass 61
# fail 0
Agentic validation gate passed.
```

The trusted canonical-main selector (`node <evidence-directory>/trusted-ci.mjs --ci`) on that same clean source reported:

```text
[targeted-tests] 79 script(s) passed.
```

After the test-only supplement, `bash scripts/agentic-validate.sh --tests 'test:acc510'` reported:

```text
# pass 85
# fail 0
Agentic validation gate passed.
```

Both gates included type checks, secret scans and builds. Direct changed-file ESLint passed. Build timing advisories are not a measured performance guarantee. Raw logs are retained in the local evidence directory `~/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/acc510/`: `final-gate.log`, `selected-ci.log`, `supplement-gate.log`. The 79-suite run predates only the test supplement and documentation; it is not relabeled as an execution on the later commit.

## Mutation proof and independent review

`ACC510-MUTATIONS.json` records each applied reversal, before/after counts, failing assertions, checksums and clean restoration. There are **89 fresh assertion-killed mutations**, 157 failing subtests and 71 distinct failing test names. The 11 reused roadmap proofs are separate. Historical five survivors and two unapplied anchors remain disclosed; corrected attempts resolve genuine gaps. One surviving source-quorum reversal is equivalent because surrounding retained-source constraints imply the same bound.

Examples from the final supplement: size guard `22/0 → 21/1`; entry bound `22/0 → 21/1`; signal bound `22/0 → 20/2`; mixed allowlist `22/0 → 21/1`; freshness numerator and denominator each `12/0 → 10/2`. Mutations cover classifier/producer handoff, correlated confidence and domains, persistence, forecast eligibility, neutral UI/actions, synthesis and the connected hypothesis path. Applied diffs were inspected; all original checksums and the clean detached tree were restored. Final restored focused run: `85 pass / 0 fail`.

The tracked certificate is a compact derivative: repeated exact strings are interned through its string table, and oversized assertion output uses bounded excerpts with full-artifact JSON pointers and hashes. Applied diffs, failing test names, numerical counts and restoration evidence remain. Complete raw expected/actual diagnostics are local artifacts, not embedded repository evidence. The unchanged full certificate SHA256 is `878783b2d4092ad334deeaf653df31d87b1a8bb08e1c998d864b4c1afcef5324`.

Independent GPT-6.1 Sol review concluded **“No blocking findings.”** on `65ba8bd80b16622f7b78e93a2469ce963863ca39`, after auditing all mutation evidence, source and final test hashes. It independently ran the earlier focused suite (`80 pass / 0 fail`) and type checks (exit 0). The first evidence repair cycle resolved masked assertions; no production blocker was found. Final publication requires the separate actual Sonnet review and SHA-pinned verdict; that verdict is the authoritative final-tip review record.

## Limits, manual verification and rollback

No installed-app or live production data verification was performed. The replay has only 20 synthetic cases and explicitly adds four misses. Retained provenance cannot independently prove discarded inputs. Storage limits are guards, not measured memory budgets. The previously published head `14e0fdf2f6b6b5fffc013d8a6f3196c653f669ca` passed all 17 latest hosted workflows. Reconciled heads require their own fresh hosted checks before merge.

Manual verification after separately authorized delivery: inspect an unsupported news burst and a supported multi-source protest; confirm neutral versus supported labels and details; revise same-identity evidence; restart and inspect migration/history/dismissals; confirm authoritative warnings and Ghost Mode behavior. Do not perform these steps against production until authorized.

Rollback restores the preceding application code reading untouched v2 history. Later v3-only history remains preserved but is unavailable to older readers. No production storage was modified in this work.

## Proposed commit and draft PR description

Commit: `Require supporting topics before news becomes a hazard claim`.

Draft title: `ACC-510: require topic evidence for news-derived situations`.

Draft description: Generic news spikes previously became civil-unrest claims regardless of topic. Require complete supporting article agreement and source diversity, show unsupported situations as Topic unconfirmed, and prevent unsupported forecast criteria through the connected analyst path. Preserve legacy history through versioned storage. Synthetic replay changes false positives from 13 to 0 and misses from 0 to 4; all added misses are explicit. Validation: 79 selected suites, final 85 focused tests, validation gates, 89 fresh mutation kills and independent review. Installation, tags, releases, build dispatch and deployment remain paused.

## November 7 main reconciliation

Rebased onto `8bc006af2f80fdebb6398917c60b39d9797980b4` after UX-035 landed. The sole conflict was the additive test mapping: both UX-035 and ACC-510 entries were retained. ACC-510 production and test bytes are unchanged from the previously reviewed `14e0fdf2f6b6b5fffc013d8a6f3196c653f669ca`; historical mutation evidence therefore remains applicable and is not claimed as a new execution. The obsolete verdict-only commit was dropped for a new exact-head review.

On reconciliation tree `d747aa1c9d00f4660e325ea0817b195da2288cb9`, using Node 22:

```sh
bash scripts/agentic-validate.sh --tests 'test:acc510 test:acc509 test:intelligence test:roadmap-controller test:workflow-security test:panel-presentation'
```

Actual respective output:

```text
# pass 85
# fail 0
# pass 126
# fail 0
# pass 589
# fail 0
# pass 126
# fail 0
# pass 61
# fail 0
# pass 41
# fail 0
Agentic validation gate passed.
```

All six suites passed (1,028 tests), plus the unchanged lockfile, strict lint, application/API typecheck, secret scan, documentation/roadmap and production-build gates. The remaining changes after that run are this status/evidence update and removal of the stale verdict; no production/test/gate inputs changed. The full main-owned targeted selector is recorded separately after it completes. Native installation acceptance and production-accuracy measurement remain open.

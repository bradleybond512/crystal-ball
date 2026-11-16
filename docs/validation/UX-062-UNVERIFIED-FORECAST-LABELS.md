# UX-062 — Unverified labels for unmatched estimates

The approved bounded slice is implemented locally. Draft [#1886](https://github.com/bradleybond512/crystal-ball/pull/1886) still contains the documentation claim until a separate code-push approval. **Full UX-062 remains open:** exact matched baseline beats/trails, current comparator probability and freshness behavior are not implemented by this slice. Merging, auto-merge, releases, build dispatch, deployment and installation remain paused.

## User-visible behavior and boundaries

Raw HUD confidence, adjusted forecast bars, expanded Superforecast headlines and SituationPanel scenario probabilities now show **Unverified**. Native disclosures provide scoped explanations with real keyboard activation. Command Center explicitly identifies its pooled historical calibration summary as an unverified baseline comparison. SituationDossier's categorical confidence remains unchanged.

This communicates absent matching evidence, not proof that an estimate is wrong. Forecast values, existing formatting, percentage bar widths, provenance, warnings, urgency and actions are preserved. No paired score, freshness TTL, emission identifier, ledger/schema, model, provider, notification policy, dependency or persistence behavior changes. Unrelated favorable, unfavorable or old historical assessments cannot promote the static fallback.

Production changes are limited to `AnalystHUD.ts`, `SituationPanel.ts`, `CommandCenterPanel.ts`, `main.css` and `panels.css`. HUD's new summaries are narrowly excluded from unrelated projection/ensemble shortcuts and included in its focus trap; existing Escape/Tab behavior remains. Styling gives the labels neutral contrast and wrapping. Existing provenance formatting stays unchanged. Cost is bounded DOM markup per rendered item; no additional data read, replay, bootstrap, subscription, timer or request was introduced.

The fresh connected roadmap snapshot selected UX-062 [S] with 81 references, 87 total PRs and no blockers. The branch was rebased to canonical `4432188fedbaba28938608cc07da6a25d11ca0c9` before its first commit. Production/tests froze at `99260927fa61c1d5d8843949d5f196596c17f295`; test-only `e95f91cb88dabfa811a6d7a17b8b23c68ec58f0c` changes an equivalent null predicate to a boolean diagnostic so a failed escaping assertion cannot serialize an enormous DOM tree. No assertion was weakened and no production repair was needed.

## Actual validation

Initial focused test-first command, `node --test tests/ux062-forecast-baseline-labels.test.mjs`:

```text
# pass 3
# fail 8
```

After implementation, `npm run test:ux062`:

```text
# pass 11
# fail 0
```

The same 11 tests pass after the equivalent test diagnostic change. The suite uses actual production modules/rendering methods, real existing formatters/view builders and bounded platform/store fixtures. It also checks scenario interaction isolation, preserved values/escaping, absent cards/forecasts and unchanged categorical dossier confidence. These are fallback and preservation tests, not the full task's beats/trails/stale acceptance.

`bash scripts/agentic-validate.sh --tests 'test:ux062 test:intelligence test:insights'` ran on the frozen implementation. Its actual respective test summaries were:

```text
# pass 11
# fail 0
# pass 597
# fail 0
# pass 133
# fail 0
Agentic validation gate passed.
```

The gate includes strict lint, all type checks, secret scans, docs and build. Direct owned-file ESLint, focused-test ESLint and `npm run typecheck:all` exited 0. The trusted canonical-main selector, `node <evidence-directory>/trusted-ci.mjs --ci`, ran on the clean frozen source/tests:

```text
[targeted-tests] 59 script(s) passed.
```

`UX062-SELECTED-CI.json` pins the source/test revision, trusted selector and log hashes. This 59-suite result predates only the equivalent test diagnostic and later documentation. It is not relabeled as a full execution on the final documentation/verdict tip. The affected post-diagnostic command, `bash scripts/agentic-validate.sh --tests 'test:ux062'`, exited 0 on `e95f91cb88dabfa811a6d7a17b8b23c68ec58f0c`, with `# pass 11`, `# fail 0` and `Agentic validation gate passed.`

Final documentation checks: `npm run docs:check` reported `[docs:check] Documentation appears fresh.`; `npm run secrets:scan` reported `Secret scan passed for 6120 file(s).`; `npm run test:roadmap-controller` reported `# pass 126` / `# fail 0`. All exited 0.

Raw evidence directory: `~/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/ux062/`, including `unit-red.log`, `unit-green.log`, `gate.log`, `selected-ci.log`, `diagnostic-focused.log` and `diagnostic-gate.log`.

## Browser evidence

`UX062-BROWSER.json` records actual Chromium 147.0.7727.15 with Node 22.23.1 and source hashes matching the production freeze. Nineteen evidence groups passed: native Enter/Space opening and closing all three HUD/two scenario disclosures, Tab/reverse-Tab/focus wrapping, Escape and focus restoration, accessible explanation text, preserved numeric strings/bar widths/provenance/warnings/actions, and existing action dispatch exactly once. Page errors and forbidden network attempts were empty.

New labels/explanations wrap at 1280, 640 and 375 pixels; measured minimum new-text contrast is 10.98:1. The fixture bundles actual production components/formatters and the real stylesheet, with explicit service/platform stubs and no full application startup. Screenshots were visually inspected. Reproduction commands, fixture boundaries and screenshots are retained in `ux062/browser/COMMANDS.md` and that directory's harness/artifacts.

At 375 pixels the existing action row overflows. `UX062-NARROW-BASELINE.json` compares actual baseline/current source and identical fixtures: both card widths are 343 client/415 scroll pixels and both action rows are 276 client/380 scroll pixels; every action button's horizontal position/width is identical. This slice did not introduce that clipping. New labels fit; no full-app narrow-layout acceptance is claimed.

## Mutation evidence and review

[The self-contained mutation certificate](UX062-MUTATIONS.json) records **29 valid detecting proofs**, covering all 11 tests. Each includes the mutated file, confirmed-applied diff, actual failing assertion/counts, original/restored SHA-256 and clean restoration. Twenty-eight proofs ran on `99260927fa61c1d5d8843949d5f196596c17f295`; the bounded escaping retry ran on `e95f91cb88dabfa811a6d7a17b8b23c68ec58f0c`. Production files are identical between those revisions.

Representative actual results: removing the raw HUD label changes `11 pass / 0 fail` to `8 pass / 3 fail`; removing scenario escaping changes `11 pass / 0 fail` to `10 pass / 1 fail` with `untrusted markup remains text`, `false !== true`, then restores `11 pass / 0 fail`. The scenario source checksum restores to `11bb02d94a835d5bd7c92664685a396adc8e7e6f03208960639cc2bce39be9b8`. Negative missing/collapsed forecast and empty/pending history probes each produce `10 pass / 1 fail`, as do scenario collapse/dismiss isolation probes. The certificate contains the complete per-behavior evidence, not only these examples.

The first escaping probe was interrupted while serializing an enormous DOM assertion diagnostic and is **not credited**. Its equivalent Boolean diagnostic enabled the successful bounded retry above. An ambiguous-width mutation anchor stopped before application and is also uncredited; the refined applied probe is recorded separately. No surviving mutant is presented as a pass.

Independent Sol `gpt-6.1-sol` at medium effort found zero blocking findings on `e95f91cb88dabfa811a6d7a17b8b23c68ec58f0c`, independently reran `ℹ pass 11` / `ℹ fail 0`, and audited the browser, gate, selected-suite and mutation evidence. Missing negative-path mutation evidence from the initial audit was supplied; no production repair was necessary. Final documentation review and the required exact-tip Sonnet verdict remain pending at this evidence checkpoint and must be recorded separately in the branch review artifacts before publication approval is requested. Neither authorizes publication or delivery.

## Remaining acceptance and rollback

Complete UX-062 only after separately approved exact forecast identity/evidence alignment and freshness policy allow meaningful matched-cohort beats/trails labels and the actual paired comparator on supported surfaces. Do not substitute pooled history, a champion designation or an unrelated model/horizon. Do not mark this task DONE/REJECTED or silently skip remaining S-priority work.

After separately authorized delivery, verify disclosures, warning/action preservation and screen-reader speech in the installed app and full production layout. Current evidence is isolated Chromium/DOM fixtures; no native runtime, VoiceOver, live production accuracy or live-provider result is claimed. Existing 375-pixel action-row clipping remains outside this slice.

Rollback reverts presentation/test changes. No forecast record, scoring state, storage or model rollback/migration is needed.

Proposed implementation commit: `Clarify unmatched forecasts without changing their estimates`.

Draft PR description: Add visible Unverified labels and accessible explanations to unmatched estimates, plus an explicitly scoped historical calibration note. Preserve probabilities, warnings and actions. The bounded slice passed the intelligence/insights validation gate, 59 selected suites and isolated Chromium checks. Exact matched baseline comparison and freshness work remain open; code publication requires separate approval and all merge/delivery holds remain.

## QA/QC report

Risk tier: High (forecast-adjacent presentation; no scoring changes).

- Scope: the approved bounded Unverified-labeling slice only.
- Checks passed: focused tests, 59 selected suites, intelligence/insights gate, affected final gate, strict lint, all type checks, secret scans, build, 29 detecting mutations and isolated Chromium checks.
- Checks not run: installed native/VoiceOver and full-app acceptance, hosted implementation CI, full matched-baseline acceptance. Delivery is paused; code is local and baseline evidence alignment is outside this slice.
- Findings: no confirmed blocking production defect; final cross-agent verdict is separate.
- Residual risks: existing narrow action clipping; native speech/layout unverified; full baseline comparisons remain open.
- Release stance: local bounded implementation qualified for final review, not authorized for delivery.

# UX-063 — Retain the existing Sonnet review path

Decision dated 2026-11-08; local validation and independent decision review passed. Approved design: [review-path decision](../plans/2026-11-08-ux063-review-path-decision.md). Claim: draft [#1890](https://github.com/bradleybond512/crystal-ball/pull/1890), `4709daa157b437d9e70ac9a3f0d7755835a70269`; evaluated canonical base: `3a9786c45daa9fcf643331ac004ae62e97793f7a`.

Retain local Sonnet review followed by the existing SHA-pinned verdict gate. Three genuine successful review results and their successful hosted gates support keeping this working path. They do not demonstrate an incremental reliability benefit from adding a CI Sonnet runner. UX-063 permits completion through a reviewed retained-path decision; no runner is implemented by this decision.

## Observed positive evidence

The [compact certificate](UX063-REVIEW-EVIDENCE.json) contains exact source/head SHAs, selected result metadata and SHA-256 hashes of local raw results, checkpoints, hosted snapshots and verdict blobs. Raw transcripts stay local. Each result reports `subtype: success`, `is_error: false`, model `claude-sonnet-4-6`; each recorded verdict approves with zero blocking findings. Hosted gate metadata was also read directly with `gh run view <run-id> --repo bradleybond512/crystal-ball --json headSha,conclusion,status,url,workflowName`; all three returned `status: completed`, `conclusion: success` and the exact heads below.

| Sample | Reviewed source → verdict head | Reported elapsed / API time | Turns | Reported USD estimate | Hosted review gate |
| --- | --- | --- | --- | --- | --- |
| ACC-510, [#1858](https://github.com/bradleybond512/crystal-ball/pull/1858) | `caa41bd88cfe00359005e432946f52f98a67d9d5` → `14e0fdf2f6b6b5fffc013d8a6f3196c653f669ca` | 300.201 / 296.506 seconds | 56 | 1.4118435 | [success](https://github.com/bradleybond512/crystal-ball/actions/runs/42340093779) |
| UX-035, [#1859](https://github.com/bradleybond512/crystal-ball/pull/1859) | `24901ebc8f33c8c5c66dfcfc5c6bf9aecf5c2e56` → `84b401c8615abf99aa454da6b26db2473bf50fa7` | 183.580 / 181.744 seconds | 30 | 0.9134199 | [success](https://github.com/bradleybond512/crystal-ball/actions/runs/42342045708) |
| UX-062, [#1886](https://github.com/bradleybond512/crystal-ball/pull/1886) | `31979f2a157dc58c84746bacd0c0e35ebea2d654` → `cba94b041e559351823864d2080d4f91240c6392` | 183.725 / 175.877 seconds | 32 | 1.0199028 | [success](https://github.com/bradleybond512/crystal-ball/actions/runs/42527940922) |

The first independent audit found that the direct hosted-run responses had not been retained. Fresh read-only rechecks now preserve the command, complete stdout, exit status, raw-file path and hash in each certificate sample. Their actual output, in sample order, was:

```json
{"conclusion":"success","headSha":"14e0fdf2f6b6b5fffc013d8a6f3196c653f669ca","status":"completed","url":"https://github.com/bradleybond512/crystal-ball/actions/runs/42340093779","workflowName":"Cross-agent review gate"}
{"conclusion":"success","headSha":"84b401c8615abf99aa454da6b26db2473bf50fa7","status":"completed","url":"https://github.com/bradleybond512/crystal-ball/actions/runs/42342045708","workflowName":"Cross-agent review gate"}
{"conclusion":"success","headSha":"cba94b041e559351823864d2080d4f91240c6392","status":"completed","url":"https://github.com/bradleybond512/crystal-ball/actions/runs/42527940922","workflowName":"Cross-agent review gate"}
```

ACC-510's result identifies production commit `13b4312beb7ec9e2e1465fe3e0c27db9c74db911`, test supplement `65ba8bd80b16622f7b78e93a2469ce963863ca39` and the docs-only review HEAD `caa41bd88cfe00359005e432946f52f98a67d9d5`. Its verdict pins that final HEAD. For every sample, the verdict head's parent and recorded `reviewedSha` agree, and the verdict commit changes only its review JSON.

These are three selected successful examples, not a representative availability sample, success-rate estimate, latency guarantee or comparison with CI Sonnet. The USD fields are tool-reported estimates, not invoices or enforced spending limits. Hosted gate success here verifies the recorded-verdict route; it is not evidence that Sonnet ran in CI. UX-062's full matched-baseline comparison remains open.

## Existing controls and their limits

Source links below pin the evaluated base, rather than a moving branch.

| Control | Source and exercised evidence | Limit |
| --- | --- | --- |
| Exact parent binding and stale approval rejection | [verdict validation](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/scripts/verify-review-verdict.mjs#L86); [fixture recording and later source change](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/tests/agentic-pipeline.test.mjs#L168) | Binds the attested approval to a source SHA; cannot prove that the reviewer actually examined it. |
| Reviewer/model policy, invalid verdict fields and smuggled-change rejection | [verifier policy and attestation limit](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/scripts/verify-review-verdict.mjs#L22); [negative verdict fixtures](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/tests/agentic-pipeline.test.mjs#L76); [model fixtures](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/tests/agentic-pipeline.test.mjs#L205) | Identity/model remain recorder attestations. [Sonnet medium](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/.claude/agents/cross-agent-reviewer.md#L4) is operating policy; effort is not a verdict condition. |
| Existing optional CI Codex routing and installation | [workflow](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/.github/workflows/cross-agent-review.yml#L26); [routing/installation fixtures](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/tests/agentic-pipeline.test.mjs#L368) | Same-repository CI Codex routing, trusted-main scripts, locked installation and minimal repository permissions are reference controls, not a Sonnet implementation. `codex/*`, fork and off-mode fixtures use the verdict path. |
| Missing trusted tooling, installation/runtime failure and absent API credential | [failure fixtures](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/tests/agentic-pipeline.test.mjs#L413) | Local simulated failures do not establish live Sonnet service reliability, fork credential isolation or denied-transmission handling. |

The CI Codex workflow has a 20-minute job timeout, not a dollar, token or turn cap. Its `env -i` sanitizes installation; the [reviewer spawn](https://github.com/bradleybond512/crystal-ball/blob/3a9786c45daa9fcf643331ac004ae62e97793f7a/scripts/ci-codex-review.mjs#L102) omits an explicit `env` and inherits its parent environment. Do not infer reviewer-process credential isolation from installer sanitization. The workflow also retains an explicit protocol-rollout fallback if the trusted-main verifier is absent; this report does not claim universal fail-closed behavior beyond the exercised cases.

There is no live CI Sonnet positive run, denied-transmission negative run or fork-isolation execution in this evidence set. UX-062 reports two denied Bash inspection calls; these are tool permission denials, not review transmission denials. The roadmap's historical October transmission denial is context, not newly reproduced evidence. Any later denied transmission must stop; prior success does not authorize retries through another route to evade that denial.

## Reconsideration criteria

Reopen the CI alternative only for a documented operational need and a separately approved design. Require explicit spending, turn/token and wall-clock bounds; trusted-base execution; reviewer credential isolation; fork exclusion; exact-source binding; cancellation; and denied-transmission handling. Acceptance would need genuine positive execution and adversarial negative evidence, not only mocked fixtures. Any new credential, billing arrangement or persistent permission requires its applicable authorization. No new paid calls were made to enlarge this evaluation sample; required final review is separate.

## QA/QC checkpoint

Risk tier: High for the evaluated trust and credential boundaries. The approved implementation is documentation only: this report, its evidence certificate, design/claim documentation and UX-063 tracker references. No executable, interface, dependency, schema, storage, permission or application behavior changes; no runtime performance impact or migration. Main risks are overstated evidence, private artifact leakage and accidental delivery. Only selected metadata and hashes are copied into the certificate.

Existing controls ran before this report was finalized. Actual saved output:

```text
node --test tests/agentic-pipeline.test.mjs  (discovery baseline, Node 22)
# tests 85
# pass 85
# fail 0

npm run test:agentic-pipeline  (approved local work)
# tests 85
# pass 85
# fail 0

npm run test:roadmap-controller  (approved local work)
# tests 126
# pass 126
# fail 0
```

Log hashes are in the certificate. These checks exercise existing controls, not newly implemented behavior. No new behavioral tests or mutation proofs apply to this documentation-only decision.

The affected gate, `bash scripts/agentic-validate.sh --tests 'test:agentic-pipeline test:roadmap-controller'`, exited 0 on the unchanged executable source at the evaluated base, while this report was being finalized. Its two suites again reported `# pass 85` / `# fail 0` and `# pass 126` / `# fail 0`, followed by:

```text
Agentic validation gate passed.
Tests run: test:agentic-pipeline test:roadmap-controller
```

The gate also passed strict lint, all TypeScript configurations, secret scanning, documentation checks and build. After both report files were written, `npm run docs:check` reported `[docs:check] Documentation appears fresh.` and `npm run secrets:scan` reported `Secret scan passed for 6117 file(s).`, both exit 0. Certificate JSON parsing and `git diff --check` passed. This is existing-control evidence on unchanged executable code; later documentation/verdict commits are not relabeled as full gate executions.

Independent Sol review (`gpt-6.1-sol`, medium) found zero blocking findings after one evidence-only repair: retain and quote the direct hosted-run responses. It inspected the complete documentation scope, source controls, tests, raw review results, verdict ancestry and validation logs. It did not rerun tests or make network calls. The approved reviewed-decision exit completes UX-063 locally; the preceding sample reviews do not themselves approve UX-063. Required exact-source Sonnet review remains pending at this evidence checkpoint and must be recorded separately before publication approval is requested. Publication and delivery holds remain.

Residual risks: local-session availability, attested reviewer identity/model and policy-only effort selection remain. CI Sonnet's incremental reliability, spending bounds and denial/fork behavior remain unmeasured. No installed-app or native acceptance is claimed. Manual verification: compare certificate hashes with the retained local artifacts; inspect each verdict's parent and changed file; inspect each linked hosted gate's `headSha`; confirm the final diff stays within approved documentation and preserves UX-062's open baseline scope.

Release stance: completion publication, merge, auto-merge, releases, build dispatch, deployment and installation remain paused. Do not run PR closeout while those holds apply. Rollback is reverting or superseding the decision and tracker documentation; no production rollback or data repair is needed.

Proposed commit: `docs: retain the evidenced Sonnet review path`.

Draft PR description: Retain the existing local Sonnet and SHA-pinned verdict path because three genuine reviews and their hosted gates support continued use, while an incremental benefit from CI Sonnet remains unproven. Record exact-source evidence, fixture limits and reconsideration criteria. Documentation only; UX-062 baseline work and all delivery holds remain open. Local validation and independent decision review passed; required final Sonnet review remains separately pending at this checkpoint.

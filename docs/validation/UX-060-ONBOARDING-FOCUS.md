# UX-060 onboarding focus ownership

Risk tier: Medium / Standard UI behavior. PR #1735.

## Behavior and scope

First-run boots skip the proactive digest for that boot, without marking it shown or adding a resume queue. The existing completion-key semantics protect the asynchronous Welcome import gap; the current Welcome backdrop also protects scheduled work and asynchronous success/failure. Explicit digest requests remain available after onboarding closes.

DigestOverlay yields keys consumed by another handler or targeted/focused within another modal. Focus capture happens only when opening a hidden digest. Visible loading, empty, degraded, error and card refreshes preserve focus. Background hide/destroy cannot restore over a foreground modal. Normal digest focus restoration, keyboard wrapping, Escape, dismissal cancellation and teardown remain covered.

Production scope: `src/components/DigestOverlay.ts` and the digest setup/request block in `src/app/panel-layout.ts`. No styling, persistence-schema, provider, native, notification or inference change. The UX026 runtime fixture now explicitly represents a completed-onboarding user; its assertions are unchanged. The Home browser acceptance assertions are unchanged, including 800×600 keyboard interaction.

## Executed validation

Evidence directory: `~/.crystalball-diagnostics/ux060-20260922/`.

Test-first regression (`test-first-red.log`, before production edits):

```text
# tests 16
# pass 1
# fail 15
```

Focused component and lifecycle suite (`npm run test:ux060`, `targeted.log`):

```text
# tests 36
# pass 36
# fail 0
```

Existing digest regression (`npm run test:ux026`, `ux026.log`):

```text
# tests 115
# pass 115
# fail 0
```

Full Home browser suite (`E2E_PORT=4363 VITE_VARIANT=full npm run test:ux060-browser`, `browser-diagnostic.log`):

```text
6 passed (1.6m)
```

The first two attempts reported 5 passed / 1 failed: the first-run Welcome case passed, but the earthquakes readiness case timed out at line 137. A standalone state probe observed a visible page, an unpaused 10-second refresh loop, fresh three-item source evidence and a useful card by 11 seconds. The final full-suite run passed without changing production code, assertions or timeouts after concurrent heavy build/lint work settled. Resource contention is a plausible explanation, not a proven root cause; retain the initial logs for any recurrence.

The final run added only a temporary failure-only diagnostic hook. No test failed, so its state collection did not execute. The original browser file was restored and verified SHA-256 `af798d7bf459ef82d5516cec690ca4cdf0712f686b778cc5349ed4339879a930` (`browser-diagnostic-restoration.log`). No browser test edit is shipped. The initial gate including the full browser script stopped at the earlier readiness failure; it is not reported as passed.

`npm run typecheck:all` completed successfully (frontend and API configs), including again in the commit hook. `npm run lint` reported:

```text
[lint:baseline] OK — 1183 existing findings, no increases. Debt dropped by 68; run npm run lint:baseline:update to ratchet it down.
```

`bash scripts/agentic-validate.sh --tests "test:ux060 test:ux026"` completed with:

```text
Agentic validation gate passed.
Tests run: test:ux060 test:ux026
```

This includes both test scripts, lockfile verification, strict lint, both type configurations, secret scanning, cross-agent configuration check, docs/roadmap checks and build. It does not substitute for the separately reported browser results or reviewer verdict.

`npm run bundle:check` reported main gzip `445.6 KB` and:

```text
✓ All bundle-size policies satisfied.
```

Independent review and SHA-pinned cross-agent review remain pending with the parent agent; this document does not attest either.

## Clean-tree mutation evidence

Snapshot: `fe41bd9a66ccc3cdda06a1f84a5bef78c4af99d6`. Each mutation began from an empty `git status --short`, changed exactly one guard, saved and inspected the applied `git diff`, then executed `npm run test:ux060`. Every mutation restored the original bytes, verified SHA-256, and verified the empty tree. Final restored run: `# pass 36` / `# fail 0`.

Checksums (before and after every relevant mutation):

- DigestOverlay.ts: `0d00ef2e838acdb06a270068d28dfc7d66694c4516d53e821f2b5de66c1ee407`.
- panel-layout.ts: `0b4dae5c7d928948580c8a1835527604f50147c1cb921e031a9b4eec228d6cdc`.

Actual results from `mutation-results.json`; corresponding `mutation-<name>.diff` and `.log` files preserve each applied change and failed assertion:

| Removed guard | Green | Mutation red |
|---|---|---|
| consumed-key | 36 pass / 0 fail | 35 pass / 1 fail |
| modal-target | 36 pass / 0 fail | 35 pass / 1 fail |
| modal-active-focus | 36 pass / 0 fail | 35 pass / 1 fail |
| refresh-focus | 36 pass / 0 fail | 35 pass / 1 fail |
| restore-focus | 36 pass / 0 fail | 34 pass / 2 fail |
| opening-predicate | 36 pass / 0 fail | 35 pass / 1 fail |
| first-run-schedule | 36 pass / 0 fail | 34 pass / 2 fail |
| scheduled-and-explicit-request | 36 pass / 0 fail | 33 pass / 3 fail |
| async-success | 36 pass / 0 fail | 34 pass / 2 fail |
| async-failure | 36 pass / 0 fail | 34 pass / 2 fail |

## Manual verification and rollback

Use an isolated empty browser profile. Tab internally and across both ends of Welcome; Escape completes only Welcome. Complete onboarding, open the brief explicitly, then verify Escape restores its opener. At 800×600 the existing Home focus-host interaction must remain operable. Native macOS acceptance was not run and is not implied by browser evidence.

Rollback is a reviewed revert of these UI guards and tests. No migration or operator data recovery is required. Skipping the proactive brief on the onboarding boot is intentional; users can request it once onboarding closes.

## Draft PR summary

Prevent the since-last-looked digest from taking keyboard focus during Welcome, including delayed successful and failed requests. Skip proactive generation on first-run boots and preserve explicit post-onboarding opening, modal key ownership, normal dismissal and opener restoration. Validation: focused 36/0, existing digest 115/0, Home browser 6/0, unit/domain named gate, both types, lint, bundle and ten applied guard mutations. Earlier intermittent Home readiness timeouts remain documented; independent and cross-agent reviews are separate delivery gates.

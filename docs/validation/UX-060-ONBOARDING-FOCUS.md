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

First Home browser attempt: the repaired first-run case passed. The complete run reported `1 failed`, `5 passed (1.9m)`; its second case timed out expecting the earthquakes card to become useful. A stable-tree repeat in the named gate reproduced that separate readiness failure at `e2e/home-shell-boot.spec.ts:137`; the Welcome case passed again (53.5s). The parent agent has been notified for separate triage. This is not recorded as a full-browser or full-gate pass.

Type checking, lint, gate and clean-tree mutation proof will be recorded after their actual completion. Independent review and SHA-pinned cross-agent review remain pending with the parent agent; this document does not attest either.

## Manual verification and rollback

Use an isolated empty browser profile. Tab internally and across both ends of Welcome; Escape completes only Welcome. Complete onboarding, open the brief explicitly, then verify Escape restores its opener. At 800×600 the existing Home focus-host interaction must remain operable. Native macOS acceptance was not run and is not implied by browser evidence.

Rollback is a reviewed revert of these UI guards and tests. No migration or operator data recovery is required. Skipping the proactive brief on the onboarding boot is intentional; users can request it once onboarding closes.

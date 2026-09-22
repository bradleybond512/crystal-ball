# UX-060 onboarding focus ownership

## Brief

Objective: keep first-run Welcome keyboard focus within its dialog when the proactive since-last-looked digest is eligible or finishes asynchronously. User value: reliable setup with keyboard and assistive technology; restore the shared browser acceptance test blocking PR integration.

Risk: Standard UI behavior. No alert dispatch, inference, native permission, provider or persistence schema policy changes. All site variants retain their existing welcome behavior.

Evidence: current-main Home browser harness fails at the forward Tab wrap in e2e/home-shell-boot.spec.ts:29. Repository analyst reproduced Welcome trapping Tab, followed by DigestOverlay's document handler stealing focus. A defaultPrevented guard alone does not protect internal Tab navigation or asynchronous digest opening.

Acceptance: keyboard forward/backward traversal and Escape remain owned by Welcome; proactive digest does not appear/focus while onboarding is active, including async success/failure completion; user-invoked digest remains available after onboarding. Existing isolated dialog tests and complete Home boot test pass. Each new behavior includes clean-tree applied mutation proof.

Constraints: preserve actual tests/assertions, first-run data semantics, explicit user actions, normal digest functionality and focus restoration. No generic modal-framework rewrite, no longer test timeout or disabled test.

Unknowns: exact lifecycle signal for onboarding completion and async digest race boundary; architect must trace before production edits.

## Owners and sequence

Repository discovery: repository_analyst (completed read-only reproduction).
Design: architect (in progress).
Implementation: ui_map_engineer after bounded design, limited to Welcome/Digest/panel-layout interaction and regression tests.
Validation: focused coexistence tests, full first-run browser harness, typecheck and named agentic gate; independent reviewer and Claude exact-tip verdict before closeout.

No installation or real user profile manipulation. Rollback is a reviewed code revert; no data migration.

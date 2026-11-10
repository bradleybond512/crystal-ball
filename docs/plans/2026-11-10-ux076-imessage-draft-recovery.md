# UX-076: Preserve failed iMessage setup drafts

## Objective and value

Prevent failed Save attempts from erasing the entered iMessage recipient so the user can correct and explicitly retry it.

## Classification and scope

Standard UI error recovery. Production scope is src/components/UnifiedSettings.ts, with component behavior tests. Native validation, IPC, confirmation, storage, and sending policies remain unchanged.

## Discovery and design

Repository analysis at main 5955a8d9860ad2f616008a3d738d423fbb8e5415 confirms finishImessage replaces the draft with native saved state even after invalid_recipient, persistence_failed, unavailable, or busy. Native validation requires an exact compact international phone number or email; a formatting failure therefore erases the proposal.

Capture the submitted Save proposal. Retain it only for those four recoverable errors after the existing generation guard. Always refresh the authoritative saved state. Keep cancellation, stale consent, disable, Test, successful Save, and close/reopen behavior unchanged. Explain compact phone formatting and identify an unconfirmed Save without contradicting refreshed native authority. No persistent draft storage or automatic normalization.

## Acceptance criteria

- Initial and replacement Save failures preserve the exact recipient and enabled proposal for correction.
- Saved destination remains authoritative; unsaved drafts cannot enable Test or sending.
- Successful explicit Save adopts native state and survives close/reopen in the isolated contract test.
- Cancel, disable, stale completion, repeated attempts, and close/reopen preserve their current safety boundaries.
- No real messages, real recipient data, installed settings, native IPC, dependencies, or release settings are changed by this task.

## Bounded plan

1. UI specialist: write failing component tests, implement recovery and explanatory copy in the two scoped files.
2. Integration owner: run test:imessage, agentic validation, clean-tree mutation proof, and update the UX tracker and evidence.
3. Independent Claude Sonnet review: inspect exact final source tip; record the SHA-pinned verdict only after zero blockers. At most two repair cycles.
4. Publish a draft and use repository closeout only after required checks and authorized publication. Preserve all release pauses.

## Unknowns, risk, and rollback

The user's exact trigger is not yet verified; this repairs the demonstrated input-loss path, not every possible native persistence fault. Risk is incorrectly treating a draft as saved; tests cover authority and races. Rollback reverts UI/tests only, with no migration.

## Local validation evidence (2026-11-10)

Node 22.23.1; isolated synthetic recipients only. No real send or installed settings write occurred.

- Original component regression: `# tests 33`, `# pass 22`, `# fail 11`.
- Independent Sonnet review found a retry edge case: native 30-second prompt cooldown returns busy, which originally discarded the draft. Repair cycle 1 adds busy retention and truthful uncertain-save feedback. Its red was `# tests 37`, `# pass 27`, `# fail 10`; green was `# tests 37`, `# pass 37`, `# fail 0`.
- Updated `npm run test:imessage`: native source-boundary tests `# pass 6`, `# fail 0`; TypeScript suites `# pass 137`, `# fail 0`.
- The first candidate passed `bash scripts/agentic-validate.sh --tests "test:imessage"`, reporting `Agentic validation gate passed.` The final corrected candidate must pass the same gate and fresh Sonnet review before delivery; exact-tip results are recorded in the PR. Existing dynamic-import build advisories remain; no check was weakened.
- Four clean-commit mutations of `src/components/UnifiedSettings.ts` were actually applied and their diffs inspected:
  - Remove retained-draft selection: `# pass 25`, `# fail 12`.
  - Remove busy from retention: `# pass 35`, `# fail 2` (failure then busy retry tests).
  - Restore inaccurate changes-not-saved feedback: `# pass 27`, `# fail 10` (including matching native authority).
  - Remove accessible format guidance: `# pass 36`, `# fail 1`.
- Each mutation restored exact source SHA-256 `8ea05400c6c8bd33414408f05fea234ce784e8fc12a3fced83453dc87835b7f1` and empty Git status. Baseline was `# pass 37`, `# fail 0`.

Independent Sonnet review and hosted checks govern delivery. Packaged UI acceptance, native persistence verification and message delivery are not claimed by these isolated UI tests. The user's precise failure trigger remains unconfirmed. Release pauses remain unchanged.

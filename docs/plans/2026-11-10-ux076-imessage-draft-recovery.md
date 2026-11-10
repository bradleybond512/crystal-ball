# UX-076: Preserve failed iMessage setup drafts

## Objective and value

Prevent failed Save attempts from erasing the entered iMessage recipient so the user can correct and explicitly retry it.

## Classification and scope

Standard UI error recovery. Production scope is src/components/UnifiedSettings.ts, with component behavior tests. Native validation, IPC, confirmation, storage, and sending policies remain unchanged.

## Discovery and design

Repository analysis at main 5955a8d9860ad2f616008a3d738d423fbb8e5415 confirms finishImessage replaces the draft with native saved state even after invalid_recipient, persistence_failed, or unavailable. Native validation requires an exact compact international phone number or email; a formatting failure therefore erases the proposal.

Capture the submitted Save proposal. Retain it only for those three recoverable errors after the existing generation guard. Always refresh the authoritative saved state. Keep cancellation, stale consent, disable, Test, successful Save, and close/reopen behavior unchanged. Explain compact phone formatting and identify retained text as unsaved. No persistent draft storage or automatic normalization.

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

- Component suite before the fix: `# tests 33`, `# pass 22`, `# fail 11`.
- Restored final component suite: `# tests 33`, `# pass 33`, `# fail 0`.
- `npm run test:imessage`: native source-boundary tests `# pass 6`, `# fail 0`; TypeScript suites `# pass 133`, `# fail 0`.
- `bash scripts/agentic-validate.sh --tests "test:imessage"`: `Agentic validation gate passed.` Includes lockfile, strict lint, all typechecks, secret scan, cross-agent configuration, docs/roadmap checks and production build. Existing dynamic-import build advisories remain; no check was weakened.
- Clean-commit mutation of `src/components/UnifiedSettings.ts`: removing only retained-draft selection produced `# pass 23`, `# fail 10` (first failure: initial Save retains exact draft after invalid_recipient). Removing accessible formatting guidance produced `# pass 32`, `# fail 1` (recipient has accessible compact international phone or email guidance). Each applied diff was inspected, then exact source and clean Git status restored.
- Source SHA-256 before and after both mutations: `821ac8996eee5231320b945fb3351343790a3053704c2a5c8457adc780223636`.

Independent Sonnet review and hosted checks govern delivery. Packaged UI acceptance, native persistence verification and message delivery are not claimed by these isolated UI tests. The user's precise failure trigger remains unconfirmed. Release pauses remain unchanged.

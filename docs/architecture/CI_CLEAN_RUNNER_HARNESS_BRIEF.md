# Clean-Runner CI Harness Feature Brief

Status: discovery
Risk: standard
Affected surfaces: targeted test runner and browser accessibility harness

## Objective

Make the existing required checks produce the same result on a clean GitHub
runner as they do after a local full build. The native UX-010 contract must
prepare every ignored build resource that Tauri requires before invoking Cargo,
and the Home Shell browser assertion must distinguish an exact zero-item status
from multi-digit counts such as `10 items`.

## Acceptance criteria

- `tests/ux010-native-gate.test.mjs` succeeds from a clean checkout where the
  configured `dist` directory does not exist.
- The native gate still executes the checked-in XMPP bundle generator and the
  exact `current_location_contract` Cargo test.
- The ignored frontend fixture is created before Cargo and is removed only when
  the gate created it.
- The Home Shell browser test evaluates the zero-item all-clear disclaimer from
  the dedicated status element for the same readiness-source row.
- A `10 items` status cannot match the exact-zero predicate.
- Focused behavior tests fail when either clean-runner protection is removed.
- No production code, product behavior, roadmap status, dependency, Tauri
  capability, or network boundary changes.

## Constraints

- Preserve fail-closed CI behavior; missing prerequisites must not be hidden by
  skipping Cargo or weakening the browser assertion.
- Keep generated resources ignored and avoid leaving a dirty working tree.
- Do not depend on a prior `vite build`, local artifacts, runner ordering, or
  live-provider row counts.
- Keep the trusted-main targeted-test command expansion intact.
- Treat the two failures as CI harness defects only; UX-017 remains unchanged
  and keeps its existing review evidence until canonical main moves.

## Non-goals

- Changing the UX-010 native implementation or its nine Rust contract cases.
- Changing Home Shell readiness wording or source-health semantics.
- Making provider availability deterministic in Playwright.
- Modifying the usability roadmap tracker.
- Bypassing, retrying away, or suppressing a failed required check.

## Unknowns to resolve in discovery

- Whether an existing helper already provisions Tauri's ignored frontend
  resource for focused Cargo tests.
- The smallest valid frontend fixture accepted by `tauri::generate_context!()`.
- Whether the browser assertion can be made deterministic in the existing E2E
  file or needs a small pure helper with a focused unit test.
- Whether concurrent tests can observe or remove the generated fixture.

## Risks and mitigations

- **Hiding a real packaging failure:** only create the compile-time frontend
  resource; keep Cargo and all existing assertions unchanged.
- **Deleting user or build output:** record whether the gate created the
  fixture and remove only that owned artifact.
- **Multi-digit false positives:** match the dedicated source-status text with
  an anchored exact-zero predicate and cover both zero and ten deterministically.
- **Source-scoped test false confidence:** record observed-red mutation proofs
  for both behaviors and restore exact checksums afterward.

## Validation plan

- Run the focused deterministic regression tests first.
- Run the UX-010 native gate from a clean worktree without `dist`.
- Run the Home Shell browser-harness test.
- Run the selected data suite and the full agentic validation gate.
- Obtain independent review, then exact-tip Claude review and a SHA-pinned
  verdict before closeout.

## Rollback

Revert the harness changes and this brief. No stored data, production code,
configuration, or user state requires migration.

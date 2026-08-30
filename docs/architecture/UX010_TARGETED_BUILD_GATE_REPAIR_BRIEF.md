# UX-010 Targeted Build-Gate Repair Brief

Status: implemented; validation and review pending
Risk: standard CI trust-boundary repair
Blocked consumer: UX-011 PR #1688

## Objective

Restore the required targeted-test check for branches that select the merged
UX-010 suite while preserving its full-variant build and native Rust contract.

## Acceptance criteria

- Every stage of the canonical `test:ux010` command is directly spawnable by
  the trusted main copy of `scripts/targeted-tests.mjs`.
- Preserve the UX-010 JavaScript, TypeScript, full-variant build, resource
  generation, and Rust contract checks.
- Keep `RUNNER_ALLOWLIST` and `commandToStages` fail closed; do not allow npm,
  shells, arbitrary binaries, or PR-controlled replacement commands.
- Add behavior-focused regression coverage and a confirmed-red mutation proof.
- Pass the focused pipeline and UX-010 suites from a clean checkout.

## Constraints

- This prerequisite claims no UX roadmap task and does not change the UX-010
  or UX-011 production implementation.
- No workflow permissions, dependencies, secrets, branch protections, or
  required checks change.
- Do not remove or bypass the full build or native contract to obtain green.
- Keep the repair isolated from UX-011 PR #1688.

## Non-goals

- Redesigning the derived test index.
- Broadening trusted runner syntax.
- Reclassifying the required targeted-test check as optional.
- Changing app runtime behavior.

## Final design

- Keep `scripts/targeted-tests.mjs`, its runner allowlist, and its stage parser
  unchanged.
- Replace only the nested `npm run build:full` stage in `test:ux010` with the
  trusted Node test stage `node --test tests/ux010-build-gate.test.mjs`.
- In that wrapper, directly spawn the pinned local TypeScript and Vite entry
  points with the current Node executable, the repository root as the working
  directory, `VITE_VARIANT=full`, UTF-8 capture, a 10 MiB output ceiling, and a
  300-second timeout. Fail on spawn error, signal, or nonzero status and include
  captured output in every assertion.
- Retain the existing JavaScript/TypeScript behavior stages and the final native
  contract gate. The resulting canonical command has exactly four trusted
  direct-spawn stages and no npm, shell, compiler, bundler, or Cargo stage at
  the targeted runner boundary.

## Verification

- Reproduce the current `untrusted stage runner "npm"` failure.
- Prove the repaired canonical command decomposes entirely to trusted Node or
  tsx stages and still executes the full build contract.
- Run `test:agentic-pipeline`, the repaired UX-010 suite, strict lint, full type
  checks, the agentic validation gate, independent review, and the exact-tip
  Claude verdict workflow.

## Evidence

- TDD red: `node --test tests/agentic-pipeline.test.mjs` reported 44 pass / 2
  fail. The failures reproduced the rejected `npm` stage and the absent build
  wrapper.
- Focused pipeline regression: the same command reported 46 pass / 0 fail
  after implementation.
- Repaired UX-010 suite: pending a quiet validation slot; the first local
  wrapper run correctly failed closed when TypeScript exceeded its 300-second
  timeout while the workstation load average exceeded 130.
- Baseline checksums before mutation were
  `922713395b8d5b5e75ae8c063d68dfb8182cf9372e1110e7d6d4b509b3c8ab18`
  for `package.json`,
  `4d077e05cb962690a4691e9b5657e7c9fe97c0ea474754e7920b56e331b584cb`
  for `tests/ux010-build-gate.test.mjs`, and
  `2ac607b97f73a840a0d1c62c044fc4cf91f93cf7c366d46923804cc27cb32486`
  for `tests/agentic-pipeline.test.mjs`.
- Mutation 1 restored `npm run build:full` in the canonical UX-010 command.
  The confirmed diff produced 45 pass / 1 fail; the stage parser rejected
  the npm runner. Restoration reproduced the baseline checksum.
- Mutation 2 changed `VITE_VARIANT` from `full` to `tech`. The confirmed diff
  produced 45 pass / 1 fail; the full-variant contract assertion failed.
  Restoration reproduced the baseline checksum.
- Mutation 3 pointed the TypeScript stage at a nonexistent checked path. The
  confirmed diff made the wrapper report 0 pass / 1 fail with
  `MODULE_NOT_FOUND` and status 1. Restoration reproduced the baseline
  checksum, and `git status --short` was empty.
- Full validation and reviews: pending publication workflow.

# UX-010 Targeted Build-Gate Repair Brief

Status: revised implementation; mutation, validation, and review pending
Risk: standard CI trust-boundary repair
Blocked consumer: UX-011 PR #1688

## Objective

Restore the required targeted-test check for branches that select the merged
UX-010 suite while preserving its JavaScript, TypeScript, full-variant build,
resource-generation, and Rust contracts.

## Acceptance criteria

- Keep canonical `package.json` and `test:ux010` unchanged from main.
- Expand the exact trusted-main `npm run build:full` stage without spawning npm,
  a shell, a PATH-resolved compiler, or PR-controlled package-script logic.
- Pin expansion to the exact trusted-main `build:full` definition and fail
  closed on every missing, changed, or near-match definition or stage.
- Preserve the existing runner allowlist and generic Node/tsx stage behavior.
- Pass focused tests, mutation proofs, full validation, independent review, and
  exact-tip cross-agent review before publication.

## Constraints

- This prerequisite claims no UX roadmap task and changes no UX-010 or UX-011
  production implementation.
- No workflow permissions, dependencies, secrets, branch protections, required
  checks, test selection, or coverage baseline change.
- Keep the repair isolated from UX-011 PR #1688.

## Non-goals

- Broadening the trusted runner grammar to accept npm or shell commands.
- Creating a generic package-script resolver.
- Moving build semantics into a PR-controlled test or helper file.
- Removing the full build or native contract from UX-010.

## Rejected wrapper design

The first repair changed `test:ux010` to invoke a new
`tests/ux010-build-gate.test.mjs` wrapper. Independent review rejected that
design because the trusted-main command would authorize a helper whose contents
come from the pull-request checkout. A PR could replace that wrapper with an
allowlisted no-op while the main-owned stage parser continued to report a
trusted Node stage. The wrapper and package-script change are therefore removed,
and `package.json` is restored exactly to canonical main.

The earlier wrapper mutation evidence is invalid for this revision. It proved
properties of the deleted wrapper and altered package command, not the revised
trusted-main expansion. None of those results may be reused as evidence for the
new code tip.

## Final design

- Keep `RUNNER_ALLOWLIST`, `deriveScriptIndex`, and canonical `test:ux010`
  unchanged.
- Extend `commandToStages` with trusted-main scripts and inherited environment.
- Recognize only the trimmed stage `npm run build:full`.
- Permit that expansion only when `trustedScripts['build:full']` is exactly
  `cross-env-shell VITE_VARIANT=full "tsc && vite build"`.
- Translate the alias into two sequential direct Node executions:
  `node_modules/typescript/bin/tsc`, then
  `node_modules/vite/bin/vite.js build`.
- Copy the inherited environment and apply `VITE_VARIANT=full` last so a caller
  cannot downgrade the variant.
- At the production call site, pass `mainScripts` and `process.env`; never use
  PR package scripts to authorize expansion. Pass the static full-build
  environment only to the translated stages.
- Reject every other npm, shell, direct compiler, bundler, Cargo, or malformed
  alias stage with the existing fail-closed runner error.

The resulting trusted UX-010 path contains five directly spawned stages:

1. Node startup tests.
2. tsx service and component behavior tests.
3. Node-hosted TypeScript compilation.
4. Node-hosted Vite full-variant build.
5. Node native gate, including deterministic resource generation and the Rust
   current-location contract.

## Test strategy

- Assert exact five-stage decomposition and executable paths.
- Assert inherited environment preservation and last-write full-variant
  override.
- Assert the exact trusted definition pin and rejection of missing, altered,
  whitespace-changed, differently quoted, appended, and recursive definitions.
- Reject npm alias and argument near matches, npm exec/prefix forms, shell,
  direct TypeScript/Vite/Cargo, and a trailing arbitrary stage.
- Source-pin the production call to `mainScripts` and `process.env`.
- Preserve representative service selection of `test:ux010` and the focused
  native override.

## Evidence

- Revised TDD red: `node --test tests/agentic-pipeline.test.mjs` reported
  44 pass / 3 fail before the trusted-main expansion existed. Failures covered
  canonical five-stage expansion, exact definition handling, and production
  call-site wiring.
- Revised focused green: `node --test tests/agentic-pipeline.test.mjs` reported
  47 pass / 0 fail. Node syntax, whitespace, and canonical package equality
  checks also passed.
- New mutation proofs: pending. At minimum, independently prove the exact stage
  gate, exact definition pin, full-variant override order, direct executable
  paths, and main-scripts production wiring.
- Full UX-010 execution and agentic validation: pending.
- Independent and exact-tip cross-agent reviews: pending.

## Rollback

Revert the runner and focused regression changes together. The pre-repair
behavior remains fail closed: selected UX-010 suites reject the nested npm stage
instead of silently skipping the build.

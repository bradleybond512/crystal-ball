# UX-010 Targeted Build-Gate Repair Brief

Status: revised implementation, mutation proofs, and validation complete;
independent review pending
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
- Mutation baseline: `git status --short` was empty. SHA-256 was
  `357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9`
  for `scripts/targeted-tests.mjs` and
  `b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea`
  for `tests/agentic-pipeline.test.mjs`.
- Mutation 1 bypassed the trusted-definition comparison:

  ```diff
  -      if (trustedScripts['build:full'] !== TRUSTED_FULL_BUILD) {
  +      if (false && trustedScripts['build:full'] !== TRUSTED_FULL_BUILD) {
  ```

  The confirmed diff produced:

  ```text
  ✖ the trusted full-build expansion pins the canonical definition and rejects near matches
  ℹ tests 47
  ℹ pass 46
  ℹ fail 1
  AssertionError [ERR_ASSERTION]: Missing expected exception.
  ```

- Mutation 2 reversed the environment override order:

  ```diff
  -      const env = { ...inheritedEnv, VITE_VARIANT: 'full' };
  +      const env = { VITE_VARIANT: 'full', ...inheritedEnv };
  ```

  The confirmed diff produced:

  ```text
  ✖ the canonical UX-010 suite expands its pinned full build into five trusted stages
  ℹ tests 47
  ℹ pass 46
  ℹ fail 1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + VITE_VARIANT: 'tech'
  - VITE_VARIANT: 'full'
  ```

- Mutation 3 broadened the exact stage match:

  ```diff
  -    if (trimmed === 'npm run build:full') {
  +    if (trimmed.startsWith('npm run build:full')) {
  ```

  The confirmed diff produced:

  ```text
  ✖ the trusted full-build expansion pins the canonical definition and rejects near matches
  ℹ tests 47
  ℹ pass 46
  ℹ fail 1
  AssertionError [ERR_ASSERTION]: Missing expected exception: npm run build:full -- extra
  ```

- Mutation 4 removed the trusted-main scripts from the production call:

  ```diff
  -        mainScripts,
  +        {},
  ```

  The confirmed diff produced:

  ```text
  ✖ the production trusted-main path supplies canonical scripts and inherited environment
  ℹ tests 47
  ℹ pass 46
  ℹ fail 1
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /commandToStages/
  ```

- Mutation 5 changed the direct TypeScript entry point:

  ```diff
  -          args: [path.join(nodeModulesDir, 'typescript/bin/tsc')],
  +          args: [path.join(nodeModulesDir, 'typescript/bin/tsc-missing')],
  ```

  The confirmed diff produced:

  ```text
  ✖ the canonical UX-010 suite expands its pinned full build into five trusted stages
  ℹ tests 47
  ℹ pass 46
  ℹ fail 1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + /repo/node_modules/typescript/bin/tsc-missing
  - /repo/node_modules/typescript/bin/tsc
  ```

- After every mutation, the runner and test checksums returned to their
  baseline values and `git status --short` was empty.
- `npm run test:ux010` passed: startup 5 pass / 0 fail; TypeScript/UI behavior
  36 pass / 0 fail; full-variant TypeScript/Vite production build succeeded;
  native Rust contract 1 pass / 0 fail.
- `bash scripts/agentic-validate.sh --tests "test:agentic-pipeline test:ux010"`
  passed. Its focused pipeline stage reported 47 pass / 0 fail, and the gate
  also passed lockfile, strict lint, all TypeScript configs, repository secret
  scan, cross-agent readiness, documentation, roadmap, and production build.
- Independent and exact-tip cross-agent reviews: pending.
- Independent and exact-tip cross-agent reviews: pending.

## Rollback

Revert the runner and focused regression changes together. The pre-repair
behavior remains fail closed: selected UX-010 suites reject the nested npm stage
instead of silently skipping the build.

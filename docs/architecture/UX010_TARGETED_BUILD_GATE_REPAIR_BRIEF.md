# UX-010 Targeted Build-Gate Repair Brief

Status: evidence-only remediation complete; renewed independent review pending
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

### Exact-tip validation transcript

All validation and mutation commands below were run at the same code tip:

```text
$ git rev-parse HEAD
391654c7d81ad3dd7cf58e7cedfeb636f06f1cb2
exit 0
```

The complete UX-010 contract was rerun directly:

```text
$ npm run test:ux010
> crystal-ball@2.25.147 test:ux010
> node --test tests/ux010-location-startup.test.mjs && tsx --test src/services/__tests__/location.test.mts tests/ux010-ephemeral-local-logistics.test.mts tests/ux010-current-location-save.test.mts src/components/__tests__/ux010-current-location-panel.test.mts && npm run build:full && node --test tests/ux010-native-gate.test.mjs

ℹ tests 5
ℹ pass 5
ℹ fail 0

ℹ tests 36
ℹ pass 36
ℹ fail 0

> crystal-ball@2.25.147 build:full
> cross-env-shell VITE_VARIANT=full "tsc && vite build"
vite v8.1.5 building client environment for production...
✓ 5629 modules transformed.
✓ built in 36.84s
PWA v1.3.0
mode      generateSW
precache  452 entries (21524.65 KiB)

✔ focused native gate executes the current-location Rust contract (17517.120916ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
exit 0
```

The full repository gate was rerun independently rather than inferred from the
direct command:

```text
$ bash scripts/agentic-validate.sh --tests "test:agentic-pipeline test:ux010"
==> npm run test:agentic-pipeline
ℹ tests 47
ℹ pass 47
ℹ fail 0

==> npm run test:ux010
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ tests 36
ℹ pass 36
ℹ fail 0
vite v8.1.5 building client environment for production...
✓ 5629 modules transformed.
✓ built in 38.49s
✔ focused native gate executes the current-location Rust contract (14131.750167ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0

==> npm run lockfile:check
[lockfile:check] package-lock.json version fields look valid.
==> npm run lint:strict
[lint:conflicts] No merge conflict markers found.
[lint:json] Parsed 137 tracked JSON file(s).
[lint:yaml] Parsed 23 tracked YAML file(s).
[lint:shell] Checked 20 tracked shell file(s).
[lint:md] Checked 126 Markdown file(s).
[lint:colors] OK — 453 files with 7735 baselined literals, none exceeded.
==> npm run typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
==> npm run secrets:scan
Secret scan passed for 4693 file(s).
==> npm run cross-agent:check
Required reviewer: Claude
==> npm run docs:check -- --changelog-advisory
[docs:check] Documentation appears fresh.
==> npm run roadmap:check
BLOCKED: 1 | DONE: 40 | MONITOR: 1 | TODO: 13 | WAITING: 9
==> npm run build
vite v8.1.5 building client environment for production...
✓ 5629 modules transformed.
✓ built in 31.51s

Agentic validation gate passed.
Tests run: test:agentic-pipeline test:ux010
exit 0
```

### Raw mutation transcripts

The worktree intentionally contains an untracked `node_modules` symlink. Every
initial and restored full status therefore reports that one entry, while
`git status --short --untracked-files=no` produces no output. No mutation began
or ended with a tracked change. The committed baseline was:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

#### Mutation 1: trusted-definition comparison

Initial status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

Confirmed applied mutation:

```diff
-      if (trustedScripts['build:full'] !== TRUSTED_FULL_BUILD) {
+      if (false && trustedScripts['build:full'] !== TRUSTED_FULL_BUILD) {
```

```text
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
7f1204933148c6549f4eed458062d0b67d3eed8c6579dbae63e2d58c6bbc7fe6  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
$ node --test tests/agentic-pipeline.test.mjs
✖ the trusted full-build expansion pins the canonical definition and rejects near matches
ℹ tests 47
ℹ pass 46
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected exception.
exit 1
```

Restored status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

#### Mutation 2: full-variant environment override

Initial status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

Confirmed applied mutation:

```diff
-      const env = { ...inheritedEnv, VITE_VARIANT: 'full' };
+      const env = { VITE_VARIANT: 'full', ...inheritedEnv };
```

```text
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
9022fc4d8244c4ac8e050eb4273d398f6295cff08f9cc6508909c1f2f7c8b4ab  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
$ node --test tests/agentic-pipeline.test.mjs
✖ the canonical UX-010 suite expands its pinned full build into five trusted stages
ℹ tests 47
ℹ pass 46
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ VITE_VARIANT: 'tech'
- VITE_VARIANT: 'full'
exit 1
```

Restored status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

#### Mutation 3: exact stage comparison

Initial status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

Confirmed applied mutation:

```diff
-    if (trimmed === 'npm run build:full') {
+    if (trimmed.startsWith('npm run build:full')) {
```

```text
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
6006952721b9f6657c84f231b0cb50c87e9fe60dcd111ad41ea4fbe830440b3c  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
$ node --test tests/agentic-pipeline.test.mjs
✖ the trusted full-build expansion pins the canonical definition and rejects near matches
ℹ tests 47
ℹ pass 46
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected exception: npm run build:full -- extra
exit 1
```

Restored status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

#### Mutation 4: canonical main-scripts production wiring

Initial status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

Confirmed applied mutation:

```diff
-        mainScripts,
+        {},
```

```text
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
ce05dd4cbf4ef890df22b1d023d3a683ca6f8201fddb4a963823fb836dc8130e  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
$ node --test tests/agentic-pipeline.test.mjs
✖ the production trusted-main path supplies canonical scripts and inherited environment
ℹ tests 47
ℹ pass 46
ℹ fail 1
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /commandToStages/
exit 1
```

Restored status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

#### Mutation 5: direct TypeScript executable path

Initial status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

Confirmed applied mutation:

```diff
-          args: [path.join(nodeModulesDir, 'typescript/bin/tsc')],
+          args: [path.join(nodeModulesDir, 'typescript/bin/tsc-missing')],
```

```text
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
9c5951503c1704effe6c394561658cf6e9184061fddd7d4810b75ce4b7a3e0dc  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
$ node --test tests/agentic-pipeline.test.mjs
✖ the canonical UX-010 suite expands its pinned full build into five trusted stages
ℹ tests 47
ℹ pass 46
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ /repo/node_modules/typescript/bin/tsc-missing
- /repo/node_modules/typescript/bin/tsc
exit 1
```

Restored status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

#### Mutation 6: representative service selection

This fresh proof mutates the exact directory-coverage behavior observed by
`a representative service change selects the trusted UX-010 suite`; it does not
mutate an unrelated helper body.

Initial status and checksums:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
```

Confirmed applied mutation:

```diff
-      if (m) coveredDirs.add(`${m[1]}/`);
+      if (m && name !== 'test:ux010') coveredDirs.add(`${m[1]}/`);
```

```text
$ git status --short
 M scripts/targeted-tests.mjs
?? node_modules
$ git status --short --untracked-files=no
 M scripts/targeted-tests.mjs
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
ba5eed25e97cac4848b4503578e83b0305f971a9594e3b24579c600ef39c677b  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
$ node --test tests/agentic-pipeline.test.mjs
✖ a representative service change selects the trusted UX-010 suite
ℹ tests 47
ℹ pass 46
ℹ fail 1
AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
  assert.ok(result.scripts.includes('test:ux010'))
exit 1
```

Restored status, checksums, and green confirmation:

```text
$ git status --short
?? node_modules
$ git status --short --untracked-files=no
$ shasum -a 256 scripts/targeted-tests.mjs tests/agentic-pipeline.test.mjs
357fb3d774b8d4d76726a71511e046b8a6a989a2d14fe2ebfd419304ee6733f9  scripts/targeted-tests.mjs
b2dbc11c96a03cc1154d15238bcfccb769c202646b3c0974e93db744a772c9ea  tests/agentic-pipeline.test.mjs
$ node --test tests/agentic-pipeline.test.mjs
ℹ tests 47
ℹ pass 47
ℹ fail 0
exit 0
```

- Independent and exact-tip cross-agent reviews remain pending after this
  evidence-only remediation.

## Rollback

Revert the runner and focused regression changes together. The pre-repair
behavior remains fail closed: selected UX-010 suites reject the nested npm stage
instead of silently skipping the build.

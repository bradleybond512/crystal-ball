# UX-037 — stacking ownership ratchet validation

Draft [#1923](https://github.com/bradleybond512/crystal-ball/pull/1923). Revised
implementation `132f7c160a13b86a6a09729e6757881fbc2e3ab1`, base
`ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`. Bradley approved the revised parser
design and renewed local implementation on November 26, 2026. Local validation
passed; final exact-tip reviews and code-publication approval remain pending.

## Behavior and scope

New or changed stacking declarations require reviewed ownership. The static
scanner rejects expression/constant changes, stale entries, multiplicity drift,
invalid exceptions and missing overlay tokens. Parentheses, assertions, non-null
and satisfies wrappers now share recognition; ordinary assignments remain normal
declarations and compound/logical/update writes require exact unsupported records.
Original operation spelling and runtime constant dependencies remain fingerprinted;
type-only annotations are excluded. Quoted CSS, ambiguous HTML and runtime class
heritage regression protections remain intact.

Files: `scripts/lint-stacking.mjs`, `scripts/stacking-inventory.json`,
`tests/lint-stacking.test.mjs`, package commands, the existing static-lint job in
`.github/workflows/lint.yml`, additive targeted-test mappings and documentation.
No application source, CSS value, focus behavior, dependency or stored state changed.
The scanner reuses the existing TypeScript dependency; no inventory auto-accept mode.

Independent original inventory review matched all 214 declarations across 43 files:
181 CSS z-index declarations, 23 JS declarations, ten CSS tokens; 212 DOM and two
non-DOM lens metadata entries. Unknown ancestry remains explicit. Complete
before/after extraction deep equality preserved all 2168 files, 214 entries,
identities, counts, bindings, lines and tokens. Inventory checksum:
`f15e707d0dbd48a94cbfd30ae1a7986b377ffe693be97a3c2b3faebd54e853b9`.

## Executed validation

Node 22.23.1 with existing lock-identical dependencies; actual output:

```text
npm run test:stacking
# tests 260
# pass 260
# fail 0

npm run lint:stacking
Stacking inventory: 2168 files, 214 declarations, 0 errors

npm run typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json

bash scripts/agentic-validate.sh --tests test:stacking
Agentic validation gate passed.
Tests run: test:stacking

node scripts/targeted-tests.mjs
[targeted-tests] 11 script(s) passed.
```

Targeted ESLint passed without suppressions. The full gate ran lockfile, strict
lint, types, secrets, cross-agent configuration, docs, roadmap and build checks.
Build timing/bundle notices were advisory. Configuration checks are not a review.
One commit attempt failed during lint-staged backup; a diagnostic rerun and the
complete hook retry passed without code changes. No hook or check was bypassed.

## Mutation evidence

Initial wrapper regressions: `12 pass / 146 fail` before implementation. Three
additional cases were checked later (`2 pass / 1 fail`); no initial red is claimed
for those two passing cases. Final suite: `260 pass / 0 fail`.

All 32 deliberate regressions were detected. Each began clean, recorded SHA-256,
confirmed and saved the applied diff, ran all 260 tests with actual assertion
failures, restored identical bytes and verified clean status. No syntax-only
failure or survivor. Actual baseline `260 pass / 0 fail` changed as follows:

| Reverted guard | Actual pass / fail |
| --- | --- |
| unwrap-parentheses | 137 / 123 |
| unwrap-as | 208 / 52 |
| unwrap-angle | 214 / 46 |
| unwrap-nonnull | 211 / 49 |
| unwrap-satisfies | 213 / 47 |
| normalize-assignment | 192 / 68 |
| normalize-update | 211 / 49 |
| normalize-computed-name | 236 / 24 |
| normalize-call-callee | 253 / 7 |
| normalize-call-property | 254 / 6 |
| computed-source-spelling | 259 / 1 |
| call-source-spelling | 259 / 1 |
| assertion-type-dependencies | 259 / 1 |
| ambiguous-markup-fallback | 258 / 2 |
| css-markup-dispatch | 258 / 2 |
| stacking-update-writes | 207 / 53 |
| runtime-class-heritage | 259 / 1 |
| expression-identity | 245 / 15 |
| constant-dependencies | 253 / 7 |
| stale-entry | 259 / 1 |
| multiplicity | 258 / 2 |
| css-extraction | 213 / 47 |
| js-extraction | 85 / 175 |
| unsupported-failclosed | 258 / 2 |
| html-entity-decoding | 253 / 7 |
| schema-classification | 259 / 1 |
| token-resolution | 259 / 1 |
| path-containment | 258 / 2 |
| symlink-boundary | 257 / 3 |
| strict-lint-wiring | 259 / 1 |
| ci-lint-wiring | 259 / 1 |
| ci-test-wiring | 259 / 1 |

Final actual output: `Restored baseline: (260, 0)`.
Restored scanner checksum:
`156710af588bd91d95694c647e1deb82c607fd02662680d92a23858bbc333e5c`.
Package checksum: `734b3a2cbaf688f9136124aa2999ac9421b648a09f2d6b87a07c871314098feb`.
Workflow checksum: `1b89ca0ceffe1f907459a19fe54c26ad74f2bffa74ea33ad34af62c5a91456ae`.
Raw logs, all diffs and restoration receipts are retained privately under
`next-nov26/ux037`; original inventory provenance is in `next-nov25/ux037`.

## Review history and limits

Initial Sol review found CSS quoted-tag routing and direct update gaps; parent
also confirmed Sonnet's runtime heritage candidate. Repair 1 addressed those
cases (`1 pass / 7 fail` before repair) but missed apostrophe-prefixed HTML.
Repair 2 added an exact unsupported-fragment fallback (`0 pass / 2 fail` before
repair), then parent found wrapped writes still disappearing. Automatic repair
stopped after two attempts. The [revised design](../plans/2026-11-25-ux037-wrapper-revision.md)
records why case-specific fixes were insufficient and Bradley's November 26 approval.
The approved shared recognizer revision closes that demonstrated wrapper family.

Fresh independent Sol review of implementation `132f7c160a` found no blockers,
reran 260 tests and inventory lint, recognized all 200 additional nested-wrapper
probes and audited all 32 mutation diffs/results/restored checksums. Final
exact-tip documentation audit and actual Sonnet review remain pending.

This is source-declaration enforcement, not global runtime-ordering proof.
Arbitrary computed names/dataflow, imported runtime values, generated CSS and
ancestor changes without stacking declarations remain outside its contract.
Unsupported expressions require individual reviewed fingerprints. Source symlinks
and path escapes fail closed. Branch-controlled tooling is not tamper-proof.
Browser focus/contrast, hosted CI and installed acceptance are unverified.
Unchanged marketing/Rust dependency audits remain open. UX-076 metadata merely
records merged #1900; packaged acceptance remains separate.

## Manual verification, rollback and proposed PR

Review actual component/context evidence for every inventory entry; never copy a
number just to silence CI. The fixtures exercise additions, substitutions and
removal without modifying live UI. No application, profile, provider or cleanup
access was used for UX-037.

Rollback reverts scanner, inventory, tests and wiring together. No migration or
application rollback is required. Proposed PR summary: require reviewed ownership
for stacking declarations, recognize equivalent wrapped writes consistently, and
retain existing UI values and behavior. Evidence: 260 tests, 32 mutation proofs,
11 selected scripts and the full gate passed. Final reviews and separate code
publication approval remain required. Merging, auto-merge, releases, deployment
and installation remain paused.

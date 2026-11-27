# UX-037 — stacking ownership ratchet validation

Draft [#1923](https://github.com/bradleybond512/crystal-ball/pull/1923).
Current code `bb1758632f35100fe1e4cd050afdcde6ef7764aa`; base
`ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`. **NOT ACCEPTED:** transparent-expression wrappers still bypass the scanner after
two automatic repair attempts. Bradley approved the revised parsing design and
renewed local implementation on November 26. This report retains the prior
checkpoint until fresh validation and reviews finish. Code publication and hosted acceptance
remain blocked; draft #1923 contains only the earlier documentation claim.

## Result and change surface

New stacking declarations require explicit reviewed ownership. The scanner
rejects changed expressions/constants, new or stale entries, invalid exceptions,
missing overlay tokens and multiplicity drift. Strict local lint and the existing
static-lint CI job run the rule; CI also runs its tests. Existing gates remain.

Changed files: `scripts/lint-stacking.mjs`, `scripts/stacking-inventory.json`,
`tests/lint-stacking.test.mjs`, `package.json`, `.github/workflows/lint.yml`,
additive targeted-test mappings and roadmap/design/evidence documentation.
No application source, CSS value, focus handler, runtime dependency or stored
state changed. The scanner reuses the existing direct TypeScript dependency.

The separately reviewed source inventory covers 214 declarations across 43 files:
181 CSS z-index declarations, 23 JS declarations, ten CSS tokens; 212 DOM entries
and two narrowly identified non-DOM lens metadata entries. Every raw declaration
was reviewed in context and correlated with extraction (214/214). Unknown
ancestry remains explicit. There is no automatic inventory acceptance mode.
Full provenance is retained in `next-nov25/ux037/ux037-inventory-review.md`.

## Executed checks

Node 22.23.1 and existing lock-identical dependencies. All commands exited 0.
Actual excerpts:

```text
npm run test:stacking
# tests 99
# pass 99
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
lint (including stacking), types, secrets, cross-agent configuration, docs,
roadmap and build checks. Configuration validation is not a review verdict.
Build produced advisory bundle/plugin timing messages; no gate failed.

Initial candidate timing sample (not a final-code or cold-filesystem benchmark):

```text
Stacking inventory: 2168 files, 214 declarations, 0 errors
Cold scan: 4248 ms
```

## Mutation evidence

Baseline and restored suite: `99 pass / 0 fail`. Each mutation began with empty
Git status, recorded `shasum -a 256`, displayed and saved the applied diff,
produced actual red assertions, restored matching bytes/checksums and verified
empty status. All 19 tested regressions were caught. Raw assertion names, TAP, diffs
and restoration receipts are retained in `next-nov25/ux037/final`.

| Reverted guard | Actual pass / fail |
| --- | --- |
| ambiguous-markup-fallback | 97 / 2 |
| css-markup-dispatch | 97 / 2 |
| stacking-update-writes | 95 / 4 |
| runtime-class-heritage | 98 / 1 |
| expression-identity | 85 / 14 |
| constant-dependencies | 95 / 4 |
| stale-entry | 98 / 1 |
| multiplicity | 97 / 2 |
| css-extraction | 52 / 47 |
| js-extraction | 72 / 27 |
| unsupported-failclosed | 97 / 2 |
| html-entity-decoding | 92 / 7 |
| schema-classification | 98 / 1 |
| token-resolution | 98 / 1 |
| path-containment | 97 / 2 |
| symlink-boundary | 96 / 3 |
| strict-lint-wiring | 98 / 1 |
| ci-lint-wiring | 98 / 1 |
| ci-test-wiring | 98 / 1 |

Mutated files: scanner for extraction/matching/schema/boundary guards,
`package.json` for strict-lint wiring, `.github/workflows/lint.yml` for CI wiring.
Restored checksums:

- scanner: `890231f3146bdd52edbf518e7b595d9c642560ed4eaf48468016c98a06d959c1`
- package: `734b3a2cbaf688f9136124aa2999ac9421b648a09f2d6b87a07c871314098feb`
- workflow: `1b89ca0ceffe1f907459a19fe54c26ad74f2bffa74ea33ad34af62c5a91456ae`

Fixtures also exposed encoded HTML property names disappearing at the markup/CSS
boundary. Six focused fixtures failed before numeric decoding; another caught
template prefiltering. They now pass, and the decoder mutation fails seven tests.

## Review and limits

Initial independent review at `d85bb389e2` found two blocking gaps: CSS quoted
HTML text could redirect extraction, and literal increment/decrement writes were
missed. Parent also confirmed Sonnet's runtime class-heritage candidate.

Repair attempt 1 added quote/comment-aware dispatch, update-expression detection
and runtime heritage traversal. Its new fixtures were first `1 pass / 7 fail`
and then passed, but apostrophes in HTML text still suppressed styled markup.
Repair attempt 2 added an exact unsupported-fragment fallback; those fixtures
were first `0 pass / 2 fail` and then passed.

Final known-suite validation is 99/0, all 19 deliberate regressions were caught,
and the full gate plus all 11 selected scripts passed. Those results do not
establish acceptance: parent subsequently reproduced both
`(overlay.style.zIndex)++;` and `(overlay.style.zIndex) = 9;` returning
`declarations: []`, `errors: []`. Raw AST targets are recognized inconsistently
when semantically transparent wrappers surround them. Two repairs addressed
individual cases without a common reference-normalization boundary.

No final zero-blocker verdict has been recorded. Project rules require stopping
automatic repairs and escalating after two attempts; a revised design and new
human approval were required before further production changes. Bradley granted
that approval on November 26; revised implementation and validation are underway.
This is a declaration ratchet, not proof of global runtime ordering. Dynamic
property construction, arbitrary dataflow, imported runtime values, generated
CSS and ancestor changes without stacking declarations are outside its contract.
Reviewed unsupported expressions must be individually fingerprinted. Source
symlinks and path escapes fail closed. Inventory facts require review; the rule
does not make branch-controlled tooling tamper-proof. No source or screenshot
inspection establishes browser focus/contrast behavior; production UI is unchanged.

Initial inventory and scanner use only repository source. No app launch,
installed profile, credential, network source probe or cleanup occurred. The
unrelated marketing and Rust dependency audits on unchanged main lockfiles stay
open. UX-076 metadata correction records merged #1900 without claiming packaged
acceptance. Hosted CI and its required policy approval label remain pending.

## Manual review, rollback and proposed PR

Review component/context evidence when approving a new inventory entry; never
copy a number into the inventory merely to silence CI. Existing fixture tests
exercise additions, substitutions and deletion drift without modifying live UI.

Rollback reverts the scanner, inventory, tests and wiring together; there is no
stored-data migration or application rollback. Proposed PR summary: require
reviewed ownership for stacking declarations while preserving application CSS and
behavior. Known validation is 99 tests, 19 mutation proofs, 11 selected scripts
and a passing full local gate, but the confirmed wrapper bypass blocks completion
and publication. No final completion claim is proposed. Merging, auto-merge, releases, deployment and installation remain paused.

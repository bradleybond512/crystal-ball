# UX-037 — stacking ownership ratchet validation

Draft [#1923](https://github.com/bradleybond512/crystal-ball/pull/1923).
Implementation `012162cda63d43194ac6c9e00cd83af93250f21a`; base
`ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`. Local implementation qualified;
hosted enforcement and publication remain pending.

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
# tests 89
# pass 89
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

Single new-process timing sample (not a cold-filesystem benchmark):

```text
Stacking inventory: 2168 files, 214 declarations, 0 errors
Cold scan: 4248 ms
```

## Mutation evidence

Baseline and restored suite: `89 pass / 0 fail`. Each mutation began with empty
Git status, recorded `shasum -a 256`, displayed and saved the applied diff,
produced actual red assertions, restored matching bytes/checksums and verified
empty status. All 15 regressions were caught. Raw assertion names, TAP, diffs
and restoration receipts are retained in `next-nov25/ux037`.

| Reverted guard | Actual pass / fail |
| --- | --- |
| expression-identity | 81 / 8 |
| constant-dependencies | 85 / 4 |
| stale-entry | 88 / 1 |
| multiplicity | 87 / 2 |
| css-extraction | 44 / 45 |
| js-extraction | 67 / 22 |
| unsupported-failclosed | 87 / 2 |
| html-entity-decoding | 82 / 7 |
| schema-classification | 88 / 1 |
| token-resolution | 88 / 1 |
| path-containment | 87 / 2 |
| symlink-boundary | 86 / 3 |
| strict-lint-wiring | 88 / 1 |
| ci-lint-wiring | 88 / 1 |
| ci-test-wiring | 88 / 1 |

Mutated files: scanner for extraction/matching/schema/boundary guards,
`package.json` for strict-lint wiring, `.github/workflows/lint.yml` for CI wiring.
Restored checksums:

- scanner: `6e16b4d09801a7a682cc56db65c61e96b6ba31a2936f68cf43395e93f55a62c0`
- package: `734b3a2cbaf688f9136124aa2999ac9421b648a09f2d6b87a07c871314098feb`
- workflow: `1b89ca0ceffe1f907459a19fe54c26ad74f2bffa74ea33ad34af62c5a91456ae`

Fixtures also exposed encoded HTML property names disappearing at the markup/CSS
boundary. Six focused fixtures failed before numeric decoding; another caught
template prefiltering. They now pass, and the decoder mutation fails seven tests.

## Review and limits

Independent Sol and actual Sonnet review the final code/evidence tip; actual
conclusions are retained separately, with Sonnet recorded as a SHA-pinned verdict
before publication. Local gate success alone is not independent review.

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
behavior; 89 tests, 15 mutation proofs, 11 selected scripts and full local gate
pass. Merging, auto-merge, releases, deployment and installation remain paused.

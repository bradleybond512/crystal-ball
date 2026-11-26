# UX-037 — reviewed stacking declaration inventory

High Assurance tooling/CI design approved by Bradley on November 25, including
the documentation draft claim and local implementation. [Draft #1923](https://github.com/bradleybond512/crystal-ball/pull/1923)
was published before implementation. See [brief](2026-11-25-ux037-stacking-brief.md). No application
source, rendering, focus, modal ordering or critical-banner behavior changes.

## Contract and limits

Inventory exact stacking declarations and reject unreviewed additions, changes,
duplicates and stale allowances. A per-file count cannot detect replacing one
declaration with another, so use path, structural anchor, exact expression and
occurrence count. Line numbers aid navigation but are not identity.

Source inventory confirmed ten CSS overlay tokens, literal levels, inline style
objects/assignments, templates and constant references. Home has an isolated
stacking context; body-level toast/palette levels do not establish global order
for Home descendants. Lens metadata also uses `zIndex` without setting DOM style.
Record those distinctions explicitly; unknown ancestor relationships stay unknown.

This is a source-declaration ratchet, not proof of computed runtime ordering.
Arbitrary runtime property construction, imported runtime values, generated CSS
and ancestors changed without a stacking declaration remain limitations.

## Scanner and inventory

Add a read-only `scripts/lint-stacking.mjs`, exported fixture-testable extraction
and reconciliation functions, and `scripts/stacking-inventory.json`. No update
or automatic acceptance mode. Use the existing direct TypeScript dependency
for JS/TS syntax and a bounded CSS declaration lexer; do not import transitive
PostCSS or add dependencies. Never execute source or read outside the repository.

Scan application files under `src/` with CSS, TS/JS module, JSX/TSX and HTML
extensions. Document fixed exclusions for tests, declaration files and generated
sources. Recognize CSS `z-index`, `--z-*` definitions, nested rule ancestry,
`!important`, JS object keys, style assignments, literal bracket keys and
`setProperty`. Handle CSS literals/templates, HTML style attributes/blocks and
interpolation expressions without evaluating them. Decode property-name escapes;
skip comments and type-only signatures. Preserve literal contents/operators in
canonical expressions. Recognizable unsupported syntax fails unless individually
fingerprinted with a reviewed `unsupported` classification; no file-wide waiver.

Inventory version 1 entries contain:

- path, kind, canonical structural anchor, expression and positive exact count;
- referenced local constant bindings and their initializer fingerprints;
- classification (`dom`, `non-dom`, `separate-document`, `unsupported`);
- component owner, observed document/parent context or explicit unknown;
- rationale and evidence paths/structural anchors with the observed fact.

CSS anchors include enclosing at-rules/selectors. JS anchors include named
lexical containers and declaration targets. Identical declarations at the same
anchor have one exact multiplicity. Require unique keys, valid fields and
existing evidence anchors. Evidence interpretation remains a human/reviewer
responsibility. Track constant initializers such as WelcomeFlow's backdrop level:
an unchanged `String(CONSTANT)` sink must not hide a changed numeric initializer.
Recognized overlay-token references must resolve to inventoried definitions;
token reuse does not bypass ownership review.

Missing/unreadable inventory or source, parse failures, invalid schema, unresolved
required bindings, changed expressions, missing/stale entries or multiplicity
drift fail nonzero. Sort traversal and diagnostics. Record cold runtime and file
counts; no network, persistent cache or runtime bundle path changes.

## Owners, acceptance and tests

| Owner | Bounded files and task | Dependency / acceptance |
| --- | --- | --- |
| UI tooling specialist | Scanner and manually reviewed inventory | Approved design/draft claim; exact matching and documented syntax limits |
| Test specialist | `tests/lint-stacking.test.mjs` | Agreed schema/extraction API; fixtures for supported forms and failure paths |
| Integration owner | `package.json`, `.github/workflows/lint.yml`, additive `scripts/targeted-tests-overrides.json` entries | Reviewed inventory; add `lint:stacking` to strict lint and existing static-lint job, including merge groups; preserve existing gates |
| Parent and independent reviewers | Design, inventory ownership/evidence, tracker and QA | Actual validation and mutation results before publication |

Test escaped names, comments/strings, templates, constants, line shifts, nested
contexts, same-count replacement, changed conditional branches, duplicate/stale
entries, malformed schema, undefined tokens and changed definitions. Unsupported
syntax cannot yield an empty successful scan. Test deterministic CLI output and
failure exits. Classifications cannot hide unrelated declarations.

Run `npm run test:stacking`, `npm run lint:stacking`, `npm run typecheck:all`,
then `bash scripts/agentic-validate.sh --tests "test:stacking"`. Independently
mutate expression matching, stale/multiplicity checks and constant dependencies;
confirm applied diffs, actual failing assertions/counts, restored checksums and
clean tree. Review the initial inventory before enabling enforcement. No tests
have been run for this proposed implementation.

## Alternatives, rollback and approval

Reject count-only baselines, blanket numeric thresholds, regex-only JS parsing,
automatic inventory acceptance and mass token conversion. The chosen parser is
bounded declaration extraction, not a general CSS engine. Inventory is reviewed
policy; this does not make a branch-controlled scanner tamper-proof.

Rollback reverts tooling, inventory and wiring; no stored-data migration or
application behavior changes. Proposed draft: “UX-037: require ownership for
stacking declarations”. Approval covers design, documentation claim and local
implementation of this CI policy; code publication follows validation/review.
Merging, auto-merge, releases, deployment and installation stay paused. Separate
dependency PR #1920 remains in its existing workflow.

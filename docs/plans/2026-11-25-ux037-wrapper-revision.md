# UX-037 — revised expression recognition, approved November 26

The initial design remains bounded to source declarations. Automatic production
repairs have stopped after two attempts. Current code `bb1758632f` is **not
accepted**, despite 99 passing tests, 19 caught mutations and passing local gates.
Bradley approved this revised design and renewed local implementation on
November 26, 2026. The prior failed attempts remain documented below.

## Remaining finding and attempted repairs

Parent and read-only architecture probes returned `declarations: []`, `errors: []`
for these runtime writes:

```ts
(overlay.style.zIndex)++;
(overlay.style.zIndex) = 9;
(overlay.style.zIndex as any)++;
overlay.style.zIndex! = 9;
(overlay.style.zIndex satisfies number)++;
(overlay.style.setProperty)("z-index", "9");
```

The recognizers inspect immediate AST nodes and miss equivalent expressions
behind wrappers. This is a family-level recognition defect, not proof that the
underlying values are safe or unowned changes absent.

Repair 1 handled CSS quoted-tag routing, direct updates and runtime class
heritage. Its new fixtures first reported `1 pass / 7 fail`, then passed; it
did not cover equivalent wrapped write targets, and apostrophe-prefixed HTML
still disappeared. Repair 2 added exact unsupported handling for ambiguous
markup (`0 pass / 2 fail` before that fix), but left the independent write-target
recognizers unchanged. The current passing suites do not cover this demonstrated
wrapper family. No third automatic production repair has been attempted.

## Bounded revised design

Add one recognition-only helper that repeatedly unwraps an explicit allowlist:
parentheses, `as` assertions, angle-bracket type assertions, non-null assertions
and `satisfies` expressions. Inspect their runtime `.expression` only. Do not
treat every node with an expression field as transparent: calls, optional chains,
comma and conditional expressions are not generic wrappers. Angle-bracket
assertions apply to TS, not TSX.

Use this helper consistently for static property access, computed literal keys,
assignment/update targets, call callees and literal `setProperty` name arguments.
Replace separate assignment/update decisions with one write classifier retaining
the original operation, target, static name, operation category and dependency
nodes. Plain assignment remains a normal declaration; compound/logical assignment
and prefix/postfix updates remain exact unsupported records. `setProperty` and
object keys share static-name recognition while retaining their own categories.

Recognition must not rewrite source or print an unwrapped AST. Preserve original
anchors, complete unsupported-operation fingerprints, dependencies and existing
unwrapped inventory identities. Preserve wrapper/target spelling where needed
to distinguish new forms. Keep extractor results and inventory schema unchanged.
Type-only declarations and type annotations remain excluded; preserve the runtime
class-heritage exception.

A recognized stacking write that cannot be represented safely must emit an exact
unsupported record or diagnostic, never empty success. Do not replace parsing
with a text search that confuses comments, reads or types with writes. Arbitrary
computed names, aliases/dataflow, destructuring targets and runtime CSS generation
remain outside this bounded contract.

## Scope, proof and rollback

The UI tooling specialist owns `scripts/lint-stacking.mjs`; the test specialist
owns `tests/lint-stacking.test.mjs`; the parent owns existing design/evidence docs.
No dependency, runtime application, CI policy or schema changes. Compare complete
repository extraction before/after: existing 214 reviewed entries retain their
identities. Any newly exposed declaration needs manual review, never automatic
inventory acceptance.

Table-driven fixtures cover every allowed wrapper and nested combinations across
dot/bracket targets, ordinary/compound/logical assignments, updates, wrapped calls
and literal property arguments. Verify exact counts/categories, rejection by an
empty inventory, changed operations/dependencies and line-shift stability. Include
negative read/comment/string/type/nonstacking cases, TSX ambiguity and malformed
syntax; preserve all existing markup and heritage regressions.

Mutations independently remove each wrapper case and bypass normalization at
assignment, update, computed-name and call recognition. Record applied diffs,
actual red assertions/counts, restored checksums and clean status. Rerun focused
tests, inventory lint, type checks, full validation and fresh independent reviews.
No new implementation or test results are claimed for this proposal.

Work grows with wrapper depth; no network or scanned-code execution is introduced.
Rollback reverts the unpublished tooling revision; application behavior is
unchanged. Approval authorizes this revised design and renewed local implementation
and validation only. Code publication still needs separate approval. Merging,
auto-merge, releases, deployment and installation remain paused; cleanup stays
disabled. Full [validation and escalation](../validation/UX-037-STACKING-INVENTORY.md).

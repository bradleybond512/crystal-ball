# Linear keyword boundary trimming

## Scope and design

Standard, semantics-preserving performance prerequisite for SonarJS 4.2.2.
Historical qualified base: `f657f813d4c556249df7210ebf76290ca637abf9`.
Only keyword token boundary trimming changes; matching, inflection, lowercase,
whitespace splitting, internal punctuation and Set/ordered-token behavior remain.
No truncation, Unicode normalization, provider or scoring policy change.

The original unanchored suffix alternative retries a long punctuation run when
an ASCII character follows it. The decisive input is `a` plus punctuation plus
`b`, not merely punctuation at the end. Monotonic start/end scans remove that
backtracking. The predicate accepts only ASCII digits/lowercase letters.
`codePointAt` satisfies repository lint; indices still advance one UTF-16 code
unit, and non-ASCII code points and surrogate halves are rejected alike. Slicing
therefore retains the original code-unit boundaries and internal content.

## Scoped evidence

- Test-first original source: 64 pass / 1 fail. The real tokenizer on 200,000
  internal punctuation characters exceeded the explicit four-second work limit.
  A readiness handshake proves import completed first; startup has a separate
  15-second limit. The old implementation still fails 64/1 after this refinement,
  while the repaired implementation passes 65/0.
- Repaired focused suite: 65 pass / 0 fail, no skips or cancellations.
- Exact original-source differential: 5,010 bounded fixtures and 115,230 keyword
  comparisons preserve ordered tokens, Set iteration order and matching results.
  Fixtures include lowercase expansion, combining marks, emoji, lone surrogates,
  ASCII boundary neighbors, repeated tokens and Unicode whitespace.
- Supporting measured samples on official Node 22.23.3: original 2k/4k/8k internal
  runs took approximately 6/24/96 ms; repaired 100k/200k/400k runs took approximately
  0.11/0.29/0.49 ms. These samples support, but do not replace, the monotonic-scan
  complexity argument. The behavioral child assertion remains generously bounded.
- Exact production-file ESLint with both SonarJS 4.0.3 and 4.2.2: zero errors and
  warnings. The first `charCodeAt` implementation hit the existing Unicorn rule;
  it was corrected without suppression and differential tests reran successfully.

Focused command: official Node wrapper, then
`node --import tsx --test tests/geo-keyword-matching.test.mts`.
The fixture is in targeted-test baseline data; do not infer selector execution
without inspecting the actual committed-source selection.

## Committed mutation and pending final acceptance

Normal hooks passed on `ce16bed28eff852161330196aceb3626f3b1c88f` after freshly
verifying actual main remained `f657f813`. A genuine clean-snapshot mutation
restored only the original regex call: baseline 65/0, red 64/1 with the intended
post-import work-budget failure, restored 65/0. The actual 543-byte applied diff,
source SHA-256 and clean before/after state are retained in the private receipt.
This documentation-only successor preserves those production and test bytes.

The prior three-suite selection exposed an actual CI reachability gap. A minimal
`test:keyword-match` node-test-first script now names the regression fixture, and
an additive source override selects it for production changes. The test file is
indexed directly from the script; no coverage baseline or workflow was weakened.
A routing test exercises the real selector and command parser for both source and
fixture paths. Before wiring, it failed 65/1; after wiring, the suite passes 66/0.
Fresh clean removal proofs and final committed-source selection/aggregate/build/
bundle/full lint are recorded in the qualification receipt. Prior `ae99d3eae`
qualification stopped safely after aggregate; bundle/full lint were not claimed.
Independent review and hosted checks remain required. No model, push, release,
deployment or installation occurred. Rollback restores known quadratic behavior.

## Current-main preparation (November 8, 2026)

This five-file remainder is being reconciled on
`57f6b324bfd30a18c5e9f79541dd62e48ec38e0b`, preserving Q20, gltf 9.4.2 and the exact keyword
implementation, regression fixtures and original differential oracle. Only the
keyword runner/source mapping is added to the newer package/mapping unions.
The evidence above belongs to the earlier frozen source, not this preparation.
Final current-main transition, normal hooks, focused/differential and detecting
mutation runs, required aggregate/build/budget/lint, independent review and hosted
checks remain pending. No new matching, normalization or scoring policy is added.

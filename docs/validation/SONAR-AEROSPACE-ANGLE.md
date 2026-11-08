# Aerospace angle extraction and parser equivalence

This bounded Standard performance/refactoring slice reuses the merged linear angle
text helper. It preserves the legacy replacement semantics, including empty spans
and unmatched tails. It is not an HTML sanitizer or a new prediction policy.

The immutable full-provider fixture comes from main
`7fe2cc34c06e148ddd156401105401b2e76e67a5`, SHA-256
`19debafe275a0422182d8c89a024c3d4528be686ddbcb7f64a269884ceac2d94`.
Focused tests compare actual source with that original, not a rewritten oracle.

Whole-file lint repairs are type aliases, numeric-only Number predicate usage,
private header/row extraction, equivalent Russian-name regex grouping, removal of
an unused longitude argument, definite type assignment, equivalent mass branches
and consistent async callback returns. Survivability/severity executable bodies,
country precedence, remote URLs, timeout, two-hour cache and provider policy remain
unchanged. CelesTrak's estimated mass still affects survivability while its output
mass stays null. Zero parsed mass stays null; latitude scoring precedes finite
output normalization. No source classification or threshold correction is included.

## Evidence and limits

Prepared focused tests cover generated angle strings, every country literal and
boundary/priority combinations, object type precedence, mass/latitude scoring
boundaries, synthetic DOM tables, CelesTrak dates/types and actual whole-module
fetch/cache/dedup/sort/limit behavior. A real allSettled seam records callback
fulfilled/rejected status, order and errors. The READY/GO Node probe separates
startup from a one-second actual parser work budget. Original source failed that
budget; the linear candidate passes. Provider responses are synthetic, not live
shape evidence. No native application or installation claim is made.

This document records preparation, not final acceptance. Clean committed mutation
proofs, current-main reconciliation, normal hooks, relevant named aggregate,
HEAD build/bundle, unchanged full lint and independent review remain pending.
Broad local selector execution is not authorized under a non-native lease: list
and audit it first, then require unchanged hosted targeted-tests to execute every
selected suite, including native companions. No required gate is waived.

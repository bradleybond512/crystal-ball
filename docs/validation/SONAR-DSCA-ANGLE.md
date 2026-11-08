# DSCA extraction performance prerequisite

Prepared on actual main `7fe2cc34c06e148ddd156401105401b2e76e67a5`.
The merged angle helper is reused unchanged; Aerospace and Congress are untouched.

The two recipient regexes are replaced by separate Government-first / to-second
linear scans. Each retains the earliest viable capture, a monotonically cached
whitespace endpoint and constant auxiliary state. Exact ASCII boundary/case,
minimum two-character capture, lazy suffix, prefix priority, JS whitespace and
trim behavior are preserved. Non-multiline `$` means end-of-input, not a special
before-final-newline position. No country dictionary, cap or classification policy
is added. Angle extraction remains text extraction, not HTML sanitization.

The major-system Boolean alternatives are split without changing their literals
or precedence. Both fetch response callbacks have consistent Promise return types;
existing non-OK/no-body and allSettled partial/error handling are retained.

Checked-in immutable original full provider is copied verbatim from the base.
Tests compare 300,802 recipient cases, 3,125 generated angle cases plus explicit
entity/Unicode tails, all major-system literals/category/severity combinations,
and actual synthetic FR/RSS/cache/error outputs with a fixed clock. They also
exercise the actual parser in READY/GO child probes (10s separate startup, 1s work)
and actual selector routing. No live provider requests occur.

Tests-first: original source 4 pass / 3 intentional work-budget failures.
Prepared implementation: 7 pass / 0 fail, zero cancelled/skipped. Scoped source
and test ESLint: zero errors/warnings. An initial integration lint finding for
loop-counter assignment and JSON any-assignment was repaired without changing
matching behavior; raw failures retained privately. These are preparation checks,
not final acceptance. Clean committed-source mutation proofs, normal hooks,
actual-main trusted selection, full aggregate/build/budget/lint and independent
review remain pending. Prototype proofs are historical scratch evidence only.

Full selectors require a reviewed execution manifest before running: native Cargo
UX010/vault tests and the rustc updater contract are transitive selected effects.
A no-native lease blocks that execution; required suites must not be omitted or
stubbed. No native, install, release or live-provider acceptance is claimed here.

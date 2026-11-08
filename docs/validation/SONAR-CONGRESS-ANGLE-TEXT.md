# Congress angle-span extraction prerequisite

Prepared against actual main `3245ce41b91d677bcd66f07fa418e143dec23ed0`.
Standard behavior-preserving performance repair, narrowly separated from the
blocked three-consumer angle-text attempt. Aerospace and DSCA remain unchanged.

`replaceNonemptyAngleSpans` preserves exactly the nonempty spans selected by
`/<[^>]+>/g`, with a monotonic scan. This is text extraction, not sanitization.
Empty `<>`, nested opening angles, unmatched tails, entity decoding order,
whitespace normalization and subsequent parsing retain their old meanings.
Congress-only type alias is type-only; `Number.isNaN` receives the numeric result
of `Date.getTime`, preserving the previous global `isNaN` decision.

The checked-in immutable original Congress module comes verbatim from the base.
Focused tests compare 3,141 text inputs against its original function, use a
READY/GO child probe (separate startup limit, two-second work limit), and compare
whole synthetic feed/parser/cache outputs with a frozen clock. Cases include
valid/invalid/absent/epoch dates, relevance, chamber/type/severity, keyword order,
ID fallback, truncation, deduplication/sort/maximum, exact cache TTL, transport,
non-OK, body rejection and parser-error fallbacks. No live feeds are contacted.
The real selector must route the consumer, helper, test and immutable fixture.

Initial actual-main source: 3 passing / 1 failing, intended adversarial work
budget. Prepared replacement: 4 passing / 0 failing, no cancellations/skips.
These are lightweight preparation results, not final clean-source qualification.
Normal hooks, clean-snapshot detecting mutations, full selected/aggregate QA,
build/bundle/lint and independent review remain pending. No policy, scoring,
provider cadence, permissions or release/install behavior changes.

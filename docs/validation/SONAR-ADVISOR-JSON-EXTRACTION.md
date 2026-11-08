# Advisor JSON extraction compatibility

## Brief and design

Replace only the private greedy first-opening/last-closing brace extraction in survival-advisor.ts with two linear string searches and a slice. This is not a JSON parser, balanced-brace detector, sanitization or advice policy change. Preserve JSON.parse, item filtering, caught failures, static fallback selection, advice priorities/content, privacy and egress. No truncation or timeout is introduced into production. The coordinator authorized this bounded prerequisite following read-only discovery under Bradley's fix-all scope.

The caller's runClaudeAgent validates response is a string. The helper remains private and its string contract unchanged; coercion of arbitrary nonstring objects is not a supported input. A nonempty brace range is exactly the original regex's first opening brace through last later closing brace. No match leaves the full response for JSON.parse. Greedy behavior across nested braces, quoted braces or multiple objects intentionally stays unchanged.

## Tests and limits

Tests compile the actual private production function with TypeScript AST extraction. An immutable original-function fixture from f10948b40ebc5b518b8f365ce5e8aef7d4205893 is the differential oracle. Across 3,148 inputs, compare real parsed/filter outputs, and separately capture actual JSON.parse input to detect substring changes hidden by malformed JSON returning an empty array. Include valid/nested/quoted/escaped JSON, multiple objects, unmatched/reversed braces, scalar/array/null roots, malformed item arrays, newline/Unicode/lone surrogate text.

Before production edit, actual parser on 200,000 unmatched opening braces exceeded the preselected 2-second child-process cap: 3 pass / 1 fail. After scan: 4 pass / 0 fail, approximately 700 ms for the entire focused suite. This is a bounded actual-function responsiveness proof, not a formal measured asymptotic curve or a claim of production exploitation. The timeout exists only in the regression subprocess, not production.

Both SonarJS 4.0.3 and 4.2.2 scoped production/test lint passed 0 errors / 0 warnings. Clean independent mutations from restored 4 pass / 0 fail: first closing brace 2/2; last opening brace 2/2; reversed delimiter acceptance 3/1; changed no-match parse input 3/1; rethrowing caught parse error 2/2; original regex 3/1 (bounded timeout again); routing removal 3/1. Each applied diff and restored SHA was verified; final restored tests 4/0. Production SHA256: 75f3d29b24a7d65651c2f2a002f067f9f752923f5e8d578b2e3905269cc417d4. Exact receipts are retained externally. Normal derived test selection includes this regression and routing is itself tested. Full hooks/aggregate/build/typecheck, final-source qualification, independent review and hosted checks remain deferred until coordinator capacity. No network/model generation, native installation or user context access is needed or performed. Rollback restores the original extraction and its reproduced timeout; no stored-data migration.

## Current-main preparation (November 8, 2026)

Prepared on main3245ce41 after the keyword prerequisite merged; the production replacement remains byte-identical
to the original bounded candidate. The immutable original function fixture
was checked against actual-main source. Existing package runners are preserved.
The test now confirms both production and fixture selector reachability.

A READY/GO child handshake separates a 15-second startup bound from the
two-second actual parser work deadline. Tests-first original source produces
3 pass / 1 fail, specifically the post-READY work assertion, with zero cancelled
or skipped cases. Earlier proof receipts above remain historical. Fresh normal
hooks, committed clean-snapshot mutations, final current-main qualification and
independent review are pending. No JSON repair, balanced-parser, scoring, advice
policy, provider call or user-data operation is introduced.

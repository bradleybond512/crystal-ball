# Map dependency repair validation

Status: local source and macOS 27 functional checks pass; final Claude review
and packaged acceptance remain open. No push,
merge, installation or publication has occurred.

## Scope

The candidate reuses the final safe dependency patches from PR #1716 and
replaces the incompatible Mapbox adapter with upstream MapLibreOverlay.
MapLibre is 6.9.0, deck is 9.4.0 and luma is 9.4.1. Both map constructors
configure the emitted same-origin worker. The worker uses `?worker&url`: a
plain `?url` left a required sibling module unresolved. Navigation retains
its style precedence, zero-coordinate handling and fallback map. The existing
Vite optimizer now includes the actual adapter, extensions and mesh layers.

No security policy, bundle budget or performance assertion was weakened.

## Initial checks

The specialist recorded these actual results before the optimizer refinements:

```text
added 949 packages
found 0 vulnerabilities
[lockfile:check] package-lock.json version fields look valid.
# pass 7
# fail 0
# pass 232
# fail 0
# pass 33
# fail 0
# pass 13
# fail 0
✓ built in 29.74s
✓ All bundle-size policies satisfied.
sharp decode/encode smoke passed: 4x4 webp
```

The commands were `npm ci`, `npm audit --json`, `npm ls`,
`npm run lockfile:check`, `npm run typecheck:all`, focused ESLint,
`npm run test:map-compatibility`, `npm run test:emergency-pack`,
`npm run test:lifelines-map`, `npm run build`, and `npm run bundle:check`,
plus the local Sharp decode/encode probe. Main measured 442.7 KB against
460 KB; all JS measured 5.10 MB against 6 MB. These measurements precede the
optimizer-only fixes; final verification remains required.

## Failures retained

The first parent full gate stopped in the emergency-pack benchmark:

```text
# pass 231
# fail 1
error: 'cold miss p95 437.28ms exceeds 300ms'
```

Browser and type-check workloads were concurrent. This is not established as
the cause; a quiet rerun remains required. No limit was increased.

A development browser run reported four passed and one failed test. The
failed protest-pan test timed out at harness readiness before performing the
pan, including its configured retry. It does not demonstrate failed panning
logic. After aligning graphics optimization, the affected startup and pan
tests reported `2 passed (1.1m)`, with no duplicate-luma warning in that log.
The old warning and readiness failures remain in the raw evidence.

## Runtime and proof scope

A browser fixture using actual production MapLibre/deck chunks and emitted
worker passed loading under the unchanged index CSP, worker GeoJSON clustering,
keyboard movement, canvas resizing and style replacement with an interleaved
deck point retained. It produced no console errors, page errors or failed
requests. This fixture is not the complete application. Offline protocol
hit/miss validation uses the actual handler and transformation with a
controlled tile resolver; it does not prove persistent-pack import.

The initial clean proof snapshot at `536c17d37` has ten killed mutations and
one HappyDOM survivor. Actual Chromium catches that adjacent-attribute
sanitizer regression: 1 pass / 0 fail, then 0 pass / 1 fail, then restored
1 pass / 0 fail. The earlier dialog-race fixture attempt is excluded and
preserved. Proofs retain applied diffs, original/restored checksums and clean
tree status. An optimizer proof at `e80fd1824` reports 8/0, then 7/1, then
restored 8/0. Source-only checks are labeled as such.

Raw logs, runnable fixtures, screenshots and proof ledgers are retained at
`~/.crystalball-diagnostics/map-security-20260914/`.

## Remaining acceptance

Source checks, named-test gate, variant bundle measurements, bounded browser
and native navigation checks, and optimizer proofs are complete. Final
evidence closeout, real Claude review and packaged acceptance remain open;
flaky and unexplained historical runtime observations are retained.

Rollback must revert the dependency graph and compatibility changes together.
It would restore the original vulnerabilities and is an emergency fallback,
not successful remediation. No application state migration is included.

## Claude review attempt

A real Claude CLI review of source `e80fd1824` was attempted with the full
diff and source directory readable. It exited 1 without a review verdict:

```text
You've hit your session limit · resets 12:10am (America/Chicago)
```

No verdict commit was recorded. The source also subsequently advanced to
`16039e8be`, so a fresh review of the final tip is required after access
returns; this failed attempt cannot approve later changes.

The [literal mutation report](MAP-SECURITY-MUTATION-PROOFS.md) preserves
all three source snapshots, actual installed-module mutations and browser
assertions. Only whitespace-only lines are normalized for repository lint;
raw private artifacts retain every byte. Final graphics-entry removal proofs
on `16039e8be` each report 9/0, then 8/1, then restored 9/0.

## macOS 27 completion evidence

The pre-upgrade quiet run was interrupted without a final gate result. A fresh
macOS 27 run of the same named-test gate exited 0:

```text
# pass 9
# fail 0
# pass 232
# fail 0
# pass 33
# fail 0
# pass 13
# fail 0
# pass 14725
# fail 0
Secret scan passed for 4747 file(s).
✓ built in 21.64s
Agentic validation gate passed.
```

This is 15,012 passing tests with zero skips, including the unchanged
emergency-pack benchmark. Type checks and lint passed inside the gate.
The fresh audit exited 0 with all vulnerability severity counts zero; the
full-variant bundle check printed `✓ All bundle-size policies satisfied.`

Final Chromium subsets: full 2 passed; finance 4 passed; tech 2 passed and
1 flaky (the initial bases-layer miss passed on its configured retry). The
previous shader/uniform-block error remains recorded; the single quiet
production reproduction passed all 11 checks with no unexpected errors.
Neither result is relabeled as a repaired shader defect.

An additional one-shot standalone native WKWebView test on macOS 27.0/26A428
passed 10 functional assertions with no unexpected JavaScript, console or CSP
errors. System WebKit was 22625.1.29.11.27; WebGL2, actual emitted worker and
production map/deck chunks were used. Cached raster hit/miss, overlay,
Navigation GPS/route/reopen/destroy were verified. Three missing-tile errors
were intentional. Native screenshots confirmed rendered output. The
`wkwebview27/` evidence directory retains exact source/chunk/CSP/image hashes,
local requests, assertions, host source and scope.

This native test uses unchanged transpiled Navigation/protocol code and
controlled loopback tiles in a nonpersistent temporary host. It does not
certify the installed Tauri app, user profiles, native keyboard/VoiceOver or
performance. Host/server exited; no installed application was changed.

Remaining delivery gates are final evidence review, real Claude approval on
the eventual tip and separately scoped packaged acceptance. Variant bundle
measurements are recorded below. Existing browser flakiness and historical shader failure
remain visible residual risks.

## Final variant measurements

Successful tech and finance builds exited 0 on macOS 27:

```text
✓ built in 13.35s
✓ built in 14.98s
```

Full, tech and finance each printed:

```text
✓ All bundle-size policies satisfied.
```

The budget tool measured full main 442.7 KB and total 5.10 MB; tech/finance
each main 455.0 KB and total 5.11 MB. Existing main460 KB and total6 MB limits
remain unchanged. Raw Vite output uses different size presentation; these
values are the enforcement tool's measurements. The working `dist` now holds
the last finance build; native functional evidence pins the earlier full
chunks by hash, not whatever subsequently occupies `dist`.

Draft PR summary: patch vulnerable dependencies and replace the obsolete
Mapbox integration with supported MapLibreOverlay, emitted worker bundling and
aligned development dependencies. Preserve offline protocol, interleaving,
picking and navigation; attach focused/runtime/native evidence and disclosed
flaky observations. Publication remains blocked on fresh Claude review.

## Final independent audit and scope clarification

Independent audit found no blocking source/evidence findings. It verified
three native source hashes, three production chunk hashes and three snapshot
hashes, ten passing assertions and the three declared offline fixture errors.

The native harness uses source `index.html` CSP. Built HTML removes localhost
`frame-src` entries; the exercised worker/map policies match. This test is
therefore not exact packaged-CSP acceptance. It also does not instantiate the
complete DeckGLMap/Tauri application or establish VoiceOver, native keyboard,
persisted offline restart, provider behavior or a performance improvement.

The final audit does not replace Claude's required opposite-agent verdict.
No further code repair was requested by the independent audit.

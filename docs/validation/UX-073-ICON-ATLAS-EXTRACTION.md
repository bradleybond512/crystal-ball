# UX-073 — isolated DeckGL icon atlas

## Behavior and scope

[Draft #1926](https://github.com/bradleybond512/crystal-ball/pull/1926) isolates
22 canvas icon drawings and the shared atlas/mapping cache from DeckGLMap.
All 21 layer consumers retain their accessor calls, IDs and selectors. SVG and
Cesium map implementations are unchanged. The new private module has two exports
and no runtime dependency imports, so its tests need no WebGL/provider startup.

Production files are `src/components/DeckGLMap.ts` and
`src/components/deckgl-icon-atlas.ts`. Supporting changes add characterization to
`tests/map-compatibility.test.mjs`, a frozen fixture and an additive test mapping.
The atlas remains below the existing lazy DeckGLMap import boundary. No data,
permissions, package, provider, prediction, notification or persistence changes.

The literal move exposed two existing `any` declarations that the old file allowed.
A precise canvas return failed at 21 callers because installed DeckGL declarations
omit canvas inputs supported by its image runtime. Architect reviewed a type-only
IconLayerProps boundary cast; the internal cache is a precise canvas type. No lint
rule was disabled. After erasing types/comments and adding the two exports, emitted
ES2022 exactly equals the original block: 7,565 bytes, SHA-256
`76e4d0070fc72597f3eec6aa7be9f92239f5a827313b735100dc56854cc947f1`.
Two whitespace-only lines were cleaned; no runtime statements changed.

## Baseline provenance

The fixture was captured before extraction at documentation claim `0c799756b1`.
Its DeckGLMap Git blob is `08e692a9d6ffd1296deb0f0f4ea1686d73f39f16`, identical to
baseline main `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`. Fixture SHA-256 stayed
`03b3c75049ef7b43ec4f9c5765f40ed99b9d8f2d4dd20559a7420fb0a4653d97` throughout;
expectations were never regenerated after extraction. It records 22 symbols,
354 canvas operations and 21 consumers. Tests exercise both getter orders, lazy
import, object identity, 100 repeated calls, failure/retry and immediate first-use
allocation. The production getter is imported rather than shadowed or bypassed.

UX-076 metadata reconciliation only records GitHub's existing merged #1900
(November 14, `92ff943dfc96c31c1c9f399baf9e1429e75bbd75`); packaged acceptance remains
open. No merge was performed. All 40 open-main PR file lists at discovery showed
no overlap in the two proposed production paths or characterization test.

## Actual validation

Node 22 and existing lock-identical dependencies; no installation. Source/test
head: `a943d0ebf8d13d9d1e5333d701061fe1be202b8a`. Original characterization
emitted `# pass 25` and `# fail 0`; final extracted-source output follows.

```text
npm run test:map-compatibility
# tests 26
# pass 26
# fail 0

npm run typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
(exit 0)

bash scripts/agentic-validate.sh --tests "test:map-compatibility test:local-basemap test:map-clarity"
Agentic validation gate passed.
Tests run: test:map-compatibility test:local-basemap test:map-clarity

node scripts/targeted-tests.mjs
[targeted-tests] 52 script(s) passed.
```

No selected-suite failure or rerun occurred. Strict lint, secret scanning,
documentation checks, type checks and build passed. Existing Vite module-extension
and chunk-timing warnings remain; no check was weakened. The mapping-first test
repair described below occurred before final validation and independent review.

## Browser and bundle comparison

The same three existing map-harness cases passed before and after extraction:
boot without assertions, nonempty layer data and no standing repaint loop.
Both runs used full variant, Chromium 147.0.7727.15 and a 1280 by 720 viewport.
Actual Playwright summaries were `3 passed (56.1s)` and `3 passed (1.3m)`; these
run durations are not a controlled latency benchmark or a claimed speed gain.

A separate fixture-only capture blocked external browser requests and recorded
actual atlas pixels. Baseline and candidate PNG bytes and RGBA hashes are equal:
704 by 32, 7,369 nonzero-alpha pixels, RGBA SHA-256
`6b1ea2595ee6b88cb8a21e4db72d2eab8df46aea94ebd649444180323c54fdff`.
The subsequent type-only correction preserves identical emitted runtime code.
This establishes atlas pixel equality, not a full application golden comparison
or WKWebView/installed acceptance. Existing golden expectations were untouched.

Baseline and final candidate used `npm run build:full` then `npm run bundle:check`,
identical Node/dependencies, full variant, UTC and fixed build timestamp
`2026-11-27T00:00:00.000Z`. Git source revisions differ. The final candidate build
was serialized after all selected suites, some of which also rebuild the app;
intermediate overlapping/default-variant measurements are not used below.

| Measurement | Raw bytes: baseline / candidate | Gzip bytes: baseline / candidate |
| --- | ---: | ---: |
| All JavaScript | 19,174,597 / 19,174,597 | 5,371,435 / 5,371,295 |
| HTML eager preload path | 7,441 / 7,441 | 3,811 / 3,808 |
| DeckGL chunk | 184,791 / 184,791 | 51,439 / 51,326 |
| HTML module entry | 1,946 / 1,946 | 965 / 962 |
| Application main chunk | 1,626,544 / 1,626,544 | 465,389 / 465,386 |

Both builds produced 126 JavaScript chunks; DeckGL remains non-eager.
`✓ All bundle-size policies satisfied.` appeared for both. Minor compressed-size
changes do not establish a startup improvement. Work-count evidence is exact:
one first-use canvas/context allocation and no extra drawing/allocation on cached
calls. The benefit is isolated ownership and testability, not a new speed claim.

## Mutation proofs

Every final proof started from clean committed head `a943d0ebf8`, inspected an
applied diff, observed behavioral assertion failures and restored exact checksums
and clean status. Source SHA-256 values before/after:

- `deckgl-icon-atlas.ts`: `9d226595471c662558f8cea67394c3ff904358781b59524be399c8a68fa1d885`
- `DeckGLMap.ts`: `5a68e1e79fdb2c0f985762069fe38c18dfd77b84ce2cf7c2d74a20c01ecc7ea0`

| Mutation | File | Baseline pass / fail | Mutated pass / fail |
| --- | --- | ---: | ---: |
| geometry | deckgl-icon-atlas.ts | 2 / 0 | 0 / 2 |
| state-restoration | deckgl-icon-atlas.ts | 2 / 0 | 0 / 2 |
| anchors | deckgl-icon-atlas.ts | 2 / 0 | 0 / 2 |
| mask | deckgl-icon-atlas.ts | 2 / 0 | 0 / 2 |
| symbol-order | deckgl-icon-atlas.ts | 2 / 0 | 0 / 2 |
| cell-placement | deckgl-icon-atlas.ts | 2 / 0 | 0 / 2 |
| eager-allocation | deckgl-icon-atlas.ts | 1 / 0 | 0 / 1 |
| atlas-cache | deckgl-icon-atlas.ts | 2 / 0 | 0 / 2 |
| mapping-identity | deckgl-icon-atlas.ts | 2 / 0 | 0 / 2 |
| mapping-first | deckgl-icon-atlas.ts | 1 / 0 | 0 / 1 |
| white-tint-mask | deckgl-icon-atlas.ts | 2 / 0 | 0 / 2 |
| disconnected-caller | DeckGLMap.ts | 1 / 0 | 0 / 1 |

An initial run caught nine mutations but the mapping-first mutation survived
1 pass / 0 fail: a later getter initialized the cache before the assertion. The
test now checks the first returned object and allocation count immediately;
the strengthened mutation failed 0 pass / 1 fail. All twelve proofs were then
rerun on the final test commit and caught. Initial survivor evidence is retained
separately; it is not counted as a successful proof. Frozen fixture bytes never
changed. Applied diffs, raw logs and checksum receipts are in the local task
evidence directory under `next-nov27/ux073`.

## Review, remaining acceptance and rollback

Sol (`gpt-6.1-sol`, medium) and actual Sonnet (`claude-sonnet-5-5`, medium) code
reviews found zero blockers at `a943d0ebf8`. Sol independently ran 26/0 tests,
audited mutation diffs, checked runtime equivalence and compared actual PNG bytes.
Sonnet read the immutable packet without tools and did not execute tests. Final
evidence-tip review and recorded verdict are required before code publication.

Hosted acceptance remains pending separate code-push approval. After approval,
verify exact PR head and required checks while preserving draft state and
merge/delivery holds. Existing marketing/Rust audits remain separate; this PR
changes no dependency locks. No installed app, real profile, cleanup, release,
deployment or merge action was performed. No provider endpoint changed.

Rollback reunites the atlas block and removes the new import/module; adapt the
characterization loader while retaining frozen expectations. No migration or
stored-data rollback is needed. Proposed implementation commit:
`Isolate map icon ownership without changing rendering`.
Draft PR summary: isolate icon drawing/cache ownership; retain rendered pixels,
lazy loading, cache identity and every layer consumer, with baseline and mutation
proofs. Broader module extraction is outside this bounded task.

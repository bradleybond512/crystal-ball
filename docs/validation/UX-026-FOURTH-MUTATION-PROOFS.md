<!-- markdownlint-disable MD013 -- literal commands and output -->

# UX-026 Fourth-Cycle Mutation Evidence

Candidate: `a3c3c3c0c611107bac0d2a601e2823cbfe2df2ce`. Dedicated detached worktree: `/Users/bradleybond/Developer/crystalball/.worktrees/ux026-fourth-proofs-20260914`.

**55 killed / 2 survived / 0 indeterminate** across 57 bounded mutations. Baseline and restored targeted totals: 119 pass / 0 fail / 0 skipped (112 UX-026 + 7 storm adapter).

All commands used `/opt/homebrew/opt/node@22/bin` first on PATH. Each mutation began with empty Git status, preserved file bytes and SHA-256 via Python hashlib, captured a nonempty applied Git diff before testing, and restored original bytes/checksum plus empty status. The proof runner never edited delivery source or tests. Existing dependencies were linked beneath an ignored local node_modules directory; package contents were not modified.

## Evidence boundaries

- Mutations 10 and 11 are source-wiring checks. They do not themselves prove runtime cancellation or model-call counts.
- Runtime mutations execute extracted production lifecycle blocks and the real FAA panel class. External network/storage/base-panel rendering surfaces and the clock are replaced by controlled fixtures; the policy and state transitions under test run unchanged. These are not a packaged-browser end-to-end run.
- The Tab fixture dispatches the actual cancelable keyboard event to the production handler and simulates only Happy DOM’s missing default traversal when not prevented.
- The historical b81 Tab survivor and focus-entry/restoration indeterminates remain retained in the separate old evidence directory. Here all three strengthened cases must be judged by their new literal outputs; history is not rewritten.
- Optional-onset mutation 14 fails by unexpected production rejection of valid input, not an AssertionError. It is a behavior failure, not a compiler/import failure.

## Baseline and restored commands

| Suite | Baseline pass/fail | Restored pass/fail |
| --- | --- | --- |
| projection | 37/0 | 37/0 |
| nws | 31/0 | 31/0 |
| chat | 9/0 | 9/0 |
| overlay | 12/0 | 12/0 |
| lifecycle | 5/0 | 5/0 |
| storm | 7/0 | 7/0 |
| runtime | 18/0 | 18/0 |

`node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`

[Baseline](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/baseline-projection.log) · [Restored](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/restored-projection.log)

`node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`

[Baseline](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/baseline-nws.log) · [Restored](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/restored-nws.log)

`node --import tsx --test --test-reporter=spec src/services/__tests__/digest-narrative-contract.test.mts`

[Baseline](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/baseline-chat.log) · [Restored](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/restored-chat.log)

`node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`

[Baseline](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/baseline-overlay.log) · [Restored](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/restored-overlay.log)

`node --import tsx --test --test-reporter=spec tests/ux026-digest-lifecycle.test.mjs`

[Baseline](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/baseline-lifecycle.log) · [Restored](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/restored-lifecycle.log)

`node --import tsx --test --test-reporter=spec src/services/survival/__tests__/storm-posture-adapter.test.mts`

[Baseline](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/baseline-storm.log) · [Restored](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/restored-storm.log)

`node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`

[Baseline](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/baseline-runtime.log) · [Restored](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/restored-runtime.log)

## Mutation outcomes

| Mutation | Mutated pass/fail | Disposition |
| --- | --- | --- |
| 01-location-row | 10/2 | killed |
| 02-local-label-leak | 6/3 | killed |
| 03-model-narrative | 7/2 | killed |
| 04-current-lifecycle | 30/7 | killed |
| 05-cache-restamp | 30/1 | killed |
| 06-row-validation | 9/22 | killed |
| 07-retrieval-stamp | 29/2 | killed |
| 08-aggregate-projection-budget | 36/1 | killed |
| 09-unknown-evidence | 15/22 | killed |
| 10-dismiss-cancellation | 4/1 | killed |
| 11-local-reprojection | 4/1 | killed |
| 12-dismiss-notification | 11/1 | killed |
| 13-error-propagation | 6/25 | killed |
| 14-optional-onset | 28/3 | killed |
| 15-missing-onset-certainty | 28/3 | killed |
| 16-onset-ranking | 30/1 | killed |
| 17-malformed-onset | 26/5 | killed |
| 18-feature-vertices-budget | 27/4 | killed |
| 19-feature-rings-budget | 29/2 | killed |
| 20-feature-polygons-budget | 29/2 | killed |
| 21-response-vertices-budget | 29/2 | killed |
| 22-response-rings-budget | 29/2 | killed |
| 23-response-polygons-budget | 29/2 | killed |
| 24-storm-sent-fallback | 6/1 | killed |
| 25-faa-rejection-boundary | 17/1 | killed |
| 26-dialog-role | 11/1 | killed |
| 27-focus-entry | 10/2 | killed |
| 28-tab-trap | 10/2 | killed |
| 29-focus-restoration | 11/1 | killed |
| 30-escape-dismissal | 10/2 | killed |
| 31-backdrop-dismissal | 10/2 | killed |
| 32-polygon-hole | 35/2 | killed |
| 33-antimeridian-unwrapping | 35/2 | killed |
| 34-outer-boundary | 35/2 | killed |
| 35-watch-radius | 33/4 | killed |
| 36-close-accessible-name | 11/1 | killed |
| 37-digest-clock-callback | 14/4 | killed |
| 38-expiry-boundary | 14/4 | killed |
| 39-freshness-boundary | 17/1 | killed |
| 40-inclusive-freshness-boundary | 17/1 | killed |
| 41-earliest-member-boundary | 16/2 | killed |
| 42-expired-boundary-gate | 18/0 | survived |
| 43-timer-replacement | 18/0 | survived |
| 44-dismiss-timer-cleanup | 17/1 | killed |
| 45-request-timer-cleanup | 16/2 | killed |
| 46-destroy-timer-cleanup | 17/1 | killed |
| 47-visibility-refresh | 17/1 | killed |
| 48-visibility-cleanup | 17/1 | killed |
| 49-faa-independent-results | 17/1 | killed |
| 50-faa-camera-provenance | 14/4 | killed |
| 51-faa-health-snapshot | 17/1 | killed |
| 52-faa-cached-gdacs | 17/1 | killed |
| 53-faa-retained-camera-fallback | 17/1 | killed |
| 54-faa-generation-guard | 17/1 | killed |
| 55-faa-destroy-generation | 17/1 | killed |
| 56-faa-incomplete-empty-state | 16/2 | killed |
| 57-faa-missing-source-warning | 16/2 | killed |

## Literal proof records

Each record links its complete diff and untouched full output. Excerpts below are verbatim. Counts include failed parent tests as reported by Node.

### 01-location-row

File: `src/components/DigestOverlay.ts`. Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 12 pass / 0 fail → mutated 10 pass / 2 fail (exit 1); restored 12 pass / 0 fail.

```text
✖ every structured story is an article with mandatory local location and impact rows (141.052291ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /^Location:/. Input:

  ''

```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/01-location-row.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/01-location-row.log)

### 02-local-label-leak

File: `src/services/crystal-ball-chat.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-narrative-contract.test.mts`.

Baseline 9 pass / 0 fail → mutated 6 pass / 3 fail (exit 1); restored 9 pass / 0 fail.

```text
✖ digest prompt keeps alert locations local while retaining public facts and opaque tokens (4.499958ms)
  AssertionError [ERR_ASSERTION]: a breaking-news label derived from a saved-place name must stay local
```

Original and restored SHA-256: `b43c52ad638872e6f3ff78786871ceb701ade928a4efdad752be1c3b1e8c5b2b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/02-local-label-leak.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/02-local-label-leak.log)

### 03-model-narrative

File: `src/services/crystal-ball-chat.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-narrative-contract.test.mts`.

Baseline 9 pass / 0 fail → mutated 7 pass / 2 fail (exit 1); restored 9 pass / 0 fail.

```text
✖ model narrative containing reserved canonical location or impact claims falls back deterministically (5.505958ms)
  AssertionError [ERR_ASSERTION]: reserved narrative must be rejected: Location: PRIVATE_SAVED_PLACE_LABEL_ba218. Conditions may worsen.
  + actual - expected

  + 'Location: PRIVATE_SAVED_PLACE_LABEL_ba218. Conditions may worsen.'
  - 'Deterministic public fallback.'

```

Original and restored SHA-256: `b43c52ad638872e6f3ff78786871ceb701ade928a4efdad752be1c3b1e8c5b2b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/03-model-narrative.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/03-model-narrative.log)

### 04-current-lifecycle

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutated 30 pass / 7 fail (exit 1); restored 37 pass / 0 fail.

```text
✖ Test status (6.719125ms)
  AssertionError [ERR_ASSERTION]: Test status cannot support a negative
  + actual - expected

  + 'no_reported_overlap'
  - 'unknown'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/04-current-lifecycle.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/04-current-lifecycle.log)

### 05-cache-restamp

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 30 pass / 1 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ NWS retrieval evidence is stamped once and preserved by the client cache (66.212375ms)
  AssertionError [ERR_ASSERTION]: cache reads must preserve the original retrieval evidence instead of making it look newer
  + actual - expected

  + 1788437660000
  - 1788437600000
            ^

```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/05-cache-restamp.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/05-cache-restamp.log)

### 06-row-validation

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 9 pass / 22 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ malformed HTTP-200 NWS rows are never cached as current evidence (4.020292ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection: malformed HTTP-200 data must reject so the offline-cache layer owns fallback
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/06-row-validation.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/06-row-validation.log)

### 07-retrieval-stamp

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 29 pass / 2 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ NWS retrieval evidence is stamped once and preserved by the client cache (56.918542ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + undefined
  - 1788437600000

```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/07-retrieval-stamp.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/07-retrieval-stamp.log)

### 08-aggregate-projection-budget

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutated 36 pass / 1 fail (exit 1); restored 37 pass / 0 fail.

```text
✖ at-cap geometry across fifty saved places exhausts global work as unknown deterministically (792.318ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'no_reported_overlap'
  - 'unknown'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/08-aggregate-projection-budget.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/08-aggregate-projection-budget.log)

### 09-unknown-evidence

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutated 15 pass / 22 fail (exit 1); restored 37 pass / 0 fail.

```text
✖ malformed nested multipolygon data fails closed (11.185625ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'no_reported_overlap'
  - 'unknown'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/09-unknown-evidence.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/09-unknown-evidence.log)

### 10-dismiss-cancellation

File: `src/app/panel-layout.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-digest-lifecycle.test.mjs`.

Baseline 5 pass / 0 fail → mutated 4 pass / 1 fail (exit 1); restored 5 pass / 0 fail.

```text
✖ digest dismissal invalidates the generation and aborts its pending request (10.949125ms)
  AssertionError [ERR_ASSERTION]: dismissal must invalidate the captured generation
```

Original and restored SHA-256: `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/10-dismiss-cancellation.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/10-dismiss-cancellation.log)

### 11-local-reprojection

File: `src/app/panel-layout.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-digest-lifecycle.test.mjs`.

Baseline 5 pass / 0 fail → mutated 4 pass / 1 fail (exit 1); restored 5 pass / 0 fail.

```text
✖ alert and saved-place subscriptions reproject locally without another model request (3.370667ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /projectDigestStories\(/. Input:

  'const reprojectDigest = (): void => {\n' +
    ' this.cancelDigestRecheck?.();\n' +
    ' this.cancelDigestRecheck = null;\n' +
    ' if (this.destroyed || !this.digestOverlay?.isVisible() || this.digestSeeds.length === 0) return;\n' +
    ' const cards = generateDigest({\n' +
    ' seeds: this.digestSeeds,\n' +
    ' alerts: unifiedAlertStore.getAll(),\n' +
    ' savedPlaces: getSavedPlaces(),\n' +
    ' now: Date.now(),\n' +
    ' });\n' +
    ' if (cards.length > 0) {\n' +
    ' this.digestOverlay.update(cards);\n' +
    ' armDigestRecheck(cards);\n' +
```

Original and restored SHA-256: `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/11-local-reprojection.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/11-local-reprojection.log)

### 12-dismiss-notification

File: `src/components/DigestOverlay.ts`. Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 12 pass / 0 fail → mutated 11 pass / 1 fail (exit 1); restored 12 pass / 0 fail.

```text
✖ user dismissal notifies the owner after hiding the overlay (2.560834ms)
  AssertionError [ERR_ASSERTION]: one user dismissal must invalidate one pending request

  0 !== 1

```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/12-dismiss-notification.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/12-dismiss-notification.log)

### 13-error-propagation

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 6 pass / 25 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ malformed HTTP-200 NWS rows are never cached as current evidence (2.745ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection: malformed HTTP-200 data must reject so the offline-cache layer owns fallback
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/13-error-propagation.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/13-error-propagation.log)

### 14-optional-onset

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 28 pass / 3 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ missing (0.378666ms)
  Error: NWS alerts response was malformed
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/14-optional-onset.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/14-optional-onset.log)

Actual production rejection of valid optional-onset input; not an assertion or tooling failure.

### 15-missing-onset-certainty

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 28 pass / 3 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ missing (23.762416ms)
  AssertionError [ERR_ASSERTION]: missing onset cannot prove complete-negative coverage
  + actual - expected

  + 'no_reported_overlap'
  - 'unknown'

```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/15-missing-onset-certainty.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/15-missing-onset-certainty.log)

### 16-onset-ranking

File: `src/services/alert-normalizer.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 30 pass / 1 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ NWS normalization preserves onset as the ranking timestamp when present (11.352875ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 1788436500000
  - 1788436740000
           ^

```

Original and restored SHA-256: `30c192bb15af2cacbf993eae10d750f659e29d297710c58851ace6e23d3b6bc1`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/16-onset-ranking.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/16-onset-ranking.log)

### 17-malformed-onset

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 26 pass / 5 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ 123 (6.22675ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/17-malformed-onset.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/17-malformed-onset.log)

### 18-feature-vertices-budget

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 27 pass / 4 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ over-budget Polygon (35.38ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/18-feature-vertices-budget.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/18-feature-vertices-budget.log)

### 19-feature-rings-budget

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 29 pass / 2 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ feature rings (6.701375ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/19-feature-rings-budget.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/19-feature-rings-budget.log)

### 20-feature-polygons-budget

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 29 pass / 2 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ feature polygons (8.203084ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/20-feature-polygons-budget.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/20-feature-polygons-budget.log)

### 21-response-vertices-budget

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 29 pass / 2 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ response vertices (22.896625ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/21-response-vertices-budget.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/21-response-vertices-budget.log)

### 22-response-rings-budget

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 29 pass / 2 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ response rings (2.724583ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/22-response-rings-budget.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/22-response-rings-budget.log)

### 23-response-polygons-budget

File: `src/services/nws-alerts.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutated 29 pass / 2 fail (exit 1); restored 31 pass / 0 fail.

```text
✖ response polygons (7.028083ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/23-response-polygons-budget.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/23-response-polygons-budget.log)

### 24-storm-sent-fallback

File: `src/services/survival/storm-posture-adapter.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/survival/__tests__/storm-posture-adapter.test.mts`.

Baseline 7 pass / 0 fail → mutated 6 pass / 1 fail (exit 1); restored 7 pass / 0 fail.

```text
✖ adaptLiveAlert falls back to sent only when onset is absent (5.219083ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + undefined
  - '2026-06-14T09:55:00Z'

```

Original and restored SHA-256: `25d031a9863b5e0f4e539939d0fb70a25160d835baee029575cef7ef8dee8302`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/24-storm-sent-fallback.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/24-storm-sent-fallback.log)

### 25-faa-rejection-boundary

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ actual malformed camera rows preserve the existing load rejection boundary (67.234125ms)
  AssertionError [ERR_ASSERTION]: Got unwanted rejection.
  Actual message: "Cannot read properties of null (reading 'category')"
```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/25-faa-rejection-boundary.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/25-faa-rejection-boundary.log)

### 26-dialog-role

File: `src/components/DigestOverlay.ts`. Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 12 pass / 0 fail → mutated 11 pass / 1 fail (exit 1); restored 12 pass / 0 fail.

```text
✖ overlay is a labeled modal dialog with an accessible close control (8.175959ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  null !== 'dialog'

```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/26-dialog-role.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/26-dialog-role.log)

### 27-focus-entry

File: `src/components/DigestOverlay.ts`. Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 12 pass / 0 fail → mutated 10 pass / 2 fail (exit 1); restored 12 pass / 0 fail.

```text
✖ show moves focus into the dialog and Tab remains trapped (4.631916ms)
  AssertionError [ERR_ASSERTION]: focus should enter at the close control

  false !== true

```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/27-focus-entry.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/27-focus-entry.log)

### 28-tab-trap

File: `src/components/DigestOverlay.ts`. Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 12 pass / 0 fail → mutated 10 pass / 2 fail (exit 1); restored 12 pass / 0 fail.

```text
✖ show moves focus into the dialog and Tab remains trapped (8.495ms)
  AssertionError [ERR_ASSERTION]: Shift+Tab must cancel traversal out of the dialog

  false !== true

```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/28-tab-trap.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/28-tab-trap.log)

### 29-focus-restoration

File: `src/components/DigestOverlay.ts`. Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 12 pass / 0 fail → mutated 11 pass / 1 fail (exit 1); restored 12 pass / 0 fail.

```text
✖ hide restores the element focused before the dialog opened (8.206ms)
  AssertionError [ERR_ASSERTION]: dismissal must restore the exact previously focused control

  false !== true

```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/29-focus-restoration.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/29-focus-restoration.log)

### 30-escape-dismissal

File: `src/components/DigestOverlay.ts`. Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 12 pass / 0 fail → mutated 10 pass / 2 fail (exit 1); restored 12 pass / 0 fail.

```text
✖ Escape (4.725833ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  false !== true

```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/30-escape-dismissal.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/30-escape-dismissal.log)

### 31-backdrop-dismissal

File: `src/components/DigestOverlay.ts`. Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 12 pass / 0 fail → mutated 10 pass / 2 fail (exit 1); restored 12 pass / 0 fail.

```text
✖ backdrop (3.596375ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  false !== true

```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/31-backdrop-dismissal.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/31-backdrop-dismissal.log)

### 32-polygon-hole

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutated 35 pass / 2 fail (exit 1); restored 37 pass / 0 fail.

```text
✖ a saved place in a polygon hole is not treated as inside (10.628042ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'likely'
  - 'no_reported_overlap'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/32-polygon-hole.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/32-polygon-hole.log)

### 33-antimeridian-unwrapping

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutated 35 pass / 2 fail (exit 1); restored 37 pass / 0 fail.

```text
✖ an antimeridian-spanning polygon contains longitude 180 (4.301167ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'no_reported_overlap'
  - 'likely'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/33-antimeridian-unwrapping.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/33-antimeridian-unwrapping.log)

### 34-outer-boundary

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutated 35 pass / 2 fail (exit 1); restored 37 pass / 0 fail.

```text
✖ a point on the outer boundary remains in the alert area (18.894833ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'possible'
  - 'likely'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/34-outer-boundary.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/34-outer-boundary.log)

### 35-watch-radius

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutated 33 pass / 4 fail (exit 1); restored 37 pass / 0 fail.

```text
✖ near (5.681875ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'no_reported_overlap'
  - 'possible'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/35-watch-radius.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/35-watch-radius.log)

### 36-close-accessible-name

File: `src/components/DigestOverlay.ts`. Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 12 pass / 0 fail → mutated 11 pass / 1 fail (exit 1); restored 12 pass / 0 fail.

```text
✖ overlay is a labeled modal dialog with an accessible close control (69.220167ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + null
  - 'Close since-you-last-looked brief'

```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/36-close-accessible-name.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/36-close-accessible-name.log)

### 37-digest-clock-callback

File: `src/app/panel-layout.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 14 pass / 4 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ open digest expires locally without another request or store event (255.884417ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Unknown/. Input:

  'Saved-place impact: No reported overlap — no saved-place watch radius intersects the complete current NWS alert area. This is not an all-clear.'

```

Original and restored SHA-256: `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/37-digest-clock-callback.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/37-digest-clock-callback.log)

### 38-expiry-boundary

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 14 pass / 4 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ open digest expires locally without another request or store event (308.160959ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Unknown/. Input:

  'Saved-place impact: No reported overlap — no saved-place watch radius intersects the complete current NWS alert area. This is not an all-clear.'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/38-expiry-boundary.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/38-expiry-boundary.log)

### 39-freshness-boundary

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ retrieval freshness uses its inclusive boundary then turns unknown (72.962083ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Unknown/. Input:

  'Saved-place impact: No reported overlap — no saved-place watch radius intersects the complete current NWS alert area. This is not an all-clear.'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/39-freshness-boundary.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/39-freshness-boundary.log)

### 40-inclusive-freshness-boundary

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ retrieval freshness uses its inclusive boundary then turns unknown (16.801875ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Unknown/. Input:

  'Saved-place impact: No reported overlap — no saved-place watch radius intersects the complete current NWS alert area. This is not an all-clear.'

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/40-inclusive-freshness-boundary.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/40-inclusive-freshness-boundary.log)

### 41-earliest-member-boundary

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 16 pass / 2 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ earliest member boundary replaces one timer and delayed callbacks do not loop (12.348833ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 1789387202000
  - 1789387201000
             ^

```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/41-earliest-member-boundary.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/41-earliest-member-boundary.log)

### 42-expired-boundary-gate

File: `src/services/digest-alert-projection.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 18 pass / 0 fail (exit 0); restored 18 pass / 0 fail.

```text
ℹ tests 18
ℹ pass 18
ℹ fail 0
ℹ skipped 0
```

Original and restored SHA-256: `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/42-expired-boundary-gate.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/42-expired-boundary-gate.log)

Survivor: existing runtime fixtures do not distinguish the next-boundary eligibility guard. The impact evaluator still checks lifecycle independently; expiry/freshness minimum and future-boundary check remain. No claim of tested sensitivity for this isolated scheduling guard.

### 43-timer-replacement

File: `src/app/panel-layout.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 18 pass / 0 fail (exit 0); restored 18 pass / 0 fail.

```text
ℹ tests 18
ℹ pass 18
ℹ fail 0
ℹ skipped 0
```

Original and restored SHA-256: `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/43-timer-replacement.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/43-timer-replacement.log)

Survivor: cancellation inside armDigestRecheck is redundant for current exercised callers, which cancel before reaching the helper. Request, dismissal, destruction, and replacement behavior have separate killed mutations; no claim that this individual helper guard is test-sensitive.

### 44-dismiss-timer-cleanup

File: `src/app/panel-layout.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ dismissal, reopen, empty, error and destruction release temporal work (9.086917ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  1 !== 0

```

Original and restored SHA-256: `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/44-dismiss-timer-cleanup.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/44-dismiss-timer-cleanup.log)

### 45-request-timer-cleanup

File: `src/app/panel-layout.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 16 pass / 2 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ generation replacement and dismissal leave a late model completion inert (17.266125ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  1 !== 0

```

Original and restored SHA-256: `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/45-request-timer-cleanup.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/45-request-timer-cleanup.log)

### 46-destroy-timer-cleanup

File: `src/app/panel-layout.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ dismissal, reopen, empty, error and destruction release temporal work (28.884417ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  1 !== 0

```

Original and restored SHA-256: `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/46-destroy-timer-cleanup.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/46-destroy-timer-cleanup.log)

### 47-visibility-refresh

File: `src/app/panel-layout.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ document resume refreshes evidence after a suspended timer (7.875417ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Unknown/. Input:

  'Saved-place impact: No reported overlap — no saved-place watch radius intersects the complete current NWS alert area. This is not an all-clear.'

```

Original and restored SHA-256: `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/47-visibility-refresh.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/47-visibility-refresh.log)

### 48-visibility-cleanup

File: `src/app/panel-layout.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ dismissal, reopen, empty, error and destruction release temporal work (28.861125ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  1 !== 0

```

Original and restored SHA-256: `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/48-visibility-cleanup.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/48-visibility-cleanup.log)

### 49-faa-independent-results

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ successful cameras and GDACS survive rejected NWS enrichment and recover (54.446041ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Working camera/. Input:

  'NWS alert evidence unavailable; alert proximity is incomplete. Alert-proximate only0 camerasCameraLocationAlertScoreUpdatedNo camera data available.'

```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/49-faa-independent-results.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/49-faa-independent-results.log)

### 50-faa-camera-provenance

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 14 pass / 4 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ camera failure keeps previous rows and marks them stale, including refresh failure (30.224291ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Camera.*unavailable.*stale/. Input:

  ' Alert-proximate only1 camerasCameraLocationAlertScoreUpdatedWorking cameraIL—113h ago'

```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/50-faa-camera-provenance.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/50-faa-camera-provenance.log)

### 51-faa-health-snapshot

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ camera provenance is snapshotted before slower enrichment can mutate shared health (16.137292ms)
  AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /Camera refresh unavailable/. Input:

  'Camera refresh unavailable — showing stale camera data and alert context. Alert-proximate only1 camerasCameraLocationAlertScoreUpdatedWorking cameraIL—113h ago'

```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/51-faa-health-snapshot.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/51-faa-health-snapshot.log)

### 52-faa-cached-gdacs

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ GDACS tracked unavailable and cached results qualify the alert-only view (30.507916ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

  + [
  +   {
  +     id: 'old-flood'
  +   }
  + ]
  - []

```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/52-faa-cached-gdacs.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/52-faa-cached-gdacs.log)

### 53-faa-retained-camera-fallback

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ camera failure keeps previous rows and marks them stale, including refresh failure (53.810834ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Working camera/. Input:

  'Camera data unavailable — try refreshing shortly. Alert-proximate only0 camerasCameraLocationAlertScoreUpdatedNo camera data available.'

```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/53-faa-retained-camera-fallback.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/53-faa-retained-camera-fallback.log)

### 54-faa-generation-guard

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ camera load completions after a newer refresh or destruction stay inert (22.492166ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Latest camera/. Input:

  ' Alert-proximate only1 camerasCameraLocationAlertScoreUpdatedWorking cameraIL—113h ago'

```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/54-faa-generation-guard.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/54-faa-generation-guard.log)

### 55-faa-destroy-generation

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 17 pass / 1 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ camera load completions after a newer refresh or destruction stay inert (58.048417ms)
  AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /Destroyed camera/. Input:

  ' Alert-proximate only1 camerasCameraLocationAlertScoreUpdatedDestroyed cameraIL—113h ago'

```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/55-faa-destroy-generation.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/55-faa-destroy-generation.log)

### 56-faa-incomplete-empty-state

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 16 pass / 2 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ alert-only empty state admits incomplete evidence (89.035666ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /available alert evidence/. Input:

  'NWS and GDACS alert evidence unavailable; alert proximity is incomplete. Alert-proximate only0 camerasCameraLocationAlertScoreUpdatedNo cameras near active alerts.'

```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/56-faa-incomplete-empty-state.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/56-faa-incomplete-empty-state.log)

### 57-faa-missing-source-warning

File: `src/components/FAAWeatherCamsPanel.ts`. Command: `node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`.

Baseline 18 pass / 0 fail → mutated 16 pass / 2 fail (exit 1); restored 18 pass / 0 fail.

```text
✖ successful cameras and GDACS survive rejected NWS enrichment and recover (48.294416ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /NWS.*unavailable/. Input:

  ' Alert-proximate only1 camerasCameraLocationAlertScoreUpdatedWorking cameraILFlood113h ago'

```

Original and restored SHA-256: `51c4b25a6ac33e1a494f7982938d0459ab5b564c4f1eaade4733c74f26745f3b`; restored Git status empty.

[Applied diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/57-faa-missing-source-warning.diff) · [Full literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/57-faa-missing-source-warning.log)

[Machine ledger](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fourth-proofs/ledger.json)

This report establishes tested sensitivity and restoration only. Independent review, full validation, and publication approval remain separate gates.

# R4-SEC-005 / R3-SEC-009 / R4-LOW-005 validation — untrusted data into HTML

October 10: runtime checks and actual applied mutation artifacts verified privately
at code SHA `2d3de5fefaeb956fc2e5b3e870d27147d142ed69`, tree
`6b324db55f675bb995b883c6a04e3d17d3e00cfc`. This evidence update changes only
the plan and validation documents. Final document-tip validation and independent
review are separate gates. The Sonnet supplement was rejected before launch by
automatic approval review; zero requests and zero of three passes were used.
No verdict commit, push, PR-body update, merge, deployment or installation is
claimed for this scope.

The [approved plan](../plans/2026-10-02-r4-sec-005-untrusted-html.md) keeps the
October 2 decisions: fix named sinks; hide invalid stored rows and remove only on
explicit click; reject a whole invalid file. Root adopted the bounded repair under
standing authorization. Historical October 2 results remain UNATTESTED here.

## Implemented behavior

The shared validator rebuilds bounded allowlisted inventory rows. Every row writer
validates an independent candidate before persistence. Form edits reject stale
snapshots; actions/thresholds reread the latest row in their transaction. Request
success is not reported as commit; failed transactions preserve memory and storage.
Valid imports are atomic. A recoverable local queue and load generation protect
committed state from failed jobs and old refreshes.

Use/Resupply accept a complete, positive finite amount no greater than 10⁹; stock
arithmetic remains bounded. A 9,999-event log accepts its final event. At 10,000,
further tracked actions reject with a visible notice while preserving every event,
quantity, timestamp and threshold. No retention or migration is implemented.
Editable values use escaped round-trip numeric text; presentation rounding stays.

All invalid loaded rows count in the banner. A cursor supplies authoritative raw
keys for the existing bounded 5,000-row snapshot. Only an explicit Remove click
selects keys; its transaction rereads each selected row and deletes it only if still
invalid. Repaired/upserted rows and newly invalid unselected rows are preserved.
Loading never deletes data. Date/binary/array keys remain intact.

The active CountryBriefPage stock sink and original inactive modal format finite
numbers. AIS/protest sinks, adapter coercion and S2 escaped errors remain. Fresh
advisor reads validate inventory before summaries and prompts; advisor caching and
AI semantic prompt protection are outside scope. Provider requests are unchanged.
Main's notifyNative normal-priority policy and security/install scripts remain.

The CountryBriefPage lint-compatible cleanup preserves chip order, numeric/color
boundaries, truthy fallbacks, original UTF-16 flag iteration and Promise.all
enrichment order/current-country checks. PDF export synchronously parses the same
intended HTML with DOMParser into the existing iframe document; doctype, owner
document, inherited base/relative URLs, 300ms print and 5,000ms subsequent cleanup
are checked with fake timers. Native printing and resource loads are disabled in
the disposable DOM fixture.

## Actual commands and outputs

Initial strict type/lint checks passed. The first integrated untrusted runtime
reported 66 tests, 62 pass and 4 fail: three positive advisor fixtures used zero
daily rate (producing infinite days that the unchanged advisor correctly omits),
and the 5,000-row cursor assertion ran before its actual async load completed.
The preserved repair changes only those three positive inputs to finite-rate
values and waits, bounded to three seconds, for the actual hidden-row banner.
All 66 named tests, their order and every existing assertion remain. No production
guard was changed to obtain the corrected pass.

Executed `npm run test:untrusted-html` on the clean code freeze, and again after
the finite mutation campaign; actual final output:

```text
# tests 66
# pass 66
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Executed the existing full gate:

```sh
bash scripts/agentic-validate.sh --tests "test:untrusted-html test:lifelines-map test:native-notify test:maritime"
```

Actual exit 0, 87.268 seconds. ESLint, production types, secret scanning,
documentation/roadmap checks and build passed. Actual separate TAP result blocks:

| Script | Actual pass / fail blocks |
| --- | --- |
| test:untrusted-html | `# pass 66` / `# fail 0` |
| test:lifelines-map | `# pass 33` / `# fail 0`; `# pass 13` / `# fail 0` |
| test:native-notify | `# pass 5` / `# fail 0`; `# pass 75` / `# fail 0` |
| test:maritime | `# pass 131` / `# fail 0`; `# pass 29` / `# fail 0` |

All reported blocks had zero cancelled/skipped/todo. Overlapping and orchestration
results are not summed into a unique-test count. The actual changed-path selector
accepted all 18 changed paths, selected 54 existing script routes and reported no
new coverage gaps (exit 0). Only the four listed relevant scripts were executed
in this local gate; a pass for all 54 routes is not claimed.

All 5,028 tracked source contents were identical before/after the gate. QA
additionally checked all tracked contents, filesystem modes, symlink targets,
HEAD/tree/index/status before, during and after every mutation and the final
66/0 command. The original Claude checkout and its remote head were preserved.

## Applied mutation evidence

The finite inventory contains 56 source variants: 48 behavior oracles and eight
source-text call-site oracles. Actual named assertion reds and restored greens
were verified for 49 original cases and seven separately adopted private DOM
cases. Every listed variant has the actual applied patch, target before/mutant/
restored hashes, named ERR_ASSERTION, actual TAP counts and complete 5,028-file
restoration. The common clean baseline is 66 pass / 0 fail; the table reports the
actual selected red and restored-green pass / fail counts, not a fictional
selected baseline run before each mutation.

The private numeric fixtures reproduce the committed fixture byte-for-byte after
only import/URL relocation to the frozen QA source and six adopted equivalent
absence assertions. Four element-null checks use zero matches for the identical
selector; the 5,300ms frame check compares `parentNode === null` to true; Tier1
risk uses zero matches for the same selector. Inputs, production modules, timing,
text/classes, positive targets, async/lifecycle checks and no-fetch assertions are
retained. The committed 66-test source is unchanged.

| Variant | Contract | Actual red pass / fail | Restored pass / fail | Oracle |
| --- | --- | --- | --- | --- |
| m01-numeric-prefix | Reject numeric prefixes while retaining tiny and exponent precision | 0 / 1 | 1 / 0 | executed behavior |
| m02-numeric-finite | Nonfinite and nonnumeric values remain absent | 0 / 1 | 1 / 0 | executed behavior |
| m03-positive-count | Zero counts remain absent | 0 / 1 | 1 / 0 | executed behavior |
| m04-numeric-display | Hostile numeric display emits dash | 0 / 1 | 1 / 0 | executed behavior |
| m05-schema-id | String identifiers obey allowlist | 0 / 1 | 1 / 0 | executed behavior |
| m06-schema-amount-bound | Numeric amount upper bound | 0 / 1 | 1 / 0 | executed behavior |
| m07-schema-log-bound | Exactly10000 events valid without pruning | 0 / 1 | 1 / 0 | executed behavior |
| m08-schema-log-copy | Validated history events are independent copies | 0 / 1 | 1 / 0 | executed behavior |
| m09-schema-threshold-copy | Validated thresholds are independent copies | 0 / 1 | 1 / 0 | executed behavior |
| m10-schema-label-controls | Remove control/bidi label characters | 0 / 1 | 1 / 0 | executed behavior |
| m11-schema-allowlist | Drop unknown row properties | 0 / 1 | 1 / 0 | executed behavior |
| m12-schema-hidden-count | Count invalid nonstring/missing ids independently | 0 / 1 | 1 / 0 | executed behavior |
| m13-import-whole-file | DOM import rejects whole crafted file and writes nothing | 0 / 1 | 1 / 0 | executed behavior |
| m14-import-duplicate | Reject duplicate ids | 0 / 1 | 1 / 0 | executed behavior |
| m15-import-byte-bound | Reject oversized file | 0 / 1 | 1 / 0 | executed behavior |
| m16-import-item-bound | Reject excessive row count | 0 / 1 | 1 / 0 | executed behavior |
| m17-panel-id-escape | Defensive attribute escaping call site | 0 / 1 | 1 / 0 | source text |
| m18-form-quantity-precision | Actual form quantity precision survives label-only submit | 0 / 1 | 1 / 0 | executed behavior |
| m19-form-rate-precision | Actual form daily-rate precision survives label-only submit | 0 / 1 | 1 / 0 | executed behavior |
| m20-action-full-string | Use and resupply reject numeric prefixes without writes | 0 / 2 | 2 / 0 | executed behavior |
| m21-action-entry-positive | Both numeric entry points reject zero and preserve history | 0 / 1 | 1 / 0 | executed behavior |
| m22-history-limit | Both actions accept9999 then reject10000 for explicit history reason | 0 / 2 | 2 / 0 | executed behavior |
| m23-write-commit-boundary | All writer/storage abort/request/throw paths publish only committed results and alerts | 5 / 11 | 16 / 0 | executed behavior |
| m24-import-atomic | DOM import transaction covers overwritten and new rows atomically | 0 / 3 | 3 / 0 | executed behavior |
| m25-action-latest | Actual concurrent actions use latest persisted quantity and retain two events | 0 / 1 | 1 / 0 | executed behavior |
| m26-form-stale-guard | DOM stale edit preserves concurrent repair | 0 / 1 | 1 / 0 | executed behavior |
| m27-read-generation | Older readonly result cannot overwrite newer committed memory | 0 / 1 | 1 / 0 | executed behavior |
| m28-key-identity | Deletion retains actual Date/binary/array key identities | 0 / 1 | 1 / 0 | executed behavior |
| m29-remove-revalidate | Click revalidates and preserves concurrently repaired selected row | 0 / 1 | 1 / 0 | executed behavior |
| m30-hidden-accounting | Panel hidden count includes all invalid loaded rows | 0 / 1 | 1 / 0 | executed behavior |
| m31-load-bound | Cursor loads exactly5000, preserves5001 stored rows | 0 / 1 | 1 / 0 | executed behavior |
| m32-read-abort-preservation | Failed readonly snapshot preserves safe memory | 0 / 1 | 1 / 0 | executed behavior |
| m33-postcommit-memory | Committed action is retained even when refresh fails | 0 / 1 | 1 / 0 | executed behavior |
| m34-advisor-validation | Fresh real advisor context and fake AI omit invalid sentinel row | 0 / 1 | 1 / 0 | executed behavior |
| m35b-ais-change | Actual raw-relay AIS popup rejects hostile change field | 0 / 1 | 1 / 0 | executed behavior; private bounded DOM |
| m36b-ais-count | Actual raw-relay AIS popup rejects hostile count field | 0 / 1 | 1 / 0 | executed behavior; private bounded DOM |
| m37b-ais-window | Actual raw-relay AIS popup rejects hostile window field | 0 / 1 | 1 / 0 | executed behavior; private bounded DOM |
| m38b-fatalities | Actual protest popup rejects hostile fatality markup | 0 / 1 | 1 / 0 | executed behavior; private bounded DOM |
| m39b-active-stock | Actual active stock DOM rejects hostile/nonfinite/numeric-prefix field | 0 / 1 | 1 / 0 | executed behavior; private bounded DOM |
| m40-inactive-stock | Original inactive modal numeric formatter call site | 0 / 1 | 1 / 0 | source text |
| m41-maritime-changepct | Original maritime adapter changePct coercion call site | 0 / 1 | 1 / 0 | source text |
| m41-maritime-windowhours | Original maritime adapter windowHours coercion call site | 0 / 1 | 1 / 0 | source text |
| m41-maritime-darkships | Original maritime adapter darkShips coercion call site | 0 / 1 | 1 / 0 | source text |
| m41-maritime-vesselcount | Original maritime adapter vesselCount coercion call site | 0 / 1 | 1 / 0 | source text |
| m42-unrest-count | Original unrest fatality count coercion call site | 0 / 1 | 1 / 0 | source text |
| m43-s2-error-escape | Original S2 error escaping call site | 0 / 1 | 1 / 0 | source text |
| m44-country-chip-order | Extracted chips retain exact DOM order | 0 / 1 | 1 / 0 | executed behavior |
| m45-country-color-boundary | Component color includes exact70 threshold | 0 / 1 | 1 / 0 | executed behavior |
| m46-country-truthy-fallback | Empty error falls through to reason/translated unavailable text | 0 / 1 | 1 / 0 | executed behavior |
| m47-country-cancel | Old-country acquisition cannot apply to new-country DOM | 0 / 1 | 1 / 0 | executed behavior |
| m48-country-magnitude | Magnitude display includes exact1million boundary | 0 / 1 | 1 / 0 | executed behavior |
| m49-print-time | Fake print scheduled at300ms, no premature execution | 0 / 2 | 2 / 0 | executed behavior |
| m50-print-doctype | Print target retains HTML doctype and document structure | 0 / 2 | 2 / 0 | executed behavior |
| m51b-print-fallback | Absent afterprint removes frame at5300ms total | 0 / 1 | 1 / 0 | executed behavior; private bounded DOM |
| m52b-country-risk-tier | Tier1 and nontracked risk markup branches remain unchanged | 0 / 1 | 1 / 0 | executed behavior; private bounded DOM |
| m53-country-flag | Flag loop retains original UTF16 unit semantics for malformed/surrogate inputs | 0 / 1 | 1 / 0 | executed behavior |

The eight source-text rows certify those call sites, not execution of the adapter
or inactive modal. M34's actual red was `expected: 'ai'`, `actual: 'static'` after
the invalid-row filter was removed; the hostile row triggers fallback before
fake-AI assertions. It does not prove AI prompt-injection immunity. M23 reports
five passes and eleven named assertion failures in its 16-case subset, not
sixteen failures. M24 reports three named atomic-import assertion failures.

Two additional adopted private proofs qualify the shared key and candidate
boundaries:

| Private proof | Actual clean → mutant → restored | Qualification |
| --- | --- | --- |
| Existing out-of-line store raw keys | 1 / 0 → 0 / 1 → 1 / 0 | Legal existing `keyPath: null`, explicit-key writes; actual Remove must delete selected Date/binary/array keys even when `value.id` is `decoy`, while preserving decoy/repaired/unselected rows. |
| Shared final candidate validation | 1 / 0 → 0 / 1 → 1 / 0 | Conditional two-site inverse: remove upstream full-history rejection and only final-candidate validation; actual stored 10,001 events versus expected 10,000. Current-row validation remains. |

The upstream history guard alone survived the second private fixture (1 / 0),
because final candidate validation still rejected the invalid candidate; its
restored run also passed 1 / 0. This layered control is retained and is not
reported as an independent single-site kill. The coupled proof does not attest
each of the five writer paths independently. Canonical newly created inline
`keyPath: 'id'` stores cannot legally contain unequal primaryKey/value.id; no
such canonical mismatch, schema migration or installed-profile claim is made.

## Preserved failed and unexecuted attempts

Original M35 and M51 each ended with generic ERR_TEST_FAILURE / SIGKILL and no
named assertion red. The runners recorded `timedOut: false`; both restored all
5,028 files and passed their original selected green checks. Neither counts as
a mutation proof. Original M36–M39 and M52 were deliberately unexecuted with the
recursive DOM failure formatter; their separately named private counterparts
above produced bounded actual assertion reds. No failed attempt was erased.

M16's large object-diff output took 96.518 seconds but completed with a genuine
named ERR_ASSERTION and restored 1 / 0; it was not a timeout. One root read-only
artifact audit stalled and was terminated/reaped without source writes or QA/
Claude signals; a bounded same-path retry verified the artifacts. Private proof
and audit fixture additions are not permanent production seams or validation-rule
changes. No cycle budget was reset; repair cycle one of two is used.

## Artifact provenance and review boundary

Private evidence is retained outside the repository under
`approved-batch/pr1771/oct10-repair/`, including all original attempted logs,
fixture correction, normal hooks, frozen full gate, actual patches/full-state
manifests and root raw-artifact audits. Root audit SHA-256 receipts:

- Initial 48 named reds and M35 nonoracle:
  `3c6fd22ecb4937a324da6d4b73a8c13fa9b2ad86781f6f82e850d380e6899a95`.
- Original M53 named red and M51 nonoracle:
  `4c0563886f4028266f19d30f5e2ffa59d3710e8d8a23b4345d81491a632450c5`.
- Seven private inventory reds, two qualified extra reds and layered control:
  `83b9212122f56a7f37fecdcbbce0d4915386ddee379581c81a80513a86629ef6`.

Original October 2 claims of 19/19 untrusted tests, 33/33 + 13/13 lifelines tests,
25 red mutations and a passing gate are UNATTESTED for this repair. The original
source review found two P2s at `6cb10025d9881b1bcb252b4090099669e1855c9d`:
invalid action writes and lossy numeric edits. The adopted repair also covers the
active stock sink and hidden raw keys. Final independent review must use Sol
medium on the complete final diff; requested model/configuration controls are
verifiable, provider-signed runtime identity is not claimed. Sonnet disclosure
remains stopped after the second identical automatic approval rejection. No
external review/publication result is implied by this evidence document.

## Limits, manual verification and rollback

Fixtures use fake HOME/TMP/config/data/resources, cleared credentials, offline npm
and an explicit owned loopback Node guard. DOM resource loading and native print
are disabled; AI/enrichment responses and IndexedDB are disposable fakes. The
guard is a test isolation control, not an OS-wide network sandbox. No real user
database, provider request, installed/native app or real-browser acceptance was
tested. No new provider protocol or live probe is needed for the unchanged
requests; runtime provider acceptance is not claimed.

Manual acceptance still includes editing tiny/exponent values, full-history
Use/Resupply notices, invalid imports/hidden-row Remove with a concurrently repaired
row, hostile numeric feed display and browser PDF export. Those manual steps have
not been run against the installed user app.

History retention, installed profile changes, database migration and advisor-cache/
AI-prompt policies require separate work. The bounded loaded subset/export is not
a complete-store backup. Revert scoped code through the ordinary PR path; a code
revert cannot undo committed imports or explicit user deletion. Do not reset or
alter installed user databases as rollback.

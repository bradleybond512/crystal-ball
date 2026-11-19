# UX-056 — bounded storage measurement preparation

High Assurance; Bradley approved this bounded design, documentation draft claim and local implementation on November 18. Fresh main `ffb3f3ccb4` and
complete roadmap selection identify UX-056 [B] as next, with no competing claim.
This slice creates a fixture-tested measurement contract. It does not read a
profile, establish a live baseline, impose retention or complete UX-056.

## Purpose and interface

Add an isolated `src/services/storage-measurement.ts` with no runtime imports:
`getStorageMeasurementPlan()` returns fixed, source-backed scopes and metrics;
`buildStorageMeasurement(observations)` validates metadata observations and
returns a versioned report. A future separately approved collector can gather
metadata and submit this contract. This provides consistent units, ownership and
coverage rules before collection permissions or cleanup policy are introduced.
There is no collector orchestration, UI, startup hook or automatic storage access.

| Fixed scope | Classification | Allowed metrics |
| --- | --- | --- |
| Persistent-cache IndexedDB entries | Owned cache | Record count |
| Desktop persistent-cache file | Owned cache | File-length bytes |
| Shared DB snapshots | Protected evidence | Record count |
| Shared DB baselines | Protected, classification unresolved | Record count |
| Shared DB reasoning memory | Mixed, protected | Record count |
| Origin localStorage | Mixed, protected | Entry count |
| Evidence SQLite main file | Protected evidence | File-length bytes |
| Evidence SQLite WAL | Protected evidence | File-length bytes |
| Evidence SQLite SHM | Protected evidence | File-length bytes |
| Browser origin estimate | Mixed, diagnostic estimate | Estimated usage/quota bytes |

Catalog evidence: `persistent-cache.ts`, `storage.ts`, `web-secret-store.ts`,
`src-tauri/src/main.rs` and `sidecar/evidence-store.mjs`. Classification never
grants permission to delete. Existing limits are configuration, not measured use.

## Validation and privacy contract

- At most 32 observations and only ten fixed scope IDs; reject oversized input
  before processing. Ownership comes from the catalog, never caller input.
- Allow only scope ID, status and permitted metrics. Reject arbitrary labels,
  values, keys, filenames, paths, error text, extra fields, unknown scopes and
  duplicates with constant sanitized errors.
- Metrics are nonnegative safe integers. Reject non-finite/fractional values and
  unsupported metric/scope combinations. Explicitly distinguish unavailable,
  unsupported, absent, partial and complete observations. Missing scopes become
  `not-observed`, never zero. Missing metrics remain unknown; partial stays partial.
- Return scopes separately. No global sum, residual estimate, reclaimable-byte
  calculation or deduplication claim for mirrored data. File length is not
  allocated disk space; origin estimates are not per-store IndexedDB bytes;
  record counts do not imply bytes.
- Output declares `coverage: "selected-scopes"` and
  `liveBaselineEstablished: false`. Mixed/unknown ownership remains protected.
  Deterministic output must not mutate input or reflect rejected input in errors.

The shared reasoning store contains `web-secret-vault/v1`; never serialize its
values. Do not import storage constructors or instantiate EvidenceStore, whose
initialization opens WAL and verifies schema/chain state. Cognition stores are
opaque protected scopes; prediction and learning behavior remain unchanged.

## Bounded tasks and validation

1. Parent owns the approved design, documentation-only draft claim, roadmap and
   final evidence. Claim before implementation; keep live acceptance open.
2. Test engineer owns `tests/storage-measurement.test.mts`, using only synthetic
   metadata and a fixture collector. Security specialist owns only the new module.
3. Parent adds `test:storage-measurement` in `package.json`; no dependencies.
4. Tests cover units, missing/partial/absent semantics, mixed protection, malformed
   input, duplicates, overflow, no overlapping totals and input immutability.
   Synthetic secret/key/path canaries must never appear in reports or errors.
   Storage/network/filesystem access traps detect accidental runtime integration.
5. Mutation proofs remove missing-data protection, mixed ownership protection,
   duplicate rejection, metric separation and error sanitization. Record actual
   applied diffs, failing assertions/counts and restored hashes/clean state.
6. Run focused tests, type checks and secret scanning, then
   `bash scripts/agentic-validate.sh --tests "test:storage-measurement"`.
   Independent Sol and real Sonnet reviews precede the verdict and separate
   code-publication approval.

## Exclusions, risk and rollback

No live reader, profile access, deletion, migration, backup/restore, retention
policy, Settings display change, existing reader/writer edits or startup wiring.
Do not overlap #1911 backup/preflight or #1761 quota-cache work. Historical M9
sizes are not current measurements. This preparation cannot demonstrate storage
savings or a global bound.

Future live collection needs a separate approved design covering read-only APIs,
permissions, cancellation, consistency, file/SQLite handling and privacy. Full
UX-056 acceptance remains open until live measurement and classification exist.
There is no migration or persisted report; rollback removes the isolated module,
tests and script. Merging, auto-merge, releases, deployment and installation stay
paused. Requested approval covers design, documentation draft claim and this
bounded local implementation only.

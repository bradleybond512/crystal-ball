# UX-072 — bounded encrypted backup format and restore preview

Status: approved November 16 for the bounded design, documentation-only draft
claim and local implementation. Production implementation starts after the
draft claim is published; later code publication requires separate approval.
Priority A; next unclaimed task from canonical `ffb3f3ccb4` plus the complete
November 16 live-PR snapshot (25 open main PRs, 83 references, 108 entries).
Existing higher-priority work is claimed. A copied, previously reviewed
metadata correction for merged #1900 keeps its packaged acceptance in MONITOR
and clears stale active-claim metadata; it is not a second task claim.

## Outcome and boundaries

Establish a versioned encrypted format and read-only restore preview using
supplied fixtures for exactly three stores. This is not a usable backup UI or
live restore feature. Keep the rest of UX-072 open: runtime adapters, user-facing
restore authorization, multi-store consistency, crash recovery, broader history
coverage and separately authorized packaged acceptance.

Never enumerate localStorage/IndexedDB, instantiate existing stores, inspect
real profiles, access Keychain, upload data or write a destination. Exclude
credentials, browser secret vault, consent/authorization, installation identity,
telemetry, caches, other watchlists/pins, prediction/calibration/outcome history,
journals and sidecar evidence. The browser vault shares IndexedDB
`reasoning_memory`; wholesale export would include credential ciphertext.
Sidecar evidence is append-only SQLite/WAL and needs a separate consistent
snapshot/restore design. Existing credential backup scripts and their iCloud
behavior are outside this authorization.

## Store contracts and explicit policy limits

Store shapes come from the named source files. Length/count bounds below are
new v1 transport policies, not claims about existing storage limits. Reject
excess or malformed input as a whole; never trim, repair, drop or truncate it.
No retention or cleanup policy changes; UX-056 remains open.

| Catalog ID / current key | Source | Contract |
| --- | --- | --- |
| `saved-places` / `wm_saved_places_v1` | `src/services/saved-places.ts` | Array of the 14-field records below, unique IDs; nonempty array has exactly one primary. |
| `entity-watchlist` / `crystalball-watchlist-v1` | `src/services/watchlist.ts` | Records require `id`, `label`, `keywords`; independently optional `lat`, `lon`, `radiusKm`. |
| `webcam-pins` / `crystalball-pinned-webcams` | `src/services/webcams/pinned-store.ts` | Ordered array of distinct nonempty IDs. |

Each selected store allows 0–1,000 records. Reject unknown object fields,
duplicate IDs, invalid types/nulls, nonfinite numbers and unsafe integers where
an integer is required. All strings must contain valid Unicode scalar values;
reject lone UTF-16 surrogates. Byte limits refer to UTF-8; preserve accepted
strings without trimming or normalization and preserve array order.

Saved-place fields, all required:

| Fields | Constraint |
| --- | --- |
| `id`, `name`, `notes` | ID 1–256 bytes; name 0–512; notes 0–8,192. Empty names are supported by current storage. |
| `lat`, `lon` | Finite −90…90 and −180…180 respectively; zero coordinates accepted. |
| `radiusKm` | Integer 1…3,000, matching current normalization's valid output. |
| `tags` | 0–12 distinct members: home, work, family, bugout, travel, medical, supply, concern, school, shelter, critical, data_center. |
| `priority`, `sortIndex` | Safe integer priority; nonnegative safe integer sortIndex. |
| `offlinePinned`, `primary` | Booleans. |
| `source` | manual, gps, search, migrated-proximity. |
| `createdAt`, `updatedAt` | Nonnegative safe integers, createdAt ≤ updatedAt. |

Entity-watchlist IDs are 1–256 bytes; labels 0–512 bytes. Keywords allow 0–64
strings of 0–256 bytes each; preserve duplicates, empty strings and order as
the current matching behavior does. Optional latitude/longitude use geographic
bounds. Optional radius is finite and nonnegative, up to Number.MAX_SAFE_INTEGER;
do not invent a physical-distance cap. Missing optional fields remain absent.
Webcam IDs are 1–256 bytes. Reject negative zero (`Object.is(value, -0)`) in
every numeric field, including coordinates; ordinary zero remains valid.
Never silently coerce negative zero or otherwise repair input.

## Payload and exact envelope

Plaintext contains exactly `version: 1`, nonnegative safe-integer `createdAtMs`,
and `stores`. Require 1–3 distinct stores in fixed catalog order. Every store
object has exactly `id`, `schemaVersion: 1`, `count` and `records`; count equals
records.length. No profile/device identifiers or arbitrary metadata.

Validate before canonical serialization: lexicographic object-key ordering,
unchanged array order. Decode with fatal UTF-8 validation; decrypted bytes must
equal validated canonical re-encoding. This rejects duplicate JSON object keys,
noncanonical encodings and unexpected fields. Version 1 accepts only declared
schemas; no implicit legacy migration.

| Offset | Bytes | Header field |
| --- | --- | --- |
| 0 | 8 | Magic `43 42 53 54 41 54 45 00` (CBSTATE followed by NUL). |
| 8 | 1 | Format version 1. |
| 9 | 1 | Suite 1: PBKDF2-HMAC-SHA-256 and AES-256-GCM. |
| 10 | 2 | Reserved, both zero. |
| 12 | 4 | Unsigned big-endian iterations, exactly 600,000. |
| 16 | 16 | Fresh cryptographically random salt. |
| 32 | 12 | Fresh cryptographically random IV. |
| 44 | 4 | Unsigned big-endian ciphertext length, including 16-byte tag. |
| 48 | variable | Ciphertext then tag. |

AES-GCM uses a nonextractable derived key and an explicit 128-bit tag. Its AAD
is UTF-8 `crystalball-local-backup-v1` followed by NUL, then all 48 header bytes.
Reject unsupported parameters, nonzero reserved bytes, length mismatch,
trailing bytes and excessive sizes before KDF execution. No compression.
Maximum plaintext is 1,048,576 bytes, ciphertext 1,048,592 bytes, entire archive
1,048,640 bytes. Bound counts, strings and cumulative encoding before building
large serialized buffers.

Passphrases require at least 12 Unicode scalar values and at most 1,024 UTF-8
bytes, with no trimming or normalization. No recovery mechanism, plaintext/key
logging or promise of JavaScript memory erasure. Excluding credential stores
cannot certify arbitrary user-entered labels/notes as secret-free.

The existing web-secret store uses these primitives, but the new format must
not import that credential module or reuse its envelope. No new dependency.
[Web Crypto](https://www.w3.org/TR/webcrypto-1/) specifies AES-GCM/PBKDF2;
[OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
supports the 600,000-iteration PBKDF2-HMAC-SHA-256 work factor. These references
support primitive selection, not certification of this new format.

## Pure APIs and restore semantics

Three isolated modules: `src/services/local-backup/schema.ts`, `codec.ts` and
`preflight.ts`. Encryption takes a supplied validated snapshot and passphrase,
returning bytes. Decryption returns a validated backup only after authentication
and complete schema validation. Async preflight takes that backup, a supplied
destination snapshot and explicit merge/replace mode, returning a preview.
Require an explicit destination entry for every backup-selected store; missing
or null entries reject, while an explicit empty records array is valid.
No storage handle, path, write callback, network client, runtime registration,
native command, apply method or authorization override is accepted.

Every preview declares `readOnly: true`, `writes: 0` and a lowercase hexadecimal
SHA-256 destination fingerprint. Its input is UTF-8
`crystalball-local-backup-destination-v1` followed by NUL, then canonical JSON
of the selected destination store objects (`id`, `schemaVersion: 1`, `count`,
`records`) in catalog order, including record order and record timestamps but
excluding the top-level archive `createdAtMs` and unselected stores. Deep-copy
outputs; never mutate inputs.
Future writers would need a fresh fingerprint check; this stage makes no race
prevention, atomic-restore or crash-recovery claim.

| Case | Result |
| --- | --- |
| Invalid backup/destination | Reject; no preview. |
| Same ID and identical canonical record | No-op. |
| Same ID and different record in either mode | Blocking conflict regardless of timestamp; no inferred winner. |
| Merge combines incompatible primary selections | Blocking conflict; no automatic demotion/selection. |
| Conflict-free merge | Reviewable additions/no-ops; preserve destination order and append new incoming IDs in order. Webcam pins use that stable union. |
| Conflict-free replace with changes | Requires separate explicit replacement authorization; enumerate removals, additions and order changes. |
| No changes | No-op. |

Blocking conflicts take precedence over replacement authorization, which cannot
be supplied or executed in this stage. Newer or timestamp-less same-ID records
cannot be silently replaced. Unselected stores are outside the preview.

Unknown versions, tampering, wrong passphrases, unavailable crypto, schema
failures and limits produce bounded errors without plaintext details.
Authentication failure must produce no parsed payload or restore preview.

## Tests, owners and rollback

Security specialist owns the three new modules. Test engineer owns fixture and
vector tests under `tests/local-backup*` and `tests/fixtures/local-backup/`.
Parent owns one test script, targeted-test mapping, design/tracker evidence and
review. Existing stores, credential helpers, native files and runtime entrypoints
remain outside implementation scope.

Test actual Web Crypto round trips and independent fixed vectors; fresh salt/IV;
wrong passwords and header/ciphertext/tag tampering; unsupported/oversized input
rejected before KDF; every field/size boundary; unknown stores, duplicate keys
and IDs; manifest counts; coordinate zero; primary/conflict rules; fingerprint
sensitivity; deterministic previews and unchanged frozen inputs. Throwing
storage/network globals and import-boundary checks prove this stage has no
side effects, not that future restore is atomic.

Applied mutations must demonstrate red results for authentication rejection,
parameter/size guards, store/field allowlists, duplicates, record validation,
conflict/newer-record protection and fingerprint changes. Record actual counts,
applied diffs, restored hashes and clean trees. Measure synthetic-fixture KDF,
encrypt/decrypt latency and payload handling; never lower the work factor
automatically. No local native execution or real user-data reads.

Run focused tests, type checks, secrets and the named agentic gate, then both
required independent reviews. Browser/WebKit and packaged acceptance remain
future gates. Rollback removes the unconnected modules/test wiring; there is no
user-data or migration rollback. Full UX-072 remains open.

Approval covers this bounded policy/design, a documentation-only
draft claim, and local implementation. Code publication requires its later
reviewed-tip approval. Merging, auto-merge, releases, deployment and installation
remain paused.

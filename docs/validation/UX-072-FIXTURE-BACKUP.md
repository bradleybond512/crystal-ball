# UX-072 — bounded fixture backup evidence

Date: November 16, 2026. Draft #1911; local implementation only.
Source: `427578c0953fe6f348c0380332fb8e1d8bb6472f`; strengthened tests:
`35b1a7fd05ee8b656b196e3b56a46d259f318b8e`.

## Result and limits

The approved first stage implements an encrypted fixture format and read-only
restore preview for saved places, entity watchlists and webcam pins. The app has
no new backup or restore controls. All three modules are unconnected to runtime
storage, native commands, network and credentials. No user records were read or
written. Full UX-072 remains IN PROGRESS: other stores, runtime adapters, restore
authorization, crash consistency, migration and packaged acceptance remain open.
Merging, auto-merge, releases, deployment and installation remain paused.

## Files and contract

- `src/services/local-backup/schema.ts`: exact allowlisted v1 schemas, copied
  records, canonical UTF-8, catalog order, numeric/Unicode/primary constraints,
  1,000-record and 1 MiB plaintext limits including JSON escaping.
- `codec.ts`: fixed 48-byte authenticated header, PBKDF2-SHA256 at 600,000,
  AES-256-GCM with fresh salt/IV and 128-bit tag, pre-KDF format/size guards,
  generic errors and caller-input snapshots before asynchronous crypto.
- `preflight.ts`: supplied snapshots only; explicit destination entries,
  same-ID and primary conflicts block, replace changes require separate future
  authorization, stable merge order and domain-separated destination fingerprint.
  Every preview declares `readOnly: true`, `writes: 0`; no apply method exists.
- Three `tests/local-backup-*.test.mts` suites and two synthetic fixture files
  exercise actual WebCrypto against independent Node crypto. `package.json` and
  targeted-test mappings register coverage; no dependency or lockfile changed.

The [approved design](../plans/2026-11-16-ux072-fixture-backup-design.md)
contains the exact format and exclusions. Arbitrary labels/notes are not certified
secret-free; JavaScript cannot promise passphrase/plaintext memory erasure.

## Executed validation

Node 22.23.1. Command:

```sh
bash scripts/agentic-validate.sh --tests "test:local-backup test:agentic-pipeline test:sidecar-ci test:domain-retirement test:roadmap-controller"
```

Actual output excerpts, in that order:

```text
# pass 34
# fail 0
# pass 85
# fail 0
# pass 16
# fail 0
# pass 2
# fail 0
# pass 135
# fail 0
Secret scan passed for 6136 file(s).
Agentic validation gate passed.
Tests run: test:local-backup test:agentic-pipeline test:sidecar-ci test:domain-retirement test:roadmap-controller
```

The two domain-retirement results are outer orchestration tests; raw child output
is retained in the gate log. Lockfile checks, strict lint, all TypeScript configs,
secret scan, agent configuration, documentation, roadmap and build exited 0.
Scoped source/test ESLint exited 0. The five-line test-only follow-up also passed
all type checks and staged secret scanning in its commit hook; its focused suite
reported `# pass 34` / `# fail 0`. No claim is made that a mutation happened before
the initial integrated run: that first run was already green.

`node scripts/targeted-tests.mjs --list --strict` exited 0 and selected 50 scripts
with no unmapped source gap. Only the five named focused scripts above were run
locally. Wider selected suites, including native execution, require hosted
acceptance after code publication; the complete 50-suite run is not claimed.

Build emitted existing mixed static/dynamic import warnings. Roadmap review-age
advisories were retained. Synthetic measurements from the parent focused run:

```text
Synthetic 3-store/4-record encryption twice + independent decrypt + WebCrypto decrypt: 291.9ms; archive 560 bytes (measurement, no timing gate)
Synthetic 60-record encrypt/decrypt 503018 bytes: 160.4ms (measurement only)
```

These are this machine's fixture timings, not browser/WebKit performance budgets.

## Mutation evidence

Detached scratch worktrees began clean at the source SHAs above. Every mutation
saved an inspected nonempty applied diff and actual failing output, then restored
the original checksum and clean status. The first campaign caught 42 of 43.
The survivor is explicitly retained: removing only the outer archive-size guard
still rejects through the independent ciphertext bound. It is not counted as a
caught mutation. The strengthened correctly formed oversized archive then proved
removing both redundant bounds reaches KDF and fails the pre-KDF assertion.

Counts are pass/fail; groups name the mutated `src/services/local-backup/` file.

| Mutation | File stem | Before | Mutated |
| --- | --- | --- | --- |
| `unknown-store` | schema | 12/0 | 11/1 |
| `unknown-fields` | schema | 12/0 | 11/1 |
| `manifest-count` | schema | 12/0 | 11/1 |
| `duplicate-record-ids` | schema | 12/0 | 9/3 |
| `catalog-order` | schema | 12/0 | 11/1 |
| `negative-zero` | schema | 12/0 | 9/3 |
| `integer-guard` | schema | 12/0 | 10/2 |
| `temporal-order` | schema | 12/0 | 11/1 |
| `saved-radius-upper` | schema | 12/0 | 11/1 |
| `watch-radius-lower` | schema | 12/0 | 10/2 |
| `utf8-scalars` | schema | 12/0 | 11/1 |
| `utf8-byte-count` | schema | 12/0 | 11/1 |
| `name-length` | schema | 12/0 | 11/1 |
| `tag-allowlist` | schema | 12/0 | 11/1 |
| `tag-duplicates` | schema | 12/0 | 11/1 |
| `primary-cardinality` | schema | 12/0 | 11/1 |
| `record-limit` | schema | 12/0 | 11/1 |
| `cumulative-byte-limit` | schema | 12/0 | 10/2 |
| `canonical-decoding` | schema | 12/0 | 11/1 |
| `selected-destination-required` | schema | 12/0 | 11/1 |
| `kdf-work-factor` | codec | 11/0 | 4/7 |
| `header-aad-binding` | codec | 11/0 | 7/4 |
| `nonextractable-key` | codec | 11/0 | 10/1 |
| `authentication-rejection` | codec | 11/0 | 9/2 |
| `reserved-header` | codec | 11/0 | 10/1 |
| `iterations-prekdf` | codec | 11/0 | 10/1 |
| `archive-max-before-kdf` | codec | 11/0 | 11/0 |
| `exact-archive-length` | codec | 11/0 | 10/1 |
| `fresh-randomness` | codec | 11/0 | 10/1 |
| `passphrase-scalars` | codec | 11/0 | 10/1 |
| `encrypt-snapshot` | codec | 11/0 | 10/1 |
| `decrypt-snapshot` | codec | 11/0 | 10/1 |
| `same-id-conflict` | preflight | 11/0 | 9/2 |
| `primary-merge-conflict` | preflight | 11/0 | 10/1 |
| `authorization-required` | preflight | 11/0 | 10/1 |
| `blocking-precedence` | preflight | 11/0 | 10/1 |
| `stable-merge-order` | preflight | 11/0 | 8/3 |
| `replace-removals` | preflight | 11/0 | 10/1 |
| `replace-order-change` | preflight | 11/0 | 10/1 |
| `fingerprint-domain` | preflight | 11/0 | 8/3 |
| `fingerprint-record-content` | preflight | 11/0 | 8/3 |
| `fingerprint-record-order` | preflight | 11/0 | 9/2 |
| `read-only-declaration` | preflight | 11/0 | 8/3 |

Supplementary proofs on the strengthened-test commit:

| Mutation | File stem | Before | Mutated | Restored |
| --- | --- | --- | --- | --- |
| JSON escape budget undercount | schema | 12/0 | 11/1 | 12/0 |
| Remove both archive/ciphertext bounds | codec | 11/0 | 10/1 | 11/0 |

The failing assertions were respectively:

```text
not ok 8 - record counts and cumulative byte budget reject rather than truncate
not ok 5 - unsupported and malformed envelopes reject before any KDF operation
```

All original module suites restored green (12/0, 11/0, 11/0). Production source
checksums before and after every applicable mutation:

```text
schema.ts    be5ad8cd03f4b6c823406143fe438538565d939f6e364330367691c5703bbabd
codec.ts     afd26bdc12b3dd114be11c12f1f5fd3591bf6306837188e6f8d547b76c2a3309
preflight.ts 5e9a9947ffefd02386ef769754e915ec4fb1f4320fc453424759cb4094a7515c
```

Raw evidence is retained in the local task artifact directory
`next-nov16/ux072/`: `validation-gate.log`, `parent-focused.log`,
`selected-suites.log`, `mutations/results.json`, every named `.diff` and red/green
log, and `supplementary-mutations/results.json`. The latter records both restored
hashes and `clean: true`; no surviving mutation has been hidden or relabeled.

## Review and hosted status

Sonnet (`claude-sonnet-4-6`, medium) found zero blocking code findings at
`427578c095`; the actual conclusion is retained in
`sonnet-implementation-conclusion.txt`. Final independent Sol and Sonnet evidence
review and the exact-tip verdict are required before requesting code publication.

The documentation claim at `dd656772df` passed 13 of 14 hosted workflows.
Security Audit alone failed: unchanged `marketing-site` dependencies report
`0 high, 1 critical (react-server-dom-webpack:critical)`. The remaining five npm
projects reported zero high/critical findings. The separately reviewed repair is
held in draft #1904; no marketing dependency change was folded into this scope.
`claim-ci.json` and `claim-security-job.json` preserve the receipts. This is not a
green CI claim, and no check or threshold was weakened.

## Manual verification, rollback and proposed PR text

Repeat `npm run test:local-backup` with synthetic fixtures. Verify the independent
vector, wrong-password/tamper refusals, explicit empty destination handling and
blocking same-ID changes. This stage has no app UI to verify. Installed-app,
real-profile, browser/WebKit and packaged acceptance were not performed.

Rollback removes the three unused modules, fixture suites and test mappings; no
stored data or encrypted historical format was migrated. A future live writer
must separately authorize replacement and recheck the destination fingerprint;
this preview does not provide transaction or race guarantees.

Proposed PR description: establish a fixture-only encrypted local backup contract
and read-only restore preflight for three declared stores. Validate strict bounded
schemas, independent cryptographic interoperability, conflicts and no-I/O
behavior. Preserve full UX-072 as open. Focused tests and local validation passed;
mutation evidence includes the redundant-bound survivor and coupled rejection
proof. Broader hosted acceptance and the separate marketing audit remain open.

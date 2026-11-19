# UX-056 — storage measurement brief

High Assurance. Fresh main `ffb3f3ccb4`; complete live roadmap snapshot selects
UX-056 [B], with no competing claim. Existing UX-076/#1900 metadata needs the
already-reviewed reconciliation; other active storage work must remain separate.

## Objective and acceptance

Prepare a bounded, useful way to measure retained storage and classify cache
versus protected user evidence before proposing retention. Historical storage
figures are not a current baseline. Require explicit metric units, scope,
coverage gaps and unknown classifications. Unknown data stays protected.
Fixture evidence must detect secret exposure, overcounting, mixed ownership,
unsupported/missing stores and accidental writes. No global storage-limit or
live-baseline claim from fixtures.

## Constraints and non-goals

No cleanup, deletion, migration, backup/restore, retention policy or automatic
startup wiring. No credential reads, raw values/keys/paths in reports, dependency
changes, or overlapping #1911 backup and #1761 quota work. No live profile access
without specific approval. Merging, auto-merge, releases, deployment and
installation remain paused.

## Discovery and unknowns

The shared IndexedDB `reasoning_memory` store includes the secret vault; its
values must not be serialized. EvidenceStore construction opens/verifies the
WAL, so it is not a read-only measurement shortcut. Origin storage estimates
are not per-store IndexedDB sizes. Existing stores already have different bounds;
those bounds are not measured usage and do not imply data is disposable.

Architect must choose the smallest practical measurement interface, distinguish
metadata-only fixture preparation from any future live collector, and specify
exact allowed files, validation and mutation proofs. Live measurement,
permissions and baseline coverage remain open until separately authorized and
executed. Approval is required before implementation or draft publication.

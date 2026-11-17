# UX-072 — local backup and restore brief

Status: bounded design, documentation-only draft claim and local implementation
approved November 16. Publish the draft claim before implementation.
Priority A; next unclaimed task after reconciling canonical main with live draft
claims. Work stays on `codex/roadmap-next-nov16`, separate from UX-071 closeout.

## Goal and acceptance

Design a versioned, encrypted, local-only backup and verified restore for
declared user-state stores. Inventory saved places, watchlists, forecast/outcome
history, journal, pins, consent and sidecar evidence before choosing formats or
reusing key-vault helpers. State exactly what is covered and excluded.

Require fixture round trips, corrupt-input/no-write checks, explicit conflict
semantics, migration/rollback rules and separately authorized packaged acceptance.
A bounded first stage may establish a format and fixture verification without
claiming complete runtime backup/restore. Keep the remainder of UX-072 open.

## Constraints and non-goals

High assurance: data loss, privacy and filesystem/security boundaries. Exclude
credentials and Keychain access; no upload, silent overwrite of newer data,
automatic retention changes, restored consent grants, live user-data inspection,
installed-app access or application installation. Preserve UX-056 retention
constraints. Existing key backup approval does not authorize general restore.

Merging, auto-merge, releases, deployment and installation remain paused. No
production implementation before publishing the approved draft claim.

## Discovery and design ownership

Repository analyst: source-only store/ownership inventory, current persistence
and encryption helpers, migration/retention constraints, available fixture seams.
Architect: bounded first-stage proposal, interfaces, limits, error handling,
security model, merge/replace semantics, tests/mutation proof and rollback.
Parent: integrate evidence, prepare concrete approval request, then delegate
approved implementation to the narrowest specialists in disjoint file scopes.

Unknowns: stores lacking stable IDs or schemas; multi-store consistency; native
versus browser storage; private evidence or consent that must not be restored;
existing encryption compatibility; size/KDF budgets; crash-safe commit/rollback.
Resolve from code and primary documentation rather than real user records.

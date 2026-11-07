# UX-052 local dependency integration

On 2026-11-07, draft #1847 was reconciled onto local pending #1846
`bb4055611754fc1f07bd212fe1175541f3fad051`, which includes pending #1844.
This is a local dependency checkpoint, not canonical-main acceptance.

The dispatcher retains one shared Ghost hold, unknown-preference fail-closed
behavior and one suppression count. Critical reminders require both operational
warning membership and a non-derived source. The original derived cooldown,
quiet policy, bounded title accounting and silent banner behavior are retained.

The derived test fixture originally left shared unknown-mode state latched
between tests: 116/1 became 117/0 after an explicit fixture mode reset. Additional
assertions prove one Ghost count, no unknown-state count, and no recovery until
an explicit mode choice. The Ghost analyst fixture needed browser storage before
strict preference initialization and a deterministic noon clock for an eligible
derived delivery. Its original assertions were retained: 8/1 became 9/0.

## Executed proof

The combined derived/reaction/operational-consumer baseline reported `# pass 31`
and `# fail 0`. Four independently applied reversals each reported `# pass 30`
and `# fail 1`: remove operational reminder eligibility, remove derived reminder
exclusion, remove Ghost accounting, and remove the unknown-mode hold. Every
reversal began with clean Git status, produced a checked diff and was restored
to the recorded SHA-256 with clean status. [Diffs, failed assertions and restored
hashes](UX-052-INTEGRATION-MUTATIONS.json).

A transport reset interrupted an earlier gate at build. The entire gate was
rerun successfully under Node 22.23.1 using the canonical user temp directory:

```sh
VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:ux052 test:ux047 test:ux050 test:quiet-hours test:notifications test:acc509 test:native-notify test:roadmap-controller"
```

Actual output:

```text
Agentic validation gate passed.
Tests run: test:ux052 test:ux047 test:ux050 test:quiet-hours test:notifications test:acc509 test:native-notify test:roadmap-controller
[pwa:budget] 468 entries, 21.93 MiB
```

All groups reported zero failures: UX-052 117, UX-047 124, UX-050 65/4/2,
quiet-hours 126, notifications 227, ACC-509 126, native-notify 5/77 and
roadmap-controller 126. Lockfile, lint, types, secrets, documentation, roadmap
and production build passed.

## Remaining gates

The tracker is MONITOR with review after 2026-11-14. Final canonical-main
reconciliation, changed-path testing, fresh exact-head Sonnet review, verdict
and hosted checks remain required. Original isolated renderer receipts do not
prove final integrated installed-app acceptance. Installation, release, tags,
build dispatch and deployment remain paused. No new OS notification recipient
or installed profile was exercised.

Rollback must preserve the shared Ghost state and warning retirement guards
when removing derived interruption policy; do not restore either old competing
mode reader or reminders for retired warning history.

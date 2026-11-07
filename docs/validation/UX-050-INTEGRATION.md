# UX-050 local dependency integration

On 2026-11-07, the eight commits from draft #1846 were replayed cleanly onto
`56ccd569362361d92be0877980262f56aeae36da`, an explicitly local, pending #1844
warning-lifecycle dependency. This is not a canonical-main or merged checkpoint.
The original draft worktree and remote head were preserved.

The Ghost Mode shared state, unknown-preference fail-closed hold, bounded local
suppression counts and asynchronous generation check are unchanged. Vite's
startup chunk separation coexists with #1844's exact desktop fallback-port CSP.
No production repair or new design was needed during this rebase.

The full gate ran under Node 22.23.1 with the canonical user temporary directory:

```sh
VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:ux050 test:ux047 test:sidecar-fallback test:quiet-hours test:analytics-consent test:home-reassurance test:roadmap-controller"
```

Actual output included:

```text
Agentic validation gate passed.
Tests run: test:ux050 test:ux047 test:sidecar-fallback test:quiet-hours test:analytics-consent test:home-reassurance test:roadmap-controller
[pwa:budget] 468 entries, 21.93 MiB
```

UX-050 reported `# pass 65`, the clipboard group `# pass 4`, and the compiled
bundle group `# pass 2`, all with `# fail 0`. Additional groups reported:
UX-047 124/0, fallback/CSP 24/0, quiet-hours 120/0, analytics consent 40/0,
Home reassurance 27/0 and roadmap controller 126/0. The gate also passed
lockfile, lint, application/API types, secrets, cross-agent configuration,
documentation, roadmap checks and production build.

The original feature mutation receipts remain historical evidence for unchanged
logic. The tracker now honestly retains MONITOR with review after 2026-11-14.
Final canonical-main reconciliation, the broad changed-path selection, fresh
Sonnet exact-head review, verdict and hosted checks are still required. Existing
isolated Chromium/WKWebView receipts do not establish final integrated installed
app acceptance. No new native execution or physical OS notification delivery was
performed for this local dependency checkpoint.

Installation, release, tags, build dispatch and deployment remain paused. For
rollback, remove the notice, counters and shared-mode wiring together without
migrating or deleting the existing stored preference.

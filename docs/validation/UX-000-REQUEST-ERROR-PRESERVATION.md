# UX-000 request-error preservation

## Scope and behavior

PR #1728 follows the completed native test in issue 1725 and Home repair1726.
When no cloud key is configured, the runtime preserves an unsuccessful local
Response, including status, body, headers and object identity, or rejects with
the final local error from the existing retry helper. It no longer replaces
those outcomes with a synthetic missing-key503.

Production scope is only src/services/runtime.ts: a fallback-unavailable callback
and its response/error call sites. The fallback return remains unawaited inside
the local try, preventing cloud rejection from entering local catch and causing
a second cloud request. Existing authentication, routes, retries, timeouts,
key normalization and keyed fallback are unchanged. Tests use synthetic fetch
and IPC fixtures; no real provider credentials or external payloads are consumed.
No dependency, storage, native, provider or scoring changes.

## Executed validation

Supported Node22; logs retained under
`~/.crystalball-diagnostics/ux000-runtime-20260919/`.

Test-first run of the11 new runtime-preservation scenarios:

```text
5 failed
6 passed (16.1s)
```

The failures were the expected old behavior: missing/whitespace-key429,
persistent401, final connection error and caller cancellation all became503.
No fixture failure was counted as evidence.

`E2E_PORT=4203 npm run test:e2e:runtime` after the fix:

```text
22 passed (12.6s)
```

The matrix asserts original response/error identity, Retry-After and body,
exact attempt counts, refreshed local token, zero missing-key cloud calls,
local-only behavior with a key, no generated local Bearer on cloud requests,
and one cloud call when that request itself rejects.

`npm run typecheck:all`, direct ESLint on both changed files, and
`git diff --check`: exit0. The named gate
`E2E_PORT=4203 bash scripts/agentic-validate.sh --tests "test:e2e:runtime"`
exited0, including:

```text
22 passed (11.8s)
Agentic validation gate passed.
Tests run: test:e2e:runtime
```

Both focused local-only boundary suites were rerun after the change:
`node --import tsx --test src/services/__tests__/ucdp-runtime-boundary.test.mts`
and `node --test tests/openaq-local-boundary.test.mjs`, each:

```text
# pass 3
# fail 0
```

`npm run bundle:check` exited0:

```text
  total:  5.11 MB / 6.00 MB
    main-BmHfvSIC.js  raw=1.55 MB  gzip=445.4 KB
✓ All bundle-size policies satisfied.
```

## Review and mutation evidence

[Five mutation proofs](UX-000-REQUEST-ERROR-MUTATIONS.md) against commit
`564d281818a8557ec4d4bbec04125e2553ec7a52` all caught the deliberate regressions.
Baseline11 pass /0 fail became HTTP masking8/3, error masking9/2, duplicate cloud
fallback10/1, local-only escape9/2, missing-key escape6/5. Final restored suite:

```text
11 passed (6.8s)
```

Every applied diff and failing assertion is recorded. Source and test checksums
matched after every restoration and all restored worktree statuses were empty.
Independent code/security review found no actionable blocker; final evidence and
Claude exact-tip review remain required before closeout.

## Acceptance limits and rollback

This is a transport outcome-preservation repair, not proof that a provider is
available. Native useful zero-key coverage, map access and weather/unrest
classification remain open. UX-000 stays MONITOR and UX-001 blocked.

Manual verification: after the relevant repairs, rerun the retained native profile
and verify actual local errors are visible with no cloud request absent a key;
distinguish provider availability and packaged behavior from browser fixtures.
No native acceptance retest or app installation was performed for this PR.

Rollback: reviewed revert of the bounded callback and corresponding assertions.
There is no migration, credential update or persistent-data change to reverse.

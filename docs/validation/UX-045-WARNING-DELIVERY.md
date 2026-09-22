# UX-045 warning delivery evidence

## Scope and source review

PR1733 claims the approved H19 repair from PR1731. The operator approved only
moving allowed badge handling before the source cooldown, after existing user
policy gates. Other interruption limits and delivery policy remain unchanged.
No provider, native, persisted schema, inference or installed-profile changes.

Independent review of PR1731 at ac70c0f6a0db3cfb3ff9d46b0f2bad129eb2e94a
identified four blocking handoff corrections. The
[integration brief](../plans/2026-09-22-pr1731-integration.md) records their
disposition. No passing review verdict was recorded for that source PR.

## Independently reproduced before implementation

Base: 7230cef6942871fb9eea04ebed4dffdb258ca6b7. September 22, 2026.
Complete local reproduction and literal stdout are retained under
`~/.crystalball-diagnostics/pr1731-20260922/` as `r3-reproduction.mjs` and
`r3-output.json`. The script stubs Notification, localStorage and archive writes;
it asserts the advisory's dispatched trace, the warning's suppression reason,
retention of both IDs and absence of a retry on identical re-ingest. It does not
emit a real notification or modify app data.

Executed saved artifact (exit0):

```sh
TSX_DISABLE_CACHE=1 /opt/homebrew/opt/node@22/bin/node \
  --import /Users/bradleybond/Developer/crystalball/node_modules/tsx/dist/loader.mjs \
  /Users/bradleybond/.crystalball-diagnostics/pr1731-20260922/r3-reproduction.mjs
```

Literal stdout:

```json
{
  "notificationCalls": [],
  "stored": [
    "Advisory",
    "Warning"
  ],
  "initialTraceCount": 2,
  "afterRepollTraceCount": 2,
  "badgeDispatchCount": 1,
  "bannerCallCount": 0,
  "sourceRateLimitSuppressionCount": 1,
  "decisions": [
    {
      "id": "Advisory",
      "decision": "dispatched",
      "reason": "Dispatched at rung \"in_app\"."
    },
    {
      "id": "Warning",
      "decision": "suppressed",
      "reason": "source-rate-limit"
    }
  ]
}
```

This is diagnostic reproduction of the defect, not a mutation proof of a fix.
The initial typecheck attempt used incomplete dependencies and failed with
TS2307 for `@deck.gl/maplibre`. Reusing the complete matching dependency tree
resolved that environment failure; `npm run typecheck:all` then exited0.

## Implementation and executed validation

The only production edit relocates the existing eight-line badge branch in
`src/services/notification-dispatcher.ts`. Existing dispatcher trace tests are
extended; a new real-store integration test covers batch delivery and repoll.
`package.json` adds `test:warning-delivery` for repeatable targeted checks.

`npm run test:warning-delivery` before the fix:

```text
# tests 20
# pass 15
# fail 5
```

After the fix, independently repeated by the reviewer:

```text
# tests 20
# pass 20
# fail 0
```

Existing settings and batching suites, executed with `tsx --test
src/services/notifications/__tests__/notification-settings-service.test.mts
src/services/__tests__/unified-alerts-batching.test.mts`:

```text
# tests 28
# pass 28
# fail 0
```

`npm run typecheck:all`, targeted ESLint and `git diff --check`: exit0.
`bash scripts/agentic-validate.sh --tests 'test:warning-delivery'`: exit0,
including lockfile, strict lint, type checks, secrets, docs, roadmap and build:

```text
Agentic validation gate passed.
Tests run: test:warning-delivery
```

`npm run bundle:check`: exit0:

```text
    main-BCbwACLn.js  raw=1.55 MB  gzip=445.4 KB
✓ All bundle-size policies satisfied.
```

## Clean-tree mutation proof

Snapshot: `756a69572b6ab98cbf705e4849d7ab3e2c6f5d8a` in a separate detached
worktree. Each run began with empty `git status --short`; each applied
`git diff` was printed and retained before running the named suite. The changed
file was always `src/services/notification-dispatcher.ts`, starting and restored
SHA256 `223829e757f12c59b003ba4e46b9f1e3a67e1f7ab71f57f2629539c4516dab82`.

| Applied change | Actual red result | Caught assertion |
|---|---|---|
| Move badge block back below `rateLimitMap.set` | 15 pass / 5 fail | Advisory then warning yields no banner |
| Add `this.rateLimitMap.set(alert.source, Date.now())` inside badge branch | 16 pass / 4 fail | Badges consume or extend banner opportunity |
| Move badge block above Ghost/preference/quiet gates | 14 pass / 6 fail | Ghost Mode badge dispatched: `1 !== 0` |

The first confirmed diff is exactly the inverse of the production block move.
The second adds one timestamp reservation inside the allowed badge branch.
The third moves the same branch before the existing Ghost Mode gate. Complete
applied diffs and literal failing assertions are retained as `original-order`,
`badge-reservation` and `badge-before-policy` `.diff`/`.log` pairs alongside
`mutations.py` and `mutation-results.json` in the evidence directory above.
All three returned nonzero with the actual fail counts shown. After each restore,
the checksum matched and worktree status was empty. Final restored run:

```text
# tests 20
# pass 20
# fail 0
```

## Review and remaining limits

Independent source review found no production blocker, independently ran the
focused suite and audited all three applied mutation diffs, restored checksums
and successful gate/bundle logs. Outcome: no blocking findings. Exact-tip Claude
review remains required before PR closeout; do not equate this source candidate
with packaged acceptance.
No packaged native acceptance or installation was performed. The unchanged
dispatcher can still suppress a second distinct high warning during its source
cooldown, and the store does not dispatch severity updates to existing IDs.
Notification channel preference enforcement is also separate work.

Manual verification after reviewed delivery: in a controlled fixture, dispatch
an allowed advisory then a warning from the same source; only the warning should
request an OS notification. Repeat under disabled-domain, mute and Ghost Mode
settings to confirm those policies retain authority. Do not use actual weather
events to generate artificial production notifications.

Rollback: reviewed revert of the dispatcher change; no migration, credential
changes or stored-alert deletion is required.

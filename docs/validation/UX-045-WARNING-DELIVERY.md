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

## Remaining work and limits

Implementation, focused tests, mutation proof, final gate and final independent
and Claude review are pending. This document does not claim completion.
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

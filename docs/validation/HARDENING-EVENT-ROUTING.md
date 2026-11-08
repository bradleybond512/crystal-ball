# Event-store routing remainder of #1783

This bounded candidate completes the original four-path local-only restriction
on main `87cdf928964c36b14d479f10126101bacc0fbc4b`. It does not replay
the old #1769/#1778 stack or replace #1800's Unicode-safe comparison implementation.
All current auth, CSP, confirmed-port, token, supervisor and general cloud
fallback policies are preserved.

## Scope

The existing sidecar already handles GET `/api/events/health`, `/api/events/query`
and `/api/events/count`, and POST `/api/events/prune`. These exact paths now join
`LOCAL_ONLY_API_TARGETS`. Query strings do not change that classification;
neighboring paths and the general `/api/events/` prefix are not added.

On a local 503, preserve the actual response. On connection failure or an absent
confirmed port, preserve the error and existing port invalidation, without any
remote request. Existing startup retries, bearer attachment, caller cancellation
and 401 recovery remain unchanged. POST/body and personal-parameter restrictions
already blocked some event requests from cloud fallback; this change also covers
plain and otherwise eligible GET requests. No real event-store request, deletion,
credential access or cloud transmission is used for qualification.

## Tests-first and qualification boundaries

Before the production change, the actual mocked-transport runtime suite returned
20 pass / 13 fail. Failures cover exact classification and all four paths under
local 503, connection failure and no confirmed port. Adding only the four exact
entries makes the unchanged regressions pass. Existing valid cloud fallback,
method/body/personal-parameter rules and comparison regressions are run too.

The existing `test:sidecar-routing` alias runs the runtime transport and cloud
policy suites. A behavioral selector assertion verifies its actual trusted
index admission and selection for both the implementation and test file. Its
`node --test` prefix is allowlisted and its chained stages remain supported;
no package, mapping or runner-admission change is needed.

Private source-bound receipts record focused runs, detecting mutations, normal
hooks and outstanding gates. Heavy aggregate/build/full lint, genuine independent
review and hosted checks remain pending until explicitly qualified. These unit
fixtures do not prove packaged/native networking or installed/offline acceptance.
No release, deployment, installation or dispatch is authorized by this note.

The older comparison-only note described event-route availability as a dependency
of held work. On this candidate's base all four handlers already exist. Only the
renderer routing restriction remained; auth policy and handler implementation do
not need to be imported from stale ancestry.

Rollback is the bounded source/test/script/documentation change. There is no data
migration or saved-state update.

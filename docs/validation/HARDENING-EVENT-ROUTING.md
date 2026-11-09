# Event-store routing remainder of #1783

This bounded candidate completes the original four-path local-only restriction
on main `93e45f702e8b09d72a720df34bfbe03afb2b8d4b`. It does not replay
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

The source/test-byte-identical provisional integration passed all 78 suites
selected by the trusted main-owned selector over the combined 25-file future
stack, including the inherited UI and preview-origin changes. Focused routing,
normal aggregate validation with build, bundle policies and full ESLint also
passed under official Node 22.23.3/npm 10.9.9. ESLint reported 1,006 existing
findings with no increases; no baseline expansion was made. Actual-main
integration changed only inherited review records, not production or test bytes.

Four genuine earlier clean-snapshot mutations independently removed each event
path. Each started at 40 passing tests, produced 36 pass / 4 fail, then restored
40 pass / 0 fail, with no skipped or cancelled tests. Nonempty mutation patches,
raw logs and restored runtime hashes are retained in private source-bound
receipts. The restored runtime hash matches this integration. These are retained
mutation results, not newly executed mutation runs on the rebased commit.

The final HEAD-derived build/bundle, genuine independent review and hosted checks
remain pending. The provisional build is not final-HEAD artifact evidence. These
unit fixtures do not prove packaged/native networking or installed/offline acceptance.
No release, deployment, installation or dispatch is authorized by this note.

The older comparison-only note described event-route availability as a dependency
of held work. On this candidate's base all four handlers already exist. Only the
renderer routing restriction remained; auth policy and handler implementation do
not need to be imported from stale ancestry.

Rollback is the bounded three-file production/test/documentation change. There is no data
migration or saved-state update.

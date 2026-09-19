# UX-000 request-error preservation

Status: bounded High Assurance follow-up to issue 1725; user directed continuation
of the previously presented design after Home repair PR 1726 merged.
Base: 0a8fb40e7f2acf1eb5c0851c9262089252025fb6.

## Goal and acceptance

Preserve truthful local failure evidence when the desktop has no cloud fallback
key. A local unsuccessful response must retain its status, body and headers;
a rejected local request must preserve the existing retry helper's final error.
A successful local request remains unchanged. No absent-key cloud request occurs.
This improves diagnostics; it does not repair upstream availability or establish
packaged useful zero-key coverage.

## Design and boundaries

The runtime currently replaces local failures with a synthetic missing-key 503.
Pass a callback into the existing cloud fallback helper. If its existing cloud-key
lookup finds no key, invoke the callback: return the original Response for an HTTP
failure, or throw the caught error for transport failure. Keep the unawaited
return inside the local try, so a cloud rejection does not re-enter local catch.

Preserve local-only route restrictions, local Bearer injection, one 401 refresh,
existing startup retry/backoff, caller signals/default timeouts, cloud-key/header
handling and keyed cloud failure behavior. No credential reads outside existing
runtime paths, new endpoints, dependencies, logging, caches or permissions.
Do not change request normalization, token recovery or the retry helper.

## Owners and validation

Repository analyst: refresh execution path and current reproduction.
Architect: confirm minimal callback design and trust-boundary invariants.
Tauri security specialist: own src/services/runtime.ts and e2e/runtime-fetch.spec.ts;
write failing behavior tests before implementation. Parent owns roadmap/evidence.
Independent reviewer and Claude: final bounded diff and exact-tip verdict.

Acceptance tests cover local success, no-key HTTP 429 with Retry-After/body,
persistent 401 and refreshed local Authorization, final transport error identity,
local-only failures, keyed cloud success/rejection and existing timeout coverage.
Use synthetic network/IPC fixtures and no real credentials. Run existing runtime
browser suite, strict types/lint, named agentic gate, secret scans and bundle policy.
Produce clean-tree applied-diff mutation red and checksum-restored green proof.

## Risks and rollback

Callers now receive the real failure instead of a misleading generic 503, so
status-specific handling becomes observable. This is intentional; test error
identity, headers, retry count and cloud-call absence. Keyed behavior must not
change. Retain native failures as open until packaged retesting.
Rollback is a reviewed revert of the callback change and matching tests, with
no storage migration or credential change. Stop after two failed repair cycles.

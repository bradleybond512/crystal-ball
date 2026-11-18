# UX-051 — RSS request budget brief

## Goal and acceptance

Bound total RSS sidecar work below the renderer request budget, including redirects and slow upstreams, so the renderer receives a timely failure. Preserve SSRF defenses, authorization, cancellation and successful response handling. Establish current timing with fixtures before changing behavior; verify applied mutations and actual results.

## Classification and constraints

High Assurance: network boundary and cancellation behavior. Explicit design and draft-claim approval required before production implementation. No merging, auto-merge, releases, deployment or installation. No credentials, application launch or production data writes. No weakened security checks, new dependencies or unrelated feed-provider changes.

## Discovery questions

Trace renderer, proxy and sidecar deadlines, redirect/DNS/body-read ownership, disconnect cancellation, response errors and existing tests. Confirm the roadmap finding still applies and check open claims before choosing the smallest design. Distinguish deterministic request-budget evidence from live-network latency guarantees.

## Scope and remaining work

Choose a bounded change after repository analysis and architecture review. Retain existing URL/host/IP allowlists, redirect validation, authorization and error privacy. Any external-source changes require relevant live response-shape evidence; do not infer provider correctness from HTTP status alone. Broader app networking, provider policy and installed-browser acceptance remain outside this claim unless separately designed and approved.

## Selection

Fresh canonical main `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`. Complete live PR snapshot selects UX-051 [B] after existing claims, including UX-043 #1914. Reconcile the already-verified UX-076 merged #1900 metadata mismatch while retaining packaged acceptance as open.

# Explicit analytics consent repair

## Scope and acceptance

Privacy P0, high-assurance review. Only an explicit user choice can authorize analytics. Missing, malformed, unknown, or unreadable consent stays off. Preserve distinguishable explicit choices; reset ambiguous legacy upgrades off, discard their analytics identity and queue, and show the requested one-time non-blocking notice. No SDK initialization, telemetry queue, or transmission before consent; revoke during asynchronous loading must prevent initialization.

Release v2.25.147 (`bebf98915c1409b37397c2791bb90244129957c7`) inferred consent from an installation ID in `src/services/analytics.ts:97–100`. Current main partially resets ambiguous consent, but its send gate still accepts bare true, migration retains buffered data, and SDK import can outlive revocation. Rust and sidecar searches found no separate analytics consent migration or PostHog sender; native changes are unnecessary.

## Design and owners

- Analyst: trace release/main consent, SDK, settings, Rust, and CI paths read-only.
- Architect/specialist: strict stored proof, fail-closed storage handling, explicit source/reason metadata, idempotent reset, initialization-generation checks, gated PostHog/Vercel startup, and nonmodal notice.
- Test engineer: failing tests first, configured-key mocked SDK/network paths, migration fixtures, async revoke/regrant cases, existing accessibility contracts and CI wiring.
- Primary: changelog, build/type/lint/security checks, mutation evidence, independent review, and draft PR.

The user's requested migration policy authorizes resetting ambiguous consent, while preserving version-2 explicit user choices. Do not change unrelated settings, data sources, dependencies, native permissions, or marketing claims in this PR. No merge, tag, publish, deployment, or installation. Release preparation follows in a separate draft PR; marketing changes stay conditional on a published fixed release.

## Security and reliability invariants

Storage is untrusted input, not consent proof by truthiness. Storage exceptions fail closed. Revocation takes effect before fallible writes and invalidates pending imports. Automatic SDK events use the same consent gate. Legacy buffered events must never replay after a later opt-in. The repair notice must not take focus, trap keyboard navigation, or grant consent. Persistence failure may prevent a durable one-time notice; it must never enable telemetry.

## Verification plan

Run the analytics consent suite with a configured public test key, mocked SDK requests, and deterministic deferred imports; preserve explicit positive controls. Run banner accessibility cases, app/API typechecks, and `bash scripts/agentic-validate.sh --tests test:analytics-consent`. Prove regressions red before implementation and with mutations from a clean commit. Record actual outputs and independent Sonnet review before final push.

Rollback must never restore legacy implied consent or deleted buffered telemetry. Keep the default-off repair if reverting unrelated release work.

## Review-driven transport repair

Independent review reproduced the installed PostHog SDK retry queue sending after opt-out. This is not cancellation of an already transmitted request: a failed consented request can start another transmission after withdrawal. PostHog documents this as intentional behavior in [issue 5020](https://github.com/PostHog/posthog-js/issues/5020); batching and `before_send` do not close that boundary.

Use the documented [capture HTTP endpoint](https://posthog.com/docs/api/capture) for this app's existing manual events instead of the SDK. Preserve the event allowlists, public project token, configured host/web proxy, random installation ID, and explicit opt-in. Each request checks consent and generation, omits credentials, uses an abort controller with a bounded timeout, and has no automatic retry. Revocation aborts active requests and discards buffered events. An already transmitted request cannot be recalled. Page-exit events become best effort rather than using a non-cancellable beacon. Vercel stays independently consent-gated.

This is a bounded correction to the requested no-send-without-consent invariant. Do not introduce private SDK patches, global network interception, new dependencies, or a new server. Test the actual fetch boundary with held responses and revocation, including a positive opted-in control. The original configured-SDK negative control remains evidence of the prior defect, not evidence that the replacement transport passes.

## Verification evidence

- `npm run test:analytics-consent`: `ℹ pass 40`, `ℹ fail 0`.
- `npm run test:analytics-lifecycle`: `ℹ pass 19`, `ℹ fail 0`.
- `bash scripts/agentic-validate.sh --tests 'test:analytics-consent test:analytics-lifecycle'`: `Agentic validation gate passed.` This includes lockfile validation, strict lint, app/API typechecks, secret scanning, cross-agent configuration checks, documentation checks, roadmap reporting, and production build.
- Before replacing the SDK transport, the HTTP-boundary regression suite reported `ℹ pass 12`, `ℹ fail 5`; the missing abort signal and SDK import assertions failed on the old implementation.
- Clean-tree mutation at `a7367fbc316c9742d6e4c4706517503131083e05`: removed the version-proof check, active-request abort, legacy-data purge, and reset-notice branch. Inspected the applied diff. Aggregate result changed from `40 pass / 0 fail` to `26 pass / 14 fail`; restoration returned `40 pass / 0 fail` and a clean tree.
- Restored SHA-256: `src/services/analytics.ts` = `cb8295b55993a9084f53cebd893aa66a3393efbd15b4196e3c495cd98a2fb806`; `src/components/AnalyticsConsentBanner.ts` = `ec6fec35e6f97c7d02a0170ebfb36e9fd2b8e567cbac6114033a2d3fcb41e3af`.

Tests use a synthetic public project token and intercepted fetch requests, including positive opted-in delivery, delayed failure after withdrawal, timeout, ghost mode, cross-window revocation, unavailable storage, and Vercel initialization races. No production telemetry or native installation was performed. Native VoiceOver and live PostHog ingestion remain unverified; the notice's nonmodal focus and fresh-install dialog contracts are automated.

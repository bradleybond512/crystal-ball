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

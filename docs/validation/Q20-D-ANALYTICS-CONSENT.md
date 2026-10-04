# Q20 PR D validation: analytics consent is never implied (R4-LOW-001)

Plan: `docs/plans/2026-10-04-q20-remaining-lows.md` (on PR A, #1779),
approved by Bradley on October 4, 2026. Decision D: ask once more. Based on
`main`.

## What changed

- **`migrateAnalyticsConsent()` never writes `'true'`.** A pre-banner install
  with no choice stays unanswered, so the consent banner asks.
- **Every explicit choice is marked.** `setAnalyticsConsent()`, called by the
  banner and by Settings, now also writes `wm-analytics-consent-version = 2`.
- **Implied consent is reset.** A `'true'` without that marker may be the
  implied consent older builds auto-wrote. It is reset to unanswered (consent
  and prompt-seen keys removed), so the banner asks once more.
- **Explicit opt-ins and every `'false'` are kept.** The migration only reads
  them and marks the prompt seen.
- **Live effect:** none. No build sets `VITE_POSTHOG_KEY`, so analytics is
  inert; this makes the default right before a key ever ships.
- **Docs:** the header comments in `analytics.ts` and
  `AnalyticsConsentBanner.ts` now describe the opt-in model.

## Tests

- `src/services/__tests__/analytics-consent.test.mts`: 4 new tests; 14 pass,
  0 fail.
- New script: `test:analytics-consent` (also covered by `test:renderer`).

`bash scripts/agentic-validate.sh --tests "test:analytics-consent"` on the
Mac printed "Agentic validation gate passed." It covered lint:strict,
typecheck:all, secrets:scan, cross-agent:check, docs:check, roadmap:check,
the build, and `test:analytics-consent` (14 pass, 0 fail). Changed-file
ESLint is clean.

## Mutation proof (5 mutations, all red, all restored by SHA)

| ID | Mutation | Result |
|---|---|---|
| D01 | implied consent kept | red (1 failing), restored `cd187209e475` |
| D02 | explicit choice not marked | red (1 failing), restored `cd187209e475` |
| D03 | old auto-grant restored | red (2 failing), restored `cd187209e475` |
| D04 | reset leaves prompt marked seen | red (1 failing), restored `cd187209e475` |
| D05 | opt-out not marked seen | red (1 failing), restored `cd187209e475` |

## Follow-ups

- **R4 status table:** the R4 doc lives on the handoff branch, so mark
  R4-LOW-001 there when it merges.

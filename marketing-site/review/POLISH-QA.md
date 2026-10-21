# Final polish verification

Risk tier: Low. Marketing copy, shared facts, screenshot assets, and regression coverage only. No application code, dependencies, SEO policy, CSP, deployment, installation, or merge changes.

## Acceptance evidence

- Genuine installed-app capture shows the anonymous usage analytics toggle OFF. It was turned off through the app UI at the user's explicit request and left off. No credentials or private contact fields appear in the capture.
- Briefing uses a new Home Shell screenshot showing source readiness and Personal / What changed cards. Hero is unchanged.
- Check-ins are explicitly manually copied; family location codes are manually exchanged. No automatic delivery claim.
- Map and specifications consume the same `mapCategories` array in `data/site.json`.
- All four decorative timeline markers remain `aria-hidden="true"`; edition cards visibly display `Best for:`.
- Named features were audited against latest release v2.25.147, peeled source commit `bebf98915c1409b37397c2791bb90244129957c7`. See `POLISH-RELEASE-SOURCES.md`. Newer source features are qualified adjacent to their claims; universal opt-in wording is corrected for legacy release upgrades.
- Desktop and mobile hero/stat screenshot SHA-256 comparisons are identical before and after. All sections have before/after screenshots at 1440×1000 and 390×844 viewports.

## Checks

- Site `npm run typecheck`: exit 0.
- Restored `node --test marketing-site/tests/*.test.mjs`: `ℹ pass 29`, `ℹ fail 0`.
- Desktop/mobile browser checks: all five routes have one h1, no overflow, no broken images; skip link and expandable specifications work by keyboard; reduced-motion animations are `none`.
- Repository gate `bash scripts/agentic-validate.sh --tests test:marketing`: exit 0, `Agentic validation gate passed. Tests run: test:marketing` (site and app/API types, lint, secrets, docs, and production builds).
- Independent reviewer: zero remaining blocking findings after fixing Docs' readiness wording and the unreleased in-app confirmation claim.
- Initial mobile Lighthouse: Performance 72, Accessibility 100, Best Practices 100, SEO 100; CLS 0. This run overlapped repository typechecking and screenshot capture. Retained as `lighthouse-polished.report.*`; isolated repeat is recorded below.

- Same-session baseline rebuilt from pre-polish renderer/styles/data at `b9c408a5`: Performance **79**, Accessibility **100**, Best Practices **100**, SEO **100**. Polished isolated repeat: **74 / 100 / 100 / 100**, CLS **0**. The older enrichment report scored 98 Performance; that result was not reproduced in this session. Both current runs fall below the requested 95 Performance target. Long tasks are dominated by layout/other main-thread work; no added JavaScript is present. This is an unresolved performance limitation, not a claimed pass or a proven environment-only cause. No unrelated performance changes were made under the “change nothing else” scope.

## Mutation proof

Started from clean commit `3b4d11a4`. Original `marketing-site/lib/render.ts` SHA-256: `5891bd9d27259fa34ebca6a66faac12d5a4d8f9d0a767853e8739443963a458a`.

Temporarily removed MCP release badges, omitted waterways from specifications, and restored the Library image in Briefing. Inspected the applied diff (`polish-mutation.diff`), rebuilt, and ran the suite: **26 pass / 3 fail**, one failure for each regression. Restored the original file, confirmed the identical checksum and clean git tree, rebuilt: **29 pass / 0 fail**. Full outputs are retained beside this report.

## Limits and review

Exact tagged source was inspected; published release binaries, signing, notarization, and upstream provider availability were not executed or independently validated. Native VoiceOver was not run; semantic, keyboard, reduced-motion, and Lighthouse accessibility checks were run. “Coming in the next release” identifies implemented source features absent from the audited release; it does not promise a date.

The maintained braces dependency mitigation and manual dependency-change approval gate are inherited from earlier work on this PR; this polish does not modify them. PR remains draft, auto-merge disabled. Reviewer can compare the six before/after groups in the PR, inspect the adjacent release badges, open technical specifications, and review Privacy's legacy-upgrade exception.

Rollback: revert the final-polish commits to retain the prior enrichment. Analytics remains OFF in the user's installed app; reverting website commits does not change that preference.

# Marketing review evidence

Review date: 2026-10-18. No website deployment, app install, merge or auto-merge is authorized by this work. Two draft PRs: copy/source import, then dependent layout/media.

## Results

| Mobile Lighthouse 12.8.2 | Performance | Accessibility | SEO |
| --- | ---: | ---: | ---: |
| Before: published site | 54 | 100 | 100 |
| Copy baseline: local production build | 65 | 100 | 100 |
| Layout: local production build | 99 | 100 | 100 |

Same Lighthouse mobile defaults and headless Chrome. Local and hosted network conditions differ; these are individual lab runs, not field measurements. Repeat on the deployed site after review. Raw JSON and HTML reports are in this directory.

- Marketing typecheck, lint and production build pass. Behavioral tests: 9 pass / 0 fail.
- Root `bash scripts/agentic-validate.sh --tests test:marketing` passed, including lint, both app typechecks, secret scan, docs, cross-agent readiness and app build. Captured log precedes the final syntax-aware count correction and extra media assertions; affected marketing checks were rerun.
- Link audit: 49 pass / 0 fail / 0 HTTP 404. Download bodies were not downloaded. Remote fragments are not checked. `links.json` records methods, URLs and statuses.
- Schema.org Markup Validator: one SoftwareApplication, zero errors, zero warnings. `schema-validator.json` contains actual browser output. No ratings or awards were invented to meet rich-result requirements.
- All five routes checked at 1440×1000 and 390×844: no horizontal overflow or broken images; exactly one h1. Keyboard skip link focuses; reduced-motion disables reveal animation. Separate section captures hide fixed header/skip chrome to show the whole section. Navigation captures preserve actual UI.
- Product images: five unique real captures, responsive 800/1600 WebP; hero eager/high priority, others lazy. OG PNG is 1200×630 and under 300 KB. Original captures remain in the copy commit history.
- Inline CSS and JS minified during build; HTML inter-tag whitespace removed; gzip negotiation and decompression round trip tested. Existing CSP retained.
- Full panel count is 409, correcting the requested 408. AST parsing catches two entries sharing source line 81. Other variants: shared data and source tests. Sonnet’s initial 409 observation was correct; the earlier line-based audit was not.

## Limitations and blockers

- This is a review draft, not security/release sign-off. Production dependency audit has zero advisories. The imported development toolchain still has eight high advisories through unpatched `braces <=3.0.3` (GHSA-vfj7-8cjw-p6xm). npm’s proposed fix downgrades the framework tooling; no broad force-fix is applied. Resolve or explicitly accept this toolchain risk before release approval.
- DMG signing/notarization, native runtime behavior of every panel/tool, Windows/Linux parity and cloud-provider contracts were not verified. Copy states these limits.
- Released binaries are from July 20; reviewed source and installed-app screenshots are newer. Release and source dates remain distinct.
- Repository description and release-header wording are in `REPOSITORY_COPY.md` for review; remote metadata is not published ahead of the user’s review.
- Claims, source SHA, release version/date and asset filenames are frozen in `data/site.json`; future releases require an explicit data refresh. Direct downloads pin the latest verified release so later releases do not break old filenames.

## Manual review and rollback

Open the home, download, docs, privacy and security pages; use Tab/Enter through navigation and disclosure controls. Check desktop/mobile section images and CLAIMS.md. Review copy first, then the dependent layout diff. Both PRs target main; the layout PR includes the copy commit until the first PR merges. Never auto-merge. Roll back a future deployment by redeploying the previous Sites version; these PRs themselves do not deploy.

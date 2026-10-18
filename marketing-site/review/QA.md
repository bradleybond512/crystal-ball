# Marketing review evidence

Review date: 2026-10-18. No website deployment, app install, merge or auto-merge is authorized by this work. The latest user request consolidates the work into one draft PR, including the initial source import and the expanded Apple-style page.

## Results

| Mobile Lighthouse 12.8.2 | Performance | Accessibility | SEO |
| --- | ---: | ---: | ---: |
| Before: published site | 54 | 100 | 100 |
| Copy baseline: local production build | 65 | 100 | 100 |
| Layout: local production build | 99 | 100 | 100 |

Same Lighthouse mobile defaults and headless Chrome. Local and hosted network conditions differ; these are individual lab runs, not field measurements. Repeat on the deployed site after review. Raw JSON and HTML reports are in this directory.

- Marketing typecheck, lint and production build pass. Behavioral tests: 18 pass / 0 fail.
- Root `bash scripts/agentic-validate.sh --tests test:marketing` passed, including lint, both app typechecks, secret scan, docs, cross-agent readiness and app build. Captured log precedes the final syntax-aware count correction and extra media assertions; affected marketing checks were rerun.
- Link audit: 54 pass / 0 fail / 0 HTTP 404, including every srcset candidate. Download bodies were not downloaded. Remote fragments are not checked. `links.json` records methods, URLs and statuses.
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
- Human-reviewed claims and canonical URLs remain in `data/site.json`. Each build derives panel/tool/edition/platform counts and resolves latest release URLs/sizes/checksums into ignored `data/generated.json`. Release discovery failure discards stale assets and uses `/releases/latest`. Source links follow main; the checklist retains the reviewed SHA.

## Manual review and rollback

Open the home, download, docs, privacy and security pages; use Tab/Enter through navigation and disclosure controls. Check desktop/mobile section images and CLAIMS.md. Review the single PR against main. Never auto-merge. Roll back a future deployment by redeploying the previous Sites version; this PR does not deploy.

## Expanded page verification

The latest request adds sourced feature tiles, a generated numbers band, keyboard-operated specifications, plain section labels, unique disclosure names, a single capture note and build-time static sitemap. Before screenshots are in `before/`; expanded screenshots are in `screenshots/`. The expanded-page Lighthouse run initially scored 84/100/100/100 during concurrent screenshot work and reported a cache-clear timeout; raw evidence is retained. The quiet final run scored 99 Performance / 100 Accessibility / 100 Best Practices / 100 SEO, no warnings and CLS 0. The local pre-expansion run scored 98 / 100 / 100 / 100 (with a cache-clear timeout warning). Both four-category raw reports are retained.

The deterministic generator tests exercise adjacent panel declarations, duplicate rejection, actual registry annotations, build-target discovery, explicit-only OS minimums, latest release/manifest agreement, network errors/timeouts, missing architectures and missing checksums. No binaries are downloaded during generation.

Mutation proof for the original route/media safeguards: starting from clean `f1c534f`, changed 409→408, hero high→low priority and disabled gzip. Confirmed applied diff is `mutation-applied.diff`; tests changed from 9 pass / 0 fail to 6 pass / 3 fail (`mutation-red.txt`). Restored all three files with matching SHA-256 and an empty git status before feature expansion. Pre-rewrite worker also produced 0 pass / 4 fail (`baseline-red.txt`).

Generator mutation proof: clean `37dfd64`, reduced derived panel counts by one and removed malformed URL filtering. Confirmed diff: `generator-mutation.diff`. Generation tests changed from 7 pass / 0 fail to 5 pass / 2 fail (`generator-mutation-red.txt`); restoring the file matched SHA-256 a2c63d61d2f976470eaccb95d5e5458bab5607fdf046b14de4542c71ffead909 and returned a clean working tree and 7 pass / 0 fail.

# Rendering investigation

Lighthouse uses the existing mobile methodology: Lighthouse 12.8.2, headless Chrome, default simulated mobile throttling, all four categories. Runs are serialized after other build/lint/capture work stops. These are laboratory measurements, not field performance guarantees.

| Candidate | Performance / Accessibility / Best Practices / SEO | LCP | TBT | Initial CLS | Status |
|---|---|---|---|---|---|
| Historical polished isolated report | 74 / 100 / 100 / 100 | 1.5 s | 1,500 ms | 0 | Earlier baseline |
| Automatic offscreen containment | 100 / 100 / 100 / 100 | 1.522 s | 3 ms | 0 | **Rejected**: cold browser find moved the result 129 px after reveal |
| Eager section containment | 86 / 100 / 100 / 100 | 1.659 s | 547 ms | 0 | Below the requested 95 performance target |
| **Final: eager section and nested layout isolation** | **98 / 100 / 100 / 100** | **1.664 s** | **2 ms** | **0** | Meets the requested mobile targets |

`lighthouse-part3-containment.report.*` is superseded experimental evidence, **not a successful final result**. The automatic visibility rule and estimated intrinsic heights were removed. Excluding only the last text sections did not resolve the find regression and was not retained.

The original mobile DevTools trace showed a 521 ms layout affecting 340 nodes, followed by 99 ms affecting 325 nodes. Disabling paragraph pretty wrapping did not resolve this. Typography is unchanged. The section-only report attributes 792 ms to style/layout and only 39 ms to script execution. The final two CSS rules use `contain: layout style paint` on product sections and `contain: layout style` on their feature grids/tiles, edition grid, example blocks, prompt examples and day grid. This limits layout propagation while keeping all text eager; there is no automatic visibility, size containment or estimated height. Final total main-thread work is 608 ms.

## Browser regression method

`node scripts/check-rendering.mjs` compares every descendant's geometry, text, font, foreground and background colors with containment disabled, at 1440, 390 and 320 px. It separately loads fresh documents for actual wheel scrolling, keyboard details controls, deep anchors and three cold browser-find targets, with an unexpected-layout-shift budget below 0.01. It also checks the skip link and horizontal overflow.

Visual comparison mutations are recorded separately from production interaction CLS. Earlier screenshot/containment-toggle measurements included deliberate test mutations and were not accepted as production scroll evidence. A separate real full-page wheel-scroll probe had zero shifts; the cold-find probe still exposed the genuine 129 px regression and caused rejection of automatic containment.

Raw PNG equality is not claimed. Removing a paint boundary changes glyph antialiasing despite identical geometry and font/color values. Screenshot inspection remains required for clipping, focus outlines, shadows and image framing; no broad pixel mismatch allowance was introduced.

## Final evidence

- `lighthouse-part3-nested.report.json` and `.html`: final 98/100/100/100 result. The eager-only and automatic-visibility reports are diagnostic history, not final results.
- `part3-rendering-checks.jsonl`: all 13 sections at 1440, 390 and 320 px retain exact descendant geometry, text, fonts and colors compared with all section/descendant containment disabled. Full wheel scroll, keyboard controls, cold `#mcp` navigation, and independent cold finds for Intelligence, Preparedness and Open source all pass. Every production, anchor and find shift array is empty (CLS 0). Comparison-only mutation shift arrays are also empty for the final eager implementation.
- `part3-rendering-mutation-evidence.json`: isolated byte-identical source snapshot and browser-only removal of section containment; the assertion rejects the mutation. Restored source is rerun and hashes checked. This does not mutate the production preview or shared source tree.
- Before/after screenshots: `part3-before/` and `part3-after/`. Desktop Privacy and mobile Intelligence were visually compared for screenshot framing, border/shadow clipping, text wrapping and section spacing. No unexpected visual change was found; the Privacy copy differences are the separate release-accuracy corrections. Full-route screenshot checks are in `part3-after-browser.json`.
- Build, script syntax and changed-script ESLint pass. Full marketing typecheck/tests are recorded by the page implementation checks.

No claim of exact pixel equality is made across removal of a paint boundary. The final implementation preserves measured geometry/typography and has been visually inspected. These lab results do not promise identical scores on every device or future run.

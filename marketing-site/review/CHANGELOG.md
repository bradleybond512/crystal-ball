# Marketing changelog

- Added source-backed feature tiles, generated numbers, and expandable technical specifications.
- Preserved the hero, Apple-style layout, accessibility, privacy qualifications and early-access disclaimer.
- Derived panel and MCP counts from code; latest-release URLs, sizes and checksums now refresh at build time.
- Replaced the sitemap rendering route with a static build artifact; removed generic disclosure names and repeated capture dates.
- Kept source/license links on main and documented unknown OS minimums and unverified signing.

Verification: 19 tests pass. Final mobile Lighthouse: 99 Performance, 100 Accessibility, 100 Best Practices, 100 SEO; CLS 0. Links: 54 pass, zero 404s. Before/after screenshots and the claim checklist accompany this single draft PR. Existing high development-toolchain advisories remain a release blocker; no merge or deployment is performed.

- Serve the generated sitemap without relying on a Cloudflare binding, including after a local production-server restart.

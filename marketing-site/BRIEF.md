# Marketing site review

Scope: import the confirmed Sites source (project appgprj_6a67d6f7f5fc8191ace93399c51b354c, published commit 8fee5e7919ea51918c9585c0cceaddc481c7b70e) into this repository for review, then rewrite its copy and layout.

Risk: medium, bounded marketing UI. No desktop app behavior, providers, credentials, releases, installation code, or hosting audience changes.

Acceptance: sourced shared counts; requested calm copy; macOS primary/experimental Windows and Linux; real screenshots; explicit cloud/privacy limits; direct verified downloads; download/docs/privacy/security routes; accessible headings/navigation; SEO metadata, robots, sitemap, validated JSON-LD; minified compressed output; mobile Lighthouse and link evidence; desktop/mobile section screenshots.

Tasks: repository_analyst verifies claims (read-only); architect designs a minimal server-rendered structure (read-only); ui_map_engineer implements copy/shared data/templates; root implements routes, media processing, tests and verification; independent reviewer reviews completed changes. The latest user request consolidates delivery into one PR, with before/after desktop and mobile screenshots, sourced feature tiles, generated counts/releases and a static sitemap. User reviews and merges; no auto-merge, deployment or app installation.

The user's explicit marketing task takes priority over unrelated desktop UX roadmap tasks. No UX/ACC task is claimed or marked complete.

Baseline: live site mobile Lighthouse 12.8.2: Performance 54, Accessibility 100, SEO 100. Reports and detailed conditions are attached with the completed review evidence.

## Refinement — same depth, less repetition

Standard / medium risk. Keep the hero, design tokens, existing unique real screenshots, accessibility, SEO, build-derived facts, and essential safety/privacy qualifications. Replace each feature disclosure/restatement with its existing three tiles, one specific link, and at most one short caveat; keep the four-card edition comparison. Show profile counts only in AI assistants and specs, platform status only in hero/specs/FAQ, omit unset OS minimums, show version without a publish date in specs, and use the requested benefit-oriented stats labels.

Owners: copy_architecture verifies source claims and designs the minimal template change; root updates tests and coordinates visual/CI verification; dependency_repair investigates and repairs the marketing dependency tree within package/lock files. Independent Sonnet review follows final commits. Changes remain in draft PR #1810; no merge, deployment, installation, gate bypass, or approval labels.

Evidence: fresh before/after desktop/mobile captures, targeted test red/green and mutation proof, typecheck/lint/build, full repository gate, dependency audits and CI results. Unknowns: whether the inherited advisory has a supported upstream remediation.

Dependency decision: retain the current framework and vendor only the bounded braces recursion patch from upstream PR #87 onto version 3.0.3. Preserve MIT provenance, source hashes and the production diff; reject nesting above 100, verify actual transitive resolution, and run upstream compatibility/security tests. No audit suppression or upstream-fixed claim. A clean build must generate facts and sitemap even when npm lifecycle hooks are disabled.

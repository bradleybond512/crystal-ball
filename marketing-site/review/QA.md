# Marketing review evidence

Reviewed 2026-10-18. Risk: medium, bounded marketing copy and build tooling. One draft PR (#1810); no merge, deployment, app installation, or approval-label changes.

## Current checks

| Mobile Lighthouse 12.8.2 | Performance | Accessibility | Best Practices | SEO |
| --- | ---: | ---: | ---: | ---: |
| Before refinement | 99 | 100 | 100 | 100 |
| After refinement | 100 | 100 | 100 | 100 |

Mobile defaults, headless Chrome, local production preview. CLS: 0. Run warnings: []. These are individual lab runs, not hosted field guarantees. Raw reports are retained. Earlier published-site performance was 54; historical runs, including the noisy 84-point run, remain available rather than being discarded.

- Marketing typecheck, lint, production build and tests passed: `24 pass / 0 fail` (`refinement-tests.txt`).
- `bash scripts/agentic-validate.sh --tests test:marketing` passed, including both app typechecks, repository lint, secrets, docs and app build (`refinement-root-gate.txt`).
- Link audit: `54 passed / 0 failed / 0 HTTP 404`, including responsive image candidates. External HEAD follows redirects; GET Range fallback cancels the body. Binary contents and remote anchors are not verified.
- All five routes checked at desktop 1440×1000 and mobile 390×844: no overflow, broken images or duplicate h1. Skip focus, keyboard specs disclosure and reduced motion pass (`refinement-after-checks.json`).
- Fresh production-server sitemap response matches the build-generated XML. HTML gzip negotiation, minification, hero priority, unique WebP images and dimensions pass behavioral tests.
- SoftwareApplication JSON-LD is unchanged by refinement. Prior official Schema.org validation: one application, zero errors/warnings (`schema-validator.json`); current tests verify the rendered markup. No awards or ratings are invented.

## Product claims and presentation

`CLAIMS.md` maps claims to the checkout. Counts remain build-derived: 409 Full panels, 35 Tech, 31 Finance, 10 Happy; 61 tools (53 read-only, 8 analyst); four editions. The full catalog contains two entries on source line 81, which the earlier line-based count missed. The AST count is authoritative.

Each main feature section now has three tiles, one direct link and one short caveat. The edition comparison retains four cards. Profile counts appear in assistants and specs; visible platform status is in hero/specs/FAQ. Experimental labels remain beside downloads and in JSON-LD. Unset minimum OS values render no row. The specs release line shows version only, and the source-versus-release note remains.

Existing imagery is preserved: five unique real product captures; no fabricated or repeated screenshots are added to text-led sections. `refinement-before/` and `refinement-after/` contain desktop/mobile page-section captures, including stats and expanded specs. Section capture hides sticky navigation only; navigation captures preserve it.

## Dependency remediation

The former eight high marketing toolchain advisories all came through braces 3.0.3. The reported structural recursion issue is locally mitigated by a vendored security-only patch from upstream PR #87. No upstream fixed release exists. This is explicitly a maintained local fork, not an upstream advisory closure.

Fresh `npm ci --ignore-scripts` passes. Full and production audits report zero, but npm may omit local file dependencies; audit zero alone is not the evidence. Four bounded security tests pass, all actual micromatch callers resolve the local source, and the exact patched upstream suite reports `778 passing`. License, base/security commit IDs, production diff and hashes are tracked. Independent read-only review found no blocking code issues. See `dependency/marketing-dependency-report.md` and `../vendor/braces/PROVENANCE.md`.

Patterns above 100 nesting levels now fail explicitly. This patch addresses structural recursion, not arbitrary regex execution or Cartesian expansion exhaustion. Replace it with an official fix only after the same regressions, upstream suite and site checks pass. The historical Sonnet review in `sonnet-review.txt` predates this remediation; it correctly withheld approval of the then-unpatched dependency.

## Regression evidence

From clean `cff3888`, restored duplicate feature links, forced the absent OS-minimum row to render, and raised the braces depth cap from 100 to 10000. Confirmed diff: `refinement-mutation.diff`. Tests changed from `24 pass / 0 fail` to `19 pass / 5 fail`. Restored file hashes match `refinement-checksums.json`, the tree returned clean, and tests returned to `24 pass / 0 fail`.

A separate clean-artifact build with npm hooks disabled failed before the explicit-generation correction (`no-hooks-red.txt`). After correction, the same `npm --prefix marketing-site --ignore-scripts=true run build` recreated generated data and sitemap and passed (`no-hooks-green.txt`). Build/typecheck/dev invoke generation directly; they no longer rely on lifecycle hooks.

Earlier mutation evidence is retained: original route/media guards 9/0→6/3; generator guards 7/0→5/2→7/0; missing asset-binding sitemap regression 8/1→9/0. No validation rule was weakened to obtain a pass. Vendored third-party files are excluded from first-party ESLint rules and covered by their upstream suite plus security regressions.

## Review limits and rollback

DMG signing/notarization, every native feature, Windows/Linux parity, cloud-provider contracts and deployed-host performance remain unverified. The page retains those qualifications. Latest release discovery still identifies v2.25.147; newer source may differ. Repository description/release opening are proposed in `REPOSITORY_COPY.md`, not remotely published.

Open the preview’s home, download, docs, privacy and security pages; navigate with Tab/Enter and compare the captures. Dependency-policy approval remains Bradley’s decision; do not apply an approval label automatically. Final Sonnet verdict and CI state are recorded in the PR after this evidence commit. No auto-merge is enabled.

Rollback: revert the refinement commits for copy; reverting the dependency patch reintroduces the known recursion flaw and must not be treated as a secure release. A future deployment can restore the prior Sites version; this PR itself does not deploy.

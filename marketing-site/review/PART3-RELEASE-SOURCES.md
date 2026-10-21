# Part 3: release-driven marketing claims

This draft depends on release preparation PR #1820 and the explicit analytics consent fix in PR #1819. It does not publish a release, install an app, merge a PR, or deploy the website. The currently published release remains v2.25.147; its warning remains visible.

| Claim or behavior | Source | Verification |
| --- | --- | --- |
| Feature identity, component, minimum desktop version, and Full-only eligibility | [Shared feature map](../../config/release-features.json#L1), exact shared copy from #1820 | Unknown, malformed, inapplicable, and incomplete capability lists fail closed. |
| Current tool count and read/analyst counts | [Tool catalog](../../tools/mcp-server/tool-catalog.mjs#L178) | Generator imports the dependency-free catalog directly; runtime registry re-exports the same catalog. No VM or source-prefix evaluation. |
| Latest release feature availability | [Release metadata reader](../scripts/generate-site-data.mjs#L80) and [capability resolver](../lib/release-availability.mjs#L18), consuming published GitHub latest-release API plus matching `release-manifest.json` | Resolver validates tag/version, full source commit, schema, desktop variant and bundle state, companion provenance, feature definitions, and complete applicable feature set. A version number alone is insufficient. |
| Analytics stay off until explicit opt-in | [Consent feature](../../config/release-features.json#L51), [conditional copy](../lib/render.ts#L26); [prepared fix PR #1819](https://github.com/bradleybond512/crystal-ball/pull/1819) changes `src/services/analytics.ts:47` and migration at line 145 | The pending fix is linked to PR #1819, not claimed as already on main. The v2.25.147 upgrade warning disappears only when the latest published manifest verifies this desktop capability. Missing manifests, fetch failures, unpublished versions, and unknown schemas retain the warning. |
| Home Shell readiness and evidence notes | [Home Shell features](../../config/release-features.json#L14); [Full-only gate](../../src/services/home-shell/shell-gate.ts#L31) | Full-only qualification remains even after release verification. Tech cannot claim these capabilities. |
| Disaster Lifelines display name | [Lifelines feature](../../config/release-features.json#L40); `src/config/panels.ts` | Badge uses the stable feature ID rather than tile position or release-number comparison. |
| MCP profiles and `crystalball doctor --json` | [Doctor feature](../../config/release-features.json#L60), [profile feature](../../config/release-features.json#L69); [conditional origin](../lib/render.ts#L25) | Always separately installed, never bundled in the DMG. Verified feature metadata permits “from the release source”; otherwise the page says “from the current source checkout” and retains the legacy-release qualification. |
| Catalog comparison | [Catalog comparison](../lib/release-availability.mjs#L50); [source-count qualification](../lib/render.ts#L35) and [specification counts](../lib/render.ts#L58) | Audited v2.25.147 note stays until matching release/source counts and complete proof exist. Current checkout derives 409 Full panels; no frozen marketing number is inserted. |
| Map data sentence | `src/config/panels.ts`, existing map-category source review | Exact requested sentence: “Map layers include weather, internet outages, cyber threats, military activity, waterways, and economic signals.” |
| Screenshot provenance | [Capture source SHA](../data/site.json#L5), [capture date](../data/site.json#L17), unchanged image assets | Existing macOS source-build captures remain October 18, 2026 at source `78e34040d738c82195162b28280e8ce865c3bb6d`; no release-matching capture is claimed. |

## Validation

- Before desktop/mobile screenshots: `review/part3-before/`; checks: `review/part3-before-browser.json`. Five routes had no overflow or broken images, one H1 each, working skip link/specification keyboard controls, and reduced-motion animations disabled.
- `npm run build`: exit 0. Existing Vinext source-map/deprecation warnings remain.
- `npm run typecheck`: exit 0.
- `node --test tests/*.test.mjs`: `ℹ tests 36`, `ℹ pass 36`, `ℹ fail 0`.
- Targeted ESLint for changed marketing modules and tests: exit 0 with no warnings. Full marketing lint previously exited 0 with one unused-variable warning; that warning was fixed and the affected file rechecked.
- Mutation evidence: `review/part3-mutation-evidence.json`. Byte-identical isolated clean Git snapshot, committed baseline, inspected diffs, restored SHA-256 and clean state. Removing schema validation changes `7 pass / 0 fail` to `6 pass / 1 fail`; forcing analytics-fixed changes `7 pass / 0 fail` to `6 pass / 1 fail`. Three repair mutations (unverified companion provenance, unqualified numeric counts, and current-main consent wording) each also produce `6 pass / 1 fail`; current file hashes are recorded.
- Browser/performance follow-up is coordinated separately; no new live-release claim is made from fixture tests.

Rollback: revert the Part 3 marketing commit and its dependency copies together. No published state or local app installation changed.

## Review repair, cycle 1

- Corrected unverified companion provenance in security, doctor, and specifications; legacy v2.25.147 cannot be described as containing source-only profiles.
- Kept MCP numeric details explicitly scoped to the source checkout, including when a verified future release has different tool counts.
- Replaced the unverified current-main consent claim with the prepared fix and PR #1819 link.
- Rendering regression showed `6 pass / 1 fail` before repair, then `7 pass / 0 fail`. Full suite remains `36 pass / 0 fail`; typecheck and build exit 0.

## Final visual captures

`CAPTURE_DIRECTORY=review/part3-after CAPTURE_REPORT=review/part3-after-browser.json node scripts/capture-review.mjs` exited 0 after the final eager-containment build. The directory contains 34 desktop/mobile PNGs. All five routes retain one H1, no horizontal overflow, no broken images, working skip-link and specifications keyboard controls, and disabled animation under reduced motion. Desktop hero/privacy and mobile hero/local-AI screenshots were visually inspected: headlines, buttons, screenshot frames, shadows, and feature text remain intact without clipping or overlap.

## Integration dependency

The shared catalog, registry re-exports, package file list, and feature map match PR #1820 byte-for-byte. This branch now also carries its reviewed companion lockfile security fixes and scoped documentation-tooling KaTeX override, while retaining desktop version 2.25.147. Fresh Node 22 root and companion installs used `npm ci --ignore-scripts`; both audits report zero advisories. The companion lockfile and changed root dependency entries exactly match #1820, and install-smoke checks retain their exact version/integrity assertions. The unchanged dependency-age gate still requires maintainer review of qs 6.16.1 or waiting until 2026-10-21 22:06:17 UTC; no approval label was self-applied.

The separate marketing audit reports eight high findings through the already vendored braces 3.0.3 dependency. Its version remains unchanged and npm 10 still reports the upstream advisory, despite the maintained local security patch. All four braces security regressions pass, including installed dependency resolution. See [patch provenance](../vendor/braces/PROVENANCE.md); this is local mitigation, not an upstream advisory closure or a zero-advisory marketing audit. The first repository gate attempt lacked companion dependencies; those were installed with scripts disabled and MCP boundary tests were retained.

Final repository verification after the security dependency updates: `bash scripts/agentic-validate.sh --tests "test:marketing test:mcp-untrusted"` exited 0 (`Agentic validation gate passed.`). Marketing: 36 pass / 0 fail; MCP boundary stages: 24 pass / 0 fail and 23 pass / 0 fail. Strict repository checks, frontend/API typechecks, secret scanning, and production build passed. Separate ESLint of all changed code/test files exited 0 with no output.

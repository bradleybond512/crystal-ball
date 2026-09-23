# PR 1714 integration evidence — 2026-09-22

Status: **DRAFT; aggregate PR acceptance remains incomplete.** The user-approved nested installer repair is implemented and tested in the latest section below. The earlier integration evidence is retained with its original base. This does not certify the unrelated feed/parser or lazy-panel changes, and no full-PR merge approval is claimed.

## Scope

Integrated canonical main `95d6e1560` into existing PR head `9da6a530f`. The only merge conflict was the final package-script entries; retained both the branch MCP scripts and main's map-compatibility script. Main's panel destruction/lazy-mount guards and all other intervening changes remain intact.

Replaced the branch-only `scripts/targeted-tests.mjs` installer mapping with `scripts/targeted-tests-overrides.json`, using the additive contract merged in PR 1715. The runner now exactly matches main (SHA256 `3465ea39dfd5307743013b178ed015f8efdcc62e5960fa80d7526812489a03a1`); no baseline coverage exemption or validation weakening was added.

The full existing PR includes: startup-path bundle measurement and budget; five diagnostic panel factories; bounded FEWS NET title regex; ESLint cache fingerprinting and debt ratchet; `escapeHtml` nullish-value fix and XSS/SSRF helper refactor; nested MCP prepare/install script and tests; and the September 11 review document. The old PR body's assertion that sanitizer changes are excluded is false and must be replaced.

## Actual validation

External logs and runnable probes: `~/.crystalball-diagnostics/pr1714-20260922/`.

- `npm run test:sanitize`: `# pass 38`, `# fail 0`.
- `npm run test:sec-hardening`: `# pass 69`, `# fail 0`.
- `npm run test:mcp-deps`: `# pass 8`, `# fail 0`.
- `npm run test:eslint-runner`: `# pass 9`, `# fail 0`.
- `npm run test:agentic-pipeline`: `# pass 57`, `# fail 0`.
- `test:bundle-budget-policy` run by the gate: `# pass 2`, `# fail 0`.
- `npm run typecheck:all`: `tsc --noEmit && tsc --noEmit -p tsconfig.api.json`, exit 0.
- `bash scripts/agentic-validate.sh --tests "test:sanitize test:sec-hardening test:mcp-deps test:eslint-runner test:agentic-pipeline test:bundle-budget-policy"`: `Agentic validation gate passed.`, exit 0. This reran the named tests, lockfile, strict lint, types, secrets, local cross-agent configuration check, docs, roadmap, and build. Local cross-agent configuration check is **not** an independent review verdict.
- Gate secret scan: `Secret scan passed for 4806 file(s).`
- `npm run bundle:check`: `total: 5.11 MB / 6.00 MB`; `eager: 2.80 MB / 2.85 MB (36 chunks, 10.11 MB raw)`; main `445.5 KB`; `All bundle-size policies satisfied.` No startup saving is claimed.
- Supplemental sanitizer differential probe: `sanitizeUrl equivalence: 1141 inputs; 0 differences` against main's implementation. Includes public/private IPv4, alternate numeric encodings, IPv6/mapped forms, userinfo, relative references, and prohibited protocols. This demonstrates checked cases, not exhaustive security.
- `node scripts/targeted-tests.mjs` against current origin/main `95d6e1560`: `[targeted-tests] 20 script(s) passed.`, exit 0; summed TAP summaries `2211 pass / 0 fail`. This includes the full build and current-location native contract. Existing baselined coverage gap: `scripts/check-bundle-size.mjs`.
- Mapping mutation proof at clean commit `078d2531b`: external `mapping.test.mjs` asserts that the real JSON file selects `test:mcp-deps` with no unmapped source. Replace only the JSON mapping with `{}`, confirm applied `git diff`, run: `1 pass / 0 fail` → `0 pass / 1 fail` (missing expected suite, installer reported unmapped). Restore bytes, checksum and empty status; rerun `1 pass / 0 fail`. Full logs/diff in `mapping-mutation.txt`. No script is removed from main's required selection.

## Original blocking finding: partial MCP install treated as installed

`scripts/install-mcp-deps.mjs` decides `skip:installed` solely from existence of `tools/mcp-server/node_modules`. A failed `npm ci` can create that directory before dependencies are installed. Subsequent prepare runs then skip repair, leaving the original MCP `CONNECTION_CLOSED` failure unresolved.

The isolated fake-npm probe creates an empty node_modules directory and exits 1; it never runs a package install or accesses user data. Actual output:

```text
before: ci
install returned: ci
after: skip:installed
MCP SDK installed: false
```

The existing eight tests pass because they cover decision/skip branches, not this recovery path. This finding is not waived by green gates. Installer behavior needs a separately approved design before repair.

## Boundary review and limits

The sanitizer refactor retains HTTP(S)-only absolute URL handling, private-literal filters, and HTML attribute escaping in the checked corpus. No CSP, permissions, secret, signing, or native install policy changed in this integration. The existing relative-host gap remains: `sanitizeUrl('//127.0.0.1/admin')` returns that input on both main and this branch. This is not fixed or represented as newly introduced; address-policy changes remain outside this integration.

Existing handoff production mutation claims were not independently reproduced in this pass; the mapping mutation above covers the new integration declaration. No new production behavior was implemented. Browser acceptance for lazy diagnostics, actual package-install recovery, and the exact-tip independent review remain outstanding. Do not merge this PR based on these selected tests alone.

## External source probe

The existing FEWS NET parser URL `https://fews.net/rss/all` was probed directly with a 20-second timeout and HTTPS-only redirects. It returned `HTTP/2 404`, `content-type: text/html; charset=UTF-8`, 57,900 bytes, title `Page Not Found | FEWS NET`, and zero RSS `<item>` elements. XML parsing failed. Consumed fields would be `title`, `description`, `link`, and `pubDate`, but there are no valid live rows to verify the bounded country regex against. See `fews-headers.txt`, `fews-body.xml`, and `fews-probe.json` externally. The URL is unchanged by this PR; no endpoint repair or claim that the live feed works is included. Provider repair requires its own discovery/design.

Rollback for this integration is to revert its JSON mapping/conflict-resolution commit; the underlying existing PR changes remain subject to review. The installer repair must preserve explicit skip behavior, no shell interpolation, pinned npm-ci preference, safe offline failure reporting, and current root-install policy unless separately approved.

## Approved installer repair and current-main integration

On 2026-09-22 the user approved the bounded readiness/retry repair. The existing
PR was applied without conflicts to main `c41122898ad0dc2143943766304ac26599e4959b`,
preserving its merged layout, alert, focus and dependency updates. Installer
code and tests are committed at `632c2b602c4728849921441c43e3742d9a7be073`.

The new check resolves the actual ESM SDK and Zod entrypoints in a bounded
read-only Node subprocess, without importing dependency code. Each target must
be a regular file inside the nested node_modules directory. Missing files,
hoisted packages, symlink escapes and malformed metadata select the existing
installer. Disabled/absent-package/no-npm behavior, no-shell invocation and
nonfatal failure reporting remain intact. No real install or user-profile
operation was used in testing.

Actual repair evidence: initial tests `10 pass / 9 fail`; restored suite
`19 pass / 0 fail`; named gate `Agentic validation gate passed.` and
`Tests run: test:mcp-deps`. Normal commit hooks reran both TypeScript
configurations and staged secret/lint checks after the final test-safety edit.
Clean-tree mutation diffs, real failure counts, restoration hashes and limits
are recorded in [the approved repair brief](../plans/2026-09-22-pr1714-installer-repair.md)
and `~/.crystalball-diagnostics/pr1714-installer-repair-20260922/`.

Parent checks against the freshly integrated existing PR also passed:

- `npm run test:sanitize`: `# pass 38`, `# fail 0`.
- `npm run test:sec-hardening`: `# pass 69`, `# fail 0`.
- `npm run test:eslint-runner`: `# pass 9`, `# fail 0`.
- `npm run test:agentic-pipeline`: `# pass 57`, `# fail 0`.
- Explicit `npm run build:full` and `npm run bundle:check`: exit 0;
  `total: 5.12 MB / 6.00 MB`, `eager: 2.81 MB / 2.85 MB`,
  main `gzip=457.9 KB`, `All bundle-size policies satisfied.`

These parent checks ran at the integrated baseline before the installer-only
repair; their production frontend inputs are unchanged by that repair. Raw
logs are `repair-*` under the earlier PR1714 evidence directory, with
`parent-integration-checks.json` in the repair directory.

The approved installer defect is addressed; remaining aggregate acceptance
includes genuine full-PR review, lazy-diagnostic browser behavior, and the
unverified changed FEWS NET parser against its currently failing live URL.
These are not waived by the installer tests. Entrypoint readiness also does not
prove every transitive file is intact or installed versions match the lockfile.
Rollback of the bounded repair is a reviewed reversal of its installer/test
commit; that restores the documented incomplete-directory risk.

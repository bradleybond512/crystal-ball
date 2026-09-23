# PR 1714 integration evidence — 2026-09-22

Status: **DRAFT; final aggregate review pending.** The installer, delayed-panel tracking and typed-lint repairs have scoped acceptance. The proposed FEWS NET parser change has been withdrawn by restoring the file exactly to main; the existing provider defects remain documented for separate work. Earlier evidence below is retained with its original base and scope. No full-PR merge approval is claimed.

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

## Follow-up acceptance: delayed panels and typed lint

Whole-PR independent review of `d1061df82882` against `c41122898ad0` found
additional blockers. No passing whole-PR verdict was recorded. The approved
installer repair remains valid; it does not certify these other changes.

The five newly asynchronous diagnostic panels missed the existing last-viewed
observer's initial scan. The bounded repair enrolls an element after successful
canonical insertion, preserving the missing-grid return, optional observer,
mount deduplication and late-destruction guard. It also removes an unsupported
comment claiming startup bundle savings. This repairs persistence; it does not
complete or expand the high-assurance UX-042 construction/performance plan.

Code commit: `9bf7deec4`; assertion-safety follow-up: `78ce83861`.
Changed files: `src/app/panel-layout.ts`, `tests/lazy-panel-tracker.test.mjs`,
and the focused package script. Evidence is under
`~/.crystalball-diagnostics/pr1714-acceptance-20260922/`.

- Before the repair, the new tracker tests reported `# pass 6`, `# fail 2`.
- `npm run test:lazy-panel-tracker` restored result: `# pass 14`, `# fail 0`.
- `bash scripts/agentic-validate.sh --tests "test:lazy-panel-tracker"`:
  `Agentic validation gate passed.` and `Tests run: test:lazy-panel-tracker`.
  Types, build, lint and secret checks ran within that gate; normal commit
  hooks reran both TypeScript configurations after the assertion-only change.
- Clean-tree mutations, each confirmed with an applied diff: enrollment
  `12 pass / 2 fail`; initial scan, destruction, deduplication, enabled state
  and missing-grid guard each `13 pass / 1 fail`; pending-map cleanup
  `11 pass / 3 fail`; missing-observer handling `12 pass / 2 fail`.
  Each began from `14 pass / 0 fail`; the final restored suite returned
  `14 pass / 0 fail`. Source restoration SHA256:
  `fa370937c7d8d387cca6a62c030feed48f2b488e5eeffa5725830e29f986ba64`.
- Chromium loaded all five real factories through the runtime harness, with
  one mounted element per factory and identical objects for concurrent calls.
  The same visibility-transition probe left storage at `sentinel` with the
  enrollment mutation and wrote `api-diagnostic` after restoration. This is
  browser renderer evidence, not native diagnostic/service acceptance.

The attempted full-app `?e2e=ui-only` probe timed out: that route intentionally
restricts construction to three webcam panels. Its failed log is preserved;
it is not counted as acceptance. Use the ordinary app for manual verification:
open a diagnostic panel, bring it substantially into view, then reopen the app
and confirm the last-viewed location. Native acceptance remains unperformed.
Rollback of the observer repair requires no migration; reverting it restores
the documented persistence defect.

The same review identified unsound type-aware lint caching. An isolated copy
of the real runner reported exit 0 after an imported function changed from
`void` to `Promise<void>` while its caller stayed unchanged. The identical
uncached invocation returned exit 1 with
`@typescript-eslint/no-floating-promises` and
`1 problem (1 error, 0 warnings)`. The separate lint-baseline path remains
uncached. The cache optimization was removed in `ae80c2be4`, preserving lint
rules, progress, timeouts and exit handling. The runner now matches main's
uncached implementation. No cache-file deletion or compatibility shim was
introduced; repeated runs may cost more time but retain the existing timeout.

`tests/eslint-runner.test.mjs` now exercises the real runner and real typed
ESLint in an isolated temporary project. The caller stays byte-identical;
only the imported return type changes. Actual results:

- Before repair: `# pass 9`, `# fail 1`; after repair:
  `# pass 10`, `# fail 0` for `npm run test:eslint-runner`.
- `bash scripts/agentic-validate.sh --tests "test:eslint-runner"`:
  `Agentic validation gate passed.` Types, lint, secrets and build passed.
- Clean-tree mutation restored only the original cache implementation:
  `10 pass / 0 fail` → `9 pass / 1 fail` (cached caller incorrectly exits 0
  instead of 1) → `10 pass / 0 fail`. Applied diff, raw assertions and empty
  restored status are under `cache-repair/`. Restored runner SHA256:
  `5ad371267457e851335694f222fd05f49af2924687ca71b04e90e66c6f98b5f6`.

Rollback would reintroduce stale typed-lint results and is not recommended;
there is no user-data migration. Manual verification is the same isolated
imported-signature scenario, with the second run reporting an unhandled
promise. The two bounded repairs require scoped independent review and do
not remove the remaining aggregate blockers below.

### FEWS NET discovery and remaining scope

The [official feed directory](https://fews.net/feeds) links to working RSS
alternatives: `https://fews.net/taxonomy/term/44/feed` and
`https://fews.net/taxonomy/term/5/feed`. Both returned ten item rows. Consumed
fields available were `title`, `description`, `link` and `pubDate`, with
`dc:creator` and `guid` also present. Raw bodies, headers and shape evidence
are retained as `fews-*` in the acceptance directory.

On these twenty sampled entries, the exact old and new title expressions
produced zero differences, nineteen `Unknown` countries and one erroneous
`Venezuela Acute` value. Titles were multilingual and generally headlines,
not country-prefixed labels. These alternative feeds do not validate the
app's unchanged failing `/rss/all` endpoint. No provider URL, parser or
freshness policy was repaired in this follow-up.

Remaining whole-PR blockers include provider compatibility and the missing
complete mutation records for original sanitizer, prepare-wiring and eager
budget changes. Neither scoped repair authorizes merging this aggregate PR.

## Final scope withdrawal and original evidence closeout

The previous section records findings at the earlier reviewed tip. The
FEWS NET optimization is now withdrawn: `src/services/food-insecurity.ts`
matches canonical main `c41122898ad0dc2143943766304ac26599e4959b` byte for byte,
with no net provider-file diff. This removes the proposed parser change from
this PR; it does not fix or certify the existing provider. Historical commits
and the raw live-probe evidence remain available.

Separate FEWS NET repair must establish a supported response shape and
country attribution from actual provider fields, retain unknown values when
unsupported, and validate failure/freshness behavior before changing the
configured endpoint. Replacing the URL alone is insufficient. No endpoint,
normalization, provider-health or security policy is changed here.

The existing 2.85 MiB eager-JavaScript limit is a product policy, not a
statistically calibrated tolerance. It is unchanged. New fixture measurements
isolate that policy from the other bundle caps; they do not establish a
production performance distribution or first-paint timing.

### Original mutation records completed

Verification-only work at `508a0e668` completed the missing original evidence;
production bytes were restored after every mutation. Raw commands, assertion
failures, inspected applied diffs, before/after hashes and clean-tree records
are under `~/.crystalball-diagnostics/pr1714-final-evidence-20260922/original-proofs/`.

`npm run test:sanitize` baseline and final output: `# pass 38`, `# fail 0`.
The mapped-IPv4 call-site bypass produced `# pass 36`, `# fail 2`; each of the
following eight independent mutations produced `# pass 37`, `# fail 1`:
falsy guard, nullish guard, IPv6 classifier call, zero/multicast classifier,
trailing-dot normalization, multicast only, IPv6 unique-local only and IPv6
link-local only. Every restored run returned `38 pass / 0 fail`.
Sanitizer SHA256 restored after each:
`739dc902bd0348d6c1c47b71a46b6b85656b5db9fbfd6ab51f53cd8a1c393f8d`.
The supplemental independent mutations avoid claiming multicast or IPv6
subclass proof from a grouped assertion that failed earlier at loopback/zero.
These are behavioral proofs, not a timing benchmark or exhaustive security
certification.

The source-scoped command
`node --test --test-name-pattern="the repo really does wire this into prepare" tests/install-mcp-deps.test.mjs`
was run for two separate `package.json` mutations: remove only the installer
suffix from `prepare`, and replace the `mcp:install` recovery command. Each
reported `# pass 1`, `# fail 0` → `# pass 0`, `# fail 1` →
`# pass 1`, `# fail 0`. No package lifecycle was executed.
Restored package SHA256:
`c14555347644a91d7a807f75db662f7717efe390dad6b230cf83060a4157834d`.

The new test in `tests/bundle-budget-policy.test.mjs` executes the actual
checker copied into an isolated fixture. Four deterministic JS assets each
gzip to about 808 KiB; the main entry is 47 bytes gzip. Three preloads pass,
while adding only the fourth preload fails exactly the 2.85 MiB eager limit.
All asset hashes stay identical and the main, individual and total caps pass.
`npm run test:bundle-budget-policy` reported `# pass 3`, `# fail 0`.
Removing only the eager failure branch gave `# pass 2`, `# fail 1`, with the
assertion detecting incorrect exit 0 above the cap; restoration returned
`3 pass / 0 fail`. Checker SHA256 restored:
`b0d56e198b24dcf1b0ce5d1fde9fbe35ae299828685e81d5de2bb8f1348294aa`.
The named gate passed; detailed evidence is in
`~/.crystalball-diagnostics/pr1714-final-evidence-20260922/budget/`.
Integrated test commit: `4a57562e1`.

UX-042 now records this limited prerequisite as MONITOR, with a review date
and exit condition for separately approved broader work. The real roadmap
parser and reconciliation functions passed focused candidate-OPEN and
post-merge-MERGED transition checks: `# pass 2`, `# fail 0`. This is a scoped
ownership check, not a synthetic claim that the PR has already merged.

The original test-evidence gaps are now supplied for final independent
assessment. The provider optimization is withdrawn rather than certified.
The final whole-PR verdict and GitHub checks still determine merge readiness.

### Final integrated local validation

The combined command
`bash scripts/agentic-validate.sh --tests "test:sanitize test:sec-hardening test:mcp-deps test:eslint-runner test:agentic-pipeline test:bundle-budget-policy test:lazy-panel-tracker"`
reported `Agentic validation gate passed.` Actual suite summaries, in that
order: `# pass 38 / # fail 0`, `# pass 69 / # fail 0`,
`# pass 19 / # fail 0`, `# pass 10 / # fail 0`,
`# pass 57 / # fail 0`, `# pass 3 / # fail 0`, and
`# pass 14 / # fail 0`. The gate also ran types, lint, secrets, roadmap and
build. Raw log: `pr1714-final-evidence-20260922/final-gate.log`.

Subsequent `npm run bundle:check` returned exit 0 and
`All bundle-size policies satisfied.` Actual report: 110 chunks,
`total: 5.11 MB / 6.00 MB`, `eager: 2.80 MB / 2.85 MB`,
and main `gzip=445.7 KB`. No threshold was increased, and these measurements
are not a controlled before/after performance comparison. Native acceptance
and broad construction profiling remain outstanding.

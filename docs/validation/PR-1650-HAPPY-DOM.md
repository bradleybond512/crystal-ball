# PR1650 happy-dom refresh — validation evidence

Status: local validation complete with the unchanged smoke route-audit limitation documented below; independent review and publication remain pending. Existing PR1650 is the delivery target.

## Change and provenance

Started from canonical main `382fff7fe6657e8fc8beb8cb786a70c032385f77`. Updated only root devDependency range `happy-dom: ^20.10.4` → `^20.14.0` and its lock record to exact20.14.0. Regenerated with Node22/npm and the committed .npmrc using `npm install --package-lock-only --save-dev --save-prefix='^' happy-dom@20.14.0`; restored npm's unrelated manifest formatting changes. Semantic lock comparison contains only the root request and node_modules/happy-dom version/resolved/integrity: zero added/removed packages, unchanged seven direct dependency requirements. The obsolete PR lockfile churn was not reused.

MIT license and Node>=20 requirements remain unchanged. This is an existing development DOM dependency; no production source, permissions, native install/release behavior, test assertion, coverage waiver, or baseline is changed. No mutation proof applies to this dependency-only refresh. Rollback restores the two manifests followed by npm ci.

External evidence: `~/.crystalball-diagnostics/pr1650-20260922/`, including exact commands, logs, lock-semantic-diff.json, per-panel old/new reports, browser artifacts, and probes.

## Actual baseline and candidate checks at382fff

Both `npm ci` runs: `added 949 packages, and audited 951 packages`; `found 0 vulnerabilities`. Actual installed versions were checked as20.10.4 then20.14.0.

| Check | Old20.10.4 | New20.14.0 |
| --- | --- | --- |
| `npm run test:renderer` | `# pass 14936`, `# fail 0` | `# pass 14936`, `# fail 0` |
| `npm run test:panels:smoke` wrapper | PASS | PASS |
| Smoke inner TAP, including route audit | `# pass 452`, `# fail 1` | `# pass 452`, `# fail 1` |
| Per-panel states |32 rendered,208 degraded,0 silent,0 errored,209 no factory | identical; zero state changes |
| `test:panels:fixtures` | not rerun separately |16 pass /0 fail |
| `test:delegation` | not rerun separately |15 pass /0 fail |
| `test:component-lib` | not rerun separately |62 pass /0 fail |
| Direct DOM tests listed below | not rerun separately |83 pass /0 fail |
| `test:homeshell` | covered by renderer except root retry fixture |140 pass /0 fail plus2 pass /0 fail |
| `test:ux026` | source tests covered by renderer |115 pass /0 fail |
| `test:map-compatibility` | not rerun separately |9 pass /0 fail |

Direct DOM command:

```sh
node --import tsx --test tests/safe-html.test.mjs tests/ui/progressive-disclosure.test.mts tests/saved-place-lifeline-pack.test.mts tests/ux010-current-location-save.test.mts tests/ux026-fourth-cycle-runtime.test.mjs
```

`npm run typecheck:all` and `npm run lockfile:check`: exit0. Builds `build:full`, `build:tech`, `build:finance`, `build:happy`: exit0. Full-variant `bundle:check`: main457.7KB under460KB; total5.12MB under6MB; `All bundle-size policies satisfied.`

Gate:

```sh
bash scripts/agentic-validate.sh --tests "test:renderer test:panels:smoke test:panels:fixtures test:delegation test:component-lib"
```

Actual output: `Agentic validation gate passed.` This reran named suites plus lockfile, strict lint, typechecks, secrets, local review-configuration check, docs, roadmap, and build. The local review-configuration check is not an independent review verdict.

## Real browser matrix at382fff

Playwright used Chromium, separate explicit VITE_VARIANT values, E2E_PORT46550, unchanged assertions/baselines, and fresh browser contexts. Full command selected a11y-baseline, settings-keyboard, home-shell-boot, variant-identity, theme-toggle, and system-theme specs.

- Full: `27 passed`, `8 skipped`, `1 failed`. All eight accessibility cases and eight Settings keyboard cases passed. Failure: empty-storage Welcome Home shell focus assertion at home-shell-boot.spec.ts:29. The eight skips are happy-only theme-toggle cases, not coverage.
- Tech: identity `1 passed`, `8 skipped` happy-only theme cases.
- Finance: identity `1 passed`, `8 skipped` happy-only theme cases.
- Happy: identity, happy theme-toggle and system-theme `14 passed`, no skips.

External real UI tech/finance theme probes both passed. They use actual variant identity (no injected variant preference), visible theme buttons, dark→light→dark changes in html data-theme and nonempty computed --bg/--text, moon/sun icon transitions, stored choice and reload persistence. Exact runnable probe hash: `cfa13fa86c64ce8ac77663f4025e8800339eb4ba51f90750d012fccf539a08d5`; script and output JSON are saved externally. These browser checks are independent compatibility references; happy-dom does not execute in Chromium. The panel smoke harness forces full and does not establish variant runtime coverage.

## Failure controls and outstanding work

The old20.10.4 same382fff focused Welcome control **passed1/0**, while the candidate's first broad browser run failed its focus assertion. A focused repeat after restoring new20.14.0 also passed1/0 (50.1s). These passing repeats do not erase the original broad-run failure or justify calling that browser matrix all green. Both candidate manifest checksums and installed20.14.0 were restored after the control. The separately reviewed UX-060/PR #1735 focus-race fix was then integrated through main `97faf76e0cfe8cdc414c7d96cb0c4c606124ee27`; final acceptance results are recorded below.

The smoke wrapper passes on both versions but its inner route-audit assertion fails identically: seven sidecar-only routes are unclassified (`/api/acled/token-status`, `/api/epa-sdwis-proxy`, and webcams caltrans/geonet/singapore/tfl/usfs). No route allowance or baseline was changed. The wrapper contract explicitly judges panel reports; this is not a clean inner test suite. Preserve this unresolved audit finding rather than claiming all smoke assertions passed.

No independent review or final publication completed yet. No native app was installed. Manual acceptance should include the real app's Welcome keyboard flow and diagnostic panels; browser checks do not certify WKWebView/native behavior.

## Final integration acceptance at 97faf76e

Rebased the unchanged dependency patch onto canonical main `97faf76e0cfe8cdc414c7d96cb0c4c606124ee27`, including PR #1735's independently delivered UX-060 Welcome focus fix. The final manifest diff remains exactly the happy-dom root request and lock version/resolved/integrity; no transitive additions or removals. Installed happy-dom is 20.14.0.

Actual focused results after integration:

- `npm run lockfile:check`: exit 0.
- `npm run typecheck:all`: exit 0, both TypeScript configurations.
- `npm run test:ux060`: `# pass 36`, `# fail 0`.
- `npm run test:homeshell`: `# pass 140`, `# fail 0`, followed by `# pass 2`, `# fail 0`.
- `npm run test:ux026`: `# pass 115`, `# fail 0`.
- `VITE_VARIANT=full E2E_PORT=46550 node_modules/.bin/playwright test e2e/home-shell-boot.spec.ts e2e/settings-keyboard.spec.ts e2e/a11y-baseline.spec.ts --project=chromium`: `22 passed (4.1m)`. This includes all six Home, eight Settings keyboard, and eight accessibility cases; the earlier failing Welcome keyboard case passed within this complete rerun.
- `npm run build:full`: exit 0.
- `npm run bundle:check`: `chunks: 110`, `total: 5.12 MB / 6.00 MB`, main `gzip=457.9 KB` against the unchanged 460 KB budget; `All bundle-size policies satisfied.`

The broader DOM/variant build and theme matrices above ran at the initial comparison base. Final integration reruns concentrate on the source behavior changed by UX-060, both type configurations, the full production bundle, and the validation gate. No claim is made that earlier tests ran at the final base.

Final gate command:

```sh
bash scripts/agentic-validate.sh --tests "test:ux060 test:homeshell test:ux026"
```

Actual final output: `Agentic validation gate passed.` and `Tests run: test:ux060 test:homeshell test:ux026`. Secret scan output: `Secret scan passed for 4821 file(s).` The gate reran these targeted suites, strict lint, both typechecks, lockfile checks, docs/roadmap checks, and the default build. The explicit full build/bundle measurement above was captured separately before this default build.

A fresh fetch before the first commit confirmed canonical main still matched the final integration base. Independent review remains the next delivery step; no push or native installation was performed by this implementation task.

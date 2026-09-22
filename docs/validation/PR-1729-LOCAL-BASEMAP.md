# PR #1729 local geographic baseline validation

Validated on 2026-09-22 against main 97faf76e0cfe8cdc414c7d96cb0c4c606124ee27,
using Node 22.23.1, Vite 8.1.5 and Playwright 1.59.1 on macOS.
The original dirty worktree's ten file hashes remain unchanged; its candidate
was copied to an isolated branch before any repair or clean-tree mutation.

## Scope and resulting behavior

Default dark/light maps use bundled country geometry, with factual loading,
basic and unavailable status and Natural Earth attribution. Browser checks
cover blocked remote basemaps, missing geography, initial style failure,
rapid style changes, saved satellite/terrain preferences, camera movement,
country clicks and a representative NaturalEvent popup.

Classic's status sits above the map controls, with a narrow-screen adjustment.
Home CSS adoption retains its lower-left status and returning to Classic
restores the Classic layout. The ordinary legend reserves attribution space
at widths at or below 1200px; SIGINT positioning is unchanged. Geometry assertions
cover dark/light at 1280, 1200, 800 and 390px, expanded/collapsed controls where
available, Home CSS adoption/removal, map/viewport bounds, internal clipping,
notice/control intersections and attribution/legend intersections.

## Commands and actual results

Commands ran from the isolated worktree with
`PATH=/opt/homebrew/opt/node@22/bin:$PATH`. Browser commands used
`E2E_PORT=4372`, Chromium and the repository's unmodified software-GL settings.

| Command | Actual output/result |
| --- | --- |
| `npm run test:local-basemap` | `# tests 15`, `# pass 15`, `# fail 0` |
| `npm run test:map-compatibility` | `# tests 9`, `# pass 9`, `# fail 0` |
| `npm run typecheck:all` | Exit 0; both TypeScript configurations completed. |
| `VITE_VARIANT=full npx playwright test e2e/local-basemap.spec.ts` | `16 passed` |
| `VITE_VARIANT=tech npx playwright test e2e/local-basemap.spec.ts` | `14 passed` before two 1200px cases were added. |
| `VITE_VARIANT=finance npx playwright test e2e/local-basemap.spec.ts` | `14 passed` before two 1200px cases were added. |
| `VITE_VARIANT=tech npx playwright test e2e/local-basemap.spec.ts -g 'baseline notice stays visible'` | Final eight-case placement suite: `8 passed`. |
| `VITE_VARIANT=finance npx playwright test e2e/local-basemap.spec.ts -g 'baseline notice stays visible'` | Final eight-case placement suite: `8 passed`. |
| `VITE_VARIANT=full npx playwright test e2e/map-harness.spec.ts -g 'matches golden screenshots per layer and zoom'` | `1 passed`; complete per-layer golden loop. |
| Same golden command with `VITE_VARIANT=tech` | `1 passed`; complete per-layer golden loop. |
| `CRYSTALBALL_SKIP_VAULT_TEXTURES=1 bash scripts/agentic-validate.sh --tests 'test:local-basemap test:map-compatibility'` | `Agentic validation gate passed.` / `Tests run: test:local-basemap test:map-compatibility` |
| `CRYSTALBALL_SKIP_VAULT_TEXTURES=1 npm run build:full` | Exit 0; Vite build and PWA generation completed. |
| `npm run bundle:check` | `All bundle-size policies satisfied.` |

Final explicit Full bundle output:

```text
total:  5.12 MB / 6.00 MB
main-Cv39y9mx.js  raw=1.61 MB  gzip=457.9 KB
```

The explicit full-build bundle report is retained with raw output. Budgets and
snapshot tolerances were unchanged. GitHub's required Linux checks remain the
merge authority; local gzip measurements do not replace them.

## Test-first and mutation evidence

Original placement checks: `0 pass / 2 fail`. Expanded six-case placement checks:
`0 pass / 6 fail`. The first precise layout exposed the mobile time-slider
collision; its narrow top offset was refined from 52px to 72px. Attribution
intersection checks independently produced `2 pass / 4 fail` at 800/390px,
while the 1200px endpoint produced `2 passed` before the legend adjustment.
The final combined placement suite produced `8 passed`.

Every mutation started with empty `git status --short`, recorded the affected
file SHA256, and saved/inspected an applied `git diff` before running its target.
Each restored the original bytes, matching checksum and empty git status.
Raw logs, diffs, automation scripts and per-case hashes are retained under
`~/.crystalball-diagnostics/pr1729-placement-20260922/`.
Earlier unit rows use the 14-test baseline; the actual-destroy test raised that
suite to 15. Earlier Home/theme/saved-choice browser proofs retain their original
six/two-case baseline; the final CSS proofs use all eight placement cases.

Unit mutations target `src/components/DeckGLMap.ts`, except
`default-no-remote-glyphs`, which targets `public/map-styles/dark.json`.
Nine-test rows run `npm run test:map-compatibility`; other unit rows run
`npm run test:local-basemap`. Browser mutations run the exact focused patterns
recorded in `browser-mutations.json` and `final-placement-mutations.json`:
old placement changes DeckGLMap plus both stylesheets; narrow and attribution
placement change `src/styles/main.css`; Home placement changes
`src/styles/home-shell.css`; theme and saved-choice changes target DeckGLMap.

| Mutation | Recorded counts | Failing assertion |
| --- | --- | --- |
| `land-visibility` | `14 pass / 0 fail` → `13 pass / 1 fail` | Expected values to be strictly equal: 0 !== 1 |
| `polygon-readiness` | `14 pass / 0 fail` → `13 pass / 1 fail` | Expected values to be strictly equal: true !== false |
| `stale-style-callback` | `14 pass / 0 fail` → `13 pass / 1 fail` | only the current style callback may request an overlay render 2 !== 1 |
| `detached-geometry` | `14 pass / 0 fail` → `13 pass / 1 fail` | Expected values to be strictly equal: 6 !== 0 |
| `timeout-boundary` | `14 pass / 0 fail` → `13 pass / 1 fail` | Expected values to be strictly equal: + actual - expected + 'loading' - 'unavailable' |
| `completed-timeout-cancel` | `14 pass / 0 fail` → `13 pass / 1 fail` | Expected values to be strictly equal: + actual - expected + 'unavailable' - 'basic' |
| `initial-style-failure` | `14 pass / 0 fail` → `13 pass / 1 fail` | Expected values to be strictly equal: + actual - expected + 'loading' - 'unavailable' |
| `country-source-failure` | `14 pass / 0 fail` → `13 pass / 1 fail` | Expected values to be strictly equal: + actual - expected + 'basic' - 'unavailable' |
| `initial-error-wiring` | `9 pass / 0 fail` → `8 pass / 1 fail` | Expected values to be strictly deep-equal: + actual - expected [ 'attribution:dark', - 'errors', 'baseline-loading' ] |
| `initial-attribution-wiring` | `9 pass / 0 fail` → `8 pass / 1 fail` | Expected values to be strictly deep-equal: + actual - expected [ - 'attribution:dark', 'errors', 'baseline-loading' ] |
| `honest-attribution` | `14 pass / 0 fail` → `12 pass / 2 fail` | The input did not match the regular expression /Natural Earth/. Input: 'CARTO · datasets/geo-countries' |
| `default-no-remote-glyphs` | `14 pass / 0 fail` → `13 pass / 1 fail` | dark + actual - expected + 'https://example.com/{fontstack}/{range}.pbf' - undefined |
| `destroyed-geometry` | `15 pass / 0 fail` → `13 pass / 2 fail` | Expected values to be strictly equal: 6 !== 0 |
| `initial-style-generation-repaired` | `9 pass / 0 fail` → `8 pass / 1 fail` | an old style event cannot overwrite a newer ready generation 0 !== 1 |
| `final-old-placement` | `8 pass / 0 fail` → `0 pass / 8 fail` | Notice intersects Classic layer tray/legend. |
| `final-narrow-placement` | `8 pass / 0 fail` → `6 pass / 2 fail` | 390px notice intersects the time slider. |
| `final-attribution-placement` | `8 pass / 0 fail` → `4 pass / 4 fail` | 800px and 390px attribution intersects the ordinary legend. |
| `home-placement` | `6 pass / 0 fail` → `0 pass / 6 fail` | Home notice is not 8px from map left and 20px from bottom. |
| `theme-follow` | `2 pass / 0 fail` → `0 pass / 2 fail` | New theme basemap button never becomes aria-pressed=true. |
| `saved-choice` | `2 pass / 0 fail` → `0 pass / 2 fail` | Saved satellite/terrain selection is replaced after theme change. |
| `land-overlay-order` | `15 pass / 0 fail` → `14 pass / 1 fail` | Land no longer inserts below the existing intelligence overlay. |
| `border-overlay-order` | `15 pass / 0 fail` → `14 pass / 1 fail` | Border no longer inserts below the existing intelligence overlay. |
| `status-live-politeness` | `15 pass / 0 fail` → `14 pass / 1 fail` | Status live region becomes assertive instead of polite. |
| `focus-final` | `15 pass / 0 fail` → `13 pass / 2 fail` → `15 pass / 0 fail` | local geography status must preserve the focused control |
| `pending-status` | `2 pass / 0 fail` → `1 pass / 1 fail` → `2 pass / 0 fail` | Expected loading; received unavailable after the deadline. |
| `missing-status` | `2 pass / 0 fail` → `1 pass / 1 fail` → `2 pass / 0 fail` | Expected unavailable; received basic. |

Supplemental review proofs are recorded in `review-requested-mutations.json`,
`review-browser-mutations.json` and `focus-final-proof.json`, with applied diffs,
actual assertion output, matching restored source hashes and clean proof trees.
The first focus mutation attempt ended with a test-process SIGKILL after 180.9s;
its four passes and one file-level failure are **not** an assertion proof.
The exact node-identity assertions were then expressed as Boolean assertions
with a short message, avoiding DOM-object failure output without weakening the
requirement. The same focus-stealing mutation subsequently produced two actual
assertion failures and restored to fifteen passing tests. The original process
termination's cause is not established by this result. No production change
was needed for this evidence repair.

Removing only the timer cancellation at the start of a replacement load
survived (`14 pass / 0 fail`): the generation guard independently prevents the
old deadline from changing the new selection. This is recorded as a survivor,
not a claimed kill or proof of a one-active-timer bound. The initial-style
mutation also first survived a weak assertion (`9 pass / 0 fail`). The assertion
was strengthened to model a newer style already ready before a delayed old
callback; that actual temporal regression now produces `8 pass / 1 fail`.
No production behavior was changed to satisfy either test.

Restored source checksums at the original 97faf76e proof base:

- `src/components/DeckGLMap.ts`: `7dd105d8143b826ddde7152663ff0db222389a4086aa8abe1b215add6d6017ee`
- `src/styles/main.css`: `7b76cf9a95f033ca560234fc42b0f352ff2c6df1616d7762e571fc1864f681a1`
- `src/styles/home-shell.css`: `059eef948a0060bc9e123b0e061b71a4f11d577ae7a563a3b38182bd1a42a357`
- `public/map-styles/dark.json`: `e38ab443b6c35be3c58f709302b2f95e6536d23ceafdaacf5bda8df4c6ee58a4`

That stylesheet checksum includes the attribution repair. Earlier placement
mutation records retain the intermediate stylesheet checksum; the final old-
placement/narrow/attribution mutations were repeated against the finished CSS.

## Selective golden reconciliation

The fresh Tech conflicts capture and its retry both hash to
`e5e08e934eb4d16e536846f68596d8034112d85c63ea498cf72a1d3e12d6baf4`,
identical to the already accepted Full conflict fixture. The stale Tech fixture
was `ef5da24f92bbb8a55d2487f617feaffe894a83346b6c30d93494e31d9d97675c`.
Visual inspection confirmed the same conflict geometry and camera.

After correcting that single fixture, the loop exposed a missing Tech ADS-B
fixture. The scenario already applies to both variants at the tested main base,
but `git ls-tree` confirms its Tech fixture was absent. Its capture hashes to
`b4cbe69ed586bdd475db8fbf5ecd1f6c04448dc2a61732deaa978f16f32b3833`, identical
to the accepted Full ADS-B fixture; visual inspection confirms the centered
aircraft. Only these two verified Tech fixtures changed. No bulk update,
assertion removal or tolerance adjustment was used.

## Integration with merged layout and dependency updates

The same feature patch was applied without conflicts to main
`c41122898ad0dc2143943766304ac26599e4959b`, retaining the measured summary stack,
alert capacity changes and happy-dom 20.14.0. Original dirty worktrees remain
preserved; the final candidate is in a separate worktree.

Fresh targeted results on this integration:

- `npm run test:local-basemap`: `# pass 15`, `# fail 0`.
- `npm run test:map-compatibility`: `# pass 9`, `# fail 0`.
- `npm run test:summary-strip-layout`: `RESULT 8 pass / 0 fail`.
- Full Chromium placement subset: `8 passed (25.9s)` at E2E_PORT=4374.
- Focused synthetic roadmap transitions: `RESULT 2 pass / 0 fail`.
- `npm run typecheck:all`: exit 0, with actual output below.

```text
> crystal-ball@2.25.147 typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
```

Raw logs use the `integrated-` prefix in the external evidence directory.
DeckGLMap and Home stylesheet hashes remain identical to the proof base.
Current `src/styles/main.css` SHA256 is
`9a66585999830eb1ae02858372a31ca9d4a2a656197408a8173eacb7fc9c8a34`;
the difference preserves main's previously merged summary-stack styling.
Two early gate attempts stopped at Markdown spacing errors in the plan
(MD012, then MD022 during correction); their logs remain retained.

The corrected named gate completed with actual output:

```text
Secret scan passed for 4837 file(s).
Agentic validation gate passed.
Tests run: test:local-basemap test:map-compatibility test:summary-strip-layout
```

`CRYSTALBALL_SKIP_VAULT_TEXTURES=1 npm run build:full` and `npm run bundle:check`
then both exited 0. Actual final Full output:

```text
✓ built in 11.87s
PWA v1.3.0
mode      generateSW
precache  455 entries (22368.19 KiB)
  chunks: 110
  total:  5.12 MB / 6.00 MB
    main-dgyH87ha.js  raw=1.61 MB  gzip=457.8 KB
✓ All bundle-size policies satisfied.
```

Logs: `integrated-gate-final.log`, `integrated-build-full.log` and
`integrated-bundle.log`. All ten original dirty-worktree file hashes were
rechecked and remained identical (`final-original-preservation.json`).

## Review, remaining limits and rollout

Independent final review and the required Claude SHA-pinned verdict are pending
at this handoff; these checks are not a review approval. No push, merge, install,
profile change or production-data operation was performed by this validator.

UX-000 remains MONITOR with PR #1729 in its evidence cell. Its existing exit
condition, review date and packaged desktop verification requirement remain.
A focused synthetic roadmap check with all four evidence PR states verifies
both OPEN and MERGED transitions: `2 pass / 0 fail`. This does not claim a
complete live-PR reconciliation.

The Home class test proves CSS adoption/release, not the complete Home shell or
native desktop lifecycle. Native useful coverage from issue #1725 remains open.
The headerless harness does not initialize translation labels; screenshots
therefore retain existing undefined control labels. The unchanged earthquake
DTO/rendering mismatch is a separate follow-up; NaturalEvent picking is the
representative overlay tested. Packaged local geometry and blocked-network
browser tests do not establish cold browser/PWA offline availability.

Manual desktop verification: use the separate standard account, launch the
packaged candidate without provider keys, check dark/light geographic context,
Home-to-Classic transitions, readable status/credits, map interactions and saved
satellite/terrain behavior, then record useful Home coverage against issue #1725.
Rollback is a reviewed revert of this PR's default-style/presentation changes;
no credentials, data migration or provider configuration changes are involved.

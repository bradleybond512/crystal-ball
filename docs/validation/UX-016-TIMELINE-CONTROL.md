# UX-016 — bounded timeline control validation

Draft [#1922](https://github.com/bradleybond512/crystal-ball/pull/1922).
Implementation commit `403d45eca7`; base `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`.
Full UX-016 remains open. This is the approved control-consolidation stage.

## Behavior and architecture

World Stage has one controller-owned 200 ms playback timer and one passive HUD.
The selected fixed 24-hour range filters current records; no historical positions
or future observations are claimed. Playback pauses when hidden, explicit Latest
resets the anchor, and native controls retain keyboard focus. Existing cursor
subscribers remain connected; Cesium does not independently animate time.

Changed: `GlobeTimeMachine`, `TimeScrubberHud`, `GodsVisionView`,
`GlobeTimelineSync`, existing HUD CSS, a fixture integration suite and package
script. Provider, notification, persistence, lens and opacity writers are
unchanged. Initial UX-076 metadata correction records merged #1900 without
claiming packaged acceptance.

## Executed validation

Node 22.23.1; existing lock-identical dependencies reused. Commands exited 0.
Actual output excerpts:

```text
npm run test:ux016
# tests 15
# pass 15
# fail 0

npm run test:playback
# pass 14
# fail 0

npm run test:globe
# pass 53
# fail 0

bash scripts/agentic-validate.sh --tests "test:ux016 test:playback test:globe"
Agentic validation gate passed.
Tests run: test:ux016 test:playback test:globe

node scripts/targeted-tests.mjs
[targeted-tests] 54 script(s) passed.
```

The gate ran lockfile, strict lint, all type configurations, secrets, cross-agent
configuration, docs, roadmap and build checks. Its cross-agent configuration
check is not the independent verdict. Selected suites include isolated native
contracts; no application was launched or installed. Build emitted advisory
bundle/plugin timing warnings; no gate failed.

New integration tests use real controller/HUD/timeline bridge and mounted
GodsVision enter/exit paths with fake clocks and unrelated globe/network/UI
peripherals replaced by fixtures. They verify ownership, delivery/rate limits,
fixed bounds, finite input, hidden cancellation, remount fencing, labels,
keyboard precedence and retained-event schema. They do not exercise WebGL.

## Mutation proofs

Baseline and restored suite: `15 pass / 0 fail`. Every mutation began with empty
`git status --short`, recorded `shasum -a 256`, changed one behavior, displayed and
saved the applied `git diff`, produced actual failing test assertions, then
restored the identical checksum and empty status. All 19 mutations were caught.
Each raw TAP log and confirmed diff is retained with `mutation-results.json` and
`mutation-run.log` in the session evidence directory `next-nov25/ux016`.

| Reverted behavior | Mutated file | Actual pass / fail |
| --- | --- | --- |
| immutable-state | src/components/GlobeTimeMachine.ts | 14 / 1 |
| finite-input | src/components/GlobeTimeMachine.ts | 14 / 1 |
| fixed-anchor | src/components/GlobeTimeMachine.ts | 14 / 1 |
| five-hz | src/components/GlobeTimeMachine.ts | 12 / 3 |
| continuous-filter | src/components/GlobeTimeMachine.ts | 13 / 2 |
| seek-pauses | src/components/GlobeTimeMachine.ts | 14 / 1 |
| restart-endpoint | src/components/GlobeTimeMachine.ts | 13 / 2 |
| latest-anchor | src/components/GlobeTimeMachine.ts | 13 / 2 |
| hidden-cancel | src/components/GlobeTimeMachine.ts | 13 / 2 |
| stale-generation | src/components/GlobeTimeMachine.ts | 14 / 1 |
| timer-cleanup | src/components/GlobeTimeMachine.ts | 8 / 7 |
| single-cesium-clock | src/components/GlobeTimeMachine.ts | 14 / 1 |
| hud-subscription | src/components/TimeScrubberHud.ts | 14 / 1 |
| hud-unsubscribe | src/components/TimeScrubberHud.ts | 14 / 1 |
| truthful-scope | src/components/TimeScrubberHud.ts | 14 / 1 |
| host-owner | src/components/GodsVisionView.ts | 14 / 1 |
| interactive-space | src/components/GodsVisionView.ts | 14 / 1 |
| bridge-cursor | src/components/gods-vision/GlobeTimelineSync.ts | 14 / 1 |
| retained-wording | src/components/gods-vision/GlobeTimelineSync.ts | 14 / 1 |

Restored SHA-256 checksums:

- `src/components/GlobeTimeMachine.ts`: `16f917e3475bac7f9e27710cc566267ba6af37938ed20c99297ba0eda23a1a92`.
- `src/components/TimeScrubberHud.ts`: `7837aec34fe8a7a71522667292c1fe09a3ebd79c84a45c3e8669099f2cf7878d`.
- `src/components/GodsVisionView.ts`: `5a8cc8fee11e9e01e06c2a99d8f68866dd839dfb60314a15ffd8819b9267e46e`.
- `src/components/gods-vision/GlobeTimelineSync.ts`: `880e2bb7a7385fab9f5a8531205df0598e3ea76d4d8e00d8eeeb9c9d98e129b4`.

## Review, CI and open risks

The completed diff and this evidence go to independent Sol and actual Sonnet
review. Their final conclusions are retained separately; the Sonnet verdict
commit must pin this report's exact parent tip before code publication. Do not
read the local cross-agent configuration pass as a review outcome.

The documentation claim's hosted CI is not implementation acceptance. Its
roadmap failure requested IN REVIEW (now recorded), and its review gate awaits
the final verdict. Security Audit run 45752246085 reports one marketing
`react-server-dom-webpack` critical finding and Rust `cookie` 0.18.1
(RUSTSEC-2026-0594) plus `url` 2.5.8 (RUSTSEC-2026-0592). These lockfiles are
unchanged by UX-016. Separate #1920 covers the url update and remains in its
existing workflow; no dependency issue is claimed resolved here.

Existing 4D alpha overwrites, lost base alpha, newly arriving entities and
incomplete reset remain open. UX-005 stable identity/lens work stays held.
Ordinary DeckGL/mobile map support, true historical replay, real WebGL layout,
screen-reader speech and installed acceptance are unverified.

## Manual checks and rollback

When separately authorized, verify World Stage at narrow/wide sizes; one time
control; range/speed/Latest interaction; Space versus focused controls; hidden
pause; exit/re-entry; selected timestamps and honest retained counts. Observe
known opacity/arrival limitations without claiming full acceptance.

No migration. Revert the bounded implementation commit to restore prior control
behavior; do not install or deploy during rollback under the current holds.

Proposed PR description: Connect World Stage's time HUD to its existing owner,
remove unsupported future/replay claims, and prevent competing clocks and
starved filtering. Fifteen fixture tests, 19 mutation proofs, all 54 selected
scripts and the full local gate pass. Full UX-016 and dependency audits remain
open. Merging, auto-merge, releases, deployment and installation remain paused.

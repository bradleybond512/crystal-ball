# UX-016 — bounded timeline control consolidation

Status: approved to proceed by Bradley’s November 25 “finish the roadmap”
instruction following the design approval request. High Assurance; documentation
draft claim precedes local implementation. Full UX-016 remains open after this stage. See the [brief](2026-11-25-ux016-timeline-brief.md).

## Outcome and evidence boundary

The Cesium World Stage gets one connected time control. It filters timestamps
in currently loaded records; it does not reconstruct historical positions or
what was known at a past time. Remove the unsupported future range and replay
claims. Ordinary DeckGL/mobile maps are outside this stage.

Read-only repository discovery and architecture review found two mounted
controls with separate playback clocks: `GlobeTimeMachine` and a disconnected
`TimeScrubberHud`. The former already supplies the map, timeline bridge, 4D
swimlane and keyboard consumers. Its resetting 250 ms filter debounce can starve
filter updates during playback. A separate `GlobePlayback` implementation has
no demonstrated production starter; it is not a third running loop.

## Architecture and behavior

- Keep `GlobeTimeMachine` as the actual controller and preserve its consumed
  public methods and `onTimeChange` subscription. Remove its duplicate control
  DOM. Its mount/destroy lifecycle owns playback and visibility handling.
- Add immutable state snapshots and `getState`/`onStateChange` with
  `{cursorMs, anchorMs, playing, speed, mode: 'latest' | 'selected'}`. Publish
  playback and speed changes even when the cursor does not move.
- Make `TimeScrubberHud(parent, controller)` the passive view. Remove its own
  state model, optional cursor callback and scheduler. Controls delegate to the
  controller; subscription updates preserve focus and native range behavior.
- Mount the HUD only with an available controller. Preserve existing timeline
  event schemas and map consumers. Do not activate dormant playback code.
- Anchor the range at mount or explicit Latest reset: `[anchor - 24h, anchor]`.
  Keep that anchor fixed for the selected session. Clamp finite input; ignore
  non-finite input without corrupting state. Retain speeds 1, 4, 16 and 64.
- Seeking pauses playback. Play from the upper endpoint restarts at the lower
  endpoint; reaching the upper endpoint pauses. Internal playback commits must
  not invoke the public seek operation that pauses playback.
- One controller-owned scheduler commits playback cursor/filter changes at
  most five times per second. Replace the resetting trailing debounce with
  bounded updates so filtering occurs during continuous playback. Explicit
  seeks, pause/final state and reset apply promptly; these user actions are
  outside the playback-rate cap.
- Set Cesium time explicitly and keep `clock.shouldAnimate = false`, avoiding
  independent clock advancement. Hidden documents pause and cancel work;
  returning requires explicit Play and cannot catch up hidden elapsed time.
- Destroy cancels work, removes listeners and subscriptions, and makes late
  callbacks inert. Remount has one subscription set and one playback owner.
- Space outside interactive/editable targets delegates once to the controller.
  Preserve native control keys, fly-mode and Escape precedence.

## Wording and degraded behavior

Use “Current records”, “Selected time” and a “Latest” reset, with persistent text:
“Filters timestamps in currently loaded data. Positions are not historical.”
Show absolute cursor/anchor time so an old anchor is not presented as current
wall time. Do not use LIVE, Replay, Projected or Forecast for this control.

Latest advances the anchor to the present, pauses, and invokes the existing
reset behavior. It denotes the latest selection, not a guarantee that every
entity's opacity has been restored. Label the sync count “N retained timeline
events”: it counts an in-memory six-hour window, not visible map entities.
Zero retained events cannot imply no real-world events occurred.

## Non-goals and open acceptance

Do not modify `GlobeDataManager`, `GlobeDegradation`, provider timestamps,
history stores, prediction calculations, notifications, or UX-005 lens wiring.
No dependencies, external requests, credentials, persistence or migrations.
Tests use fixtures; no installed app/profile access.

Existing 4D alpha overwrites, lost base alpha, asynchronous entity arrivals and
incomplete opacity reset remain unresolved. This stage cannot establish coherent
map styling or historical replay and must not close UX-016. A later approved
stage must consolidate opacity writers, preserve true bases and apply cursor
state to new entities. Preserve the future `trueBase × cursorFactor × lensFactor`
contract, incorporating degradation without a later overwrite. UX-005 remains
held pending producer-to-renderer identity design; no lens is mounted here.

## Bounded work and validation

| Owner | Files / responsibility | Dependencies and acceptance |
| --- | --- | --- |
| Parent | Brief, design, UX-016 tracker, draft claim and evidence | Approval; one task per draft; retain full acceptance open |
| UI/map specialist | `src/components/GlobeTimeMachine.ts`, `TimeScrubberHud.ts`, `GodsVisionView.ts`, `gods-vision/GlobeTimelineSync.ts`; necessary existing HUD styles only | Approved draft claim; implement the state, scheduling, wording and lifecycle contract above |
| Test specialist | Focused tests under `src/components/__tests__/`; `package.json` entry `test:ux016` | Agreed controller interface; real controller/HUD/bridge with fake clocks/scheduler, DOM and mocked viewer/data manager |
| Independent reviewers | Completed diff and recorded evidence, read-only | Validation; Sol review and actual Sonnet conclusion with SHA-pinned verdict |

Behavior tests must cover one mounted control/owner; HUD, Space and existing
consumers sharing state; filter and event delivery during continuous playback;
bounded commit rate; finite/clamped input; endpoint and anchor semantics; truthful
wording/counts; hidden cancellation; focus protection; teardown and re-entry.
Pure cursor tests alone do not establish mounted behavior. Every changed
behavior requires a confirmed-applied mutation, actual red counts, restored
checksum and clean tree. No live-source probe is needed: sources are unchanged.

Planned commands after implementation:

```sh
npm run test:ux016
npm run test:playback
npm run test:globe
npm run typecheck:all
bash scripts/agentic-validate.sh --tests "test:ux016 test:playback test:globe"
```

Baseline only, run November 25 before implementation: roadmap tests 135 pass /
0 fail; playback tests 14 pass / 0 fail; globe tests 53 pass / 0 fail;
`typecheck:all` exited 0. These do not validate the proposed changes. Manual
installed acceptance remains open while holds apply.

## Alternatives, rollback and publication

A full opacity/arrival redesign better satisfies the entire task but expands
into 4D styling and entity lifecycle. Choose this bounded control stage first;
do not silently include that broader work. No storage migration; rollback is a
code revert. After implementation, record actual tests, mutation results,
review conclusions, limitations and manual checks before asking to publish code.

Proposed documentation claim: “UX-016: unify timeline control ownership”. Draft
body must state that implementation targets current-record filtering only and
full cursor/opacity acceptance remains open. The unrelated UX-076 metadata
correction records merged #1900 without claiming packaged acceptance.

Merging, auto-merge, releases, deployment and installation remain paused for
this work. Separate dependency PR #1920 remains in its existing workflow per
the user's explicit November 25 instruction.

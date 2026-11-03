# UX-053 — Finish boot while sources continue loading

Proposed November 3, 2026 against canonical main `cd459dfec`. The roadmap controller selected UX-053 at priority S with no blocking findings. Changing application startup and the timing of warning listeners is high assurance.

## What currently waits

`App.init()` mounts the panels, installs navigation and search, and attaches URL and event handlers before phase 6. It then awaits both country geometry and `DataLoaderManager.loadAllData()`. The loader admits critical tasks first and deferred tasks second, with a concurrency limit of 12. The later startup steps wait for both waves. The desktop vault intro separately races initialization against a 1.7-second timer and can say “READY” when only the timer has elapsed. It is a visual intro. Browser navigation can already work while feeds are loading.

Holding acquisition for 120 ms in an isolated test of the current startup method demonstrated the ordering. Layout and the phase-6 wait were reached at 2 ms, while refresh registration, deep-link handling and breaking-news listener registration had not run. Releasing the hold completed all three at 127 ms. Those are controlled fixture timings. The earlier 70–78-second first waves in the performance audit are historical measurements.

A second probe exercised the production full web entry, real keyboard search and the real loader scheduler in Chromium, with provider calls replaced by controlled promises. Search worked in both fresh and reused storage while news was held. Ten critical tasks began, including NWS. ShakeAlert began only after news was released. Refresh registration and the end of initialization still waited for ShakeAlert. No page errors were observed. This establishes the ordering, not an end-user latency distribution. HTTP cache was disabled in both runs. The baseline receipt has SHA-256 `d11407862ff06f96b71361aeff70c05619395a4a8857074f92f19c060c9f13dc`.

## Proposed operator experience

* Treat the first screen as ready when the intended workspace or first-run control accepts input. On desktop, account for the intro overlay and keyboard focus. A pending or failed boot must not display “READY” merely because the animation timer expired. Use neutral opening copy while pending and retain an actionable startup error if initialization fails.
* Let sources continue in the background once the interactive prerequisites succeed. Indicate loading or degraded status using the existing source surfaces. Completing a fetch wave, registering a listener or displaying a cached panel cannot certify current warnings or an all-clear.
* Track warning listener registration independently from valid warning evidence. Preserve domain rules, current settings, Ghost holds, permission requirements, existing onboarding and privacy gates. Separate passive listener registration from work that might prompt, send a notification or initialize an external relay. No stored catch-up sends for events withheld while an outward route is ineligible.
* Use an eligible synthetic authoritative warning to verify routing during an unrelated stalled feed. Test current, cached, expired and unavailable evidence independently. The web and desktop breaking-news listener is a separate path from NWS acquisition. On the full variant NWS is already in the critical wave, while ShakeAlert currently waits for every critical task to settle. Move the existing ShakeAlert startup request into the bounded first wave so an unrelated slow market or news fetch cannot prevent it from starting. Verify both admissions while preserving the twelve-request limit and platform/variant rules.

## Startup ordering and ownership

1. Retain existing database, locale, bootstrap/cache hydration, location, privacy and pre-layout prerequisites. Fatal prerequisite or rendering errors reject interactive boot. The earlier readiness boundary must not hide those failures or retire the UX-050 recovery notice early.
2. Arrange a single owned initial acquisition after required subscriptions are attached. Keep the existing full-wave promise for callers that depend on complete acquisition, including retry and playback exit. Coalesce overlapping startup waves, preserve existing per-source admission and concurrency, and observe errors immediately. A stalled unrelated feed cannot delay interaction.
3. Tie data-dependent initialization to its real prerequisites. In particular keep learning, persisted snapshots and data-dependent deep-link retry budgets behind suitable data. Preserve the existing search rebuild, refresh event and historical meaning of the app-loaded metric. Use local diagnostic timestamps for the new milestones. Start the existing late tasks once only.
4. On teardown, prevent stale continuations from adding listeners, starting timers, updating search, emitting completion events or overwriting a later app instance. Preserve retry, visibility, map and replay behavior. Retain provider timeouts, destinations, inference algorithms, notification eligibility and storage schemas.
5. Test staged integration with held drafts #1844, #1846 and #1847. In the combined build, the existing NWS refresh from #1844 must still run on its approved cadence while an unrelated source stalls. Use its existing in-flight and mode rules. No new source polling or delivery policy is proposed for the standalone main-based branch.

## Implementation and acceptance

| Owner | Scope | Evidence |
| --- | --- | --- |
| Startup/UI | App orchestration, normal entry and desktop intro text, focus and recovery | Test keyboard interaction, pending/rejected prerequisites, intro timeout, cancellation and disposal |
| Data and alert routing | Data-loader lifecycle and existing warning registration, with transport capture | Verify one initial wave, bounded concurrent tasks, healthy and unavailable inputs, cleanup and no replay |
| QA | Current and candidate browser and uninstalled Tauri renderer, temporary profiles, fixed synthetic transport | Compare cold and warm launches, hold a non-warning source, record first actual interaction, eligible warning route where applicable, first verified warning and whole-wave settlement |
| Independent reviewers | Complete implementation, baseline parity, mutation evidence and branch reconciliation | Run the repository gate, CI-selected suites and both SHA-pinned reviews before a code push |

Use at least three cold and three warm samples per renderer for the controlled measurement. Report the range, median and any failed runs. Pass when the first screen accepts input and an eligible injected warning is handled before the unrelated source releases. Keep a negative control for denied permissions and Ghost Mode. Confirm that an authoritative clear requires valid source evidence. A later whole-wave failure remains observable. Reversing each new guard must fail the corresponding test. Attach exact suite results, identified fixture limits and manual reproduction steps.

Rollback reverts startup orchestration to waiting for the initial wave. There is no persistent migration. Publishing the draft claim and starting production implementation require operator approval. Installation, auto-merge and delivery are paused.

# UX-053 startup readiness

The workspace can accept input while unrelated feeds are pending. Keyboard search was already usable at this point on canonical main. The change separates interactive initialization from the complete source wave, starts the existing ShakeAlert panel request alongside NWS, and corrects the desktop intro's readiness text. This does not establish source freshness. NWS warnings still require their normal source evidence, and ShakeMap panel observations do not represent an early earthquake warning service.

## How startup works

* The app completes its original critical prerequisites, installs UI handlers and attaches a passive breaking-news listener. The normal startup paths wait for the usable workspace and, on desktop, the decorative intro to finish before opening outward routes. A timeout alone cannot label the workspace ready.
* Early web banners require permission already granted, completed onboarding and an established non-Ghost preference. Native relays retain their eligibility checks. Previously blocked events are dropped. The initial wave must settle before existing automatic permission-request and iMessage settings-hydration behavior becomes eligible.
* Callers awaiting a full refresh keep that contract. A single shared promise prevents a retry from starting another wave. The twelve-task bound and variant predicates still apply. Learning, snapshot scheduling, data-dependent deep links, search reindexing, completion reporting and bulk refresh retain their data requirements.
* A fatal startup error offers a keyboard-accessible reload. A background acquisition failure is surfaced separately. Teardown guards late NWS and ShakeMap delivery and the startup continuations. Already-started transport work is not an acknowledgment that a source is current or that the OS presented a notification.

## Manual verification and rollback

1. Start with an isolated browser profile and an uninstalled desktop verifier. Hold news, record when the keyboard shortcut actually opens search and where focus lands. On a fresh profile, check the onboarding control. Repeat using the same profile and label the cache mode.
2. In the full variant, observe NWS and the ShakeAlert panel request before releasing news. With recording transports, submit an eligible warning and compare the store and panel. Repeat with Ghost Mode, unreadable preferences and an unavailable source. Retry during the wave and confirm there is only one acquisition.
3. On desktop hold initialization beyond the intro timer, then reject it. Check the message, keyboard-reachable recovery and absence of unintended sends. Close the workspace before a source resolves and verify its eventual response cannot update a replacement.
4. To roll back, revert startup and lifecycle changes together. No persisted-data migration or preference conversion is needed. When the held drafts land, rebase against the actual heads, reconcile the NWS refresh and Ghost startup paths, then rerun the combined verification.

## Baseline and verification boundaries

A full web-entry probe on canonical main `cd459dfec` held news. Keyboard search opened and took focus while NWS was already scheduled. The ShakeAlert panel request, refresh registration and the initialization tail all remained pending. Cold and reused-storage runs established this ordering. Prior 70–78-second measurements were from a different build and do not quantify the effect of UX-053.

The candidate product was tested at `7efdff90cd05a676f90cefa9e9c841b6a8464cc9`, tree `cb76564d4e101d2e145923d9f14ac6984f64ad0f`. The renderer tests use controlled feeds, temporary profiles and recording transports. A browser reload retains profile storage. Its routed network does not benchmark HTTP-cache speed. A signed disposable Tauri diagnostic host exercised WKWebView. Physical OS notification presentation and a deployed system were outside acceptance.

## Review and cancellation

The initial review held a database read and disposed the last router owner before releasing it. The original implementation still wrote to the inbox, displayed a toast, attempted native delivery and placed a map marker. The repair cancels the router's remaining work when the last owner closes, checks cancellation after asynchronous steps and lazy imports, and cancels stale marker timers. Repeating the original case produced zero subsequent effects. A remaining owner still receives eligible events. Database or OS operations already handed off before teardown cannot be recalled.

## Controlled renderer timings

Each cell gives the median and range in milliseconds for three runs, relative to navigation. Cold labels a fresh profile with onboarding already completed. Warm reloads the same storage. The separate first-run control focuses and advances the real Welcome modal. The held-news test and isolated inputs establish event ordering. These observations do not estimate end-user startup percentiles.

| Engine | State | Revision | Input handled | App.init resolved | Current warning processed | Wave released | Wave settled |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| web | fresh-storage | baseline | 2,399 (1,604–2,416) | 8,715 (4,296–106,223) | 3,556 (3,298–5,534) | 8,707 (4,292–106,189) | 8,710 (4,293–106,204) |
| web | fresh-storage | final | 1,507 (1,417–3,153) | 1,129 (996–2,214) | 2,853 (2,794–4,248) | 5,378 (4,463–5,988) | 5,379 (4,464–5,988) |
| web | reused-storage | baseline | 6,538 (4,536–7,715) | 10,327 (8,053–13,018) | 7,157 (6,932–9,975) | 10,325 (8,050–13,000) | 10,325 (8,051–13,002) |
| web | reused-storage | final | 1,590 (1,259–4,046) | 1,254 (946–3,513) | 2,642 (2,205–5,821) | 6,958 (5,863–8,946) | 6,959 (5,864–8,946) |
| desktop | fresh-storage | baseline | 11,052 (10,039–11,177) | 15,716 (15,526–17,316) | 2,872 (2,314–3,011) | 15,703 (15,520–17,303) | 15,710 (15,522–17,310) |
| desktop | fresh-storage | final | 8,842 (7,833–13,032) | 1,311 (1,287–1,882) | 1,383 (1,356–1,961) | 13,709 (11,693–19,314) | 13,710 (11,694–19,316) |
| desktop | reused-storage | baseline | 11,036 (10,620–11,376) | 16,600 (15,286–19,881) | 2,138 (1,615–3,023) | 16,592 (15,278–19,872) | 16,596 (15,281–19,876) |
| desktop | reused-storage | final | 11,095 (9,317–12,025) | 1,719 (1,297–4,091) | 1,777 (1,345–4,151) | 16,447 (12,956–21,445) | 16,450 (12,957–21,449) |

The input-first probe exercised search as soon as the phase-5 wiring breadcrumb was observed and, on desktop, the vault overlay was gone. It sampled an externally visible search input with focus. It did not wait for a data source or readiness promise before dispatching the synthetic key. The other experiment deliberately waited for a verified warning before the keyboard probe. Both experiments retain their per-run timestamps in the certificate.

NWS and the independently injected breaking-news event use different routes. All twelve final timing samples in each experiment received valid NWS evidence and captured exactly one eligible breaking event before news was released. The baseline captured zero during the hold and one after settlement. No real warning was delivered.

The acceptance and independent input-timing experiments together completed 76 isolated renderer starts. Chromium used the supported SVG map fallback on both revisions after software-GPU trials timed out under concurrent builds. Desktop used its normal graphics configuration. Warm desktop first input was essentially unchanged. [Renderer certificate including controls, failed harness attempts and individual samples](UX-053-RENDERERS.json).

## Verification results

The router fixture at `45d8ee421330d5de184a08bb0e86226a2ca27f0d` changes only tests. Its live controls first demonstrate actual database, transport and map effects, then repeat the same import with the workspace disposed. This fixed an earlier mock that swallowed the lazy module and hid missing guards.

All 106 individual mutations produced their expected failure. Removing the initial-wave ownership guard changed the App suite from 8/0 to 7/1. Each mutation has its applied diff, failure, restored checksum and clean-tree receipt. Superseded trials are identified in the [mutation certificate](UX-053-MUTATIONS.json).

The repository gate included focused startup, native notification, provider, onboarding, quiet-hour and mode regressions. The final fixture's affected suites reported `1 pass / 0 fail` and `70 pass / 0 fail` for `npm run test:ux053`, and `5 pass / 0 fail` and `89 pass / 0 fail` for `npm run test:native-notify`. The build and gate reported

```text
Agentic validation gate passed.
Tests run: test:ux053 test:native-notify test:providers test:ux060 test:quiet-hours test:mode-manager
[pwa:budget] 441 entries, 21.89 MiB
```

The isolated four-draft rehearsal reconciled four textual conflicts. It also moved the held NWS five-minute refresh registration before the initial wave and retained the existing in-flight checks. Chromium passed 29/29 checks. Ten delayed-warning cases passed, including teardown while an old fetch or saved-place lookup remained pending. Both type configurations passed. Ghost Mode startup in the combined build still met its offline budget of 468 entries, 21.92 MiB. The reconciled tree is a rehearsal. The four published drafts must be reconciled and retested against their actual landing heads. [Integration inputs, resolved tree, cases and results](UX-053-INTEGRATION.json).

The selector from canonical main ran every selected suite on the implementation tree in a separate worktree and reported `[targeted-tests] 47 script(s) passed.` The subsequent fixture-only change retained that selection and passed both affected suites again.

# UX-050 — making muted notifications visible

## Operator policy

Ghost Mode mutes standard notifications from the shared dispatcher, including critical site warnings, and eligible analyst nudges. Home and classic views show a standing notice and an “Exit Ghost Mode” action. Other channels can still alert. Direct smoke and AirNow callouts, inventory notifications and operational prompts retain their own settings.

The two numbers describe muted attempts and the critical subset in this window since entering Ghost or reopening it. One eligible analyst batch counts once. A silent request, a preliminary weather-ladder decision, an unknown-mode hold and a duplicate hypothesis do not increment the counters. Counters are local, saturate at 9,999 with a visible plus sign, and reset when Ghost ends. They store no alert contents or identifiers. No counter data is persisted or sent.

## What changed

* The mode manager reads the existing preference before dependent services start and shares its state with the dispatcher and both views. A failed read holds covered notifications and offers an explicit choice. A failed write leaves the choice active in the current window and displays that limitation.
* The dispatcher checks mode again before completing an asynchronous permission request. A switch into Ghost invalidates an outstanding send even if Ghost has since ended. Suppressed requests are never replayed on exit. The existing weather ladder and other delivery policies retain their own decisions.
* The document entry loads the recovery notice before the main application when the saved preference is unreadable. The initial mode reader, notice copy and import helper are isolated from code that reads unrelated storage. If application initialization also fails, the notice remains usable and explains the startup failure. A normal startup adopts the same controls. The family check-in action still constructs its message and calls the clipboard synchronously in the original click handler.
* The notice identifies the scope, preserves keyboard focus across shell changes and reports mode changes without announcing every counter increment. English fallback copy is available before localization initializes.

## Reproduction and verification scope

With Ghost saved on the original base, a synthetic critical NWS notification was suppressed while the UI mode was null and the refresh multiplier was one. Under cold, globally denied storage, the original application could fail before offering a mode choice. An intermediate implementation passed its module tests but failed four built-page assertions per renderer on both an unreadable storage getter and denied reads. Vite had placed the mode reader in a panel chunk with unrelated storage access.

Renderer verification uses temporary profiles, synthetic events, blocked external requests and a notification constructor that records attempts without calling the OS. The real site exposure calculation, big-event detector, weather ladder and dispatcher exercise a critical site warning. The complete web and desktop builds are tested separately from component fixtures. Under total storage denial the rest of the application can still fail to initialize. The acceptance criterion there is an honest startup status and usable in-window privacy controls. Keyboard behavior is tested in the DOM; screen-reader speech was not measured.

## Operator check and rollback

In an isolated profile, save Ghost, reopen the app and verify that the standing indicator precedes a synthetic warning. Trigger one critical site-warning attempt, confirm one increment, then switch shells with keyboard focus on Exit Ghost Mode. The same action should retain focus. Exit and re-enter Ghost and verify a fresh count. With the preference unreadable, choose a mode explicitly and check for the window-only label when saving fails.

Reverting the implementation together restores the previous entry, notice and dispatcher behavior. The existing mode key and its values remain compatible. No migration or cleanup of user data is needed.

## Measured results

Commit `d641f0c0f` passed 93 checks in Chromium and 93 in native macOS Tauri/WebKit. Each engine ran 54 checks against the actual component owners and 39 against the compiled product index. The built-index cases covered cold denied reads (8), a throwing storage getter (8), mode-key-only denial (9), restored Ghost (5) and a late application initialization failure after the notice had mounted (9). The native diagnostic host used a nonpersistent profile. The built-product harness adds offline restrictions to the production policy; this was not an installation or an unrestricted network test. [Renderer certificate with asset hashes](UX-050-RENDERERS.json).

The focused command was `npm run test:ux050`. It ran the mode, notification, shell, startup and chunk-assignment tests, the clipboard contract, a full-variant build and assertions against its emitted JavaScript. Its runner output included

```text
# pass 65
# fail 0
# pass 4
# fail 0
# pass 2
# fail 0
```

The emitted-graph test failed twice on the earlier build because startup imported the map stack before the operator could choose a mode. The repaired Vite configuration gives the shared preload helper precedence and keeps the preference reader and fallback copy outside the panel bundles.

Additional regression commands returned the following counts with zero failures.

| Command | Passed |
| --- | ---: |
| `npm run test:mode` | 19 |
| `npm run test:mode-manager` | 25 |
| `npm run test:analytics-consent` | 40 |
| `npm run test:analytics-lifecycle` | 19 |
| `npm run test:quiet-hours` | 120 |
| `npm run test:notifications` | 227 |
| `npm run test:home-reassurance` | 27 |

## Mutation proofs and review

All 100 behavior-changing mutations failed their expected assertions. The six proof suites returned to green after restoration. The 20 distinct source and test file checksums matched reachable implementation `d641f0c0f`. Two runs initially exhausted the test DOM formatter when an unexpected element was printed. Replacing those comparisons with equivalent boolean identity assertions produced the expected behavioral failures. No interrupted run counted as a proof. [Applied diffs, failed assertions, restored counts and checksums](UX-050-MUTATIONS.json).

Independent review identified keyboard focus falling to the document body when Home covered a focused classic notice. Both directions now transfer focus to the corresponding visible action. Focus elsewhere on the page stays with its owner. Browser and native rechecks verified this behavior.

The integrated repository gate ran `bash scripts/agentic-validate.sh --tests 'test:ux050 test:quiet-hours test:analytics-consent test:home-reassurance'`. It checked the lockfile, lint, both TypeScript configurations, secret scanning, documentation, the roadmaps and the production build. Its concluding output included

```text
Agentic validation gate passed.
Tests run: test:ux050 test:quiet-hours test:analytics-consent test:home-reassurance
```

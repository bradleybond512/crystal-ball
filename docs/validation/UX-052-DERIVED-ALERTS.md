# UX-052 derived alert interruptions

Operators can manage **Derived alerts** in Notification Settings. Critical inferences honor master mute, quiet hours, the domain threshold and channel preference. During an allowed period, the dispatcher permits one silent, non-sticky standard banner per two minutes and one per normalized title per fixed 30-minute window. It never prompts for permission. Original scores, severity, source identity, stored items and configured external relays retain their prior behavior.

## Reproduction and controls

On canonical main, five critical convergence candidates with one title and distinct locations produced five sticky notices during Cyber quiet hours. A critical NWS control still delivered. The expanded renderer fixture reproduced 100 banner attempts from 100 candidates. Test transports capture constructor calls and options without issuing an operating-system notification.

The dispatcher now records a fixed suppression reason, a successful banner constructor, or a failed attempt. Existing passive store, panel and map evidence remains visible. The reaction subscriber selects an eligible authoritative item from the batch before ranking. Derived items cannot cause audio, panel or window flashes, or a five-minute reminder.

## Preferences and rollback

Fresh profiles enable the Derived domain at High severity with quiet hours on. Existing profiles inherit restrictive Cyber choices once. Unreadable or incompatible settings pause derived outward notices and preserve the saved bytes. Rolling back the feature restores the previous interruption behavior. Earlier readers can ignore the optional v1 preference. Pacing state lives only in the current window.

## Manual verification

1. Use a temporary profile with a recording notification constructor. Open Notification Settings and tab to the Derived alerts controls. Change its channel, then move focus and confirm Cyber and the focused control retain their state.
2. Submit critical derived alerts with distinct IDs and the same title. Check the banner options and the reasoning diagnostics, then advance the clock two minutes and try a different title. Retry the original title at thirty minutes.
3. Repeat during quiet hours and with master mute enabled. Interleave an authoritative critical NWS warning and advance the five-minute reminder clock. Verify the authoritative warning keeps its alert behavior.
4. In the isolated combined build, restore Ghost Mode before startup and inspect the held count. Use separate test doubles for notification and webhook transports.

## Branch integration

UX-052 is based on main. The held weather-warning and Ghost Mode drafts overlap in the dispatcher and critical reminder. Before these branches land together, preserve the single Ghost hold from #1846, the active-warning expiry check from #1844 and the derived-source exclusions from #1847. Revalidate the combined code after rebasing.

## Validation of implementation `92259e7f2`

The focused command `npm run test:ux052` reported

```text
# tests 117
# pass 117
# fail 0
```

The independent mutation run reversed 58 behavior changes individually. All 58 produced the expected assertion failure, restored matching SHA-256 checksums and left a clean tree. Removing the synchronous reservation changed the dispatcher from 10/0 to 9/1 with two constructor calls. Allowing derived items into the interrupting reaction selection changed the reaction suite from 4/0 to 1/3. Removing the malformed-preference write guard changed the settings suite from 18/0 to 16/2. [All mutations with applied diffs, red counts and restored checksums](UX-052-MUTATIONS.json).

Chromium and a signed, uninstalled Tauri WKWebView each passed 33/33 checks on the reachable implementation. The reconciled disposable build passed 36/36 per engine, plus 91/91 targeted tests. It kept exactly one Ghost hold, retained retired warnings in history and correctly canceled their reminders. The reconciliation patch reproduces the resolved tree from the original conflict tree. The fixture exercises real application logic and settings controls with an isolated storage profile and recording transports. Physical OS presentation and live sending were outside this verification.

The independent reviewer ran 33 checks, verified the original and restored hashes for all 58 mutations, and reported zero blocking findings in implementation `92259e7f2`.

The reconciled tree also passed `npm run typecheck:all`. The renderer certificate records the exact input trees, isolated host configuration, baseline, recorded checks and their limits. [Renderer and integration certificate](UX-052-RENDERERS.json).

The repository gate ran the focused suites, lint, type checks, secret scan, roadmap and production build. Its concluding output was

```text
Agentic validation gate passed.
Tests run: test:ux052 test:acc509 test:notifications test:quiet-hours test:native-notify
```

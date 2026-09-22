# UX-000 — Packaged zero-key acceptance

Status: the approved isolated test ran on 2026-09-18; useful zero-key coverage
was not demonstrated. See [handoff #1725](https://github.com/bradleybond512/crystal-ball/issues/1725)
and the [repair follow-up](2026-09-18-ux000-test-followup.md). Timing captures
were incomplete, so this is not a full protocol pass. The retained test account
is now a used reproduction profile. The protocol below defines future acceptance
requirements; no account reset or new maintenance window is implied.
Risk: High Assurance operational isolation; no production implementation proposed.
Canonical prerequisite: UX-000 must pass before UX-001 Home posture.

## Objective and acceptance

Verify the existing signed production Tauri package with genuinely zero provider
credentials and clean first-run data. Preserve packaged custom protocol, CSP,
IPC, menus and bundled sidecar. Keep the normal user's credentials, records and
continuous monitoring intact outside a specifically approved maintenance window.

At first Home visibility, capture Home +0,+10,+30,+40 and +120 seconds. The implementation's
startup budget is 30s; +40 is diagnostic, not an increased budget. Record
elapsed times from Home initialization and any delayed paint/scheduling separately.
All 12 default Deck cards must settle to useful data or a truthful actionable
unknown/degraded state. No indefinite loading or unsupported all-clear.
USGS, GDACS, Open-Meteo and GDELT source rows must describe actual successful
fresh updates or truthful unavailable/unknown states. Empty successful results
must not imply all-clear. NewsAPI/OpenWeatherMap must be described as optional
keyed features, with their actual unlocks.

## Discovery and boundaries

Main loads persistent-cache.json in app_data_dir and uses the default WKWebView
store. It starts the sidecar before asynchronous keychain recovery finishes;
initial injected-zero messages therefore do not prove zero credentials. The
fixed crystal-ball keychain service, shadow vault, legacy credential migration,
inherited environment and package-relative .env.local all need accounting.
Changing HOME, bundle identity or one keychain call cannot isolate this path.

The native startup also inspects shared port 46123 and can terminate a prior Node
listener. A separate account alone is not sufficient while the normal app is
running. Do not launch competing instances, probe by killing processes, or use
fast-user-switching as assumed process isolation.

No packaged disposable-profile switch is implemented. Standalone WKWebView smoke,
browser mocks and a successful package build cannot close this acceptance item.
A compiled native acceptance mode would change several trust boundaries and is
not proposed in this plan.

## Selected environment and approval boundary

Prefer a new explicitly disposable standard macOS account, with a real GUI login
and its own login keychain. The user creates/signs into that account; no password
is entered or collected by the agent. The existing admin account is not a test
account. A clean macOS VM is an alternative when interrupting live monitoring is
unacceptable; its setup and availability must be verified separately.

Approval must name one 30-minute maintenance window with temporary interruption
of Crystal Ball monitoring and main-sync, plus the isolated account. Network
configuration remains unchanged in this bounded protocol.
Do not create an account, stop processes, pause sync, alter networking, install,
or execute the clean session before that approval. Other unaffected read-only
and normal-profile keyboard verification may continue.

## Execution protocol after approval

1. Record the exact canonical main SHA, green required checks, signed package
   identity/version/hash and OS build. Verify strict deep signature checking.
   Check the supported installer path before use; never copy over an existing
   application bundle. No new bundle identifier or instrumented app substituted.
2. Record current main-sync state and normal app identity. At the agreed window,
   pause the known sync agent and quit the normal app gracefully. Verify its
   sidecar exits and port 46123 is free. Abort on any unknown remaining listener;
   never terminate an unrelated process to clear the port.
3. Fully log out of the normal account; do not leave its app running via fast
   switching. Log into the dedicated test account. Do not import a keychain,
   app data, iCloud state, provider environment or saved preferences. Inspect the effective keychain search
   list, including System keychain availability; no crystal-ball consolidated or
   supported legacy entries may supply credentials.
4. Verify no inherited provider credential names are configured and the resolved
   sidecar fallback file is absent or unreadable. Record boolean/count
   evidence only; never print values. Confirm no prior app cache/shadow vault in
   the test account. A file existing is not equivalent to containing zero keys.
5. Use the supported installation/launch path inside that account only after
   package identity checks. Capture completed asynchronous secret-cache load as
   zero, including fallback inputs. Any unexpected credential prompt, nonzero
   count, migration or access to the normal user's paths invalidates the run.
6. Perform one pristine online no-saved-place first run without optional keys or location
   permission. Record onboarding copy, 12 card states, 4 source rows, elapsed time,
   evidence age, next actions and optional-key explanations. Do not infer that
   every provider must succeed; distinguish upstream outage from wrong UI state.
7. Exercise one Retry or related-panel action and record feedback. Relaunch once
   without resetting the QA profile, and distinguish QA-only cached/stale data
   from fresh data. Stop observation at 120s per launch if startup or credentials
   remain unresolved. No network disruption or offline case in this protocol.
8. Quit the test app, verify its sidecar and test listener exit, log out, and
   return to the normal account. Restore exactly the prior sync/monitoring state
   and verify the original profile still opens. Do not delete test data/account
   automatically; retain evidence for review, then request any destructive cleanup.
9. Independent reviewer audits build identity, credential isolation, timing and
   result matrix. Mark UX-000 DONE only with identified passing packaged evidence;
   otherwise attach actual failures and keep it MONITOR/BLOCKED as appropriate.

## Test matrix and evidence

| Case | Required evidence | Failure condition |
|---|---|---|
| Clean online startup | Completed zero-credential load; 12 card / 4 source states at 0/10/30/40/120s | Credential leakage, indefinite loading, unsupported readiness |
| No saved place/location permission | Explicit location-dependent unavailable state and next step | Fabricated local coverage or forced permission |
| Empty public-source result | Literal empty-update language and evidence age | Empty result labeled safe/all-clear |
| Optional setup | Distinguishes keyless vs keyed feature unlocks | Claims NewsAPI/OpenWeatherMap work without keys |
| Retry after degradation | Actual loading/result transition, bounded state | Permanent spinner or stale success presented fresh |
| Ordinary relaunch | QA-only cached/stale versus fresh state, no profile reset | Cached evidence presented as current |
| Normal-profile restoration | Original build/profile, restored sync/monitoring, no test data leak | Lost records/settings or monitoring left unintentionally stopped |

Capture timestamped native screenshots/accessibility text, sanitized credential
counts and app/sidecar lifecycle logs. Do not expose personal locations or secrets
in public PR evidence. Record unrun cases plainly. This protocol does not certify
UX-031 system appearance, UX-026 expiry fixtures, VoiceOver or the full six-goal
journey merely because startup passes.

## Rollback and stop conditions

No source migration. Abort on unknown listener, credential uncertainty, destructive
profile operation, unavailable isolation or unexpected permission request. Restore
recorded monitoring state before leaving the maintenance window. If isolation
cannot be established, keep UX-000 open and return the concrete blocker; do not
replace the user's live profile with a fixture.

## Owners and validation

User: test account login and maintenance-window decision. Agent: package identity,
sanitized evidence capture, approved test execution, restoration check and report.
Independent reviewer: evidence audit. No production module edits are authorized
by approving this operational protocol.

Before execution, rerun the existing Home tests and type checks. Browser startup
regressions support the contract but remain distinct from packaged results:
`npm run test:homeshell`, `npm run typecheck:all`, and the existing
`e2e/home-shell-boot.spec.ts` through its configured browser runner.

If no useful source succeeds, truthful degraded states alone do not establish
useful zero-key coverage; leave that criterion unproven. Full offline acceptance
belongs to its own protocol. Account creation/login is performed by the user;
no account password is provided to the agent.

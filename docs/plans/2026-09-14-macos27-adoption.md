# Crystal Ball — macOS 27 adoption

Status: refined platform adoption plan requested by Bradley. Revision 2,
September 14, 2026; broadens capability coverage and makes delivery decisions explicit. Native feature
implementation designs remain subject to their existing approval and review
gates. This document does not claim task completion or create duplicate UX IDs.

## Goal and product fit

Use macOS 27 to make the personal decision journey clearer, easier to reach and
more dependable: what affects me, how reliable is the evidence, what should I
do, and what changed? Preserve the six-goal sequence: trustworthy meaning, one
personal workflow, useful Home, attributable outcomes, offline drills and
uncoached user acceptance. The usability and accuracy roadmaps remain the live
trackers.

## Verified starting point

Recorded September 14 baseline (recheck before each implementation):
macOS 27.0, build 26A428. System WebKit reports
22625.1.29.11.27. Active Command Line Tools supply macOS SDK 27.0; installed
Xcode is 26.6 (17F113), and the active developer directory points to Command
Line Tools. SDK availability does not establish the SDK used by a packaged
application. No global toolchain setting was changed.

Repository discovery found Tauri 2.11.5, Wry 0.55.1 and Tao 0.35.2. The main
window is a transparent WKWebView with an overlay titlebar and HudWindow
vibrancy; most controls are DOM/CSS. Existing native menus, dock/menu-bar
status, location, bounded AppleScript notifications and opt-in speech provide
usable integration points. No App Intents, Foundation Models, WidgetKit or
Core Spotlight bridge was found. The inspected project configuration does not
explicitly set a minimum macOS version; inspect packaged artifacts before
changing or advertising compatibility.

## What the platform changes offer

Apple documents refined native Liquid Glass, window/menu behavior and a new
macOS show-borders environment value. Existing native glass can inherit some
changes; Crystal Ball's DOM controls require their own implementation and
verification. See [Apple's platform design updates](https://developer.apple.com/videos/play/wwdc2026/102/).

WebKit 27 adds customizable HTML select controls. This may improve filter and
settings menus while retaining semantic controls; use feature detection and
test the actual WKWebView. Grid Lanes already shipped in Safari 26.4, so it
is not a new macOS 27 feature. See [WebKit's release overview](https://developer.apple.com/videos/play/wwdc2026/204/).

App Intents gains richer Siri integration and system-path testing. Foundation
Models expands native model integration. Both require deliberate native
architecture and availability checks here; neither is enabled by upgrading
the OS. See [Apple's macOS developer overview](https://developer.apple.com/macos/whats-new/).

## Capability coverage and adoption decisions

Assess the relevant platform surface systematically. Adoption earns its place
by improving a named user task, protecting evidence quality, or reducing measured
resource cost. The decisions below are proposals, not claims of implementation.
“Existing” means an established Mac capability useful on 27; it is not advertised
as a newly introduced API. Platform availability and Tauri feasibility need
separate verification for each integration.

| Capability | Platform distinction | Decision and first useful outcome | Evidence required before adoption |
|---|---|---|---|
| WKWebView, WebGL and worker execution | OS runtime; engine changes in 27 | Now: dependable map, digest and emergency retrieval in the real desktop host | Packaged CSP/custom protocol, focus, lifecycle and cold-start checks; retain prior isolated smoke limits |
| Native chrome, Liquid Glass, sidebar/menu refinements and show-borders setting | Native design refinements in 27; DOM needs deliberate support | Now: readable controls, focus, inactive-window distinction and reliable titlebar hit areas | VoiceOver, contrast/transparency/motion preferences, light/dark, display scaling; no inferred native-glass adoption from CSS blur |
| Semantic select controls and adaptive layout | Customizable select new in Safari 27; Grid Lanes predates 27 | Next: richer settings/filter options with ordinary semantic fallback | Runtime feature detection, keyboard/VoiceOver, option selection and visual/tab-order agreement; no layout migration merely for novelty |
| Menus, keyboard actions and window restoration | Existing Mac capabilities | Now: open Home, brief and emergency information directly; restore usable windows across displays | Shared action routing, app closed/hidden/active, text-entry conflicts, deleted targets, full-screen/tiling and display disconnect |
| Energy, thermal state and background lifecycle | Existing power/lifecycle APIs | Now: avoid unnecessary hidden rendering and obsolete model work while preserving monitoring | Separate display work from monitoring; bounded new energy protocol and unchanged alert freshness/cadence requirements |
| User Notifications and actions | Existing native framework; currently AppleScript delivery here | Next: reliable permission handling and an “Open evidence” action | Stable IDs, permission denial/revocation, duplicates, late actions, cold launch; OS acceptance must not become a read or action-completion receipt |
| App Intents, Siri and View Annotations | Expanded integration/testing in 27 | Next after shared navigation: optional system access to existing screens | Allowlisted actions, runtime availability, native packaging, system-path tests; verify applicability to WKWebView before promising on-screen understanding |
| Core Spotlight and semantic discovery | Existing index plus enhanced system integration in 27 | Conditional: find explicitly selected briefs or emergency documents | Opt-in export policy, opaque identifiers, deletion/revocation, stale/expired results and correct deep links; indexing is additional disclosure even when local |
| Menu-bar detail and WidgetKit | Existing surfaces; styling/integration evolves in 27 | Menu-bar first; one widget only if it improves a demonstrated task | Evidence age/scope, stale expiry, app-not-running behavior, locked/shared-display privacy, delayed refresh, extension signing and minimal shared snapshot |
| Foundation Models and Evaluations | Expanded native model APIs and evaluation tools in 27 | Conditional: optional local explanation of an existing brief | Device/model/language availability, cancellation, quality/error evaluation, memory/energy budget, deterministic fallback; separate cloud eligibility from local availability |
| Vision/OCR and multimodal assistance | Existing Vision plus new model integration opportunities | Conditional: extract text from a user-selected preparation document for an offline pack | File access scoped to selection; show original and extracted text, dates and confidence; human verification before persistence; no automatic safety or outcome labels |
| Core AI/custom Apple-silicon inference | New framework in 27 | Evaluation only when an existing workload has a measured bottleneck | Compare existing runtime and native bridge on the same task/dataset/device; include conversion, model memory, download/license and maintenance costs |
| Icon Composer, native symbols and app identity | Tool/design refinements in 27 | Small optional finishing task after usability | Legible Dock/menu identity at small sizes, inactive/selected states and supported OS appearance; preserve branding and packaging |
| Share sheets, file opening and Quick Look | Existing Mac/document capabilities | Conditional: deliberate export/preview of an existing emergency artifact | Preview before export, redact personal data by default, preserve provenance/age, cancellation and permission revocation; no new sync service |
| Widgets from iPhone, Live Activities, media/Now Playing, spatial preview and immersive/3D web content | Capabilities vary by platform; some advances in 27 | Deferred unless a specific product task needs them | Demonstrated user demand and exact Mac API support; do not assume iOS capabilities are native macOS APIs or add another map/media stack without evidence |

Framework references: [User Notifications](https://developer.apple.com/documentation/usernotifications/)
supports local delivery and actions, but delivery is not guaranteed.
[WidgetKit](https://developer.apple.com/documentation/widgetkit/) uses timelines
and extensions; it must not be treated as a continuously running alert monitor.
[Core Spotlight](https://developer.apple.com/documentation/corespotlight/)
provides app-managed indexing; lifecycle and deletion remain our responsibility.
Apple's [Mac thermal guidance](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/RespondToThermalStateChanges.html)
describes established thermal-state APIs, not a new macOS 27 feature.

## Delivery order and dependencies

These are work packets, not new UX identifiers or a second completion tracker.

| Packet | Outcome and owner | Initial file scope | Dependencies and completion evidence |
|---|---|---|---|
| Compatibility and capability inventory | Native/test specialists establish the real supported host | `src-tauri/tauri.conf.json`, `Cargo.toml`, `Info.plist`, packaging scripts; read artifacts first | Identify binary architecture/deployment target, SDK/toolchain, Tauri/Wry versions and public API availability; packaged journey remains open after isolated smoke |
| Trustworthy native status and accessible navigation | UI/native specialists make Home and emergency actions discoverable | `src/services/native/menubar-status.ts`, keyboard registry/bootstrap, `src-tauri/src/main.rs`, chrome styles, existing Home/settings | Shared existing projections; distinguish absent high alerts from verified coverage; keyboard/VoiceOver and display matrix; supports goals 1–3 |
| Efficient desktop lifecycle | Native/UI specialists reduce discretionary work | `src/services/always-on.ts`, `src/app/refresh-scheduler.ts`, existing renderer/model lifecycle and native lifecycle handlers | Follow explicit always-on choice; no second scheduler; preserve monitoring freshness and resume correctness; supports goals 2, 5 and 6 |
| Actionable native notifications | Native specialist with notification owner replaces delivery boundary only | `main.rs`, notification push adapter and ledger, capabilities/packaging only if required | Preserve thresholds and cooldowns; permission/receipt/action contracts and real packaged permission tests; supports workflow and honest outcome evidence |
| System entry points and optional glanceable state | Native/UI specialists reuse navigation and status contracts | App Intents/Spotlight/WidgetKit targets only after separate design; existing command routing and menu-bar projection | Status/navigation packets first; export consent, deletion and signing verified; start with menu-bar detail and navigation intents, then justify a widget/index |
| Optional document/language assistance | Native/provider specialists use the existing AI and emergency document boundaries | `src/services/llm-adapter.ts`, existing emergency-pack import/export paths; narrowly scoped native adapter | Semantic prerequisites and evaluated availability; selected-file OCR may be independently scoped; no score/forecast/outcome authority |
| Packaged user acceptance | Test/UX owners exercise the six-goal journey | Reuse UX-028/029/030 protocols and their owning claims | Real app launch, brief, evidence, explicit action, offline reopen and after-action review; critical misunderstanding blocks acceptance |

### Two repository findings that change the priority

`computeThreatLevel` in `src/services/native/menubar-status.ts` returns green
when there is no unacknowledged high/critical alert. It does not evaluate
coverage. Before reusing this signal in richer menu-bar content or widgets,
define whether it means “no high alerts” and how unavailable/stale coverage is
shown. This is a source limitation, not a reproduced claim that the installed
UI says “safe.” Reuse the evidence-scoped Home contract rather than inventing
another readiness score.

`src/services/always-on.ts` defaults monitoring to on and deliberately preserves
reasoning/refresh cadence while hidden. Energy work must respect that product
contract. Begin with avoidable display updates, optional effects and cancelled
obsolete requests. Any change to monitoring cadence or protection semantics
needs a separate approved design and visible user choice.

### First three implementation briefs to prepare

1. **Native status and navigation:** define the displayed meaning, stale/unknown
   states and three exact navigation actions; trace them to existing controllers.
   Verify that the same state appears inside Home and outside the window.
2. **Accessible desktop controls:** inspect current packaged preferences and
   focus behavior, then fix demonstrated contrast, titlebar and keyboard gaps.
   Evaluate one semantic select enhancement before broad styling changes.
3. **Notification delivery contract:** specify requested/OS-accepted/suppressed/
   failed outcomes and a bounded open-evidence action. Record actual user action
   separately; permission or scheduling success never establishes that a person
   saw a warning or completed a preparation.

Energy discovery can run alongside these briefs, but measurements require a
new bounded protocol. Native AI and new extensions follow their prerequisites;
they are not blockers for a good Home or a dependable offline workflow.

## Architecture and boundaries

Keep native menu/action → allowlisted navigation → existing frontend controller
→ existing domain projection. Reuse `src-tauri/src/main.rs`,
`src/services/native/menubar-status.ts`, existing shortcut registry/bootstrap,
`HomeShellOverlay`, `DigestOverlay`, and the current settings controls.

UI chrome lives in `src/styles/window-chrome.css` and
`src/styles/macos-native.css`. A preference bridge, if needed, must expose
bounded appearance state rather than general native access. Test titlebar hit
areas and window corners before changing hard-coded material parameters.

Native permissions remain scoped to trusted windows. New intents must never
accept arbitrary JavaScript, URLs, paths or raw event names. System indexing
and notification actions need an explicit disclosure/permission design. Keep
existing notification decision rules, deduplication and cooldowns. A future
User Notifications bridge should improve delivery receipts and navigation
without silently changing alert policy.

Local AI is presentation assistance. It must preserve deterministic evidence
limits, Ghost Mode, opt-ins and cancellation. Evaluate hardware/framework
availability and privacy paths before selecting a provider.

## Verification and review

For each implementation task, map scope to a canonical UX/ACC task before
claiming a draft PR. Reuse an existing task only when its scope fits; otherwise
propose one new canonical task for approval rather than overloading a journey
test or creating an informal duplicate. Keep one task per PR, write the bounded
design and acceptance criteria, and use the repository specialist/reviewer sequence. Check exact npm script names before
execution. Relevant existing scripts include `typecheck:all`,
`test:ux010-native`, `test:notifications`, `test:emergency-pack`,
`test:renderer`, and the appropriate Home/digest/keyboard tests. Native changes
need Rust authorization/availability tests and the named-test agentic gate.
New behavior requires clean mutation proof.

Test actual WKWebView as well as browser harnesses. Packaged VoiceOver, native
menus, permission-denied behavior, offline restart and suspended/resumed state
require explicit protocols and identified builds. Record older-supported-system
coverage that is unavailable. Use unchanged performance/bundle limits.

UX-025 remains deferred: macOS 27 does not erase its failed CPU/RSS evidence
or reopen consumed diagnostics. Any new performance experiment requires its
own bounded approved protocol. Native glass is not a substitute for readable
evidence or a completed user journey.

## Migration, rollback and next decisions

Prefer changes with no data migration. Keep optional native integrations
independently reversible, with working existing navigation and controls. Do
not change the supported OS floor without a separate decision. A Swift bridge
requires a concrete build/signing/toolchain design; retain process-scoped
toolchain selection rather than changing global settings.

No app installation, model data access, new permissions or system indexing is
authorized by this roadmap alone. Prepare those concrete designs for approval.
Any later authorized install must use the mandated installer.

Immediate dependencies remain the map security repair and UX-026 cached-context
closeout, their complete evidence and real cross-agent review. The macOS plan
adds targeted platform work to the six goals instead of replacing them.

## First compatibility evidence

On macOS 27.0/26A428, the map-security candidate `16039e8be` passed its
15,012-test named gate, type checks and build. A separate one-shot system
WKWebView functional host passed 10 assertions covering the production worker,
clustering, overlay, controlled offline tiles and Navigation lifecycle. Native
screenshots verified rendering. These results establish a narrow functional
baseline, not packaged acceptance, a performance improvement or UI modernization.
Source/chunk/runtime evidence is retained under
`~/.crystalball-diagnostics/map-security-20260914/wkwebview27/`.

The native smoke host uses source index.html CSP; packaged HTML has different
localhost frame entries, while worker/map rules match. Complete packaged
security-policy and accessibility acceptance remain open. Independent review
found no blocking plan or evidence issue and confirmed that this supplement
preserves the existing task claims and UX-025 deferral.

## Capability, privacy and failure contracts

Record availability per feature: OS/API support, build SDK, device support,
user enablement, permission state and live provider/model availability are
separate facts. An unavailable integration leaves ordinary in-app navigation
and deterministic text operational. A feature availability flag never implies
that underlying evidence is fresh or that a place is protected.

Keep one typed native adapter per responsibility and a shared allowlisted action
registry. Do not create a generic command executor or parallel intelligence
engine. Cold-start actions wait for local state to hydrate, resolve opaque local
identifiers, and handle deleted items without exposing stale details. Navigation
must not acknowledge alerts or mark preparation complete as a side effect.

For each surface, list exported fields and retention. Saved-place names,
coordinates, notes and private documents are excluded from system indexing and
widget snapshots by default. User-approved exports must support removal and
consent revocation, including already indexed items and shared snapshots.
Specify Ghost Mode behavior and immediate suppression explicitly before shipping.
Do not assume widget privacy settings alone enforce Crystal Ball's policy.

A widget/menu snapshot carries generation time, evidence time, scope and expiry.
When refresh is delayed or the app is closed, its presentation must become stale
or unknown at the applicable boundary; it cannot perpetuate reassuring text.
Native notification delivery is best-effort. Keep a visible in-app history and
source/evidence destination regardless of delivery permission.

Apple on-device models, custom Core AI models and Private Cloud Compute are
separate provider choices. No cloud fallback without the existing explicit
provider/privacy policy. Do not assume App Store eligibility, free cloud access,
installed models or supported languages from macOS version alone. Evaluate
factual faithfulness to supplied evidence, unsupported conclusions, cancellation,
latency and peak memory on fixed tasks before adopting an adapter.

## Acceptance matrix and stop rules

| Dimension | Required scenarios | Record/pass condition |
|---|---|---|
| Native operation | Cold/warm launch, hidden/active, full-screen/tiling, display removal, sleep/wake and network recovery | Action routes once, window remains reachable, no lost focus, duplicate work or falsely refreshed evidence |
| Accessibility | Keyboard-only and VoiceOver, text zoom, light/dark, inactive window, reduced motion/transparency, increased contrast/show borders where exposed | Every critical action operable and named; visual and reading order agree; status understandable without color |
| Data and privacy | Fresh, stale, partial, missing, changed/deleted saved target, revoked indexing consent and Ghost Mode | Same truthful projection across surfaces; removed personal data absent from exports and indexes |
| Notifications and intents | Denied/revoked permission, duplicate/late action, app closed, unsupported API and absent target | Accurate receipts, safe fallback, no unintended state mutation or duplicate execution |
| Offline resilience | No network/model, valid/expired/missing pack, cold restart with actual persistence | Retrieve existing artifact, preserve provenance and distinguish unavailable from ready |
| Energy/performance | Foreground/background, always-on choice, power/thermal transitions where supported | New approved baseline/protocol; preserve current limits and alert freshness; report actual work avoided and measured cost, not assumed OS gains |
| Language/document assistance | Model unavailable, unsupported language, malformed/truncated input, cancellation and misleading source text | Deterministic fallback; extracted text reviewable; no invented warning scope, forecast confidence or completed outcome |
| Distribution | Verified supported minimum OS, current macOS 27, signing/entitlements, extension/helper availability and rollback | Packaged public-API path works; unavailable test hardware explicitly recorded; no unapproved OS-floor increase |

Every implementation brief records owner, files, canonical task, dependencies,
acceptance criteria, validation commands, data disclosure and rollback. Set any
new quantitative target before executing its measurement protocol. Maintain
existing budgets; a passing isolated smoke test is not a performance claim.

Existing verification entry points (selected by changed behavior, not all run
for a documentation edit):

```bash
npm run typecheck:all
npm run test:homeshell
npm run test:ux010-native
npm run test:notifications
npm run test:emergency-pack
npm run test:renderer
bash scripts/agentic-validate.sh --tests 'test:homeshell test:notifications'
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build:app:full
```

The UX-010 native suite guards its existing location/startup scope; it is not
blanket coverage for new native features. Add focused tests for new contracts,
mutation proofs for changed behavior, and packaged checks where mocks cannot
establish the result. Use the appropriate different named-test gate for other
work packets. Building a package does not authorize installing it.

Stop adoption of a capability if it creates stale reassurance, weakens privacy,
breaks offline access, fails accessibility, exceeds an unchanged budget or adds
an unmaintainable native packaging path. Preserve a working fallback and the
actual failed evidence. Revisit deferred capabilities when a named user task,
measured bottleneck or newly verified framework support changes the decision.

## Refinement status

Revision 2 expands the original plan with energy/lifecycle, delivery receipts,
Spotlight/index lifecycle, optional widgets, selected-document OCR, custom
on-device inference and document workflows. It adds explicit adoption/defer
choices and measurable acceptance. The September 14 host and smoke results above
remain historical evidence; no additional native run, materials experiment,
permission change, installation, application feature or provider integration was
performed as part of this plan refinement.

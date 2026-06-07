# Analyst Intelligence Enhancements — Design Spec

**Date:** 2026-06-07
**Goal:** Close the gap between raw data aggregation and lightning-fast, high-quality analyst-style intelligence delivery. Four PRs, executed in sequence.

---

## PR 1 — Surface What's Built (Wiring & UI)

### What

Three features that are logically complete in services but not exposed in the UI:

1. **Per-hypothesis confidence sparklines** — `hypothesis-threads.ts` already stores `confidenceHistory: number[]` (12 entries). The `buildSparkline()` method already exists in `AnalystHUD.ts` for posture advisories. Wire them together to render a confidence trajectory line under each hypothesis header.

2. **Social velocity spike as a first-class alert** — `telegram-intel.ts` has `earlySignal: boolean` on each item. `velocity.ts` has `VelocityLevel` (spike/elevated/normal). These never surface in the Analyst HUD or unified alerts as a distinct signal type. Wire Telegram `earlySignal` items and velocity spikes into a new `HypothesisKind: 'social-velocity-spike'` that the analyst loop can rank and display.

3. **Adversarial toggle on demand** — `hypothesis-skeptic.ts` runs per-hypothesis and `buildHypSkeptic()` already renders output. The problem: the skeptic only runs on a background cadence and the toggle button is buried. Add a "challenge" button (⚡) on the hypothesis header that triggers `runSkepticFor(h)` immediately and expands the result. If no skeptic note exists yet, show a loading state.

### Architecture

**Confidence sparklines:**
- `AnalystHUD.ts`: add `buildHypConfidenceSparkline(thread: HypothesisThread): SVGSVGElement` reusing the existing `buildSparklinePath()` helper with `thread.confidenceHistory`. Append after the thread badge in `buildHypHead()`. Width 60px, height 14px, colored by trajectory (green = strengthening, amber = stable, red = weakening).
- No service changes needed.

**Social velocity:**
- New file: `src/services/social-velocity-bridge.ts` — polls `fetchTelegramFeed()` and `fetchRedditGeoPosts()` on a 90s interval. Collects `earlySignal` items and computes a 15-minute rolling count. When count crosses SPIKE_THRESHOLD (4 items in 15 min from 2+ distinct sources), emits `cb:social-velocity-spike` with a synthesized `Hypothesis`-compatible payload.
- `analyst-loop.ts`: subscribe to `cb:social-velocity-spike`, inject as a `social-velocity-spike` hypothesis kind, rank it with the rest.
- `AnalystHUD.ts`: add a distinct icon/color for `social-velocity-spike` kind (orange lightning bolt, label "Early Signal").

**Adversarial toggle:**
- `AnalystHUD.ts`: replace the static `buildHypSkeptic()` with a button labeled "⚡ Challenge" in the hypothesis head. `onclick` calls `requestSkepticRun(h.id)` — a new export from `hypothesis-skeptic.ts` that queues an immediate skeptic pass and emits `cb:skeptic-note-updated` when done. The HUD re-renders just that hypothesis row on the event.
- `hypothesis-skeptic.ts`: add `requestSkepticRun(id: string): void` — finds the hypothesis by ID in the current snapshot, runs the skeptic immediately (bypasses cadence timer), stores the result.

### Data flow

```
telegram-intel / reddit-osint
        ↓
social-velocity-bridge.ts  (90s poll, 15-min rolling window)
        ↓ cb:social-velocity-spike
analyst-loop.ts  (injects as ranked hypothesis)
        ↓ cb:analyst-hypotheses
AnalystHUD.ts  (renders with orange lightning icon + confidence sparkline)
```

### Files changed

| File | Change |
|------|--------|
| `src/services/social-velocity-bridge.ts` | New — 90-line service |
| `src/services/hypothesis-skeptic.ts` | Add `requestSkepticRun()` export |
| `src/services/analyst-loop.ts` | Subscribe to `cb:social-velocity-spike`, include in hypothesis list |
| `src/components/AnalystHUD.ts` | Add confidence sparklines, social kind icon, challenge button |
| `src/app/panel-layout.ts` | Boot `social-velocity-bridge` |

### Tests

- `social-velocity-bridge`: spike fires when ≥4 earlySignal items in 15 min from 2+ sources; no spike below threshold
- `AnalystHUD`: confidence sparkline renders correct point count from `confidenceHistory`

---

## PR 2 — Voice & Audio Brief

### What

A TTS (text-to-speech) layer that lets the user receive intelligence verbally:

- **"Read sitrep" button** in the Analyst HUD header — reads the top 3 hypotheses + posture advisories aloud
- **Auto-read on high or critical** — when a hypothesis crosses `high` or `critical` risk, is new to the session (keyed by hypothesis signature), and auto-read is enabled, it announces itself. A per-session "already read" set prevents repeat announcements on subsequent analyst cycles.
- **`/voice` slash command** in Claude Code — triggers a full spoken sitrep via the MCP server → sidecar → desktop app pipeline
- **Voice settings** — rate, pitch, voice selection (from `speechSynthesis.getVoices()`), auto-read toggle, max items

### Architecture

**New service: `src/services/voice-brief.ts`**

```typescript
export interface VoiceBriefOptions {
  maxItems: number;       // default 3
  includePosture: boolean; // default true
  autoRead: boolean;
}

export function readBrief(hypotheses: Hypothesis[], posture: ForecastAdvisory[]): void
export function readAlert(text: string): void
export function cancelReading(): void
export function isVoiceAvailable(): boolean  // checks speechSynthesis support
export function getVoices(): SpeechSynthesisVoice[]
export function loadVoiceSettings(): VoiceBriefOptions
export function saveVoiceSettings(opts: VoiceBriefOptions): void
```

**Implementation:**
- Primary: Web Speech API (`window.speechSynthesis`) — no key, no network, works offline
- Fallback: Groq TTS API if `GROQ_API_KEY` is set and Web Speech is unavailable (e.g., headless Tauri window)
- Text is constructed by a `buildBriefScript(hypotheses, posture)` pure function: "Current threat level: High. Three active situations. First: [statement], confidence 78%, strengthening over 4 cycles. Second: ..."
- Sentences are queued as `SpeechSynthesisUtterance` objects so they can be cancelled mid-stream

**HUD integration:**
- Add 🔊 button to HUD header (next to settings gear). Click reads current hypotheses. Click again cancels. Visual indicator (pulsing ring) while reading.
- Auto-read: when `cb:analyst-hypotheses` fires and any hypothesis is `high` or `critical` risk, `autoRead` is enabled, and its signature is not in the per-session `alreadyRead` Set. Add signature to `alreadyRead` after reading. Session resets on page reload.

**MCP `/voice` command:**
- New tool `read_brief` in `tools/mcp-server/tools/analyst.mjs` — posts to `/api/analyst-commands` with `{ action: 'read_brief' }`
- `analyst-command-listener.ts` in the renderer handles `read_brief`, calls `readBrief()` with current state

**Settings panel:**
- Add "Voice Brief" section to HUD settings (`Cmd+,`): voice selector dropdown, rate slider (0.7–1.4×), auto-read toggle, max items (1–5)

### Files changed

| File | Change |
|------|--------|
| `src/services/voice-brief.ts` | New — ~120 lines |
| `src/components/AnalystHUD.ts` | Add 🔊 button, auto-read trigger |
| `src/services/analyst-command-listener.ts` | Handle `read_brief` action |
| `tools/mcp-server/tools/analyst.mjs` | Add `read_brief` tool |
| `src/styles/analyst-hud.css` (or equivalent) | Pulsing ring animation |

### Tests

- `voice-brief`: `buildBriefScript()` produces correct sentence order; `isVoiceAvailable()` returns false in jsdom
- `analyst-command-listener`: `read_brief` action dispatches to voice service

---

## PR 3 — Historical Analog Engine

### What

When an active situation starts developing, the system finds the closest historical precedent and shows: what matched, how confident, and what happened next over 7/14/30 days.

Example: "Active situation matches **2022 Russia-Ukraine escalation pre-war** at 74% similarity. In the 14 days following that event: energy futures +31%, European equities -12%, NATO force posture elevated, 3M refugee displacement began."

### Architecture

**Historical event library: `src/services/historical-analogs/analog-library.ts`**

A typed, static dataset of ~60 historical crisis events. Each event is a `HistoricalEvent` with a feature vector:

```typescript
interface HistoricalEvent {
  id: string;
  name: string;              // "2022 Russia-Ukraine Pre-War Escalation"
  date: string;              // ISO
  domains: DomainMix;        // fraction of activity in each domain: conflict/cyber/economic/disaster
  escalationSpeedDays: number;  // how fast it went from watch to critical
  geographicScope: 'local' | 'regional' | 'global';
  actorTypes: ActorType[];   // state/non-state/hybrid/criminal
  economicShockMagnitude: 0|1|2|3;  // none/mild/moderate/severe
  cyberComponent: boolean;
  priorWarning: boolean;     // was there detectable signal before the event?
  outcomes: HistoricalOutcome[];  // what happened in 7/14/30 days
}

interface HistoricalOutcome {
  horizon: 7 | 14 | 30;     // days after event onset
  domain: string;
  description: string;       // "Energy futures +31%"
  magnitude: 'minor' | 'moderate' | 'major';
}
```

Initial library: 60 events covering major conflicts, financial crises, cyber campaigns, natural disasters, pandemics. Stored as a static TypeScript array (no fetch, no API, works offline).

**Similarity engine: `src/services/historical-analogs/analog-scorer.ts`**

```typescript
export function scoreAnalogs(situation: ActiveSituation): AnalogMatch[]
```

Builds a feature vector from the active situation using existing services:
- Domain mix from `situation-clustering.ts` (which domains are contributing evidence)
- Escalation speed from `hypothesis-threads.ts` (`firstSeen` → `cycleCount`)
- Geographic scope from entity extraction
- Economic shock from market anomaly baselines
- Cyber component from cyber feed activity

Computes cosine similarity against all library vectors. Returns top 3 matches with score ≥ 0.45.

**New service: `src/services/historical-analogs/analog-monitor.ts`**

Runs every 5 minutes. For each top-ranked hypothesis, calls `scoreAnalogs()`. When a match ≥ 0.55 is found (and hasn't been shown in the last 30 min), emits `cb:analog-match` with the match payload.

**HUD integration:**
- `AnalystHUD.ts`: add an "Analog" section below the hypothesis statement when an analog match exists. Shows: matched event name + date, similarity %, a mini outcome table (7/14/30 day what-happened-next), and a "View details" expand.
- The section only appears on hypotheses with a match score ≥ 0.55.

**MCP tool:**
- `find_historical_analog(situation_description: string)` — new tool in analyst.mjs. Accepts a free-text description, builds a rough feature vector via LLM extraction, runs scorer, returns top matches.

### Files changed

| File | Change |
|------|--------|
| `src/services/historical-analogs/analog-library.ts` | New — ~500 lines (60 events) |
| `src/services/historical-analogs/analog-scorer.ts` | New — ~120 lines |
| `src/services/historical-analogs/analog-monitor.ts` | New — ~80 lines |
| `src/components/AnalystHUD.ts` | Add analog card per hypothesis |
| `src/app/panel-layout.ts` | Boot analog-monitor |
| `tools/mcp-server/tools/analyst.mjs` | Add `find_historical_analog` |

### Tests

- `analog-scorer`: Ukraine pre-war vector scores ≥ 0.80 against Ukraine 2022 event; fires no match on a weather-only situation
- `analog-monitor`: emits event when score ≥ 0.55; respects 30-min cooldown

---

## PR 4 — Natural Language Query + Personal Impact Cascade

### What

Two surfaces that turn existing intelligence into actionable, personalized output:

**A. Natural language query panel** — `crystal-ball-chat.ts` is fully built but its panel is not prominent. Surface it as a persistent bottom-drawer panel with a visible input field, quick-ask chips, and streaming response display.

**B. Personal impact cascade** — Wire `personal-impact.ts` + `country-consequence-engine.ts` + `supply-chain-impact.ts` into a forward-projection renderer. When an active situation is set, the cascade computes: portfolio exposure, travel route disruption probability, commodity price trajectory, utility risk — shown as a timeline card in the Command Center and as a collapsible section in the HUD.

### Architecture

**A. NL Query Panel**

- New panel: `src/components/AskCrystalBallPanel.ts` (Panel subclass). Wraps `crystal-ball-chat.ts`.
- Layout: persistent input bar at bottom, scrollable response area above, 5 quick-ask chips that rotate based on current mode and top hypothesis.
- Streaming: `crystal-ball-chat.ts` already routes through Claude Agent with Ollama fallback. Add streaming token-by-token display using `ReadableStream` from the sidecar.
- Context injection: the panel automatically appends current top hypothesis + active posture advisories to every message as system context — so "should I be worried?" produces a personalized answer, not a generic one.
- Register in `panels.ts` as `'ask-crystal-ball'` in the Intelligence Digest category.

**B. Personal Impact Cascade**

New service: `src/services/personal/impact-cascade.ts`

```typescript
export interface ImpactCascade {
  situationId: string;
  computedAt: number;
  horizon30d: CascadeLayer[];
  horizon14d: CascadeLayer[];
  horizon7d: CascadeLayer[];
}

export interface CascadeLayer {
  domain: 'portfolio' | 'travel' | 'commodity' | 'utility' | 'supply_chain';
  headline: string;           // "AAPL exposed via Taiwan supply chain disruption"
  magnitude: 'low' | 'med' | 'high';
  confidence: number;
  detail: string;
  sources: string[];          // which services produced this layer
}

export async function computeImpactCascade(
  situation: ActiveSituation,
  profile: PersonalProfile
): Promise<ImpactCascade>
```

Implementation:
1. Calls `getPersonalImpact(situation, profile)` from `personal-impact.ts` — gets immediate risk rows
2. Calls `getCountryConsequences(situation.topCountries)` from `country-consequence-engine.ts` — gets downstream country effects
3. Calls `computeSupplyChainImpact(situation)` from `supply-chain-impact.ts` — gets commodity/logistics effects
4. Calls `getCommodityForecasts(situation)` — checks shortage models for any commodity triggered by situation
5. Merges into `ImpactCascade` sorted by magnitude × confidence, deduped by domain

**HUD integration:**
- New collapsible section "Impact on You" at the bottom of the top-ranked hypothesis. Only appears when `PersonalProfile` has ≥1 saved place or ≥1 portfolio ticker.
- Shows: up to 3 `CascadeLayer` cards with domain icon, headline, magnitude bar.
- "Full projection →" link opens the Command Center panel focused on this situation.

**Command Center integration:**
- `CommandCenterPanel.ts`: add a "Personal Exposure" card below the top-3-things-that-matter section. Runs `computeImpactCascade` for the active situation on a 5-minute cadence. Shows 7d / 14d / 30d horizon tabs.

### Files changed

| File | Change |
|------|--------|
| `src/components/AskCrystalBallPanel.ts` | New — ~200 lines |
| `src/config/panels.ts` | Register `ask-crystal-ball` |
| `src/app/panel-layout.ts` | Instantiate `AskCrystalBallPanel` |
| `src/services/personal/impact-cascade.ts` | New — ~180 lines |
| `src/components/AnalystHUD.ts` | Add "Impact on You" section |
| `src/components/CommandCenterPanel.ts` | Add Personal Exposure card |

### Tests

- `impact-cascade`: a Taiwan conflict situation with AAPL in portfolio produces a `portfolio` layer with `high` magnitude
- `impact-cascade`: a US hurricane produces `travel` + `utility` layers but not `portfolio` (unless energy tickers present)
- `AskCrystalBallPanel`: quick-ask chips update when top hypothesis changes

---

## Execution Order

| PR | Branch | Estimated scope |
|----|--------|-----------------|
| PR 1 | `claude/analyst-surface-hidden` | ~300 lines changed |
| PR 2 | `claude/voice-brief` | ~250 lines new |
| PR 3 | `claude/historical-analog-engine` | ~750 lines new |
| PR 4 | `claude/nl-query-impact-cascade` | ~500 lines new |

Each PR is independently mergeable. PRs 3 and 4 have no dependency on each other. PR 2 depends on nothing. PR 1 should land first since it adds the `social-velocity-spike` hypothesis kind that PRs 3 and 4 can score against.

---

## Invariants (apply to all PRs)

- No new API keys required for any feature (Web Speech API is free; all services use existing keys)
- All new services are input-output pure where possible (no DOM, no fetch in scoring/matching functions)
- Ghost Mode suppresses voice auto-read and social-velocity-spike notifications (but not manual reads)
- All new hypothesis kinds degrade gracefully to empty state when their source services are unavailable
- Historical analog library is static TypeScript — no fetch, works offline

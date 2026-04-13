# Crystal Ball — Apple-Native Polish Overhaul

**Date:** 2026-04-13
**Design language:** Apple-native precision (SF Pro, spring animations, frosted glass, restrained motion)
**Phasing:** Foundation-first — design system tokens, then motion, then visual migration, then feature-specific polish
**CSS strategy:** Fresh `design-system.css` + bridge — clean token file imported first, existing CSS migrates gradually

---

## Phase Architecture

Phases 1–3 are sequential (each builds on the last). Phases 4–6 are parallel (all consume the same foundation).

```
Phase 1: Design System Foundation
    ↓
Phase 2: Transitions & Motion System
    ↓
Phase 3: Visual Hierarchy & Typography
    ↓
    ├── Phase 4: Alert & Notification UX
    ├── Phase 5: Map & Data Visualization
    └── Phase 6: Empty States, Onboarding & God's Vision
```

---

## Phase 1 — Design System Foundation

**New file:** `src/styles/design-system.css`

### Typography Scale

- **UI text:** -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui
- **Monospace:** "SF Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace

| Token | Size | Usage |
|-------|------|-------|
| `--text-2xs` | 10px | Timestamps, metadata |
| `--text-xs` | 11px | Badges, labels |
| `--text-sm` | 12px | Body small, panel content |
| `--text-base` | 13px | Body default |
| `--text-md` | 14px | Panel titles, emphasis |
| `--text-lg` | 16px | Section headers |
| `--text-xl` | 20px | Page titles |
| `--text-2xl` | 24px | Hero numbers, HUD |

**Weights:** `--fw-regular` (400), `--fw-medium` (500), `--fw-semibold` (600), `--fw-bold` (700)

### Spacing Tokens (4px base grid)

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Tight gaps |
| `--space-2` | 8px | Inline spacing |
| `--space-3` | 12px | Related items |
| `--space-4` | 16px | Panel padding |
| `--space-6` | 24px | Section gaps |
| `--space-8` | 32px | Major sections |
| `--space-12` | 48px | Large separations |
| `--space-16` | 64px | Page-level spacing |

### Color Tokens

**Surface layers (dark mode):**

| Token | Value | Usage |
|-------|-------|-------|
| `--surface-base` | `#0a0a0a` | App background |
| `--surface-raised` | `#141414` | Panel backgrounds |
| `--surface-overlay` | `#1c1c1e` | Cards, rows |
| `--surface-popover` | `#2c2c2e` | Dropdowns, menus |

**Severity palette (5-tier, 4 variants each):**

| Level | Text | Background | Border | Glow |
|-------|------|-----------|--------|------|
| Critical | `#ef4444` | `rgba(239,68,68,0.1)` | `rgba(239,68,68,0.25)` | `rgba(239,68,68,0.3)` |
| High | `#f97316` | `rgba(249,115,22,0.1)` | `rgba(249,115,22,0.25)` | `rgba(249,115,22,0.3)` |
| Elevated | `#eab308` | `rgba(234,179,8,0.1)` | `rgba(234,179,8,0.25)` | `rgba(234,179,8,0.3)` |
| Normal | `#3b82f6` | `rgba(59,130,246,0.08)` | `rgba(59,130,246,0.2)` | `rgba(59,130,246,0.2)` |
| Positive | `#22c55e` | `rgba(34,197,94,0.08)` | `rgba(34,197,94,0.2)` | `rgba(34,197,94,0.2)` |

Token pattern: `--severity-{level}`, `--severity-{level}-bg`, `--severity-{level}-border`, `--severity-{level}-glow`

**Interactive states:**

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#3b82f6` | Primary actions, links |
| `--hover-bg` | `rgba(255,255,255,0.06)` | Row/card hover fill |
| `--active-bg` | `rgba(255,255,255,0.1)` | Pressed state |
| `--focus-ring` | `0 0 0 2px rgba(59,130,246,0.5), 0 0 0 4px rgba(59,130,246,0.15)` | Keyboard focus |

### Elevation System (4 tiers)

| Level | Usage | Properties |
|-------|-------|-----------|
| 1 | Cards, rows | `box-shadow: 0 1px 2px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06)` |
| 2 | Panels, popovers | `box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08)` |
| 3 | Modals, toasts | `box-shadow: 0 8px 32px rgba(0,0,0,0.5); backdrop-filter: blur(12px); background: rgba(28,28,30,0.85)` |
| 4 | HUD, command bar | `box-shadow: 0 16px 48px rgba(0,0,0,0.6); backdrop-filter: blur(24px) saturate(1.4); background: rgba(28,28,30,0.7)` |

### Border Radius Scale

`--radius-sm` (4px), `--radius-md` (8px), `--radius-lg` (12px), `--radius-xl` (16px)

### Motion Tokens

**Durations:**

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 100ms | Hover states, toggles |
| `--duration-normal` | 200ms | Most transitions |
| `--duration-moderate` | 350ms | Panel open, modal entry |
| `--duration-slow` | 500ms | Page transitions, globe camera |

**Easing curves:**

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-default` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | General purpose |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful overshoot |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entries (fast start, gentle land) |
| `--ease-in` | `cubic-bezier(0.55, 0, 1, 0.45)` | Exits (gentle start, fast end) |

### Component Primitives

Base classes for gradual adoption. Existing panels don't need to change immediately.

| Class | Purpose |
|-------|---------|
| `.cb-card` | Surface + border + radius + elevation-1 + hover lift |
| `.cb-badge` | Pill shape, severity-colored, compact text |
| `.cb-button` | Ghost/filled/accent variants, focus ring, press scale |
| `.cb-input` | Surface-raised bg, focus border animation |
| `.cb-list-row` | Hover bg + translateY(-1px), active press, stagger-ready |
| `.cb-separator` | 1px line with token color, 16px horizontal margin |
| `.cb-skeleton` | Shimmer placeholder — height/width set by consumer |
| `.cb-pill-group` | Segmented control (Apple style), radio behavior |

---

## Phase 2 — Transitions & Motion System

**New files:** `src/styles/motion.css` + `src/services/motion.ts`

### Panel Lifecycle Animations

| Transition | Animation | Duration | Easing |
|-----------|-----------|----------|--------|
| Panel entry | `translateY(8px) → 0` + `opacity 0 → 1` | 350ms | ease-out |
| Panel exit | `opacity 1 → 0` + `scale(1) → scale(0.98)` | 200ms | ease-in |
| Content refresh | Old content fades out, new content fades in | 200ms | crossfade |

### List & Row Animations

**Staggered entry:** Each row animates `translateY(4px) → 0` + fade-in with 30ms delay per item. Capped at 10 items (300ms total).

**Row states:**

| State | Effect | Duration |
|-------|--------|----------|
| Default | Resting | — |
| Hover | `translateY(-1px)` + subtle shadow + brighter border | 100ms ease-default |
| Active | `scale(0.99)` + darker fill | 100ms ease-default |
| Selected | Accent tint background + accent border | 100ms ease-default |

### Modal & Overlay System

| Component | Entry Animation | Duration |
|-----------|----------------|----------|
| Modal backdrop | `opacity 0 → 1` | 200ms |
| Modal content | `scale(0.97) → 1` + `opacity 0 → 1` | 350ms ease-out |
| Toast | `translateX(100%) → 0` | 350ms ease-spring |
| Confirmation dialog | Same as modal | 350ms ease-out |

**Toast behavior:**
- Stack top-right, max 3 visible
- Auto-dismiss progress bar (8s normal, 15s critical, never for errors)
- Hover pauses auto-dismiss timer
- Severity-tinted border
- Glass morphism (elevation-3)

**Confirmation dialogs:** Apple HIG pattern — destructive actions get red CTA button.

### Loading States

**Skeleton screens:**
- `.cb-skeleton` class with shimmer keyframe animation
- Shapes match expected content layout (rows, avatars, text blocks)
- Crossfade to real content as data arrives

**Progressive reveal:**
- Individual rows crossfade from skeleton → content as each data item loads
- Stagger effect creates waterfall feel

### motion.ts API

```typescript
staggerIn(container: Element, selector: string, delay?: number): void
crossfadeContent(panel: Element, newHTML: string): void
animateNumber(el: Element, from: number, to: number): void
animateIn(el: Element, animation?: 'slide-up' | 'fade' | 'scale'): void
animateOut(el: Element, animation?: 'fade' | 'scale-down'): void
revealContent(skeleton: Element, content: Element): void
```

All functions check `prefers-reduced-motion` and skip animation if set. Uses CSS classes from `motion.css` — no inline styles or JS animation libraries. The existing `body.animations-paused` system is preserved and extended.

---

## Phase 3 — Visual Hierarchy & Typography

### Panel Header Redesign

All panels adopt a consistent header structure:

```
┌─────────────────────────────────────┐
│ Title (13px/600)          ● 2m ago  │
│ Subtitle (11px/regular)             │
└─────────────────────────────────────┘
```

- Title: `--text-base`, `--fw-semibold`, `letter-spacing: -0.01em`
- Subtitle: `--text-xs`, `--fw-regular`, muted color
- Right side: freshness indicator (green dot + timestamp) or filter pill

### Card & Row System

**Card states:**
- Resting: elevation-1, `--surface-overlay` bg, subtle border
- Hovered: elevation-2, `translateY(-1px)`, brighter border
- Selected: accent tint bg, accent border ring (`box-shadow: 0 0 0 1px`)

**Data row hierarchy:**
- Title weight and text brightness scale with severity
- Consistent structure: title · metadata row (source · time · detail) · severity badge
- Severity badge uses `--severity-{level}-bg` + `--severity-{level}-border` + `--severity-{level}` text

### Additional Refinements

**Scrollbars:** 4px wide, 2px inset, auto-hide after 1.5s, expand to 6px on hover. Matches macOS native behavior.

**Focus rings:** Apple-style — `box-shadow: 0 0 0 2px rgba(59,130,246,0.5), 0 0 0 4px rgba(59,130,246,0.15)`. Only on `:focus-visible`.

**Density modes:** Settings toggle for compact vs comfortable. Implemented via `--density` CSS variable swap affecting padding and font sizes in `.cb-list-row` and `.cb-card`.

**Separators:** `.cb-separator` — 1px, token-colored, 16px horizontal inset.

### Migration Strategy

1. Import `design-system.css` before `main.css` — tokens become available globally
2. Replace hardcoded colors/sizes in `panels.css` with `var(--token)` references
3. Add `.cb-card`, `.cb-list-row`, `.cb-badge` classes to panel render methods
4. Standardize panel headers using the new title/subtitle/metadata layout
5. Replace severity colors with `var(--severity-{level})` tokens

**Scope:** Migrate the 20 highest-traffic panels first (UnifiedAlertInbox, LiveNews, Earthquakes, MapPopup, UnifiedSettings, TriageBar, CrystalBallSays, DeckGLMap controls, CountryBriefPage, and ~11 others). Remaining panels adopt incrementally — old styles continue to work since tokens are additive.

---

## Phase 4 — Alert & Notification UX

### Alert Arrival

1. **Slide into list:** New alert slides down from top of inbox list with severity-tinted background. 350ms ease-out.
2. **Badge counter flip:** Sidebar badge count animates with spring physics — number rolls up, brief scale pulse (1.0 → 1.15 → 1.0). Uses `animateNumber()`.
3. **Sidebar heat dot:** Pulsing red dot on sidebar alert item. Expands ring once then settles. Clears when panel is opened.

### Alert Actions

| Action | Visual Feedback | Duration |
|--------|----------------|----------|
| Acknowledge (A) | Green flash + checkmark morph, row dims (text #ccc → #888) | 200ms |
| Snooze (right-click) | Pause icon appears, duration countdown badge, row slides right slightly | 200ms |
| Pin (P) | Blue left accent border (3px), row floats to top of list | 200ms |
| Dismiss (swipe/X) | Slide right + fade out, row height collapses, list reflows | 200ms ease-in |

### Toast Notification System

- Position: fixed top-right
- Glass morphism: elevation-3
- Severity-tinted border (left accent or full border)
- Stack limit: 3 visible, older ones collapse down
- Auto-dismiss: 8s normal, 15s critical, never for errors
- Progress bar: countdown to auto-dismiss, severity-colored
- Hover: pauses auto-dismiss timer
- Dismiss: click X or swipe right

### Triage Bar Enhancements

- Top severity accent line (2px) on hottest item
- Mini escalation bar replaces sparkline (simpler, more readable)
- Lifecycle phase arrows animate on phase change
- Hover expands card with 2-line summary
- Keyboard 1–5 to jump to story

### Sound Design (opt-in via Settings)

| Event | Sound | Duration |
|-------|-------|----------|
| Critical alert | Two-tone rising chime (C5→E5) | 300ms |
| High alert | Single soft tone (G4) | 200ms |
| Elevated alert | Gentle tap (muted click) | 100ms |
| Normal alert | No sound — visual only | — |
| Acknowledge | Soft descending tone (E4→C4) | 150ms |

Implementation: Web Audio API synthesis — no audio files. Suppressed in Ghost Mode. Volume control in settings. Rate-limited: max 1 sound per 3 seconds.

---

## Phase 5 — Map & Data Visualization

### Popup Redesign

Replace flat popup with Apple Maps-style card:
- Glass morphism: `backdrop-filter: blur(20px) saturate(1.4)`, elevation-3
- Border radius: 14px
- Structure: Title + location/time → stat grid (2-col) → action buttons (Focus Map / Open Panel)
- Severity badge: top-right corner, colored pill
- Entry animation: scale(0.95) → 1 + fade, 200ms ease-out

### Layer Transitions

| Transition | Animation | Duration |
|-----------|-----------|----------|
| Layer toggle on | Opacity 0 → 1, markers scale 0.8 → 1 | 400ms |
| Layer toggle off | Opacity 1 → 0 | 300ms |
| New data point arrival | Scale 0 → 1 (spring) + single ripple ring | 400ms ease-spring |
| Tile loading | Shimmer overlay on loading tiles, crossfade to loaded | 300ms |

Uses DeckGL `transitions` prop for marker animations.

### View Preset Transitions

**Segmented control:** Apple-style pill group for region presets (Global, Americas, MENA, EU, Asia, Africa, Oceania). Selected pill slides with spring animation. Background indicator follows active item. Same pattern for time range selector (1h, 6h, 24h, 7d, All).

**Camera flight behavior:**
- `flyTo()` with smooth arc, ease-in-out, 1.5s duration
- Zoom: pulls out then dives into target region
- Bearing: slight rotation for cinematic feel (±15°)
- Pitch: tilts 0° → 45° on zoom-in for depth perception

### Cluster Interaction

Click cluster → flyTo zoom level where cluster breaks apart. Individual markers scale-in with 20ms stagger. Cluster count number shrinks to 0 before the cluster disappears.

### Map Controls Refinement

- Time range selector: frosted glass pill group (segmented control)
- Layer toggle pills: category-colored when active (e.g., conflicts = blue, nuclear = red), 150ms fill color transition
- Basemap switcher: Apple-style popover with preview thumbnails

---

## Phase 6 — Empty States, Onboarding & God's Vision

### Empty State System

Replace all plain "No data yet" text with structured empty states:

```
┌────────────────────────────────┐
│           [icon 28px]          │
│        Title (13px/500)        │
│    Guidance text (11px/muted)  │
│         [CTA button]          │
└────────────────────────────────┘
```

**Category templates:**

| Category | Icon | Title Pattern | CTA |
|----------|------|---------------|-----|
| Geopolitical | 🌍 | "Monitoring world events" | — |
| Infrastructure | ⚡ | "Awaiting grid/comms data" | — |
| Cyber/Security | 🛡 | "No active threats detected" | — |
| Markets/Finance | 📊 | "Markets data loading" | — |
| Weather/Climate | 🌦 | "Fetching conditions" | — |
| User Content | ✏️ | "Create your first entry" | Add/Create button |

**Monitoring panels** (data-driven): "All clear" tone — reassuring, not broken.
**User content panels** (user-created): "Create/Add" CTA — actionable.

### Welcome Flow

3-step onboarding modal shown once on first launch. Steps slide left → right with 350ms ease-out. Progress dots at top.

**Step 1 — Your Location:**
- GPS toggle (use device location) or manual entry later
- Explains: proximity alerts, local weather, nearest-threat

**Step 2 — Your Interests:**
- Domain pill picker (multi-select): Geopolitical, Cyber, Markets, Weather, Military, Health, Infrastructure, Space
- Pre-selects recommended defaults
- Affects: panel visibility, alert priority, sidebar ordering

**Step 3 — API Keys:**
- Shows top recommended keys with Free/Paid labels
- "Crystal Ball works without them" — no pressure
- "Skip for now" option
- Links to signup URLs from `settings-constants.ts`

Storage: `cb:onboarding-complete` in localStorage. "Skip for now" on every step.

### God's Vision — Entry Transition

Total duration: ~1.2s

| Step | Animation | Duration |
|------|-----------|----------|
| Sidebar collapse | Width → 0, opacity fade | 200ms |
| Map zoom out | Current view → orbital altitude | 500ms |
| Cesium crossfade | 2D map fades, 3D globe fades in | 500ms |
| HUD stagger-in | HUD elements appear with 50ms stagger | 300ms |

Exit transition: reverse sequence (HUD fade → globe fade → map zoom in → sidebar expand).

### God's Vision — HUD Polish

**Typography split:**
- SF Mono for data values (numbers, coordinates, timestamps)
- SF Pro for labels (section titles, descriptions)
- Consistent uppercase + letter-spacing for category labels

**Threat card:** Level 4 elevation (max glass). Numbers animate with `animateNumber()` on data change. Threat level text gets color + subtle text-shadow matching severity.

**Camera choreography:**
- Auto-follow: smooth arc between threat hotspots, 4s dwell per target
- Easing: ease-in-out-cubic for natural acceleration/deceleration
- Altitude: pulls up between targets, dives on arrival
- Idle orbit: slow 0.05°/frame rotation when no active targets
- User interrupt: any mouse/keyboard input cancels auto-follow, resumes after 10s idle

### Contextual First-Time Hints

One-time tooltip hints at key touchpoints:

| Location | Hint |
|----------|------|
| Alert Inbox | "Press J/K to navigate, A to acknowledge" |
| Map | "Scroll to zoom, click clusters to expand" |
| God's Vision | "Press 1-6 for theaters, Esc to exit" |
| Ghost Mode | "Cmd+Shift+G to toggle Ghost Mode" |
| Settings | "Press Esc to close" |

Implementation: glass morphism tooltip with arrow, "Got it" dismiss button. Each hint shown once, stored in `cb:hints-seen` (Set in localStorage). Auto-dismiss after 8s if not clicked.

---

## Cross-Cutting Concerns

### Reduced Motion

All animations wrapped in `@media (prefers-reduced-motion: no-preference)`. When reduced motion is enabled, transitions collapse to instant opacity changes only. The existing `body.animations-paused` system is preserved and extended to cover new motion classes.

### Ghost Mode Compatibility

- Sound design: all audio suppressed in Ghost Mode
- Toast notifications: suppressed in Ghost Mode
- Animations: preserved (they don't leak data)
- Empty states: preserved (they're informational)

### Light Theme

All color tokens define both dark and light variants via `[data-theme="light"]` selector. Surface layers invert (white base), severity colors adjust for light backgrounds (slightly darker text variants for contrast). Elevation shadows lighten.

### Performance

- All CSS animations use `transform` and `opacity` only (GPU-composited)
- No layout-triggering properties in transitions
- Skeleton screens render instantly (no data dependency)
- Stagger animations capped at 10 items (300ms max)
- DeckGL transitions use built-in `transitions` prop (GPU-accelerated)
- `motion.ts` functions are no-ops when `prefers-reduced-motion: reduce`

---

## Files Created / Modified

### New Files
| File | Phase | Purpose |
|------|-------|---------|
| `src/styles/design-system.css` | 1 | Token definitions, component primitives |
| `src/styles/motion.css` | 2 | Animation keyframes, transition classes |
| `src/services/motion.ts` | 2 | JS animation helpers |
| `src/components/Toast.ts` | 4 | Toast notification component |
| `src/components/WelcomeFlow.ts` | 6 | Onboarding modal |
| `src/components/EmptyState.ts` | 6 | Reusable empty state component |
| `src/components/ContextualHint.ts` | 6 | First-time tooltip hints |

### Modified Files
| File | Phase | Changes |
|------|-------|---------|
| `src/styles/main.css` | 1 | Import design-system.css, begin token migration |
| `src/styles/panels.css` | 3 | Replace hardcoded values with tokens |
| `src/styles/alerts.css` | 4 | Alert arrival/action animations |
| `src/styles/gods-vision.css` | 6 | HUD typography, entry transition |
| `src/components/UnifiedAlertInboxPanel.ts` | 4 | Action animations, arrival animation |
| `src/components/TriageBar.ts` | 4 | Escalation bar, hover expand, accent line |
| `src/components/DeckGLMap.ts` | 5 | Popup redesign, layer transitions, view presets |
| `src/components/MapPopup.ts` | 5 | Apple Maps card redesign |
| `src/components/GlobeHUD.ts` | 6 | Typography split, animateNumber |
| `src/components/GodsVisionView.ts` | 6 | Entry/exit transition choreography |
| `src/components/Panel.ts` | 2,3 | Base class: skeleton support, header layout |
| `src/app/panel-layout.ts` | 3 | Panel header standardization |
| ~20 high-traffic panel components | 3 | Token migration, .cb-* class adoption |

# macOS Native Design Refresh Plan

Use this plan to make Crystal Ball feel modern, high-tech, black, slick, fast, and genuinely macOS-native.

The target is not a generic sci-fi dashboard. The target is an Apple-native intelligence desk: Finder/Xcode/Weather/Maps sensibility, but darker, denser, and more operational.

## Design Direction

Recommended direction: **Apple Intelligence Desk**.

Characteristics:

- Black graphite window
- Translucent sidebar
- Compact native toolbar
- Crisp SF Pro typography
- Segmented controls
- Inspector panels
- Subtle blue/green/amber/red status accents
- Less glow, less noise
- Fast interactions
- Native macOS density and spacing

This should be Crystal Ball's main design language.

## Alternate Modes

### Black Mission Control

Use for disaster, war, storm, and critical-event states.

Characteristics:

- Black background
- Map-first layout
- Floating compact HUDs
- Animated threat strip
- Command-center top events
- Red/amber critical states
- Minimal panel chrome

This should be a mode, not the whole app.

### Bloomberg Terminal Meets Apple

Use for markets, shortage radar, aviation, maritime, diagnostics, and power-user panels.

Characteristics:

- Small typography
- Tables and dense rows
- Status dots
- Keyboard-driven interaction
- Split panes
- Very little decoration

### Apple Weather Pro

Use for severe weather, Storm Mode, and preparedness.

Characteristics:

- Large active-threat card
- Radar/map first
- Simple action cards
- Persistent critical strip
- Clean storm timeline
- Strong but restrained hazard color

## Core Shell Layout

Move the app toward this structure:

```text
Left translucent sidebar
Top native toolbar
Main map/workspace
Right inspector drawer
Bottom or top critical event strip
```

The right inspector is important. Clicking any event should open one place for:

- Summary
- Confidence
- Why it matters
- What changed
- What to do
- Sources
- Timeline
- Diagnostics

## Command Center First Screen

Add a Command Center view that summarizes the world before users dig into panels.

Example:

```text
Current Risk: Elevated

Top Events:
1. Severe storms near Home
2. Diesel stress rising
3. Taiwan Strait activity watch

Since Last Look:
- storm risk upgraded
- confidence improved
- one risk decayed
```

This should feel like the app understands the world, not just displays feeds.

## Modern Situation Cards

Every major event should use one consistent card pattern.

Example:

```text
[Critical] Severe Wind Near Home
Arrives: 35-55 min
Confidence: High
Why: warning polygon overlaps Home + 60 mph wind tag
Action: charge phone, secure outdoor items
Watch: radar update in 5 min
```

Visual style:

- Black card
- 8px radius
- Thin border
- Status color line
- SF Pro typography
- Compact metrics
- No bulky web-card styling

## Critical Alert Strip

Inside the app, critical alerts need a native persistent strip.

Example:

```text
CRITICAL WEATHER · Home inside warning polygon · Secure outdoor items and avoid driving
```

Design:

- Sticky top or bottom strip
- Red/amber only when needed
- Acknowledge and snooze buttons
- No repeated flashing unless severity changes
- Motion under 200ms

## Inspector Drawer

Create a slick right-side detail panel.

Suggested tabs:

- Summary
- Timeline
- Sources
- Actions
- Diagnostics

Use this instead of forcing every panel to cram deep details into cards.

## Menu Bar Status

Add a compact macOS menu bar presence.

Example:

```text
Crystal Ball: Watch
Top driver: Storms near Home
```

Clicking it should show:

- Top event
- Next update
- Quiet/snooze controls
- Open app action

## Modern Black Palette

Use near-black, not pure black everywhere.

Suggested tokens:

```text
Window: #0b0c0f
Sidebar: rgba(24, 24, 27, 0.72)
Surface: #14161a
Elevated: #1c1f26
Border: rgba(255,255,255,0.08)
Text: rgba(255,255,255,0.92)
Secondary: rgba(255,255,255,0.58)
Blue: #0a84ff
Green: #32d74b
Amber: #ff9f0a
Red: #ff453a
```

Preserve macOS system accent color where appropriate.

## Motion Principles

The app should feel instant.

Use:

- Hover lift: 1px
- Drawer slide: 160ms
- Alert strip change: 180ms
- Map pin pulse only for critical
- Button transitions: 100-140ms

Avoid:

- Slow decorative animation
- Constant pulsing
- Large blurred glows
- Gratuitous parallax
- Anything that makes the app feel like a web demo

## Panel Redesign Pattern

Many panels should become Apple-style inspector rows.

Example:

```text
Label                 Value
Confidence            High
Sources               3 agreeing
Updated               2 min ago
Next watch            NWS scan
```

This is cleaner than chunky cards everywhere.

## Reusable Design Components

Create a consistent UI vocabulary.

Suggested components/styles:

- `MacToolbar`
- `MacSidebar`
- `MacInspector`
- `MacSegmentedControl`
- `MacStatusPill`
- `MacMetricRow`
- `MacEventCard`
- `MacAlertStrip`
- `MacSourceList`
- `MacTimeline`
- `MacCommandCenter`

If full TypeScript components are too heavy for the first PR, start with CSS classes and one or two small components.

## Implementation Plan

### PR 1: Design Tokens and Core Styles

Update the macOS design foundation without redesigning every panel.

Scope:

- Refresh tokens in `src/styles/macos-native.css`.
- Add black Apple palette.
- Add reusable situation card styles.
- Add critical alert strip styles.
- Add inspector drawer styles.
- Add status pill and metric row styles.
- Keep changes CSS-first and low risk.

Suggested files:

- `src/styles/macos-native.css`
- `src/styles/alerts.css`

### PR 2: Command Center UI

Create the first high-impact native-feeling surface.

Scope:

- Current risk summary.
- Top events.
- Since Last Look digest.
- Personal exposure highlights.
- Uses existing insight services.

Suggested files:

- `src/components/CriticalEventCommandCenter.ts`
- `src/styles/macos-native.css`

### PR 3: Personal Storm Mode UI

Make severe weather warnings feel immediate and practical.

Scope:

- Active weather threat card.
- Preparedness actions.
- Arrival window.
- Place match.
- Acknowledge/snooze.

Suggested files:

- `src/components/PersonalStormMode.ts`
- `src/styles/macos-native.css`
- `src/styles/alerts.css`

### PR 4: Inspector Drawer

Add a reusable right-side detail surface.

Scope:

- Summary tab.
- Timeline tab.
- Sources tab.
- Actions tab.
- Diagnostics tab.
- Works for weather, shortages, intelligence, and alerts.

Suggested files:

- `src/components/MacInspectorDrawer.ts`
- `src/styles/macos-native.css`

### PR 5: Panel Normalization

Start normalizing existing panels to the native row/card language.

Scope:

- Replace bulky web cards where easy.
- Use `MacMetricRow` and `MacStatusPill` classes.
- Normalize headers and empty states.
- Keep panel-by-panel changes small.

### PR 6: Menu Bar Status

Add a small native macOS status presence.

Scope:

- Risk state
- Top driver
- Next watch
- Snooze/open controls

Suggested files:

- `src-tauri/src/main.rs`
- `src/app/desktop-notifications.ts`

### PR 7: Animation and Performance Polish

Make the design feel fast.

Scope:

- Audit heavy shadows/blurs.
- Reduce constant animations.
- Keep motion under 200ms.
- Ensure panels do not layout-shift on hover.
- Verify critical surfaces do not overlap on 14-inch screens.

## Best First Visible Win

Prioritize:

1. Command Center
2. Personal Storm Mode
3. Critical Alert Strip

These will make the app feel dramatically more modern and useful without rewriting every panel.

## Guardrails

- Keep cards at 8px radius unless an existing design rule requires otherwise.
- Do not use big decorative gradient blobs.
- Do not make the UI one-note purple/blue.
- Do not add bulky marketing-style hero sections.
- Prefer dense, native, operational UI.
- Keep text inside buttons and compact cards from overflowing.
- Use system typography and restrained motion.
- Make critical states obvious but not constantly noisy.
- Do not redesign every panel in the first PR.

## Claude Instruction

Claude should read this plan before UI work.

Recommended prompt:

```text
Read docs/MACOS_NATIVE_DESIGN_REFRESH_PLAN.md. Implement PR 1 only: refresh macOS-native design tokens and add reusable styles for situation cards, critical alert strips, inspector drawers, status pills, and metric rows. Keep it CSS-first and do not redesign every panel yet.
```

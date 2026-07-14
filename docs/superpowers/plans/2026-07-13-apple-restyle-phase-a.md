# Apple Restyle Phase A — Tokens + Home Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Apple design-language token system and restyle every Home Shell surface (bands, deck, ribbon, dossier, Library, focus frame, ⌘K) from harsh mono/squared to soft SF/rounded/glass, per `docs/superpowers/specs/2026-07-13-apple-design-language-design.md`.

**Architecture:** All values become CSS custom properties in `tokens.css` (lint:colors allowlisted); surfaces consume only `var()` / `rgba(var(--x-rgb), α)`. Glass (`backdrop-filter`) is scoped to `body.is-desktop-macos` with solid fallbacks; the six-surface blur budget is a hard cap. ALL-CAPS labels are fixed at the TypeScript source, not with CSS transforms.

**Tech Stack:** Plain CSS custom properties, TypeScript (Vite), node:test via tsx, Playwright.

**Worktree:** `/Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle`, branch `claude/apple-design-language` (from origin/main `eafddda0`). Every command below runs from the worktree root — `cd` in the SAME shell command (cwd resets between turns).

**Non-negotiable invariants (from spec §3):**
- Blur ONLY on: topbar buttons row surfaces, briefing bands, status ribbon, dossier, Library, focus frame, ⌘K. Never on `.hs-card` deck cards (dozens alive).
- No new `infinite` animations. Transitions animate `transform`/`opacity` only.
- Class names are load-bearing (e2e + JS span-strip) — restyle values, never rename selectors.
- New raw color values ONLY in `tokens.css`; elsewhere `var()`/`rgba(var(--x-rgb), α)` or the always-allowed `rgba(0,0,0,x)`.
- `!important` inversion: main.css is `@layer base`; a layered `!important` beats unlayered ones. The existing `.hs-focus-body .panel { min-height: 0 !important }` block must keep its `!important`s.

---

### Task 1: Token foundation + app-wide SF flip + shimmer guard

**Files:**
- Modify: `src/styles/tokens.css` (append new block; edit 4 existing values)
- Modify: `src/styles/main.css:66-67` (`--font-body` flip; `--font-ui` fallback source)
- Modify: `index.html` (~line 122, reduced-motion guard for `.skeleton-line`)

- [ ] **Step 1: Append the Apple DL token block to `src/styles/tokens.css`**

Add at end of file:

```css
/* ── Apple design language (2026-07 restyle) ────────────────────
 * Geometry, elevation, materials, type, and motion tokens for the
 * Cupertino Glass + Graphite direction. Spec:
 * docs/superpowers/specs/2026-07-13-apple-design-language-design.md.
 * Blur companions (--mat-blur-*) may only be APPLIED under
 * body.is-desktop-macos and only on the six chrome surfaces named in
 * the spec's glass budget — never per-card. */
:root {
  /* Geometry */
  --r-xs: 6px;
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 18px;
  --r-xl: 22px;
  --r-pill: 999px;
  /* Legacy aliases — these names are already referenced by
     WelcomeFlow/ContextualHint/Toast but were never defined. */
  --radius-sm: var(--r-sm);
  --radius-md: var(--r-md);
  --radius-lg: var(--r-lg);
  --radius-xl: var(--r-xl);

  /* Elevation (contact + ambient); edge companions ride box-shadow. */
  --e-1: 0 1px 2px rgba(0, 0, 0, 0.4);
  --e-2: 0 2px 6px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.25);
  --e-3: 0 4px 12px rgba(0, 0, 0, 0.45), 0 16px 40px rgba(0, 0, 0, 0.35);
  --e-4: 0 8px 24px rgba(0, 0, 0, 0.5), 0 32px 80px rgba(0, 0, 0, 0.4);
  --edge-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  --edge-hairline: inset 0 0 0 0.5px rgba(255, 255, 255, 0.11);
  --elevation-2: var(--e-2); /* legacy alias, referenced-but-undefined today */

  /* Materials */
  --mat-chrome-bg: rgba(24, 28, 36, 0.55);
  --mat-raised-bg: rgba(25, 29, 37, 0.62);
  --mat-blur-chrome: blur(22px) saturate(1.5);
  --mat-blur-raised: blur(24px) saturate(1.5);
  --mat-thin: rgba(255, 255, 255, 0.07);
  --mat-solid-1: #14171d;
  --mat-solid-2: #171a21;
  --mat-solid-3: #1e222b;

  /* Typography */
  --font-ui: -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', sans-serif;
  --font-data: ui-monospace, 'SF Mono', Menlo, monospace;
  --text-xs: 11px;
  --text-sm: 12.5px;
  --text-base: 13.5px;
  --text-md: 15px;
  --text-lg: 17px;
  --text-xl: 22px;

  /* Motion */
  --dur-fast: 150ms;
  --dur-base: 220ms;
  --dur-slow: 320ms;
  --ease-out: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-spring: cubic-bezier(0.32, 1.4, 0.42, 1); /* overlay entrances ONLY */

  /* Graphite accent */
  --accent-fill: rgba(255, 255, 255, 0.92);
  --accent-selection: rgba(255, 255, 255, 0.16);
}
```

- [ ] **Step 2: Soften four existing token values in `tokens.css`**

In the Wave-4 block:
- `--sev-critical: #d50000;` → `--sev-critical: #ff453a;`
- `--sev-critical-bg: rgba(213, 0, 0, 0.12);` → `--sev-critical-bg: rgba(255, 69, 58, 0.12);`
- `--status-error: #f44336;` → `--status-error: #ff453a;`
- `--text-primary:  #ffffff;` → `--text-primary:  #f2f3f5;`

In the Home Shell block:
- `--hs-bg-base:   #05070a;` → `--hs-bg-base:   #0b0d12;`
- `--hs-base-rgb:    5, 7, 10;` → `--hs-base-rgb:    11, 13, 18;`

- [ ] **Step 3: Flip the app body font in `src/styles/main.css`**

Find (lines ~66-67):
```css
  --font-mono: 'SF Mono', 'Monaco', 'Cascadia Code', 'Fira Code', 'DejaVu Sans Mono', 'Liberation Mono', monospace;
  --font-body: var(--font-mono);
```
Replace the second line ONLY:
```css
  --font-body: var(--font-ui, -apple-system, system-ui, sans-serif);
```
Do NOT change `body { font-size: 12px }` — classic layout metrics stay put until Phase B.

- [ ] **Step 4: Guard the skeleton shimmer in `index.html`**

Immediately after the `@keyframes skel-shimmer{...}` line (~122), add inside the same `<style>`:
```css
 @media (prefers-reduced-motion: reduce){.skeleton-line{animation:none}}
```

- [ ] **Step 5: Gates**

Run: `cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && npm run lint:colors && npm run typecheck:all && npm run test:homeshell 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: lint:colors OK, typecheck clean, 60 pass / 0 fail.

- [ ] **Step 6: Commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && git add src/styles/tokens.css src/styles/main.css index.html && git commit -m "feat(restyle): Apple DL tokens, SF body font, softened status colors

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Home Shell surface restyle (home-shell.css)

**Files:**
- Modify: `src/styles/home-shell.css` (full-file replacement below)

Every selector name is IDENTICAL to today's file — only declarations change. The replacement keeps: the `.hs-focus-body .panel` `!important` neutralization block verbatim (layered-`!important` fight), the map-HUD suppression block, z-index layering, and the `[hidden]`-style guards.

- [ ] **Step 1: Replace the entire contents of `src/styles/home-shell.css` with:**

```css
/* Home Shell — Apple design language (Cupertino Glass + Graphite).
   Palette + DL tokens live in tokens.css. Glass is scoped to
   body.is-desktop-macos and capped to the spec's six-surface budget:
   bands, ribbon, dossier, focus frame (+ Library, ⌘K elsewhere).
   Deck cards are deliberately SOLID (dozens alive at once). */

.home-shell {
  position: fixed;
  inset: 0;
  z-index: 10000; /* below cmdk overlay (10005) so ⌘K opens on top */
  background: var(--hs-bg-base);
  color: var(--hs-fg);
  font-family: var(--font-ui);
  letter-spacing: -0.01em;
}

body.home-shell-active {
  overflow: hidden;
}

.home-shell-map {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 65% 40%, var(--hs-map-glow) 0%, var(--hs-map-edge) 70%);
}

.home-shell-map .map-container {
  width: 100%;
  height: 100%;
}

/* Backdrop mode: suppress the adopted map's own HUD while the shell owns
   the screen. */
.home-shell-map .map-controls,
.home-shell-map .time-slider,
.home-shell-map .layer-toggles,
.home-shell-map .map-legend {
  display: none;
}

.home-shell-scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.home-shell-viewport {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  pointer-events: none; /* backdrop-only: empty-area clicks land on the scroll container */
}

.home-shell-viewport > * {
  pointer-events: auto;
}

.home-shell-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  background: linear-gradient(rgba(var(--hs-base-rgb), 0.9), transparent);
}

.home-shell-brand {
  font-size: var(--text-base);
  font-weight: 600;
}

.home-shell-cmdk {
  border: none;
  border-radius: var(--r-pill);
  background: var(--mat-thin);
  color: var(--hs-fg-muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  padding: 6px 14px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.home-shell-cmdk:hover { color: var(--hs-fg); background: var(--accent-selection); }

.home-shell-topbar-spacer { flex: 1; }

.home-shell-exit,
.home-shell-library {
  border: none;
  border-radius: var(--r-pill);
  background: var(--mat-thin);
  color: var(--hs-fg-muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  padding: 6px 14px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.home-shell-exit:hover,
.home-shell-library:hover { color: var(--hs-fg); background: var(--accent-selection); }

.home-shell-briefing {
  width: 360px;
  margin: 8px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hs-band {
  background: var(--mat-solid-1);
  border: none;
  border-radius: var(--r-md);
  padding: 11px 14px;
  box-shadow: var(--e-1), var(--edge-highlight);
}

body.is-desktop-macos .hs-band {
  background: var(--mat-chrome-bg);
  -webkit-backdrop-filter: var(--mat-blur-chrome);
  backdrop-filter: var(--mat-blur-chrome);
  box-shadow: var(--e-1), var(--edge-hairline);
}

/* Tone = soft wash over the surface, not a colored outline. */
.hs-tone-critical { background: linear-gradient(180deg, rgba(var(--hs-bad-rgb), 0.14), rgba(var(--hs-bad-rgb), 0.05)), var(--mat-solid-1); }
.hs-tone-elevated { background: linear-gradient(180deg, rgba(var(--hs-warn-rgb), 0.12), rgba(var(--hs-warn-rgb), 0.04)), var(--mat-solid-1); }
.hs-tone-clear { background: linear-gradient(180deg, rgba(var(--hs-ok-rgb), 0.08), rgba(var(--hs-ok-rgb), 0.02)), var(--mat-solid-1); }

body.is-desktop-macos .hs-tone-critical { background: linear-gradient(180deg, rgba(var(--hs-bad-rgb), 0.14), rgba(var(--hs-bad-rgb), 0.05)), var(--mat-chrome-bg); }
body.is-desktop-macos .hs-tone-elevated { background: linear-gradient(180deg, rgba(var(--hs-warn-rgb), 0.12), rgba(var(--hs-warn-rgb), 0.04)), var(--mat-chrome-bg); }
body.is-desktop-macos .hs-tone-clear { background: linear-gradient(180deg, rgba(var(--hs-ok-rgb), 0.08), rgba(var(--hs-ok-rgb), 0.02)), var(--mat-chrome-bg); }

.hs-band-label {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: normal;
  color: var(--hs-fg-muted);
  margin-bottom: 4px;
}

.hs-tone-critical .hs-band-label { color: var(--hs-bad); }
.hs-tone-elevated .hs-band-label { color: var(--hs-warn); }
.hs-tone-clear .hs-band-label { color: var(--hs-ok); }

.hs-band-headline { font-size: var(--text-base); font-weight: 600; margin-bottom: 4px; }
.hs-band-line { font-size: var(--text-sm); color: var(--hs-fg-line); line-height: 1.55; }
.hs-band-link {
  cursor: pointer;
  text-decoration: underline dotted;
  display: block;
  width: 100%;
  background: transparent;
  border: none;
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  line-height: 1.55;
  text-align: left;
  padding: 0;
  color: inherit;
}
.hs-band-stale { font-size: var(--text-xs); color: var(--hs-warn); margin-top: 4px; }

.home-shell-deck-hint {
  margin: auto auto 12px;
  font-size: var(--text-sm);
  color: var(--hs-fg-hint);
  background: var(--mat-thin);
  border: none;
  border-radius: var(--r-pill);
  padding: 5px 16px;
}

.home-shell-deck {
  position: relative;
  background: var(--hs-bg-deck);
  border-top: 1px solid rgba(var(--hs-white-rgb), 0.06);
  padding: 16px 18px 22px;
  min-height: 40vh;
}

.hs-deck-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
  font-size: var(--text-base);
  font-weight: 600;
}

.hs-deck-sub { font-size: var(--text-xs); font-weight: 400; color: var(--hs-fg-faint); }

.hs-deck-add {
  margin-left: auto;
  background: var(--mat-thin);
  color: var(--hs-fg-muted);
  border: none;
  border-radius: var(--r-pill);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  padding: 4px 12px;
  cursor: pointer;
}

.hs-deck-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}

/* Deck cards: SOLID by design — never add backdrop-filter here. */
.hs-card {
  position: relative;
  background: var(--mat-solid-2);
  border: none;
  border-radius: var(--r-lg);
  padding: 12px 14px;
  min-height: 78px;
  cursor: pointer;
  box-shadow: var(--e-2), var(--edge-highlight);
  transition: transform var(--dur-fast) var(--ease-out);
}

.hs-card:hover { transform: translateY(-1px); box-shadow: var(--e-3), var(--edge-highlight); }
.hs-card-error { background: linear-gradient(180deg, rgba(var(--hs-bad-rgb), 0.12), rgba(var(--hs-bad-rgb), 0.04)), var(--mat-solid-2); }
.hs-card-stale { background: linear-gradient(180deg, rgba(var(--hs-warn-rgb), 0.1), rgba(var(--hs-warn-rgb), 0.03)), var(--mat-solid-2); }

.hs-card-title { font-size: var(--text-base); font-weight: 600; margin-bottom: 4px; }
.hs-card-narrative { font-size: var(--text-sm); color: var(--hs-fg-muted); line-height: 1.5; margin-bottom: 4px; }
.hs-card-status { font-size: var(--text-xs); color: var(--hs-fg-dim); }
.hs-card-error .hs-card-status { color: var(--hs-bad); }

.hs-card-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: none;
  gap: 3px;
}

.hs-card:hover .hs-card-actions { display: flex; }

.hs-card-actions button {
  background: rgba(var(--hs-white-rgb), 0.08);
  border: none;
  border-radius: var(--r-pill);
  color: var(--hs-fg-muted);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.home-shell-ribbon {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 18px;
  font-size: var(--text-xs);
  color: var(--hs-fg-faint);
  background: var(--mat-solid-1);
  border-top: 1px solid rgba(var(--hs-white-rgb), 0.05);
}

body.is-desktop-macos .home-shell-ribbon {
  background: var(--mat-chrome-bg);
  -webkit-backdrop-filter: var(--mat-blur-chrome);
  backdrop-filter: var(--mat-blur-chrome);
}

.hs-ribbon-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.hs-ribbon-ok { background: var(--hs-ok); }
.hs-ribbon-warn { background: var(--hs-warn); }
.hs-ribbon-bad { background: var(--hs-bad); }

/* ── Situation dossier drawer (Phase 3) ─────────────────────────── */

.hs-dossier-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgba(var(--hs-base-rgb), 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out);
}

.hs-dossier-scrim--open {
  opacity: 1;
  pointer-events: auto;
}

/* Floating raised-glass sheet, not a square full-height drawer. */
.hs-dossier {
  position: absolute;
  top: 10px;
  right: 10px;
  bottom: 10px;
  width: 60vw;
  max-width: 960px;
  min-width: 480px;
  z-index: 2;
  background: var(--mat-solid-1);
  border: none;
  border-radius: var(--r-xl);
  box-shadow: var(--e-4), var(--edge-highlight);
  transform: translateX(24px);
  opacity: 0;
  pointer-events: none;
  transition: transform var(--dur-slow) var(--ease-spring), opacity var(--dur-base) var(--ease-out);
  display: flex;
  flex-direction: column;
  font-family: var(--font-ui);
  overflow: hidden;
}

body.is-desktop-macos .hs-dossier {
  background: var(--mat-raised-bg);
  -webkit-backdrop-filter: var(--mat-blur-raised);
  backdrop-filter: var(--mat-blur-raised);
  box-shadow: var(--e-4), var(--edge-hairline);
}

.hs-dossier--open { transform: translateX(0); opacity: 1; pointer-events: auto; }

.hs-dossier-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(var(--hs-white-rgb), 0.07);
}

.hs-dossier-title { font-size: var(--text-md); font-weight: 600; color: var(--hs-fg); }

.hs-dossier-badge {
  font-size: var(--text-xs);
  font-weight: 600;
  border-radius: var(--r-pill);
  padding: 2px 10px;
  letter-spacing: normal;
}

.hs-dossier-badge--critical { color: var(--hs-bad); border: none; background: rgba(var(--hs-bad-rgb), 0.16); }
.hs-dossier-badge--elevated { color: var(--hs-warn); border: none; background: rgba(var(--hs-warn-rgb), 0.16); }
.hs-dossier-badge--info { color: var(--hs-fg-muted); border: none; background: rgba(var(--hs-white-rgb), 0.08); }

.hs-dossier-subline { font-size: var(--text-xs); color: var(--hs-fg-dim); }

.hs-dossier-actions { margin-left: auto; display: flex; gap: 6px; }

.hs-dossier-actions button {
  border: none;
  border-radius: var(--r-pill);
  background: var(--mat-thin);
  color: var(--hs-fg-muted);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  padding: 5px 12px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.hs-dossier-actions button:hover { color: var(--hs-fg); background: var(--accent-selection); }

.hs-dossier-body {
  flex: 1;
  display: flex;
  gap: 16px;
  padding: 14px 18px;
  overflow-y: auto;
  min-height: 0;
}

.hs-dossier-main { flex: 1.6; min-width: 0; }
.hs-dossier-rail { flex: 1; min-width: 0; }

.hs-dossier-section-label {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: normal;
  color: var(--hs-fg-muted);
  margin: 12px 0 6px;
}

.hs-dossier-why { font-size: var(--text-sm); color: var(--hs-fg-line); line-height: 1.6; }

.hs-dossier-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
}

.hs-dossier .hs-card-reason { font-size: var(--text-xs); color: var(--hs-fg-dim); margin-top: 3px; }

.hs-dossier-more {
  margin-top: 8px;
  background: var(--mat-thin);
  border: none;
  border-radius: var(--r-pill);
  color: var(--hs-fg-faint);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  padding: 6px 12px;
  cursor: pointer;
}

.hs-dossier-brief { font-size: var(--text-sm); color: var(--hs-fg-line); line-height: 1.65; }
.hs-dossier-brief .hs-brief-tier { color: var(--hs-warn); }
.hs-dossier-memory { font-size: var(--text-xs); color: var(--hs-fg-dim); margin-top: 6px; }

.hs-dossier-timeline { font-size: var(--text-xs); color: var(--hs-fg-dim); line-height: 1.8; font-family: var(--font-data); }

.hs-dossier-ask {
  border-top: 1px solid rgba(var(--hs-white-rgb), 0.07);
  padding: 12px 18px;
}

.hs-dossier-ask input {
  width: 100%;
  background: var(--mat-thin);
  border: none;
  border-radius: var(--r-pill);
  color: var(--hs-fg);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  padding: 8px 16px;
  outline: none;
  box-shadow: var(--edge-hairline);
}

.hs-dossier-ask input:focus { box-shadow: inset 0 0 0 1px rgba(var(--hs-white-rgb), 0.35); }

.hs-dossier-answer { font-size: var(--text-sm); color: var(--hs-fg-line); line-height: 1.6; margin-top: 8px; }
.hs-dossier-followups { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

.hs-dossier-followups button {
  background: var(--mat-thin);
  border: none;
  border-radius: var(--r-pill);
  color: var(--hs-fg-muted);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  padding: 4px 11px;
  cursor: pointer;
}

/* ── Panel focus host (Phase 4) ─────────────────────────────────── */

.hs-focus-scrim {
  position: absolute;
  inset: 0;
  z-index: 3;
  background: rgba(var(--hs-base-rgb), 0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out);
}

.hs-focus-scrim--open { opacity: 1; pointer-events: auto; }

.hs-focus {
  position: absolute;
  inset: 4vh 6vw;
  z-index: 4;
  display: flex;
  flex-direction: column;
  background: var(--mat-solid-1);
  border: none;
  border-radius: var(--r-xl);
  box-shadow: var(--e-4), var(--edge-highlight);
  transform: translateY(16px);
  opacity: 0;
  pointer-events: none;
  transition: transform var(--dur-slow) var(--ease-spring), opacity var(--dur-base) var(--ease-out);
  font-family: var(--font-ui);
  overflow: hidden;
}

body.is-desktop-macos .hs-focus {
  background: var(--mat-raised-bg);
  -webkit-backdrop-filter: var(--mat-blur-raised);
  backdrop-filter: var(--mat-blur-raised);
  box-shadow: var(--e-4), var(--edge-hairline);
}

.hs-focus--open { transform: translateY(0); opacity: 1; pointer-events: auto; }

.hs-focus-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(var(--hs-white-rgb), 0.07);
}

.hs-focus-title { font-size: var(--text-md); font-weight: 600; color: var(--hs-fg); }
.hs-focus-domain { font-size: var(--text-xs); font-weight: 500; letter-spacing: normal; color: var(--hs-fg-dim); }
.hs-focus-actions { margin-left: auto; display: flex; gap: 6px; }

.hs-focus-actions button {
  border: none;
  border-radius: var(--r-pill);
  background: var(--mat-thin);
  color: var(--hs-fg-muted);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  padding: 5px 12px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.hs-focus-actions button:hover { color: var(--hs-fg); background: var(--accent-selection); }

.hs-focus-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  display: flex;
}

/* Neutralize grid sizing + harmonize the hosted panel with the shell.
   The span-N rules use !important, so these must too. */
.hs-focus-body .panel {
  min-height: 0 !important;
  height: 100%;
  width: 100%;
  cursor: default;
  border-radius: var(--r-md);
  --surface: var(--hs-bg-card);
  --border: rgba(var(--hs-white-rgb), 0.12);
  --text: var(--hs-fg);
}

/* Reduced motion: designed alternates — near-instant, opacity only,
   no translate/spring. NOT a blanket transition kill. */
@media (prefers-reduced-motion: reduce) {
  .home-shell *, .hs-dossier, .hs-focus, .hs-dossier-scrim, .hs-focus-scrim {
    transition-duration: 1ms !important;
  }
  .hs-dossier, .hs-focus { transform: none !important; }
  .hs-card, .hs-card:hover { transform: none !important; }
}
```

- [ ] **Step 2: Gates**

Run: `cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && npm run lint:colors && npm run typecheck:all && npm run test:homeshell 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: all green (this file previously carried baselined literals — the replacement uses only `var()`/`rgba(var(--x-rgb),α)`/`rgba(0,0,0,x)`, so the ratchet count can only go DOWN; if lint:colors flags anything, a literal slipped in — fix it, do not touch the baseline).

- [ ] **Step 3: Commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && git add src/styles/home-shell.css && git commit -m "feat(restyle): Home Shell surfaces — glass chrome, solid elevated cards, SF type

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: De-uppercase program (TypeScript sources)

**Files:**
- Modify: `src/services/home-shell/briefing-view.ts:94,110,133,143,154,181`
- Modify: `src/components/HomeShellOverlay.ts:344`
- Modify: `src/components/SituationDossier.ts:184,189,202,213,215`
- Modify: `src/components/LibraryOverlay.ts:155,160`
- Modify: `src/components/PanelFocusHost.ts:146`
- Test: `src/services/home-shell/__tests__/briefing-view.test.mts` (no label assertions exist today — verify, don't assume)

- [ ] **Step 1: briefing-view.ts — sentence-case the three band labels**

Replace every occurrence (six sites):
- `label: 'PERSONAL'` → `label: 'Personal'` (2 sites)
- `label: 'WHAT CHANGED'` → `label: 'What changed'` (3 sites)
- `label: 'CRITICAL WORLDWIDE'` → `label: 'Critical worldwide'` (1 site)

- [ ] **Step 2: HomeShellOverlay.ts:344**

`el('span', undefined, 'THE DECK'),` → `el('span', undefined, 'Your Deck'),`

- [ ] **Step 3: SituationDossier.ts — five label sites**

- `:184` `'WHY THIS SURFACED'` → `'Why this surfaced'`
- `:189` `` `EVIDENCE · ${view.evidence.length} PANELS` `` → `` `Evidence · ${view.evidence.length} panels` ``
- `:202` `` `MORE (${view.runnersUp.length})` `` → `` `More (${view.runnersUp.length})` ``
- `:213` `` brief ? `ACTION BRIEF · ${brief.tier.toUpperCase()}` : 'ACTION BRIEF' `` → `` brief ? `Action brief · ${brief.tier.replace('_', ' ')}` : 'Action brief' ``
- `:215` `'TIMELINE'` → `'Timeline'`

- [ ] **Step 4: LibraryOverlay.ts — two label sites**

- `:155` `'FEATURED'` → `'Featured'`
- `:160` `` `MORE (${d.rest.length})` `` → `` `More (${d.rest.length})` ``

- [ ] **Step 5: PanelFocusHost.ts:146 — stop shouting the domain**

`el('span', 'hs-focus-domain', domainLabel.toUpperCase())` → `el('span', 'hs-focus-domain', domainLabel)`
(`LIBRARY_DOMAIN_LABELS` values are already Title Case.)

- [ ] **Step 6: Search for stragglers**

Run: `cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && grep -rn "toUpperCase()" src/components/HomeShellOverlay.ts src/components/SituationDossier.ts src/components/LibraryOverlay.ts src/components/PanelFocusHost.ts src/services/home-shell/`
Expected: no matches. Any hit is a missed site — fix it the same way.

- [ ] **Step 7: Tests + gates**

Run: `cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && npm run typecheck:all && npm run test:homeshell 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: 60 pass / 0 fail. If a test asserts an old ALL-CAPS label, update the EXPECTATION to the new sentence-case string in the same commit (the label is presentation, not contract).

- [ ] **Step 8: Commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && git add src/services/home-shell/briefing-view.ts src/components/HomeShellOverlay.ts src/components/SituationDossier.ts src/components/LibraryOverlay.ts src/components/PanelFocusHost.ts && git commit -m "feat(restyle): sentence-case shell labels at the source

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
(Include the test file in `git add` if Step 7 required expectation updates.)

---

### Task 4: Library + ⌘K restyle

**Files:**
- Modify: `src/styles/library.css` (full-file replacement below)
- Modify: `src/components/CommandPalettePanel.ts:24-40` (STYLE template replacement below)

- [ ] **Step 1: Replace the entire contents of `src/styles/library.css` with:**

```css
/* Library — Apple design language. Full-screen glass sheet over the app.
   Palette + DL tokens: tokens.css. Selector names are load-bearing. */

.library-overlay {
  position: fixed;
  inset: 0;
  z-index: 10001; /* above home shell (10000), below cmdk (10005) */
  background: var(--hs-bg-base);
  color: var(--hs-fg);
  font-family: var(--font-ui);
  letter-spacing: -0.01em;
  display: flex;
  flex-direction: column;
}

body.is-desktop-macos .library-overlay {
  background: var(--mat-raised-bg);
  -webkit-backdrop-filter: var(--mat-blur-raised);
  backdrop-filter: var(--mat-blur-raised);
}

/* display: flex above beats the UA's [hidden] { display: none } — restate
   it so the mounted-but-closed overlay doesn't cover the app at boot. */
.library-overlay[hidden] { display: none; }

.library-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(var(--hs-white-rgb), 0.07);
}

.library-title { font-size: var(--text-md); font-weight: 600; }

.library-search {
  flex: 1;
  max-width: 420px;
  background: var(--mat-thin);
  border: none;
  border-radius: var(--r-pill);
  color: var(--hs-fg);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  padding: 7px 16px;
  outline: none;
  box-shadow: var(--edge-hairline);
}

.library-search:focus { box-shadow: inset 0 0 0 1px rgba(var(--hs-white-rgb), 0.35); }

.library-close {
  margin-left: auto;
  border: none;
  border-radius: var(--r-pill);
  background: var(--mat-thin);
  color: var(--hs-fg-muted);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  padding: 5px 12px;
  cursor: pointer;
}

.library-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.library-nav {
  width: 210px;
  border-right: 1px solid rgba(var(--hs-white-rgb), 0.07);
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.library-nav button {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  color: var(--hs-fg-muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  padding: 7px 12px;
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out);
}

.library-nav button.active {
  background: var(--accent-selection);
  color: var(--hs-fg);
}

.library-nav .lib-count { color: var(--hs-fg-dim); font-size: var(--text-xs); }

.library-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
}

.lib-section-label {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: normal;
  color: var(--hs-fg-muted);
  margin: 12px 0 8px;
}

.lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}

.lib-card {
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--mat-solid-2);
  border: none;
  border-radius: var(--r-md);
  padding: 10px 13px;
  font-size: var(--text-sm);
  color: var(--hs-fg);
  cursor: pointer;
  text-align: left;
  font-family: var(--font-ui);
  box-shadow: var(--e-1), var(--edge-highlight);
  transition: transform var(--dur-fast) var(--ease-out);
}

.lib-card:hover { transform: translateY(-1px); box-shadow: var(--e-2), var(--edge-highlight); }
.lib-card .lib-icon { font-size: var(--text-md); }
.lib-card.lib-system { color: var(--hs-fg-muted); }

.lib-more {
  margin: 8px 0 4px;
  background: var(--mat-thin);
  border: none;
  border-radius: var(--r-pill);
  color: var(--hs-fg-faint);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  padding: 6px 12px;
  cursor: pointer;
}

.lib-empty { color: var(--hs-fg-dim); font-size: var(--text-sm); padding: 20px 0; }

@media (prefers-reduced-motion: reduce) {
  .library-overlay * { transition-duration: 1ms !important; }
  .lib-card, .lib-card:hover { transform: none !important; }
}
```

- [ ] **Step 2: Replace the STYLE template in `src/components/CommandPalettePanel.ts` (lines 24-40) with:**

```typescript
const STYLE = `
.cmdk-v2-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 10005; display: flex; align-items: flex-start; justify-content: center; padding-top: 14vh; }
.cmdk-v2-overlay[hidden] { display: none; }
.cmdk-v2-panel { width: ${PANEL_WIDTH_PX}px; max-width: 94vw; background: var(--mat-solid-3, rgba(28,28,32,0.98)); color: var(--text-primary, #f5f5f7); border: none; border-radius: var(--r-xl, 16px); box-shadow: var(--e-4, 0 24px 64px rgba(0,0,0,0.6)), var(--edge-hairline, inset 0 0 0 0.5px rgba(255,255,255,0.11)); overflow: hidden; font: 13px/1.3 -apple-system, system-ui, sans-serif; }
body.is-desktop-macos .cmdk-v2-panel { background: var(--mat-raised-bg, rgba(28,28,32,0.9)); -webkit-backdrop-filter: var(--mat-blur-raised, blur(24px)); backdrop-filter: var(--mat-blur-raised, blur(24px)); }
.cmdk-v2-input { width: 100%; box-sizing: border-box; background: transparent; border: none; border-bottom: 1px solid rgba(255,255,255,0.08); color: var(--text-primary, #f5f5f7); padding: 14px 18px; font: 15px/1.2 -apple-system, system-ui, sans-serif; outline: none; }
.cmdk-v2-list { max-height: 56vh; overflow-y: auto; padding: 6px; }
.cmdk-v2-section { font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.4); padding: 10px 12px 4px; }
.cmdk-v2-section:first-child { padding-top: 6px; }
.cmdk-v2-row { display: flex; align-items: center; gap: 10px; width: 100%; background: transparent; border: none; color: var(--text-primary, #f5f5f7); text-align: left; padding: 9px 12px; border-radius: var(--r-sm, 8px); cursor: pointer; font: 13px/1.2 -apple-system, system-ui, sans-serif; }
.cmdk-v2-row.is-active, .cmdk-v2-row:hover { background: var(--accent-selection, rgba(255,255,255,0.12)); }
.cmdk-v2-icon { width: 18px; text-align: center; opacity: 0.8; flex: 0 0 18px; }
.cmdk-v2-body { flex: 1; min-width: 0; }
.cmdk-v2-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmdk-v2-subtitle { font-size: 11px; color: rgba(255,255,255,0.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmdk-v2-badge { font-size: 10px; letter-spacing: 0.02em; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); flex: 0 0 auto; }
.cmdk-v2-empty { padding: 18px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px; }
`;
```

Notes: the overlay's own `backdrop-filter: blur(6px)` is REMOVED (the panel now carries the material — one blur, not two); `text-transform: uppercase` dropped from `.cmdk-v2-section`/`.cmdk-v2-badge` (badge strings like `NAV` in `CATEGORY_BADGE` stay uppercase as literal acronyms — do NOT change that Record); `var(--x, fallback)` keeps lint:colors quiet because fallbacks inside `var()` are allowed.

- [ ] **Step 3: Gates**

Run: `cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && npm run lint:colors && npm run typecheck:all && npm run test:homeshell 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: all green (cmdk palette tests live in the settings/palette suites — if `npm run test:homeshell` passes but you touched behavior beyond the STYLE string, you went out of scope; revert that).

- [ ] **Step 4: Commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && git add src/styles/library.css src/components/CommandPalettePanel.ts && git commit -m "feat(restyle): Library glass sheet + cmdk material harmonization

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: e2e + live browser verification

**Files:**
- Modify (canonical, NOT worktree, gitignored): `/Users/bradleybond/Developer/crystalball/.claude/launch.json` — add an entry:

```json
{
  "name": "Apple restyle worktree",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["--prefix", ".worktrees/apple-restyle", "run", "dev", "--", "--port", "3109", "--strictPort"],
  "port": 3109
}
```

- [ ] **Step 1: Playwright suite**

Run: `cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && npx playwright test e2e/home-shell-boot.spec.ts 2>&1 | tail -3`
Expected: `4 passed`. These tests assert structure (`data-panel`, class presence), not colors — a failure means a selector/behavior regression, not a style choice; diagnose before touching the test.

- [ ] **Step 2: Live browser smoke (preview tools, not Bash)**

1. `preview_start {name: "Apple restyle worktree"}` → wait for boot.
2. Verify via `javascript_tool`: `getComputedStyle(document.querySelector('.hs-band')).borderRadius` is `14px`; `getComputedStyle(document.querySelector('.home-shell')).fontFamily` starts with `-apple-system`; `document.querySelectorAll('[style], .hs-card').length` sanity.
3. Open a deck card → focus view; open Library; screenshot each surface (bands, deck, Library, focus).
4. `read_console_messages {onlyErrors: true}` — only feed-fetch noise allowed; any style/shell error is a blocker.
5. Note: the embedded pane is NOT `body.is-desktop-macos`-gated the same as the real app — if the gate is off in the pane, glass falls back to solid; verify the desktop gate class exists (`document.body.classList.contains('is-desktop-macos')`) and report which material path was actually exercised.
6. Stop the server.

- [ ] **Step 3: Full gates**

Run: `cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && npm run typecheck:all && npm run test:homeshell 2>&1 | grep -E "^ℹ (pass|fail)" && npm run lint:colors 2>&1 | tail -1 && npm run docs:check 2>&1 | tail -1 && npm run smoke:offline 2>&1 | tail -3`
Expected: everything green.

- [ ] **Step 4: Commit any smoke-driven fixes**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && git add -u && git commit -m "fix(restyle): browser-smoke follow-ups

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
(Skip if no fixes were needed. `git add -u` is acceptable here because the only tracked changes possible at this point are smoke fixes; verify with `git status` first.)

---

### Task 6: Finalize — docs, rebase, push, Codex, PR

- [ ] **Step 1: Spec status note**

In `docs/superpowers/specs/2026-07-13-apple-design-language-design.md`, under `## §4 Phasing`, append to the Phase A bullet: ` **[SHIPPED — this plan.]**`

- [ ] **Step 2: CLAUDE.md**

In the Home Shell section of `CLAUDE.md`, append one sentence: `The 2026-07 Apple design-language restyle (Cupertino Glass + Graphite; spec docs/superpowers/specs/2026-07-13-apple-design-language-design.md) landed Phase A: DL tokens in tokens.css (--r-*/--e-*/--mat-*/--font-ui/--dur-*), SF body font, glass scoped to body.is-desktop-macos on the six-surface budget, sentence-cased shell labels.`

- [ ] **Step 3: Commit docs, rebase, push**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && git add docs/superpowers/specs/2026-07-13-apple-design-language-design.md CLAUDE.md && git commit -m "docs: record Apple restyle Phase A

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" && git fetch origin && git rebase origin/main && npm run typecheck:all && git push -u origin claude/apple-design-language
```

- [ ] **Step 4: Codex cross-agent review (real, read-only, diff via stdin)**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle && git diff origin/main...HEAD > /tmp/apple-a.diff && codex exec --sandbox read-only "Cross-agent review of a Claude-authored restyle PR (diff on stdin, base origin/main). Focus: CSS-variable misuse, lint:colors violations (raw hex outside tokens.css), @layer !important conflicts, backdrop-filter outside the six-surface budget or missing -webkit- prefix, perf (new infinite animations, transitions on box-shadow/backdrop-filter), and TS label changes breaking tests. End with exactly 'VERDICT: PASS' or 'VERDICT: FAIL' plus numbered findings (P0-P3)." < /tmp/apple-a.diff
```
Fix findings, re-run until PASS. Never fabricate the marker.

- [ ] **Step 5: PR**

`gh pr create` with title `Apple design language Phase A: tokens + Home Shell (Cupertino Glass)`, body containing Summary, Review section with honest contiguous `cross-agent review: Codex` marker + round history, and Test plan checklist. Auto-merge fires once checks pass IF the branch is up-to-date; a green-but-OPEN PR usually means BEHIND → rebase + force-push.

---

## Self-review notes (already applied)

- Spec coverage: Task 1 = tokens/font/shimmer; Task 2 = bands/deck/ribbon/dossier/focus + reduced-motion alternates; Task 3 = de-uppercase; Task 4 = Library/⌘K (completing the six-surface budget); Task 5-6 = verification/delivery. Phase A scope fully covered; classic chrome is Phase B by design.
- The `--hs-bg-card`/`--hs-bg-deck`/`--hs-bg-ribbon` tokens remain defined and consumed by the focus-body panel remap; unreferenced leftovers are fine (Phase B may reuse).
- Type consistency: token names used in Tasks 2/4 (`--r-*`, `--e-*`, `--mat-*`, `--text-*`, `--dur-*`, `--ease-*`, `--accent-selection`, `--edge-*`, `--font-ui`, `--font-data`) are all defined in Task 1 Step 1.

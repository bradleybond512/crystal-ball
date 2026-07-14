# Apple Design Language Restyle — Design Spec

**Date:** 2026-07-13
**Status:** Approved (direction, accent, §1–§3 approved interactively; phasing per §4)
**Baseline:** main @ `eafddda0` (UI shell Phases 1–4 shipped)

## Goal

Replace the current harsh, squared, terminal-style look ("Android-like" per user) with a
soft, rounded, professional Apple (macOS/iOS) design language across everything the eye
touches — Home Shell, classic panels, sidebar, topbar, settings — without losing the
near-black serious-tool identity or regressing idle CPU.

## Locked decisions

1. **Scope:** everything the eye touches (shell + classic surfaces + controls).
2. **Color world:** near-black, Apple-softened (layered dark grays, not macOS system gray).
3. **Typography:** SF-first; monospace retained only for data (timestamps, coordinates,
   tickers, tabular numbers).
4. **Direction:** Cupertino Glass — real translucent materials on chrome surfaces over the
   live map, solid elevated surfaces everywhere else.
5. **Accent:** Graphite — neutral near-white controls; color on screen only ever means data
   or an alert. Alerts stay red (softened to Apple dark-mode systemRed).

## Audit findings this design answers (2026-07-13 five-reader audit)

1. Monospace is the app-wide body default (`--font-body: var(--font-mono)`,
   `main.css:66-67,236`); shell/library hard-code `ui-monospace` (`home-shell.css:11,290,439`,
   `library.css:12`); SF exists only as quarantined `--mac-font`/`--aid-font`.
2. Zero `box-shadow` in `home-shell.css`/`library.css` — all elevation is 1px white-alpha
   hairlines.
3. No radius system; `--radius-sm/md/lg/xl`, `--font-ui`, `--elevation-2` are referenced but
   **undefined** (WelcomeFlow/ContextualHint/Toast render square by accident). Classic
   `.panel` has no radius; 247/499 main.css radii are 2–4px.
4. Pure near-black + maximal achromatic contrast (`#05070a`, `--text-primary #fff`, 21:1).
5. 9–13px type; 9px ALL-CAPS +0.1em micro-labels; uppercase baked into TS
   (`briefing-view.ts:94,133,181`, `SituationDossier.ts:184-215`, `LibraryOverlay.ts:155,160`,
   `PanelFocusHost.ts:146`); 215 `text-transform: uppercase` rules repo-wide.
6. Springless motion: 4 transitions in the whole shell (generic `ease`), zero in library.css.
7. macos-native.css softens some outer panel chrome but interiors stay harsh; the new shell
   surfaces have zero `is-desktop-macos` treatment.
8. Saturated status colors (`--sev-critical #d50000`, `#f44336`), 0.4–0.5-alpha colored
   full-card outlines, dashed borders on affordances.

## §1 Design language (token system)

All tokens are CSS custom properties on `:root` in `src/styles/tokens.css` (lint:colors
allowlisted). Consumption strictly via `var()` / `rgba(var(--x-rgb), α)` so variant themes
(unlayered var-redefinitions) keep working unmodified.

### Geometry

```
--r-xs: 6px;  --r-sm: 10px;  --r-md: 14px;  --r-lg: 18px;  --r-xl: 22px;  --r-pill: 999px;
```

Chips/buttons = pill. Cards 14–18. Overlays (dossier, Library, focus frame, ⌘K) 18–22.
The missing legacy tokens get defined as aliases: `--radius-sm: var(--r-sm)`,
`--radius-md: var(--r-md)`, `--radius-lg: var(--r-lg)`, `--radius-xl: var(--r-xl)` —
instantly un-squaring WelcomeFlow/ContextualHint/Toast.

### Elevation (replaces outline-borders)

Four levels, each: tight contact shadow + soft ambient shadow. Companions: an inset top
highlight and a 0.5px vibrancy edge. Reference values:

```
--e-1: 0 1px 2px rgba(0,0,0,.40);
--e-2: 0 2px 6px rgba(0,0,0,.40), 0 8px 24px rgba(0,0,0,.25);
--e-3: 0 4px 12px rgba(0,0,0,.45), 0 16px 40px rgba(0,0,0,.35);
--e-4: 0 8px 24px rgba(0,0,0,.50), 0 32px 80px rgba(0,0,0,.40);
--edge-highlight: inset 0 1px 0 rgba(255,255,255,.05);
--edge-hairline: inset 0 0 0 0.5px rgba(255,255,255,.11);
```

1px full-opacity hairline borders are demoted to `rgba(var(--hs-white-rgb), .08)` or removed
where a shadow now does the job. Dashed borders are eliminated.

### Materials

Glass (chrome only — see §2 budget), with solid fallbacks:

```
--mat-chrome-bg: rgba(24,28,36,.55);      /* + blur(22px) saturate(1.5) */
--mat-raised-bg: rgba(25,29,37,.62);      /* + blur(24px) saturate(1.5) */
--mat-blur-chrome: blur(22px) saturate(1.5);
--mat-blur-raised: blur(24px) saturate(1.5);
--mat-thin: rgba(255,255,255,.07);        /* nested fills/chips — no blur */
--mat-solid-1: #14171d;  --mat-solid-2: #171a21;  --mat-solid-3: #1e222b;
--hs-bg-base: #0b0d12;                    /* was #05070a — keeps near-black identity */
```

Blur is applied only under `body.is-desktop-macos` (WKWebView; `-webkit-backdrop-filter`
prefix REQUIRED, unprefixed added alongside); all other runtimes get the solid fallback
with identical geometry.

### Typography

```
--font-ui: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif;
--font-data: ui-monospace, "SF Mono", Menlo, monospace;
--text-xs: 11px; --text-sm: 12.5px; --text-base: 13.5px;
--text-md: 15px; --text-lg: 17px;  --text-xl: 22px;
```

`--font-body` flips from mono to `var(--font-ui)` app-wide. Mono is opt-in via
`--font-data` for data readouts only. Titles at `-0.01em` tracking; the 9px ALL-CAPS
`+0.1em` micro-label pattern becomes 11px / weight 600 / sentence case / muted gray.
Legacy alias `--font-ui` (referenced-but-undefined today) resolves to the real stack.

### Color softening

```
--sev-critical: #ff453a;   /* was #d50000 — Apple dark systemRed */
--status-error: #ff453a;   --status-warn: #ffd60a;  --status-ok: #32d74b;
--text-primary: #f2f3f5;   /* was #ffffff — kills 21:1 cutouts */
```

Status tints render as soft washes (`linear-gradient` of `rgba(var(--sev-*-rgb), .13→.05)`
over the surface), never as 0.4–0.5-alpha colored outlines. Graphite accent: primary
actions `rgba(255,255,255,.92)` fill with dark text; selections `rgba(255,255,255,.16)`;
focus rings white.

### Motion

```
--dur-fast: 150ms;  --dur-base: 220ms;  --dur-slow: 320ms;
--ease-out: cubic-bezier(0.25, 1, 0.5, 1);
--ease-spring: cubic-bezier(0.32, 1.4, 0.42, 1);   /* overlay entrances ONLY */
```

Transitions animate `transform`/`opacity` only. Zero new `infinite` animations.
`prefers-reduced-motion` gets designed opacity-only alternates (not blanket kills); the
unguarded `index.html` skeleton shimmer gets a guard.

## §2 Surface application

### Glass budget (hard cap — the ONLY blurred surfaces)

1. Topbar; 2. status ribbon; 3. briefing bands (3 strips count as one family);
4. situation dossier drawer; 5. Library overlay; 6. focus-view frame chrome + ⌘K palette.
≤8 blurred elements alive at once. Never per-card, never in the panels grid.

### Home Shell

- Briefing bands: chrome glass, sentence-case labels, Critical gets the soft red wash.
- Deck cards: `--mat-solid-2` @ `--r-lg`, `--e-2` + top highlight, pill chips.
- Status ribbon: glass pill dock.
- Dossier + Library: raised glass sheets @ `--r-xl`, `--ease-spring` entrance,
  opacity-only reduced-motion alternate.
- Focus frame: raised-glass chrome; the hosted panel inside keeps its solid surface.

### Classic surfaces

- Panel frames: `--r-md` radius, `--e-2`, SF sentence-case headers. The parallel
  macos-native.css 12px "aid" dialect is superseded by (re-pointed at) the one token system.
- Panel interiors: chips → pills, table hairlines → `rgba(255,255,255,.06)`, data cells
  keep `--font-data` deliberately.
- Sidebar: macOS source list — rounded selection rows (`--r-sm`), SF 13px, small gray
  sentence-case section headers.
- Settings/UnifiedSettings: inherit the same control treatments.

### De-uppercase program

Uppercase is baked into TS, not just CSS. Sentence-case at the source in
`briefing-view.ts`, `SituationDossier.ts`, `LibraryOverlay.ts`, `PanelFocusHost.ts`
(view-model tests asserting those strings update in the same commits), plus removal of
`text-transform: uppercase` where it styles UI labels. Domain tags like "GLOBAL INTEL"
become "Global Intel".

### Keeps its character (content, not chrome)

The map, God's Eye, chart/data visualizations, mono data columns.

## §3 Guardrails

- **Perf:** idle-CPU incident open (~58%, target ≤40%). Restyle must be CPU-neutral:
  blur only on the §2 budget; no new `infinite` animations; transitions on
  `transform`/`opacity` only (never `box-shadow`/`backdrop-filter`). Verify by sampling
  WebContent idle CPU on the built app before/after.
- **Cascade:** main.css + imports live in `@layer base`; shell files are unlayered; a
  layered `!important` beats everything unlayered. New styling stays unlayered; where a
  layered `!important` conflicts (`.span-N` family precedent), edit the layered rule in
  main.css directly. Tokens on `:root` resolve for both worlds.
- **Variants:** happy-theme etc. are unlayered `:root[data-variant]` var-redefinitions —
  they keep winning as long as consumption is via `var()`. No hardcoded values outside
  tokens.css.
- **lint:colors:** new values only in tokens.css; consumption via `var()` /
  `rgba(var(--x-rgb), α)`; new files carry baseline 0.
- **Booby-trap:** macos-native.css selectors keyed on inline-style strings
  (`[style*="border:1px solid"]`, :1704-1769) — classic-pass tasks must check these when
  touching inline styles.
- **Testing:** e2e keys on `data-*` attrs (safe); focus-host span-strip classes are
  load-bearing (unrenamed). Per-phase gates: typecheck:all, test:homeshell (+ affected
  suites), lint:colors, smoke:offline, e2e home-shell-boot, live browser smoke with
  screenshots. Reduced-motion alternates verified via `resize_window`/media emulation.

## §4 Phasing

- **Phase A — Tokens + Home Shell:** token foundation in tokens.css (incl. defining the
  missing legacy tokens), `--font-body` flip to SF, shell surfaces (bands/deck/ribbon/
  Library/dossier/focus/⌘K) restyled, de-uppercase TS program, skeleton-shimmer guard.
- **Phase B — Classic chrome:** panel frames + interiors, sidebar source-list, topbar,
  chips/buttons/badges/tables/scrollbars, settings; supersede the macos-native parallel
  dialect; inline-style booby-trap cleanup.
- **Phase C — Polish:** motion pass, God's Eye/HUD harmonization, edge cases
  (toasts/menus/modals), screenshot baseline set, idle-CPU verification on the built app.

Each phase: own implementation plan + PR(s) via subagent-driven development with
two-stage review, Codex cross-agent review, standard gates.

## Out of scope / deferred

- Light mode (near-black identity retained; tokens stay dark-fixed).
- Mobile adaptation (deferred with the shell program's mobile work).
- Icon system replacement (emoji/glyph icons stay for now; SF Symbols would need font
  licensing care — revisit post-Phase C).
- Restyling chart internals / map styles (content, not chrome).

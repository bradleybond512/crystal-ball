# Crystal Ball Design System

Foundation reference for UI work (established by the 2026-07 design review,
Waves 1–4). Two rules carry everything else:

1. **New code uses tokens, not raw colors.** `scripts/lint-colors.mjs`
   (`npm run lint:colors`, part of `lint:strict`) enforces this as a ratchet:
   every file's existing hardcoded-color count is baselined, and the lint
   fails only when a file exceeds its baseline. Counts only go down.
2. **One severity vocabulary everywhere.** Calm → severe is always
   `info → low → moderate → elevated → high → critical`. Panel-health and
   feed state use the separate status vocabulary (`ok / warn / stale / error`).
   Never invent a third scale.

## Token reference

Tokens live in `src/styles/tokens.css` (semantic layer, fixed values) and
`src/styles/main.css` `:root` (theme-aware base: `--bg`, `--surface`,
`--border`, `--text`, `--text-secondary`, `--overlay-*`). The semantic tokens
below are fixed (identical in dark and light) and were derived from a
frequency analysis of the colors already shipping in the app, so adopting one
is pixel-identical to the literal it replaces.

### Severity scale

| Token | Value | Use when |
| --- | --- | --- |
| `--sev-info` | `#60a5fa` | Advisory, informational, "for awareness" |
| `--sev-low` | `#22c55e` | Minor signal, no action needed |
| `--sev-moderate` | `#facc15` | Worth watching, degraded-but-working |
| `--sev-elevated` | `#fb923c` | Prepare; conditions worsening |
| `--sev-high` | `#ef4444` | Act now |
| `--sev-critical` | `#d50000` | Life-safety / extreme |

Each severity token has a translucent `-bg` twin for chips and badges
(`--sev-info-bg` … `--sev-critical-bg`), tuned to the alpha most used in the
existing UI. Pattern: `background: var(--sev-high-bg); color: var(--sev-high);`.

### Surfaces and borders

| Token | Value | Use when |
| --- | --- | --- |
| `--surface-0` | `#0a0a0a` | Window / app background |
| `--surface-1` | `#141414` | Panel and card background |
| `--surface-2` | `#1a1a1a` | Insets: inputs, wells, nested cards |
| `--surface-3` | `#222222` | Overlays: menus, popovers, modals |
| `--surface-border` | `#333333` | Default hairline border |
| `--surface-border-strong` | `#444444` | Emphasized / hover border |

### Text tiers

| Token | Value | Use when |
| --- | --- | --- |
| `--text-primary` | `#ffffff` | Headline numbers, strong values, text on accent |
| `--text-secondary` | `#ccc` (theme-aware, main.css) | Body copy, labels |
| `--text-tertiary` | `#9e9e9e` | Supporting labels, meta rows, timestamps |
| `--text-disabled` | `#666666` | Disabled, resolved, inert |

### Status (feed dots, staleness chips, source health)

| Token | Value | Use when |
| --- | --- | --- |
| `--status-ok` | `#4caf50` | Feed healthy, check passed, confirmed |
| `--status-warn` | `#ff9800` | Degraded but serving |
| `--status-stale` | `#ff9800` | Data older than its freshness window |
| `--status-error` | `#f44336` | Feed down, check failed, wrong |

`--status-stale` intentionally shares the warn hue today; keep the semantic
distinction in markup so the values can diverge later.

### Accent

| Token | Value | Use when |
| --- | --- | --- |
| `--accent` | theme-owned (`main.css` / `happy-theme.css`) | Primary emphasis |
| `--accent-muted` | `color-mix(in srgb, var(--accent) 55%, transparent)` | Secondary emphasis |
| `--mac-accent` / `--mac-blue` | `#0a84ff` (macos-native.css) | Interactive controls in desktop chrome |

Older layers also define `--severity-*`, `--severity-0..4`, `--semantic-*`,
`--threat-*` and `--domain-*`; they keep working. Prefer the `--sev-*` scale
for new severity UI. In TS inline styles always keep a fallback:
`var(--sev-high, #ef4444)` — the fallback must equal the token value.

## Control patterns (Waves 1–3)

- **Empty / error states**: render `renderPanelEmpty()` / `renderPanelError()`
  from `src/components/ui/PanelStates.ts`. No raw HTTP codes or API paths in
  visible copy — technical detail goes in the tooltip; retry is an event the
  owning panel handles.
- **Control glyphs**: use `icon()` from `src/components/ui/icons.ts`
  (16×16 `currentColor` stroke SVG). Emoji stay only as data/content, never as
  control glyphs.
- **Menus**: anchored `role="menu"` popover with checkmark on the active item,
  arrow-key roving, Esc/outside-click close (`.triage-preset-*` in
  `src/styles/alerts.css` + `TriageBar.ts` is the reference implementation).
- **Durations**: every "how long" string goes through `formatDurationMinutes`
  / `formatDurationMs` (`src/utils/format-duration.ts`) — never raw unit
  dumps like `7620m`.
- **Badges**: numeric badges cap at `99+` (see `formatBadgeCount` in
  `CognitiveBiasDetectorPanel.ts` for the reference implementation).
- **Accessibility floor**: global `:focus-visible` ring and
  `prefers-reduced-motion` keyframe kill are already in `main.css`; minimum
  type size is 11px; hit targets ≥ 24px square. Dialogs get `role="dialog"`,
  `aria-modal`, focus trap and focus restore (see `AnalystHUD`).

## Adding or changing tokens

1. Define the token in `src/styles/tokens.css` with a comment saying when to
   use it. Fixed values only; theme-aware colors belong in `main.css`.
2. Document it in the table above.
3. If a data-viz palette file legitimately needs raw colors, add it to
   `ALLOWLIST_FILES` in `scripts/lint-colors.mjs` with a justification.
4. After migrating literals out of a file, run
   `node scripts/lint-colors.mjs --update` to ratchet the baseline down
   (the script refuses to raise a file's baseline without `--force`).

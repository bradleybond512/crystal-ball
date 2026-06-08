# UI Overlap & Legibility Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the desktop UI overlap and blurred-text issues visible in the dashboard (stacked toasts, illegible map labels, broken Alert Inbox layout, colliding overlays) and harden the layering so they don't recur.

**Architecture:** Mostly CSS plus two focused component edits. Three root causes were confirmed live: (1) the Alert Inbox renders `.uai-*` classes that have **zero** matching CSS rules; (2) map labels use deck.gl `TextLayer` **without SDF fonts**, which renders blurry/ghosted text; (3) `Toast` has no de-duplication and several overlays share colliding z-index values. Verification is done in the live preview (`Vite Dev (desktop)` config — the web config does not render the macOS shell), not unit tests, since these are visual/layout changes.

**Tech Stack:** TypeScript, Vite, deck.gl `TextLayer`, hand-authored CSS in `src/styles/main.css`, MapLibre/DeckGL desktop chrome (`body.is-desktop-macos`).

---

## Preflight (do once, before Task 1)

- [ ] **Branch off latest main**

```bash
git fetch origin
git checkout -b claude/ui-overlap-cleanup origin/main
```

- [ ] **Start the desktop preview** (the web config renders a different layout — you MUST use the desktop one)

Use the preview tool with launch config `Vite Dev (desktop)` (it sets `VITE_DESKTOP_RUNTIME=1`). Resize viewport to 1728×1000. The build shows a "BIOMETRIC SCAN READY" lock overlay (fixed, z-index 9999) over a fully-mounted dashboard; hide it for inspection with:

```js
(() => { const l = [...document.querySelectorAll('div')].find(e => getComputedStyle(e).position==='fixed' && getComputedStyle(e).zIndex==='9999' && /BIOMETRIC SCAN READY/.test(e.textContent||'')); if (l) l.style.display='none'; return !!l; })()
```

This is inspection-only and resets on reload — never persist it.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `src/styles/main.css` | All new `.uai-*` styles, tooltip legibility, z-index token scale, bottom-strip spacing, sidebar density | 1, 2, 4, 5, 6 |
| `src/components/Toast.ts` | De-dup identical toasts; move container clear of the status bar | 3 |
| `src/components/DeckGLMap.ts` | Enable SDF + outline on persistent label `TextLayer`s | 2 |

No new files. CSS is appended to existing thematic sections of `main.css`.

---

## Task 1: Alert Inbox stylesheet (Fix A — highest confidence)

**Root cause (confirmed live):** `uaiRuleHits: {}` — no CSS rule targets any `.uai-toolbar*`, `.uai-title`, `.uai-body`, etc. `.uai-toolbar` computes to `display:block`, so filter pills cram onto baseline and title+body stack untruncated (the "doubled text"). Source markup: [`UnifiedAlertInboxPanel.ts:519-538`](../../../src/components/UnifiedAlertInboxPanel.ts) (toolbar) and `:579-593` (rows).

**Files:**
- Modify: `src/styles/main.css` — append near the existing Alert Inbox rules (search for `.uai-expanded .uai-body` ~line 19487; add the new block immediately after it).

- [ ] **Step 1: Capture the "before" state**

Screenshot the Alert Inbox panel, and record the broken layout:

```js
(() => { const t=document.querySelector('.uai-toolbar'); const s=t&&getComputedStyle(t); return { display:s?.display, flexWrap:s?.flexWrap, gap:s?.gap }; })()
// Expect before: { display: "block", flexWrap: "nowrap", gap: "normal" }
```

- [ ] **Step 2: Add the Alert Inbox stylesheet**

Append to `src/styles/main.css`:

```css
/* ── Unified Alert Inbox: toolbar + row layout ──────────────────────── */
.uai-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.uai-toolbar-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}
.uai-toolbar-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-dim);
  margin-right: 2px;
}
.uai-toolbar-btn {
  font-size: 11px;
  line-height: 1.4;
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.uai-toolbar-btn:hover { background: var(--surface-hover); color: var(--text); }
.uai-toolbar-btn.uai-active {
  background: var(--accent);
  border-color: var(--accent);
  color: #000;
  font-weight: 600;
}
.uai-clear-btn { color: var(--text-dim); }

/* Row title/body: one line each, truncated, body dimmed as a subtitle */
.uai-title-cell { min-width: 0; max-width: 0; width: 100%; }
.uai-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.uai-body {
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.uai-related-badge {
  margin-left: 6px;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 8px;
  background: rgba(120, 130, 255, 0.18);
  color: #9aa6ff;
  white-space: nowrap;
}
.uai-why-btn {
  margin-left: 6px;
  font-size: 9px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}
/* Expanded row may show full body */
.uai-expanded .uai-body { white-space: normal; overflow: visible; }
```

> Note: `.uai-expanded .uai-body` already exists ~line 19487 with a `max-height`. Keep that rule; the override above only relaxes wrapping when expanded. If the two conflict during testing, merge them into one rule.

- [ ] **Step 3: Verify the fix in preview**

Reload, hide the lock overlay, ensure the Alert Inbox panel is visible, then:

```js
(() => {
  const t=document.querySelector('.uai-toolbar'); const s=getComputedStyle(t);
  const body=document.querySelector('.uai-body'); const bs=getComputedStyle(body);
  return { toolbar:{display:s.display, flexWrap:s.flexWrap, gap:s.gap}, body:{whiteSpace:bs.whiteSpace, textOverflow:bs.textOverflow, color:bs.color} };
})()
```

Expected: toolbar `display:"flex"`, `flexWrap:"wrap"`, non-`normal` gap; body `whiteSpace:"nowrap"`, `textOverflow:"ellipsis"`. Screenshot and confirm: filter pills wrap cleanly on one+ rows, each alert is a single title line + dimmed single-line subtitle (no more apparent duplication).

- [ ] **Step 4: Commit**

```bash
git add src/styles/main.css
git commit -m "fix: style Alert Inbox toolbar + rows (classes had zero CSS)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Map label legibility — SDF + outline (Fix B)

**Root cause (confirmed in source):** The persistent `theater-polygons-labels` `TextLayer` ([`DeckGLMap.ts:5997-6009`](../../../src/components/DeckGLMap.ts)) renders bold near-white text with **no `fontSettings.sdf` and no outline**. Non-SDF deck.gl text uses a bitmap atlas that blurs/ghosts at sub-pixel positions and fractional zoom — this is the "Global…" double-vision over the orange circle. Other persistent name labels (forecast overlay `:2397`, company labels `:3019`, satellite labels `:6389`) share the risk; the count-bubble layers are short and lower priority.

**Files:**
- Modify: `src/components/DeckGLMap.ts` — add a shared crisp-text constant and apply to persistent label layers.
- Modify: `src/styles/main.css` — secondary contrast/smoothing pass on the hover tooltip (`.deckgl-tooltip`).

- [ ] **Step 1: Confirm the exact culprit live**

On the map view, hover/zoom to reproduce the blurred label and identify its layer id via the deck.gl inspector or by toggling layers. Confirm it is `theater-polygons-labels` (text = `name\nscore`). If a *different* TextLayer is the culprit, apply the same Step-2 change to that layer instead/as well.

- [ ] **Step 2: Add a shared crisp-text config and apply it**

Near the top of the `DeckGLMap` module (after imports), add:

```ts
/** deck.gl TextLayer renders blurry bitmap-atlas glyphs unless SDF is enabled.
 *  These props give crisp, outlined text at any zoom / DPR. */
const CRISP_LABEL_TEXT = {
  fontSettings: { sdf: true, radius: 12, cutoff: 0.25 },
  outlineWidth: 2,
  outlineColor: [0, 0, 0, 200] as [number, number, number, number],
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
};
```

Then spread it into the `theater-polygons-labels` layer (`DeckGLMap.ts:5997`):

```ts
const labels = new TextLayer<(typeof labelData)[number]>({
  id: 'theater-polygons-labels',
  data: labelData,
  getPosition: (d) => d._centroid,
  getText: (d) => `${d.name}\n${d.score}`,
  getSize: 11,
  getColor: isLight ? [30, 30, 30, 200] : [240, 240, 240, 200],
  fontWeight: 'bold',
  background: true,
  getBackgroundColor: isLight ? [255, 255, 255, 140] : [20, 20, 30, 160],
  backgroundPadding: [4, 2, 4, 2],
  pickable: false,
  ...CRISP_LABEL_TEXT,
});
```

In light mode, the black outline can be heavy; if Step-3 verification shows it looks bad on light basemaps, gate the outline color:

```ts
outlineColor: (isLight ? [255, 255, 255, 220] : [0, 0, 0, 200]) as [number, number, number, number],
```

(Apply by overriding `outlineColor` after the spread, or branch the constant.)

- [ ] **Step 3: Improve the hover tooltip too**

In `src/styles/main.css`, replace the `.deckgl-tooltip` block (~line 13703):

```css
/* deck.gl Tooltip */
.deckgl-tooltip {
  background: rgba(20, 20, 28, 0.95);
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text);
  max-width: 250px;
  pointer-events: none;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.deckgl-tooltip strong {
  color: var(--accent);
  font-weight: 600;
}
```

- [ ] **Step 4: Verify**

Reload, navigate to the map, reproduce the previously-blurred label. Confirm visually it is now crisp with a clear outline (screenshot before/after). Run typecheck:

```bash
npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/DeckGLMap.ts src/styles/main.css
git commit -m "fix: crisp map labels via SDF fonts + tooltip contrast

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Toast de-dup + clear the status bar (Fix C)

**Root cause (confirmed in source):** [`Toast.ts:200-219`](../../../src/components/Toast.ts) pushes every toast with no content comparison, so identical correlation alerts (e.g. three `CORRELATION Red Flag Warning`) stack. Container is `top:16px` (overlaps the full-width status bar at z 9000). User decision: **cap + dedupe only** — suppress exact duplicates, keep distinct ones (max 3).

**Files:**
- Modify: `src/components/Toast.ts`

- [ ] **Step 1: Store a dedupe key on each instance**

In the `Toast` class fields (after `private dismissed = false;`), add:

```ts
  private readonly key: string;
```

In the constructor (after `this.remaining = this.duration;`), add:

```ts
    this.key = `${options.title} ${options.message ?? ''}`;
```

- [ ] **Step 2: Suppress duplicates in `show()` and refresh the existing toast's timer**

Replace the top of `show()` (currently lines 200-208):

```ts
  show(): void {
    if (isGhostMode()) return;

    // Suppress exact duplicates already on screen — refresh the existing
    // toast's countdown instead of stacking an identical one.
    const dup = activeToasts.find((t) => t.key === this.key && !t.dismissed);
    if (dup) {
      dup.refresh();
      return;
    }

    // Evict oldest if at max
    while (activeToasts.length >= MAX_TOASTS) {
      activeToasts[0]?.dismiss();
    }

    activeToasts.push(this);
```

- [ ] **Step 3: Add the `refresh()` method**

Add to the `Toast` class (e.g. after `resume()`):

```ts
  /** Restart the auto-dismiss countdown — used when a duplicate is suppressed
   *  so the still-relevant toast stays on screen instead of expiring. */
  refresh(): void {
    if (this.dismissed) return;
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.remaining = this.duration;
    this.progress.style.transition = 'none';
    this.progress.style.transform = 'scaleX(1)';
    requestAnimationFrame(() => {
      this.progress.style.transition = `transform ${this.duration}ms linear`;
      this.progress.style.transform = 'scaleX(0)';
    });
    this.startTimer();
  }
```

- [ ] **Step 4: Move the container clear of the status bar**

In `getContainer()` (line ~34), change `top: '16px'` to clear the desktop status bar band:

```ts
      top: 'calc(env(safe-area-inset-top, 0px) + 52px)',
      right: '16px',
```

Verify `52px` clears the `eew-status-bar` / storm-mode bar in preview; adjust if needed.

- [ ] **Step 5: Verify**

```bash
npm run typecheck:all
```

In preview, trigger the same correlation alert repeatedly (or wait for live duplicates) and confirm: only one toast per unique title+message, max 3 stacked, and the stack starts below the status bar (no overlap). Screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/components/Toast.ts
git commit -m "fix: de-dup identical toasts + drop stack below status bar

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Z-index token scale + fix confirmed collisions (Fix D)

**Root cause (confirmed):** ad-hoc z-index magic numbers collide — `eew-status-bar` and `cb-storm-mode` both `9000` (render-order roulette), toast inline `9999` sits awkwardly between status (9000) and modals (10000+). No shared scale. Full migration of every z-index in the repo is out of scope; this task introduces tokens and migrates the **confirmed-colliding** overlays only. Remaining magic numbers are swept opportunistically in Task 7.

**Files:**
- Modify: `src/styles/main.css` (`:root` token block + the colliding rules)
- Modify: `src/components/Toast.ts` (use the toast token)

- [ ] **Step 1: Define the token scale**

In the dark-theme `:root` block of `src/styles/main.css` (near the other custom props, ~line 19), add:

```css
  /* Overlay stacking scale — single source of truth for layering. */
  --z-strip: 1040;
  --z-strip-raised: 1050;
  --z-shift-overlay: 1200;
  --z-status-bar: 9000;
  --z-toast: 9500;
  --z-modal: 10000;
  --z-modal-raised: 10001;
  --z-modal-top: 10002;
  --z-overlay-top: 10003;
  --z-help: 10004;
```

- [ ] **Step 2: Resolve the 9000 collision**

The two top bars must not share a layer. Give the weather storm-mode bar an explicit tier just above the seismic bar so order is deterministic. In the `cb-storm-mode` host rule (search `cb-storm-mode-host` / `alerts.css:616` — it currently uses `9000`), set:

```css
  z-index: calc(var(--z-status-bar) + 1);
```

Leave `eew-status-bar` (`main.css:17634`) at `z-index: var(--z-status-bar);`. (If they should be mutually exclusive rather than stacked, instead hide one when the other is active — note this for the human if both being visible is itself a bug.)

- [ ] **Step 3: Migrate the toast + strips to tokens**

In `Toast.ts` `getContainer()`, change `zIndex: '9999'` to:

```ts
      zIndex: '9500',
```

(Inline styles can't read CSS vars directly; `9500` matches `--z-toast`. Leave a comment: `// --z-toast`.)

In `main.css`, change `.cbs-strip` `z-index: 1050;` → `z-index: var(--z-strip-raised);` and `.replay-scrubber` `z-index: 1040;` → `z-index: var(--z-strip);`.

- [ ] **Step 4: Verify**

```bash
npm run typecheck:all
```

In preview, confirm the status bar(s), toast, and bottom strips layer in the intended order (status below toast below modals; strips below everything). No visual regression. Screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/styles/main.css src/components/Toast.ts
git commit -m "refactor: z-index token scale + fix status-bar collision

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Reserve space so bottom strips don't cover panels (Fix E)

**Root cause (confirmed live):** `.cbs-strip` (fixed, `bottom:44px`, z 1050) sits at y≈888 in a 1000px viewport and overlaps the bottom panel row; the panel scroll area has no bottom padding reserving space for the fixed strips.

**Files:**
- Modify: `src/styles/main.css` — add desktop bottom padding to the panel scroll container.

- [ ] **Step 1: Identify the scroll container live**

```js
(() => { const el=document.querySelector('.mac-content-body')||document.querySelector('.panels-grid'); const s=getComputedStyle(el); return { cls:el.className, overflowY:s.overflowY, paddingBottom:s.paddingBottom }; })()
```

Note which element actually scrolls (the one with `overflow-y: auto/scroll`).

- [ ] **Step 2: Reserve bottom space on desktop**

Append to `src/styles/main.css` (use the actual scrolling container class from Step 1 — shown here as `.mac-content-body`):

```css
/* Reserve space for the fixed bottom strips (cbs-strip / replay-scrubber)
   so the last panel row is never hidden behind them on desktop chrome. */
body.is-desktop-macos .mac-content-body {
  padding-bottom: 84px;
}
```

- [ ] **Step 3: Verify**

Reload, hide the lock overlay, scroll to the bottom of the panel grid. Confirm the last row (e.g. Urban Security / Maritime Boundary) is fully readable above the `CRYSTAL BALL SAYS` strip — no clipping. Screenshot before/after.

- [ ] **Step 4: Commit**

```bash
git add src/styles/main.css
git commit -m "fix: reserve bottom space so strips don't cover panels

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Sidebar density (Fix F)

**Observation (live):** the left nav lists ~30 items with no internal scroll containment, making it long and cramped and risking the footer controls (theme/settings) being pushed off-screen on shorter windows.

**Files:**
- Modify: `src/styles/main.css` (or `macos-native.css` where `.mac-sidebar` lives — confirm which file actually styles it).

- [ ] **Step 1: Inspect current sidebar metrics**

```js
(() => { const sb=document.querySelector('.mac-sidebar'); const item=document.querySelector('.mac-sidebar-panel-item'); return { sbOverflow:getComputedStyle(sb).overflowY, itemPad:getComputedStyle(item).padding, itemH:item.getBoundingClientRect().height|0 }; })()
```

- [ ] **Step 2: Tighten rows and contain scroll**

Add (in the file that styles `.mac-sidebar`):

```css
/* Denser, scroll-contained sidebar nav so the footer controls stay visible. */
body.is-desktop-macos .mac-sidebar-panel-list {
  overflow-y: auto;
  min-height: 0;
}
body.is-desktop-macos .mac-sidebar-panel-item {
  padding-top: 3px;
  padding-bottom: 3px;
  font-size: 12px;
}
```

> Confirm the actual class for the scrollable list container in Step 1 (it may be `.mac-sidebar-panel-list`, `.mac-sidebar-nav`, or similar). Use the real class name.

- [ ] **Step 3: Verify**

Reload. Confirm the nav scrolls internally, footer controls remain visible, and rows are tighter but still comfortably clickable (≥ 22px tall). Screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/styles/main.css
git commit -m "polish: denser, scroll-contained sidebar nav

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Full-pass sweep + final verification

**Goal:** catch anything the per-fix tasks missed and confirm no regressions across views and sizes.

- [ ] **Step 1: Sweep the major views at 1728×1000**

With the desktop preview + lock overlay hidden, walk: dashboard grid, map view (hover hotspots — confirm no remaining blurry labels; if another `TextLayer` is blurry, apply the `CRISP_LABEL_TEXT` spread from Task 2 to it and amend that commit's follow-up), the map filter dropdown, and any open modal. Screenshot each. Note any overlap/contrast issue and fix it in the most relevant file.

- [ ] **Step 2: Check a narrower desktop width**

Resize to 1280×800 and re-check toolbar wrap, toast position, bottom-strip clearance, sidebar scroll. Fix any new overlap.

- [ ] **Step 3: Console + typecheck**

```bash
npm run typecheck:all
```

Confirm zero errors. In preview, check console for errors — only pre-existing dev-server external-API proxy failures (SatelliteCatalog / Telegram / ADS-B `Unexpected token '<'`) are acceptable; anything referencing the changed files is not.

- [ ] **Step 4: Final before/after screenshots**

Capture the dashboard, Alert Inbox, map labels, and toast stack to share with the user.

- [ ] **Step 5: Finish the branch**

Use `superpowers:finishing-a-development-branch` (verify typecheck passes → present the 4 options → push + PR to `origin`). Note: `claude/*` branches require a Codex cross-agent review before auto-merge (`npm run cross-check`).

---

## Self-Review

- **Spec coverage:** A = Task 1 (Alert Inbox CSS), B = Task 2 (map labels), C = Task 3 (toast), D = Task 4 (z-index), E = Task 5 (bottom strips), F = Task 6 (sidebar), full pass = Task 7. All six agreed workstreams + the sweep are covered.
- **Placeholders:** every CSS/TS step contains the actual code. The three "confirm the real class/element name in Step 1" notes (Tasks 5, 6, and the light-mode outline in Task 2) are deliberate live-verification gates, not unfilled blanks — the code is written; only the selector/value may need a one-line adjustment after inspection.
- **Type consistency:** `CRISP_LABEL_TEXT` is defined once (Task 2) and reused; `key`/`refresh()` on `Toast` are defined before use; token names (`--z-toast` etc.) are consistent between `:root` and the rules that consume them.

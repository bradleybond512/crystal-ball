# Apple Restyle Phase B — Classic Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge the classic surfaces (panels, sidebar, toolbar, modals, interior primitives) onto the Phase A design-language tokens, and unify the app's four coexisting critical-red hues onto Apple dark systemRed.

**Architecture:** Highest-leverage move: on desktop every classic panel already routes through `--mac-card-*` and the sidebar through `--mac-sidebar-*`/`--aid-*` (macos-native.css) — re-pointing those token VALUES at the DL tokens converges thousands of consumers at once. main.css base chrome gets targeted rule edits (non-desktop + primitives that show through both). The red migration is a scripted sweep: CSS literals → tokens, TS literals → the unified hue.

**Tech Stack:** CSS custom properties, sed-scripted sweeps with verification counts, node:test via tsx, Playwright.

**Worktree:** `/Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle-b`, branch `claude/apple-restyle-phase-b` (from origin/main `1f061458`). `cd` in the SAME shell command as every git/npm invocation.

**Invariants (spec §3, unchanged from Phase A):** no NEW blur anywhere (the sidebar's existing `backdrop-filter` predates this phase — re-coloring it adds none); no new `infinite` animations; no selector renames; new raw color values only in tokens.css — CSS sweeps must REDUCE per-file lint:colors counts, TS sweeps swap literal-for-literal (count-neutral); the light-theme `--mac-*` block (macos-native.css:58-69) stays untouched (near-black identity is dark-only); the `[style*=...]`-keyed selectors (macos-native.css:1704-1769) target SystemDiagnostic inline styles this plan does not modify — leave them alone.

**Explicit deferral:** `--mac-accent` (#0a84ff, System Blue) has 17 consumers assuming light-text-on-accent contrast. Only the sidebar selection flips to Graphite in this phase; the button-accent flip needs a per-site contrast audit → Phase C. Recorded in the spec's Phase C bullet.

---

### Task B1: Token re-point + targeted chrome edits

**Files:**

- Modify: `src/styles/tokens.css` (one triplet addition)
- Modify: `src/styles/main.css` (:107, :1145-1157, :1346-1358, :6557)
- Modify: `src/styles/macos-native.css` (:26-27, :50-53, :176-179, :1078-1085, :1846-1854)

- [ ] **Step 1: tokens.css — add the red triplet** (after `--sev-critical-bg`):

```css
  --sev-critical-rgb: 255, 69, 58; /* rgba() composition twin for --sev-critical */
```

- [ ] **Step 2: main.css:107** — `--semantic-critical: #ff4444;` → `--semantic-critical: #ff453a;` (value-only; `getCSSColor` consumers in deck.gl/canvas read the var, no TS equality checks exist against the literal).

- [ ] **Step 3: main.css .panel (:1145)** — inside the existing rule add:

```css
  border-radius: var(--r-md);
  box-shadow: var(--e-1), var(--edge-highlight);
```

- [ ] **Step 4: main.css .panel-title (:1346)** — delete `text-transform: uppercase;` and change `letter-spacing: 1px;` → `letter-spacing: normal;`, `font-size: 11px;` → `font-size: 12px;` (titles come Title Case from panels.ts).

- [ ] **Step 5: main.css .panel-count (:1353)** — `border-radius: 2px;` → `border-radius: var(--r-pill);` and `padding: 2px 6px;` → `padding: 2px 8px;`.

- [ ] **Step 6: main.css .modal (:6557)** — add `border-radius: var(--r-xl); box-shadow: var(--e-4);`.

- [ ] **Step 7: macos-native.css dark token re-point:**

- `:26` `--mac-window-bg: #1c1c1e;` → `--mac-window-bg: var(--hs-bg-base);`
- `:27` `--mac-sidebar-bg: rgba(44, 44, 46, 0.72);` → `--mac-sidebar-bg: var(--mat-chrome-bg);`
- `:50` `--mac-card-bg: #2c2c2e;` → `--mac-card-bg: var(--mat-solid-2);`
- `:51` `--mac-card-border: rgba(255, 255, 255, 0.1);` → `rgba(255, 255, 255, 0.06);`
- `:52` `--mac-card-radius: 12px;` → `--mac-card-radius: var(--r-md);`
- `:53` `--mac-card-shadow: ...;` → `--mac-card-shadow: var(--e-2), var(--edge-highlight);`

- [ ] **Step 8: macos-native.css .mac-sidebar-item.active (:176)** — `background: var(--mac-accent);` → `background: var(--accent-selection);` (Graphite selection; `color: var(--text-primary)` already resolves to the new #f2f3f5).

- [ ] **Step 9: macos-native.css desktop panel title (:1078)** — delete `text-transform: uppercase;`, `letter-spacing: 0.03em;` → `letter-spacing: normal;`.

- [ ] **Step 10: macos-native.css --aid re-point (:1846-1854):**

- `--aid-radius-sm: 4px` → `var(--r-xs)`; `--aid-radius-md: 6px` → `var(--r-sm)`; `--aid-radius-lg: 8px` → `var(--r-md)`
- `--aid-shadow-card` → `var(--e-2), var(--edge-highlight)`; `--aid-shadow-elevated` → `var(--e-3), var(--edge-highlight)`
- `--aid-motion-fast: 100ms` → `var(--dur-fast)`; `--aid-motion-base: 140ms` → `var(--dur-base)`

- [ ] **Step 11: Gates + commit**

`cd <worktree> && npm run lint:colors && npm run typecheck:all && npm run test:homeshell 2>&1 | grep -E "^ℹ (pass|fail)"` → all green, then commit `feat(restyle): converge mac/aid dialect + classic chrome onto DL tokens` with the standard trailer.

### Task B2: Scripted sweeps — reds + small radii

- [ ] **Step 1: capture BEFORE counts** (for honest verification):

```bash
cd <worktree> && grep -rn "#d50000\|#f44336\|#ff4444\|rgba(213, *0, *0\|rgba(244, *67, *54\|rgba(255, *68, *68" src/ --include="*.ts" --include="*.css" | grep -v "__tests__\|\.test\." | wc -l
```

- [ ] **Step 2: CSS red sweep** (main.css, panels.css, any other src/styles/*.css with hits): `#d50000`→`var(--sev-critical)`, `#ff4444`→`var(--sev-critical)`, `#f44336`→`var(--status-error)`, `rgba(213, 0, 0,`→`rgba(var(--sev-critical-rgb),`, `rgba(244, 67, 54,`→`rgba(var(--sev-critical-rgb),`, `rgba(255, 68, 68,`→`rgba(var(--sev-critical-rgb),` (also no-space comma variants). EXCEPTION: skip tokens.css (none expected) and skip any hit inside a `var(--x, FALLBACK)` position only if replacing would nest var() illegally — none known.

- [ ] **Step 3: TS red sweep** (src/**/*.ts excluding tests): literal hue swap `#d50000`→`#ff453a`, `#ff4444`→`#ff453a`, `#f44336`→`#ff453a`, `rgba(213, 0, 0,`→`rgba(255, 69, 58,`, `rgba(244, 67, 54,`→`rgba(255, 69, 58,`, `rgba(255, 68, 68,`→`rgba(255, 69, 58,`. Literal-for-literal (canvas/deck.gl strings can't hold var()); lint counts unchanged.

- [ ] **Step 4: small-radius sweep** (main.css + panels.css only): exact-declaration sed `border-radius: 2px;`/`3px;`/`4px;` → `border-radius: var(--r-xs);`. Do NOT touch multi-value radii (`4px 4px 0 0`) — they're corner-specific.

- [ ] **Step 5: AFTER counts + gates.** Red-grep must return ~0 in src (allow deliberate survivors listed with justification); `lint:colors` must be green with counts DOWN; `npm run typecheck:all`; `npm run test:homeshell`; spot-run 2-3 component test suites that cover swept panels if they exist. Commit `feat(restyle): unify critical reds on systemRed; round micro-radii`.

### Task B3: Verify live + fix fallout

- [ ] e2e: `npx playwright test e2e/home-shell-boot.spec.ts` → 4 passed.
- [ ] Browser smoke via launch.json entry (port 3110, `--prefix .worktrees/apple-restyle-b`): classic view (`classicView=true` → reload) — verify panel radius/shadow/title case, sidebar selection graphite (toggle `is-desktop-macos`), modal radius; screenshot panels grid + sidebar; console clean of style errors. Fix anything broken (e.g., radius+overflow clipping, swept radius that looks wrong) in a follow-up commit.
- [ ] Full gates: typecheck, test:homeshell, lint:colors, docs:check, smoke:offline.

### Task B4: Finalize

- [ ] Spec §4: mark Phase B bullet `**[SHIPPED — this plan]**`; move the accent-flip deferral into the Phase C bullet.
- [ ] CLAUDE.md Home Shell section: extend the restyle sentence with Phase B.
- [ ] markdownlint the touched docs BEFORE pushing (`npx markdownlint-cli2 --fix <files>`) — static-lint failed on Phase A for this.
- [ ] Commit docs; rebase on origin/main; push; Codex `exec --sandbox read-only` rounds to PASS; PR with honest contiguous `cross-agent review: Codex` marker; expect auto-merge once up-to-date.

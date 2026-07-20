# Apple Restyle Phase C — Accent Flip + Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Apple design language: flip the accent from System Blue to Graphite per the contrast audit, finish the de-uppercase and motion-token work, harmonize God's Eye chrome, and verify idle CPU on the built app.

**Architecture:** Targeted edits driven by a completed per-site accent audit (12 consumers + 3 hover companions + 2 riding blue washes). Light theme gets dark-alpha accent overrides in the existing `body.is-desktop-macos:where([data-theme="light"]...)` block so near-white fills never sit on light surfaces.

**Worktree:** `/Users/bradleybond/Developer/crystalball/.worktrees/apple-restyle-c`, branch `claude/apple-restyle-phase-c` (from origin/main `e8a69167`). `cd` in the SAME shell command as every git/npm invocation.

**Invariants:** unchanged from Phases A/B (no new blur; no new `infinite` animations; no selector renames; raw colors only in tokens.css — white/black-alpha `rgba(255,255,255,x)`/`rgba(0,0,0,x)` washes and literal-for-literal swaps are lint-neutral; keep `!important` where it already fights inline styles).

**Consciously dropped:** a persisted screenshot-baseline suite — no CI e2e runner exists, so it would rot unexercised; PR smoke screenshots keep serving that role. Recorded in the spec.

---

### Task C1: Graphite accent flip (audit-driven)

**Files:** `src/styles/tokens.css`, `src/styles/macos-native.css`, `src/styles/main.css:18708-18715`, `src/components/CognitiveBiasDetectorPanel.ts:185-186`

Hover idiom for near-white primary buttons: keep `background: var(--accent-fill)` and add `opacity: 0.85` on hover (the existing `.mac-sidebar-update-btn:hover` pattern) — the "lighter blue on hover" idiom inverts badly on white.

- [ ] **Step 1 — light-theme safety first** (`macos-native.css`, inside the `body.is-desktop-macos:where([data-theme="light"], [data-theme="light"] *)` block at ~:58):

```css
  --accent-fill: rgba(0, 0, 0, 0.85);
  --accent-selection: rgba(0, 0, 0, 0.1);
```

- [ ] **Step 2 — the 11 flip sites** (audit table; file:line are pre-edit anchors):

1. `macos-native.css:705` `.mac-sidebar-update-btn` → `background: var(--accent-fill); color: var(--mac-window-bg);` (hover at :716 already `opacity:.85` — leave).
2. `macos-native.css:830-835` collapsed-sidebar toggle → `color: var(--mac-label); background: var(--accent-selection);` and hover wash `rgba(255, 255, 255, 0.22)` (replaces both hardcoded blue washes).
3. `macos-native.css:997` toolbar select focus → `border-color: var(--accent-fill);`
4. `macos-native.css:1193` global `:focus-visible` outline → `outline: 2px solid var(--accent-fill);`
5. `macos-native.css:1272` `.mac-sidebar-panel-dot` → `background: var(--accent-fill);` (solid vs hollow ring stays the on/off signal).
6. `macos-native.css:1520` `.key-dashboard-progress-bar` fill → `background: var(--accent-fill);` (light theme covered by Step 1).
7. `macos-native.css:1606` `.setup-wizard-signup` link → **KEEP blue** (flag with a comment: `/* deliberate: link affordance — white link would vanish into body text */`).
8. `macos-native.css:1624-1625` wizard input focus → `border-color: var(--accent-fill); box-shadow: 0 0 0 3px var(--accent-selection);`
9. `macos-native.css:1654-1660` wizard primary button → `background/border-color: var(--accent-fill); color: var(--mac-window-bg);` hover → keep fill + `opacity: 0.85`.
10. `macos-native.css:1743-1750` `.syd-self-test` → same treatment with the existing `!important`s retained; hover `opacity: 0.85 !important` (do not reorder the :1737 vs :1748 cascade).
11. `main.css:18708-18715` `.spm-btn--primary` → `background/border-color: var(--accent-fill); color: var(--mac-window-bg, var(--hs-bg-base));` hover → keep fill, `opacity: 0.85` (drop the `opacity: 1` reset).
12. `CognitiveBiasDetectorPanel.ts:185-186` active chip → bg `'var(--accent-selection,rgba(255,255,255,0.16))'`, fg `'var(--text-primary,#f2f3f5)'`.

- [ ] **Step 3:** grep `var(--mac-accent-hover` → must return ONLY the token definition (:40); grep `var(--mac-accent` consumers → only :1606 (the KEEP) remains. Gates (`lint:colors`, `typecheck:all`, `test:homeshell`), commit `feat(restyle): Graphite accent flip per contrast audit`.

### Task C2: last micro-label caps + settings glance

- [ ] Remove `text-transform: uppercase` (and normalize letter-spacing) from the four remaining macos-native.css sites: `.mac-mode-label` (~:201), `.setup-wizard-tier` (~:1586), and the two aid meta-label rules (~:1884, ~:2000).
- [ ] Settings glance: open UnifiedSettings styles only to confirm inputs/buttons inherit the swept radii; fix any straggler 2-4px radius or dashed border found there — nothing speculative.
- [ ] Gates + commit `feat(restyle): sentence-case the last micro-labels`.

### Task C3: motion tokens + God's Eye harmonization

- [ ] macos-native.css: the 22 literal-duration `transition:` declarations → `var(--dur-fast)`/`var(--dur-base)` + `var(--ease-out)` by nearest value (100-160ms→fast, 180-260ms→base). NO new transitions; property lists unchanged.
- [ ] main.css:~1156 `.panel { transition: transform 0.15s, box-shadow 0.15s }` → `transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)`.
- [ ] gods-eye-4d.css: micro-radius pass only (2-4px single-value radii → `var(--r-xs)`, 6-10px → nearest token where visually safe); hairline `rgba(255,255,255,>0.15)` borders → `0.1`. Light touch — the globe content itself is untouched.
- [ ] Gates + commit `feat(restyle): motion tokens + God's Eye chrome harmonization`.

### Task C4: verify + finalize

- [ ] e2e `home-shell-boot.spec.ts` → 4 passed.
- [ ] Browser smoke (launch entry port 3111): classic + shell; verify focus ring is near-white, wizard/self-test/storm-mode primary buttons render white-fill/dark-text, no blue remains except the flagged link; screenshots; console clean.
- [ ] Full gates + docs: spec §4 Phase C bullet → `**[SHIPPED — this plan; screenshot baseline consciously dropped (no CI e2e).]**`; CLAUDE.md restyle sentence → "Phases A-C complete"; markdownlint the docs.
- [ ] Rebase, push, Codex rounds to PASS, PR with honest contiguous `cross-agent review: Codex` marker.
- [ ] **Post-merge:** rebuild + install the app, then sample idle CPU of the WebContent process (compare against the ~58% open incident baseline — the restyle must not have regressed it; record the number in the PR or memory).

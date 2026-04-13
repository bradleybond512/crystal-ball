# Apple-Native Polish Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Crystal Ball's UI from functional to Apple-native premium across 6 phases — design tokens, motion system, visual hierarchy, alerts, map, and onboarding.

**Architecture:** Foundation-first. A new `design-system.css` defines all tokens (typography, spacing, color, elevation, motion). A `motion.css` + `motion.ts` pair provides animation primitives. Existing panels migrate gradually to tokens via `.cb-*` utility classes. Phases 4-6 (alerts, map, onboarding) run in parallel after the foundation is in place.

**Tech Stack:** CSS custom properties, CSS animations/transitions, vanilla TypeScript (no animation libraries), Web Audio API (sound design), DeckGL transitions prop, Cesium camera API.

**Spec:** `docs/superpowers/specs/2026-04-13-apple-native-polish-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/styles/design-system.css` | All design tokens (typography, spacing, color, elevation, radius, motion) + component primitives (`.cb-card`, `.cb-badge`, etc.) |
| `src/styles/motion.css` | Animation keyframes + transition utility classes |
| `src/services/motion.ts` | JS animation helpers: `staggerIn`, `crossfadeContent`, `animateNumber`, `animateIn`, `animateOut`, `revealContent` |
| `src/components/Toast.ts` | Toast notification component with stacking, auto-dismiss, severity tinting |
| `src/components/EmptyState.ts` | Reusable empty state component: icon + title + guidance + optional CTA |
| `src/components/WelcomeFlow.ts` | 3-step onboarding modal: location, interests, API keys |
| `src/components/ContextualHint.ts` | One-time tooltip hints for keyboard shortcuts |
| `src/services/sound.ts` | Web Audio API alert chimes — severity-mapped tones |
| `tests/design-system.test.mts` | Token validation tests |
| `tests/motion.test.mts` | Motion helper unit tests |
| `tests/toast.test.mts` | Toast component tests |
| `tests/empty-state.test.mts` | EmptyState component tests |
| `tests/sound.test.mts` | Sound service tests |
| `e2e/design-system.spec.ts` | E2E: tokens load, theme switch works |

### Modified Files

| File | Changes |
|------|---------|
| `src/styles/main.css` | Add `@import './design-system.css'` as first import; add `@import './motion.css'` second |
| `src/styles/panels.css` | Replace hardcoded colors/sizes with token references |
| `src/styles/alerts.css` | Add alert arrival/action animations, toast positioning |
| `src/styles/gods-vision.css` | HUD typography refinement, entry/exit transition classes |
| `src/components/Panel.ts` | Add skeleton support to base class, standardize header rendering |
| `src/components/UnifiedAlertInboxPanel.ts` | Alert arrival animation, acknowledge/snooze/pin/dismiss feedback |
| `src/components/TriageBar.ts` | Severity accent line, escalation bar, hover expand |
| `src/components/DeckGLMap.ts` | Layer transitions, view preset segmented control, cluster animation |
| `src/components/MapPopup.ts` | Apple Maps card redesign with glass morphism |
| `src/components/GlobeHUD.ts` | Typography split (SF Mono data / SF Pro labels), animateNumber |
| `src/components/GodsVisionView.ts` | Cinematic entry/exit transition choreography |
| `src/app/panel-layout.ts` | Integrate WelcomeFlow, ContextualHint |
| `src/services/mode-manager.ts` | Emit events for God's Vision entry/exit transition |

---

## Phase 1: Design System Foundation

### Task 1: Create design-system.css — Token Definitions

**Files:**
- Create: `src/styles/design-system.css`
- Modify: `src/styles/main.css:1-5`

- [ ] **Step 1: Create design-system.css with all token definitions**

```css
/* src/styles/design-system.css */
/* Crystal Ball Design System — Apple-Native Tokens */

:root {
  /* ── Typography ── */
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
  --font-mono: "SF Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace;

  --text-2xs: 10px;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;
  --text-2xl: 24px;

  --fw-regular: 400;
  --fw-medium: 500;
  --fw-semibold: 600;
  --fw-bold: 700;

  /* ── Spacing (4px grid) ── */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;

  /* ── Border Radius ── */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  /* ── Motion ── */
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-moderate: 350ms;
  --duration-slow: 500ms;

  --ease-default: cubic-bezier(0.25, 0.1, 0.25, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.55, 0, 1, 0.45);

  /* ── Surfaces (dark) ── */
  --surface-base: #0a0a0a;
  --surface-raised: #141414;
  --surface-overlay: #1c1c1e;
  --surface-popover: #2c2c2e;

  /* ── Interactive States ── */
  --accent: #3b82f6;
  --hover-bg: rgba(255, 255, 255, 0.06);
  --active-bg: rgba(255, 255, 255, 0.1);
  --focus-ring: 0 0 0 2px rgba(59, 130, 246, 0.5), 0 0 0 4px rgba(59, 130, 246, 0.15);

  /* ── Severity: Critical ── */
  --severity-critical: #ef4444;
  --severity-critical-bg: rgba(239, 68, 68, 0.1);
  --severity-critical-border: rgba(239, 68, 68, 0.25);
  --severity-critical-glow: rgba(239, 68, 68, 0.3);

  /* ── Severity: High ── */
  --severity-high: #f97316;
  --severity-high-bg: rgba(249, 115, 22, 0.1);
  --severity-high-border: rgba(249, 115, 22, 0.25);
  --severity-high-glow: rgba(249, 115, 22, 0.3);

  /* ── Severity: Elevated ── */
  --severity-elevated: #eab308;
  --severity-elevated-bg: rgba(234, 179, 8, 0.1);
  --severity-elevated-border: rgba(234, 179, 8, 0.25);
  --severity-elevated-glow: rgba(234, 179, 8, 0.3);

  /* ── Severity: Normal ── */
  --severity-normal: #3b82f6;
  --severity-normal-bg: rgba(59, 130, 246, 0.08);
  --severity-normal-border: rgba(59, 130, 246, 0.2);
  --severity-normal-glow: rgba(59, 130, 246, 0.2);

  /* ── Severity: Positive ── */
  --severity-positive: #22c55e;
  --severity-positive-bg: rgba(34, 197, 94, 0.08);
  --severity-positive-border: rgba(34, 197, 94, 0.2);
  --severity-positive-glow: rgba(34, 197, 94, 0.2);

  /* ── Elevation ── */
  --elevation-1: 0 1px 2px rgba(0, 0, 0, 0.3);
  --elevation-2: 0 4px 12px rgba(0, 0, 0, 0.4);
  --elevation-3: 0 8px 32px rgba(0, 0, 0, 0.5);
  --elevation-4: 0 16px 48px rgba(0, 0, 0, 0.6);

  --border-subtle: 1px solid rgba(255, 255, 255, 0.06);
  --border-medium: 1px solid rgba(255, 255, 255, 0.08);
  --border-strong: 1px solid rgba(255, 255, 255, 0.1);
  --border-accent: 1px solid rgba(59, 130, 246, 0.2);
}

/* ── Light theme overrides ── */
[data-theme="light"] {
  --surface-base: #f5f5f7;
  --surface-raised: #ffffff;
  --surface-overlay: #f2f2f7;
  --surface-popover: #ffffff;

  --hover-bg: rgba(0, 0, 0, 0.04);
  --active-bg: rgba(0, 0, 0, 0.08);

  --elevation-1: 0 1px 3px rgba(0, 0, 0, 0.08);
  --elevation-2: 0 4px 12px rgba(0, 0, 0, 0.1);
  --elevation-3: 0 8px 32px rgba(0, 0, 0, 0.12);
  --elevation-4: 0 16px 48px rgba(0, 0, 0, 0.15);

  --border-subtle: 1px solid rgba(0, 0, 0, 0.06);
  --border-medium: 1px solid rgba(0, 0, 0, 0.1);
  --border-strong: 1px solid rgba(0, 0, 0, 0.15);
}
```

- [ ] **Step 2: Add design-system.css import to main.css as first import**

In `src/styles/main.css`, add `@import './design-system.css';` as the very first line, before the existing `@import './rtl-overrides.css';`.

- [ ] **Step 3: Verify tokens load in dev**

Run: `npm run dev`
Open browser devtools, Elements, `<html>`, Computed, search `--surface-base`. Verify it shows `#0a0a0a`.

- [ ] **Step 4: Commit**

```bash
git add src/styles/design-system.css src/styles/main.css
git commit -m "feat: add design-system.css with Apple-native tokens

Typography, spacing, color, severity, elevation, motion tokens.
Light theme overrides. Imported as first CSS file.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Add Component Primitives to design-system.css

**Files:**
- Modify: `src/styles/design-system.css`

- [ ] **Step 1: Append component primitive classes**

Add to the end of `src/styles/design-system.css`:

```css
/* ══ Component Primitives ══ */

.cb-card {
  background: var(--surface-overlay);
  border: var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--elevation-1);
  transition: transform var(--duration-fast) var(--ease-default),
              box-shadow var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default);
}

.cb-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--elevation-2);
  border-color: rgba(255, 255, 255, 0.1);
}

.cb-card.selected {
  background: var(--severity-normal-bg);
  border-color: rgba(59, 130, 246, 0.2);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.15);
}

.cb-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-2);
  font-size: var(--text-2xs);
  font-weight: var(--fw-medium);
  border-radius: var(--radius-sm);
  line-height: 1.4;
}

.cb-badge[data-severity="critical"] {
  color: var(--severity-critical);
  background: var(--severity-critical-bg);
  border: 1px solid var(--severity-critical-border);
}

.cb-badge[data-severity="high"] {
  color: var(--severity-high);
  background: var(--severity-high-bg);
  border: 1px solid var(--severity-high-border);
}

.cb-badge[data-severity="elevated"] {
  color: var(--severity-elevated);
  background: var(--severity-elevated-bg);
  border: 1px solid var(--severity-elevated-border);
}

.cb-badge[data-severity="normal"] {
  color: var(--severity-normal);
  background: var(--severity-normal-bg);
  border: 1px solid var(--severity-normal-border);
}

.cb-badge[data-severity="positive"] {
  color: var(--severity-positive);
  background: var(--severity-positive-bg);
  border: 1px solid var(--severity-positive-border);
}

.cb-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  font-family: var(--font-ui);
  border-radius: var(--radius-md);
  border: var(--border-medium);
  background: rgba(255, 255, 255, 0.04);
  color: #aaa;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default),
              transform var(--duration-fast) var(--ease-default);
}

.cb-button:hover {
  background: var(--hover-bg);
}

.cb-button:active {
  transform: scale(0.97);
}

.cb-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.cb-button.accent {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}

.cb-button.accent:hover {
  background: #2563eb;
}

.cb-list-row {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background var(--duration-fast) var(--ease-default),
              transform var(--duration-fast) var(--ease-default);
}

.cb-list-row:hover {
  background: var(--hover-bg);
  transform: translateY(-1px);
}

.cb-list-row:active {
  transform: scale(0.99);
  background: var(--active-bg);
}

.cb-separator {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: var(--space-2) var(--space-4);
}

[data-theme="light"] .cb-separator {
  background: rgba(0, 0, 0, 0.06);
}

.cb-skeleton {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 25%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.04) 75%
  );
  background-size: 200% 100%;
  animation: cb-shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}

@keyframes cb-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

[data-theme="light"] .cb-skeleton {
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.04) 25%,
    rgba(0, 0, 0, 0.08) 50%,
    rgba(0, 0, 0, 0.04) 75%
  );
  background-size: 200% 100%;
}

.cb-pill-group {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: var(--radius-md);
}

.cb-pill-group button {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-2xs);
  font-weight: var(--fw-medium);
  font-family: var(--font-ui);
  color: #888;
  background: transparent;
  border: none;
  border-radius: calc(var(--radius-md) - 2px);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default);
}

.cb-pill-group button.active {
  background: rgba(255, 255, 255, 0.1);
  color: #e5e5e5;
  font-weight: var(--fw-semibold);
}

.cb-pill-group button:hover:not(.active) {
  background: rgba(255, 255, 255, 0.06);
  color: #bbb;
}

/* ── Focus Ring Global ── */
*:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* ── Scrollbar ── */
::-webkit-scrollbar {
  width: 4px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
  width: 6px;
}

[data-theme="light"] ::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
}

[data-theme="light"] ::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}
```

- [ ] **Step 2: Verify primitives render in dev**

Run: `npm run dev`
In browser devtools console:
```js
document.body.insertAdjacentHTML('beforeend', '<div class="cb-card" style="padding:16px;margin:16px;">Test card</div>');
```
Verify: card appears with dark background, subtle border, shadow. Hover lifts it.

- [ ] **Step 3: Commit**

```bash
git add src/styles/design-system.css
git commit -m "feat: add component primitives to design system

.cb-card, .cb-badge, .cb-button, .cb-list-row, .cb-separator,
.cb-skeleton, .cb-pill-group. Focus ring and scrollbar globals.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Write Token Validation Tests

**Files:**
- Create: `tests/design-system.test.mts`

- [ ] **Step 1: Write tests that validate token definitions exist**

```typescript
// tests/design-system.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(import.meta.dirname, '../src/styles/design-system.css'), 'utf-8');

describe('design-system.css tokens', () => {
  const requiredTokens = [
    '--font-ui', '--font-mono',
    '--text-2xs', '--text-xs', '--text-sm', '--text-base',
    '--text-md', '--text-lg', '--text-xl', '--text-2xl',
    '--fw-regular', '--fw-medium', '--fw-semibold', '--fw-bold',
    '--space-1', '--space-2', '--space-3', '--space-4',
    '--space-6', '--space-8', '--space-12', '--space-16',
    '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
    '--duration-fast', '--duration-normal', '--duration-moderate', '--duration-slow',
    '--ease-default', '--ease-spring', '--ease-out', '--ease-in',
    '--surface-base', '--surface-raised', '--surface-overlay', '--surface-popover',
    '--accent', '--hover-bg', '--active-bg', '--focus-ring',
    '--elevation-1', '--elevation-2', '--elevation-3', '--elevation-4',
    '--border-subtle', '--border-medium', '--border-strong',
  ];

  for (const token of requiredTokens) {
    it(`defines ${token}`, () => {
      assert.ok(css.includes(`${token}:`), `Missing token: ${token}`);
    });
  }

  const severityLevels = ['critical', 'high', 'elevated', 'normal', 'positive'];
  const severityVariants = ['', '-bg', '-border', '-glow'];

  for (const level of severityLevels) {
    for (const variant of severityVariants) {
      const token = `--severity-${level}${variant}`;
      it(`defines ${token}`, () => {
        assert.ok(css.includes(`${token}:`), `Missing severity token: ${token}`);
      });
    }
  }

  it('includes light theme overrides', () => {
    assert.ok(css.includes('[data-theme="light"]'), 'Missing light theme selector');
  });

  it('includes shimmer keyframe', () => {
    assert.ok(css.includes('@keyframes cb-shimmer'), 'Missing shimmer animation');
  });
});

describe('design-system.css component primitives', () => {
  const requiredClasses = [
    '.cb-card', '.cb-badge', '.cb-button', '.cb-list-row',
    '.cb-separator', '.cb-skeleton', '.cb-pill-group',
  ];

  for (const cls of requiredClasses) {
    it(`defines ${cls}`, () => {
      assert.ok(css.includes(cls), `Missing class: ${cls}`);
    });
  }

  it('defines severity badge variants', () => {
    for (const level of ['critical', 'high', 'elevated', 'normal', 'positive']) {
      assert.ok(
        css.includes(`[data-severity="${level}"]`),
        `Missing badge variant: ${level}`,
      );
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/design-system.test.mts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/design-system.test.mts
git commit -m "test: add design system token validation tests

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 2: Transitions & Motion System

### Task 4: Create motion.css — Animation Keyframes and Utility Classes

**Files:**
- Create: `src/styles/motion.css`
- Modify: `src/styles/main.css:1-5`

- [ ] **Step 1: Create motion.css**

```css
/* src/styles/motion.css */

@keyframes cb-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes cb-slide-down {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes cb-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes cb-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes cb-scale-in {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes cb-scale-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.98); }
}

@keyframes cb-slide-in-right {
  from { opacity: 0; transform: translateX(100%); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes cb-slide-out-right {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(100%); }
}

@keyframes cb-pulse-scale {
  0% { transform: scale(1); }
  50% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

@keyframes cb-ripple {
  from { transform: scale(1); opacity: 0.4; }
  to { transform: scale(2.5); opacity: 0; }
}

/* ══ Utility Classes ══ */

@media (prefers-reduced-motion: no-preference) {
  .cb-animate-slide-up { animation: cb-slide-up var(--duration-moderate) var(--ease-out) both; }
  .cb-animate-slide-down { animation: cb-slide-down var(--duration-moderate) var(--ease-out) both; }
  .cb-animate-fade-in { animation: cb-fade-in var(--duration-normal) var(--ease-default) both; }
  .cb-animate-fade-out { animation: cb-fade-out var(--duration-normal) var(--ease-in) both; }
  .cb-animate-scale-in { animation: cb-scale-in var(--duration-moderate) var(--ease-out) both; }
  .cb-animate-scale-out { animation: cb-scale-out var(--duration-normal) var(--ease-in) both; }
  .cb-animate-slide-in-right { animation: cb-slide-in-right var(--duration-moderate) var(--ease-spring) both; }
  .cb-animate-slide-out-right { animation: cb-slide-out-right var(--duration-normal) var(--ease-in) both; }
  .cb-animate-pulse { animation: cb-pulse-scale var(--duration-moderate) var(--ease-spring); }
  .cb-stagger-item { animation: cb-slide-up var(--duration-moderate) var(--ease-out) both; }
}

@media (prefers-reduced-motion: reduce) {
  .cb-animate-slide-up, .cb-animate-slide-down, .cb-animate-scale-in,
  .cb-animate-slide-in-right, .cb-stagger-item { animation: cb-fade-in 1ms both; }
  .cb-animate-fade-out, .cb-animate-scale-out, .cb-animate-slide-out-right { animation: cb-fade-out 1ms both; }
  .cb-animate-pulse { animation: none; }
}

body.animations-paused .cb-animate-slide-up,
body.animations-paused .cb-animate-slide-down,
body.animations-paused .cb-animate-fade-in,
body.animations-paused .cb-animate-fade-out,
body.animations-paused .cb-animate-scale-in,
body.animations-paused .cb-animate-scale-out,
body.animations-paused .cb-animate-slide-in-right,
body.animations-paused .cb-animate-slide-out-right,
body.animations-paused .cb-animate-pulse,
body.animations-paused .cb-stagger-item { animation: none !important; }

/* ══ Modal / Overlay ══ */

.cb-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 9998;
}

.cb-modal-content { z-index: 9999; }

@media (prefers-reduced-motion: no-preference) {
  .cb-backdrop { animation: cb-fade-in var(--duration-normal) var(--ease-default) both; }
  .cb-backdrop.closing { animation: cb-fade-out var(--duration-normal) var(--ease-in) both; }
  .cb-modal-content { animation: cb-scale-in var(--duration-moderate) var(--ease-out) both; }
  .cb-modal-content.closing { animation: cb-scale-out var(--duration-normal) var(--ease-in) both; }
}
```

- [ ] **Step 2: Add motion.css import to main.css as second import**

In `src/styles/main.css`, add `@import './motion.css';` after `design-system.css`, before `rtl-overrides.css`.

- [ ] **Step 3: Commit**

```bash
git add src/styles/motion.css src/styles/main.css
git commit -m "feat: add motion.css — keyframes and animation utilities

Panel lifecycle, modal, toast, stagger, pulse animations.
Respects prefers-reduced-motion and body.animations-paused.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Create motion.ts — JavaScript Animation Helpers

**Files:**
- Create: `src/services/motion.ts`
- Create: `tests/motion.test.mts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/motion.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(import.meta.dirname, '../src/services/motion.ts'), 'utf-8');

describe('motion.ts exports', () => {
  const requiredExports = [
    'staggerIn', 'crossfadeContent', 'animateNumber',
    'animateIn', 'animateOut', 'revealContent', 'prefersReducedMotion',
  ];

  for (const name of requiredExports) {
    it(`exports ${name}`, () => {
      assert.ok(
        src.includes(`export function ${name}`) || src.includes(`export const ${name}`),
        `Missing export: ${name}`,
      );
    });
  }

  it('checks prefers-reduced-motion', () => {
    assert.ok(src.includes('prefers-reduced-motion'), 'Must check reduced motion preference');
  });

  it('checks body.animations-paused', () => {
    assert.ok(src.includes('animations-paused'), 'Must respect animations-paused class');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/motion.test.mts`
Expected: FAIL (file doesn't exist)

- [ ] **Step 3: Create motion.ts**

```typescript
// src/services/motion.ts

const STAGGER_DELAY_MS = 30;
const STAGGER_MAX_ITEMS = 10;

export function prefersReducedMotion(): boolean {
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.body.classList.contains('animations-paused')
  );
}

export function staggerIn(
  container: Element,
  selector: string,
  delay: number = STAGGER_DELAY_MS,
): void {
  if (prefersReducedMotion()) return;
  const items = container.querySelectorAll(selector);
  const count = Math.min(items.length, STAGGER_MAX_ITEMS);
  for (let i = 0; i < count; i++) {
    const el = items[i] as HTMLElement;
    el.classList.add('cb-stagger-item');
    el.style.animationDelay = `${i * delay}ms`;
  }
}

export function crossfadeContent(panel: HTMLElement, newHTML: string): Promise<void> {
  if (prefersReducedMotion()) {
    panel.textContent = '';
    const temp = document.createElement('div');
    temp.insertAdjacentHTML('afterbegin', newHTML);
    while (temp.firstChild) panel.appendChild(temp.firstChild);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    panel.classList.add('cb-animate-fade-out');
    panel.addEventListener('animationend', function handler() {
      panel.removeEventListener('animationend', handler);
      panel.classList.remove('cb-animate-fade-out');
      panel.textContent = '';
      const temp = document.createElement('div');
      temp.insertAdjacentHTML('afterbegin', newHTML);
      while (temp.firstChild) panel.appendChild(temp.firstChild);
      panel.classList.add('cb-animate-fade-in');
      panel.addEventListener('animationend', function handler2() {
        panel.removeEventListener('animationend', handler2);
        panel.classList.remove('cb-animate-fade-in');
        resolve();
      }, { once: true });
    }, { once: true });
  });
}

export function animateNumber(
  el: Element, from: number, to: number, duration: number = 300,
): void {
  if (prefersReducedMotion() || from === to) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const range = to - from;
  function step(now: number) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = String(Math.round(from + range * eased));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function animateIn(
  el: HTMLElement, animation: 'slide-up' | 'fade' | 'scale' = 'slide-up',
): Promise<void> {
  if (prefersReducedMotion()) {
    el.style.opacity = '1';
    return Promise.resolve();
  }
  const classMap = {
    'slide-up': 'cb-animate-slide-up',
    'fade': 'cb-animate-fade-in',
    'scale': 'cb-animate-scale-in',
  };
  return new Promise((resolve) => {
    el.classList.add(classMap[animation]);
    el.addEventListener('animationend', () => {
      el.classList.remove(classMap[animation]);
      resolve();
    }, { once: true });
  });
}

export function animateOut(
  el: HTMLElement, animation: 'fade' | 'scale-down' = 'fade',
): Promise<void> {
  if (prefersReducedMotion()) {
    el.style.opacity = '0';
    return Promise.resolve();
  }
  const classMap = {
    'fade': 'cb-animate-fade-out',
    'scale-down': 'cb-animate-scale-out',
  };
  return new Promise((resolve) => {
    el.classList.add(classMap[animation]);
    el.addEventListener('animationend', () => {
      el.classList.remove(classMap[animation]);
      resolve();
    }, { once: true });
  });
}

export function revealContent(skeleton: HTMLElement, content: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) {
    skeleton.style.display = 'none';
    content.style.display = '';
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    skeleton.classList.add('cb-animate-fade-out');
    skeleton.addEventListener('animationend', () => {
      skeleton.style.display = 'none';
      skeleton.classList.remove('cb-animate-fade-out');
      content.style.display = '';
      content.classList.add('cb-animate-fade-in');
      content.addEventListener('animationend', () => {
        content.classList.remove('cb-animate-fade-in');
        resolve();
      }, { once: true });
    }, { once: true });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/motion.test.mts`
Expected: All PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add src/services/motion.ts tests/motion.test.mts
git commit -m "feat: add motion.ts — JS animation helpers

staggerIn, crossfadeContent, animateNumber, animateIn, animateOut,
revealContent. All respect prefers-reduced-motion and animations-paused.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 3: Visual Hierarchy & Typography

### Task 6: Standardize Panel Header in Base Class

**Files:**
- Modify: `src/components/Panel.ts`

- [ ] **Step 1: Read Panel.ts to understand current header rendering**

Read the full `src/components/Panel.ts` file to find where the panel header (title) is rendered. Identify the method that creates the header DOM. Note the current structure.

- [ ] **Step 2: Add a `renderHeader()` method that uses design tokens**

Add a protected method to the Panel class that returns a standardized header element:

```typescript
protected renderHeader(opts: {
  subtitle?: string;
  freshness?: { dotColor?: string; label?: string };
  rightSlot?: HTMLElement;
}): HTMLElement {
  const header = document.createElement('div');
  header.className = 'cb-panel-header';
  header.style.cssText = `
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: var(--space-3) var(--space-4);
  `;

  const left = document.createElement('div');
  const title = document.createElement('div');
  title.style.cssText = `
    font-size: var(--text-base); font-weight: var(--fw-semibold);
    color: #e5e5e5; letter-spacing: -0.01em;
  `;
  title.textContent = this.options.title;
  left.appendChild(title);

  if (opts.subtitle) {
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size: var(--text-xs); color: #666; margin-top: 2px;';
    sub.textContent = opts.subtitle;
    left.appendChild(sub);
  }

  header.appendChild(left);

  if (opts.freshness) {
    const right = document.createElement('div');
    right.style.cssText = 'display: flex; align-items: center; gap: 4px;';
    const dot = document.createElement('div');
    dot.style.cssText = `width: 6px; height: 6px; border-radius: 50%; background: ${opts.freshness.dotColor || '#22c55e'};`;
    right.appendChild(dot);
    const label = document.createElement('span');
    label.style.cssText = 'font-size: var(--text-2xs); color: #666;';
    label.textContent = opts.freshness.label || '';
    right.appendChild(label);
    header.appendChild(right);
  } else if (opts.rightSlot) {
    header.appendChild(opts.rightSlot);
  }

  return header;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add src/components/Panel.ts
git commit -m "feat: add renderHeader() to Panel base class

Standardized panel header with title/subtitle/freshness indicator.
Opt-in method for gradual adoption.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Migrate Top Panels to Design Tokens

**Files:**
- Modify: `src/components/UnifiedAlertInboxPanel.ts`
- Modify: `src/components/TriageBar.ts`
- Modify: `src/styles/panels.css`

- [ ] **Step 1: Read current panel files to identify hardcoded values**

Read each file, searching for hardcoded colors (`#1c1c1e`, `#ef4444`, `rgba(239,68,68`), font sizes (`12px`, `13px`), spacing (`padding: 8px`), and border-radius values.

- [ ] **Step 2: Replace hardcoded values in panels.css with token references**

For each hardcoded value, replace with `var(--token)`:
- `background: #1c1c1e` becomes `background: var(--surface-overlay)`
- `font-size: 12px` becomes `font-size: var(--text-sm)`
- `padding: 8px 16px` becomes `padding: var(--space-2) var(--space-4)`
- `border-radius: 8px` becomes `border-radius: var(--radius-md)`
- `color: #ef4444` becomes `color: var(--severity-critical)`

- [ ] **Step 3: Add .cb-badge to severity indicators in UnifiedAlertInboxPanel.ts**

Find severity label rendering. Replace with `<span class="cb-badge" data-severity="${level}">` elements.

- [ ] **Step 4: Add .cb-list-row to alert row items in UnifiedAlertInboxPanel.ts**

Find alert row rendering. Add `cb-list-row` class to each row element.

- [ ] **Step 5: Verify visually in dev**

Run: `npm run dev`
Open Alert Inbox. Verify severity badges use correct colors, row hover shows lift.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 7: Commit**

```bash
git add src/components/UnifiedAlertInboxPanel.ts src/components/TriageBar.ts src/styles/panels.css
git commit -m "refactor: migrate alert panels to design system tokens

Replace hardcoded colors, spacing, severity indicators with tokens
and .cb-badge/.cb-list-row classes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 4: Alert & Notification UX

### Task 8: Create Toast Component

**Files:**
- Create: `src/components/Toast.ts`
- Create: `tests/toast.test.mts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/toast.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(import.meta.dirname, '../src/components/Toast.ts'), 'utf-8');

describe('Toast component', () => {
  it('exports Toast class', () => {
    assert.ok(src.includes('export class Toast'), 'Must export Toast class');
  });

  it('exports showToast function', () => {
    assert.ok(src.includes('export function showToast'), 'Must export showToast');
  });

  it('supports severity levels', () => {
    for (const s of ['critical', 'high', 'elevated']) {
      assert.ok(src.includes(s), `Must support ${s} severity`);
    }
  });

  it('implements auto-dismiss', () => {
    assert.ok(src.includes('setTimeout'), 'Must implement auto-dismiss timer');
  });

  it('respects Ghost Mode', () => {
    assert.ok(src.includes('isGhostMode'), 'Must check Ghost Mode');
  });

  it('limits stack size', () => {
    assert.ok(src.includes('MAX_TOASTS'), 'Must limit toast stack');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/toast.test.mts`
Expected: FAIL

- [ ] **Step 3: Create Toast.ts**

Create `src/components/Toast.ts` with:
- `Toast` class with show/dismiss/pause/resume methods
- `showToast()` convenience function
- Glass morphism styling using design tokens
- Severity-tinted border and progress bar
- Auto-dismiss: 8s normal, 15s critical
- Hover pauses timer
- Max 3 stacked, older dismissed
- Ghost Mode suppression via `isGhostMode()`
- Uses `animateIn`/`animateOut` from motion.ts

Build all DOM using `document.createElement` and `textContent` — no `innerHTML`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/toast.test.mts`
Expected: All PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add src/components/Toast.ts tests/toast.test.mts
git commit -m "feat: add Toast notification component

Glass morphism, severity tinting, auto-dismiss with progress bar,
hover-to-pause, max 3 stacked. Suppressed in Ghost Mode.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Create Sound Service

**Files:**
- Create: `src/services/sound.ts`
- Create: `tests/sound.test.mts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/sound.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(import.meta.dirname, '../src/services/sound.ts'), 'utf-8');

describe('sound service', () => {
  it('exports playAlertSound', () => {
    assert.ok(src.includes('export function playAlertSound'));
  });

  it('exports playAckSound', () => {
    assert.ok(src.includes('export function playAckSound'));
  });

  it('uses Web Audio API', () => {
    assert.ok(src.includes('AudioContext'));
  });

  it('respects Ghost Mode', () => {
    assert.ok(src.includes('isGhostMode'));
  });

  it('rate-limits sounds', () => {
    assert.ok(src.includes('MIN_INTERVAL'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sound.test.mts`
Expected: FAIL

- [ ] **Step 3: Create sound.ts**

Create `src/services/sound.ts` with:
- `playAlertSound(severity: 'critical' | 'high' | 'elevated')` — Web Audio synthesis
- `playAckSound()` — descending two-tone
- Critical: C5 to E5 rising chime (300ms)
- High: G4 single tone (200ms)
- Elevated: 800Hz tap (50ms)
- Ack: E4 to C4 descending (150ms)
- Rate limit: `MIN_INTERVAL_MS = 3000`
- Ghost Mode suppression
- Volume from `localStorage cb:sound-volume` (default 0.3)
- Enabled check from `localStorage cb:sound-enabled`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/sound.test.mts`
Expected: All PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add src/services/sound.ts tests/sound.test.mts
git commit -m "feat: add Web Audio API sound service for alerts

Severity-mapped chimes, ack sound, rate-limited 3s, Ghost Mode suppressed.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Add Alert Action Animations

**Files:**
- Modify: `src/components/UnifiedAlertInboxPanel.ts`
- Modify: `src/styles/alerts.css`

- [ ] **Step 1: Read UnifiedAlertInboxPanel.ts action handlers**

Read the file, find acknowledge, snooze, pin, dismiss handler methods.

- [ ] **Step 2: Add alert action CSS to alerts.css**

Append to `src/styles/alerts.css`:

```css
@media (prefers-reduced-motion: no-preference) {
  .alert-row-ack { animation: cb-alert-ack 200ms var(--ease-default) both; }
  .alert-row-dismiss { animation: cb-alert-dismiss 200ms var(--ease-in) both; }
  .alert-row-snooze { animation: cb-alert-snooze 200ms var(--ease-default) both; }
  .alert-row-arrive { animation: cb-slide-down var(--duration-moderate) var(--ease-out) both; }
}

@keyframes cb-alert-ack {
  0% { background: transparent; }
  30% { background: var(--severity-positive-bg); }
  100% { background: transparent; }
}

@keyframes cb-alert-dismiss {
  to { opacity: 0; transform: translateX(40px); max-height: 0;
       padding-top: 0; padding-bottom: 0; overflow: hidden; }
}

@keyframes cb-alert-snooze {
  0% { transform: translateX(0); }
  30% { transform: translateX(6px); }
  100% { transform: translateX(0); }
}
```

- [ ] **Step 3: Wire animations into action handlers**

- Acknowledge: add `alert-row-ack` class, import and call `playAckSound()`
- Dismiss: add `alert-row-dismiss` class, wait for `animationend` before DOM removal
- Snooze: add `alert-row-snooze` class
- New arrival: add `alert-row-arrive` class when inserting at list top

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 5: Commit**

```bash
git add src/components/UnifiedAlertInboxPanel.ts src/styles/alerts.css
git commit -m "feat: add alert action animations and sound feedback

Ack: green flash + sound. Dismiss: slide-right fade. Snooze: nudge.
New arrival: slide-down entry.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Enhance Triage Bar

**Files:**
- Modify: `src/components/TriageBar.ts`
- Modify: `src/styles/alerts.css`

- [ ] **Step 1: Read TriageBar.ts render method**

Read the full file. Identify where triage items are rendered and severity/lifecycle displayed.

- [ ] **Step 2: Add triage bar CSS to alerts.css**

```css
.triage-bar-item { position: relative; transition: transform var(--duration-fast) var(--ease-default); }

.triage-bar-item.hottest::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
}
.triage-bar-item.hottest[data-severity="critical"]::before { background: var(--severity-critical); }
.triage-bar-item.hottest[data-severity="high"]::before { background: var(--severity-high); }
.triage-bar-item.hottest[data-severity="elevated"]::before { background: var(--severity-elevated); }
```

- [ ] **Step 3: Add hottest class and data-severity to first triage item**

In the render method, add class `hottest` and `data-severity` attribute to the first item.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 5: Commit**

```bash
git add src/components/TriageBar.ts src/styles/alerts.css
git commit -m "feat: add severity accent line to triage bar hottest item

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 5: Map & Data Visualization

### Task 12: Redesign MapPopup as Apple Maps Card

**Files:**
- Modify: `src/components/MapPopup.ts`

- [ ] **Step 1: Read MapPopup.ts to understand current rendering**

Read the first 200 lines and main render method.

- [ ] **Step 2: Create glass-morphism card wrapper method**

Add a private method that wraps popup content:

```typescript
private wrapInCard(content: HTMLElement): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = `
    background: rgba(28, 28, 30, 0.92);
    backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-xl);
    box-shadow: var(--elevation-3), 0 0 0 0.5px rgba(255, 255, 255, 0.05);
    overflow: hidden; max-width: 280px; font-family: var(--font-ui);
  `;
  card.appendChild(content);
  return card;
}
```

- [ ] **Step 3: Update primary popup types to use new card style**

For earthquake, hotspot, conflict, base popups: restructure as title/subtitle header + 2-col stat grid + action button bar using `.cb-button` class. Use `textContent` for all text — no `innerHTML`.

- [ ] **Step 4: Verify visually**

Run: `npm run dev`, click a map marker, verify glass morphism popup appears.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add src/components/MapPopup.ts
git commit -m "feat: redesign map popups as Apple Maps glass cards

Glass morphism, severity badge, stat grid, action buttons.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 13: Add Layer Transitions to DeckGLMap

**Files:**
- Modify: `src/components/DeckGLMap.ts`

- [ ] **Step 1: Read DeckGLMap.ts to find layer creation**

Search for `new ScatterplotLayer`, `new GeoJsonLayer` to find layer instantiation.

- [ ] **Step 2: Add DeckGL transitions prop to scatterplot layers**

```typescript
transitions: {
  getPosition: { duration: 400, easing: (t: number) => 1 - Math.pow(1 - t, 3) },
  getRadius: { duration: 400, easing: (t: number) => 1 - Math.pow(1 - t, 3) },
  getFillColor: { duration: 300 },
},
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add src/components/DeckGLMap.ts
git commit -m "feat: add DeckGL layer transitions for smooth data updates

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 14: Add View Preset Segmented Control

**Files:**
- Modify: `src/components/DeckGLMap.ts`

- [ ] **Step 1: Find current view preset UI**

Search for region preset buttons (Global, Americas, MENA, EU, Asia, Africa).

- [ ] **Step 2: Replace with .cb-pill-group**

Replace current buttons with a `.cb-pill-group` container. Active preset gets `.active` class.

- [ ] **Step 3: Add cinematic flyTo**

Update flyTo calls: `duration: 1500`, slight bearing (random +-15), pitch 45 on zoom-in.

- [ ] **Step 4: Apply same to time range selector**

Replace time range buttons (1h, 6h, 24h, 7d, All) with `.cb-pill-group`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add src/components/DeckGLMap.ts
git commit -m "feat: Apple-style segmented controls for map presets

View preset and time range selectors use .cb-pill-group.
Cinematic flyTo with bearing and pitch.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 6: Empty States, Onboarding & God's Vision

### Task 15: Create EmptyState Component

**Files:**
- Create: `src/components/EmptyState.ts`
- Create: `tests/empty-state.test.mts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/empty-state.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(import.meta.dirname, '../src/components/EmptyState.ts'), 'utf-8');

describe('EmptyState component', () => {
  it('exports renderEmptyState function', () => {
    assert.ok(src.includes('export function renderEmptyState'));
  });
  it('exports getEmptyStateDefaults function', () => {
    assert.ok(src.includes('export function getEmptyStateDefaults'));
  });
  it('exports EmptyState class', () => {
    assert.ok(src.includes('export class EmptyState'));
  });
  it('supports icon, title, message', () => {
    assert.ok(src.includes('icon') && src.includes('title') && src.includes('message'));
  });
  it('supports optional CTA button', () => {
    assert.ok(src.includes('cta'));
  });
  it('has category defaults', () => {
    for (const cat of ['geopolitical', 'infrastructure', 'cyber', 'markets', 'weather']) {
      assert.ok(src.includes(cat), `Missing category: ${cat}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/empty-state.test.mts`
Expected: FAIL

- [ ] **Step 3: Create EmptyState.ts**

Create `src/components/EmptyState.ts` with:
- `renderEmptyState(options)` — returns HTMLElement with icon (28px, 0.4 opacity), title (--text-base/--fw-medium), message (--text-xs, muted), optional `.cb-button.accent` CTA
- `getEmptyStateDefaults(category)` — returns defaults for: geopolitical, infrastructure, cyber, markets, weather, user, alerts
- `EmptyState` class with mount/unmount methods
- All DOM built with `createElement`/`textContent` — no `innerHTML`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/empty-state.test.mts`
Expected: All PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add src/components/EmptyState.ts tests/empty-state.test.mts
git commit -m "feat: add EmptyState component with category defaults

Icon + title + guidance + optional CTA. Templates for 7 panel categories.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 16: Create WelcomeFlow Onboarding Modal

**Files:**
- Create: `src/components/WelcomeFlow.ts`

- [ ] **Step 1: Create WelcomeFlow.ts**

Create `src/components/WelcomeFlow.ts` with:
- `WelcomeFlow` class with `show()` and `shouldShow()` static method
- 3-step modal: Location (GPS toggle), Interests (pill picker), API Keys (list with free/paid labels)
- Progress dots at top, "Continue" button per step, "Skip for now" on API keys step
- Callbacks: `onLocationSet`, `onInterestsSet`, `onComplete`
- Stores `cb:onboarding-complete` in localStorage
- Uses `.cb-backdrop` + `.cb-modal-content` from motion.css
- Uses `animateIn`/`animateOut` from motion.ts
- All DOM built with `createElement`/`textContent` — no `innerHTML`
- Default interests pre-selected: Geopolitical, Weather

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add src/components/WelcomeFlow.ts
git commit -m "feat: add WelcomeFlow 3-step onboarding modal

Location, Interests, API Keys. Progress dots, skip option.
Uses motion system for entry/exit animations.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 17: Create ContextualHint Component

**Files:**
- Create: `src/components/ContextualHint.ts`

- [ ] **Step 1: Create ContextualHint.ts**

Create `src/components/ContextualHint.ts` with:
- `showHint(config)` — shows glass morphism tooltip near target element
- `HINTS` object with predefined hints: `alertNavigation`, `godsVision`, `ghostMode`
- One-time per `id`, stored in `cb:hints-seen` (Set serialized to JSON array in localStorage)
- Auto-dismiss after 8s, "Got it" dismiss button
- Position relative to target (top or bottom)
- Uses `animateIn`/`animateOut` from motion.ts
- All DOM built with `createElement`/`textContent` — no `innerHTML`

For the keyboard shortcut hints, use `<kbd>` elements created via `createElement('kbd')` with inline styles for the key cap look.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ContextualHint.ts
git commit -m "feat: add ContextualHint one-time tooltip component

Glass morphism tooltips, auto-dismiss 8s, per-hint localStorage tracking.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 18: Add God's Vision Entry/Exit Transition

**Files:**
- Modify: `src/components/GodsVisionView.ts`
- Modify: `src/components/GlobeHUD.ts`
- Modify: `src/styles/gods-vision.css`

- [ ] **Step 1: Read GodsVisionView.ts enter/exit methods**

Read the file, find the method that activates/deactivates God's Vision mode.

- [ ] **Step 2: Add transition CSS to gods-vision.css**

Append:

```css
@media (prefers-reduced-motion: no-preference) {
  .ge-entering .ge-globe-container { animation: cb-fade-in 500ms var(--ease-out) 200ms both; }
  .ge-entering .ge-hud-element { animation: cb-slide-up var(--duration-moderate) var(--ease-out) both; }
  .ge-exiting .ge-globe-container { animation: cb-fade-out 300ms var(--ease-in) both; }
  .ge-exiting .ge-hud-element { animation: cb-fade-out 200ms var(--ease-in) both; }
}
```

- [ ] **Step 3: Add staggered HUD entry to GodsVisionView.ts**

In the enter method, after globe init:

```typescript
const hudElements = this.container.querySelectorAll('.ge-hud-element');
hudElements.forEach((el, i) => {
  (el as HTMLElement).style.animationDelay = `${700 + i * 50}ms`;
});
this.container.classList.add('ge-entering');
setTimeout(() => this.container.classList.remove('ge-entering'), 1200);
```

- [ ] **Step 4: Add animateNumber to GlobeHUD.ts stat updates**

Import `animateNumber` from `@/services/motion`. In the count update method:

```typescript
const oldCount = parseInt(hotspotEl.textContent || '0', 10);
animateNumber(hotspotEl, oldCount, newCount);
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add src/components/GodsVisionView.ts src/components/GlobeHUD.ts src/styles/gods-vision.css
git commit -m "feat: cinematic God's Vision entry/exit transitions

Globe crossfade, staggered HUD entry, animated stat counters.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 19: Wire WelcomeFlow and Hints into App

**Files:**
- Modify: `src/app/panel-layout.ts`

- [ ] **Step 1: Read panel-layout.ts to find initialization**

Read to find where panels are initialized and the app becomes interactive.

- [ ] **Step 2: Import and trigger WelcomeFlow**

Add after panel initialization:

```typescript
import { WelcomeFlow } from '@/components/WelcomeFlow';
import { HINTS } from '@/components/ContextualHint';

if (WelcomeFlow.shouldShow()) {
  const flow = new WelcomeFlow({
    onComplete: () => {
      const alertPanel = document.querySelector('[data-panel="unified-alert-inbox"]');
      if (alertPanel) {
        setTimeout(() => HINTS.alertNavigation(alertPanel as HTMLElement), 1000);
      }
    },
  });
  flow.show();
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add src/app/panel-layout.ts
git commit -m "feat: wire WelcomeFlow and contextual hints into app init

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 20: Final Typecheck and E2E Smoke Test

**Files:**
- Create: `e2e/design-system.spec.ts`

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors. Fix any before proceeding.

- [ ] **Step 2: Write E2E smoke test**

```typescript
// e2e/design-system.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Design System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('tokens are loaded', async ({ page }) => {
    const surfaceBase = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--surface-base').trim()
    );
    expect(surfaceBase).toBe('#0a0a0a');
  });

  test('severity tokens exist', async ({ page }) => {
    const critical = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--severity-critical').trim()
    );
    expect(critical).toBe('#ef4444');
  });

  test('shimmer animation is defined', async ({ page }) => {
    const hasShimmer = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSKeyframesRule && rule.name === 'cb-shimmer') return true;
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasShimmer).toBe(true);
  });
});
```

- [ ] **Step 3: Run E2E test**

Run: `npx playwright test e2e/design-system.spec.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add e2e/design-system.spec.ts
git commit -m "test: add E2E smoke test for design system tokens

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push branch**

```bash
git push origin claude/apple-native-polish-spec
```

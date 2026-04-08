# Sidebar Update Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent update indicator to the macOS sidebar footer that shows "up to date" when current and a one-click install button when an update is available.

**Architecture:** `AppContext` gains an `updateState` field. `DesktopUpdater` writes to it after each check and dispatches a `wm:update-state` event. `PanelLayoutManager` reads `ctx.updateState` to render a `#sidebarUpdateBtn` span in the sidebar footer, re-rendering on each `wm:update-state` event and on every full sidebar rebuild.

**Tech Stack:** TypeScript, Tauri 2 (`invokeTauri`), vanilla DOM events, CSS custom properties. `escapeHtml` from `@/utils/sanitize` is used for all API-sourced strings.

---

## Files Changed

| File | Change |
|---|---|
| `src/app/app-context.ts` | Add `UpdateState` type and `updateState` field to `AppContext` interface |
| `src/App.ts` | Initialize `updateState: null` in the state object |
| `src/app/desktop-updater.ts` | Write `ctx.updateState` at each outcome; dispatch `wm:update-state`; extract `resolveDownloadUrl()` |
| `src/app/panel-layout.ts` | Replace static version span; add `buildSidebarUpdateBtnHtml()` and `renderSidebarUpdateBtn()`; add `wm:update-state` listener in `init()` |
| `src/styles/macos-native.css` | Add CSS for `.mac-sidebar-version--ok`, `.mac-sidebar-update-btn`, `.mac-sidebar-version--installing` |

---

### Task 1: Add `UpdateState` type and field to AppContext

**Files:**

- Modify: `src/app/app-context.ts`
- Modify: `src/App.ts`

- [ ] **Step 1: Add the exported type to app-context.ts**

Open `src/app/app-context.ts`. After the last import line and before the `CountryBriefSignals` interface, add:

```ts
export type UpdateState = {
  phase: 'checking' | 'up-to-date' | 'available' | 'installing';
  version?: string;
  downloadUrl?: string;
} | null;
```

- [ ] **Step 2: Add the field to the AppContext interface**

Inside the `AppContext` interface (after `readonly PANEL_SPANS_KEY: string;`), add:

```ts
  updateState: UpdateState;
```

The interface tail now reads:

```ts
  readonly PANEL_ORDER_KEY: string;
  readonly PANEL_SPANS_KEY: string;
  updateState: UpdateState;
}
```

- [ ] **Step 3: Initialize it in App.ts**

In `src/App.ts`, find the state object literal (the block around line 240 that assigns `this.state`). After `initialLoadComplete: false,`, add:

```ts
 isDestroyed: false,
 isPlaybackMode: false,
 isIdle: false,
 initialLoadComplete: false,
 resolvedLocation: 'global',
 initialUrlState,
 PANEL_ORDER_KEY,
 PANEL_SPANS_KEY,
 updateState: null,
```

- [ ] **Step 4: Run typecheck**

```bash
cd ~/developer/crystalball && npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/app-context.ts src/App.ts
git commit -m "feat(updater): add updateState field to AppContext

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Wire DesktopUpdater to write updateState and emit events

**Files:**

- Modify: `src/app/desktop-updater.ts`

- [ ] **Step 1: Update the import to include UpdateState**

The first import line in `src/app/desktop-updater.ts` currently reads:

```ts
import type { AppContext, AppModule } from '@/app/app-context';
```

Change it to:

```ts
import type { AppContext, AppModule, UpdateState } from '@/app/app-context';
```

- [ ] **Step 2: Add private helper setUpdateState()**

Add this method after `logUpdaterOutcome()` (around line 55):

```ts
  private setUpdateState(state: UpdateState): void {
 this.ctx.updateState = state;
 document.dispatchEvent(new CustomEvent('wm:update-state'));
  }
```

- [ ] **Step 3: Add private helper resolveDownloadUrl()**

Add this method to the class:

```ts
  private resolveDownloadUrl(data: { assets?: { name: string; browser_download_url: string }[] }): string {
 const buildArch = (typeof __BUILD_ARCH__ === 'undefined' ? 'aarch64' : __BUILD_ARCH__) as string;
 const assets = Array.isArray(data.assets) ? data.assets : [];
 const dmg =
 assets.find(a => typeof a.name === 'string' && a.name.endsWith('.dmg') && a.name.includes(buildArch)) ??
 assets.find(a => typeof a.name === 'string' && a.name.endsWith('.dmg'));
 return dmg?.browser_download_url ?? 'https://github.com/bradleybond512/crystal-ball/releases/latest';
  }
```

- [ ] **Step 4: Rewrite checkForUpdate() to call setUpdateState at each outcome**

Replace the full `checkForUpdate()` method body with:

```ts
  private async checkForUpdate(manual = false): Promise<void> {
 this.setUpdateState({ phase: 'checking' });
 try {
 const res = await fetch(
 'https://api.github.com/repos/bradleybond512/crystal-ball/releases/latest',
 { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) }
 );
 if (!res.ok) {
 this.logUpdaterOutcome('fetch_failed', { status: res.status });
 this.setUpdateState({ phase: 'up-to-date' });
 if (manual) this.showInfoToast('Could not reach update server. Check your connection.');
 return;
 }
 const data = await res.json();

 const tagName = typeof data.tag_name === 'string' ? data.tag_name : '';
 const remote = tagName.replace(/^v/, '');
 if (!remote) {
 this.logUpdaterOutcome('fetch_failed', { reason: 'missing_remote_version' });
 this.setUpdateState({ phase: 'up-to-date' });
 return;
 }

 const current = __APP_VERSION__;
 if (!this.isNewerVersion(remote, current)) {
 this.logUpdaterOutcome('no_update', { current, remote });
 this.setUpdateState({ phase: 'up-to-date' });
 if (manual) this.showInfoToast(`You're up to date — v${current} is the latest version.`);
 return;
 }

 const downloadUrl = this.resolveDownloadUrl(data);
 const dismissKey = `wm-update-dismissed-${remote}`;
 if (localStorage.getItem(dismissKey) && !manual) {
 this.logUpdaterOutcome('update_available', { current, remote, dismissed: true });
 this.setUpdateState({ phase: 'available', version: remote, downloadUrl });
 return;
 }

 this.logUpdaterOutcome('update_available', { current, remote, dismissed: false });
 this.setUpdateState({ phase: 'available', version: remote, downloadUrl });
 trackUpdateShown(current, remote);
 await this.showUpdateToast(remote, downloadUrl);
 } catch (error) {
 this.logUpdaterOutcome('fetch_failed', {
 error: error instanceof Error ? error.message : String(error),
 });
 this.setUpdateState({ phase: 'up-to-date' });
 }
  }
```

Note: the inline `buildArch` / `assets` / `dmg` block that was previously inside `checkForUpdate()` is now handled by `resolveDownloadUrl()`. Remove it from the old location — it no longer appears in `checkForUpdate()`.

- [ ] **Step 5: Run typecheck**

```bash
cd ~/developer/crystalball && npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/desktop-updater.ts
git commit -m "feat(updater): write updateState and emit wm:update-state on each check outcome

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Add CSS for the three update button states

**Files:**

- Modify: `src/styles/macos-native.css`

- [ ] **Step 1: Add three new rule blocks after `.mac-sidebar-version`**

In `src/styles/macos-native.css`, after the `.mac-sidebar-version` block (which ends around line 662), insert:

```css
.mac-sidebar-version--ok {
  margin-left: auto;
  font-size: 11px;
  color: var(--mac-tertiary-label);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.mac-sidebar-update-btn {
  margin-left: auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--mac-accent);
  color: #fff;
  border: none;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  font-family: var(--mac-font);
  transition: opacity 0.12s ease;
}

.mac-sidebar-update-btn:hover {
  opacity: 0.85;
}

.mac-sidebar-update-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.mac-sidebar-version--installing {
  margin-left: auto;
  font-size: 11px;
  color: var(--mac-tertiary-label);
  font-style: italic;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/macos-native.css
git commit -m "feat(updater): add sidebar update button CSS states

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Wire the sidebar button in PanelLayoutManager

**Files:**

- Modify: `src/app/panel-layout.ts`

`escapeHtml` is already imported from `@/utils/sanitize` at line 87. `invokeTauri` needs to be checked.

- [ ] **Step 1: Verify invokeTauri import**

Check the existing imports at the top of `src/app/panel-layout.ts`. If `invokeTauri` is not already imported, add:

```ts
import { invokeTauri } from '@/services/tauri-bridge';
```

- [ ] **Step 2: Replace the static version span in buildDesktopLayout()**

Find this line (around line 340):

```ts
 <span class="mac-sidebar-version">v${__APP_VERSION__}${BETA_MODE ? ' β' : ''}</span>
```

Replace it with:

```ts
 <span id="sidebarUpdateBtn">${this.buildSidebarUpdateBtnHtml()}</span>
```

- [ ] **Step 3: Add buildSidebarUpdateBtnHtml() private method**

Add this private method to `PanelLayoutManager` (near the other private `build*` helpers):

```ts
  private buildSidebarUpdateBtnHtml(): string {
 const versionLabel = escapeHtml(`v${__APP_VERSION__}${BETA_MODE ? ' β' : ''}`);
 const state = this.ctx.updateState;
 if (!state || state.phase === 'checking') {
 return `<span class="mac-sidebar-version">${versionLabel}</span>`;
 }
 if (state.phase === 'up-to-date') {
 return `<span class="mac-sidebar-version mac-sidebar-version--ok">${versionLabel} ✓</span>`;
 }
 if (state.phase === 'available' && state.version) {
 const remoteLabel = escapeHtml(`v${state.version}`);
 return `<button class="mac-sidebar-update-btn" id="sidebarUpdateInstall">${versionLabel} → ${remoteLabel}</button>`;
 }
 if (state.phase === 'installing') {
 return `<span class="mac-sidebar-version mac-sidebar-version--installing">Installing…</span>`;
 }
 return `<span class="mac-sidebar-version">${versionLabel}</span>`;
  }
```

- [ ] **Step 4: Add renderSidebarUpdateBtn() public method**

Add this method to `PanelLayoutManager`:

```ts
  renderSidebarUpdateBtn(): void {
 const container = document.getElementById('sidebarUpdateBtn');
 if (!container) return;
 container.innerHTML = this.buildSidebarUpdateBtnHtml();

 const installBtn = container.querySelector<HTMLButtonElement>('#sidebarUpdateInstall');
 if (!installBtn) return;

 const state = this.ctx.updateState;
 if (state?.phase !== 'available' || !state.downloadUrl) return;

 const { version, downloadUrl } = state;
 installBtn.addEventListener('click', () => {
 this.ctx.updateState = { phase: 'installing' };
 this.renderSidebarUpdateBtn();
 invokeTauri<void>('install_update', { downloadUrl }).catch(() => {
 this.ctx.updateState = { phase: 'available', version, downloadUrl };
 this.renderSidebarUpdateBtn();
 });
 });
  }
```

Note: `container.innerHTML` is safe here — `buildSidebarUpdateBtnHtml()` uses `escapeHtml()` on all API-sourced strings. The only other content (`Installing…`, `✓`, class names, and button structure) is hardcoded.

- [ ] **Step 5: Add wm:update-state listener in init()**

In `init()` (around line 161), add the listener after `this.renderLayout()`:

```ts
  init(): void {
 this.renderLayout();
 document.addEventListener('wm:update-state', () => {
 this.renderSidebarUpdateBtn();
 });
  }
```

- [ ] **Step 6: Call renderSidebarUpdateBtn() after createPanels() in renderLayout()**

In `renderLayout()` (around line 184), add a call at the end:

```ts
  renderLayout(): void {
 this.ctx.container.innerHTML = this.ctx.isDesktopApp ? this.buildDesktopLayout() : this.buildWebLayout();
 if (this.ctx.isDesktopApp) {
 document.title = `Crystal Ball v${__APP_VERSION__}`;
 }
 this.createPanels();
 if (this.ctx.isDesktopApp) {
 this.renderSidebarUpdateBtn();
 }
  }
```

This ensures that after any full sidebar rebuild (mode transitions, Ghost Mode toggle), the click listener is reattached.

- [ ] **Step 7: Run typecheck**

```bash
cd ~/developer/crystalball && npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/panel-layout.ts
git commit -m "feat(updater): wire sidebar update button in PanelLayoutManager

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Smoke test

- [ ] **Step 1: Build and install**

```bash
cd ~/developer/crystalball && npm run desktop:build:full && node scripts/install-built-app.mjs --relaunch
```

- [ ] **Step 2: Verify initial state (first 5 seconds)**

The sidebar footer should show plain `v2.8.0` while the update check is still pending.

- [ ] **Step 3: Verify post-check state (~5 seconds after launch)**

One of:

- `v2.8.0 ✓` muted — already on latest
- `v2.8.0 → vX.Y.Z` blue pill button — update available

- [ ] **Step 4: If update available, click the button**

Expected: button changes immediately to `Installing…` (italic, muted), then the app relaunches.

- [ ] **Step 5: Confirm the toast still works independently**

The existing update toast should still appear alongside the sidebar button (they coexist).

---

### Task 6: Push to remote

- [ ] **Step 1: Push**

```bash
git push macos main
```

Expected: branch pushed to `bradleybond512/crystal-ball`.

# UX-032 mutation proof

Candidate: `b4edf5ee5a81c3d486dd7df500c418879661c51b`. Each mutation began and ended with empty `git status --short`; each diff was displayed and inspected before running. Before/restored SHA256 values matched after every mutation. No test changes made in mutation workspace.

35 applied mutations; 34 killed; 1 survived.

Baseline commands and actual output:

```text
npm run test:ux032
# pass 16
# fail 0
```

```text
E2E_PORT=4344 npm run test:ux032-browser
  8 passed (10.0s)
```

| Mutation | Actual output |
| --- | --- |
| add-handoff | # pass 15; # fail 1 |
| aria-modal | # pass 15; # fail 1 |
| close-name | # pass 15; # fail 1 |
| css-layout-filter |   2 failed;   6 passed (20.5s) |
| css-visibility-filter |   1 failed;   7 passed (14.4s) |
| destroy-cleanup | # pass 11; # fail 5 |
| disabled-filter | # pass 15; # fail 1 |
| edit-focus | # pass 15; # fail 1 |
| edit-handoff | # pass 14; # fail 2 |
| focus-restoration | # pass 13; # fail 3 |
| hidden-inert-filter | # pass 14; # fail 2 |
| initial-focus | # pass 14; # fail 2 |
| negative-filter | # pass 13; # fail 3 |
| observer-unrelated | # pass 15; # fail 1 |
| observer | # pass 15; # fail 1 |
| palette-saved-guard | # pass 15; # fail 1 |
| palette-saved-hidden | # pass 15; # fail 1 |
| palette-saved-transition | # pass 15; # fail 1 |
| palette-settings-guard | # pass 15; # fail 1 |
| palette-settings-hidden | # pass 15; # fail 1 |
| palette-settings-tab | # pass 15; # fail 1 |
| palette-settings-transition | # pass 15; # fail 1 |
| repeated-open | # pass 15; # fail 1 |
| saved-capture | # pass 15; # fail 1 |
| saved-consume | # pass 15; # fail 1 |
| saved-own-open | # pass 16; # fail 0 |
| saved-pick | # pass 14; # fail 2 |
| saved-prevent | # pass 15; # fail 1 |
| settings-capture | # pass 15; # fail 1 |
| settings-consume | # pass 15; # fail 1 |
| settings-prevent | # pass 15; # fail 1 |
| tab-backward | # pass 11; # fail 5 |
| tab-empty | # pass 15; # fail 1 |
| tab-forward | # pass 11; # fail 5 |
| tab-outside | # pass 14; # fail 2 |

Restored file checksums:

```text
ff7ac472eb3acb3000946dc049811725e07b44bec32b24a866faa7a8dbec5edb  src/components/UnifiedSettings.ts
```

```text
5ebd39fa3efd6ffcec3f877064b632cf5ceb2dbdf28c96ceb50b5b01cbe48a99  src/components/SavedPlaceModal.ts
```

Raw evidence: each mutation has `.diff` (inspected applied patch), `.log` (full output and actual failing assertions), `.json` (counts/command), `.before.sha256` / `.restored.sha256`, and `.before.status` / `.restored.status` (empty). Capture mutations move registration and cleanup together to preserve listener lifecycle. Final source conclusions must cite the candidate above.

Historical initial candidate evidence is retained separately; it is not a claim against subsequent changed source.

Disclosed survivor: `saved-own-open` removes the SavedPlaceModal active-class guard. Actual result: `# pass 16` / `# fail 0`. The tested public close lifecycle removes its keyboard listener, so the inactive-handler branch is not reached by those flows. This extra guard is not claimed as independently proven; this is a coverage limitation, not a claim that every conceivable inactive-handler state is equivalent. All 7 foreground-palette guard/transition/Tab/hidden-state mutants were killed.

No production or test edits were retained; historical original-candidate and repair1 records are separate subdirectories.

## Applied patches and failing assertions

### add-handoff

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..1dc7c5755 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -391,7 +391,6 @@ export class UnifiedSettings {
  const placeId = target.closest<HTMLElement>('[data-place-id]')?.dataset.placeId;
  if (placesAction === 'add') {
  if (this.config.openCreatePlace) {
- this.close();
  this.config.openCreatePlace();
  }
  return;
```

Actual assertion/count excerpts:

```text
not ok 10 - place callbacks run after Settings closes and preserve the Places tab
  error: |-
    Expected values to be strictly deep-equal:
# tests 16
# pass 15
# fail 1
```

### aria-modal

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..6b4976717 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -137,7 +137,6 @@ export class UnifiedSettings {
  this.overlay.className = 'modal-overlay';
  this.overlay.id = 'unifiedSettingsModal';
  this.overlay.setAttribute('role', 'dialog');
- this.overlay.setAttribute('aria-modal', 'true');
  this.overlay.tabIndex = -1;
  this.overlay.setAttribute('aria-label', t('header.settings'));
```

Actual assertion/count excerpts:

```text
not ok 1 - opening identifies a modal and focuses a named close button
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### close-name

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..fca0bfe8a 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -660,7 +660,7 @@ export class UnifiedSettings {
  <div class="modal unified-settings-modal">
  <div class="modal-header">
  <span class="modal-title">${t('header.settings')}</span>
- <button class="modal-close unified-settings-close" aria-label="${escapeHtml(t('common.close'))}">×</button>
+ <button class="modal-close unified-settings-close">×</button>
  </div>
  <div class="unified-settings-tabs">
  <button class="${this.tabClass('general')}" data-tab="general">${t('header.tabGeneral')}</button>
```

Actual assertion/count excerpts:

```text
not ok 1 - opening identifies a modal and focuses a named close button
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### css-layout-filter

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..63f1f8f97 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -587,7 +587,7 @@ export class UnifiedSettings {
 
   private isUsableFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.tabIndex < 0 || element.matches(':disabled')
- || element.closest('[hidden], [inert]') || element.getClientRects().length === 0) return false;
+ || element.closest('[hidden], [inert]')) return false;
  const visibility = getComputedStyle(element).visibility;
  return visibility !== 'hidden' && visibility !== 'collapse';
   }
```

Actual assertion/count excerpts:

```text
    Error: [2mexpect([22m[31mlocator[39m[2m).not.[22mtoBeFocused[2m([22m[2m)[22m failed
    Expected: not focused
    test-results/settings-keyboard-Settings-f144d-al-at-wide-and-narrow-sizes-chromium/test-failed-1.png
    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeFocused[2m([22m[2m)[22m failed
    Expected: focused
    test-results/settings-keyboard-CSS-hidd-ed6bb--cannot-become-wrap-targets-chromium/test-failed-1.png
  2 failed
  6 passed (20.5s)
```

### css-visibility-filter

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..16dc4d0c7 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -589,7 +589,7 @@ export class UnifiedSettings {
  if (!element?.isConnected || element.tabIndex < 0 || element.matches(':disabled')
  || element.closest('[hidden], [inert]') || element.getClientRects().length === 0) return false;
  const visibility = getComputedStyle(element).visibility;
- return visibility !== 'hidden' && visibility !== 'collapse';
+ return true;
   }
 
   private focusableControls(): HTMLElement[] {
```

Actual assertion/count excerpts:

```text
    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeFocused[2m([22m[2m)[22m failed
    Expected: focused
    test-results/settings-keyboard-CSS-hidd-ed6bb--cannot-become-wrap-targets-chromium/test-failed-1.png
  1 failed
  7 passed (14.4s)
```

### destroy-cleanup

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..093bc67ce 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -642,7 +642,6 @@ export class UnifiedSettings {
   }
 
   public destroy(): void {
- this.close();
  this.apiConfigPanel?.destroy();
  this.apiConfigPanel = null;
  this.overlay.remove();
```

Actual assertion/count excerpts:

```text
not ok 2 - Escape beats earlier document capture handlers and restores the original invoker across repeated opens
  error: |-
    Expected values to be strictly equal:
not ok 13 - destroy restores focus and releases keyboard ownership
  error: |-
    Expected values to be strictly equal:
not ok 14 - Saved Place Escape precedes document capture and exits picking before closing
  error: |-
    Expected values to be strictly deep-equal:
not ok 15 - foreground palette owns Escape and Tab above Settings, including its delayed-focus interval
  error: |-
    Expected values to be strictly equal:
not ok 16 - foreground palette preserves a saved-place draft and map-pick state until the editor owns Escape again
  error: |-
    Expected values to be strictly deep-equal:
# tests 16
# pass 11
# fail 5
```

### disabled-filter

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..e1357fc3d 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -586,7 +586,7 @@ export class UnifiedSettings {
   }
 
   private isUsableFocusTarget(element: HTMLElement | null): element is HTMLElement {
- if (!element?.isConnected || element.tabIndex < 0 || element.matches(':disabled')
+ if (!element?.isConnected || element.tabIndex < 0
  || element.closest('[hidden], [inert]') || element.getClientRects().length === 0) return false;
  const visibility = getComputedStyle(element).visibility;
  return visibility !== 'hidden' && visibility !== 'collapse';
```

Actual assertion/count excerpts:

```text
not ok 6 - Tab wrap ignores a disabled control at both boundaries
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### edit-focus

File and applied patch inspected before execution:

```diff
diff --git a/src/components/SavedPlaceModal.ts b/src/components/SavedPlaceModal.ts
index d3eb2ee52..1fdecab90 100644
--- a/src/components/SavedPlaceModal.ts
+++ b/src/components/SavedPlaceModal.ts
@@ -179,7 +179,6 @@ export class SavedPlaceModal {
  this.render();
  this.overlay.classList.add('active');
  window.addEventListener('keydown', this.escapeHandler, true);
- this.focusNameField();
   }
 
   public close(): void {
```

Actual assertion/count excerpts:

```text
not ok 11 - editing a saved place transfers focus to the real editor after Settings closes
  error: |-
# tests 16
# pass 15
# fail 1
```

### edit-handoff

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..20ad284b8 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -398,7 +398,6 @@ export class UnifiedSettings {
  }
  if (placesAction === 'edit' && placeId) {
  if (this.config.openEditPlace) {
- this.close();
  this.config.openEditPlace(placeId);
  }
  return;
```

Actual assertion/count excerpts:

```text
not ok 10 - place callbacks run after Settings closes and preserve the Places tab
  error: |-
    Expected values to be strictly deep-equal:
not ok 11 - editing a saved place transfers focus to the real editor after Settings closes
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 14
# fail 2
```

### focus-restoration

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..8c0866b20 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -579,7 +579,7 @@ export class UnifiedSettings {
  const target = this.isUsableFocusTarget(this.previousFocus)
  ? this.previousFocus
  : document.getElementById('unifiedSettingsBtn');
- if (this.isUsableFocusTarget(target)) target.focus();
+
  }
  this.previousFocus = null;
  this.focusedControl = null;
```

Actual assertion/count excerpts:

```text
not ok 2 - Escape beats earlier document capture handlers and restores the original invoker across repeated opens
  error: |-
    Expected values to be strictly equal:
not ok 9 - native/body launch and removed invokers fall back to the visible Settings button
  error: |-
    Expected values to be strictly equal:
not ok 13 - destroy restores focus and releases keyboard ownership
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 13
# fail 3
```

### hidden-inert-filter

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..53783b94d 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -587,7 +587,7 @@ export class UnifiedSettings {
 
   private isUsableFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.tabIndex < 0 || element.matches(':disabled')
- || element.closest('[hidden], [inert]') || element.getClientRects().length === 0) return false;
+ || element.getClientRects().length === 0) return false;
  const visibility = getComputedStyle(element).visibility;
  return visibility !== 'hidden' && visibility !== 'collapse';
   }
```

Actual assertion/count excerpts:

```text
not ok 4 - Tab wrap ignores a hidden ancestor at both boundaries
  error: |-
    Expected values to be strictly equal:
not ok 5 - Tab wrap ignores a inert ancestor at both boundaries
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 14
# fail 2
```

### initial-focus

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..eea6eda23 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -561,7 +561,6 @@ export class UnifiedSettings {
  this.overlay.classList.add('active');
  localStorage.setItem('wm-settings-open', '1');
  window.addEventListener('keydown', this.escapeHandler, true);
- this.focusFirstControl();
  this.focusObserver.observe(this.overlay, {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ['hidden', 'disabled', 'tabindex', 'class', 'style', 'inert'],
```

Actual assertion/count excerpts:

```text
not ok 1 - opening identifies a modal and focuses a named close button
  error: |-
    Expected values to be strictly equal:
not ok 8 - a removed focused control recovers inside Settings without stealing focus on unrelated updates
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 14
# fail 2
```

### negative-filter

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..ad78cabfc 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -586,7 +586,7 @@ export class UnifiedSettings {
   }
 
   private isUsableFocusTarget(element: HTMLElement | null): element is HTMLElement {
- if (!element?.isConnected || element.tabIndex < 0 || element.matches(':disabled')
+ if (!element?.isConnected || element.matches(':disabled')
  || element.closest('[hidden], [inert]') || element.getClientRects().length === 0) return false;
  const visibility = getComputedStyle(element).visibility;
  return visibility !== 'hidden' && visibility !== 'collapse';
```

Actual assertion/count excerpts:

```text
not ok 3 - Tab wraps current usable controls, including outside focus and an empty dialog
  error: |-
    Expected values to be strictly equal:
not ok 7 - Tab wrap ignores a negative tab index at both boundaries
  error: |-
    Expected values to be strictly equal:
not ok 9 - native/body launch and removed invokers fall back to the visible Settings button
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 13
# fail 3
```

### observer-unrelated

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..2380e38f5 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -162,7 +162,7 @@ export class UnifiedSettings {
  this.focusObserver = new MutationObserver(() => {
  if (!this.focusedControl || this.isUsableFocusTarget(this.focusedControl)) return;
  const active = document.activeElement;
- if (active === document.body || active === this.overlay || active === this.focusedControl) {
+ if (true) {
  this.focusFirstControl();
  }
  });
```

Actual assertion/count excerpts:

```text
not ok 8 - a removed focused control recovers inside Settings without stealing focus on unrelated updates
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### observer

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..5d7ac5026 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -562,6 +562,7 @@ export class UnifiedSettings {
  localStorage.setItem('wm-settings-open', '1');
  window.addEventListener('keydown', this.escapeHandler, true);
  this.focusFirstControl();
+ return;
  this.focusObserver.observe(this.overlay, {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ['hidden', 'disabled', 'tabindex', 'class', 'style', 'inert'],
```

Actual assertion/count excerpts:

```text
not ok 8 - a removed focused control recovers inside Settings without stealing focus on unrelated updates
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### palette-saved-guard

File and applied patch inspected before execution:

```diff
diff --git a/src/components/SavedPlaceModal.ts b/src/components/SavedPlaceModal.ts
index d3eb2ee52..443f64aad 100644
--- a/src/components/SavedPlaceModal.ts
+++ b/src/components/SavedPlaceModal.ts
@@ -85,10 +85,6 @@ export class SavedPlaceModal {
 
  this.escapeHandler = (e: KeyboardEvent) => {
  if (!this.overlay.classList.contains('active')) return;
- if (e.key === 'Escape' && document.querySelector('.cmdk-v2-overlay:not([hidden])')) {
- e.preventDefault();
- return;
- }
  if (e.key === 'Escape') {
  e.preventDefault();
  e.stopImmediatePropagation();
```

Actual assertion/count excerpts:

```text
not ok 16 - foreground palette preserves a saved-place draft and map-pick state until the editor owns Escape again
  error: |-
    Expected values to be strictly deep-equal:
# tests 16
# pass 15
# fail 1
```

### palette-saved-hidden

File and applied patch inspected before execution:

```diff
diff --git a/src/components/SavedPlaceModal.ts b/src/components/SavedPlaceModal.ts
index d3eb2ee52..a6769658b 100644
--- a/src/components/SavedPlaceModal.ts
+++ b/src/components/SavedPlaceModal.ts
@@ -85,7 +85,7 @@ export class SavedPlaceModal {
 
  this.escapeHandler = (e: KeyboardEvent) => {
  if (!this.overlay.classList.contains('active')) return;
- if (e.key === 'Escape' && document.querySelector('.cmdk-v2-overlay:not([hidden])')) {
+ if (e.key === 'Escape' && document.querySelector('.cmdk-v2-overlay')) {
  e.preventDefault();
  return;
  }
```

Actual assertion/count excerpts:

```text
not ok 16 - foreground palette preserves a saved-place draft and map-pick state until the editor owns Escape again
  error: |-
    Expected values to be strictly deep-equal:
# tests 16
# pass 15
# fail 1
```

### palette-saved-transition

File and applied patch inspected before execution:

```diff
diff --git a/src/components/SavedPlaceModal.ts b/src/components/SavedPlaceModal.ts
index d3eb2ee52..bdbf9f97e 100644
--- a/src/components/SavedPlaceModal.ts
+++ b/src/components/SavedPlaceModal.ts
@@ -86,7 +86,6 @@ export class SavedPlaceModal {
  this.escapeHandler = (e: KeyboardEvent) => {
  if (!this.overlay.classList.contains('active')) return;
  if (e.key === 'Escape' && document.querySelector('.cmdk-v2-overlay:not([hidden])')) {
- e.preventDefault();
  return;
  }
  if (e.key === 'Escape') {
```

Actual assertion/count excerpts:

```text
not ok 16 - foreground palette preserves a saved-place draft and map-pick state until the editor owns Escape again
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### palette-settings-guard

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..e23dbb8c2 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -143,10 +143,6 @@ export class UnifiedSettings {
 
  this.escapeHandler = (e: KeyboardEvent) => {
  if (!this.overlay.classList.contains('active')) return;
- if ((e.key === 'Escape' || e.key === 'Tab') && document.querySelector('.cmdk-v2-overlay:not([hidden])')) {
- if (e.key === 'Escape') e.preventDefault();
- return;
- }
  if (e.key === 'Escape') {
  e.preventDefault();
  e.stopImmediatePropagation();
```

Actual assertion/count excerpts:

```text
not ok 15 - foreground palette owns Escape and Tab above Settings, including its delayed-focus interval
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### palette-settings-hidden

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..bd11a3783 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -143,7 +143,7 @@ export class UnifiedSettings {
 
  this.escapeHandler = (e: KeyboardEvent) => {
  if (!this.overlay.classList.contains('active')) return;
- if ((e.key === 'Escape' || e.key === 'Tab') && document.querySelector('.cmdk-v2-overlay:not([hidden])')) {
+ if ((e.key === 'Escape' || e.key === 'Tab') && document.querySelector('.cmdk-v2-overlay')) {
  if (e.key === 'Escape') e.preventDefault();
  return;
  }
```

Actual assertion/count excerpts:

```text
not ok 15 - foreground palette owns Escape and Tab above Settings, including its delayed-focus interval
  error: |-
# tests 16
# pass 15
# fail 1
```

### palette-settings-tab

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..27948f7fd 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -143,7 +143,7 @@ export class UnifiedSettings {
 
  this.escapeHandler = (e: KeyboardEvent) => {
  if (!this.overlay.classList.contains('active')) return;
- if ((e.key === 'Escape' || e.key === 'Tab') && document.querySelector('.cmdk-v2-overlay:not([hidden])')) {
+ if ((e.key === 'Escape') && document.querySelector('.cmdk-v2-overlay:not([hidden])')) {
  if (e.key === 'Escape') e.preventDefault();
  return;
  }
```

Actual assertion/count excerpts:

```text
not ok 15 - foreground palette owns Escape and Tab above Settings, including its delayed-focus interval
  error: |-
# tests 16
# pass 15
# fail 1
```

### palette-settings-transition

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..c340e6e65 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -144,7 +144,6 @@ export class UnifiedSettings {
  this.escapeHandler = (e: KeyboardEvent) => {
  if (!this.overlay.classList.contains('active')) return;
  if ((e.key === 'Escape' || e.key === 'Tab') && document.querySelector('.cmdk-v2-overlay:not([hidden])')) {
- if (e.key === 'Escape') e.preventDefault();
  return;
  }
  if (e.key === 'Escape') {
```

Actual assertion/count excerpts:

```text
not ok 15 - foreground palette owns Escape and Tab above Settings, including its delayed-focus interval
  error: |-
# tests 16
# pass 15
# fail 1
```

### repeated-open

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..cffce982c 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -552,7 +552,7 @@ export class UnifiedSettings {
   }
 
   public open(tab?: TabId): void {
- if (!this.overlay.classList.contains('active')) {
+ if (true) {
  this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  this.focusObserver.disconnect();
```

Actual assertion/count excerpts:

```text
not ok 2 - Escape beats earlier document capture handlers and restores the original invoker across repeated opens
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### saved-capture

File and applied patch inspected before execution:

```diff
diff --git a/src/components/SavedPlaceModal.ts b/src/components/SavedPlaceModal.ts
index d3eb2ee52..0c92b12bf 100644
--- a/src/components/SavedPlaceModal.ts
+++ b/src/components/SavedPlaceModal.ts
@@ -129,7 +129,7 @@ export class SavedPlaceModal {
  this.confirmingDelete = false;
  this.render();
  this.overlay.classList.add('active');
- window.addEventListener('keydown', this.escapeHandler, true);
+ document.addEventListener('keydown', this.escapeHandler, true);
  this.focusNameField();
   }
 
@@ -156,7 +156,7 @@ export class SavedPlaceModal {
  this.render();
  this.overlay.setAttribute('aria-label', 'Save current location as place');
  this.overlay.classList.add('active');
- window.addEventListener('keydown', this.escapeHandler, true);
+ document.addEventListener('keydown', this.escapeHandler, true);
  this.focusNameField();
   }
 
@@ -178,7 +178,7 @@ export class SavedPlaceModal {
  this.confirmingDelete = false;
  this.render();
  this.overlay.classList.add('active');
- window.addEventListener('keydown', this.escapeHandler, true);
+ document.addEventListener('keydown', this.escapeHandler, true);
  this.focusNameField();
   }
 
@@ -186,7 +186,7 @@ export class SavedPlaceModal {
  const closingCurrentLocationConversion = this.currentLocationConversion;
  if (this.pickModeActive) this.exitPickMode();
  this.overlay.classList.remove('active');
- window.removeEventListener('keydown', this.escapeHandler, true);
+ document.removeEventListener('keydown', this.escapeHandler, true);
  if (this.searchDebounce) clearTimeout(this.searchDebounce);
  this.searchDebounce = null;
  if (closingCurrentLocationConversion) {
```

Actual assertion/count excerpts:

```text
not ok 14 - Saved Place Escape precedes document capture and exits picking before closing
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### saved-consume

File and applied patch inspected before execution:

```diff
diff --git a/src/components/SavedPlaceModal.ts b/src/components/SavedPlaceModal.ts
index d3eb2ee52..850574545 100644
--- a/src/components/SavedPlaceModal.ts
+++ b/src/components/SavedPlaceModal.ts
@@ -91,7 +91,6 @@ export class SavedPlaceModal {
  }
  if (e.key === 'Escape') {
  e.preventDefault();
- e.stopImmediatePropagation();
  if (this.pickModeActive) {
  this.exitPickMode();
  } else {
```

Actual assertion/count excerpts:

```text
not ok 14 - Saved Place Escape precedes document capture and exits picking before closing
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### saved-own-open

File and applied patch inspected before execution:

```diff
diff --git a/src/components/SavedPlaceModal.ts b/src/components/SavedPlaceModal.ts
index d3eb2ee52..68653f081 100644
--- a/src/components/SavedPlaceModal.ts
+++ b/src/components/SavedPlaceModal.ts
@@ -84,7 +84,6 @@ export class SavedPlaceModal {
  this.overlay.setAttribute('aria-label', 'Save Place');
 
  this.escapeHandler = (e: KeyboardEvent) => {
- if (!this.overlay.classList.contains('active')) return;
  if (e.key === 'Escape' && document.querySelector('.cmdk-v2-overlay:not([hidden])')) {
  e.preventDefault();
  return;
```

Actual assertion/count excerpts:

```text
# tests 16
# pass 16
# fail 0
```

### saved-pick

File and applied patch inspected before execution:

```diff
diff --git a/src/components/SavedPlaceModal.ts b/src/components/SavedPlaceModal.ts
index d3eb2ee52..531a06cf0 100644
--- a/src/components/SavedPlaceModal.ts
+++ b/src/components/SavedPlaceModal.ts
@@ -92,7 +92,7 @@ export class SavedPlaceModal {
  if (e.key === 'Escape') {
  e.preventDefault();
  e.stopImmediatePropagation();
- if (this.pickModeActive) {
+ if (false && this.pickModeActive) {
  this.exitPickMode();
  } else {
  this.close();
```

Actual assertion/count excerpts:

```text
not ok 14 - Saved Place Escape precedes document capture and exits picking before closing
  error: |-
    Expected values to be strictly equal:
not ok 16 - foreground palette preserves a saved-place draft and map-pick state until the editor owns Escape again
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 14
# fail 2
```

### saved-prevent

File and applied patch inspected before execution:

```diff
diff --git a/src/components/SavedPlaceModal.ts b/src/components/SavedPlaceModal.ts
index d3eb2ee52..7974de4b7 100644
--- a/src/components/SavedPlaceModal.ts
+++ b/src/components/SavedPlaceModal.ts
@@ -90,7 +90,6 @@ export class SavedPlaceModal {
  return;
  }
  if (e.key === 'Escape') {
- e.preventDefault();
  e.stopImmediatePropagation();
  if (this.pickModeActive) {
  this.exitPickMode();
```

Actual assertion/count excerpts:

```text
not ok 14 - Saved Place Escape precedes document capture and exits picking before closing
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### settings-capture

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..51832b4e7 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -560,7 +560,7 @@ export class UnifiedSettings {
  this.render();
  this.overlay.classList.add('active');
  localStorage.setItem('wm-settings-open', '1');
- window.addEventListener('keydown', this.escapeHandler, true);
+ document.addEventListener('keydown', this.escapeHandler, true);
  this.focusFirstControl();
  this.focusObserver.observe(this.overlay, {
  childList: true, subtree: true, attributes: true,
@@ -574,7 +574,7 @@ export class UnifiedSettings {
  this.focusObserver.disconnect();
  this.overlay.classList.remove('active');
  localStorage.removeItem('wm-settings-open');
- window.removeEventListener('keydown', this.escapeHandler, true);
+ document.removeEventListener('keydown', this.escapeHandler, true);
  if (wasOpen) {
  const target = this.isUsableFocusTarget(this.previousFocus)
  ? this.previousFocus
```

Actual assertion/count excerpts:

```text
not ok 2 - Escape beats earlier document capture handlers and restores the original invoker across repeated opens
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### settings-consume

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..d8527be94 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -149,7 +149,6 @@ export class UnifiedSettings {
  }
  if (e.key === 'Escape') {
  e.preventDefault();
- e.stopImmediatePropagation();
  this.close();
  } else if (e.key === 'Tab') {
  this.containTab(e);
```

Actual assertion/count excerpts:

```text
not ok 2 - Escape beats earlier document capture handlers and restores the original invoker across repeated opens
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### settings-prevent

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..4e4ff6974 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -148,7 +148,6 @@ export class UnifiedSettings {
  return;
  }
  if (e.key === 'Escape') {
- e.preventDefault();
  e.stopImmediatePropagation();
  this.close();
  } else if (e.key === 'Tab') {
```

Actual assertion/count excerpts:

```text
not ok 2 - Escape beats earlier document capture handlers and restores the original invoker across repeated opens
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### tab-backward

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..3d9474bf0 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -612,7 +612,7 @@ export class UnifiedSettings {
  } else if (!controls.includes(active as HTMLElement)) {
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
- } else if (event.shiftKey && active === first) {
+ } else if (false && event.shiftKey && active === first) {
  event.preventDefault();
  last.focus();
  } else if (!event.shiftKey && active === last) {
```

Actual assertion/count excerpts:

```text
not ok 3 - Tab wraps current usable controls, including outside focus and an empty dialog
  error: |-
    Expected values to be strictly equal:
not ok 4 - Tab wrap ignores a hidden ancestor at both boundaries
  error: |-
    Expected values to be strictly equal:
not ok 5 - Tab wrap ignores a inert ancestor at both boundaries
  error: |-
    Expected values to be strictly equal:
not ok 6 - Tab wrap ignores a disabled control at both boundaries
  error: |-
    Expected values to be strictly equal:
not ok 7 - Tab wrap ignores a negative tab index at both boundaries
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 11
# fail 5
```

### tab-empty

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..c61c61562 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -608,7 +608,6 @@ export class UnifiedSettings {
  const active = document.activeElement;
  if (!first || !last) {
  event.preventDefault();
- this.overlay.focus();
  } else if (!controls.includes(active as HTMLElement)) {
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
```

Actual assertion/count excerpts:

```text
not ok 3 - Tab wraps current usable controls, including outside focus and an empty dialog
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 15
# fail 1
```

### tab-forward

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..9c434b12e 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -615,7 +615,7 @@ export class UnifiedSettings {
  } else if (event.shiftKey && active === first) {
  event.preventDefault();
  last.focus();
- } else if (!event.shiftKey && active === last) {
+ } else if (false && !event.shiftKey && active === last) {
  event.preventDefault();
  first.focus();
  }
```

Actual assertion/count excerpts:

```text
not ok 3 - Tab wraps current usable controls, including outside focus and an empty dialog
  error: |-
    Expected values to be strictly equal:
not ok 4 - Tab wrap ignores a hidden ancestor at both boundaries
  error: |-
    Expected values to be strictly equal:
not ok 5 - Tab wrap ignores a inert ancestor at both boundaries
  error: |-
    Expected values to be strictly equal:
not ok 6 - Tab wrap ignores a disabled control at both boundaries
  error: |-
    Expected values to be strictly equal:
not ok 7 - Tab wrap ignores a negative tab index at both boundaries
  error: |-
    Expected values to be strictly equal:
# tests 16
# pass 11
# fail 5
```

### tab-outside

File and applied patch inspected before execution:

```diff
diff --git a/src/components/UnifiedSettings.ts b/src/components/UnifiedSettings.ts
index d0694e5e4..bbd184ba7 100644
--- a/src/components/UnifiedSettings.ts
+++ b/src/components/UnifiedSettings.ts
@@ -609,7 +609,7 @@ export class UnifiedSettings {
  if (!first || !last) {
  event.preventDefault();
  this.overlay.focus();
- } else if (!controls.includes(active as HTMLElement)) {
+ } else if (false && !controls.includes(active as HTMLElement)) {
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
```

Actual assertion/count excerpts:

```text
not ok 3 - Tab wraps current usable controls, including outside focus and an empty dialog
  error: |-
    Expected values to be strictly equal:
not ok 15 - foreground palette owns Escape and Tab above Settings, including its delayed-focus interval
  error: |-
# tests 16
# pass 14
# fail 2
```

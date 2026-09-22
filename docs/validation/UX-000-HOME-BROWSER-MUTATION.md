# UX-000 approved-cycle browser mutation proof

Commit: `35f0dc7bb2431b9807db2021103def0cd9e8c11b`.
Worktree: `/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918` (isolated detached checkout).

The fixture explicitly opens and dismisses the existing digest through its actual UI before exercising the unchanged resize, focus, Enter and Escape assertions. No keyboard assertions were removed. This is browser UI derivation evidence with synthetic USGS observations, not live-provider or packaged acceptance.

Command (each run uses its own external output directory):

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH E2E_PORT=4201 npm run test:e2e:full -- e2e/home-shell-boot.spec.ts --grep 'fresh audited data' --output=<baseline|red|restored-artifacts>
```

- Baseline: `1 passed (45.3s)` (1 pass / 0 fail), `baseline.log`.
- Mutated: `1 failed` (0 pass / 1 fail), `red.log`; actual assertion below.
- Restored: `1 passed (35.2s)` (1 pass / 0 fail), `restored.log`.

Before mutation, git status was empty. Source and fixture SHA-256:

```text
d2748eaab63d38abe37186d2d61319ea6a1170eab60480fd6de10945ab486b75  src/services/home-shell/deck-view.ts
af798d7bf459ef82d5516cec690ca4cdf0712f686b778cc5349ed4339879a930  e2e/home-shell-boot.spec.ts
```

The applied diff was captured and inspected before running the mutant:

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..4bcac881c 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -202,7 +202,7 @@ export function buildDeckCards(
       };
     }
     const contributors = inputs.contributors?.[panelId] ?? [];
-    if (contributors.length > 0) {
+    if (contributors.length > 0 && hasRenderReport) {
       return buildContributorDeckCard(panelId, title, narrative, contributors, now, startupStartedAt, hasRenderReport);
     }
     if (h?.lastRenderAt === undefined) {
```

Actual red assertion:

```text
  1) [chromium] › e2e/home-shell-boot.spec.ts:110:3 › home shell default boot › fresh audited data makes a Deck card useful while the classic grid remains unrendered 

    Error: expect(locator).toHaveClass(expected) failed

    Locator: locator('.home-shell').locator('.hs-deck-grid .hs-card[data-panel-key="earthquakes"]')
    Expected pattern: /hs-card-readiness-useful/
    Received string:  "hs-card hs-card-unknown hs-card-readiness-loading"
    Timeout: 15000ms

    Call log:
      - Expect "toHaveClass" with timeout 15000ms
      - waiting for locator('.home-shell').locator('.hs-deck-grid .hs-card[data-panel-key="earthquakes"]')
        13 × locator resolved to <article data-panel-key="earthquakes" class="hs-card hs-card-unknown hs-card-readiness-loading">…</article>
           - unexpected value "hs-card hs-card-unknown hs-card-readiness-loading"


      135 |     expect(before.lastError).toBeUndefined();
      136 |     const card = shell.locator('.hs-deck-grid .hs-card[data-panel-key="earthquakes"]');
    > 137 |     await expect(card).toHaveClass(/hs-card-readiness-useful/, { timeout: 15_000 });
          |                        ^
      138 |     await expect(card.locator('.hs-card-status')).toHaveText(/data contributor working now.*3 items in latest update/);
      139 |     await expect(page.locator('#panelsGrid')).toHaveCSS('content-visibility', 'hidden');
      140 |     const after = await page.evaluate(async () => {
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/e2e/home-shell-boot.spec.ts:137:24

```

Restoration checksum matched both files exactly and `git status --short` was empty before the final restored run. Original 18 unit/component mutation proofs remain valid because production and those test files are unchanged.

Final post-run status remained empty and both checksums remained identical (`final-status.txt`, `final-checksums.txt`). Browser proof: **1 pass / 0 fail → 0 pass / 1 fail → 1 pass / 0 fail**.

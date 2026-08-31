import { expect, test } from '@playwright/test';

async function skipFirstRunDialogs(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('cb:onboarding-complete', 'true');
    localStorage.setItem('wm-analytics-consent-prompt-seen', 'true');
  });
}

// Phase 2: the Home Shell is the default opening surface (full variant, desktop).
test.describe('home shell default boot', () => {
  test('browser harness only: empty client storage keeps Welcome auth groups honest and Deck reports bounded', async ({ page }) => {
    test.slow();
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/');

    const welcome = page.locator('.cb-backdrop');
    const dialog = welcome.getByRole('dialog', { name: 'Set Your Location' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(welcome.getByRole('heading', { name: 'Set Your Location' })).toBeVisible({ timeout: 30_000 });
    const useLocation = welcome.getByRole('button', { name: 'Use My Location' });
    const skipLocation = welcome.getByRole('button', { name: 'Skip for now' });
    await expect(useLocation).toBeFocused();
    await skipLocation.focus();
    await page.keyboard.press('Tab');
    await expect(useLocation).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(skipLocation).toBeFocused();
    await skipLocation.click();
    await expect(welcome.getByRole('heading', { name: 'What interests you?' })).toBeVisible();
    await welcome.getByRole('button', { name: 'Continue' }).click();
    await expect(welcome.getByRole('heading', { name: 'Connect your data sources' })).toBeVisible();

    const noAuth = welcome.locator('[data-source-access="no-auth"]');
    const optionalCredential = welcome.locator('[data-source-access="optional-credential"]');
    await expect(noAuth.getByRole('heading')).toHaveText('No configured credentials required');
    await expect(optionalCredential.getByRole('heading')).toHaveText('Optional service credentials');
    await expect(noAuth.locator('[data-source-name="NewsAPI"]')).toHaveCount(0);
    await expect(noAuth.locator('[data-source-name="OpenWeatherMap"]')).toHaveCount(0);
    await expect(optionalCredential.locator('[data-source-name="NewsAPI"]')).toContainText('credential');
    await expect(optionalCredential.locator('[data-source-name="OpenWeatherMap"]')).toContainText('credential');
    await expect(optionalCredential.locator('[data-source-name="OpenWeatherMap"]')).toContainText(/weather.*tile.*overlays/i);
    await expect(optionalCredential.locator('[data-source-name="OpenWeatherMap"]')).not.toContainText(/redundancy/i);
    await expect(welcome).toContainText('Network access and upstream availability still apply');

    // A fresh isolated Playwright context has no persisted browser vault. This
    // is browser-harness evidence only, not packaged Tauri/keychain proof.
    const vaultState = await page.evaluate(async () => {
      const { getVaultState } = await import('/src/services/web-secret-store.ts');
      return getVaultState();
    });
    expect(vaultState).toBe('missing');

    await welcome.getByRole('button', { name: 'Skip for now' }).click();
    await expect(welcome).toBeHidden();
    const shell = page.locator('.home-shell');
    await expect(shell).toBeVisible();

    const cards = shell.locator('.hs-deck-grid .hs-card');
    await expect(cards).toHaveCount(12);
    const sources = shell.locator('.hs-readiness-source');
    await expect(sources).toHaveCount(4);
    expect(await sources.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-source-id'))))
      .toEqual(['usgs', 'gdacs', 'open-meteo', 'gdelt-news']);

    // Exercise the real 30-second startup budget and the next shell refresh.
    await page.waitForTimeout(31_000);
    await expect.poll(async () => cards.evaluateAll((nodes) => nodes.every((node) => (
      node.classList.contains('hs-card-readiness-useful')
        || node.classList.contains('hs-card-readiness-attention')
    ))), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => sources.evaluateAll((nodes) => nodes.every((node) => {
      const state = node.getAttribute('data-source-state');
      return state === 'working' || state === 'degraded' || state === 'unknown';
    })), { timeout: 15_000 }).toBe(true);

    const statusText = await cards.locator('.hs-card-status').allTextContents();
    expect(statusText).toHaveLength(12);
    for (const [index, status] of statusText.entries()) {
      expect(status).not.toMatch(/starting|not loaded|waiting for first panel render/i);
      const card = cards.nth(index);
      await expect(card.getByRole('button', { name: /^Open / })).toBeVisible();
      const useful = await card.evaluate((node) => node.classList.contains('hs-card-readiness-useful'));
      if (useful) {
        expect(status).toMatch(/data contributor working now.*items? in latest update/i);
      } else {
        expect(status).toMatch(/open panel|panel-reported error|panel report/i);
      }
    }

    const isExactZeroWorkingStatus = (text: string): boolean => /^working now\s*·\s*0 items\b/i.test(text);
    expect(isExactZeroWorkingStatus('Working now · 0 items in latest update')).toBe(true);
    expect(isExactZeroWorkingStatus('Working now · 10 items in latest update')).toBe(false);
    for (const source of await sources.all()) {
      const status = await source.locator('.hs-source-status').innerText();
      const text = await source.innerText();
      expect(text).not.toMatch(/still loading|waiting for a successful fresh update/i);
      expect(text).toMatch(/working now|degraded|unknown|saved place/i);
      expect(text).not.toMatch(/provider (?:is )?(?:available|live|healthy)/i);
      if (isExactZeroWorkingStatus(status)) expect(text).toMatch(/not an all-clear signal/i);
    }
  });

  test('boots into the shell and Escape returns to classic', async ({ page }) => {
    await skipFirstRunDialogs(page);
    await page.goto('/');
    const shell = page.locator('.home-shell');
    await expect(shell).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('body')).toHaveClass(/home-shell-active/);
    await page.keyboard.press('Escape');
    await expect(shell).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/home-shell-active/);
  });

  test('classic-view flag boots classic with no shell in DOM', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cb:onboarding-complete', 'true');
      localStorage.setItem('crystalball-classic-view', '1');
    });
    await page.goto('/');
    await expect(page.locator('.mac-sidebar, .header').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.home-shell')).toHaveCount(0);
  });

  test('dossier opens from an injected situation and Escape closes drawer only', async ({ page }) => {
    await skipFirstRunDialogs(page);
    await page.goto('/');
    await expect(page.locator('.home-shell')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(async () => {
      const mod = await import('/src/services/insights/insights-state.ts');
      mod.setRecentEvents([
        {
          eventId: 'e2e-sit',
          description: 'E2E synthetic storm',
          domain: 'weather',
          severity: 90,
          at: Date.now(),
          location: { latitude: 41.6, longitude: -86.7 },
        },
      ]);
      mod.setActiveSituation({
        id: 'e2e-sit',
        title: 'E2E synthetic storm',
        category: 'severe_weather',
        severityScore: 90,
        confidence: 'high',
      });
      document.dispatchEvent(new CustomEvent('cb:open-dossier', { detail: { situationId: 'e2e-sit' } }));
    });
    const drawer = page.locator('.hs-dossier');
    await expect(drawer).toHaveClass(/hs-dossier--open/);
    await expect(page.locator('.hs-dossier .hs-card').first()).toBeVisible();
    await expect(page.locator('.hs-dossier-badge')).toHaveText('ACT SOON · HIGH CONF');
    await page.keyboard.press('Escape');
    await expect(drawer).not.toHaveClass(/hs-dossier--open/);
    await expect(page.locator('.home-shell')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/home-shell-active/);
  });

  test('deck card opens the panel in the focus host and Escape restores it', async ({ page }) => {
    await skipFirstRunDialogs(page);
    await page.goto('/');
    await expect(page.locator('.home-shell')).toBeVisible({ timeout: 30_000 });
    // Scroll the deck into view and open the first pinned card.
    const firstCard = page.locator('.hs-deck-grid .hs-card').first();
    await firstCard.scrollIntoViewIfNeeded();
    const panelKey = await firstCard.getAttribute('data-panel-key');
    await firstCard.getByRole('button', { name: /^Open / }).click();
    const focus = page.locator('.hs-focus');
    await expect(focus).toHaveClass(/hs-focus--open/, { timeout: 10_000 });
    // The REAL panel element is inside the host.
    await expect(page.locator(`.hs-focus-body [data-panel="${panelKey}"]`)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(focus).not.toHaveClass(/hs-focus--open/);
    // Panel returned to the classic grid.
    await expect(page.locator(`#panelsGrid [data-panel="${panelKey}"]`)).toHaveCount(1);
    await expect(page.locator('.home-shell')).toBeVisible();
  });
});

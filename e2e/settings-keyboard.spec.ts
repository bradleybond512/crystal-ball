import { expect as baseExpect, test } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 5000 });

async function mount(page: import('@playwright/test').Page) {
  await page.route('**/tests/settings-keyboard-fixture.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><title>Settings keyboard</title></head><body><button id="outside">Outside</button></body></html>',
  }));
  await page.goto('/tests/settings-keyboard-fixture.html');
  await page.evaluate(async () => {
    await import('/src/styles/main.css');
    const { initI18n } = await import('/src/services/i18n.ts');
    await initI18n();
    const { UnifiedSettings } = await import('/src/components/UnifiedSettings.ts');
    const { SavedPlaceModal } = await import('/src/components/SavedPlaceModal.ts');
    const { getSavedPlace } = await import('/src/services/saved-places.ts');
    const state = window as unknown as { settings: InstanceType<typeof UnifiedSettings>; escaped: number };
    state.escaped = 0;
    document.addEventListener('keydown', event => { if (event.key === 'Escape') state.escaped++; }, true);
    const place = new SavedPlaceModal({ onPickLocationMode: () => {} });
    state.settings = new UnifiedSettings({
      getPanelSettings: () => ({}), togglePanel: () => {}, setPanelsEnabled: () => {},
      getDisabledSources: () => new Set(), toggleSource: () => {}, setSourcesEnabled: () => {},
      getAllSourceNames: () => [], getLocalizedPanelName: (_key: string, fallback: string) => fallback,
      isDesktopApp: false, openCreatePlace: () => place.openCreate(),
      openEditPlace: (id: string) => { const selected = getSavedPlace(id); if (selected) place.openEdit(selected); },
    });
    document.body.append(state.settings.getButton());
  });
}

test.beforeEach(async ({ page }) => mount(page));

test('Settings owns browser Tab traversal at wide and narrow sizes', async ({ page }) => {
  for (const size of [{ width: 1280, height: 720 }, { width: 640, height: 480 }]) {
    await page.setViewportSize(size);
    await page.locator('#unifiedSettingsBtn').click();
    const modal = page.locator('#unifiedSettingsModal');
    const close = modal.getByRole('button', { name: 'Close', exact: true });
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).not.toBeFocused();
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('#unifiedSettingsModal')))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await modal.locator('[data-tab="places"]').click();
    await modal.locator('[data-places-action="add"]').focus();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(modal.locator('[data-places-action="add"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#unifiedSettingsBtn')).toBeFocused();
  }
  expect(await page.evaluate(() => (window as unknown as { escaped: number }).escaped)).toBe(0);
});

test('CSS-hidden, inert and disabled controls cannot become wrap targets', async ({ page }) => {
  await page.locator('#unifiedSettingsBtn').click();
  await page.evaluate(() => {
    document.querySelector('#unifiedSettingsModal')!.innerHTML = '<button style="display:none">Display hidden</button><button id="first">First</button><button disabled>Disabled</button><div inert><button>Inert</button></div><button tabindex="-1">Skipped</button><button id="last">Last</button><button style="visibility:hidden">Invisible</button>';
  });
  await page.locator('#last').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#first')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#last')).toBeFocused();
  await page.locator('#first').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#last')).toBeFocused();
  await page.locator('#outside').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#first')).toBeFocused();
});

test('Places handoff has one active dialog and Escape leaves the underlying Home handler untouched', async ({ page }) => {
  await page.locator('#unifiedSettingsBtn').click();
  await page.locator('[data-tab="places"]').click();
  await page.locator('[data-places-action="add"]').click();
  await expect(page.locator('#unifiedSettingsModal')).not.toHaveClass(/active/);
  await expect(page.locator('#savedPlaceModal')).toHaveClass(/active/);
  await expect(page.locator('.modal-overlay.active')).toHaveCount(1);
  await page.locator('[data-action="pick-map"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#savedPlaceModal')).toHaveClass(/active/);
  await expect(page.locator('.spm-pick-banner')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { escaped: number }).escaped)).toBe(0);
  await page.locator('#unifiedSettingsBtn').click();
  await expect(page.locator('[data-tab="places"]')).toHaveClass(/active/);
});

test('dynamic replacement restores focus while unrelated updates leave it alone', async ({ page }) => {
  await page.locator('#unifiedSettingsBtn').click();
  await page.evaluate(() => document.querySelector('.unified-settings-close')!.remove());
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('#unifiedSettingsModal')))).toBe(true);
  await page.evaluate(() => document.activeElement!.setAttribute('data-previous-focus', 'true'));
  await page.locator('#outside').focus();
  await page.evaluate(() => document.querySelector('[data-previous-focus]')!.remove());
  await expect(page.locator('#outside')).toBeFocused();
});


test('Edit handoff focuses the real saved-place editor', async ({ page }) => {
  await page.evaluate(async () => {
    const { addSavedPlace } = await import('/src/services/saved-places.ts');
    addSavedPlace({ name: 'Keyboard edit fixture', lat: 0, lon: 0 });
  });
  await page.locator('#unifiedSettingsBtn').click();
  await page.locator('[data-tab="places"]').click();
  await page.locator('[data-places-action="edit"]').click();
  await expect(page.locator('#unifiedSettingsModal')).not.toHaveClass(/active/);
  await expect(page.locator('#savedPlaceModal [data-field="name"]')).toBeFocused();
  await expect(page.locator('#savedPlaceModal [data-field="name"]')).toHaveValue('Keyboard edit fixture');
  await expect(page.locator('.modal-overlay.active')).toHaveCount(1);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as unknown as { escaped: number }).escaped)).toBe(0);
});


test('unusable controls at either boundary are excluded from keyboard wrapping', async ({ page }) => {
  await page.locator('#unifiedSettingsBtn').click();
  for (const skipped of [
    '<div hidden><button>Hidden descendant</button></div>',
    '<div inert><button>Inert descendant</button></div>',
    '<button disabled>Disabled</button>',
    '<fieldset disabled><button>Disabled descendant</button></fieldset>',
    '<button tabindex="-1">Programmatic only</button>',
  ]) {
    await page.evaluate(markup => {
      document.querySelector('#unifiedSettingsModal')!.innerHTML = `${markup}<button id="first">First</button><button id="last">Last</button>${markup}`;
    }, skipped);
    await page.locator('#last').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#first')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#last')).toBeFocused();
  }
});

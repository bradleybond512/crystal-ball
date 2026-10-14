import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 5000 });

async function mount(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue();
    return route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.route('**/tests/settings-keyboard-fixture.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><title>Settings keyboard</title></head><body><button id="outside">Outside</button></body></html>',
  }));
  await page.goto('/tests/settings-keyboard-fixture.html');
  await page.evaluate(async () => {
    // Match main.ts: the base stylesheet is layered and shell/theme CSS is not.
    await import('/src/styles/base-layer.css');
    await import('/src/styles/happy-theme.css');
    await import('/src/styles/gods-eye-4d.css');
    await import('/src/styles/modes.css');
    await import('/src/styles/window-chrome.css');
    await import('/src/styles/home-shell.css');
    await import('/src/styles/library.css');
    const { initI18n } = await import('/src/services/i18n.ts');
    await initI18n();
    const { UnifiedSettings } = await import('/src/components/UnifiedSettings.ts');
    const { SavedPlaceModal } = await import('/src/components/SavedPlaceModal.ts');
    const { getSavedPlace } = await import('/src/services/saved-places.ts');
    const { CommandPalettePanel } = await import('/src/components/CommandPalettePanel.ts');
    const { createCommandRegistry } = await import('/src/services/command-palette/command-registry.ts');
    const { paletteCaptureNet } = await import('/src/services/keyboard/shortcut-bootstrap.ts');
    const registry = createCommandRegistry();
    registry.register({ id: 'keyboard-fixture', title: 'Keyboard fixture command', category: 'action', keywords: [], action: () => {} });
    const palette = new CommandPalettePanel({ registry });
    palette.mount(document.body);
    window.addEventListener('keydown', paletteCaptureNet, true);
    document.addEventListener('cb:toggle-cmdk', () => palette.toggle());
    const state = window as unknown as { settings: InstanceType<typeof UnifiedSettings>; escaped: number; underlyingHomeEscapes: number };
    state.underlyingHomeEscapes = 0;
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented) state.underlyingHomeEscapes++;
    });
    state.escaped = 0;
    document.addEventListener('keydown', event => { if (event.key === 'Escape') state.escaped++; }, true);
    const place = new SavedPlaceModal({ onPickLocationMode: () => {} });
    state.settings = new UnifiedSettings({
      getPanelSettings: () => ({}), togglePanel: () => {}, setPanelsEnabled: () => {},
      getDisabledSources: () => new Set(), toggleSource: () => {}, setSourcesEnabled: () => {},
      getAllSourceNames: () => Array.from({ length: 90 }, (_, index) => `Fixture source ${index + 1}`),
      statusPanel: {
        getFeeds: () => new Map(Array.from({ length: 90 }, (_, index) => [String(index), { name: `Fixture feed ${index + 1}`, status: 'live', itemCount: index, lastUpdate: null }])),
        getApis: () => new Map(), formatTime: () => 'Fixture time',
      } as never, getLocalizedPanelName: (_key: string, fallback: string) => fallback,
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


async function openPaletteWithImmediateEscape(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const target = document.activeElement!;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(escape);
    return {
      prevented: escape.defaultPrevented,
      settingsOpen: document.querySelector('#unifiedSettingsModal')!.classList.contains('active'),
      placeOpen: document.querySelector('#savedPlaceModal')!.classList.contains('active'),
      picking: Boolean(document.querySelector('.spm-pick-banner')),
      paletteOpen: Boolean(document.querySelector('.cmdk-v2-overlay:not([hidden])')),
      underlyingHomeEscapes: (window as unknown as { underlyingHomeEscapes: number }).underlyingHomeEscapes,
    };
  });
}

test('real command palette owns keyboard above Settings and returns Tab ownership after hiding', async ({ page }) => {
  await page.locator('#unifiedSettingsBtn').click();
  const immediate = await openPaletteWithImmediateEscape(page);
  expect(immediate).toMatchObject({ prevented: true, settingsOpen: true, paletteOpen: true, underlyingHomeEscapes: 0 });
  await expect(page.locator('.cmdk-v2-input')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.cmdk-v2-row')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.cmdk-v2-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk-v2-overlay')).toBeHidden();
  await expect(page.locator('#unifiedSettingsModal')).toHaveClass(/active/);
  expect(await page.evaluate(() => (window as unknown as { underlyingHomeEscapes: number }).underlyingHomeEscapes)).toBe(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('.unified-settings-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#unifiedSettingsModal')).not.toHaveClass(/active/);
});

test('real command palette preserves saved-place draft and map picking', async ({ page }) => {
  await page.locator('#unifiedSettingsBtn').click();
  await page.locator('[data-tab="places"]').click();
  await page.locator('[data-places-action="add"]').click();
  await page.locator('#savedPlaceModal [data-field="name"]').fill('Unsaved palette draft');
  await page.locator('[data-action="pick-map"]').click();
  await page.locator('[data-action="pick-cancel"]').focus();
  const immediate = await openPaletteWithImmediateEscape(page);
  expect(immediate).toMatchObject({ prevented: true, placeOpen: true, picking: true, paletteOpen: true, underlyingHomeEscapes: 0 });
  await expect(page.locator('.cmdk-v2-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk-v2-overlay')).toBeHidden();
  await expect(page.locator('#savedPlaceModal')).toHaveClass(/active/);
  await expect(page.locator('.spm-pick-banner')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { underlyingHomeEscapes: number }).underlyingHomeEscapes)).toBe(0);
  await page.locator('[data-action="pick-cancel"]').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.spm-pick-banner')).toHaveCount(0);
  await expect(page.locator('#savedPlaceModal [data-field="name"]')).toHaveValue('Unsaved palette draft');
  await expect(page.locator('#savedPlaceModal')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#savedPlaceModal')).not.toHaveClass(/active/);
});


// Real alert renderers, deterministic boundary data, and production shell styles.
// These surfaces are deliberately absent from the eight keyboard-only cases above.
async function mountLayeredSurfaces(page: Page, home = false) {
  await page.evaluate(async (showHome) => {
    await import('/src/styles/macos-native.css');
    await import('/src/styles/home-shell.css');
    const { NotificationStack } = await import('/src/components/NotificationStack.ts');
    const { TriageBar } = await import('/src/components/TriageBar.ts');
    const { AttentionNavigator } = await import('/src/components/AttentionNavigator.ts');
    const { mountImessagePausedNotice } = await import('/src/components/ImessagePausedNotice.ts');
    const { unifiedAlertStore, _setNotifyThrottleForTest } = await import('/src/services/unified-alerts.ts');
    const effects = { review: 0, keepOff: 0, shelfClicks: 0, backgroundClicks: 0 };
    const stack = new NotificationStack();
    stack.mount();
    stack.element.addEventListener('click', () => effects.shelfClicks++);
    new TriageBar().mount(stack.element);
    const navigator = new AttentionNavigator({ onReview: () => { effects.review++; } });
    navigator.mount(stack.element);
    const updateAttention = (count: number) => navigator.update({
      panels: [{ panelId: 'fixture-weather', activeCount: count, maxSeverity: 'critical', maxScore: 99,
        newestEvidenceAt: Date.now(), evidence: [], unreviewedEvidence: [], unreviewedCount: count, promoted: true }],
      severityCounts: { critical: count }, promotedPanelIds: ['fixture-weather'],
    });
    updateAttention(1);
    mountImessagePausedNotice(stack.element, {
      pauseState: () => ({ paused: true, hint: 'fixture recipient', reason: 'recipient_changed' } as never),
      pauseRetained: () => true,
      review: () => { effects.review++; },
      keepOff: async () => { effects.keepOff++; return { ok: true } as never; },
    });
    _setNotifyThrottleForTest(0);
    const alert = { id: 'settings-layer-fixture', source: 'nws', severity: 'critical', title: 'Fixture warning',
      body: 'Sanitized modal layering fixture', timestamp: Date.now(), relevanceScore: 99, acknowledged: false, pinned: false };
    unifiedAlertStore.ingest([alert]);
    document.body.classList.add('is-desktop-macos');
    const style = document.createElement('style');
    style.textContent = `
      html:root { overflow: auto; }
      body.is-desktop-macos { overflow: auto; height: auto; min-height: 2400px; }
      .fixture-main { position: fixed; inset: 40% 0 0; padding-top: 0; }
      #outside, #unifiedSettingsBtn { position: fixed; bottom: 8px; }
      #outside { left: 8px; }
      #unifiedSettingsBtn { right: 8px; }
      .fixture-tall { flex-shrink: 0; height: 2400px; background: linear-gradient(#161d27, #304353); }
      .fixture-home-content { height: 2400px; pointer-events: auto; }
    `;
    document.head.append(style);
    const main = document.createElement('main');
    main.className = 'main-content fixture-main';
    main.innerHTML = '<div class="fixture-tall">Classic fixture background</div>';
    main.addEventListener('click', () => effects.backgroundClicks++);
    document.body.append(main);
    const shell = document.createElement('section');
    shell.className = 'home-shell';
    shell.hidden = !showHome;
    shell.innerHTML = '<div class="home-shell-scroll"><div class="fixture-home-content">Home fixture background</div></div>';
    shell.addEventListener('click', () => effects.backgroundClicks++);
    document.body.append(shell);
    Object.assign(window, {
      fixtureEffects: effects,
      fixtureRefresh: () => {
        unifiedAlertStore.ingest([{ ...alert, title: 'Fixture warning updated', timestamp: Date.now() + 1 }]);
        updateAttention(2);
      },
      fixtureAlerts: () => unifiedAlertStore.getAll().map(({ id, acknowledged, pinned }) => ({ id, acknowledged, pinned })),
    });
    main.scrollTop = 123;
    shell.querySelector('.home-shell-scroll')!.scrollTop = 147;
    window.scrollTo(0, 91);
  }, home);
  await expect(page.locator('.triage-bar')).toBeVisible();
  await expect(page.locator('.attention-navigator')).toBeVisible();
  await expect(page.locator('.cb-imessage-paused')).toBeVisible();
}

async function openSettings(page: Page, tab = 'general') {
  await page.evaluate((selected) => {
    (window as unknown as { settings: { open: (tab: string) => void } }).settings.open(selected);
  }, tab);
  await expect(page.locator('.unified-settings-close')).toBeFocused();
}

async function captureFixture(page: Page, info: TestInfo, name: string) {
  const directory = process.env.SETTINGS_MODAL_EVIDENCE_DIR;
  const path = directory ? `${directory}/${process.env.SETTINGS_MODAL_PHASE ?? 'candidate'}-${name}.png` : info.outputPath(`${name}.png`);
  await page.screenshot({ path });
}

async function expectHit(page: Page, selector: string) {
  expect(await page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  }), `${selector} owns its pointer target`).toBe(true);
}

async function scrollSnapshot(page: Page) {
  return page.evaluate(() => ({
    root: document.scrollingElement!.scrollTop,
    main: document.querySelector('.main-content')!.scrollTop,
    home: document.querySelector('.home-shell-scroll')!.scrollTop,
    shelf: document.querySelector('.alert-shelf')!.scrollTop,
  }));
}

for (const home of [false, true]) {
  test(`Settings owns pointer targets above the populated ${home ? 'Home' : 'classic'} surface`, async ({ page }, info) => {
    await mountLayeredSurfaces(page, home);
    for (const size of [{ width: 2048, height: 1111 }, { width: 640, height: 360 }, { width: 320, height: 240 }]) {
      await page.setViewportSize(size);
      await openSettings(page);
      await captureFixture(page, info, `${home ? 'home' : 'classic'}-${size.width}x${size.height}`);
      for (const selector of ['.modal-title', '.unified-settings-close', '[data-tab="general"]']) await expectHit(page, selector);
      const frame = await page.locator('.unified-settings-modal').boundingBox();
      expect(frame!.y).toBeGreaterThanOrEqual(8);
      expect(frame!.y + frame!.height).toBeLessThanOrEqual(size.height - 8);
      await page.mouse.click(2, 2);
      await expect(page.locator('#unifiedSettingsModal')).not.toHaveClass(/active/);
    }
    expect(await page.evaluate(() => (window as unknown as { fixtureEffects: unknown }).fixtureEffects))
      .toEqual({ review: 0, keepOff: 0, shelfClicks: 0, backgroundClicks: 0 });
  });
}

test('Settings has one content scroller and keeps header, tabs and last controls reachable', async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await mountLayeredSurfaces(page);
  for (const tab of ['general', 'sources', 'status', 'api-keys', 'thresholds', 'help', 'debug']) {
    await openSettings(page, tab);
    const panel = page.locator('.unified-settings-tab-panel.active');
    const closeBefore = await page.locator('.unified-settings-close').boundingBox();
    const tabsBefore = await page.locator('.unified-settings-tabs').boundingBox();
    await captureFixture(page, info, `scroll-${tab}`);
    const owners = await page.locator('.unified-settings-modal').evaluate(modal => [modal, ...modal.querySelectorAll<HTMLElement>('*')]
      .filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)
      .map(element => element.className));
    expect(owners, `${tab} has only the active panel scrollbar`).toEqual([`unified-settings-tab-panel active`]);
    await panel.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('.unified-settings-close').boundingBox()).toEqual(closeBefore);
    expect(await page.locator('.unified-settings-tabs').boundingBox()).toEqual(tabsBefore);
    const last = panel.locator('button, input, select, a, .status-row, .us-debug-empty').last();
    const lastBounds = await last.boundingBox();
    const panelBounds = await panel.boundingBox();
    expect(lastBounds!.y + lastBounds!.height).toBeLessThanOrEqual(panelBounds!.y + panelBounds!.height + 1);
    await expectHit(page, '.unified-settings-close');
    await page.keyboard.press('Escape');
  }
});

for (const home of [false, true]) {
  test(`Settings contains wheel input and releases original ${home ? 'Home' : 'classic'} scroll positions and styles on every exit`, async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await mountLayeredSurfaces(page, home);
  const original = await scrollSnapshot(page);
  expect(original.root).toBeGreaterThan(0);
  expect(original.main).toBeGreaterThan(0);
  if (home) expect(original.home).toBeGreaterThan(0);
  const originalOverflow = await page.locator('html, body, .main-content, .home-shell-scroll').evaluateAll(elements => elements.map(element => getComputedStyle(element).overflowY));
  expect(originalOverflow, 'closed Settings leaves background scroll containers unlocked').toEqual(['auto', 'auto', 'auto', 'auto']);
  const inlineStyles = await page.locator('html, body, .main-content, .home-shell-scroll').evaluateAll(elements => elements.map(element => element.getAttribute('style')));
  for (const exit of ['close', 'escape', 'backdrop', 'destroy']) {
    await openSettings(page);
    expect(await page.locator('html, body, .main-content, .home-shell-scroll').evaluateAll(elements => elements.map(element => getComputedStyle(element).overflowY)))
      .toEqual(['hidden', 'hidden', 'hidden', 'hidden']);
    const panel = page.locator('.unified-settings-tab-panel.active');
    await panel.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await panel.hover();
    await page.mouse.wheel(0, 900);
    await page.mouse.move(2, 2);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(150);
    expect(await scrollSnapshot(page)).toEqual(original);
    if (exit === 'close') await page.locator('.unified-settings-close').click();
    else if (exit === 'escape') await page.keyboard.press('Escape');
    else if (exit === 'backdrop') await page.mouse.click(2, 2);
    else await page.evaluate(() => (window as unknown as { settings: { destroy: () => void } }).settings.destroy());
    expect(await scrollSnapshot(page)).toEqual(original);
    expect(await page.locator('html, body, .main-content, .home-shell-scroll').evaluateAll(elements => elements.map(element => getComputedStyle(element).overflowY))).toEqual(originalOverflow);
    expect(await page.locator('html, body, .main-content, .home-shell-scroll').evaluateAll(elements => elements.map(element => element.getAttribute('style')))).toEqual(inlineStyles);
  }
  });
}

test('real Places Edit and foreground palette retain ownership while alert subscribers keep rendering', async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await mountLayeredSurfaces(page);
  await page.evaluate(async () => {
    const { addSavedPlace } = await import('/src/services/saved-places.ts');
    addSavedPlace({ name: 'Sanitized fixture place', lat: 0, lon: 0 });
  });
  const before = await scrollSnapshot(page);
  await openSettings(page, 'places');
  await page.evaluate(() => (window as unknown as { fixtureRefresh: () => void }).fixtureRefresh());
  await expect(page.locator('.triage-bar')).toContainText('Fixture warning updated');
  await expect(page.locator('.attention-navigator-summary')).toContainText('2');
  expect(await page.evaluate(() => (window as unknown as { fixtureAlerts: () => unknown }).fixtureAlerts()))
    .toEqual([{ id: 'settings-layer-fixture', acknowledged: false, pinned: false }]);
  const palette = await openPaletteWithImmediateEscape(page);
  expect(palette).toMatchObject({ prevented: true, settingsOpen: true, paletteOpen: true, underlyingHomeEscapes: 0 });
  await expect(page.locator('.cmdk-v2-input')).toBeFocused();
  await expectHit(page, '.cmdk-v2-input');
  await page.keyboard.press('Tab');
  await expect(page.locator('.cmdk-v2-row')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.cmdk-v2-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk-v2-overlay')).toBeHidden();
  await page.locator('[data-places-action="edit"]').click();
  await expect(page.locator('#savedPlaceModal [data-field="name"]')).toBeFocused();
  await captureFixture(page, info, 'places-edit');
  await expectHit(page, '#savedPlaceModal [data-field="name"]');
  await expect(page.locator('.modal-overlay.active')).toHaveCount(1);
  expect(await scrollSnapshot(page)).toEqual(before);
  await expect(page.locator('.main-content')).toHaveCSS('overflow-y', 'auto');
  await page.evaluate(() => (window as unknown as { fixtureRefresh: () => void }).fixtureRefresh());
  await expect(page.locator('.triage-bar')).toContainText('Fixture warning updated');
  await expect(page.locator('.attention-navigator-summary')).toContainText('2');
  expect(await page.evaluate(() => (window as unknown as { fixtureAlerts: () => unknown }).fixtureAlerts()))
    .toEqual([{ id: 'settings-layer-fixture', acknowledged: false, pinned: false }]);
  await page.locator('[data-action="pick-map"]').click();
  await expect(page.locator('.spm-pick-banner')).toBeVisible();
  await expect(page.locator('.main-content')).toHaveCSS('overflow-y', 'auto');
  await page.keyboard.press('Escape');
  await expect(page.locator('#savedPlaceModal [data-field="name"]')).toHaveValue('Sanitized fixture place');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { fixtureEffects: unknown }).fixtureEffects))
    .toEqual({ review: 0, keepOff: 0, shelfClicks: 0, backgroundClicks: 0 });
});

import { expect, test, type Page, type TestInfo } from '@playwright/test';

const FIXTURE = '/e2e/fixtures/smoked-glass/index.html';
const FIXED_NOW = Date.UTC(2026, 7, 31, 12, 0, 0);
const TARGETS = [
  '.home-shell-topbar', '.home-shell-intel-island', '.home-shell-ribbon',
  '.mac-sidebar', '.mac-content-toolbar', '.map-controls', '.time-slider', '.layer-toggles',
  '.library-overlay', '.cmdk-v2-panel', '.unified-settings-modal',
] as const;

async function openFixture(page: Page, testInfo: TestInfo): Promise<string[]> {
  const externalRequests: string[] = [];
  await page.clock.install({ time: FIXED_NOW });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      externalRequests.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.goto(FIXTURE);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await page.evaluate(() => document.fonts.ready);
  await testInfo.attach('fixture-metadata', {
    body: JSON.stringify({ fixedNow: FIXED_NOW, locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    contentType: 'application/json',
  });
  return externalRequests;
}

async function setState(page: Page, state: 'home' | 'classic' | 'library' | 'command' | 'settings', backdrop: 'dark' | 'satellite' = 'dark'): Promise<void> {
  await page.evaluate(({ state, backdrop }) => window.__UX025_FIXTURE__.setState(state, backdrop), { state, backdrop });
}

async function materialAudit(page: Page): Promise<{ count: number; nestedPairs: string[]; nodes: unknown[] }> {
  return page.evaluate((selectors) => {
    const elements = [...document.querySelectorAll<HTMLElement>(selectors.join(','))].filter((element) => {
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.backdropFilter !== 'none';
    });
    return {
      count: elements.length,
      nestedPairs: elements.flatMap((ancestor) => elements
        .filter((descendant) => ancestor !== descendant && ancestor.contains(descendant))
        .map((descendant) => `${ancestor.className} > ${descendant.className}`)),
      nodes: elements.map((element) => ({ className: element.className, filter: getComputedStyle(element).backdropFilter })),
    };
  }, [...TARGETS]);
}

test.describe('UX-025 deterministic smoked glass fixture', () => {
  test('material interface and Home island are present in Full dark desktop', async ({ page }, testInfo) => {
    const external = await openFixture(page, testInfo);
    await setState(page, 'home', 'dark');
    await expect(page.locator('.home-shell')).toBeVisible();
    expect(await page.locator('.home-shell-intel-island').count()).toBe(1);
    const tokens = await page.locator('body').evaluate((body) => {
      const style = getComputedStyle(body);
      return {
        canvas: style.getPropertyValue('--ux025-canvas').trim(),
        chrome: style.getPropertyValue('--ux025-chrome-bg').trim(),
        raised: style.getPropertyValue('--ux025-raised-bg').trim(),
      };
    });
    expect(tokens.canvas).toBe('#05070b');
    expect(tokens.chrome).toMatch(/^rgba\(/);
    expect(tokens.raised).toMatch(/^rgba\(/);
    await expect(page.locator('.home-shell-intel-island')).toHaveCSS('border-radius', '22px');
    expect(external).toEqual([]);
  });

  for (const viewport of [
    { width: 1024, height: 640 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    test(`Home audit is bounded at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const external = await openFixture(page, testInfo);
      await setState(page, 'home', viewport.width === 1440 ? 'satellite' : 'dark');
      const audit = await materialAudit(page);
      await testInfo.attach('material-audit', { body: JSON.stringify(audit, null, 2), contentType: 'application/json' });
      expect(audit.count).toBe(3);
      expect(audit.nestedPairs).toEqual([]);
      expect(external).toEqual([]);
    });
  }

  test('classic baseline assigns exactly two non-nested target glass nodes', async ({ page }, testInfo) => {
    const external = await openFixture(page, testInfo);
    await setState(page, 'classic');
    const audit = await materialAudit(page);
    await testInfo.attach('classic-material-audit', { body: JSON.stringify(audit, null, 2), contentType: 'application/json' });
    expect(audit.count).toBe(2);
    expect(audit.nestedPairs).toEqual([]);
    expect(external).toEqual([]);
  });

  test('classic and reachable sheets expose stable names, focus, and hit targets', async ({ page }, testInfo) => {
    const external = await openFixture(page, testInfo);
    await setState(page, 'classic');
    await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible();
    await setState(page, 'library');
    await expect(page.getByRole('button', { name: 'Close ⎋' })).toBeVisible();
    await setState(page, 'command');
    const search = page.getByRole('textbox', { name: 'Command palette search' });
    await expect(search).toBeFocused();
    const undersized = await page.locator('.cmdk-v2-panel button, .cmdk-v2-panel input').evaluateAll((nodes) => nodes
      .map((node) => ({ name: node.getAttribute('aria-label') ?? node.textContent?.trim(), rect: node.getBoundingClientRect().toJSON() }))
      .filter(({ rect }) => rect.width < 28 || rect.height < 28));
    expect(undersized).toEqual([]);
    await setState(page, 'settings');
    const settingsDialog = page.locator('#unifiedSettingsModal[role="dialog"]');
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog).toHaveAttribute('aria-label', /\S+/);
    expect(external).toEqual([]);
  });

  test('command palette exposes a visible keyboard focus indicator', async ({ page }, testInfo) => {
    const external = await openFixture(page, testInfo);
    await setState(page, 'command');
    const search = page.getByRole('textbox', { name: 'Command palette search' });
    await expect(search).toBeFocused();
    const focusIndicator = await search.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        boxShadow: style.boxShadow,
      };
    });
    expect(
      (focusIndicator.outlineStyle !== 'none' && focusIndicator.outlineWidth >= 2)
        || focusIndicator.boxShadow !== 'none',
    ).toBe(true);
    expect(external).toEqual([]);
  });

  test('200% zoom and long labels stay reachable without horizontal overflow', async ({ page }, testInfo) => {
    // A 1280x720 display at 200% browser zoom exposes a 640x360 CSS viewport.
    // CSS `zoom: 2` is not equivalent: it mechanically doubles fixed 100vw
    // boxes and manufactures overflow that real browser zoom does not.
    await page.setViewportSize({ width: 640, height: 360 });
    const external = await openFixture(page, testInfo);
    await setState(page, 'home');
    await page.locator('.home-shell-brand').evaluate((element) => { element.textContent = 'Crystal Ball — Global Intelligence Operations and Readiness'; });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: /Classic view/ })).toBeVisible();
    expect(external).toEqual([]);
  });

  test('specialist material and excluded variants do not inherit UX-025', async ({ page }, testInfo) => {
    const external = await openFixture(page, testInfo);
    const baseline = await page.locator('.eew-status-bar').evaluate((element) => getComputedStyle(element).backdropFilter);
    expect(baseline).toContain('blur(22px)');
    for (const variant of ['tech', 'finance', 'happy']) {
      const values = await page.locator('body').evaluate((body, value) => {
        document.documentElement.dataset.variant = value;
        const style = getComputedStyle(body);
        return [style.getPropertyValue('--ux025-canvas').trim(), style.getPropertyValue('--ux025-chrome-bg').trim()];
      }, variant);
      expect(values).toEqual(['', '']);
    }
    await page.locator('body').evaluate((body) => {
      document.documentElement.dataset.variant = 'full';
      document.documentElement.dataset.theme = 'light';
      return getComputedStyle(body).getPropertyValue('--ux025-canvas').trim();
    }).then((value) => expect(value).toBe(''));
    expect(external).toEqual([]);
  });
});

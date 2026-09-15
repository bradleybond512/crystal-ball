import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const expectStyle = expect.configure({ timeout: 5000 });
const happyBuild = process.env.VITE_VARIANT === 'happy';
const themeToggle = (page: Page) => page.getByRole('button', { name: 'Toggle dark/light mode' }).filter({ visible: true });

async function expectTheme(page: Page, theme: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 5000 });
  expect(await page.locator('body').getAttribute('data-theme')).toBeNull();
}

async function openEntry(page: Page, entry: 'main' | 'settings'): Promise<void> {
  await page.goto(entry === 'main' ? '/?e2e=ui-only' : '/settings.html');
  if (entry === 'main') await expect(themeToggle(page)).toBeVisible();
  else await expect(page.locator('#contentArea')).not.toBeEmpty();
}

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.pathname.startsWith('/api/')) {
      await route.continue();
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem('crystalball-classic-view', '1');
    localStorage.setItem('cb:onboarding-complete', 'true');
    localStorage.setItem('wm-analytics-consent', 'false');
    localStorage.setItem('wm-analytics-consent-prompt-seen', 'true');
    // No theme or variant is injected: startup must resolve the actual build.
    (window as Window & { initialVariantPreference: string | null }).initialVariantPreference = localStorage.getItem('crystalball-variant');
    (window as Window & { themeEvents: string[] }).themeEvents = [];
    window.addEventListener('theme-changed', (event) => {
      (window as Window & { themeEvents: string[] }).themeEvents.push((event as CustomEvent<{ theme: string }>).detail.theme);
    });
  });
});

for (const entry of ['main', 'settings'] as const) {
  test(`${entry} bootstrap follows repeated system changes without storing a choice`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openEntry(page, entry);
    await expect(page.locator('html')).toHaveAttribute('data-variant', happyBuild ? 'happy' : 'full', { timeout: 5000 });
    await expectTheme(page, happyBuild ? 'light' : 'dark');
    for (const colorScheme of ['light', 'dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(colorScheme === 'dark');
      if (happyBuild) await page.waitForTimeout(100);
      await expectTheme(page, happyBuild ? 'light' : colorScheme);
      expect(await page.evaluate(() => localStorage.getItem('crystalball-theme'))).toBeNull();
    }
    const events = await page.evaluate(() => (window as Window & { themeEvents: string[] }).themeEvents);
    expect(events).toEqual(happyBuild ? [] : ['light', 'dark', 'light']);
    expect(await page.evaluate(() => (window as Window & { initialVariantPreference: string | null }).initialVariantPreference)).toBeNull();
  });
}

for (const choice of ['dark', 'light'] as const) {
  test(`manual ${choice} survives system changes and reload`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openEntry(page, 'main');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'light');
    await themeToggle(page).click();
    if (choice === 'light') await themeToggle(page).click();
    await expectTheme(page, choice);
    expect(await page.evaluate(() => localStorage.getItem('crystalball-theme'))).toBe(choice);
    for (const colorScheme of ['dark', 'light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.waitForTimeout(100);
      await expectTheme(page, choice);
    }
    await page.reload();
    await expect(themeToggle(page)).toBeVisible();
    await expectTheme(page, choice);
    await openEntry(page, 'settings');
    await expectTheme(page, choice);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(100);
    await expectTheme(page, choice);
    expect(await page.evaluate(() => localStorage.getItem('crystalball-theme'))).toBe(choice);
  });
}

test('native light styles win with html-owned theme and production CSS layers', async ({ page }) => {
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const styleImports = [...mainSource.matchAll(/^import '(\.\/styles\/[^']+\.css)';$/gm)]
    .map((match) => `<link rel="stylesheet" href="/src/${match[1]!.slice(2)}">`).join('\n');
  expect(styleImports).toContain('/src/styles/base-layer.css');
  expect(styleImports).toContain('/src/styles/window-chrome.css');
  await page.route('**/system-theme-fixture.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html data-theme="dark" data-variant="full"><head>${styleImports}<script>window.addEventListener('load',()=>document.documentElement.dataset.stylesReady='true');</script></head><body class="is-desktop-macos"><div class="app-root"><div class="mac-content-toolbar">Toolbar</div><section class="map-section"><div class="panel-header">Map</div></section><div id="scroll" style="width:200px;height:100px;overflow:scroll"><div style="height:1000px">Scrollable content</div></div></div></body></html>`,
  }));
  await page.goto('/system-theme-fixture.html');
  await expect(page.locator('html')).toHaveAttribute('data-styles-ready', 'true');
  for (const theme of ['dark', 'light', 'dark'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expectTheme(page, theme);
    const light = theme === 'light';
    await expectStyle(page.locator('.app-root')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.55)' : 'rgba(20, 20, 30, 0.55)');
    await expectStyle(page.locator('.mac-content-toolbar')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.85)' : 'rgba(28, 28, 30, 0.85)');
    await expectStyle(page.locator('.panel-header')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.6)' : 'rgba(28, 28, 30, 0.6)');
    expect(await page.locator('#scroll').evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor)).toBe(light ? 'rgba(0, 0, 0, 0.28)' : 'rgba(120, 120, 120, 0.55)');
    // CSSOM checks hover-rule applicability; this does not claim a WKWebView pointer test.
    const hoverColors = await page.locator('#scroll').evaluate((element) => {
      const colors: string[] = [];
      const inspect = (rules: CSSRuleList): void => {
        for (const rule of rules) {
          if (rule instanceof CSSImportRule && rule.styleSheet) inspect(rule.styleSheet.cssRules);
          else if (rule instanceof CSSGroupingRule) inspect(rule.cssRules);
          else if (rule instanceof CSSStyleRule) {
            const applies = rule.selectorText.split(',').some((selector) => {
              if (!selector.trim().endsWith('::-webkit-scrollbar-thumb:hover')) return false;
              const owner = selector.replace('::-webkit-scrollbar-thumb:hover', '');
              return element.matches(/\s$/.test(owner) ? `${owner}*` : owner);
            });
            if (applies) colors.push(rule.style.backgroundColor);
          }
        }
      };
      for (const sheet of document.styleSheets) inspect(sheet.cssRules);
      return colors;
    });
    expect(hoverColors.at(-1)).toBe(light ? 'rgba(0, 0, 0, 0.5)' : 'rgba(100, 100, 100, 0.8)');
    await expectStyle(page.locator('.app-root')).toHaveCSS('backdrop-filter', 'blur(20px) saturate(1.8)');
    await expectStyle(page.locator('.mac-content-toolbar')).toHaveCSS('backdrop-filter', 'blur(24px) saturate(1.8)');
  }
});

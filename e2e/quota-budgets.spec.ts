import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { SystemDiagnosticPanel } from '../src/components/SystemDiagnosticPanel';
import type { disclosureService } from '../src/services/ui/progressive-disclosure';
type QuotaWindow = Window & { __TAURI__?: Record<string, never>; __quotaFixture: { p: SystemDiagnosticPanel; disclosureService: typeof disclosureService } };
test.beforeEach(async ({ context, baseURL }) => {
 const origin = new URL(baseURL!).origin;
 await context.route('**/*', route => {
  const u = new URL(route.request().url());
  return u.origin === origin && !u.pathname.startsWith('/api/') ? route.continue() : route.abort('blockedbyclient');
 });
 await context.routeWebSocket('**/*', socket => socket.close());
});
function report() {
 const now = Date.now();
 return { asOf: now - 60000, targetShare: 0.8, throttledHosts: [], providers: ['ok','paced','background_paused','cooldown'].map((state, i) => ({ id: `fixture-${i}`, label: i === 3 ? '<img src=x onerror=alert(1)>' : `Fixture ${i}`, unit: 'requests', estimate: i === 3, unverified: i === 2, observeOnly: i === 3, state, windows: [{ windowMs: 86400000, limit: i === 3 ? null : 100, backgroundCeiling: i === 3 ? null : 80, used: i * 30 }], cooldownUntil: i === 3 ? now + 60000 : null, cooldownReason: i === 3 ? '429' : null, budgetFreesAt: i === 2 ? now + 120000 : null, providerRemaining: null, last429At: null })) };
}
async function mount(page: Page, desktop: boolean) {
 await page.route('**/tests/quota-status-harness.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Quota UI acceptance fixture</title></head><body style="margin:0"><main id="fixture"></main></body></html>' }));
 await page.goto('/tests/quota-status-harness.html');
 await page.evaluate(async desktop => {
  if (desktop) (window as unknown as QuotaWindow).__TAURI__ = {}; // Detection only: no native invoke bridge.
  const cssPath = '/src/styles/base-layer.css';
  await import(/* @vite-ignore */ cssPath);
  const { disclosureService } = await import(/* @vite-ignore */ '/src/services/ui/progressive-disclosure.ts');
  disclosureService.setLevel('system-diagnostic', 'detail');
  const { SystemDiagnosticPanel } = await import(/* @vite-ignore */ '/src/components/SystemDiagnosticPanel.ts');
  const p = new SystemDiagnosticPanel();
  const element = p.getElement(); element.style.cssText = 'display:block;width:100%;min-height:600px;position:relative;';
  document.querySelector('#fixture')!.append(element);
  (window as unknown as QuotaWindow).__quotaFixture = { p, disclosureService };
 }, desktop);
}
test('actual web Diagnostics stays unavailable and never requests remote quota data', async ({ page }) => {
 let requests = 0;
 await page.route('**/api/quota/status', route => { requests++; return route.fulfill({ json: report() }); });
 await mount(page, false);
 const button = page.getByRole('button', { name: 'API Budgets', exact: true });
 await button.click();
 await expect(page.getByText(/desktop sidecar required/)).toBeVisible();
 await expect(button).toBeFocused(); await expect(button).toHaveAttribute('aria-pressed', 'true');
 expect(requests).toBe(0);
});
test('actual lazy budgets view loads once, preserves focus, escapes data and handles disclosure and teardown', async ({ page }, testInfo) => {
 let calls = 0; let release: () => void = () => {}; const gate = new Promise<void>(r => release = r);
 await page.route('**/api/quota/status', async route => { calls++; await gate; await route.fulfill({ json: report(), headers: { 'access-control-allow-origin': '*', 'cache-control': 'private, no-store' } }); });
 await mount(page, true);
 const button = page.getByRole('button', { name: 'API Budgets', exact: true });
 await button.click(); await expect(page.getByText('Loading API budgets…', { exact: true })).toBeVisible();
 await expect.poll(() => calls).toBe(1); await button.click(); expect(calls).toBe(1);
 release(); await expect(page.locator('.syd-quota-row')).toHaveCount(4);
 await expect(button).toBeFocused();
 await expect(page.locator('.syd-quota')).toContainText('Background paused');
 await expect(page.locator('.syd-quota')).toContainText('Provider cooldown');
 await expect(page.locator('.syd-quota')).toContainText('No app numeric cap');
 await expect(page.locator('.syd-quota')).toContainText('usage counts, not provider responses');
 await expect(page.locator('.syd-quota')).toContainText('PurpleAir responses remain memory-only');
 await expect(page.locator('.syd-quota img')).toHaveCount(0);
 await expect(page.locator('.syd-quota')).toContainText('<img src=x onerror=alert(1)>');
 await expect(page.getByRole('meter')).toHaveCount(3);
 await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Quality Debt', exact: true })).toBeFocused();
 await page.getByRole('button', { name: 'Feeds', exact: true }).click(); await expect(page.locator('.syd-quota')).toHaveCount(0);
 await button.click(); await expect(page.locator('.syd-quota-row')).toHaveCount(4); expect(calls).toBe(1);
 await page.evaluate(() => (window as unknown as QuotaWindow).__quotaFixture.disclosureService.setLevel('system-diagnostic', 'summary'));
 await expect(button).toHaveCount(0);
 await page.evaluate(() => (window as unknown as QuotaWindow).__quotaFixture.disclosureService.setLevel('system-diagnostic', 'detail'));
 await expect(page.locator('.syd-quota-row')).toHaveCount(4); expect(calls).toBe(1);
 await page.setViewportSize({ width: 390, height: 844 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 expect(await page.locator('.syd-tabs').evaluate(tabs => { const parent = tabs.getBoundingClientRect(); return Array.from(tabs.querySelectorAll('button')).every(button => { const r = button.getBoundingClientRect(); return r.left >= parent.left && r.right <= parent.right + 1; }); })).toBe(true);
 const audit = await new AxeBuilder({ page }).include('.syd-tabs').include('.syd-quota').analyze();
 await testInfo.attach('quota-accessibility', { body: JSON.stringify(audit, null, 2), contentType: 'application/json' });
 expect(audit.violations).toEqual([]);
 await page.locator('.syd-quota-row').last().scrollIntoViewIfNeeded(); await expect(page.locator('.syd-quota-row').last()).toBeVisible();
 await page.screenshot({ path: testInfo.outputPath('budgets-narrow.png'), fullPage: true });
 await page.evaluate(() => { const p = (window as unknown as QuotaWindow).__quotaFixture.p; p.destroy(); p.getElement().remove(); });
 await expect(page.locator('.syd-quota')).toHaveCount(0); expect(calls).toBe(1);
});

test('pending actual budgets request cannot replace another tab or a dismissed panel', async ({ page }) => {
 const releases: Array<() => void> = []; const errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.route('**/api/quota/status', async route => { await new Promise<void>(resolve => releases.push(resolve)); try { await route.fulfill({ json: report(), headers: { 'access-control-allow-origin': '*' } }); } catch { /* The aborted browser request may no longer accept a response. */ } });
 await mount(page, true);
 await page.getByRole('button', { name: 'API Budgets', exact: true }).click();
 await expect.poll(() => releases.length).toBe(1);
 await page.getByRole('button', { name: 'Feeds', exact: true }).click();
 releases[0]();
 await expect(page.getByRole('button', { name: 'Feeds', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect(page.locator('.syd-quota')).toHaveCount(0);
 await page.getByRole('button', { name: 'API Budgets', exact: true }).click();
 await expect.poll(() => releases.length).toBe(2);
 await page.evaluate(() => { const p = (window as unknown as QuotaWindow).__quotaFixture.p; p.destroy(); p.getElement().remove(); });
 releases[1]();
 await expect(page.locator('.syd-quota')).toHaveCount(0);
 expect(errors).toEqual([]);
});

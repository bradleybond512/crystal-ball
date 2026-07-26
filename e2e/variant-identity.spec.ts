import { expect, test } from '@playwright/test';

const variant = process.env.VITE_VARIANT ?? 'full';
const titles: Record<string, RegExp> = {
  full: /Crystal Ball/,
  tech: /Tech Monitor/,
  finance: /Finance Monitor/,
  happy: /Happy Monitor/,
};

test('requested variant owns the document identity', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(titles[variant]);
  const root = page.locator('html');
  if (variant === 'full') {
    await expect(root).not.toHaveAttribute('data-variant');
  } else {
    await expect(root).toHaveAttribute('data-variant', variant);
  }
});

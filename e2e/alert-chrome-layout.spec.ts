import { expect, test } from '@playwright/test';

test('fixed alert chrome stays clear of web header controls', async ({ page }) => {
  await page.goto('/tests/runtime-harness.html');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/src/styles/main.css';
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => reject(new Error('main.css failed to load')), { once: true });
      document.head.append(link);
    });

    document.body.innerHTML = `
      <div class="eew-status-bar eew-bar-red">
        <div class="eew-bar-main"><span class="eew-bar-subtitle">Safety review</span></div>
      </div>
      <div class="just-in-rail">
        <div class="just-in-row"><span class="just-in-src">correlation</span><span class="just-in-title">Breaking signal</span></div>
      </div>
      <div id="app">
        <header class="header"><span>Crystal Ball</span><button id="primaryControl">Primary control</button></header>
      </div>
    `;
    document.documentElement.style.setProperty('--web-header-h', '64px');
  });

  const geometry = await page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    };
    const control = document.querySelector('#primaryControl')!;
    const controlRect = control.getBoundingClientRect();
    const hit = document.elementFromPoint(
      controlRect.left + controlRect.width / 2,
      controlRect.top + controlRect.height / 2,
    );
    return {
      app: box('#app'),
      eew: box('.eew-status-bar'),
      header: box('.header'),
      headerHeight: document.querySelector('.header')!.getBoundingClientRect().height,
      justIn: box('.just-in-rail'),
      controlReceivesPointer: hit === control || control.contains(hit),
    };
  });

  expect(geometry.app.top).toBeGreaterThanOrEqual(geometry.eew.bottom);
  expect(geometry.headerHeight).toBe(64);
  expect(geometry.justIn.top).toBeGreaterThanOrEqual(geometry.header.bottom);
  expect(geometry.controlReceivesPointer).toBe(true);
});

test('macOS Just In rail stays below the dynamic alert stack', async ({ page }) => {
  await page.goto('/tests/runtime-harness.html');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/src/styles/main.css';
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => reject(new Error('main.css failed to load')), { once: true });
      document.head.append(link);
    });

    document.body.classList.add('is-desktop-macos');
    document.body.innerHTML = `
      <div class="eew-status-bar eew-bar-red">
        <div class="eew-bar-main"><span class="eew-bar-subtitle">Safety review</span></div>
      </div>
      <div class="just-in-rail">
        <div class="just-in-row"><span class="just-in-src">correlation</span><span class="just-in-title">Breaking signal</span></div>
      </div>
    `;
  });

  const geometry = await page.evaluate(() => {
    const eew = document.querySelector('.eew-status-bar')!.getBoundingClientRect();
    const justIn = document.querySelector('.just-in-rail')!.getBoundingClientRect();
    return { eewBottom: eew.bottom, justInTop: justIn.top };
  });

  expect(geometry.justInTop).toBeGreaterThanOrEqual(geometry.eewBottom);
});

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

test('macOS alert chrome uses neutral material and amber stale-data hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
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
        <button class="eew-bar-main" type="button" aria-expanded="false">
          <span class="eew-bar-label">Severe weather</span>
          <span class="eew-bar-subtitle">A saved place is affected</span>
        </button>
      </div>
      <div class="alert-shelf" id="cb-notification-stack">
        <div class="cb-offline-staleness-banner" data-status="stale">
          <span class="cb-osb-icon" aria-hidden="true">!</span>
          <span class="cb-osb-text">
            <span class="cb-osb-label">Viewing cached data.</span>
            <span class="cb-osb-subtext">Last updated 30m ago</span>
          </span>
          <span class="cb-osb-actions">
            <button class="cb-osb-reset" type="button" aria-label="Clear cache and reload">↻</button>
            <button class="cb-osb-dismiss" type="button" aria-label="Dismiss staleness notice">×</button>
          </span>
        </div>
      </div>
    `;
  });

  const appearance = await page.evaluate(() => {
    const status = document.querySelector<HTMLElement>('.eew-status-bar')!;
    const statusLabel = document.querySelector<HTMLElement>('.eew-bar-label')!;
    const banner = document.querySelector<HTMLElement>('.cb-offline-staleness-banner')!;
    const label = document.querySelector<HTMLElement>('.cb-osb-label')!;
    const subtext = document.querySelector<HTMLElement>('.cb-osb-subtext')!;
    const actions = [...document.querySelectorAll<HTMLElement>('.cb-osb-actions button')];
    const statusStyle = getComputedStyle(status);
    return {
      statusBackground: statusStyle.backgroundColor,
      statusBackgroundImage: statusStyle.backgroundImage,
      statusBorderBottom: statusStyle.borderBottomWidth,
      statusRadius: Number.parseFloat(statusStyle.borderTopLeftRadius),
      statusLabelColor: getComputedStyle(statusLabel).color,
      bannerColor: getComputedStyle(banner).color,
      labelColor: getComputedStyle(label).color,
      subtextColor: getComputedStyle(subtext).color,
      actionSizes: actions.map((action) => {
        const rect = action.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  expect(appearance.statusBackground).not.toBe('rgba(220, 38, 38, 0.92)');
  expect(appearance.statusBackgroundImage).not.toBe('none');
  expect(appearance.statusBorderBottom).toBe('0px');
  expect(appearance.statusRadius).toBeGreaterThanOrEqual(6);
  expect(appearance.statusLabelColor).not.toBe('rgb(255, 255, 255)');
  expect(appearance.bannerColor).not.toBe('rgb(255, 255, 255)');
  expect(appearance.labelColor).not.toBe('rgb(255, 255, 255)');
  expect(appearance.subtextColor).not.toBe('rgb(255, 255, 255)');
  for (const size of appearance.actionSizes) {
    expect(size.width).toBeGreaterThanOrEqual(28);
    expect(size.height).toBeGreaterThanOrEqual(28);
  }
  expect(appearance.documentWidth).toBeLessThanOrEqual(appearance.viewportWidth);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.cb-offline-staleness-banner')).toHaveCSS('animation-name', 'none');

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await page.evaluate(() => {
    const shelf = document.querySelector<HTMLElement>('#cb-notification-stack')!.getBoundingClientRect();
    const banner = document.querySelector<HTMLElement>('.cb-offline-staleness-banner')!.getBoundingClientRect();
    return {
      shelfLeft: shelf.left,
      bannerLeft: banner.left,
      bannerRight: banner.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(mobileGeometry.shelfLeft).toBe(0);
  expect(mobileGeometry.bannerLeft).toBeLessThanOrEqual(8.5);
  expect(mobileGeometry.bannerRight).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
});

import { expect, test } from '@playwright/test';

test('fixed alert chrome stays clear of web header controls', async ({ page }) => {
  await page.goto('/tests/runtime-harness.html');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `/src/styles/main.css?alert-chrome=${Date.now()}`;
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
      link.href = `/src/styles/main.css?alert-chrome=${Date.now()}`;
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
      link.href = `/src/styles/main.css?alert-chrome=${Date.now()}`;
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
        <div class="eew-bar-drag-region" aria-hidden="true"></div>
        <div class="eew-bar-expanded">Alert details</div>
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

  const appearance = await page.evaluate(async () => {
    const status = document.querySelector<HTMLElement>('.eew-status-bar')!;
    const statusLabel = document.querySelector<HTMLElement>('.eew-bar-label')!;
    const dragRegion = document.querySelector<HTMLElement>('.eew-bar-drag-region')!;
    const expanded = document.querySelector<HTMLElement>('.eew-bar-expanded')!;
    const banner = document.querySelector<HTMLElement>('.cb-offline-staleness-banner')!;
    const label = document.querySelector<HTMLElement>('.cb-osb-label')!;
    const subtext = document.querySelector<HTMLElement>('.cb-osb-subtext')!;
    const actions = [...document.querySelectorAll<HTMLElement>('.cb-osb-actions button')];
    const statusStyle = getComputedStyle(status);
    const dragRect = dragRegion.getBoundingClientRect();
    const parseRgb = (value: string): [number, number, number] => {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
    };
    const luminance = (rgb: [number, number, number]): number => {
      const channels = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const contrast = (foreground: [number, number, number], background: [number, number, number]): number => {
      const first = luminance(foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const blend = (
      foreground: [number, number, number],
      background: [number, number, number],
      alpha: number,
    ): [number, number, number] => foreground.map(
      (channel, index) => channel * alpha + background[index]! * (1 - alpha),
    ) as [number, number, number];

    banner.style.transition = 'none';
    expanded.style.transition = 'none';
    label.style.transition = 'none';
    subtext.style.transition = 'none';
    banner.dataset.status = 'offline';
    const offlineStyle = getComputedStyle(banner);
    const offlineBackground = parseRgb(offlineStyle.backgroundColor);
    const offlineColor = parseRgb(offlineStyle.color);
    const subtextStyle = getComputedStyle(subtext);
    const subtextColor = parseRgb(subtextStyle.color);
    const subtextOpacity = Number.parseFloat(subtextStyle.opacity);

    const darkAppearance = {
      statusBackground: statusStyle.backgroundColor,
      statusBackgroundImage: statusStyle.backgroundImage,
      statusBorderBottom: statusStyle.borderBottomWidth,
      statusRadius: Number.parseFloat(statusStyle.borderTopLeftRadius),
      statusLabelColor: getComputedStyle(statusLabel).color,
      dragWidth: dragRect.width,
      bannerColor: offlineStyle.color,
      labelColor: getComputedStyle(label).color,
      subtextColor: subtextStyle.color,
      actionSizes: actions.map((action) => {
        const rect = action.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
      offlineContrast: contrast(offlineColor, offlineBackground),
      offlineSubtextContrast: contrast(
        blend(subtextColor, offlineBackground, subtextOpacity),
        offlineBackground,
      ),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };

    status.style.transition = 'none';
    document.body.dataset.theme = 'light';
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const lightStatusStyle = getComputedStyle(status);
    const lightExpandedStyle = getComputedStyle(expanded);
    return {
      ...darkAppearance,
      lightStatusBackground: lightStatusStyle.backgroundColor,
      lightExpandedBackground: lightExpandedStyle.backgroundColor,
    };
  });

  expect(appearance.statusBackground).not.toBe('rgba(220, 38, 38, 0.92)');
  expect(appearance.statusBackgroundImage).not.toBe('none');
  expect(appearance.statusBorderBottom).toBe('0px');
  expect(appearance.statusRadius).toBeGreaterThanOrEqual(6);
  expect(appearance.statusLabelColor).not.toBe('rgb(255, 255, 255)');
  expect(appearance.dragWidth).toBeGreaterThanOrEqual(64);
  expect(appearance.bannerColor).not.toBe('rgb(255, 255, 255)');
  expect(appearance.labelColor).not.toBe('rgb(255, 255, 255)');
  expect(appearance.subtextColor).not.toBe('rgb(255, 255, 255)');
  for (const size of appearance.actionSizes) {
    expect(size.width).toBeGreaterThanOrEqual(28);
    expect(size.height).toBeGreaterThanOrEqual(28);
  }
  expect(appearance.offlineContrast).toBeGreaterThanOrEqual(4.5);
  expect(appearance.offlineSubtextContrast).toBeGreaterThanOrEqual(4.5);
  expect(appearance.lightStatusBackground).toContain('242');
  expect(appearance.lightExpandedBackground).toBe('rgb(255, 255, 255)');
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

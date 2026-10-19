import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.renderingShifts = [];
      window.renderingShiftSources = [];
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) {
          window.renderingShifts.push(entry.value);
          window.renderingShiftSources.push(entry.sources.map(source => ({ section: source.node?.closest('section')?.id, tag: source.node?.tagName, previous: source.previousRect, current: source.currentRect })));
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#overview').evaluate(e => getComputedStyle(e).contentVisibility), 'visible');
    assert.equal(await page.locator('#faq').evaluate(e => getComputedStyle(e).contentVisibility), 'visible');
    assert.equal(await page.locator('#faq').evaluate(e => getComputedStyle(e).contain), 'content');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(e => document.activeElement === e), true);
    await page.keyboard.press('Enter');
    const sections = page.locator('.product-section');
    for (const section of await sections.all()) {
      await section.scrollIntoViewIfNeeded();
      await section.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      const bounds = await section.boundingBox();
      const visualState = () => section.evaluate(section => {
        const origin = section.getBoundingClientRect();
        return [...section.querySelectorAll('*')].map(element => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { text: element.textContent, x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height, font: style.font, color: style.color, background: style.backgroundColor };
        });
      });
      const contained = await visualState();
      await section.evaluate(e => { for (const element of [e, ...e.querySelectorAll('*')]) element.style.contain = 'none'; });
      assert.deepEqual(await visualState(), contained, `uncontained geometry and typography unchanged at ${width}: ${await section.getAttribute('id')}`);
      assert.deepEqual(await section.boundingBox(), bounds, `layout unchanged at ${width}: ${await section.getAttribute('id')}`);
      await section.evaluate(e => { for (const element of [e, ...e.querySelectorAll('*')]) element.style.contain = ''; });
    }
    const comparisonShifts = await page.evaluate(() => ({ shifts: window.renderingShifts, sources: window.renderingShiftSources }));
    await page.goto('about:blank');
    await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
    for (let step = 0; step < 40; step++) {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(100);
    }
    assert.equal(await page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 1), true, 'full-page scroll reaches footer');
    await page.locator('#specs summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#specs details').evaluate(e => e.open), true);
    await page.locator('#specs summary').press('Enter');
    assert.equal(await page.evaluate(() => window.find('Free. Open. Yours.')), true, 'browser find reaches lower-page text');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const shifts = await page.evaluate(() => window.renderingShifts);
    assert.ok(shifts.reduce((sum, value) => sum + value, 0) < 0.01, `unexpected layout shifts at ${width}: ${JSON.stringify({shifts, sources: await page.evaluate(() => window.renderingShiftSources)})}`);
    await page.goto('about:blank');
    await page.goto('http://localhost:4173/#mcp', { waitUntil: 'networkidle' });
    const anchor = await page.locator('#mcp').boundingBox();
    assert.ok(anchor.y >= 0 && anchor.y < 200, `deep anchor remains reachable at ${width}: ${anchor.y}`);
    const anchorShifts = await page.evaluate(() => window.renderingShifts);
    assert.ok(anchorShifts.reduce((sum, value) => sum + value, 0) < 0.01, `anchor navigation shifts at ${width}: ${anchorShifts}`);
    const findResults = [];
    for (const id of ['intelligence', 'survival', 'open-source']) {
      await page.goto('about:blank');
      await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
      const phrase = await page.locator(`#${id} h2`).textContent();
      assert.equal(await page.evaluate(phrase => window.find(phrase), phrase), true, `browser find reaches ${id}`);
      await page.waitForTimeout(300);
      const found = await page.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().top);
      assert.ok(found >= 0 && found < 900, `find reveals ${id} at ${width}: ${found}`);
      const findShifts = await page.evaluate(() => window.renderingShifts);
      assert.ok(findShifts.reduce((sum, value) => sum + value, 0) < 0.01, `browser find shifts for ${id} at ${width}: ${findShifts}`);
      findResults.push({ id, shifts: findShifts });
    }
    console.log(JSON.stringify({ width, sections: await sections.count(), geometryAndTypographyParity: true, keyboard: true, find: true, productionShifts: shifts, anchorShifts, findResults, comparisonShifts }));
    await page.close();
  }
} finally {
  await browser.close();
}

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const report=[];
await mkdir('review/screenshots',{recursive:true});
for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
 await page.goto('http://localhost:4173/',{waitUntil:'networkidle'});
 await page.keyboard.press('Tab');
 report.push({name,skipFocused:await page.locator('.skip-link').evaluate(e=>document.activeElement===e)});
 await page.keyboard.press('Enter');
 await page.locator('.skip-link').evaluate(e=>e.blur());
 await page.screenshot({path:`review/screenshots/${name}-navigation.png`});
 for(const id of ['overview','features','intelligence','home-shell','survival','privacy','local-ai','variants','mcp','open-source','faq']) {
  const section=page.locator('#'+id);await section.scrollIntoViewIfNeeded();
  await section.locator('img').evaluateAll(async images=>Promise.all(images.map(i=>i.decode())));
  await section.screenshot({path:`review/screenshots/${name}-${id}.png`,style:".marketing-header, .skip-link { visibility: hidden; }"});
 }
 for(const route of ['/','/download','/privacy','/security','/docs']) {
  await page.goto('http://localhost:4173'+route,{waitUntil:'networkidle'});
  const checks=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,h1:document.querySelectorAll('h1').length,brokenImages:[...document.images].filter(i=>i.complete&&!i.naturalWidth).length,animations:[...document.querySelectorAll('[data-reveal]>.shell')].map(e=>getComputedStyle(e).animationName)}));
  report.push({name,route,...checks});
 }
 await page.close();
}
await writeFile('review/browser-checks.json',JSON.stringify(report,null,2)+'\n');
await browser.close();
if(report.some(r=>r.overflow||r.brokenImages||r.h1&&r.h1!==1||r.skipFocused===false)) process.exitCode=1;
console.log(JSON.stringify(report,null,2));

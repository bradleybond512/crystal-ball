import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const report=[];
const output=process.env.CAPTURE_DIRECTORY || 'review/screenshots';
const reportPath=process.env.CAPTURE_REPORT || 'review/browser-checks.json';
await mkdir(output,{recursive:true});
for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
 await page.goto('http://localhost:4173/',{waitUntil:'networkidle'});
 await page.keyboard.press('Tab');
 report.push({name,skipFocused:await page.locator('.skip-link').evaluate(e=>document.activeElement===e)});
 await page.keyboard.press('Enter');
 await page.locator('.skip-link').evaluate(e=>e.blur());
 await page.screenshot({path:`${output}/${name}-navigation.png`});
 await page.locator('.numbers-band').screenshot({path:`${output}/${name}-numbers.png`,style:".marketing-header, .skip-link { visibility: hidden; }"});
 for(const id of ['overview','features','intelligence','home-shell','your-day','survival','privacy','local-ai','variants','mcp','power-users','open-source','specs','faq']) {
  const section=page.locator('#'+id);await section.scrollIntoViewIfNeeded();
  await section.locator('img').evaluateAll(async images=>Promise.all(images.map(i=>i.decode())));
  await section.screenshot({path:`${output}/${name}-${id}.png`,style:".marketing-header, .skip-link { visibility: hidden; }"});
 }
 await page.locator('#specs summary').focus();
 await page.keyboard.press('Enter');
 report.push({name,specsKeyboardOpen:await page.locator('#specs details').evaluate(e=>e.open)});
 await page.locator('#specs').screenshot({path:`${output}/${name}-specs-expanded.png`,style:".marketing-header, .skip-link { visibility: hidden; }"});
 for(const route of ['/','/download','/privacy','/security','/docs']) {
  await page.goto('http://localhost:4173'+route,{waitUntil:'networkidle'});
  const checks=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,h1:document.querySelectorAll('h1').length,brokenImages:[...document.images].filter(i=>i.complete&&!i.naturalWidth).length,animations:[...document.querySelectorAll('[data-reveal]>.shell')].map(e=>getComputedStyle(e).animationName)}));
  report.push({name,route,...checks});
 }
 await page.close();
}
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
await browser.close();
if(report.some(r=>r.overflow||r.brokenImages||r.h1&&r.h1!==1||r.skipFocused===false||r.specsKeyboardOpen===false)) process.exitCode=1;
console.log(JSON.stringify(report,null,2));

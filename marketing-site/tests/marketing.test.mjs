import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function request(path = '/', headers = {}) {
  const { default: worker } = await import('../dist/server/index.js');
  return worker.fetch(new Request(`https://crystalball.example${path}`, { headers }), { ASSETS: { fetch: async (request) => { try { return new Response(await readFile(new URL('../dist/client'+new URL(request.url).pathname, import.meta.url))); } catch { return new Response('Not found', {status:404}); } } } }, {waitUntil(){},passThroughOnException(){}});
}

test('serves separate accessible product, download, docs and trust pages', async () => {
  for (const path of ['/', '/download', '/docs', '/privacy', '/security']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.equal((html.match(/<h1\b/g)||[]).length, 1, path);
    assert.ok(html.indexOf('<h1') < html.indexOf('<h2'), path);
    assert.match(html, /href="#main"/);
    assert.match(html, /<meta name="description"/);
    assert.doesNotMatch(html, /crystalball\.app|God.s Vision/);
    for (const tag of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
      assert.match(tag[0], /rel="noopener noreferrer"/);
    }
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
});

test('serves machine-readable discovery', async () => {
  const robots = await request('/robots.txt');
  assert.equal(robots.status,200);
  assert.match(await robots.text(), /Sitemap: https:\/\/crystal-ball-observatory\.bradleybond512\.chatgpt\.site\/sitemap.xml/);
  const sitemap = await request('/sitemap.xml');
  assert.equal(sitemap.status,200);
  const xml=await sitemap.text();
  for(const route of ['download','docs','privacy','security']) assert.ok(xml.includes(`/${route}</loc>`));
});

test('offers compressed HTML only when accepted', async () => {
  const plain=await request('/');
  const text=await plain.text();
  const compressed=await request('/',{'Accept-Encoding':'gzip'});
  assert.equal(compressed.headers.get('content-encoding'),'gzip');
  assert.match(compressed.headers.get('vary'),/Accept-Encoding/);
  assert.equal(await new Response(compressed.body.pipeThrough(new DecompressionStream('gzip'))).text(),text);
  const declined=await request('/',{'Accept-Encoding':'gzip;q=0, br'});
  assert.equal(declined.headers.get('content-encoding'),null);
});

test('provides valid application structured data and dated source counts', async () => {
  const html=await (await request('/')).text();
  const script=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(script);
  const schema=JSON.parse(script[1]);
  assert.equal(schema['@type'],'SoftwareApplication');
  assert.equal(schema.name,'Crystal Ball');
  assert.equal(Number(schema.offers.price),0);
  assert.ok(schema.downloadUrl);
  assert.match(JSON.stringify(schema.operatingSystem),/macOS/);
  const data=JSON.parse(await readFile(new URL('../data/generated.json',import.meta.url),'utf8'));
  assert.ok(JSON.stringify(data).includes('78e34040d738c82195162b28280e8ce865c3bb6d'));
});

test('prioritizes a single hero and keeps product shots responsive and unique',async()=>{
 const html=await(await request('/')).text();
 const images=[...html.matchAll(/<img\b[^>]*>/g)].map(m=>m[0]);
 assert.ok(images.length>0);
 assert.equal(images.filter(s=>s.includes('fetchpriority="high"')).length,1);
 assert.match(images[0],/loading="eager"/);
 const sources=images.map(s=>s.match(/src="([^"]+)"/)[1]);
 assert.equal(new Set(sources).size,sources.length);
 for(const [i,tag] of images.entries()) {
  assert.match(tag,/srcset="[^"\n]+\.webp 800w, [^"\n]+\.webp 1600w"/);
  assert.match(tag,/width="1600" height="1001"/);
  assert.match(tag,/alt="[^"]+"/);
  if(i) assert.match(tag,/loading="lazy"/);
 }
 const png=await readFile(new URL('../public/og.png',import.meta.url));
 assert.equal(png.readUInt32BE(16),1200);
 assert.equal(png.readUInt32BE(20),630);
 assert.ok(png.length<300_000);
});

test('minifies embedded styles and scripts without removing motion and focus support',async()=>{
 const html=await(await request('/')).text();
 const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
 assert.ok(css.length<14000);
 assert.doesNotMatch(css,/\n/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/:focus-visible/);
 const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 assert.doesNotMatch(script,/\n/);
 assert.ok(script.length<1000);
});

test('reveals sourced detail with specific controls and one capture note', async()=>{
 const html=await(await request('/')).text();
 for(const id of ['features','intelligence','home-shell','survival','privacy','local-ai','variants','mcp']) {
  const section=html.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`))[0];
  const count=(section.match(/<article\b/g)||[]).length;
  assert.ok(count>=3&&count<=4,`${id}: ${count} tiles`);
  const tiles=[...section.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)];
  for(const [,tile] of tiles) {
   const title=tile.match(/<h3>(.*?)<\/h3>/)[1];
   assert.ok(title.split(/\s+/).length<=4,title);
   const copy=tile.match(/<p>(.*?)<\/p>/)[1];
   assert.ok(copy.split(/\s+/).length<=18,copy);
  }
  if(section.includes('<figure')) assert.ok(section.indexOf('<figure')<section.indexOf('class="feature-grid"'));
 }
 const names=[...html.matchAll(/<summary>(.*?)<\/summary>/g)].map(m=>m[1]);
 assert.equal(new Set(names).size,names.length);
 assert.ok(names.every(name=>name!=='Learn more.'));
 assert.equal((html.match(/Product screenshots show/g)||[]).length,1);
 assert.doesNotMatch(html, /Installed macOS app · Captured|\/blob\/[a-f0-9]{40}/);
 assert.match(html,/id="numbers-title">By the numbers\./);
 assert.match(html,/Explore technical specifications/);
 const data=JSON.parse(await readFile(new URL('../data/generated.json',import.meta.url),'utf8'));
 assert.equal(html.includes('Minimum OS versions'),data.specs.platforms.some(platform=>platform.minimumOS));
});

test('serves the exact build-generated sitemap without a rendering route',async()=>{
 const xml=await readFile(new URL('../dist/client/sitemap.xml',import.meta.url),'utf8');
 assert.equal(await(await request('/sitemap.xml')).text(),xml);
 await assert.rejects(readFile(new URL('../app/sitemap.xml/route.ts',import.meta.url)));
});

 test('serves the static sitemap without a Cloudflare asset binding', async()=>{
 const {default:worker}=await import('../dist/server/index.js');
 const response=await worker.fetch(new Request('http://localhost/sitemap.xml'), {}, {});
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/application\/xml/);
 assert.equal(await response.text(),await readFile(new URL('../dist/client/sitemap.xml',import.meta.url),'utf8'));
});

test('keeps feature depth without duplicate disclosures or platform caveats', async()=>{
 const html=await(await request('/')).text();
 const data=JSON.parse(await readFile(new URL('../data/generated.json',import.meta.url),'utf8'));
 const section=id=>html.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`))[0];
 for(const id of ['features','intelligence','home-shell','survival','privacy','local-ai','mcp','variants']) {
  const content=section(id);
  assert.equal((content.match(/<a\b/g)||[]).length,1,`${id}: one link`);
  assert.doesNotMatch(content,/<details/);
  assert.equal((content.match(/<article\b/g)||[]).length,id==='variants'?4:3,`${id}: tiles`);
  assert.ok((content.match(/class="fine-print"/g)||[]).length<=1,`${id}: single caveat`);
 }
 assert.match(section('variants'),/Four editions\. Pick yours\./);
 const specs=section('specs');
 assert.doesNotMatch(specs,/not specified|published \d{4}-|\d{4}-\d{2}-\d{2}/);
 for(const id of ['mcp','specs']) {
  const content=section(id);
  assert.equal((content.match(new RegExp(`${data.counts.mcp.read} read-only tools`,'g'))||[]).length,1,`${id}: read-only profile`);
  assert.equal((content.match(new RegExp(`${data.counts.mcp.analyst} (?:additional )?tools`,'g'))||[]).length,1,`${id}: analyst profile`);
 }
 const numbers=html.match(/<aside class="numbers-band"[\s\S]*?<\/aside>/)[0];
 const text=numbers.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
 for(const label of [`${data.counts.panels.full} panels`,`${data.counts.mcp.total} tools for your AI assistant`,`${data.counts.editions} editions`,'Mac, Windows, Linux','Free']) assert.ok(text.includes(label),label);
 assert.match(numbers,/source at build time/);
 assert.doesNotMatch(numbers,/experimental|primary/);
 assert.doesNotMatch(html.match(/<footer[\s\S]*?<\/footer>/)[0],/experimental|primary/);
});

test('distinguishes illustrative examples from live data and keeps the example day in sequence',async()=>{
 const html=await(await request('/')).text();
 for(const id of ['features','intelligence']) {
  const section=html.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`))[0];
  assert.equal((section.match(/class="example-block"/g)||[]).length,1);
  assert.match(section,/Example · Illustrative, not live data/);
 }
 const day=html.match(/<section[^>]*id="your-day"[\s\S]*?<\/section>/)[0];
 assert.equal((day.match(/<time datetime="\d{2}:\d{2}">/g)||[]).length,4);
 assert.match(day,/not scheduled automation/);
 assert.ok(html.indexOf('id="home-shell"')<html.indexOf('id="your-day"'));
 assert.ok(html.indexOf('id="your-day"')<html.indexOf('id="survival"'));
 for(const id of ['privacy','local-ai']) assert.match(html.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`))[0],/<img[^>]+loading="lazy"/);
 assert.match(html,/crystalball doctor<\/code> to check your setup/);
});


test('keeps map categories consistent across the overview and specifications', async()=>{
 const html=await(await request('/')).text();
 const data=JSON.parse(await readFile(new URL('../data/generated.json',import.meta.url),'utf8'));
 const map=html.match(/<section[^>]*id="features"[\s\S]*?<\/section>/)[0];
 const specs=html.match(/<section[^>]*id="specs"[\s\S]*?<\/section>/)[0];
 for(const category of data.mapCategories) {
  assert.ok(map.includes(category),`Map includes ${category}`);
  assert.ok(specs.includes(category),`Specifications include ${category}`);
 }
});

test('uses public update labels without marking shipped features as upcoming', async()=>{
 const html=await(await request('/')).text();
 const data=JSON.parse(await readFile(new URL('../data/generated.json',import.meta.url),'utf8'));
 const section=id=>html.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`))[0];
 for(const id of ['home-shell','variants','intelligence','survival','features']) assert.doesNotMatch(section(id),/class="release-label"/);
 assert.match(section('home-shell'),/class="edition-label">Full edition/);
 const mapped=new Set(['explicit-analytics-consent','mcp-profiles','cli-doctor']);
 for(const [,id,label] of html.matchAll(/class="release-label" data-feature="([^"]+)">([^<]+)</g)) {
  assert.ok(mapped.has(id));assert.equal(label,data.availability.labels[id]);
 }
 const security=await(await request('/security')).text();
 assert.match(security,/Agent tools install separately from the app/);
 const privacy=await(await request('/privacy')).text();
 if(data.availability.labels['explicit-analytics-consent']) {
  assert.ok(privacy.includes(`Upgraded from v${data.releaseAudit.version}?`));
  assert.match(privacy,/analytics may have been turned on/);
  assert.match(privacy,/The next update turns it off automatically/);
 } else assert.doesNotMatch(privacy,/Upgraded from|Next update/);
 assert.match(privacy,/Analytics stay off until you opt in/);
});

test('uses a briefing capture and keeps decorative timeline markers out of the accessibility tree',async()=>{
 const html=await(await request('/')).text();
 const briefing=html.match(/<section[^>]*id="home-shell"[\s\S]*?<\/section>/)[0];
 assert.match(briefing,/<img[^>]+src="\/app-live-home-briefing-1600\.webp"/);
 assert.doesNotMatch(briefing,/app-live-analysis-library/);
 const day=html.match(/<section[^>]*id="your-day"[\s\S]*?<\/section>/)[0];
 const markers=[...day.matchAll(/<span\b[^>]*class="day-marker"[^>]*>/g)];
 assert.equal(markers.length,4);
 for(const [marker] of markers) assert.match(marker,/aria-hidden="true"/);
 const privacy=html.match(/<section[^>]*id="privacy"[\s\S]*?<\/section>/)[0];
 assert.doesNotMatch(privacy.match(/<figcaption>[\s\S]*?<\/figcaption>/)[0],/opt-in enabled/);
});


test('all rendered routes keep internal verification vocabulary out of public copy',async()=>{
 for(const route of ['/','/download','/docs','/privacy','/security']) {
  const html=await(await request(route)).text();
  const visible=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  assert.doesNotMatch(visible,/source-build|source build|source checkout|companion|audited|unverified|DMG/i,route);
 }
});

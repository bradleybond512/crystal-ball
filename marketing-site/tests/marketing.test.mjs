import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function request(path = '/', headers = {}) {
  const { default: worker } = await import('../dist/server/index.js');
  return worker.fetch(new Request(`https://crystalball.example${path}`, { headers }), { ASSETS: { fetch: async () => new Response('Not found', {status:404}) } }, {waitUntil(){},passThroughOnException(){}});
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
  const data=JSON.parse(await readFile(new URL('../data/site.json',import.meta.url),'utf8'));
  assert.ok(JSON.stringify(data).includes('78e34040d738c82195162b28280e8ce865c3bb6d'));
});

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = JSON.parse(await readFile(path.join(root, 'data/site.json'), 'utf8'));
const origin = new URL(data.urls.site).origin;
const { default: worker } = await import('../dist/server/index.js');
const routes = ['/', '/download', '/docs', '/privacy', '/security'];
const pages = new Map();
const links = new Map();
const results = [];
const decode = (s) => s.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
const assets = async (request) => {
  const filename = path.resolve(root, 'dist/client', `.${decodeURIComponent(new URL(request.url).pathname)}`);
  if (!filename.startsWith(path.join(root, 'dist/client') + path.sep)) return new Response(null, { status: 403 });
  try { return new Response(await readFile(filename)); } catch { return new Response(null, { status: 404 }); }
};
const request = (url) => worker.fetch(new Request(url), { ASSETS: { fetch: assets } }, { waitUntil() {}, passThroughOnException() {} });
function collect(raw, from) {
  const url = new URL(decode(raw), `${origin}${from}`);
  if (!['https:', 'http:'].includes(url.protocol)) return;
  const key = url.href;
  if (!links.has(key)) links.set(key, new Set());
  links.get(key).add(from);
}
for (const route of routes) {
  const response = await request(`${origin}${route}`);
  const html = await response.text();
  pages.set(route, html);
  results.push({ url: `${origin}${route}`, kind: 'route', status: response.status, ok: response.ok });
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) collect(match[1], route);
  for (const match of html.matchAll(/\bsrcset="([^"]+)"/g)) {
    for (const candidate of match[1].split(',')) collect(candidate.trim().split(/\s+/)[0], route);
  }
  for (const tag of html.matchAll(/<meta\b[^>]*>/g)) {
    if (/(?:property|name)="(?:og:image|twitter:image)"/.test(tag[0])) {
      const content = tag[0].match(/content="([^"]+)"/);
      if (content) collect(content[1], route);
    }
  }
}
for (const route of ['/robots.txt', '/sitemap.xml']) collect(route, '/');
async function check(urlString, from) {
  const url = new URL(urlString);
  if (url.origin === origin) {
    let html = pages.get(url.pathname);
    let status = 200;
    if (html === undefined) {
      const response = await request(url.href);
      status = response.status;
      html = await response.text();
    }
    const fragment = decodeURIComponent(url.hash.slice(1));
    const fragmentFound = !fragment || [...html.matchAll(/\bid="([^"]+)"/g)].some((m) => decode(m[1]) === fragment);
    return { url: urlString, from, kind: 'local', status, fragmentFound, ok: status >= 200 && status < 300 && fragmentFound };
  }
  const attempts = [];
  for (const method of ['HEAD', 'GET']) {
    try {
      const response = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'CrystalBall-Marketing-LinkAudit/1.0', ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}) } });
      attempts.push({ method, status: response.status, finalUrl: response.url });
      await response.body?.cancel();
      if (method === 'HEAD' && [403, 405, 501].includes(response.status)) continue;
      return { url: urlString, from, kind: 'external', status: response.status, ok: response.ok, fragmentChecked: !url.hash, attempts };
    } catch (error) {
      attempts.push({ method, error: String(error) });
      return { url: urlString, from, kind: 'external', status: null, ok: false, attempts };
    }
  }
}
const pending = [...links.entries()];
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < pending.length) {
    const [url, from] = pending[cursor++];
    results.push(await check(url, [...from]));
  }
}));
results.sort((a, b) => a.url.localeCompare(b.url));
const report = { checkedAt: new Date().toISOString(), sourceSha: data.sourceSha, routes, method: 'Built worker plus static assets; external HEAD follows redirects, GET Range fallback for 403/405/501 cancels body immediately. Four concurrent requests, 20-second timeout. Remote fragments are not validated.', summary: { total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, notFound: results.filter((r) => r.status === 404).length }, results };
await mkdir(path.join(root, 'review'), { recursive: true });
await writeFile(path.join(root, 'review/links.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
for (const result of results.filter((r) => !r.ok)) console.log(JSON.stringify(result));
process.exitCode = report.summary.failed ? 1 : 0;

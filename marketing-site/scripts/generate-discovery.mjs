import { readFile, writeFile } from 'node:fs/promises';
const data = JSON.parse(await readFile(new URL('../data/site.json', import.meta.url), 'utf8'));
const urls = ['/', '/download', '/docs', '/privacy', '/security'].map(path => `<url><loc>${data.urls.site}${path}</loc></url>`).join('');
await writeFile(new URL('../public/sitemap.xml', import.meta.url), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);

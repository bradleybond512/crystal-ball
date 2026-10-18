import data from '../../data/site.json';
import { respond } from '../../lib/response';
export function GET(request: Request) {
 return respond(request, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/','/download','/docs','/privacy','/security'].map(path => `<url><loc>${data.urls.site}${path}</loc></url>`).join('')}</urlset>`, 'application/xml; charset=utf-8');
}

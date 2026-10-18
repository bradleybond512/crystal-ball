import data from '../../data/site.json';
import { respond } from '../../lib/response';
export function GET(request: Request) {
 return respond(request, `User-agent: *\nAllow: /\nSitemap: ${data.urls.site}/sitemap.xml\n`, 'text/plain; charset=utf-8');
}

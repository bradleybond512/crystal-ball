// Non-sebuf: returns XML/HTML, stays as standalone Vercel function
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
export const config = { runtime: 'edge' };

const ARCHIVE_ORIGIN = 'https://www.fwdstart.me';
const MAX_ITEMS = 30;
const XML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

// Scraped text is untrusted: escape it for attributes/elements, and split any
// `]]>` so it cannot close a CDATA section early.
function escapeXml(text) {
  return String(text).replaceAll(/[&<>"']/g, (char) => XML_ENTITIES[char]);
}

function cdata(text) {
  return `<![CDATA[${String(text).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

function parsePubDate(block, now) {
  const dateMatch = block.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (!dateMatch) return now;
  const parsed = new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

function parseSlide(block, now) {
  const urlMatch = block.match(/href="(\/p\/[^"]+)"/);
  if (!urlMatch) return null;
  const title = block.match(/alt="([^"]+)"/)?.[1] ?? '';
  if (title.length < 5) return null;
  const description = block.match(/line-clamp-3[^>]*>.*?<span[^>]*>([^<]{20,})<\/span>/s)?.[1]?.trim() ?? '';
  return { title, link: `${ARCHIVE_ORIGIN}${urlMatch[1]}`, date: parsePubDate(block, now).toISOString(), description };
}

/** Parse the archive page into unique items (one per post link). */
export function parseArchiveItems(html, now = new Date()) {
  const items = [];
  const seenUrls = new Set();
  // Split by embla__slide to get each post block
  for (const block of html.split('embla__slide')) {
    const item = parseSlide(block, now);
    if (!item || seenUrls.has(item.link)) continue;
    seenUrls.add(item.link);
    items.push(item);
  }
  return items;
}

/** Render items as RSS 2.0; every scraped value is escaped. */
export function renderRss(items, selfHref, now = new Date()) {
  const rssItems = items.slice(0, MAX_ITEMS).map((item) => `
 <item>
 <title>${cdata(item.title)}</title>
 <link>${escapeXml(item.link)}</link>
 <guid>${escapeXml(item.link)}</guid>
 <pubDate>${new Date(item.date).toUTCString()}</pubDate>
 <description>${cdata(item.description)}</description>
 <source url="${ARCHIVE_ORIGIN}">FwdStart Newsletter</source>
 </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
 <title>FwdStart Newsletter</title>
 <link>${ARCHIVE_ORIGIN}</link>
 <description>Forward-thinking startup and VC news from MENA and beyond</description>
 <language>en-us</language>
 <lastBuildDate>${now.toUTCString()}</lastBuildDate>
 <atom:link href="${escapeXml(selfHref)}" rel="self" type="application/rss+xml"/>
 ${rssItems}
  </channel>
</rss>`;
}

// Scrape FwdStart newsletter archive and return as RSS
export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
 return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: cors });
  }
  try {
 const response = await fetch(`${ARCHIVE_ORIGIN}/archive`, {
 headers: {
 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
 'Accept': 'text/html,application/xhtml+xml',
 },
 signal: AbortSignal.timeout(15_000),
 });

 if (!response.ok) {
 throw new Error(`HTTP ${response.status}`);
 }

 const items = parseArchiveItems(await response.text());
 const rss = renderRss(items, new URL('/api/fwdstart', req.url).href);

 return new Response(rss, {
 headers: {
 'Content-Type': 'application/xml; charset=utf-8',
 ...cors,
 'Cache-Control': 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=300',
 },
 });
  } catch (error) {
 console.error('FwdStart scraper error:', error);
 return Response.json({
 error: 'Failed to fetch FwdStart archive',
 details: error.message
 }, {
 status: 502,
 headers: {
 'Content-Type': 'application/json',
 ...cors,
 },
 });
  }
}

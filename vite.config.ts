import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { cpSync, createReadStream, existsSync } from 'fs';
import { resolve, dirname, extname, join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { spawnSync } from 'child_process';
import { brotliCompress } from 'zlib';
import { promisify } from 'util';
import pkg from './package.json';
import { isSafetyFeedPath } from './src/utils/sw-safety-feeds';

const isE2E = process.env.VITE_E2E === '1';
const isDesktopBuild = process.env.VITE_DESKTOP_RUNTIME === '1';

const brotliCompressAsync = promisify(brotliCompress);
const BROTLI_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.txt', '.xml', '.wasm']);

function brotliPrecompressPlugin(): Plugin {
  return {
 name: 'brotli-precompress',
 apply: 'build',
 async writeBundle(outputOptions, bundle) {
 const outDir = outputOptions.dir;
 if (!outDir) return;

 await Promise.all(Object.keys(bundle).map(async (fileName) => {
 const extension = extname(fileName).toLowerCase();
 if (!BROTLI_EXTENSIONS.has(extension)) return;

 const sourcePath = resolve(outDir, fileName);
 const compressedPath = `${sourcePath}.br`;
 const sourceBuffer = await readFile(sourcePath);
 if (sourceBuffer.length < 1024) return;

 const compressedBuffer = await brotliCompressAsync(sourceBuffer);
 await mkdir(dirname(compressedPath), { recursive: true });
 await writeFile(compressedPath, compressedBuffer);
 }));
 },
  };
}

const VARIANT_META: Record<string, {
  title: string;
  description: string;
  keywords: string;
  url: string;
  siteName: string;
  shortName: string;
  subject: string;
  classification: string;
  categories: string[];
  features: string[];
}> = {
  full: {
 title: 'Crystal Ball - Global Intelligence Dashboard',
 description: 'Real-time global intelligence dashboard with 264 panels, 75 geospatial layers, AI analysis, unified alerts, and cross-domain monitoring.',
 keywords: 'AI intelligence, global intelligence dashboard, geopolitical dashboard, OSINT, real-time monitoring, situation awareness, threat intelligence, unified alerts, MCP server, Claude Code, 3D globe, Cesium, MapLibre, military tracking, AIS ships, ADS-B flights, cyber threats, earthquake monitor, space weather, infrastructure monitoring, market data, prediction markets',
 url: 'https://bradleybond512.github.io/crystal-ball/',
 siteName: 'Crystal Ball',
 shortName: 'CrystalBall',
 subject: 'Real-Time Global Intelligence and Situation Awareness',
 classification: 'Intelligence Dashboard, OSINT Tool, News Aggregator',
 categories: ['news', 'productivity'],
 features: [
 '264 interactive intelligence panels',
 '75 geospatial 3D globe layers',
 'Unified alert inbox and traceability',
 'Real-time news aggregation',
 'Market and macro tracking',
 'Military flight monitoring',
 'Ship AIS tracking',
 'Earthquake alerts',
 'Seismic, weather, and space monitoring',
 'Power outage monitoring',
 'Cyber threat intelligence',
 'Infrastructure monitoring',
 'Prediction markets',
 'MCP server for Claude Code intelligence workflows',
 ],
  },
};

const activeVariant = 'full';
const activeMeta = VARIANT_META.full;

function runGit(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

const buildCommitSha = process.env.WM_BUILD_COMMIT_SHA || runGit(['rev-parse', 'HEAD']) || 'unknown';
const buildTag = process.env.WM_BUILD_TAG || `v${pkg.version}`;
const buildTimestamp = process.env.WM_BUILD_TIMESTAMP || new Date().toISOString();

function htmlVariantPlugin(): Plugin {
  return {
 name: 'html-variant',
 transformIndexHtml(html, ctx) {
 const fileName = ctx.filename.replace(/\\/g, '/');
 const isAuxiliaryWindow = fileName.endsWith('/settings.html') || fileName.endsWith('/live-channels.html');
 if (isAuxiliaryWindow) {
 return html;
 }

 let result = html
 .replace(/<title>.*?<\/title>/, `<title>${activeMeta.title}</title>`)
 .replace(/<meta name="title" content=".*?" \/>/, `<meta name="title" content="${activeMeta.title}" />`)
 .replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${activeMeta.description}" />`)
 .replace(/<meta name="keywords" content=".*?" \/>/, `<meta name="keywords" content="${activeMeta.keywords}" />`)
 .replace(/<link rel="canonical" href=".*?" \/>/, `<link rel="canonical" href="${activeMeta.url}" />`)
 .replace(/<meta name="application-name" content=".*?" \/>/, `<meta name="application-name" content="${activeMeta.siteName}" />`)
 .replace(/<meta property="og:url" content=".*?" \/>/, `<meta property="og:url" content="${activeMeta.url}" />`)
 .replace(/<meta property="og:title" content=".*?" \/>/, `<meta property="og:title" content="${activeMeta.title}" />`)
 .replace(/<meta property="og:description" content=".*?" \/>/, `<meta property="og:description" content="${activeMeta.description}" />`)
 .replace(/<meta property="og:site_name" content=".*?" \/>/, `<meta property="og:site_name" content="${activeMeta.siteName}" />`)
 .replace(/<meta name="subject" content=".*?" \/>/, `<meta name="subject" content="${activeMeta.subject}" />`)
 .replace(/<meta name="classification" content=".*?" \/>/, `<meta name="classification" content="${activeMeta.classification}" />`)
 .replace(/<meta name="twitter:url" content=".*?" \/>/, `<meta name="twitter:url" content="${activeMeta.url}" />`)
 .replace(/<meta name="twitter:title" content=".*?" \/>/, `<meta name="twitter:title" content="${activeMeta.title}" />`)
 .replace(/<meta name="twitter:description" content=".*?" \/>/, `<meta name="twitter:description" content="${activeMeta.description}" />`)
 .replace(/"name": "Crystal Ball"/, `"name": "${activeMeta.siteName}"`)
 .replace(/"alternateName": "CrystalBall"/, `"alternateName": "${activeMeta.siteName.replace(' ', '')}"`)
 .replace(/"url": "https:\/\/crystalball\.app\/"/, `"url": "${activeMeta.url}"`)
 .replace(/"description": "Real-time global intelligence dashboard with live news, markets, military tracking, infrastructure monitoring, and geopolitical data."/, `"description": "${activeMeta.description}"`)
 .replace(/"featureList": \[[\s\S]*?\]/, `"featureList": ${JSON.stringify(activeMeta.features, null, 8).replace(/\n/g, '\n ')}`);

 // Desktop CSP: inject loopback wildcard for the dynamic sidecar port so the
 // index.html meta-CSP (which intersects with the authoritative tauri.conf.json
 // CSP) cannot block 127.0.0.1:<port>. The production *web* allowlist
 // intentionally excludes localhost to avoid exposing the user's local services
 // as attack surface from a hijacked page.
 if (isDesktopBuild) {
 result = result
 .replace(
 /connect-src 'self' blob: data:/,
 "connect-src 'self' blob: data: http://127.0.0.1:* http://localhost:*"
 )
 .replace(
 /frame-src 'self'/,
 "frame-src 'self' http://127.0.0.1:*"
 );
 }

 // Dev server only: the Vite HMR websocket + dev origin live on loopback, which
 // the production allowlist (no bare ws:/http:) would otherwise block. The
 // `ctx.server` field is present only for the `serve` (dev) command.
 if (ctx.server) {
 result = result.replace(
 /connect-src 'self' blob: data:/,
 "connect-src 'self' blob: data: ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*"
 );
 }

 return result;
 },
  };
}

function polymarketPlugin(): Plugin {
  const GAMMA_BASE = 'https://gamma-api.polymarket.com';
  const ALLOWED_ORDER = ['volume', 'liquidity', 'startDate', 'endDate', 'spread'];

  return {
 name: 'polymarket-dev',
 configureServer(server) {
 server.middlewares.use(async (req, res, next) => {
 if (!req.url?.startsWith('/api/polymarket')) return next();

 const url = new URL(req.url, 'http://localhost');
 const endpoint = url.searchParams.get('endpoint') || 'markets';
 const closed = ['true', 'false'].includes(url.searchParams.get('closed') ?? '') ? url.searchParams.get('closed') : 'false';
 const order = ALLOWED_ORDER.includes(url.searchParams.get('order') ?? '') ? url.searchParams.get('order') : 'volume';
 const ascending = ['true', 'false'].includes(url.searchParams.get('ascending') ?? '') ? url.searchParams.get('ascending') : 'false';
 const rawLimit = parseInt(url.searchParams.get('limit') ?? '', 10);
 const limit = isNaN(rawLimit) ? 50 : Math.max(1, Math.min(100, rawLimit));

 const params = new URLSearchParams({ closed: closed!, order: order!, ascending: ascending!, limit: String(limit) });
 if (endpoint === 'events') {
 const tag = (url.searchParams.get('tag') ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 100);
 if (tag) params.set('tag_slug', tag);
 }

 const gammaUrl = `${GAMMA_BASE}/${endpoint === 'events' ? 'events' : 'markets'}?${params}`;

 res.setHeader('Content-Type', 'application/json');
 try {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 8000);
 const resp = await fetch(gammaUrl, { headers: { Accept: 'application/json' }, signal: controller.signal });
 clearTimeout(timer);
 if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
 const data = await resp.text();
 res.setHeader('Cache-Control', 'public, max-age=120');
 res.setHeader('X-Polymarket-Source', 'gamma');
 res.end(data);
 } catch {
 // Expected: Cloudflare JA3 blocks server-side TLS — return empty array
 res.setHeader('Cache-Control', 'public, max-age=300');
 res.end('[]');
 }
 });
 },
  };
}

/**
 * Vite dev server plugin for sebuf API routes.
 *
 * Intercepts requests matching /api/{domain}/v1/* and routes them through
 * the same handler pipeline as the Vercel catch-all gateway. Other /api/*
 * paths fall through to existing proxy rules.
 */
function sebufApiPlugin(): Plugin {
  // Cache router across requests (H-13 fix). Invalidated by Vite's module graph on HMR.
  let cachedRouter: Awaited<ReturnType<typeof buildRouter>> | null = null;
  let cachedCorsMod: any = null;

  async function buildRouter() {
 const [
 routerMod, corsMod, errorMod,
 seismologyServerMod, seismologyHandlerMod,
 wildfireServerMod, wildfireHandlerMod,
 climateServerMod, climateHandlerMod,
 predictionServerMod, predictionHandlerMod,
 displacementServerMod, displacementHandlerMod,
 aviationServerMod, aviationHandlerMod,
 researchServerMod, researchHandlerMod,
 unrestServerMod, unrestHandlerMod,
 conflictServerMod, conflictHandlerMod,
 maritimeServerMod, maritimeHandlerMod,
 cyberServerMod, cyberHandlerMod,
 economicServerMod, economicHandlerMod,
 infrastructureServerMod, infrastructureHandlerMod,
 marketServerMod, marketHandlerMod,
 newsServerMod, newsHandlerMod,
 intelligenceServerMod, intelligenceHandlerMod,
 militaryServerMod, militaryHandlerMod,
 positiveEventsServerMod, positiveEventsHandlerMod,
 givingServerMod, givingHandlerMod,
 tradeServerMod, tradeHandlerMod,
 ] = await Promise.all([
 import('./server/router'),
 import('./server/cors'),
 import('./server/error-mapper'),
 import('./src/generated/server/crystalball/seismology/v1/service_server'),
 import('./server/crystalball/seismology/v1/handler'),
 import('./src/generated/server/crystalball/wildfire/v1/service_server'),
 import('./server/crystalball/wildfire/v1/handler'),
 import('./src/generated/server/crystalball/climate/v1/service_server'),
 import('./server/crystalball/climate/v1/handler'),
 import('./src/generated/server/crystalball/prediction/v1/service_server'),
 import('./server/crystalball/prediction/v1/handler'),
 import('./src/generated/server/crystalball/displacement/v1/service_server'),
 import('./server/crystalball/displacement/v1/handler'),
 import('./src/generated/server/crystalball/aviation/v1/service_server'),
 import('./server/crystalball/aviation/v1/handler'),
 import('./src/generated/server/crystalball/research/v1/service_server'),
 import('./server/crystalball/research/v1/handler'),
 import('./src/generated/server/crystalball/unrest/v1/service_server'),
 import('./server/crystalball/unrest/v1/handler'),
 import('./src/generated/server/crystalball/conflict/v1/service_server'),
 import('./server/crystalball/conflict/v1/handler'),
 import('./src/generated/server/crystalball/maritime/v1/service_server'),
 import('./server/crystalball/maritime/v1/handler'),
 import('./src/generated/server/crystalball/cyber/v1/service_server'),
 import('./server/crystalball/cyber/v1/handler'),
 import('./src/generated/server/crystalball/economic/v1/service_server'),
 import('./server/crystalball/economic/v1/handler'),
 import('./src/generated/server/crystalball/infrastructure/v1/service_server'),
 import('./server/crystalball/infrastructure/v1/handler'),
 import('./src/generated/server/crystalball/market/v1/service_server'),
 import('./server/crystalball/market/v1/handler'),
 import('./src/generated/server/crystalball/news/v1/service_server'),
 import('./server/crystalball/news/v1/handler'),
 import('./src/generated/server/crystalball/intelligence/v1/service_server'),
 import('./server/crystalball/intelligence/v1/handler'),
 import('./src/generated/server/crystalball/military/v1/service_server'),
 import('./server/crystalball/military/v1/handler'),
 import('./src/generated/server/crystalball/positive_events/v1/service_server'),
 import('./server/crystalball/positive-events/v1/handler'),
 import('./src/generated/server/crystalball/giving/v1/service_server'),
 import('./server/crystalball/giving/v1/handler'),
 import('./src/generated/server/crystalball/trade/v1/service_server'),
 import('./server/crystalball/trade/v1/handler'),
 ]);

 const serverOptions = { onError: errorMod.mapErrorToResponse };
 const allRoutes = [
 ...seismologyServerMod.createSeismologyServiceRoutes(seismologyHandlerMod.seismologyHandler, serverOptions),
 ...wildfireServerMod.createWildfireServiceRoutes(wildfireHandlerMod.wildfireHandler, serverOptions),
 ...climateServerMod.createClimateServiceRoutes(climateHandlerMod.climateHandler, serverOptions),
 ...predictionServerMod.createPredictionServiceRoutes(predictionHandlerMod.predictionHandler, serverOptions),
 ...displacementServerMod.createDisplacementServiceRoutes(displacementHandlerMod.displacementHandler, serverOptions),
 ...aviationServerMod.createAviationServiceRoutes(aviationHandlerMod.aviationHandler, serverOptions),
 ...researchServerMod.createResearchServiceRoutes(researchHandlerMod.researchHandler, serverOptions),
 ...unrestServerMod.createUnrestServiceRoutes(unrestHandlerMod.unrestHandler, serverOptions),
 ...conflictServerMod.createConflictServiceRoutes(conflictHandlerMod.conflictHandler, serverOptions),
 ...maritimeServerMod.createMaritimeServiceRoutes(maritimeHandlerMod.maritimeHandler, serverOptions),
 ...cyberServerMod.createCyberServiceRoutes(cyberHandlerMod.cyberHandler, serverOptions),
 ...economicServerMod.createEconomicServiceRoutes(economicHandlerMod.economicHandler, serverOptions),
 ...infrastructureServerMod.createInfrastructureServiceRoutes(infrastructureHandlerMod.infrastructureHandler, serverOptions),
 ...marketServerMod.createMarketServiceRoutes(marketHandlerMod.marketHandler, serverOptions),
 ...newsServerMod.createNewsServiceRoutes(newsHandlerMod.newsHandler, serverOptions),
 ...intelligenceServerMod.createIntelligenceServiceRoutes(intelligenceHandlerMod.intelligenceHandler, serverOptions),
 ...militaryServerMod.createMilitaryServiceRoutes(militaryHandlerMod.militaryHandler, serverOptions),
 ...positiveEventsServerMod.createPositiveEventsServiceRoutes(positiveEventsHandlerMod.positiveEventsHandler, serverOptions),
 ...givingServerMod.createGivingServiceRoutes(givingHandlerMod.givingHandler, serverOptions),
 ...tradeServerMod.createTradeServiceRoutes(tradeHandlerMod.tradeHandler, serverOptions),
 ];
 cachedCorsMod = corsMod;
 return routerMod.createRouter(allRoutes);
  }

  return {
 name: 'sebuf-api',
 configureServer(server) {
 // Invalidate cached router on HMR updates to server/ files
 server.watcher.on('change', (file) => {
 if (file.includes('/server/') || file.includes('/src/generated/server/')) {
 cachedRouter = null;
 }
 });

 server.middlewares.use(async (req, res, next) => {
 // Only intercept sebuf routes: /api/{domain}/v1/* (domain may contain hyphens)
 if (!req.url || !/^\/api\/[a-z-]+\/v1\//.test(req.url)) {
 return next();
 }

 try {
 // Build router once, reuse across requests (H-13 fix)
 if (!cachedRouter) {
 cachedRouter = await buildRouter();
 }
 const router = cachedRouter;
 const corsMod = cachedCorsMod;

 // Convert Connect IncomingMessage to Web Standard Request
 const port = server.config.server.port || 3000;
 const url = new URL(req.url, `http://localhost:${port}`);

 // Read body for POST requests
 let body: string | undefined;
 if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
 const chunks: Buffer[] = [];
 for await (const chunk of req) {
 chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
 }
 body = Buffer.concat(chunks).toString();
 }

 // Extract headers from IncomingMessage
 const headers: Record<string, string> = {};
 for (const [key, value] of Object.entries(req.headers)) {
 if (typeof value === 'string') {
 headers[key] = value;
 } else if (Array.isArray(value)) {
 headers[key] = value.join(', ');
 }
 }

 const webRequest = new Request(url.toString(), {
 method: req.method,
 headers,
 body: body || undefined,
 });

 const corsHeaders = corsMod.getCorsHeaders(webRequest);

 // OPTIONS preflight
 if (req.method === 'OPTIONS') {
 res.statusCode = 204;
 for (const [key, value] of Object.entries(corsHeaders)) {
 res.setHeader(key, value);
 }
 res.end();
 return;
 }

 // Origin check
 if (corsMod.isDisallowedOrigin(webRequest)) {
 res.statusCode = 403;
 res.setHeader('Content-Type', 'application/json');
 for (const [key, value] of Object.entries(corsHeaders)) {
 res.setHeader(key, value);
 }
 res.end(JSON.stringify({ error: 'Origin not allowed' }));
 return;
 }

 // Route matching
 const matchedHandler = router.match(webRequest);
 if (!matchedHandler) {
 res.statusCode = 404;
 res.setHeader('Content-Type', 'application/json');
 for (const [key, value] of Object.entries(corsHeaders)) {
 res.setHeader(key, value);
 }
 res.end(JSON.stringify({ error: 'Not found' }));
 return;
 }

 // Execute handler
 const response = await matchedHandler(webRequest);

 // Write response
 res.statusCode = response.status;
 response.headers.forEach((value, key) => {
 res.setHeader(key, value);
 });
 for (const [key, value] of Object.entries(corsHeaders)) {
 res.setHeader(key, value);
 }
 res.end(await response.text());
 } catch (err) {
 console.error('[sebuf-api] Error:', err);
 res.statusCode = 500;
 res.setHeader('Content-Type', 'application/json');
 res.end(JSON.stringify({ error: 'Internal server error' }));
 }
 });
 },
  };
}

// RSS proxy allowlist — duplicated from api/rss-proxy.js for dev mode.
// Keep in sync when adding new domains.
const RSS_PROXY_ALLOWED_DOMAINS = new Set([
  'feeds.bbci.co.uk', 'www.theguardian.com', 'feeds.npr.org', 'news.google.com',
  'www.aljazeera.com', 'rss.cnn.com', 'hnrss.org', 'feeds.arstechnica.com',
  'www.theverge.com', 'www.cnbc.com', 'feeds.marketwatch.com', 'www.defenseone.com',
  'breakingdefense.com', 'www.bellingcat.com', 'techcrunch.com', 'huggingface.co',
  'www.technologyreview.com', 'rss.arxiv.org', 'export.arxiv.org',
  'www.federalreserve.gov', 'www.sec.gov', 'www.whitehouse.gov', 'www.state.gov',
  'www.defense.gov', 'home.treasury.gov', 'www.justice.gov', 'tools.cdc.gov',
  'www.fema.gov', 'www.dhs.gov', 'www.thedrive.com', 'krebsonsecurity.com',
  'finance.yahoo.com', 'thediplomat.com', 'venturebeat.com', 'foreignpolicy.com',
  'www.ft.com', 'openai.com', 'www.reutersagency.com', 'feeds.reuters.com',
  'asia.nikkei.com', 'www.cfr.org', 'www.csis.org', 'www.politico.com',
  'www.brookings.edu', 'layoffs.fyi', 'www.defensenews.com', 'www.militarytimes.com',
  'taskandpurpose.com', 'news.usni.org', 'www.oryxspioenkop.com', 'www.gov.uk',
  'www.foreignaffairs.com', 'www.atlanticcouncil.org',
  // Tech variant
  'www.zdnet.com', 'www.techmeme.com', 'www.darkreading.com', 'www.schneier.com',
  'rss.politico.com', 'www.anandtech.com', 'www.tomshardware.com', 'www.semianalysis.com',
  'feed.infoq.com', 'thenewstack.io', 'devops.com', 'dev.to', 'lobste.rs', 'changelog.com',
  'seekingalpha.com', 'news.crunchbase.com', 'www.saastr.com', 'feeds.feedburner.com',
  'www.producthunt.com', 'www.axios.com', 'api.axios.com', 'github.blog', 'githubnext.com',
  'mshibanami.github.io', 'www.engadget.com', 'news.mit.edu', 'dev.events',
  'www.ycombinator.com', 'a16z.com', 'review.firstround.com', 'www.sequoiacap.com',
  'www.nfx.com', 'www.aaronsw.com', 'bothsidesofthetable.com', 'www.lennysnewsletter.com',
  'stratechery.com', 'www.eu-startups.com', 'tech.eu', 'sifted.eu', 'www.techinasia.com',
  'kr-asia.com', 'techcabal.com', 'disrupt-africa.com', 'lavca.org', 'contxto.com',
  'inc42.com', 'yourstory.com', 'pitchbook.com', 'www.cbinsights.com', 'www.techstars.com',
  // Regional & international
  'english.alarabiya.net', 'www.arabnews.com', 'www.timesofisrael.com', 'www.haaretz.com',
  'www.scmp.com', 'kyivindependent.com', 'www.themoscowtimes.com', 'feeds.24.com',
  'feeds.capi24.com', 'www.france24.com', 'www.euronews.com', 'www.lemonde.fr',
  'rss.dw.com', 'www.africanews.com', 'www.lasillavacia.com', 'www.channelnewsasia.com',
  'www.thehindu.com', 'news.un.org', 'www.iaea.org', 'www.who.int', 'www.cisa.gov',
  'www.crisisgroup.org',
  // Think tanks
  'rusi.org', 'warontherocks.com', 'www.aei.org', 'responsiblestatecraft.org',
  'www.fpri.org', 'jamestown.org', 'www.chathamhouse.org', 'ecfr.eu', 'www.gmfus.org',
  'www.wilsoncenter.org', 'www.lowyinstitute.org', 'www.mei.edu', 'www.stimson.org',
  'www.cnas.org', 'carnegieendowment.org', 'www.rand.org', 'fas.org',
  'www.armscontrol.org', 'www.nti.org', 'thebulletin.org', 'www.iss.europa.eu',
  // Economic & Food Security
  'www.fao.org', 'worldbank.org', 'www.imf.org',
  // Regional locale feeds
  'www.hurriyet.com.tr', 'tvn24.pl', 'www.polsatnews.pl', 'www.rp.pl', 'meduza.io',
  'novayagazeta.eu', 'www.bangkokpost.com', 'vnexpress.net', 'www.abc.net.au',
  'news.ycombinator.com',
  // Finance variant
  'www.coindesk.com', 'cointelegraph.com',
  // Happy variant — positive news sources
  'www.goodnewsnetwork.org', 'www.positive.news', 'reasonstobecheerful.world',
  'www.optimistdaily.com', 'www.sunnyskyz.com', 'www.huffpost.com',
  'www.sciencedaily.com', 'feeds.nature.com', 'www.livescience.com', 'www.newscientist.com',
  // Missing international/regional (synced from api/rss-proxy.js)
  'dailytrust.com', 'de.euronews.com', 'e00-elmundo.uecdn.es', 'es.euronews.com',
  'feeds.elpais.com', 'feeds.folha.uol.com.br', 'feeds.news24.com', 'feeds.nos.nl',
  'fr.africanews.com', 'fr.euronews.com', 'gcaptain.com', 'greatergood.berkeley.edu',
  'humanprogress.org', 'indianexpress.com', 'insightcrime.org', 'islandtimes.org',
  'it.euronews.com', 'japantoday.com', 'mexiconewsdaily.com', 'newsfeed.zeit.de',
  'pt.euronews.com', 'ru.euronews.com', 'singularityhub.com', 'thebetterindia.com',
  'tuoitrenews.vn', 'www.aljazeera.net', 'www.ansa.it', 'www.asahi.com',
  'www.bbc.com', 'www.bild.de', 'www.channelstv.com', 'www.clarin.com',
  'www.dailygood.org', 'www.dn.se', 'www.eltiempo.com', 'www.gdacs.org',
  'www.good.is', 'www.goodgoodgood.co', 'www.iefimerida.gr', 'www.in.gr',
  'www.jeuneafrique.com', 'www.middleeasteye.net', 'www.naftemporiki.gr',
  'www.nrc.nl', 'www.premiumtimesng.com', 'www.ransomware.live', 'www.repubblica.it',
  'www.rt.com', 'www.spiegel.de', 'www.svd.se', 'www.svt.se', 'www.tagesschau.de',
  'www.thisdaylive.com', 'www.twz.com', 'www.upworthy.com', 'www.vanguardngr.com',
  // Emergency / weather
  'api.weather.gov', 'www.nhc.noaa.gov', 'www.tsunami.gov', 'tfr.faa.gov',
  'www.nrc.gov', 'promedmail.org', 'www.metoc.navy.mil', 'www.iaea.org',
  'fews.net', 'www.fews.net', 'www.nerc.com', 'www.energy.gov', 'www.csb.gov',
  'www.phmsa.dot.gov', 'www.ferc.gov', 'emergency.copernicus.eu', 'www.cisa.gov',
  'inciweb.wildfire.gov',
  // Podcast feed hosts
  'feeds.megaphone.fm', 'rss.art19.com', 'rss.libsyn.com',
]);

function rssProxyPlugin(): Plugin {
  return {
 name: 'rss-proxy',
 configureServer(server) {
 server.middlewares.use(async (req, res, next) => {
 if (!req.url?.startsWith('/api/rss-proxy')) {
 return next();
 }

 const url = new URL(req.url, 'http://localhost');
 const feedUrl = url.searchParams.get('url');
 if (!feedUrl) {
 res.statusCode = 400;
 res.setHeader('Content-Type', 'application/json');
 res.end(JSON.stringify({ error: 'Missing url parameter' }));
 return;
 }

 try {
 const parsed = new URL(feedUrl);
 if (parsed.protocol !== 'https:') {
 res.statusCode = 403;
 res.setHeader('Content-Type', 'application/json');
 res.end(JSON.stringify({ error: 'Feed URL must use HTTPS' }));
 return;
 }
 const isAllowedDevDomain = (h: string) => {
 const bare = h.replace(/^www\./, '');
 return RSS_PROXY_ALLOWED_DOMAINS.has(h) || RSS_PROXY_ALLOWED_DOMAINS.has(bare) || RSS_PROXY_ALLOWED_DOMAINS.has(`www.${bare}`);
 };
 if (!isAllowedDevDomain(parsed.hostname)) {
 res.statusCode = 403;
 res.setHeader('Content-Type', 'application/json');
 res.end(JSON.stringify({ error: `Domain not allowed: ${parsed.hostname}` }));
 return;
 }

 const controller = new AbortController();
 const timeout = feedUrl.includes('news.google.com') ? 20000 : 12000;
 const timer = setTimeout(() => controller.abort(), timeout);
 const RSS_DEV_HEADERS = {
 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
 'Accept': 'application/rss+xml, application/xml, text/xml, */*',
 };

 // Manual redirect following — mirrors production proxy: HTTPS + allowlist on every hop.
 let currentUrl = feedUrl;
 let redirectCount = 0;
 const MAX_DEV_REDIRECTS = 5;
 let response: Response | null = null;
 while (redirectCount <= MAX_DEV_REDIRECTS) {
 response = await fetch(currentUrl, { signal: controller.signal, headers: RSS_DEV_HEADERS, redirect: 'manual' });
 if (response.status < 300 || response.status >= 400) break;
 const location = response.headers.get('location');
 if (!location) break;
 const redirectUrl = new URL(location, currentUrl);
 if (redirectUrl.protocol !== 'https:') throw new Error('Redirect to non-HTTPS URL');
 if (!isAllowedDevDomain(redirectUrl.hostname)) throw new Error('Redirect to disallowed domain');
 currentUrl = redirectUrl.href;
 redirectCount++;
 }
 clearTimeout(timer);
 if (!response) throw new Error('No response');

 const data = await response.text();
 res.statusCode = response.status;
 res.setHeader('Content-Type', 'application/xml');
 res.setHeader('Cache-Control', 'public, max-age=300');
 res.setHeader('Access-Control-Allow-Origin', '*');
 res.end(data);
 } catch (error: any) {
 console.error('[rss-proxy]', feedUrl, error.message);
 res.statusCode = error.name === 'AbortError' ? 504 : 502;
 res.setHeader('Content-Type', 'application/json');
 res.end(JSON.stringify({ error: error.name === 'AbortError' ? 'Feed timeout' : 'Failed to fetch feed' }));
 }
 });
 },
  };
}

function youtubeLivePlugin(): Plugin {
  return {
 name: 'youtube-live',
 configureServer(server) {
 server.middlewares.use(async (req, res, next) => {
 if (!req.url?.startsWith('/api/youtube/live')) {
 return next();
 }

 const url = new URL(req.url, 'http://localhost');
 const channel = url.searchParams.get('channel');

 if (!channel) {
 res.statusCode = 400;
 res.setHeader('Content-Type', 'application/json');
 res.end(JSON.stringify({ error: 'Missing channel parameter' }));
 return;
 }

 try {
 const channelHandle = channel.startsWith('@') ? channel : `@${channel}`;
 const liveUrl = `https://www.youtube.com/${channelHandle}/live`;

 const ytRes = await fetch(liveUrl, {
 headers: {
 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
 },
 redirect: 'follow',
 });

 if (!ytRes.ok) {
 res.setHeader('Content-Type', 'application/json');
 res.setHeader('Cache-Control', 'public, max-age=300');
 res.end(JSON.stringify({ videoId: null, channel }));
 return;
 }

 const html = await ytRes.text();

 // Scope both fields to the same videoDetails block so we don't
 // combine a videoId from one object with isLive from another.
 let videoId: string | null = null;
 const detailsIdx = html.indexOf('"videoDetails"');
 if (detailsIdx !== -1) {
 const block = html.substring(detailsIdx, detailsIdx + 5000);
 const vidMatch = block.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
 const liveMatch = block.match(/"isLive"\s*:\s*true/);
 if (vidMatch && liveMatch) {
 videoId = vidMatch[1];
 }
 }

 res.setHeader('Content-Type', 'application/json');
 res.setHeader('Cache-Control', 'public, max-age=300');
 res.end(JSON.stringify({ videoId, isLive: videoId !== null, channel }));
 } catch (error) {
 console.error(`[YouTube Live] Error:`, error);
 res.statusCode = 500;
 res.setHeader('Content-Type', 'application/json');
 res.end(JSON.stringify({ error: 'Failed to fetch', videoId: null }));
 }
 });
 },
  };
}

/**
 * Strips the WASM re-export from the satellite.js barrel at build time.
 *
 * satellite.js's dist/index.js does `export * from './wasm/index.js'`, and that
 * WASM entry uses top-level await — incompatible with the IIFE bundle that
 * vite-plugin-pwa emits. We only use the pure-JS SGP4 functions, never the WASM
 * bulk propagator, so the re-export is dead weight that breaks the build.
 *
 * This replaces the former scripts/patch-satellite-js.mjs postinstall step, which
 * mutated node_modules/satellite.js in place. A build transform keeps node_modules
 * pristine and closes the install-time-mutation supply-chain window (a compromised
 * satellite.js postinstall could have run before our patch did).
 */
function satelliteWasmStripPlugin(): Plugin {
  return {
 name: 'satellite-wasm-strip',
 enforce: 'pre',
 transform(code, id) {
 if (!id.includes('satellite.js/dist/index.js')) return null;
 const stripped = code.replace(/export \* from ['"]\.\/wasm\/index\.js['"];?\s*\n?/g, '');
 return stripped === code ? null : { code: stripped, map: null };
 },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  define: {
 __APP_VERSION__: JSON.stringify(pkg.version),
 __BUILD_VARIANT__: JSON.stringify(activeVariant),
 __BUILD_TAG__: JSON.stringify(buildTag),
 __BUILD_COMMIT_SHA__: JSON.stringify(buildCommitSha),
 __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
 // Build-time CPU arch: 'aarch64' on Apple Silicon, 'x64' on Intel.
 // Used by the auto-updater to select the matching DMG asset from GitHub Releases.
 __BUILD_ARCH__: JSON.stringify(process.arch === 'arm64' ? 'aarch64' : 'x64'),
  },
  plugins: [
 satelliteWasmStripPlugin(),
 htmlVariantPlugin(),
 polymarketPlugin(),
 rssProxyPlugin(),
 youtubeLivePlugin(),
 sebufApiPlugin(),
 brotliPrecompressPlugin(),
 {
 name: 'cesium-assets',
 configureServer(server) {
 const cesiumRoot = resolve(__dirname, 'node_modules/cesium/Build/Cesium');
 const mimeTypes: Record<string, string> = {
 '.js': 'application/javascript',
 '.json': 'application/json',
 '.css': 'text/css',
 '.png': 'image/png',
 '.jpg': 'image/jpeg',
 '.gif': 'image/gif',
 '.svg': 'image/svg+xml',
 '.wasm': 'application/wasm',
 '.glb': 'model/gltf-binary',
 };
 server.middlewares.use('/cesium', (req, res, next) => {
 const filePath = join(cesiumRoot, req.url ?? '');
 if (existsSync(filePath)) {
 const ext = extname(filePath);
 const mime = mimeTypes[ext] || 'application/octet-stream';
 res.setHeader('Content-Type', mime);
 createReadStream(filePath).pipe(res);
 } else {
 next();
 }
 });
 },
 writeBundle() {
 const cesiumSrc = resolve(__dirname, 'node_modules/cesium/Build/Cesium');
 const cesiumDest = resolve(__dirname, 'dist/cesium');
 for (const dir of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) {
 cpSync(`${cesiumSrc}/${dir}`, `${cesiumDest}/${dir}`, { recursive: true });
 }
 },
 } satisfies Plugin,
 VitePWA({
 registerType: 'autoUpdate',
 injectRegister: false,

 includeAssets: [
 'favico/favicon.ico',
 'favico/apple-touch-icon.png',
 'favico/favicon-32x32.png',
 ],

 manifest: {
 name: `${activeMeta.siteName} - ${activeMeta.subject}`,
 short_name: activeMeta.shortName,
 description: activeMeta.description,
 start_url: '/',
 scope: '/',
 display: 'standalone',
 orientation: 'any',
 theme_color: '#0a0f0a',
 background_color: '#0a0f0a',
 categories: activeMeta.categories,
 icons: [
 { src: '/favico/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
 { src: '/favico/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
 { src: '/favico/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
 ],
 },

 workbox: {
 globPatterns: ['**/*.{js,css,ico,png,svg,woff2,json}'],
 globIgnores: ['**/ml*.js', '**/onnx*.wasm', '**/locale-*.js'],
 maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, // 6 MiB — CesiumJS adds ~2.4 MiB to panels bundle
 navigateFallback: null,
 skipWaiting: true,
 clientsClaim: true,
 cleanupOutdatedCaches: true,

 runtimeCaching: [
 {
 urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
 handler: 'NetworkFirst',
 options: {
 cacheName: 'html-navigation',
 networkTimeoutSeconds: 3,
 },
 },
 {
 urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
 sameOrigin && /^\/api\//.test(url.pathname)
 // Don't persist personal-location responses (home/saved-place lat/lon) into
 // on-disk CacheStorage — they'd sit unencrypted in the browser profile.
 && !/[?&](lat|lon|latitude|longitude)=/i.test(url.search)
 // Never cache safety-critical realtime feeds (NWS/IPAWS/severe/volcano/quake):
 // a stale cached 200 would render an active warning as a fresh all-clear
 // during a connectivity gap. They get the NetworkOnly rule below (fail-closed).
 && !isSafetyFeedPath(url.pathname),
 handler: 'NetworkFirst',
 method: 'GET',
 options: {
 cacheName: 'api-responses',
 networkTimeoutSeconds: 5,
 expiration: { maxEntries: 200, maxAgeSeconds: 4 * 60 * 60 },
 cacheableResponse: { statuses: [0, 200] },
 },
 },
 {
 // Safety-critical realtime feeds — fail CLOSED. NetworkOnly means an outage
 // surfaces as a network error (the sidecar's 503 {stale:true}) the renderer
 // can record as stale, instead of a Workbox cache fallback marking it fresh.
 urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
 sameOrigin && isSafetyFeedPath(url.pathname),
 handler: 'NetworkOnly',
 method: 'GET',
 },
 {
 urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
 sameOrigin && /^\/api\//.test(url.pathname),
 handler: 'NetworkOnly',
 method: 'POST',
 },
 {
 urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
 sameOrigin && /^\/ingest\//.test(url.pathname),
 handler: 'NetworkOnly',
 method: 'GET',
 },
 {
 urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
 sameOrigin && /^\/ingest\//.test(url.pathname),
 handler: 'NetworkOnly',
 method: 'POST',
 },
 {
 urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
 sameOrigin && /^\/rss\//.test(url.pathname),
 handler: 'NetworkOnly',
 method: 'GET',
 },
 {
 urlPattern: /^https:\/\/api\.maptiler\.com\//,
 handler: 'CacheFirst',
 options: {
 cacheName: 'map-tiles',
 expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
 cacheableResponse: { statuses: [0, 200] },
 },
 },
 {
 urlPattern: /^https:\/\/[abc]\.basemaps\.cartocdn\.com\//,
 handler: 'CacheFirst',
 options: {
 cacheName: 'carto-tiles',
 expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
 cacheableResponse: { statuses: [0, 200] },
 },
 },
 {
 // Vector tiles, tile index, and glyph PBFs for the Apple-style label layers
 urlPattern: /^https:\/\/tiles\.basemaps\.cartocdn\.com\//,
 handler: 'CacheFirst',
 options: {
 cacheName: 'carto-vector',
 expiration: { maxEntries: 300, maxAgeSeconds: 7 * 24 * 60 * 60 },
 cacheableResponse: { statuses: [0, 200] },
 },
 },
 {
 urlPattern: /^https:\/\/[abc]\.tile\.opentopomap\.org\//,
 handler: 'CacheFirst',
 options: {
 cacheName: 'opentopomap-tiles',
 expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
 cacheableResponse: { statuses: [0, 200] },
 },
 },
 {
 urlPattern: /^https:\/\/gibs\.earthdata\.nasa\.gov\//,
 handler: 'CacheFirst',
 options: {
 cacheName: 'gibs-tiles',
 expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
 cacheableResponse: { statuses: [0, 200] },
 },
 },
 {
 urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
 handler: 'StaleWhileRevalidate',
 options: {
 cacheName: 'google-fonts-css',
 expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
 },
 },
 {
 urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
 handler: 'CacheFirst',
 options: {
 cacheName: 'google-fonts-woff',
 expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
 cacheableResponse: { statuses: [0, 200] },
 },
 },
 {
 urlPattern: /\/assets\/locale-.*\.js$/i,
 handler: 'CacheFirst',
 options: {
 cacheName: 'locale-files',
 expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
 cacheableResponse: { statuses: [0, 200] },
 },
 },
 {
 urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
 handler: 'StaleWhileRevalidate',
 options: {
 cacheName: 'images',
 expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
 },
 },
 ],
 },

 devOptions: {
 enabled: false,
 },
 }),
  ],
  // Worker bundles do not inherit the top-level `plugins` array, so the
  // satellite.js WASM re-export must be stripped here too — the SGP4 worker
  // imports the satellite.js barrel and would otherwise pull in the WASM
  // module's top-level await, which the IIFE worker output cannot represent.
  worker: {
 plugins: () => [satelliteWasmStripPlugin()],
  },
  resolve: {
 alias: {
 '@': resolve(__dirname, 'src'),
 child_process: resolve(__dirname, 'src/shims/child-process.ts'),
 'node:child_process': resolve(__dirname, 'src/shims/child-process.ts'),
 '@loaders.gl/worker-utils/dist/lib/process-utils/child-process-proxy.js': resolve(
 __dirname,
 'src/shims/child-process-proxy.ts'
 ),
 },
  },
  build: {
 // Geospatial bundles (maplibre/deck) are expected to be large even when split.
 // Raise warning threshold to reduce noisy false alarms in CI.
 chunkSizeWarningLimit: 1200,
 rollupOptions: {
 onwarn(warning, warn) {
 // onnxruntime-web ships a minified browser bundle that intentionally uses eval.
 // Keep build logs focused by filtering this known third-party warning only.
 if (
 warning.code === 'EVAL'
 && typeof warning.id === 'string'
 && warning.id.includes('/onnxruntime-web/dist/ort-web.min.js')
 ) {
 return;
 }

 warn(warning);
 },
 input: {
 main: resolve(__dirname, 'index.html'),
 settings: resolve(__dirname, 'settings.html'),
 liveChannels: resolve(__dirname, 'live-channels.html'),
 },
 output: {
 manualChunks(id) {
 if (id.includes('node_modules')) {
 if (id.includes('/@xenova/transformers/')) {
 return 'transformers';
 }
 if (id.includes('/onnxruntime-web/')) {
 return 'onnxruntime';
 }
 if (id.includes('/maplibre-gl/')) {
 return 'maplibre';
 }
 if (
 id.includes('/@deck.gl/')
 || id.includes('/@luma.gl/')
 || id.includes('/@loaders.gl/')
 || id.includes('/@math.gl/')
 || id.includes('/h3-js/')
 ) {
 return 'deck-stack';
 }
 if (id.includes('/d3/')) {
 return 'd3';
 }
 if (id.includes('/topojson-client/')) {
 return 'topojson';
 }
 if (id.includes('/i18next')) {
 return 'i18n';
 }
 if (id.includes('/@sentry/')) {
 return 'sentry';
 }
 if (id.includes('/cesium/')) {
 return 'cesium';
 }
 }
 // Panel chunk split — per
 // docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md
 // Priority 7. The single 'panels' chunk used to hold every
 // *Panel.ts. Split into recognizable groups so the browser can
 // skip irrelevant chunks for variants that don't use them, and so
 // raw chunk sizes shrink to under the 1.2 MB warning limit.
 if (id.includes('/src/components/') && id.endsWith('Panel.ts')) {
 const file = id.split('/').pop() ?? '';
 // Diagnostic / admin panels — heavyweight transitive imports
 // (failure-prediction, scenarios library, policy-gate). Only
 // mounted when the user opens the diagnostic surfaces.
 if (
 file.startsWith('SystemDiagnostic')
 || file.startsWith('AlgorithmDiagnostic')
 || file.startsWith('ApiDiagnostic')
 || file.startsWith('CommandCenter')
 || file.startsWith('Diagnostic')
 || file.startsWith('DebugAnalyst')
 || file.startsWith('Reasoning')
 || file.startsWith('AnalystHud')
 ) {
 return 'panels-diagnostic';
 }
 // Security / cyber / OSINT panels — phishing, IOC, sanctions,
 // threat intel. Checked BEFORE the panels-feeds rule so panels
 // whose names include 'Intel' (PulsediveIntel, ThreatIntelHub,
 // CyberThreatIntel, etc.) are routed here instead of panels-feeds.
 // These panels are rarely the first thing a user opens at boot.
 if (
 file.startsWith('Hibp')
 || file.startsWith('IpInfo')
 || file.startsWith('Bitcoin')
 || file.startsWith('RedditOsint')
 || file.startsWith('Phishstats')
 || file.startsWith('Urlscan')
 || file.startsWith('Pulsedive')
 || file.startsWith('Cyber')
 || file.startsWith('Threat')
 || file.startsWith('Sanctions')
 || file.startsWith('OpenSanctions')
 || file.startsWith('Sigint')
 || file.startsWith('Stix')
 || file.startsWith('Ioc')
 || file.startsWith('DarkWeb')
 || file.startsWith('DarkVessel')
 || file.startsWith('CompoundThreat')
 ) {
 return 'panels-security';
 }
 // Aviation / maritime / vessel panels — heavy on transit-specific
 // helpers and shared with the globe layer. Most users open at most
 // one of the two surfaces; splitting reduces eager work.
 if (
 file.startsWith('Aviation')
 || file.startsWith('Maritime')
 || file.startsWith('Vessel')
 || file.startsWith('AirTraffic')
 || file.startsWith('Airstrikes')
 ) {
 return 'panels-transit';
 }
 // Webcam panels — pull image-loading and stream-discovery
 // dependencies that aren't needed for the rest of the app.
 if (
 file.startsWith('LiveWebcams')
 || file.startsWith('UnifiedWebcam')
 || file.startsWith('PinnedWebcams')
 || file.includes('Webcam')
 ) {
 return 'panels-webcams';
 }
 // Military / strike-package / kill-chain / order-of-battle panels.
 // These open from the Intelligence drawer and bring scenario libraries
 // + cascade simulators with them.
 if (
 file.startsWith('Strike')
 || file.startsWith('Kill')
 || file.startsWith('Orbat')
 || file.startsWith('CourseOfAction')
 || file.startsWith('AfterAction')
 || file.startsWith('Combatant')
 || file.startsWith('CongressDefense')
 || file.startsWith('Dod')
 || file.startsWith('Nato')
 || file.startsWith('ForeignMil')
 || file.startsWith('Dsca')
 || file.startsWith('IswReports')
 || file.startsWith('SurvivalAdvisor')
 ) {
 return 'panels-military';
 }
 // Alert / notification / watchlist / situation panels — the
 // unified-inbox surface. Mounted everywhere but moves a lot of
 // alert-rules + dedupe + correlation-bridge logic.
 if (
 file.startsWith('Alert')
 || file.startsWith('Notification')
 || file.startsWith('UnifiedAlert')
 || file.startsWith('Watchlist')
 || file.startsWith('Saved')
 || file.startsWith('Situation')
 || file.startsWith('Amtrak')
 || file.startsWith('Disease')
 || file.startsWith('Displacement')
 || file.startsWith('Population')
 || file.startsWith('FoodInsecurity')
 || file.startsWith('Humanitarian')
 || file.startsWith('ShakeAlert')
 ) {
 return 'panels-alerts';
 }
 // Quote / wisdom / inspirational panels — tiny on their own but
 // share zero deps with the rest of the app. Bundle separately so
 // they don't bloat the catch-all panels chunk.
 if (
 file.startsWith('Stoic')
 || file.startsWith('Biblical')
 || file.startsWith('AlanWatts')
 || file.startsWith('McKenna')
 || file.startsWith('DailyWisdom')
 || file.startsWith('InspirationQuote')
 ) {
 return 'panels-wisdom';
 }
 // News / intel-feed panels — share GenericIntelFeed base.
 if (
 file.startsWith('News')
 || file.startsWith('LiveNews')
 || file.startsWith('Gdelt')
 || file.startsWith('GenericIntelFeed')
 || file.includes('Intel')
 || file.includes('Telegram')
 ) {
 return 'panels-feeds';
 }
 // Hazards / weather / disaster panels.
 if (
 file.startsWith('Nws')
 || file.startsWith('Weather')
 || file.startsWith('Earthquake')
 || file.startsWith('Wildfire')
 || file.startsWith('Volcano')
 || file.startsWith('Tsunami')
 || file.startsWith('Tropical')
 || file.startsWith('Pollen')
 || file.startsWith('AirQuality')
 || file.startsWith('FAAWeather')
 || file.startsWith('Hazard')
 || file.startsWith('Avalanche')
 || file.startsWith('Climate')
 || file.startsWith('Hazmat')
 || file.startsWith('OilSpill')
 || file.startsWith('TidePredictions')
 ) {
 return 'panels-hazards';
 }
 // Markets / finance panels.
 if (
 file.startsWith('Market')
 || file.startsWith('Crypto')
 || file.startsWith('Forex')
 || file.startsWith('Bond')
 || file.startsWith('FearGreed')
 || file.startsWith('FuelPrices')
 || file.startsWith('NationalDebt')
 || file.startsWith('FdicFailures')
 || file.startsWith('EdgarFilings')
 || file.startsWith('Finance')
 || file.startsWith('Polymarket')
 || file.startsWith('Stablecoin')
 || file.startsWith('Etf')
 || file.startsWith('Macro')
 || file.startsWith('Commodity')
 || file.startsWith('Heatmap')
 || file.startsWith('Federal')
 || file.startsWith('Trade')
 || file.startsWith('SupplyChain')
 || file.startsWith('Economic')
 ) {
 return 'panels-markets';
 }
 return 'panels';
 }
 // Give lazy-loaded locale chunks a recognizable prefix so the
 // service worker can exclude them from precache (en.json is
 // statically imported into the main bundle).
 const localeMatch = id.match(/\/locales\/(\w+)\.json$/);
 if (localeMatch && localeMatch[1] !== 'en') {
 return `locale-${localeMatch[1]}`;
 }
 return undefined;
 },
 },
 },
  },
  optimizeDeps: {
 // noDiscovery: prevent Vite from re-scanning for new deps at runtime.
 // Without this, every newly-discovered transitive dep triggers an
 // optimization re-run → "Outdated Optimize Dep" 504s in Tauri dev mode.
 noDiscovery: true,
 include: [
 '@sentry/browser',
 '@vercel/analytics',
 'i18next',
 'i18next-browser-languagedetector',
 'd3',
 'topojson-client',
 'maplibre-gl',
 'canvas-confetti',
 'h3-js',
 'supercluster',
 '@deck.gl/core',
 '@deck.gl/layers',
 '@deck.gl/geo-layers',
 '@deck.gl/aggregation-layers',
 '@deck.gl/mapbox',
 'papaparse',
 'posthog-js',
 'fast-xml-parser',
 'lz-string',
 'cesium',
 'mersenne-twister',
 'three',
 'three/examples/jsm/postprocessing/EffectComposer.js',
 'three/examples/jsm/postprocessing/RenderPass.js',
 'three/examples/jsm/postprocessing/UnrealBloomPass.js',
 ],
  },
  server: {
 warmup: {
 clientFiles: ['./src/main.ts'],
 },
 port: 3000,
 open: !isE2E && !isDesktopBuild,
 hmr: isE2E ? false : undefined,
 watch: {
 ignored: [
 '**/test-results/**',
 '**/playwright-report/**',
 '**/.playwright-mcp/**',
 ],
 },
 proxy: {
 // Yahoo Finance API
 '/api/yahoo': {
 target: 'https://query1.finance.yahoo.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
 },
 // Polymarket handled by polymarketPlugin() — no prod proxy needed
 // USGS Earthquake API
 '/api/earthquake': {
 target: 'https://earthquake.usgs.gov',
 changeOrigin: true,
 timeout: 30000,
 rewrite: (path) => path.replace(/^\/api\/earthquake/, ''),
 configure: (proxy) => {
 proxy.on('error', (err) => {
 console.log('Earthquake proxy error:', err.message);
 });
 },
 },
 // PizzINT - Pentagon Pizza Index
 '/api/pizzint': {
 target: 'https://www.pizzint.watch',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/api\/pizzint/, '/api'),
 configure: (proxy) => {
 proxy.on('error', (err) => {
 console.log('PizzINT proxy error:', err.message);
 });
 },
 },
 // FRED Economic Data - handled by Vercel serverless function in prod
 // In dev, we proxy to the API directly with the key from .env
 '/api/fred-data': {
 target: 'https://api.stlouisfed.org',
 changeOrigin: true,
 rewrite: (path) => {
 const url = new URL(path, 'http://localhost');
 const seriesId = url.searchParams.get('series_id');
 const start = url.searchParams.get('observation_start');
 const end = url.searchParams.get('observation_end');
 const apiKey = process.env.FRED_API_KEY || '';
 return `/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10${start ? `&observation_start=${start}` : ''}${end ? `&observation_end=${end}` : ''}`;
 },
 },
 // RSS Feeds - BBC
 '/rss/bbc': {
 target: 'https://feeds.bbci.co.uk',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/bbc/, ''),
 },
 // RSS Feeds - Guardian
 '/rss/guardian': {
 target: 'https://www.theguardian.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/guardian/, ''),
 },
 // RSS Feeds - NPR
 '/rss/npr': {
 target: 'https://feeds.npr.org',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/npr/, ''),
 },
 // RSS Feeds - Al Jazeera
 '/rss/aljazeera': {
 target: 'https://www.aljazeera.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/aljazeera/, ''),
 },
 // RSS Feeds - CNN
 '/rss/cnn': {
 target: 'http://rss.cnn.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/cnn/, ''),
 },
 // RSS Feeds - Hacker News
 '/rss/hn': {
 target: 'https://hnrss.org',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/hn/, ''),
 },
 // RSS Feeds - Ars Technica
 '/rss/arstechnica': {
 target: 'https://feeds.arstechnica.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/arstechnica/, ''),
 },
 // RSS Feeds - The Verge
 '/rss/verge': {
 target: 'https://www.theverge.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/verge/, ''),
 },
 // RSS Feeds - CNBC
 '/rss/cnbc': {
 target: 'https://www.cnbc.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/cnbc/, ''),
 },
 // RSS Feeds - MarketWatch
 '/rss/marketwatch': {
 target: 'https://feeds.marketwatch.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/marketwatch/, ''),
 },
 // RSS Feeds - Defense/Intel sources
 '/rss/defenseone': {
 target: 'https://www.defenseone.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/defenseone/, ''),
 },
 '/rss/warontherocks': {
 target: 'https://warontherocks.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/warontherocks/, ''),
 },
 '/rss/breakingdefense': {
 target: 'https://breakingdefense.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/breakingdefense/, ''),
 },
 '/rss/bellingcat': {
 target: 'https://www.bellingcat.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/bellingcat/, ''),
 },
 // RSS Feeds - TechCrunch (layoffs)
 '/rss/techcrunch': {
 target: 'https://techcrunch.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/techcrunch/, ''),
 },
 // Google News RSS
 '/rss/googlenews': {
 target: 'https://news.google.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/googlenews/, ''),
 },
 // AI Company Blogs
 '/rss/openai': {
 target: 'https://openai.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/openai/, ''),
 },
 '/rss/anthropic': {
 target: 'https://www.anthropic.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/anthropic/, ''),
 },
 '/rss/googleai': {
 target: 'https://blog.google',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/googleai/, ''),
 },
 '/rss/deepmind': {
 target: 'https://deepmind.google',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/deepmind/, ''),
 },
 '/rss/huggingface': {
 target: 'https://huggingface.co',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/huggingface/, ''),
 },
 '/rss/techreview': {
 target: 'https://www.technologyreview.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/techreview/, ''),
 },
 '/rss/arxiv': {
 target: 'https://rss.arxiv.org',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/arxiv/, ''),
 },
 // Government
 '/rss/whitehouse': {
 target: 'https://www.whitehouse.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/whitehouse/, ''),
 },
 '/rss/statedept': {
 target: 'https://www.state.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/statedept/, ''),
 },
 '/rss/state': {
 target: 'https://www.state.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/state/, ''),
 },
 '/rss/defense': {
 target: 'https://www.defense.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/defense/, ''),
 },
 '/rss/justice': {
 target: 'https://www.justice.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/justice/, ''),
 },
 '/rss/cdc': {
 target: 'https://tools.cdc.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/cdc/, ''),
 },
 '/rss/fema': {
 target: 'https://www.fema.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/fema/, ''),
 },
 '/rss/dhs': {
 target: 'https://www.dhs.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/dhs/, ''),
 },
 '/rss/fedreserve': {
 target: 'https://www.federalreserve.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/fedreserve/, ''),
 },
 '/rss/sec': {
 target: 'https://www.sec.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/sec/, ''),
 },
 '/rss/treasury': {
 target: 'https://home.treasury.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/treasury/, ''),
 },
 '/rss/cisa': {
 target: 'https://www.cisa.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/cisa/, ''),
 },
 // Think Tanks
 '/rss/brookings': {
 target: 'https://www.brookings.edu',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/brookings/, ''),
 },
 '/rss/cfr': {
 target: 'https://www.cfr.org',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/cfr/, ''),
 },
 '/rss/csis': {
 target: 'https://www.csis.org',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/csis/, ''),
 },
 // Defense
 '/rss/warzone': {
 target: 'https://www.thedrive.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/warzone/, ''),
 },
 '/rss/defensegov': {
 target: 'https://www.defense.gov',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/defensegov/, ''),
 },
 // Security
 '/rss/krebs': {
 target: 'https://krebsonsecurity.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/krebs/, ''),
 },
 // Finance
 '/rss/yahoonews': {
 target: 'https://finance.yahoo.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/yahoonews/, ''),
 },
 // Diplomat
 '/rss/diplomat': {
 target: 'https://thediplomat.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/diplomat/, ''),
 },
 // VentureBeat
 '/rss/venturebeat': {
 target: 'https://venturebeat.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/venturebeat/, ''),
 },
 // Foreign Policy
 '/rss/foreignpolicy': {
 target: 'https://foreignpolicy.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/foreignpolicy/, ''),
 },
 // Financial Times
 '/rss/ft': {
 target: 'https://www.ft.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/ft/, ''),
 },
 // Reuters
 '/rss/reuters': {
 target: 'https://www.reutersagency.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/rss\/reuters/, ''),
 },
 // Cloudflare Radar - Internet outages
 '/api/cloudflare-radar': {
 target: 'https://api.cloudflare.com',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/api\/cloudflare-radar/, ''),
 },
 // NGA Maritime Safety Information - Navigation Warnings
 '/api/nga-msi': {
 target: 'https://msi.nga.mil',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/api\/nga-msi/, ''),
 },
 // GDELT GEO 2.0 API - Global event data
 '/api/gdelt': {
 target: 'https://api.gdeltproject.org',
 changeOrigin: true,
 rewrite: (path) => path.replace(/^\/api\/gdelt/, ''),
 },
 // AISStream WebSocket proxy for live vessel tracking
 '/ws/aisstream': {
 target: 'wss://stream.aisstream.io',
 changeOrigin: true,
 ws: true,
 rewrite: (path) => path.replace(/^\/ws\/aisstream/, ''),
 },
 // FAA NASSTATUS - Airport delays and closures
 '/api/faa': {
 target: 'https://nasstatus.faa.gov',
 changeOrigin: true,
 secure: true,
 rewrite: (path) => path.replace(/^\/api\/faa/, ''),
 configure: (proxy) => {
 proxy.on('error', (err) => {
 console.log('FAA NASSTATUS proxy error:', err.message);
 });
 },
 },
 // OpenSky Network - Aircraft tracking (military flight detection)
 '/api/opensky': {
 target: 'https://opensky-network.org/api',
 changeOrigin: true,
 secure: true,
 rewrite: (path) => path.replace(/^\/api\/opensky/, ''),
 configure: (proxy) => {
 proxy.on('error', (err) => {
 console.log('OpenSky proxy error:', err.message);
 });
 },
 },
 // ADS-B Exchange - Military aircraft tracking (backup/supplement)
 '/api/adsb-exchange': {
 target: 'https://adsbexchange.com/api',
 changeOrigin: true,
 secure: true,
 rewrite: (path) => path.replace(/^\/api\/adsb-exchange/, ''),
 configure: (proxy) => {
 proxy.on('error', (err) => {
 console.log('ADS-B Exchange proxy error:', err.message);
 });
 },
 },
 },
  },
});

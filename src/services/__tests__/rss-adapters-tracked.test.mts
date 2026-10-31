import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Window } from 'happy-dom';

const cache = new Map<string, any>();
const fixture = { enabled: true, available: true, desktop: false, cache, response: '', status: 200, error: null as Error | null, lastUrl: '' };
(globalThis as any).__newsFixture = fixture;
(globalThis as any).DOMParser = new Window().DOMParser;
const stub = (body: string) => `data:text/javascript,${encodeURIComponent(`const f=globalThis.__newsFixture;${body}`)}`;
const stubs: Record<string, string> = {
  '/src/config/index.ts': `export const SITE_VARIANT='full';`,
  '/src/services/runtime.ts': `export const getApiBaseUrl=()=>''; export const isDesktopRuntime=()=>f.desktop; export const toRuntimeUrl=x=>x;`,
  '/src/services/runtime-config.ts': `export const isFeatureEnabled=()=>f.enabled; export const isFeatureAvailable=()=>f.available;`,
  '/src/services/persistent-cache.ts': `export const getPersistentCache=async k=>f.cache.get(k)||null; export const setPersistentCache=async(k,data)=>{f.cache.set(k,{data,updatedAt:Date.now()});};`,
  '/src/services/i18n.ts': `export const getCurrentLanguage=()=> 'en';`,
  '/src/services/threat-classifier.ts': `export const classifyByKeyword=()=>({level:'info',category:'general',source:'keyword',confidence:0});export const classifyWithAI=async()=>null;`,
  '/src/services/geo-hub-index.ts': `export const inferGeoHubsFromTitle=()=>[];`,
  '/src/services/trending-keywords.ts': `export const ingestHeadlines=()=>{};`,
  '/src/services/ai-classify-queue.ts': `export const canQueueAiClassification=()=>false;export const AI_CLASSIFY_MAX_PER_FEED=0;`,
  '/src/utils/index.ts': `export {fetchWithProxy} from '${new URL('../../utils/proxy.ts', import.meta.url).href}'; export const chunkArray=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));`,
  '/server/crystalball/news/v1/_feeds.ts': `export const VARIANT_FEEDS={full:{world:[{name:'Digest fixture',url:'https://example.org/digest'}]}};export const INTEL_SOURCES=[];`,
  '/server/_shared/redis.ts': `export const cachedFetchJsonWithMeta=async(k,t,fn)=>{if(f.cache.has(k))return {source:'cache',data:f.cache.get(k)};const data=await fn();if(data)f.cache.set(k,data);return {source:'fresh',data};};`,
};
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    const entry = Object.entries(stubs).find(([suffix]) => resolved.url.endsWith(suffix));
    return entry ? { url: stub(entry[1]), shortCircuit: true } : resolved;
  },
});
(globalThis as any).fetch = async (url: string) => { fixture.lastUrl = url; if(fixture.error) throw fixture.error; return new Response(fixture.response, {status: fixture.status}); };
const { fetchNewsApiHeadlinesTracked, normalizeSupplementalNews } = await import('../newsapi.ts');
const { fetchNewsDataFeedTracked } = await import('../newsdata.ts');
const { fetchFeedTracked, fetchCategoryFeedsTracked } = await import('../rss.ts');
const { fetchAndParseRss, listFeedDigest } = await import('../../../server/crystalball/news/v1/list-feed-digest.ts');
const xml = '<rss><channel><item><title>Headline</title><link>https://example.org/story</link></item></channel></rss>';

test('supplemental legacy dates preserve publication uncertainty and no acquisition proof', () => {
  const result = normalizeSupplementalNews([{source:'BBC',title:'Story',link:'https://bbc.com',pubDate:''}], 'newsapi');
  assert.equal(result.acquisition.acquiredAt, null);
  assert.equal(result.acquisition.outcome, 'unknown');
  assert.equal(result.items[0]?.provenance?.publicationState, 'missing');
  assert.equal(normalizeSupplementalNews({format:'tracked-v1',items:[]}, 'newsapi').acquisition.outcome, 'malformed');
});

test('supplemental disabled, web key absence, errors, and tracked cache are distinct', async () => {
  fixture.enabled=false;
  assert.equal((await fetchNewsApiHeadlinesTracked()).acquisition.outcome, 'disabled');
  fixture.enabled=true; fixture.available=false; fixture.desktop=false; fixture.status=429;
  assert.equal((await fetchNewsDataFeedTracked()).acquisition.outcome, 'rate_limited');
  fixture.status=200; fixture.response='not json';
  assert.equal((await fetchNewsDataFeedTracked()).acquisition.outcome, 'malformed');
  const acquiredAt=Date.now()-5000;
  fixture.response=JSON.stringify({format:'tracked-v1',items:[],acquisition:{outcome:'empty',delivery:'server_cache',acquiredAt,acceptedCount:0}});
  const result=await fetchNewsApiHeadlinesTracked();
  assert.equal(result.acquisition.delivery,'server_cache');assert.equal(result.acquisition.acquiredAt,acquiredAt);
});

test('RSS proxy HTTP200 and memory cache never manufacture upstream acquisition', async () => {
  fixture.status=200;fixture.response=xml;
  const feed={name:'proxied fixture',url:'/api/rss-proxy?url=https%3A%2F%2Fnews.google.com%2Frss'};
  const first=await fetchFeedTracked(feed);
  assert.equal(first.items.length,1);assert.equal(first.acquisition.acquiredAt,null);
  assert.equal(first.items[0]?.provenance?.publicationState,'missing');
  assert.equal(first.items[0]?.provenance?.deliveryGroup,'google-rss');
  const second=await fetchFeedTracked(feed);
  assert.equal(second.acquisition.delivery,'memory_cache');assert.equal(second.acquisition.acquiredAt,null);
  const category=await fetchCategoryFeedsTracked([feed]);
  assert.equal(category.feedAcquisitions[feed.name]?.acceptedCount,1);
});

test('RSS legacy persistent response, malformed body and valid empty differ', async () => {
  const url='/api/rss-proxy?url=https%3A%2F%2Fexample.org%2Flegacy';
  cache.set(`api-response:${url}`,{updatedAt:Date.now(),data:{body:xml,status:200,headers:{}}});
  const legacy=await fetchFeedTracked({name:'legacy fixture',url});
  assert.equal(legacy.acquisition.delivery,'persistent_cache');assert.equal(legacy.acquisition.acquiredAt,null);
  fixture.response='<html>challenge</html>';
  assert.equal((await fetchFeedTracked({name:'bad fixture',url:'https://example.org/bad'})).acquisition.outcome,'malformed');
  fixture.response='<rss><channel></channel></rss>';
  assert.equal((await fetchFeedTracked({name:'empty fixture',url:'https://example.org/empty'})).acquisition.outcome,'empty');
});

test('server RSS cache preserves acquisition and raw publication metadata', async () => {
  fixture.response=xml;fixture.status=200;
  const feed={name:'server fixture',url:'https://example.org/server'};
  const first=await fetchAndParseRss(feed,'full',new AbortController().signal);
  assert.equal(first.acquisition.outcome,'ok');assert.equal(first.acquisition.delivery,'upstream');
  assert.equal(first.items[0]?.provenance.publicationState,'missing');
  const second=await fetchAndParseRss(feed,'full',new AbortController().signal);
  assert.equal(second.acquisition.delivery,'server_cache');assert.equal(second.acquisition.acquiredAt,first.acquisition.acquiredAt);
  fixture.response='<html>challenge</html>';
  assert.equal((await fetchAndParseRss({...feed,url:'https://example.org/bad'},'full',new AbortController().signal)).acquisition.outcome,'malformed');
  fixture.response='<rss><channel></channel></rss>';
  assert.equal((await fetchAndParseRss({...feed,url:'https://example.org/empty'},'full',new AbortController().signal)).acquisition.outcome,'empty');
});


test('supplemental preserves authoritative missing configuration and requests exact response mode', async () => {
  fixture.status=503;
  fixture.response=JSON.stringify({format:'tracked-v1',items:[],acquisition:{outcome:'unconfigured',delivery:'unknown',acceptedCount:0}});
  assert.equal((await fetchNewsApiHeadlinesTracked()).acquisition.outcome,'unconfigured');
  assert.equal(new URL(fixture.lastUrl,'https://example.org').searchParams.get('responseMode'),'tracked-v1');
  fixture.status=200;fixture.error=Object.assign(new Error('timed out'),{name:'TimeoutError'});
  assert.equal((await fetchNewsDataFeedTracked()).acquisition.outcome,'timeout');
  fixture.error=null;
});

test('RSS failures keep denied, rate limited, and timeout states', async () => {
  for (const [status,outcome] of [[403,'denied'],[429,'rate_limited']] as const) {
    fixture.status=status;
    assert.equal((await fetchFeedTracked({name:`failure ${status}`,url:`https://example.org/${status}`})).acquisition.outcome,outcome);
  }
  fixture.status=200;fixture.error=Object.assign(new Error('timeout'),{name:'AbortError'});
  assert.equal((await fetchFeedTracked({name:'timeout fixture',url:'https://example.org/timeout'})).acquisition.outcome,'timeout');
  fixture.error=null;
});

test('malformed RSS proxy payloads are not persisted', async () => {
  const url='/api/rss-proxy?url=https%3A%2F%2Fexample.org%2Fchallenge';
  fixture.response='<html>challenge</html>';
  const result=await fetchFeedTracked({name:'uncached malformed fixture',url});
  assert.equal(result.acquisition.outcome,'malformed');
  assert.equal(cache.has(`api-response:${url}`),false);
});

test('digest cache preserves per-feed timestamps and item publication uncertainty', async () => {
  fixture.response=xml;
  const first=await listFeedDigest({} as any,{variant:'full',lang:'en'});
  assert.equal(first.feedStatuses['Digest fixture'],'ok');
  const acquisition=first.feedAcquisitions['Digest fixture'];
  assert.equal(acquisition?.delivery,'NEWS_DELIVERY_UPSTREAM');
  const second=await listFeedDigest({} as any,{variant:'full',lang:'en'});
  assert.equal(second.feedAcquisitions['Digest fixture']?.delivery,'NEWS_DELIVERY_SERVER_CACHE');
  assert.equal(second.feedAcquisitions['Digest fixture']?.acquiredAt,acquisition?.acquiredAt);
  assert.equal(second.categories.world?.items[0]?.provenance?.publicationState,'NEWS_PUBLICATION_STATE_MISSING');
});

test('RSS rejected links contribute no healthy rows or poisoned cache and recover next request', async () => {
  const rejectedLinks=['','not a URL','javascript:alert(1)'];
  for (const [index,link] of rejectedLinks.entries()) {
    const invalidXml=`<rss><channel><item><title>Titled malformed row</title>${link ? `<link>${link}</link>` : ''}</item></channel></rss>`;
    fixture.response=invalidXml;
    const clientFeed={name:`rejected-link-${index}`,url:`/api/rss-proxy?url=https%3A%2F%2Fexample.org%2Frejected-${index}`};
    const invalid=await fetchFeedTracked(clientFeed);
    assert.equal(invalid.acquisition.outcome,'malformed');
    assert.equal(invalid.acquisition.acceptedCount,0);
    assert.equal(invalid.items.length,0);
    assert.equal(cache.has(`api-response:${clientFeed.url}`),false);
    assert.equal(cache.has(`feed:${clientFeed.name}::en`),false);
    const serverFeed={name:clientFeed.name,url:`https://example.org/rejected-${index}`};
    const serverInvalid=await fetchAndParseRss(serverFeed,'full',new AbortController().signal);
    assert.equal(serverInvalid.acquisition.outcome,'malformed');
    assert.equal(serverInvalid.acquisition.acceptedCount,0);
    assert.equal(cache.has(`rss:feed:tracked-v1:${serverFeed.url}`),false);
    fixture.response=xml;
    assert.equal((await fetchFeedTracked(clientFeed)).acquisition.outcome,'ok');
    assert.equal((await fetchAndParseRss(serverFeed,'full',new AbortController().signal)).acquisition.outcome,'ok');
  }
});

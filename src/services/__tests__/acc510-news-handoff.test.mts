import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { Window } from 'happy-dom';

const state = { headlines: [] as any[], response: '', classificationCalls: 0 };
Object.assign(globalThis, { __acc510NewsHandoff: state, DOMParser: new Window().DOMParser });
const stubs: Record<string, string> = {
  '/src/config/index.ts': `export const SITE_VARIANT='full';`,
  '/src/utils/index.ts': `export const fetchWithProxy=async()=>new Response(s.response);export const chunkArray=(a)=>[a];`,
  '/src/utils/proxy.ts': `export const getProxyResponseAcquisition=()=>({});`,
  '/src/services/persistent-cache.ts': `export const getPersistentCache=async()=>null;export const setPersistentCache=async()=>{};`,
  '/src/services/i18n.ts': `export const getCurrentLanguage=()=> 'en';`,
  '/src/services/threat-classifier.ts': `export const classifyByKeyword=()=>{s.classificationCalls++;return {level:'high',category:'protest',source:'keyword',confidence:0.7};};export const classifyWithAI=async()=>{throw Error('unexpected extra classifier work');};`,
  '/src/services/geo-hub-index.ts': `export const inferGeoHubsFromTitle=()=>[];`,
  '/src/services/trending-keywords.ts': `export const ingestHeadlines=items=>s.headlines.push(...items);`,
  '/src/services/ai-classify-queue.ts': `export const canQueueAiClassification=()=>false;export const AI_CLASSIFY_MAX_PER_FEED=0;`,
};
registerHooks({ resolve(specifier, context, next) {
  const resolved = next(specifier, context);
  const entry = Object.entries(stubs).find(([suffix]) => resolved.url.endsWith(suffix));
  return entry ? { url: `data:text/javascript,${encodeURIComponent(`const s=globalThis.__acc510NewsHandoff;${entry[1]}`)}`, shortCircuit: true } : resolved;
} });
const { fetchFeedTracked } = await import('../rss.ts');

test('actual RSS handoff preserves existing classification and publication provenance without extra classification', async () => {
  state.response = '<rss><channel><item><title>Protests reported</title><link>https://example.org/protest</link></item></channel></rss>';
  const fetched = await fetchFeedTracked({ name: 'Handoff source', url: 'https://example.org/handoff' });
  assert.equal(fetched.items.length, 1);
  assert.equal(state.classificationCalls, 1);
  assert.equal(state.headlines.length, 1);
  assert.deepEqual(state.headlines[0].threat, fetched.items[0].threat);
  assert.deepEqual(state.headlines[0].provenance, fetched.items[0].provenance);
  assert.equal(state.headlines[0].provenance.publicationState, 'missing');
});

test('data loader passes original classification and provenance through its headline mapper', () => {
  const source = readFileSync(new URL('../../app/data-loader.ts', import.meta.url), 'utf8');
  const mapper = source.match(/ingestHeadlines\(items\.map\((i => \(\{[^\n]+\}\))\)\);/u)?.[1];
  assert.ok(mapper, 'expected the actual data-loader headline mapper');
  const map = new Function(`return (${mapper});`)();
  const item = { title: 'Protest report', pubDate: new Date(), source: 'Existing source', link: 'https://example.org/article', threat: { category: 'protest', source: 'ml', confidence: 0.6 }, provenance: { sourceId: 'existing-source-id', publicationState: 'invalid', publishedAt: null } };
  const transferred = map(item);
  assert.deepEqual(transferred.threat, item.threat);
  assert.deepEqual(transferred.provenance, item.provenance);
  assert.doesNotMatch(source, /source: \(p\.threat\.source \|\| 'keyword'\)/u);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const original = readFileSync(new URL('./fixtures/foreign-mil-original.ts.txt', import.meta.url), 'utf8');
const current = readFileSync(new URL('../foreign-mil-news.ts', import.meta.url), 'utf8');
const helper = readFileSync(new URL('../../utils/angle-span-text.ts', import.meta.url), 'utf8');
const now = Date.UTC(2026, 10, 8);
const day = 86400000;
function fingerprint(value: unknown): unknown {
  if (Object.prototype.toString.call(value) === '[object Date]') return { date: String(Number(value)) };
  if (typeof value === 'number' && !Number.isFinite(value)) return { number: String(value) };
  if (Array.isArray(value)) return Array.from(value, fingerprint);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fingerprint(v)]));
  return value;
}
function xml(rows: string[]) { return `<rss><channel>${rows.join('')}</channel></rss>`; }
function escapeXml(value:string) { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function item(title: string, description = 'military', date: string | null = new Date(now).toISOString()) {
  return `<item><title>${escapeXml(title)}</title><description>${escapeXml(description)}</description><link> https://example.test/a </link>${date === null ? '' : `<pubDate>${date}</pubDate>`}</item>`;
}
function harness(source: string, feeds: string[], failures: Record<number,string> = {}, settlementAdvance = 0) {
  let clock = now;
  const requests: unknown[] = [], bodies: number[] = [], events: unknown[] = [], settlements: unknown[] = [];
  const window = new Window({ settings: { enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true, enableCSSFileLoading: false, enableImageFileLoading: false, enableIframePageLoading: false, enableFileSystemHttpRequests: false, navigation: { disableMainFrameNavigation:true,disableChildFrameNavigation:true,disableChildPageNavigation:true,disableFallbackToSetURL:true } } });
  class FixedDate extends Date { constructor(value?: string | number) { super(value === undefined ? clock : value); } static now() { return clock; } }
  const observedPromise = { async allSettled(values: Iterable<unknown>) { const result = await Promise.allSettled(values); settlements.push(result.map(r=>r.status)); return result; } };
  const exports: Record<string, any> = {};
  const sourceWithoutImports = source.replace(/^import .*from .*;\n/gm, '');
  const compiled = ts.transpileModule(helper + '\n' + sourceWithoutImports, { compilerOptions: { target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(compiled, { exports, Date: FixedDate, DOMParser:window.DOMParser, Promise:observedPromise, AbortSignal:{timeout:(ms:number)=>({timeout:ms})}, dataFreshness:{recordUpdate:(...args:unknown[])=>events.push(['update',...args]),recordError:(...args:unknown[])=>events.push(['error',...args])}, fetch:async(url:string,options:unknown)=>{
    const index=requests.length%5; requests.push({url,options});
    if(failures[index]==='fetch') throw new Error('fetch fixture');
    // Reverse microtask completion while preserving actual allSettled ordering.
    for(let i=index;i<5;i++) await Promise.resolve();
    clock += settlementAdvance;
    return {ok:failures[index]!=='http',text:async()=>{bodies.push(index);if(failures[index]==='body')throw new Error('body fixture');return failures[index]==='parse' ? '<broken>' : feeds[index]??xml([]);}};
  }});
  return { api:exports, requests,bodies,events,settlements, advance:(ms:number)=>{clock+=ms;}, close:()=>window.happyDOM.abort() };
}
async function evaluate(source:string,feeds:string[],failures:Record<number,string>={}) {
  const h=harness(source,feeds,failures);
  try {
    const first=await h.api.fetchForeignMilNews(); const cached=await h.api.fetchForeignMilNews();
    assert.equal(first,cached); assert.equal(h.requests.length,5);
    h.advance(15*60000-1); assert.equal(await h.api.fetchForeignMilNews(),first);
    h.advance(1); const refreshed=await h.api.fetchForeignMilNews(); assert.notEqual(refreshed,first);assert.equal(h.requests.length,10);
    assert.deepEqual(h.settlements,[Array(5).fill('fulfilled'),Array(5).fill('fulfilled')]);
    return fingerprint({first,refreshed,requests:h.requests,bodies:h.bodies,events:h.events,settlements:h.settlements});
  } finally { await h.close(); }
}
if (process.env.FMN_PROBE) {
 const h=harness(process.env.FMN_PROBE==='original'?original:current,[xml([item('military probe','military '+'<'.repeat(300000))])]);
 process.stdout.write('READY\n');
 process.stdin.once('data',async()=>{try {const rows=await h.api.fetchForeignMilNews();assert.equal(rows.length,1);assert.equal(rows[0].description.length,400);process.stdout.write('PASS\n');await h.close();process.exit(0);}catch(error){console.error(error);process.exit(1);}});
} else {
test('immutable complete provider and raw fingerprints',()=>{
 assert.equal(createHash('sha256').update(original).digest('hex'),'2531231c226e748ea7a9c3e2a7db2816641705d1b46a8fe4f532e02faf2b940d');
 assert.deepEqual(fingerprint([new Date(NaN),NaN,Infinity,-Infinity]),[{date:'NaN'},{number:'NaN'},{number:'Infinity'},{number:'-Infinity'}]);
});
test('real XML descriptions, entity order, all-feed filtering and post-clip classification',async()=>{
 const cases=['<>','<<x>tail','a<x>b','<tail','&amp;lt;b&amp;gt;','&#39; &#039; &apos;','x\ny','x\n\ny','😀<x>z','a'.repeat(401)+' nuclear'];
 const feeds=Array.from({length:5},(_,i)=>xml([item(`ordinary ${i}`,'not relevant'),...cases.map((s,j)=>item(`military ${i} row ${j}`,s))]));
 const expected=await evaluate(original,feeds);assert.deepEqual(await evaluate(current,feeds),expected);
 const h=harness(current,[xml([item('military edge','a'.repeat(401)+' nuclear')])]);
 try { const rows=await h.api.fetchForeignMilNews();assert.equal(rows[0].severity,'critical');assert.equal(rows[0].description.length,400);assert.equal(rows.length,1); } finally {await h.close();}
});
test('under-limit source precedence, ASCII normalization and category precedence',async()=>{
 const feeds=[xml([item('MILITARY same!','exercise'),item('军队','military'),item('military first','exercise test nuclear')]),xml([item('military same','nuclear'),item('中文','military'),item('military deploy','deploy operation')]),xml([item('military warning','warning summit')])];
 assert.deepEqual(await evaluate(current,feeds),await evaluate(original,feeds));
 const h=harness(current,feeds);try {const rows=await h.api.fetchForeignMilNews();assert.equal(rows.length,5);assert.equal(rows.find((r:any)=>r.title==='MILITARY same!').source,'Russia-MoD');assert.equal(rows.filter((r:any)=>r.id.endsWith('-')).length,1);assert.equal(rows[0].category,'weapon-test');}finally{await h.close();}
});
test('under-limit cutoff, missing/invalid dates and Atom empty fallback semantics',async()=>{
 const feeds=[xml([item('military cutoff','exercise',new Date(now-7*day).toISOString()),item('military older','exercise',new Date(now-7*day-1).toISOString()),item('military invalid','exercise','invalid'),item('military absent','exercise',null)]) ,'<feed><entry><title>military atom</title><content></content><summary>nuclear</summary><published></published><updated>invalid</updated><link href=" first "/><link rel="alternate" href="second"/></entry></feed>'];
 assert.deepEqual(await evaluate(current,feeds),await evaluate(original,feeds));
 const h=harness(current,feeds);try {const rows=await h.api.fetchForeignMilNews();assert.equal(rows.length,3);const atom=rows.find((r:any)=>r.title==='military atom');assert.equal(atom.description,'');assert.equal(atom.url,' first ');assert.equal(+atom.pubDate,now);}finally{await h.close();}
});
test('50 row cap, stable order and 60-character title collisions',async()=>{
 const feeds=[xml([...Array.from({length:55},(_,i)=>item(`military ${i}`)),item('military'+ 'x'.repeat(60)+'a'),item('military'+'x'.repeat(60)+'b')])];
 assert.deepEqual(await evaluate(current,feeds),await evaluate(original,feeds));
 const h=harness(current,feeds);try {const rows=await h.api.fetchForeignMilNews();assert.equal(rows.length,50);assert.equal(rows[49].title,'military 49');}finally{await h.close();}
});
for(const mode of ['fetch','body','http','parse']) test(`all ${mode} failures remain fulfilled empty updates, not stale cache`,async()=>{
 const failures:Record<number,string>={};const feeds=[xml([item('military warm')])];
 const h=harness(current,feeds,failures);try{assert.equal((await h.api.fetchForeignMilNews()).length,1);for(let i=0;i<5;i++)failures[i]=mode;h.advance(15*60000);assert.equal((await h.api.fetchForeignMilNews()).length,0);assert.deepEqual(h.events,[['update','foreign-mil-news',1],['update','foreign-mil-news',0]]);assert.deepEqual(h.settlements,[Array(5).fill('fulfilled'),Array(5).fill('fulfilled')]);}finally{await h.close();}
 assert.deepEqual(await evaluate(current,feeds,failures),await evaluate(original,feeds,failures));
});
test('mixed feed failures preserve real statuses, source order and request behavior',async()=>{
 const feeds=Array.from({length:5},(_,i)=>xml([item(`military row ${i}`)]));
 const failures={0:'fetch',1:'body',2:'http'};
 assert.deepEqual(await evaluate(current,feeds,failures),await evaluate(original,feeds,failures));
 const h=harness(current,feeds,failures);
 try {const rows=await h.api.fetchForeignMilNews();assert.deepEqual(Array.from(rows,(r:any)=>r.source),['Xinhua','RT']);assert.deepEqual(h.events,[['update','foreign-mil-news',2]]);assert.deepEqual(h.settlements,[Array(5).fill('fulfilled')]);assert.equal(h.bodies.includes(0),false);assert.equal(h.bodies.includes(2),false);
 const urls=['https://eng.mil.ru/en/news/rss.htm','https://english.chinamil.com.cn/rss/pladailynews.xml','https://tass.com/rss/v2.xml','https://www.xinhuanet.com/english/rss/militarynews.xml','https://www.rt.com/rss/news/'];
 assert.deepEqual(fingerprint(h.requests),urls.map(url=>({url:`/api/rss-proxy?url=${encodeURIComponent(url)}`,options:{signal:{timeout:12000}}})));
 }finally{await h.close();}
});
test('cache timestamp is measured after advancing feed settlement, not invocation',async()=>{
 async function check(source:string){const h=harness(source,[xml([item('military clock','exercise',null)])],{},1000);
 try {const first=await h.api.fetchForeignMilNews();assert.equal(first.length,1);assert.equal(+first[0].pubDate,now+5000);h.advance(15*60000-1);assert.equal(await h.api.fetchForeignMilNews(),first);assert.equal(h.requests.length,5);h.advance(1);const next=await h.api.fetchForeignMilNews();assert.notEqual(next,first);assert.equal(h.requests.length,10);return fingerprint({first,next,events:h.events,settlements:h.settlements});}finally{await h.close();}}
 assert.deepEqual(await check(current),await check(original));
});
test('public severity classes and low-volume normalization collision fingerprints',async()=>{
 for(const source of [original,current]) {const h=harness(source,[xml([item('军队','military'),item('中文','military nuclear'),item('military'+'x'.repeat(60)+'a'),item('military'+'x'.repeat(60)+'b')])]);
 try {assert.deepEqual(['critical','high','medium','low','unexpected'].map(s=>h.api.foreignMilSeverityClass(s)),['text-red-500','text-orange-500','text-yellow-500','text-gray-400','text-gray-400']);const rows=await h.api.fetchForeignMilNews();assert.equal(rows.length,2);assert.equal(rows[0].title,'军队');assert.equal(rows[0].severity,'low');assert.equal(rows[1].title,'military'+'x'.repeat(60)+'a');}finally{await h.close();}}
});
test('actual trusted selector routes full provider and oracle',async()=>{
 const {deriveScriptIndex,mergeOverrides,OVERRIDES,selectScripts}=await import('../../../scripts/targeted-tests.mjs');
 const scripts=JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8')).scripts;
 assert.equal(scripts['test:foreign-mil-angle'],'tsx --test src/services/__tests__/foreign-mil-angle.test.mts','focused command must execute this suite');
 const overrides=JSON.parse(readFileSync(new URL('../../../scripts/targeted-tests-overrides.json',import.meta.url),'utf8'));
 for(const path of ['src/services/foreign-mil-news.ts','src/services/__tests__/foreign-mil-angle.test.mts','src/services/__tests__/fixtures/foreign-mil-original.ts.txt'])assert.ok(selectScripts([path],deriveScriptIndex(scripts),mergeOverrides(OVERRIDES,overrides)).scripts.includes('test:foreign-mil-angle'));
});

test('actual exported fetch path completes bounded unmatched-angle input',async()=>{
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url)],{env:{...process.env,FMN_PROBE:'current'},stdio:['pipe','pipe','pipe']});
 let output='',errors='';let timer:ReturnType<typeof setTimeout>;
 const kill=()=>{try{child.kill('SIGKILL');}catch{ /* already exited */ }};
 const startup=setTimeout(kill,10000);
 const exit=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.stderr.on('data',b=>{errors+=b;});child.stdout.on('data',b=>{output+=b;if(output==='READY\n'){clearTimeout(startup);timer=setTimeout(kill,2000);child.stdin.write('GO\n');}});child.on('exit',code=>{clearTimeout(startup);clearTimeout(timer);resolve(code);});});
 assert.equal(exit,0,output+errors);assert.match(output,/PASS/);
});
}

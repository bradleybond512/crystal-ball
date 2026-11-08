import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const originalSource = readFileSync(new URL('./fixtures/dsca-original.ts.txt', import.meta.url), 'utf8');
const actualSource = readFileSync(new URL('../dsca-arms-transfers.ts', import.meta.url), 'utf8');
const helper = readFileSync(new URL('../../utils/angle-span-text.ts', import.meta.url), 'utf8').replace('export function', 'function');
function compile(source: string): string {
  return ts.transpileModule(helper + '\n' + source.replace(/^import .*angle-span-text.*;\n/m, '') + '\nObject.assign(exports, {extractRecipient,stripHtml,extractSystems,detectCategory,detectSeverity,parseFederalRegisterDocs,parseDscaRss});', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
function load(source: string, context = {}) {
  const exports: Record<string, (...args: any[]) => any> = {};
  runInNewContext(compile(source), { exports, ...context });
  return exports;
}
const actual = load(actualSource), legacy = load(originalSource);
const ws=[' ','\t','\r','\n','\r\n','\v','\f','\u00a0','\u1680','\u2000','\u2028','\u2029','\u202f','\u205f','\u3000','\ufeff'];
test('recipient scanner preserves immutable regex oracle on 300802 cases', () => {
  let checked=0;
  const check=(s:string)=>{assert.equal(actual.extractRecipient(s),legacy.extractRecipient(s),JSON.stringify(s));checked++;};
  const prefixes=['Government of ','to ','x to ','xto ','_to ','9to ','éto ','TO ','government of ','Government of A! to '];
  const names=['A','AA','A ','A-','A-b','Ab CD','Ab\nCD','Ab1','ÄA','AB😀','AbGovernment of XZ'];
  const suffixes=['',',x','.x','(x',' for',' forrest',' to',' toward',' a ',' the ',' thex ',' FOR',';'];
  for(const p of prefixes)for(const name of names)for(const suffix of suffixes)for(const space of ws)check(p+name+space+suffix);
  const alphabet=['A','B','a','b',' ','\n','-',',','.','(','!','1','\u00a0'];
  for(let i=0;i<13**4;i++){let v=i,s='';for(let j=0;j<4;j++){s+=alphabet[v%13];v=Math.floor(v/13);}check('Government of '+s);check('to '+s);}
  let seed=0x12345678;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0);};
  const pieces=[...prefixes,...names,...suffixes,...ws,'Government of ','to ','for','a','the'];
  for(let i=0;i<100000;i++){let s='';const len=rnd()%12;for(let j=0;j<len;j++)s+=pieces[rnd()%pieces.length];check(s);}
  const hostile=['Government of A! ','Government of A, ','Government of A ','Government of Ab ','to A! ','to A, ','to A ','to Ab ','Government of to Ab ','to Government of Ab '];
  for(const a of hostile)for(const b of hostile)for(const w of ws)for(const suffix of suffixes)check(a+w+b+suffix);
  for(let i=0;i<100000;i++){let s='';const len=rnd()%50;for(let j=0;j<len;j++)s+=pieces[rnd()%pieces.length];check(s);}
  assert.equal(checked,300802);
});
test('angle extraction and category/severity retain literal behavior',()=>{
  const alphabet=['<','>','x','\n','é'];
  for(let i=0;i<3125;i++){let v=i,s='';for(let j=0;j<5;j++){s+=alphabet[v%5];v=Math.floor(v/5);}assert.equal(actual.stripHtml(s),legacy.stripHtml(s));}
  for(const s of ['<>','<<tail','&amp;lt;x&gt;','&#039; &quot;','🛰<x>é','\ud800<x>\udfff'])assert.equal(actual.stripHtml(s),legacy.stripHtml(s));
  const systems=['aircraft','f-16','f-35','f-15','c-130','ah-64','uh-60','m1a2','abrams','patriot','himars','jdam','aim-120','harpoon','javelin','stinger','apache','black hawk','submarine','frigate','destroyer','corvette','radar','missile','none'];
  for(const sys of systems)for(const qualifier of ['training','logistics','spare parts','commercial','letter of offer',''])for(const s of [sys,sys.toUpperCase(),'x'+sys+'x']){
    const text=qualifier+' '+s;const found=actual.extractSystems(text);assert.deepEqual(Array.from(found),Array.from(legacy.extractSystems(text)));
    const category=actual.detectCategory(text,found);assert.equal(category,legacy.detectCategory(text,found));
    for(const value of [null,'$99.99 million','$100 million','$1,000 million','$0 billion','nonsense'])assert.equal(actual.detectSeverity(category,value),legacy.detectSeverity(category,value));
  }
});
test('actual FR/RSS/cache/error behavior equals immutable original with synthetic fixtures',async(t)=>{
  const now=Date.parse('2026-11-08T12:00:00Z');
  const docs=[
    {title:'Sale to Poland for training',abstract:'Government of Taiwan for F-35 $100 million Transmittal No. 26-123',publication_date:'2026-11-08',document_number:'first'},
    {title:'Transfer to Japan for support',abstract:'Patriot $1 billion Transmittal 26-123',publication_date:'2026-11-08',document_number:'duplicate'},
    {title:'Transfer absent date',abstract:'Government of Ab, commercial',document_number:''},
    {title:'Sale invalid',publication_date:'bad'}, {title:'Sale epoch',publication_date:'1970-01-01'},
    {title:'Irrelevant',abstract:'none'},
    {title:'Transfer cutoff',publication_date:new Date(now-30*86400000).toISOString()},
    {title:'Transfer older',publication_date:new Date(now-30*86400000-1).toISOString()},
    ...Array.from({length:40},(_,i)=>({title:`Sale ${i}`,abstract:'<b>training</b>',publication_date:'2026-11-07',document_number:`id-${i}`})),
  ];
  const rss=docs.map(d=>({title:d.title,description:d.abstract,pubDate:d.publication_date,link:'https://example.test/'+d.document_number}));
  async function evaluate(source:string,mode:string){
    let clock=now;const requests:unknown[]=[];const bodies:string[]=[];const settlements:unknown[]=[];
    const observedPromise = {
      async allSettled(values: Iterable<unknown>) {
        const results = await Promise.allSettled(values);
        settlements.push(results.map((result, index) => result.status === 'fulfilled'
          ? { index, status: result.status }
          : { index, status: result.status, cause: { name: result.reason?.name, message: result.reason?.message } }));
        return results;
      }
    }
    class FixedDate extends Date{constructor(value?:string|number){super(value===undefined?clock:value);}static now(){return clock;}}
    class Parser{parseFromString(text:string){const rows=JSON.parse(text);return {querySelector:()=>mode==='parser-error'?{}:null,querySelectorAll:()=>rows.map((row:Record<string,string>)=>({querySelector:(key:string)=>row[key]===undefined?null:{textContent:row[key]}}))};}}
    const api=load(source,{Date:FixedDate,DOMParser:Parser,Promise:observedPromise,AbortSignal:{timeout:(ms:number)=>({ms})},fetch:async(url:string,options:unknown)=>{
      requests.push({url,options});const fr=url.includes('federalregister');
      if(mode==='reject'||(mode==='fr-fail'&&fr)||(mode==='rss-fail'&&!fr))throw new Error('fixture');
      return{ok:mode!=='non-ok',json:async()=>{bodies.push('json');if(mode==='body-reject')throw new Error('body');return mode==='missing-results'?{}:{results:mode==='empty'?[]:docs};},text:async()=>{bodies.push('text');if(mode==='body-reject')throw new Error('body');return JSON.stringify(mode==='empty'?[]:rss);}};
    }});
    const first=await api.fetchArmsTransfers(),cached=await api.fetchArmsTransfers();assert.equal(first,cached);assert.equal(requests.length,2);clock+=30*60*1000;const expired=await api.fetchArmsTransfers();assert.equal(requests.length,4);if(mode==='non-ok')assert.equal(bodies.length,0);
    assert.equal(settlements.length,2,'each cache-miss records real allSettled results; cache hit does not');
    const expected = mode === 'reject' || mode === 'body-reject' ? ['rejected','rejected']
      : mode === 'fr-fail' ? ['rejected','fulfilled']
      : mode === 'rss-fail' ? ['fulfilled','rejected'] : ['fulfilled','fulfilled'];
    for (const batch of settlements as {index:number;status:string}[][]) {
      assert.deepEqual(batch.map(row=>row.index),[0,1],'FR then RSS order');
      assert.deepEqual(batch.map(row=>row.status),expected,mode);
    }
    const rawFR=api.parseFederalRegisterDocs(docs),rawRSS=api.parseDscaRss(JSON.stringify(rss));
    return JSON.parse(JSON.stringify({first,expired,rawFR,rawRSS,requests,bodies,settlements}));
  }
  for(const mode of ['ok','empty','reject','fr-fail','rss-fail','non-ok','body-reject','parser-error','missing-results']) {
    const current = await evaluate(actualSource,mode);
    const original = await evaluate(originalSource,mode);
    assert.deepEqual(current,original,mode);
    t.diagnostic(JSON.stringify({mode,settlements:current.settlements}));
  }
});
for(const [name,expression]of [['angle',"exports.stripHtml('<'.repeat(100000))"],['government',"exports.extractRecipient('Government of A'+' '.repeat(100000)+'!')"],['to',"exports.extractRecipient('to A'+' '.repeat(100000)+'!')"]]){
  test(name+' actual parser has bounded READY/GO work',async()=>{
    const code='const exports={};'+compile(actualSource)+`\nconsole.log('READY');process.stdin.once('data',()=>{${expression};process.stdin.pause();});`;
    const result=await new Promise<{status:number|null;error:string|undefined;ready:boolean}>(resolve=>{let ready=false,error:string|undefined,out='';const child=spawn(process.execPath,['-e',code]);let timer=setTimeout(()=>{error='startup deadline';child.kill('SIGKILL');},10000);child.stdout.on('data',(b:Buffer)=>{out+=b;if(!ready&&out.includes('READY\n')){ready=true;clearTimeout(timer);timer=setTimeout(()=>{error='actual work exceeded 1s after READY';child.kill('SIGKILL');},1000);child.stdin.end('GO\n');}});child.once('error',e=>{error=e.message;});child.once('close',status=>{clearTimeout(timer);resolve({status,error,ready});});});assert.equal(result.ready,true);assert.equal(result.error,undefined);assert.equal(result.status,0);
  });
}
test('actual selector routes provider and immutable oracle to focused suite',async()=>{
 const {deriveScriptIndex,mergeOverrides,OVERRIDES,selectScripts}=await import('../../../scripts/targeted-tests.mjs');
 const scripts=JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8')).scripts;
 const declared=JSON.parse(readFileSync(new URL('../../../scripts/targeted-tests-overrides.json',import.meta.url),'utf8'));
 for(const f of ['src/services/dsca-arms-transfers.ts','src/services/__tests__/dsca-angle.test.mts','src/services/__tests__/fixtures/dsca-original.ts.txt'])assert.ok(selectScripts([f],deriveScriptIndex(scripts),mergeOverrides(OVERRIDES,declared)).scripts.includes('test:dsca-angle'),f);
});

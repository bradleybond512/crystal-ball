import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const original=readFileSync(new URL('./fixtures/spc-original.ts.txt',import.meta.url),'utf8');
const actual=readFileSync(new URL('../spc-mesoscale.ts',import.meta.url),'utf8');
const helper=readFileSync(new URL('../../utils/angle-span-text.ts',import.meta.url),'utf8');
const now=Date.parse('2026-11-08T12:00:00Z');
function compile(source:string){return ts.transpileModule(helper+'\n'+source.replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}
function harness(source:string){
 let clock=now,body='',mode='ok';const events:unknown[]=[],requests:unknown[]=[],reads:string[]=[];
 class Clock extends Date{constructor(value?:string|number){super(value===undefined?clock:value);}static now(){return clock;}}
 const exports:Record<string,any>={};runInNewContext(compile(source),{exports,Date:Clock,dataFreshness:{recordUpdate:(...x:unknown[])=>events.push(['update',...x]),recordError:(...x:unknown[])=>events.push(['error',...x])},AbortSignal:{timeout:(ms:number)=>({ms})},fetch:async(url:string,options:unknown)=>{requests.push({url,options});if(mode==='throw')throw new Error('fetch fixture');return{ok:mode!=='503',status:503,text:async()=>{reads.push('text');if(mode==='body')throw new Error('body fixture');return body;}};}});
 return{exports,events,requests,reads,set:(xml:string,m='ok',time=clock)=>{body=xml;mode=m;clock=time;}};
}
function fingerprint(value:any):any{
 if(Object.prototype.toString.call(value)==='[object Date]')return{date:value.getTime(),iso:Number.isNaN(value.getTime())?'invalid':value.toISOString()};
 if(Array.isArray(value))return Array.from(value,fingerprint);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).map(k=>[k,fingerprint(value[k])]));
 if(typeof value==='number'&&Number.isNaN(value))return'NaN';return value;
}
function item(id:string,title='Mesoscale Discussion 12',description='plain',date=new Date(now).toISOString(),cdata=true){return `<item><guid>${id}</guid><title>${title}</title><description>${cdata?'<![CDATA['+description+']]>':description}</description><pubDate>${date}</pubDate><link>https://fixture.invalid/${id}</link></item>`;}
async function compare(xml:string){const a=harness(actual),b=harness(original);a.set(xml);b.set(xml);const x=await a.exports.fetchMesoscaleDiscussions(),y=await b.exports.fetchMesoscaleDiscussions();assert.deepEqual(fingerprint(x),fingerprint(y));assert.deepEqual(fingerprint(a.events),fingerprint(b.events));assert.deepEqual(fingerprint(a.requests),fingerprint(b.requests));return x;}
test('full original-module oracle preserves raw text, entities, Unicode and dates',async()=>{
 const texts=['<>','<x>','<<x>','x<<<tail','a<x>b<y>c','&amp;lt;x&gt;','&#39; &#039; &apos; &quot; &nbsp;','a\tb','a\t\nb','🛰<x>é','\ud800<x>\udfff','a<>b','<\n>'];
 for(const text of texts)for(const cdata of [false,true]){const rows=await compare(item('a',undefined,text,undefined,cdata));assert.equal(rows.length,1);}
 for(const date of ['', 'invalid',new Date(now-48*3600000-1).toISOString(),new Date(now-48*3600000).toISOString(),new Date(now-48*3600000+1).toISOString()])await compare(item('date',undefined,'plain',date));
 const valid=await compare(item('',undefined,'TX TX CA tx'));assert.equal(valid[0].id,`spc-md-12-${now}`);assert.deepEqual(Array.from(valid[0].affectedStates),['TX','CA']);
 assert.equal((await compare(item('x','missing number'))).length,0);assert.equal((await compare(item('x',''))).length,0);
});
test('separate under-limit classification and stable severity/date ordering',async()=>{
 const cases=[['tornado',false,'high'],['tornado',true,'critical'],['severe thunderstorm',false,'medium'],['severe thunderstorm',true,'high'],['fire weather',false,'medium'],['flooding',false,'medium'],['winter storm',false,'low'],['plain',false,'low'],['PDS',false,'critical'],['Particularly Dangerous Situation',false,'critical']] as const;
 for(const [text,watch,severity]of cases){const rows=await compare(item('x',`Mesoscale Discussion 12${watch?' Watch Issued':''}`,text));assert.equal(rows[0].severity,severity);}
 const rows=await compare(item('low',undefined,'plain')+item('high-old',undefined,'tornado',new Date(now-1000).toISOString())+item('high-new',undefined,'tornado')+item('critical',undefined,'PDS'));assert.deepEqual(Array.from(rows,(x:any)=>x.id),['critical','high-new','high-old','low']);
 const capped=await compare(Array.from({length:30},(_,i)=>item(String(i))).join(''));assert.equal(capped.length,25);assert.deepEqual(Array.from(capped,(x:any)=>x.id),Array.from({length:25},(_,i)=>String(i)));
 for(const severity of ['critical','high','medium','low'])assert.equal(harness(actual).exports.mdSeverityClass(severity),harness(original).exports.mdSeverityClass(severity));
 for(const type of ['tornado','severe-thunderstorm','fire-weather','flooding','winter','general'])assert.equal(harness(actual).exports.mdTypeLabel(type),harness(original).exports.mdTypeLabel(type));
});
test('actual exported cache, status, exception, body and freshness behavior',async()=>{
 for(const mode of ['ok','503','throw','body'])for(const warm of [false,true]){
  async function evaluate(source:string){const h=harness(source);let prior:any;if(warm){h.set(item('warm'));prior=await h.exports.fetchMesoscaleDiscussions();h.set(item('new'),mode,now+300000);}else h.set(item('new'),mode);
   const result=await h.exports.fetchMesoscaleDiscussions();if(warm&&mode!=='ok')assert.equal(result,prior);if(mode!=='ok'&&!warm)assert.equal(result.length,0);
   if(mode!=='ok'){assert.deepEqual(fingerprint(h.events.at(-1)),['error','spc-mesoscale',mode==='503'?'HTTP 503':mode==='throw'?'Error: fetch fixture':'Error: body fixture']);}
   if(mode==='503')assert.equal(h.reads.length,warm?1:0);
   return fingerprint({result,events:h.events,requests:h.requests,reads:h.reads});}
  assert.deepEqual(await evaluate(actual),await evaluate(original));
 }
 for(const source of [actual,original]){
  const h=harness(source);h.set(item('first'));const first=await h.exports.fetchMesoscaleDiscussions();h.set(item('second'),'ok',now+299999);assert.equal(await h.exports.fetchMesoscaleDiscussions(),first);assert.equal(h.requests.length,1);assert.equal(h.events.length,1);
  h.set('','503',now+300000);assert.equal(await h.exports.fetchMesoscaleDiscussions(),first);h.set('','ok',now+300001);const empty=await h.exports.fetchMesoscaleDiscussions();assert.equal(empty.length,0);assert.equal(h.requests.length,3);assert.deepEqual(fingerprint(h.events.at(-1)),['update','spc-mesoscale',0]);h.set(item('later'),'ok',now+300002);assert.equal(await h.exports.fetchMesoscaleDiscussions(),empty);
  assert.deepEqual(fingerprint(h.requests[0]),{url:'/api/rss-proxy?url=https%3A%2F%2Fwww.spc.noaa.gov%2Fproducts%2Fmd%2Frss.xml',options:{signal:{ms:12000}}});
 }
});
test('exported fetch completes adversarial CDATA work after READY/GO',async()=>{
 const code=`const exports={};const dataFreshness={recordUpdate(){},recordError(){throw Error('unexpected error')}};const AbortSignal={timeout:()=>null};const xml=${JSON.stringify(item('hostile',undefined,'<'.repeat(100000)))};const fetch=async()=>({ok:true,text:async()=>xml});`+compile(actual)+`\nconsole.log('READY');process.stdin.once('data',async()=>{const r=await exports.fetchMesoscaleDiscussions();if(r.length!==1||r[0].description!=='<'.repeat(100000))throw Error('unexpected result');console.log('DONE');process.stdin.pause();});`;
 const result=await new Promise<{status:number|null;ready:boolean;out:string;error?:string}>(resolve=>{let ready=false,out='',error:string|undefined;const child=spawn(process.execPath,['-e',code]);let timer=setTimeout(()=>{error='startup deadline';child.kill('SIGKILL');},10000);child.stdout.on('data',(b:Buffer)=>{out+=b;if(!ready&&out.includes('READY\n')){ready=true;clearTimeout(timer);timer=setTimeout(()=>{error='actual work exceeded 1s after READY';child.kill('SIGKILL');},1000);child.stdin.end('GO\n');}});child.once('error',e=>{error=e.message;});child.once('close',status=>{clearTimeout(timer);resolve({status,ready,out,error});});});assert.equal(result.ready,true);assert.equal(result.error,undefined);assert.equal(result.status,0);assert.ok(result.out.includes('DONE'));
});
test('actual selector reaches package runner from provider, test and oracle',async()=>{
 const {deriveScriptIndex,mergeOverrides,OVERRIDES,selectScripts}=await import('../../../scripts/targeted-tests.mjs');const scripts=JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8')).scripts;const declared=JSON.parse(readFileSync(new URL('../../../scripts/targeted-tests-overrides.json',import.meta.url),'utf8'));
 for(const f of ['src/services/spc-mesoscale.ts','src/services/__tests__/spc-angle.test.mts','src/services/__tests__/fixtures/spc-original.ts.txt'])assert.ok(selectScripts([f],deriveScriptIndex(scripts),mergeOverrides(OVERRIDES,declared)).scripts.includes('test:spc-angle'),f);
 assert.equal(scripts['test:spc-angle'],'tsx --test src/services/__tests__/spc-angle.test.mts');
});

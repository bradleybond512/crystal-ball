import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { spawn } from 'node:child_process';
import ts from 'typescript';
const originalSource=readFileSync(new URL('./fixtures/aerospace-original.ts.txt',import.meta.url),'utf8');
const actualSource=readFileSync(new URL('../aerospace-reentry.ts',import.meta.url),'utf8');
const helper=readFileSync(new URL('../../utils/angle-span-text.ts',import.meta.url),'utf8').replace('export function','function');
function compile(source:string){return ts.transpileModule(helper+'\n'+source.replace(/^import .*angle-span-text.*;\n/m,'')+'\nObject.assign(exports,{stripHtml,detectObjectType,detectCountry,computeSurvivability,computeSeverity,parseAerospaceHtml,parseCelesTrakDecay});',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}
function load(source:string,context={}){const exports:Record<string,(...args:any[])=>any>={};runInNewContext(compile(source),{exports,...context});return exports;}
const actual=load(actualSource),original=load(originalSource);
function normalize(x: unknown): unknown {
 if (x === undefined) return { kind: 'undefined' };
 if (typeof x === 'number') {
  if (Number.isNaN(x)) return { kind: 'number', value: 'NaN' };
  if (!Number.isFinite(x)) return { kind: 'number', value: String(x) };
  if (Object.is(x, -0)) return { kind: 'number', value: '-0' };
 }
 if (Object.prototype.toString.call(x) === '[object Date]') {
  const time = Date.prototype.getTime.call(x);
  return { kind: 'Date', time: normalize(time) };
 }
 if (Array.isArray(x)) return Array.from(x, normalize);
 if (x !== null && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([key, value]) => [key, normalize(value)]));
 return x;
}
test('angle and country/type classifications equal immutable provider',()=>{
 const alphabet=['<','>','x','\n','é'];for(let i=0;i<3125;i++){let n=i,s='';for(let k=0;k<5;k++){s+=alphabet[n%5];n=Math.floor(n/5);}assert.equal(actual.stripHtml(s),original.stripHtml(s));}
 for(const s of ['&#039;','&amp;lt;x&gt;','<>','<<tail','🛰<x>é'])assert.equal(actual.stripHtml(s),original.stripHtml(s));
 const tokens=['COSMOS','KOSMOS','PROTON','SOYUZ','PROGRESS','MOLNIYA','ZENIT','ROKOT','STRELA','RADUGA','GORIZONT','EKSPRESS','LUCH','YAMAL','MERIDIAN','GONETS','URAGAN','GLONASS','ELEKTRO','RESURS','SICH','OKEAN','METEOR','TSELINA','PARUS','TSIKLON','TSIKADA','CZ-','FENGYUN','TIANGONG','SHENZHOU','TIANHE','WENTIAN','MENGTIAN','BEIDOU','YAOGAN','HAIYANG','ZIYUAN','SHIYAN','SHIJIAN',"CHANG'E",'TIANWEN','ZHONGXING','CHINASAT','ATLAS','DELTA','FALCON','THOR','TITAN','CENTAUR','AGENA','STARLINK','GPS','NAVSTAR','DMSP','DSP','AEHF','WGS','MUOS','SBIRS','NROL','ARIANE','VEGA','GALILEO','ENVISAT','SENTINEL','METEOSAT','SPOT','H-II','H2','HTV','HAYABUSA','AKATSUKI','HIMAWARI','ALOS','PSLV','GSLV','CARTOSAT','RESOURCESAT','RISAT','IRNSS','NAVIC'];
 for(const token of tokens)for(const before of ['','x','_','1','é','-',' '])for(const after of ['','x','_','1','é','-',' '])for(const text of [before+token+after,(before+token+after).toLowerCase(),'FALCON '+token+' TIANGONG'])assert.equal(actual.detectCountry('ignored',text),original.detectCountry('ignored',text),text);
 for(const name of ['R/B','RB','ROCKET','BOOSTER','STAGE','DEB','DEBRIS','FRAGMENT','abc','abcd','🛰','R/B DEBRIS','DEB RB','xRBx','STARLINK'])assert.equal(actual.detectObjectType(name),original.detectObjectType(name),name);
});
test('numeric and scoring boundaries preserve unchanged policies',()=>{
 for(const mass of [null,NaN,-Infinity,Infinity,-1,-0,0,499,500,501,999,1000,1001,2999,3000,3001,9999,10000,10001])for(const type of ['rocket-body','debris','satellite','unknown'])assert.equal(actual.computeSurvivability(mass,type),original.computeSurvivability(mass,type));
 for(const survival of ['high','partial','low'])for(const adversary of [false,true])for(const lat of [null,NaN,-Infinity,Infinity,-60.001,-60,-59.999,-0,0,59.999,60,60.001])for(const lon of [null,-180,0,180,NaN])assert.equal(actual.computeSeverity(survival,adversary,lat,lon),original.computeSeverity(survival,adversary,lat,lon));
});
const headers=['Object','COSPAR ID','Mass','Reentry Time','Latitude','Longitude'];
function dom(tables:string[][][]){return class {parseFromString(input:string){if(input==='THROW')throw new Error('DOM parse failure');return {querySelectorAll:(selector:string)=>{assert.equal(selector,'table');return tables.map(rows=>({querySelectorAll:(s:string)=>{assert.equal(s,'tr');return rows.map(cells=>({querySelectorAll:(q:string)=>{assert.ok(q==='th, td'||q==='td');return cells.map(textContent=>({textContent}));}}));}}));}};}};}
test('whole parser output retains headers, rows, numeric coercion and CelesTrak quirks',()=>{
 const now=Date.parse('2026-11-08T12:00:00Z');class Clock extends Date{static now(){return now;}}
 const rows=[headers,...['0','-50','1e3','1,000','NaN','Infinity','500','1000','3000','10000','10001'].map((m,i)=>['PROTON R/B',i%2?'':'id-'+i,m,i%3?'bad':'2026-11-08',i%2?'Infinity':'59.999','0']),['','','2'],['short'],['STARLINK','','0','1970-01-01','-60','bad']];
 const tableSets=[[],[[]],[[headers]],[[['Object','name','other'],['FALCON','id','500']]],[[['Mass','value','other'],['FALCON','id','500']]],[[['unrelated'],['x','y','z']]],[rows],[rows,rows],[[['Mass Object','Reentry COSPAR','Object','Time','Lat','Lon'],['a','b','c','d','e','f']]],[ [['Object','Mass','other'],['FALCON','','0'],['COSMOS','','42']] ]];
 for(const tables of tableSets){const context={DOMParser:dom(tables),Date:Clock};assert.deepEqual(normalize(load(actualSource,context).parseAerospaceHtml('fixture')),normalize(load(originalSource,context).parseAerospaceHtml('fixture')));}
 const entries=[];for(const type of ['PAYLOAD','ROCKET BODY','DEBRIS','UNKNOWN','','TBA'])for(const date of ['','bad','1970-01-01',new Date(now-30*86400000-1).toISOString(),new Date(now-30*86400000).toISOString(),'2026-11-09'])entries.push({SATNAME:' PROTON ',INTLDES:'',NORAD_CAT_ID:0,DECAY:date,OBJECT_TYPE:type,COUNTRY:'US'});
 assert.deepEqual(normalize(load(actualSource,{Date:Clock}).parseCelesTrakDecay(entries)),normalize(load(originalSource,{Date:Clock}).parseCelesTrakDecay(entries)));
});
test('actual allSettled status/order, fetch, cache, dedup and error behavior',async(t)=>{
 async function evaluate(source:string,mode:string){let now=Date.parse('2026-11-08T12:00:00Z');class Clock extends Date{constructor(v?:any){super(v===undefined?now:v);}static now(){return now;}}
 const requests:any[]=[],bodies:string[]=[],settlements:any[]=[];const rows=[headers,...Array.from({length:55},(_,i)=>[i%2?'PROTON R/B':'FALCON','id-'+i,String(i*250),'2026-11-08',String(i%2?0:60),'0'])];
 const entries=[{INTLDES:'id-0',SATNAME:'replacement',DECAY:'2026-11-08',OBJECT_TYPE:'DEBRIS'}, {INTLDES:'',NORAD_CAT_ID:0,SATNAME:'',DECAY:'2026-11-08'}];
 const PromiseSeam={async allSettled(values:any[]){const results=await Promise.allSettled(values);settlements.push(results.map((v,index)=>({index,status:v.status,...(v.status==='rejected'?{cause:{name:v.reason.name,message:v.reason.message}}:{})})));return results;}};
 const api=load(source,{Date:Clock,DOMParser:dom(mode==='empty'?[]:rows.length?[rows]:[]),Promise:PromiseSeam,AbortSignal:{timeout:(ms:number)=>({ms})},fetch:async(url:string,options:any)=>{const index=url.includes('rss-proxy')?0:1;requests.push({index,url,options});if(mode==='reject'||mode===`reject-${index}`)throw new Error('fetch '+index);return{ok:mode!=='non-ok',text:async()=>{bodies.push('text');if(mode==='body-reject')throw new Error('text failure');return mode==='parser-error'?'THROW':'fixture';},json:async()=>{bodies.push('json');if(mode==='body-reject')throw new Error('json failure');return mode==='malformed'?{}:mode==='empty'?[]:entries;}};}});
 const first=await api.fetchDebrisReentries();now+=7200000-1;assert.equal(await api.fetchDebrisReentries(),first);now++;const expired=await api.fetchDebrisReentries();assert.notEqual(expired,first);assert.equal(requests.length,4);assert.equal(settlements.length,2);
 const expected=mode==='reject'||mode==='body-reject'?['rejected','rejected']:mode==='reject-0'||mode==='parser-error'?['rejected','fulfilled']:mode==='reject-1'?['fulfilled','rejected']:['fulfilled','fulfilled'];
 for(const batch of settlements){assert.deepEqual(batch.map((v:any)=>v.index),[0,1]);assert.deepEqual(batch.map((v:any)=>v.status),expected,mode);}if(mode==='non-ok')assert.deepEqual(bodies,[]);
 return normalize({first,expired,requests,bodies,settlements});}
 for(const mode of ['ok','empty','reject','reject-0','reject-1','non-ok','body-reject','parser-error','malformed']){const a=await evaluate(actualSource,mode);assert.deepEqual(a,await evaluate(originalSource,mode),mode);t.diagnostic(JSON.stringify({mode,settlements:(a as {settlements:unknown}).settlements}));}
});
test('actual angle parser has bounded READY/GO work',async()=>{
 const code='const exports={};'+compile(actualSource)+"\nconsole.log('READY');process.stdin.once('data',()=>{exports.stripHtml('<'.repeat(100000));process.stdin.pause();});";
 const result=await new Promise<{status:number|null;error:string|undefined;ready:boolean}>(resolve=>{let ready=false,error:string|undefined,out='';const child=spawn(process.execPath,['-e',code]);let timer=setTimeout(()=>{error='startup deadline';child.kill('SIGKILL');},10000);child.stdout.on('data',(b:Buffer)=>{out+=b;if(!ready&&out.includes('READY\n')){ready=true;clearTimeout(timer);timer=setTimeout(()=>{error='actual work exceeded 1s after READY';child.kill('SIGKILL');},1000);child.stdin.end('GO\n');}});child.once('error',e=>{error=e.message;});child.once('close',status=>{clearTimeout(timer);resolve({status,error,ready});});});assert.equal(result.ready,true);assert.equal(result.error,undefined);assert.equal(result.status,0);
});
test('actual selector routes provider and immutable oracle to focused suite',async()=>{
 const {deriveScriptIndex,mergeOverrides,OVERRIDES,selectScripts}=await import('../../../scripts/targeted-tests.mjs');
 const scripts=JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8')).scripts;
 const declared=JSON.parse(readFileSync(new URL('../../../scripts/targeted-tests-overrides.json',import.meta.url),'utf8'));
 for(const file of ['src/services/aerospace-reentry.ts','src/services/__tests__/aerospace-angle.test.mts','src/services/__tests__/fixtures/aerospace-original.ts.txt'])assert.ok(selectScripts([file],deriveScriptIndex(scripts),mergeOverrides(OVERRIDES,declared)).scripts.includes('test:aerospace-angle'),file);
});

test('raw fingerprint distinguishes nonfinite numbers, signed zero and invalid dates',()=>{
 const values=[null,undefined,NaN,Infinity,-Infinity,-0,0,new Date(NaN),new Date(0)];
 const fingerprints=values.map(value=>JSON.stringify(normalize(value)));
 assert.equal(new Set(fingerprints).size,values.length);
 const crossRealm=runInNewContext('new Date(NaN)');
 assert.deepEqual(normalize(crossRealm),normalize(new Date(NaN)));
});

test('untruncated source precedence and stable versus temporal ordering',async()=>{
 const now=Date.parse('2026-11-08T12:00:00Z');class Clock extends Date{constructor(v?:any){super(v===undefined?now:v);}static now(){return now;}}
 const tables=[[headers,
 ['FALCON first-source','duplicate','500','2026-11-08T10:00:00Z','0','0'],
 ['FALCON late','late','500','2026-11-08T11:00:00Z','0','0'],
 ['FALCON tie-first','tie-first','500','2026-11-08T09:00:00Z','0','0'],
 ['FALCON early','early','500','2026-11-08T08:00:00Z','0','0'],
 ['FALCON tie-second','tie-second','500','2026-11-08T09:00:00Z','0','0']]];
 const entries=[{INTLDES:'duplicate',SATNAME:'FALCON second-source',DECAY:'2026-11-08T10:00:00Z',OBJECT_TYPE:'PAYLOAD'}];
 async function evaluate(source:string){
  const api=load(source,{Date:Clock,DOMParser:dom(tables),AbortSignal:{timeout:(ms:number)=>({ms})},fetch:async()=>({ok:true,text:async()=> 'fixture',json:async()=>entries})});
  const report=await api.fetchDebrisReentries();
  assert.equal(report.predictions.length,5);
  assert.equal(report.predictions.find((v:any)=>v.cosparId==='duplicate').objectName,'FALCON first-source');
  assert.equal(report.predictions.find((v:any)=>v.cosparId==='duplicate').massKg,500);
  assert.deepEqual(Array.from(report.predictions,(v:any)=>v.cosparId),['early','tie-first','tie-second','duplicate','late']);
  return normalize(report);
 }
 assert.deepEqual(await evaluate(actualSource),await evaluate(originalSource));
});

/* eslint-disable sonarjs/no-clear-text-protocols, sonarjs/no-hardcoded-ip -- synthetic private-address and insecure-protocol rejection fixtures */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialVerifier } from '../credential-verification.mjs';
async function propertyOf(attempt, key) { const answer = await attempt; return answer[key]; }
const response = (status, body) => ({status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body)});
test('provider evidence requires auth-dependent payload and never treats outages as evidence', async () => {
 for (const [status,body,outcome] of [[200,{object:'list',data:[{id:'model',object:'model',type:'model'}]},'verified'],[200,{},'unavailable'],[401,{error:{code:'invalid_api_key'}},'rejected'],[403,{error:'forbidden'},'unavailable'],[429,{},'unavailable'],[503,{},'unavailable']]) {
  const verify=createCredentialVerifier({fetch:async()=>response(status,body)});
  assert.equal(await propertyOf(verify('GROQ_API_KEY','synthetic-canary'), 'outcome'),outcome);
 }
});
test('public endpoints and local settings do not claim verification or send credentials', async()=>{
 let calls=0; const verify=createCredentialVerifier({fetch:async()=>{calls++;throw new Error('secret-canary');}});
 for(const key of ['OPENROUTER_API_KEY','IPINFO_TOKEN','HIBP_API_KEY','WTO_API_KEY']) assert.equal(await propertyOf(verify(key,'synthetic-canary'), 'outcome'),'not-probed');
 assert.equal(calls,0);
});
test('bounded transport disables redirects and strips errors',async()=>{
 let request;
 const verify=createCredentialVerifier({fetch:async(...args)=>{request=args;throw new Error('secret-canary');}});
 assert.deepEqual(await verify('GROQ_API_KEY','synthetic-canary'),{outcome:'unavailable',reason:'provider-unavailable'});
 const [url,options,timeout]=request;
 assert.equal(new URL(url).hostname,'api.groq.com');assert.equal(options.redirect,'error');assert.equal(options.maxResponseBytes,262_144);assert.ok(timeout<=12_000);
});
test('two probes maximum, overlapping and recent credential attempts never queue',async()=>{
 let finish; const pending=new Promise(resolve=>finish=resolve);let count=0;let now=0;
 const verify=createCredentialVerifier({now:()=>now,fetch:async()=>{count++;await pending;return response(200,{object:'list',data:[{id:'model',object:'model',type:'model'}]});}});
 const first=verify('GROQ_API_KEY','synthetic-a');const duplicate=verify('GROQ_API_KEY','synthetic-a');assert.equal(duplicate,first);const second=verify('ANTHROPIC_API_KEY','synthetic-b');
 assert.equal(await propertyOf(verify('GROQ_API_KEY','different-draft'), 'reason'),'cooldown');
 assert.equal(await propertyOf(verify('FRED_API_KEY','synthetic-c'), 'reason'),'concurrency-limit'); assert.equal(count,2);
 finish();await Promise.all([first,second]);assert.equal(await propertyOf(verify('GROQ_API_KEY','synthetic-a'), 'reason'),'cooldown');now=60_000;assert.equal(await propertyOf(verify('GROQ_API_KEY','synthetic-a'), 'outcome'),'verified');
});
test('total deadline includes unread response body',async()=>{
 const verify=createCredentialVerifier({deadlineMs:10,fetch:async()=>({status:200,ok:true,text:()=>new Promise(()=>{})})});
 let watchdog;
 const actual=await Promise.race([verify('GROQ_API_KEY','synthetic-canary'),new Promise(resolve=>{watchdog=setTimeout(()=>resolve('exceeded-deadline'),500);})]);
 clearTimeout(watchdog);
 assert.deepEqual(actual,{outcome:'unavailable',reason:'timeout'});
});
test('OpenSky pair context only forwards required companion and never invents acceptance',async()=>{
 const verify=createCredentialVerifier({fetch:async(url,options)=>{assert.equal(new URL(url).hostname,'auth.opensky-network.org');assert.equal(options.body.get('client_secret'),'partner');assert.equal(options.body.has('GROQ_API_KEY'),false);return response(200,{access_token:'opaque-canary'});}});
 assert.equal(await propertyOf(verify('OPENSKY_CLIENT_ID','client',{OPENSKY_CLIENT_SECRET:'partner',GROQ_API_KEY:'unrelated'}), 'outcome'),'verified');
});

test('empty and malformed model lists cannot establish authentication',async()=>{
 for(const key of ['GROQ_API_KEY','ANTHROPIC_API_KEY']) for(const body of [{data:[]},{object:'list',data:[{id:'',object:'model',type:'model'}]},{data:[{id:'x'}]}]) {
  assert.equal(await propertyOf(createCredentialVerifier({fetch:async()=>response(200,body)})(key,'synthetic'), 'outcome'),'unavailable');
 }
});
test('unstructured 401, missing-key and scope errors never become provider rejection',async()=>{
 for(const key of ['GROQ_API_KEY','ANTHROPIC_API_KEY','CESIUM_ION_TOKEN','VIRUSTOTAL_API_KEY','MAPBOX_API_KEY','NASA_API_KEY']) {
  for(const body of [{message:'Unauthorized'},{error:{code:'API_KEY_MISSING'}},{error:{code:'insufficient_scope'}}]) {
   assert.equal(await propertyOf(createCredentialVerifier({fetch:async()=>response(401,body)})(key,'synthetic'), 'outcome'),'unavailable');
  }
 }
});
test('oversize response, redirect and canary errors return only fixed wire fields',async()=>{
 for(const [status,body] of [[200,{canary:'x'.repeat(262_145)}],[302,{error:{code:'invalid_api_key'}}],[403,{error_message:'synthetic-secret-canary'}]]) {
  assert.deepEqual(await createCredentialVerifier({fetch:async()=>response(status,body)})('GROQ_API_KEY','synthetic-secret-canary'),{outcome:'unavailable',reason:'inconclusive-response'});
 }
});
test('URL settings never probe private, metadata or redirected destinations',async()=>{
 let calls=0;
 const verify=createCredentialVerifier({fetch:async()=>{calls++;throw new Error('must not fetch');}});
 for(const value of ['http://127.0.0.1:1234','http://169.254.169.254/latest/meta-data/','https://example.invalid/path']) assert.equal(await propertyOf(verify('OLLAMA_API_URL',value), 'outcome'),'not-probed');
 assert.equal(await propertyOf(verify('OLLAMA_API_URL','ftp://example.invalid'), 'outcome'),'invalid-format');
 assert.equal(calls,0);
});
test('Cloudflare success envelope permits its empty errors array',async()=>{
 const verify=createCredentialVerifier({fetch:async()=>response(200,{success:true,errors:[],messages:[],result:{annotations:[]}})});
 assert.deepEqual(await verify('CLOUDFLARE_API_TOKEN','synthetic'),{outcome:'verified',reason:'provider-accepted'});
});

test('a large otherwise-valid body cannot establish verification',async()=>{
 const body=' '.repeat(262_145)+JSON.stringify({object:'list',data:[{id:'model',object:'model'}]});
 const verify=createCredentialVerifier({fetch:async()=>({status:200,ok:true,text:async()=>body})});
 assert.deepEqual(await verify('GROQ_API_KEY','synthetic'),{outcome:'unavailable',reason:'inconclusive-response'});
});

const authenticatedPayloads = {
 GROQ_API_KEY:{object:'list',data:[{id:'model',object:'model'}]},
 ANTHROPIC_API_KEY:{data:[{id:'model',type:'model'}]},
 FRED_API_KEY:{seriess:[{id:'GDP'}]},
 EIA_API_KEY:{response:{id:'api'}},
 CLOUDFLARE_API_TOKEN:{success:true,errors:[],result:{annotations:[]}},
 ACLED_ACCESS_TOKEN:{success:true,data:[{event_id_cnty:'synthetic'}]},
 URLHAUS_AUTH_KEY:{query_status:'ok',urls:[{id:1}]},
 THREATFOX_API_KEY:{query_status:'ok',data:[{id:'1'}]},
 OTX_API_KEY:{username:'synthetic',id:1},
 ABUSEIPDB_API_KEY:{data:{ipAddress:'8.8.8.8',abuseConfidenceScore:0}},
 VIRUSTOTAL_API_KEY:{data:{type:'file'}},
 URLSCAN_API_KEY:{limits:{private:{}}},
 VULNERS_API_KEY:{result:'OK',data:{valid:true}},
 BITCOINABUSE_API_KEY:{count:0},
 WINGBITS_API_KEY:{flights:[{hex:'synthetic'}]},
 FINNHUB_API_KEY:{c:1},
 FMP_API_KEY:[{symbol:'AAPL'}],
 AIRNOW_API_KEY:[{AQI:1,ParameterName:'PM2.5'}],
 PURPLEAIR_API_KEY:{api_version:'V1.0.0',key_type:'READ'},
 NEWSAPI_KEY:{status:'ok',articles:[]},
 NEWSDATA_API_KEY:{status:'success',results:[]},
 MEDIASTACK_API_KEY:{pagination:{count:0},data:[]},
 AVIATIONSTACK_API:{pagination:{count:0},data:[]},
 OWM_API_KEY:{cod:200,main:{temp:1}},
 NASA_API_KEY:{date:'2026-11-03',title:'synthetic',media_type:'image'},
 OPENSKY_CLIENT_ID:{access_token:'synthetic-token'},
 OPENSKY_CLIENT_SECRET:{access_token:'synthetic-token'},
 GOOGLE_MAPS_API_KEY:{status:'ZERO_RESULTS',routes:[]},
 MAPBOX_API_KEY:{type:'FeatureCollection',features:[]},
 MAPTILER_API_KEY:{version:8,sources:{},layers:[]},
 CESIUM_ION_TOKEN:{id:1,username:'synthetic'},
 GEONAMES_USERNAME:{totalResultsCount:0,geonames:[]},
};
for(const [key,payload] of Object.entries(authenticatedPayloads)) {
 test(`${key} retains provider-specific verification while rejecting generic success and local-looking auth errors`,async()=>{
  let captured;
  const verify=createCredentialVerifier({fetch:async(...request)=>{captured=request;return {...response(200,payload),headers:{get:name=>key==='URLSCAN_API_KEY' && name==='x-rate-limit-scope'?'user':null}};}});
  const actual=await verify(key,'synthetic-canary',{OPENSKY_CLIENT_ID:'synthetic-id',OPENSKY_CLIENT_SECRET:'synthetic-secret',url:'http://169.254.169.254/'});
  assert.deepEqual(actual,{outcome:'verified',reason:'provider-accepted'});
  assert.equal(new URL(captured[0]).protocol,'https:');
  assert.notEqual(new URL(captured[0]).hostname,'169.254.169.254');
  for(const [status,body] of [[200,{}],[401,{error:'Unauthorized'}],[403,{error:'Forbidden'}],[429,payload],[503,payload]]) {
   const inconclusive=createCredentialVerifier({fetch:async()=>response(status,body)});
   assert.equal(await propertyOf(inconclusive(key,'synthetic-canary',{OPENSKY_CLIENT_ID:'synthetic-id',OPENSKY_CLIENT_SECRET:'synthetic-secret'}), 'outcome'),'unavailable');
  }
 });
}
test('NASA FIRMS requires the known CSV header rather than generic HTTP success',async()=>{
 for(const [body,outcome] of [['latitude,longitude,bright_ti4\n1,2,3','verified'],['upstream canary error','unavailable']]) {
 const verify=createCredentialVerifier({fetch:async()=>({status:200,ok:true,text:async()=>body})});
 assert.equal(await propertyOf(verify('NASA_FIRMS_API_KEY','synthetic'), 'outcome'),outcome);
 }
});

test('URLScan anonymous quota payload never verifies an API key',async()=>{
 for(const scope of [null,'ip-address']) {
 const verify=createCredentialVerifier({fetch:async()=>({...response(200,{limits:{}}),headers:{get:()=>scope}})});
 assert.deepEqual(await verify('URLSCAN_API_KEY','synthetic'),{outcome:'unavailable',reason:'inconclusive-response'});
 }
});

test('Groq and Anthropic 403 remain inconclusive even with explicit authentication codes',async()=>{
 for(const [key,payload] of [['GROQ_API_KEY',{error:{code:'invalid_api_key'}}],['ANTHROPIC_API_KEY',{type:'error',error:{type:'authentication_error'}}]]) {
 const verify=createCredentialVerifier({fetch:async()=>response(403,payload)});
 assert.deepEqual(await verify(key,'synthetic'),{outcome:'unavailable',reason:'inconclusive-response'});
 }
});

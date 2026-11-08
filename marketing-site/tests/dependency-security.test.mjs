import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const root=fileURLToPath(new URL('../', import.meta.url));
const require=createRequire(root+'package.json');
const uri=require('fast-uri');
test('fast-uri four advisory boundaries',()=>{
 assert.equal(uri.parse('%6aavascript:alert(1)').error,'URI scheme is malformed.');
 assert.throws(()=>uri.resolve('https://example.com/', '%6aavascript:alert(1)'),/malformed/);
 assert.equal(uri.equal('../x','x'),false);
 assert.equal(uri.normalize('a/..//x'),'.//x');
 assert.equal(uri.parse('http://a@b@evil.example/').error,'URI host is malformed.');
 assert.equal(uri.parse(uri.serialize({path:'javascript:alert(1)'},{skipEscape:true})).scheme,undefined);
});
for(const path of ['schema-utils/node_modules/ajv','ajv-formats/node_modules/ajv'])test(path+' real refs and failure',()=>{
 const Ajv=require(path);const ajv=new Ajv();ajv.addSchema({$id:'https://example.test/defs/value.json',type:'integer',minimum:2});
 const validate=ajv.compile({$id:'https://example.test/app/root.json',type:'object',properties:{value:{$ref:'../defs/value.json'}},required:['value']});
 assert.equal(validate({value:3}),true);assert.equal(validate({value:1}),false);assert.equal(validate({}),false);
 assert.throws(()=>ajv.compile({$id:'https://example.test/missing.json',$ref:'absent.json'}),/resolve reference/);
});
test('scoped fflate resolution, roundtrip, truncated input and output buffer',()=>{
 const sr=createRequire(require.resolve('satori'));assert.equal(sr.resolve('fflate'),require.resolve('fflate'));const f=sr('fflate');
 const input=new TextEncoder().encode('Unicode α 🛰 '.repeat(100));const compressed=f.deflateSync(input);assert.deepEqual(f.inflateSync(compressed),input);
 const out=new Uint8Array(input.length);assert.deepEqual(f.inflateSync(compressed,out),input);assert.throws(()=>f.inflateSync(compressed.subarray(0,2)));
});
test('real Satori font/Unicode SVG and escaping',async()=>{
 const {default:satori}=await import(root+'node_modules/satori/dist/index.js');const data=await readFile(root+'node_modules/@vercel/og/dist/Geist-Regular.ttf');
 const svg=await satori({type:'div',props:{style:{display:'flex',fontFamily:'Geist'},children:'Hello café <script>alert(1)</script>'}},{width:600,height:100,fonts:[{name:'Geist',data,weight:400,style:'normal'}]});
 assert.match(svg,/<svg/);assert.match(svg,/<path/);assert.doesNotMatch(svg,/<script/);
});

test('fixed fflate rejects malformed ZIP64 within bounded child budget',()=>{
 const source=`const f=require(process.argv[1]); const b=Buffer.alloc(160);
 b.writeUInt32LE(0x6064b50,0);b.writeUInt32LE(1,32);b.writeUInt32LE(64,48);
 b.writeUInt32LE(0x2014b50,64);b.writeUInt32LE(0xffffffff,84);
 b.writeUInt32LE(0x6054b50,138);b.writeUInt16LE(65535,146);b.writeUInt32LE(0xffffffff,154);
 try{f.unzipSync(b);process.exitCode=1}catch(e){if(e.code!==13)throw e;console.log('rejected')}`;
 assert.equal(execFileSync(process.execPath,['-e',source,require.resolve('fflate')],{timeout:2000,encoding:'utf8'}).trim(),'rejected');
});

test('Satori escapes SVG attributes and rejects caller-controlled internal fields',async()=>{
 const {default:satori}=await import(root+'node_modules/satori/dist/index.js');
 const data=await readFile(root+'node_modules/@vercel/og/dist/Geist-Regular.ttf');
 const options={width:100,height:100,fonts:[{name:'Geist',data}],embedFont:false};
 const payload='red"/><path data-pwned="true"/><text fill="red';
 const svg=await satori({type:'div',props:{style:{color:payload},children:'safe'}},options);
 assert.doesNotMatch(svg,/<path data-pwned="true"/);
 assert.ok(svg.includes('fill="red&quot;/&gt;&lt;path data-pwned=&quot;true&quot;/&gt;&lt;text fill=&quot;red"'));
 await assert.rejects(satori({type:'div',props:{style:{_inheritedClipPathId:'x)"/><rect width="100"/><g data-x="'}}},options),/Invalid style property/);
});

test('real Satori preserves TTF output when compressed WOFF tables are used',async()=>{
 const {toWoff}=await import('./helpers/woff.mjs');
 const {default:satori}=await import(root+'node_modules/satori/dist/index.js');
 const ttf=await readFile(root+'node_modules/@vercel/og/dist/Geist-Regular.ttf');
 const {output:woff,compressedTables}=toWoff(ttf);
 assert.ok(compressedTables>0);
 const element={type:'div',props:{children:'Hello café'}};
 const render=(data)=>satori(element,{width:240,height:100,fonts:[{name:'Geist',data}]});
 assert.equal(await render(woff),await render(ttf));
});

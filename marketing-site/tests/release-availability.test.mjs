import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolveAvailability } from '../lib/release-availability.mjs';

const catalog = JSON.parse(await readFile(new URL('../../config/release-features.json', import.meta.url), 'utf8'));
const sha = 'a'.repeat(40);
const counts = { panels: { full: 408, tech: 35, finance: 31, happy: 10 }, mcp: { total: 61, read: 53, analyst: 8, categories: 9 } };
const release = { available: true, tag: 'v2.25.148', version: '2.25.148', publishedAt: '2026-10-19T00:00:00Z' };
const manifest = () => ({ tag: release.tag, version: release.version, variant: 'full', commitSha: sha, assets: [], capabilities: {
 schemaVersion: 1, sourceCommit: sha, sourceCatalogs: { panels: counts.panels },
 components: { desktop: { version: release.version, variant: 'full', bundled: true, features: catalog.features.filter(f => f.component === 'desktop') }, companion: { version: '0.3.0', bundled: false, requiresSeparateInstallation: true, sourceCommit: sha, toolCounts: {total:61,read:53,analystAdditional:8}, features: catalog.features.filter(f=>f.component==='companion') } }
} });
const resolve = (metadata = manifest(), latest = release) => resolveAvailability({ release: latest, manifest: metadata, catalog, counts });

test('verified published capabilities enable explicit consent and matching catalog only', () => {
 const result = resolve();
 assert.equal(result.verified, true);
 assert.equal(result.features['explicit-analytics-consent'].available, true);
 assert.equal(result.catalogMatches, true);
 assert.deepEqual(result.features['home-shell-source-readiness'].variants, ['full']);
 assert.equal(result.features['mcp-profiles'].component, 'companion');
 assert.equal(result.features['mcp-profiles'].separateInstallation, true);
 assert.equal(result.features['cli-doctor'].separateInstallation, true);
});
test('legacy147, unpublished148, missing manifest, failed fetch and unknown future retain uncertainty', () => {
 for (const [latest,metadata] of [[{...release,tag:'v2.25.147',version:'2.25.147'},null],[{...release,available:false},manifest()],[{...release,publishedAt:undefined},manifest()],[release,null],[{available:false},null],[{...release,tag:'v9.0.0',version:'9.0.0'},null]]) {
  const result=resolve(metadata,latest);
  assert.equal(result.verified,false);
  assert.equal(result.features['explicit-analytics-consent'].available,false);
  assert.equal(result.catalogMatches,false);
 }
});
test('mismatched identity schema components feature claims and counts fail closed', () => {
 const mutations = [m=>{m.tag='v2.25.147';},m=>{m.version='2.25.147';},m=>{m.commitSha='bad';},m=>{m.capabilities.sourceCommit='b'.repeat(40);},m=>{m.capabilities.schemaVersion=2;},m=>{m.capabilities.components.desktop.version='2.25.147';},m=>{m.capabilities.components.desktop.bundled=false;},m=>{m.capabilities.components.companion.bundled=true;},m=>{m.capabilities.components.companion.sourceCommit='b'.repeat(40);},m=>{m.capabilities.components.desktop.features[0].component='companion';},m=>{m.capabilities.components.desktop.features.push({id:'unknown-feature'});}];
 for(const mutate of mutations){const m=structuredClone(manifest());mutate(m);const result=resolve(m);assert.equal(result.verified,false);assert.equal(result.features['explicit-analytics-consent'].available,false);}
 const mismatched=structuredClone(manifest());mismatched.capabilities.sourceCatalogs.panels.full++;
 assert.equal(resolve(mismatched).catalogMatches,false);
});
test('Home Shell is Full-only and capabilities cannot claim it for Tech', () => {
 const m=structuredClone(manifest());m.variant='tech';m.capabilities.components.desktop.variant='tech';
 assert.equal(resolve(m).verified,false);
 m.capabilities.components.desktop.features=m.capabilities.components.desktop.features.filter(f=>!f.variants||f.variants.includes('tech'));
 const result=resolve(m);assert.equal(result.verified,true);assert.equal(result.features['home-shell-source-readiness'].available,false);
});
test('render source qualifies companion installation and preserves capture provenance', async () => {
 const source=await readFile(new URL('../lib/render.ts',import.meta.url),'utf8');
 assert.match(source,/separately installed companion/i);
 assert.doesNotMatch(source,/const upcomingTiles|const upcoming =/);
 assert.match(source,/Map layers include weather, internet outages, cyber threats, military activity, waterways, and economic signals\./);
 const base=JSON.parse(await readFile(new URL('../data/site.json',import.meta.url),'utf8'));
 assert.equal(base.images.capturedAt,'2026-10-18');
 assert.equal(base.sourceSha,'78e34040d738c82195162b28280e8ce865c3bb6d');
});
test('incomplete capability subsets retain all warnings and future valid proof is accepted', () => {
 const partial=structuredClone(manifest());partial.capabilities.components.desktop.features=partial.capabilities.components.desktop.features.filter(f=>f.id!=='command-palette');
 assert.equal(resolve(partial).features['explicit-analytics-consent'].available,false);
 assert.equal(resolve(partial).catalogMatches,false);
 const future=structuredClone(manifest());future.tag='v2.25.149';future.version='2.25.149';future.capabilities.components.desktop.version=future.version;
 assert.equal(resolve(future,{...release,tag:future.tag,version:future.version}).features['explicit-analytics-consent'].available,true);
});
test('rendered warning and catalog note depend on verified capabilities, never version alone', async () => {
 const ts=(await import('typescript')).default;
 const base=JSON.parse(await readFile(new URL('../data/generated.json',import.meta.url),'utf8'));
 const template=await readFile(new URL('../lib/render.ts',import.meta.url),'utf8');
 const renderFixture=async(availability,latest)=>{
  const fixture={...base,availability,release:{...base.release,...latest}};
  const source=template.replace("import data from '../data/generated.json';",`const data = ${JSON.stringify(fixture)};`).replace("import css from '../styles/site.css?raw';","const css='';").replace("import reveal from '../scripts/reveal.js?raw';","const reveal='';");
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).render;
 };
 const verified=await renderFixture(resolve(),release);
 assert.doesNotMatch(verified('/privacy'),/upgrades automatically enabled/);
 assert.match(verified('/privacy'),/Analytics stay off until you explicitly opt in/);
 assert.doesNotMatch(verified('/'),/Audited release catalog/);
 assert.match(verified('/'),/Full edition only|full edition only/);
 assert.match(verified('/security'),/separately installed companion from the release source.*not bundled in the DMG/);
 const changedCounts=structuredClone(manifest());changedCounts.capabilities.components.companion.toolCounts={total:62,read:54,analystAdditional:8};
 const changed=await renderFixture(resolve(changedCounts),release);
 const mcp=changed('/').match(/<section[^>]*id="mcp"[\s\S]*?<\/section>/)[0];
 assert.match(mcp,/source checkout[^<]*53 read-only/i);
 assert.match(mcp,/source checkout[^<]*8 tools/i);
 const specs=changed('/').match(/<section[^>]*id="specs"[\s\S]*?<\/section>/)[0];
 assert.match(specs,/Source checkout: 53 read-only tools/);
 assert.match(changed('/'),/Audited release catalog/);
 assert.match(verified('/'),/captured 2026-10-18/);
 for(const latest of [{...release,version:'2.25.147',tag:'v2.25.147'},release,{...release,version:'9.0.0',tag:'v9.0.0'}]) {
  const unverified=await renderFixture(resolve(null,latest),latest);
  assert.match(unverified('/privacy'),/upgrades automatically enabled/);
  assert.doesNotMatch(unverified('/security'),/companion from the release source defaults/);
  assert.match(unverified('/security'),/companion from the current source checkout defaults/);
  assert.doesNotMatch(unverified('/'),/companion from the release source/);
  assert.match(unverified('/privacy'),/prepared fix/);
  assert.match(unverified('/privacy'),/pull\/1819/);
  assert.doesNotMatch(unverified('/privacy'),/The current source requires explicit consent/);
  assert.match(unverified('/'),/Audited release catalog/);
  assert.match(unverified('/'),/release availability unverified/);
 }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { resolveAvailability } from '../lib/release-availability.mjs';

const catalog = JSON.parse(await readFile(new URL('../../config/release-features.json', import.meta.url), 'utf8'));
const data = JSON.parse(await readFile(new URL('../data/generated.json', import.meta.url), 'utf8'));
const template = await readFile(new URL('../lib/render.ts', import.meta.url), 'utf8');
const sha = 'a'.repeat(40);
const next = { ...data.release, available: true, tag: 'v2.25.148', version: '2.25.148', publishedAt: '2026-10-19T00:00:00Z' };
const manifest = (release = next) => ({ tag: release.tag, version: release.version, variant: 'full', commitSha: sha, capabilities: {
 schemaVersion: 1, sourceCommit: sha, sourceCatalogs: { panels: data.counts.panels },
 components: { desktop: { version: release.version, variant: 'full', bundled: true, features: catalog.features.filter(f => f.component === 'desktop' && (release.version !== '2.25.147' || f.minimumVersion === '2.25.147')) }, companion: { version: '0.3.0', bundled: false, requiresSeparateInstallation: true, sourceCommit: sha, toolCounts: { total: data.counts.mcp.total, read: data.counts.mcp.read, analystAdditional: data.counts.mcp.analyst }, features: catalog.features.filter(f => f.component === 'companion') } }
} });
const resolve = (release, metadata) => resolveAvailability({ release, manifest: metadata, catalog, counts: data.counts });
async function renderFixture(release, metadata) {
 const fixture = { ...data, release, availability: resolve(release, metadata) };
 const source = template.replace("import data from '../data/generated.json';", `const data = ${JSON.stringify(fixture)};`).replace("import css from '../styles/site.css?raw';", "const css='';").replace("import reveal from '../scripts/reveal.js?raw';", "const reveal='';");
 const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
 return (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).render;
}
const visible = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const labelIds = ['cli-doctor', 'explicit-analytics-consent', 'mcp-profiles'];

test('marketing label map contains only the three planned features', () => {
 assert.deepEqual(Object.keys(catalog.marketingLabels).sort(), labelIds);
 for (const [id, entry] of Object.entries(catalog.marketingLabels)) {
  assert.ok(catalog.features.some(feature => feature.id === id));
  assert.match(entry.minimumReleaseVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(entry.label, 'Next update');
 }
});
test('only published matching capability proof and minimum release remove update labels', () => {
 const legacy={...next,tag:'v2.25.147',version:'2.25.147'};
 const invalid=manifest();invalid.capabilities.schemaVersion=2;
 for(const [release,metadata] of [[legacy,null],[legacy,manifest(legacy)],[next,null],[{...next,available:false},manifest()],[next,invalid],[{...next,version:'3.0.0',tag:'v3.0.0'},null]]) {
  const result=resolve(release,metadata);
  for(const id of labelIds) assert.equal(result.labels[id],'Next update',id);
 }
 for(const release of [next,{...next,version:'2.25.149',tag:'v2.25.149'}]) {
  const result=resolve(release,manifest(release));
  for(const id of labelIds) assert.equal(result.labels[id],null,id);
 }
});
test('legacy page keeps exact public copy and limits timing labels to three feature IDs', async () => {
 const render=await renderFixture({...next,tag:'v2.25.147',version:'2.25.147'},null);
 const html=render('/');
 const chips=[...html.matchAll(/class="release-label" data-feature="([^"]+)"[^>]*>([^<]+)</g)];
 assert.deepEqual([...new Set(chips.map(m=>m[1]))].sort(),labelIds);
 assert.ok(chips.every(m=>m[2]==='Next update'));
 assert.match(html,/class="edition-label">Full edition</);
 assert.match(html,/<h3>Start read-only\.<\/h3><span class="release-label" data-feature="mcp-profiles">Next update<\/span>/);
 assert.match(html,/See personal context, what changed, and critical worldwide items in one view\./);
 assert.match(html,/Review provider health, disagreement, and single-source coverage in Source Confidence\./);
 assert.match(html,/Run <code>crystalball doctor<\/code> to check your setup\./);
 assert.match(html,/Installs separately from the app\./);
 assert.match(visible(html),new RegExp(`${data.counts.mcp.total} tools for your AI assistant`));
 assert.match(visible(html),new RegExp(`v${data.releaseAudit.version.replaceAll('.','\\.')} includes ${data.releaseAudit.mcpTools}\\. Read-only and analyst profiles arrive in the next update\\.`));
 assert.match(html,/panels, places, and guide commands/);
 assert.doesNotMatch(html,/Disaster Lifelines/);
 const caveat='Upgraded from v2.25.147? Check Privacy settings — analytics may have been turned on. The next update turns it off automatically.';
 for(const route of ['/','/privacy']) {
  assert.ok(visible(render(route)).includes('Analytics stay off until you opt in.'));
  assert.ok(visible(render(route)).includes(caveat));
 }
 for(const route of ['/','/docs','/download','/privacy','/security']) assert.doesNotMatch(visible(render(route)),/source build|source-build|source checkout|companion|audited|unverified|DMG|prepared fix/i,route);
});
test('verified release removes update chips and upgrade caveat without altering screenshot provenance',async()=>{
 const render=await renderFixture(next,manifest());
 for(const route of ['/','/privacy','/security']) {
  assert.doesNotMatch(render(route),/Next update|next update|Upgraded from v2\.25\.147/);
 }
 assert.match(render('/'),/class="edition-label">Full edition</);
 assert.match(render('/'),/captured 2026-10-18/);
 const future={...next,tag:'v2.25.149',version:'2.25.149'};
 const metadata=manifest(future);metadata.capabilities.components.companion.toolCounts={total:62,read:54,analystAdditional:8};
 const changed=await renderFixture(future,metadata);
 assert.match(visible(changed('/')),/v2\.25\.149 includes 62\./);
 assert.match(visible(changed('/')),/54 read-only tools/);
 assert.doesNotMatch(visible(changed('/')),/v2\.25\.147 includes 53/);
});

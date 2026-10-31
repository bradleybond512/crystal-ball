import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const loader = await readFile(new URL('../src/app/data-loader.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.ts', import.meta.url), 'utf8');
const events = await readFile(new URL('../src/app/event-handlers.ts', import.meta.url), 'utf8');
const panels = await readFile(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');

test('existing loader captures generation before asynchronous acquisition and publishes unmerged source results', () => {
 const start = loader.indexOf('  async loadNews(): Promise<void> {');
 const body = loader.slice(start, loader.indexOf('  async loadMarkets()', start));
 assert.ok(body.indexOf('const newsGeneration = this.ctx.newsSnapshot.getSnapshot().generation') < body.indexOf('const digestPromise = this.tryFetchDigest()'));
 assert.match(body, /this\.loadNewsCategory\(key, feeds, digestResult, newsGeneration\)/);
 assert.match(body, /publishNewsFeeds\(newsGeneration, enabledIntelSources, intel, digestResult\.digest\.feedAcquisitions\)/);
 assert.match(body, /newsSnapshot\.publish\(newsGeneration, 'newsapi', newsApiResult\.items, newsApiResult\.acquisition\)/);
 assert.match(body, /newsSnapshot\.publish\(newsGeneration, 'newsdata', newsDataResult\.items, newsDataResult\.acquisition\)/);
 assert.doesNotMatch(body, /newsSnapshot\.publish\([^\n]*allNews/);
 assert.match(loader, /publishNewsFeeds\(generation, enabledFeeds, items, digest\.digest\.feedAcquisitions\)/);
 assert.match(loader, /publishNewsFeeds\(generation, enabledFeeds, items, rssResult\.feedAcquisitions\)/);
});

test('one app-owned snapshot reaches existing panels and is invalidated before module teardown', () => {
 assert.equal((app.match(/new NewsSnapshot\(/g) ?? []).length, 1);
 assert.ok(app.indexOf('this.state.newsSnapshot.destroy()') < app.indexOf('// Destroy all modules in reverse order'));
 assert.match(panels, /new MediastackNewsPanel\(this\.ctx\.newsSnapshot\)/);
 assert.match(panels, /new m\.SystemDiagnosticPanel\(this\.ctx\.newsSnapshot\)/);
});

test('both source setting mutations synchronously notify scope invalidation', () => {
 const start = events.indexOf(' getDisabledSources: () => this.ctx.disabledSources,');
 const body = events.slice(start, events.indexOf(' getAllSourceNames:', start));
 assert.equal((body.match(/this\.ctx\.newsSnapshot\.getSnapshot\(\)/g) ?? []).length, 2);
 assert.equal((body.match(/newsSnapshot\.getSnapshot\(\);\n saveToStorage/g) ?? []).length, 2);
});


test('supplemental scope follows runtime feature toggles through the existing config notification boundary', () => {
 const start = loader.indexOf('  private newsSnapshotConfiguration()');
 const scope = loader.slice(start, loader.indexOf('  private publishNewsFeeds(', start));
 assert.match(scope, /provider: 'newsapi', enabled: isFeatureEnabled\('newsApiHeadlines'\)/);
 assert.match(scope, /provider: 'newsdata', enabled: isFeatureEnabled\('newsDataFeed'\)/);
 assert.match(scope, /configSignature: JSON\.stringify\(configs\)/);
 assert.match(loader, /subscribeRuntimeConfig\(\(\) => \{ this\.ctx\.newsSnapshot\.getSnapshot\(\); \}\)/);
 assert.match(loader, /this\.unsubscribeNewsRuntimeConfig\?\.\(\)/);
});

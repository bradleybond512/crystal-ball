import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePanels, deriveMcp, deriveSpecs, generateSiteData, resolveRelease } from '../scripts/generate-site-data.mjs';

const github = 'https://github.com/bradleybond512/crystal-ball';
const panelsSource = `const FULL_PANELS = { a: {name:'A'}, 'b': {name:'B'} };\nconst TECH_PANELS = { c: {name:'C'} };\nexport const DEFAULT_PANELS = active ? TECH_PANELS : FULL_PANELS;`;
const toolCatalog = { query: { category: 'Read', annotations: {readOnlyHint: true} }, change: { category: 'Write', annotations: {readOnlyHint: false} } };
const workflowSource = `node_target: 'aarch64-apple-darwin'\nnode_target: 'x86_64-apple-darwin'\nnode_target: 'x86_64-pc-windows-msvc'`;
const base = { urls: { github }, release: { version: 'old', appleSilicon: 'stale.dmg' }, counts: { panels: { full: -1 } } };
const input = { base, panelsSource, toolCatalog, tauriConfig: { bundle: { macOS: {} } }, workflowSource };
const asset = { name: 'Crystal.Ball_3.0_arm64.dmg', size: 12345, browser_download_url: `${github}/releases/download/v3.0/Crystal.Ball_3.0_arm64.dmg` };
const manifestAsset = { name: 'release-manifest.json', size: 200, browser_download_url: `${github}/releases/download/v3.0/release-manifest.json` };
const latest = { tag_name: 'v3.0', published_at: '2026-10-18T00:00:00Z', assets: [asset, manifestAsset] };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('catalog parsing counts adjacent properties and rejects duplicates or spread', () => {
  assert.deepEqual(derivePanels(panelsSource), { full: 2, tech: 1 });
  assert.throws(() => derivePanels(`const FULL_PANELS = { a: {}, a: {} };`), /unique/);
  assert.throws(() => derivePanels(`const FULL_PANELS = { ...other };`), /explicit/);
  assert.deepEqual(deriveMcp(toolCatalog), { total: 2, read: 1, analyst: 1, categories: 2 });
});

test('specs use explicit minimums and build targets, not runner OS versions', () => {
  const specs = deriveSpecs({ bundle: { macOS: { minimumSystemVersion: '14.0' } } }, workflowSource + "\nplatform: 'ubuntu-24.04'");
  assert.equal(specs.platforms[0].minimumOS, '14.0');
  assert.deepEqual(specs.platforms[0].architectures, ['aarch64', 'x86_64']);
  assert.equal(specs.platforms[1].minimumOS, null);
  assert.equal(specs.platforms.some((platform) => platform.id === 'Linux'), false);
});

test('latest release assets and checksums come from API and matching manifest', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return json(url.endsWith('/latest') ? latest : { tag: latest.tag_name, assets: [{ name: asset.name.replace('Crystal.Ball', 'Crystal Ball'), size: asset.size, sha256: 'a'.repeat(64) }] });
  };
  const data = await generateSiteData({ ...input, fetchImpl });
  assert.equal(data.release.available, true);
  assert.equal(data.release.version, '3.0');
  assert.equal(data.release.assets.appleSilicon.url, asset.browser_download_url);
  assert.equal(data.release.assets.appleSilicon.sizeBytes, asset.size);
  assert.equal(data.release.assets.appleSilicon.sha256, 'a'.repeat(64));
  assert.equal(data.release.signingStatus, 'unverified');
  assert.equal(data.counts.editions, Object.keys(data.counts.panels).length);
  assert.equal(data.counts.platforms, data.specs.platforms.length);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => !url.endsWith('.dmg')), 'no binary downloads');
});

test('API errors and timeout discard stale version-specific assets', async () => {
  for (const fetchImpl of [async () => json({}, 503), async () => { throw new DOMException('Timed out', 'TimeoutError'); }]) {
    const data = await generateSiteData({ ...input, fetchImpl });
    assert.equal(data.release.available, false);
    assert.equal(data.release.latestUrl, `${github}/releases/latest`);
    assert.deepEqual(data.release.assets, {});
    assert.equal(data.release.version, undefined);
    assert.equal(data.release.appleSilicon, undefined);
    assert.equal(data.release.manifestUrl, null);
    assert.ok(data.release.error);
    assert.equal(JSON.stringify(data).includes('stale.dmg'), false);
  }
});

test('manifest fetch failure or wrong version fails closed without stale downloads', async () => {
  for (const manifestResponse of [() => json({}, 404), () => json({ tag: 'v2.0', assets: [] })]) {
    const release = await resolveRelease({ github, fetchImpl: async (url) => url.endsWith('/latest') ? json(latest) : manifestResponse() });
    assert.equal(release.available, false);
    assert.deepEqual(release.assets, {});
    assert.equal(release.version, undefined);
  }
});

test('missing manifest and absent architectures are disclosed rather than invented', async () => {
  const release = await resolveRelease({ github, fetchImpl: async () => json({ ...latest, assets: [asset] }) });
  assert.equal(release.available, true);
  assert.equal(release.manifestAvailable, false);
  assert.equal(release.manifestUrl, null);
  assert.equal(release.assets.appleSilicon.sha256, null);
  assert.equal(release.assets.intel, undefined);
});


test('malformed asset URLs cannot become download links', async () => {
  const malicious = { ...asset, browser_download_url: asset.browser_download_url + '\" onclick=\"alert(1)' };
  const release = await resolveRelease({ github, fetchImpl: async () => json({ ...latest, assets: [malicious] }) });
  assert.equal(release.assets.appleSilicon, undefined);
  assert.deepEqual(release.assets, {});
});

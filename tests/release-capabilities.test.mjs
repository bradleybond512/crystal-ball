import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectReleaseArtifacts } from '../scripts/release-manifest.mjs';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const version = '2.25.148';
const commitSha = 'a'.repeat(40);
const features = [
  { id: 'command-palette', component: 'desktop', minimumVersion: '2.25.147', sourcePaths: ['src/config/panels.ts'] },
  { id: 'cli-doctor', component: 'companion', minimumVersion: null, sourcePaths: ['tools/mcp-server/tool-registry.mjs'] },
];

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'release-capabilities-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  for (const dir of ['src/config', 'tools/mcp-server', 'config', 'target']) await mkdir(path.join(repoRoot, dir), { recursive: true });
  await writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({ version }));
  await writeFile(path.join(repoRoot, 'tools/mcp-server/package.json'), JSON.stringify({ version: '0.3.0', private: true }));
  await writeFile(path.join(repoRoot, 'config/release-features.json'), JSON.stringify({ schemaVersion: 1, features }));
  await writeFile(path.join(repoRoot, 'src/config/panels.ts'), `const FULL_PANELS: Record<string, PanelConfig> = {a: {}, b: {}};
const TECH_PANELS = {c: {}}; const FINANCE_PANELS = {d: {}}; const HAPPY_PANELS = {e: {}};`);
  for (const file of ['tool-registry.mjs', 'tool-catalog.mjs']) {
    await writeFile(path.join(repoRoot, 'tools/mcp-server', file), await readFile(path.join(sourceRoot, 'tools/mcp-server', file)));
  }
  await writeFile(path.join(repoRoot, 'target', `Crystal Ball_${version}_aarch64.dmg`), 'fixture installer');
  return { repoRoot, version, commitSha, variant: 'full', tag: `v${version}`, platform: 'macos', generatedAt: '2026-10-19T00:00:00.000Z', targetRoot: path.join(repoRoot, 'target') };
}

// Copy only derivation inputs; never alter the checkout's release version.
async function realCatalogFixture(t, fixtureVersion) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'release-real-catalog-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const catalog = JSON.parse(await readFile(path.join(sourceRoot, 'config/release-features.json'), 'utf8'));
  const inputs = new Set(['config/release-features.json', 'src/config/panels.ts',
    'tools/mcp-server/package.json', 'tools/mcp-server/tool-catalog.mjs',
    ...catalog.features.flatMap((feature) => feature.sourcePaths)]);
  for (const file of inputs) {
    const destination = path.join(repoRoot, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(path.join(sourceRoot, file)));
  }
  await writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({ version: fixtureVersion }));
  return { repoRoot, version: fixtureVersion, commitSha };
}

function assert147Boundary(result) {
  assert.deepEqual(result.components.desktop.features.map((feature) => feature.id), ['command-palette'],
    '147 cannot claim explicit consent, Home readiness/evidence, or Disaster Lifelines');
  assert.equal(result.components.desktop.features[0].minimumVersion, '2.25.147');
  assert.deepEqual(result.sourceCatalogs.panels, { full: 409, tech: 35, finance: 31, happy: 10 });
  assert.equal(result.components.companion.bundled, false);
  assert.equal(result.components.companion.requiresSeparateInstallation, true);
  assert.equal(result.components.companion.sourceCommit, commitSha);
  assert.deepEqual(result.components.companion.toolCounts, { total: 61, read: 53, analystAdditional: 8 });
  assert.deepEqual(result.components.companion.features.map((feature) => feature.id).sort(), ['cli-doctor', 'mcp-profiles']);
}

async function derive(options) {
  const { deriveReleaseCapabilities } = await import('../scripts/release-capabilities.mjs');
  return deriveReleaseCapabilities(options);
}

test('capabilities derive adjacent panel properties and MCP annotations from source', async (t) => {
  const options = await fixture(t);
  const first = await derive(options);
  assert.deepEqual(first.sourceCatalogs.panels, { full: 2, tech: 1, finance: 1, happy: 1 });
  const { TOOL_CATALOG } = await import('../tools/mcp-server/tool-registry.mjs');
  const metadata = Object.values(TOOL_CATALOG);
  assert.deepEqual(first.components.companion.toolCounts, {
    total: metadata.length,
    read: metadata.filter((tool) => tool.annotations.readOnlyHint).length,
    analystAdditional: metadata.filter((tool) => !tool.annotations.readOnlyHint).length,
  });
  const registryPath = path.join(options.repoRoot, 'tools/mcp-server/tool-catalog.mjs');
  await writeFile(registryPath, (await readFile(registryPath, 'utf8')).replace('Foundation: {', "Foundation: { fixture_probe: 'A fixture tool',"));
  const panelsPath = path.join(options.repoRoot, 'src/config/panels.ts');
  await writeFile(panelsPath, (await readFile(panelsPath, 'utf8')).replace('a: {},', 'extra: {}, a: {},'));
  const changed = await derive(options);
  assert.equal(changed.sourceCatalogs.panels.full, 3);
  assert.equal(changed.components.companion.toolCounts.total, metadata.length + 1);
  assert.equal(changed.components.companion.toolCounts.read, first.components.companion.toolCounts.read + 1);
  assert.equal(changed.components.companion.toolCounts.analystAdditional, first.components.companion.toolCounts.analystAdditional);
});

test('capabilities qualify the unchanged companion version by revision and separate installation', async (t) => {
  const result = await derive(await fixture(t));
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.sourceCommit, commitSha);
  assert.equal(result.components.desktop.version, version);
  assert.equal(result.components.desktop.bundled, true);
  assert.equal(result.components.desktop.variant, 'full');
  assert.deepEqual(result.components.desktop.features, [features[0]]);
  assert.equal(result.components.companion.version, '0.3.0');
  assert.equal(result.components.companion.bundled, false);
  assert.equal(result.components.companion.requiresSeparateInstallation, true);
  assert.equal(result.components.companion.sourceCommit, commitSha);
  assert.deepEqual(result.components.companion.features, [features[1]]);
});

test('collection includes serializable capabilities', async (t) => {
  const options = await fixture(t);
  const collected = await collectReleaseArtifacts(options);
  assert.deepEqual(JSON.parse(JSON.stringify(collected)).capabilities, await derive(options));
});

test('collection rejects a package version that does not match the requested artifact version', async (t) => {
  const options = await fixture(t);
  await writeFile(path.join(options.repoRoot, 'package.json'), JSON.stringify({ version: '2.25.147' }));
  await assert.rejects(() => collectReleaseArtifacts(options), /version.*mismatch|match.*version/i);
});


test('future 148 real catalog preserves companion uncertainty and desktop feature provenance', async (t) => {
  const options = await realCatalogFixture(t, '2.25.148');
  const result = await derive({ ...options, variant: 'full' });
  assert.deepEqual(result.sourceCatalogs.panels, { full: 409, tech: 35, finance: 31, happy: 10 });
  assert.deepEqual(result.components.desktop.features.find((feature) => feature.id === 'explicit-analytics-consent'), {
    id: 'explicit-analytics-consent', component: 'desktop', minimumVersion: '2.25.148',
    sourcePaths: ['src/services/analytics.ts', 'src/components/AnalyticsConsentBanner.ts'],
  });
  for (const feature of result.components.desktop.features) {
    assert.match(feature.minimumVersion, /^\d+\.\d+\.\d+$/);
    assert.ok(feature.sourcePaths.length > 0);
  }
  assert.deepEqual(result.components.companion.features.map((feature) => feature.id).sort(), ['cli-doctor', 'mcp-profiles']);
  for (const feature of result.components.companion.features) {
    assert.equal(feature.minimumVersion, null);
    for (const sourcePath of feature.sourcePaths) await readFile(path.join(sourceRoot, sourcePath));
  }
});


test('future 148 Home Shell capabilities are limited to Full while common desktop features remain available', async (t) => {
  const options = await realCatalogFixture(t, '2.25.148');
  const homeFeatures = ['home-shell-source-readiness', 'home-shell-evidence-notes'];
  for (const variant of ['tech', 'finance', 'full']) {
    const result = await derive({ ...options, variant });
    for (const id of homeFeatures) {
      const feature = result.components.desktop.features.find((item) => item.id === id);
      assert.equal(Boolean(feature), variant === 'full', `${id} availability in ${variant}`);
      if (feature) {
        assert.deepEqual(feature.variants, ['full']);
        assert.equal(feature.minimumVersion, '2.25.148');
        assert.ok(feature.sourcePaths.some((sourcePath) => sourcePath.endsWith('/shell-gate.ts')));
      }
    }
    for (const id of ['command-palette', 'explicit-analytics-consent']) {
      const feature = result.components.desktop.features.find((item) => item.id === id);
      assert.ok(feature, `${id} in ${variant}`);
      assert.equal(feature.minimumVersion, id === 'command-palette' ? '2.25.147' : '2.25.148');
    }
  }
});

test('shared MCP catalog imports without dependencies and matches the runtime registry', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'mcp-catalog-no-deps-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const destination = path.join(temp, 'tool-catalog.mjs');
  await writeFile(destination, await readFile(path.join(sourceRoot, 'tools/mcp-server/tool-catalog.mjs')));
  const standalone = await import(pathToFileURL(destination).href);
  const runtime = await import('../tools/mcp-server/tool-registry.mjs');
  const shared = await import('../tools/mcp-server/tool-catalog.mjs');
  assert.ok(Object.keys(standalone.TOOL_CATALOG).length > 0);
  assert.deepEqual(standalone.TOOL_CATALOG, runtime.TOOL_CATALOG);
  assert.strictEqual(shared.TOOL_CATALOG, runtime.TOOL_CATALOG);
  assert.deepEqual(standalone.TOOL_INDEX, runtime.TOOL_INDEX);
});

test('companion package includes the shared tool catalog required by its registry', async () => {
  const pkg = JSON.parse(await readFile(path.join(sourceRoot, 'tools/mcp-server/package.json'), 'utf8'));
  assert.ok(pkg.files.includes('tool-catalog.mjs'));
});


test('future 148 Disaster Lifelines name is a Full-only release feature introduced after 2.25.147', async (t) => {
  const options = await realCatalogFixture(t, '2.25.148');
  for (const variant of ['full', 'tech', 'finance']) {
    const result = await derive({ ...options, variant });
    const feature = result.components.desktop.features.find((item) => item.id === 'disaster-lifelines-name');
    assert.equal(Boolean(feature), variant === 'full');
    if (feature) {
      assert.equal(feature.minimumVersion, '2.25.148');
      assert.deepEqual(feature.variants, ['full']);
      assert.deepEqual(feature.sourcePaths, ['src/config/panels.ts']);
    }
  }
});


test('actual source-only checkout remains 147 and excludes deferred desktop claims', async () => {
  const pkg = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.25.147', 'source-only delivery must not prepare a new desktop release');
  for (const variant of ['full', 'tech', 'finance']) {
    assert147Boundary(await derive({ repoRoot: sourceRoot, version: pkg.version, commitSha, variant }));
  }
});

test('147 real-source fixtures exclude deferred claims in every release edition', async (t) => {
  const options = await realCatalogFixture(t, '2.25.147');
  for (const variant of ['full', 'tech', 'finance']) assert147Boundary(await derive({ ...options, variant }));
});

test('future 148 artifact request rejects a 147 real-source package', async (t) => {
  const options = await realCatalogFixture(t, '2.25.147');
  await assert.rejects(() => derive({ ...options, version: '2.25.148', variant: 'full' }), /match package version/);
});

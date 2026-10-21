import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_CATALOG } from '../../tools/mcp-server/tool-catalog.mjs';
import featureCatalog from '../../config/release-features.json' with { type: 'json' };
import { resolveAvailability } from '../lib/release-availability.mjs';
import ts from 'typescript';

export function derivePanels(source) {
  const parsed = ts.createSourceFile('panels.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length, 0, 'Panel source must parse');
  const counts = {};
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !/^[A-Z]+_PANELS$/.test(declaration.name.text) || declaration.name.text === 'DEFAULT_PANELS') continue;
      const catalog = declaration.initializer;
      assert.ok(catalog && ts.isObjectLiteralExpression(catalog), 'Panel catalog must be an object literal');
      const names = catalog.properties.map((property) => {
        assert.ok(ts.isPropertyAssignment(property), 'Panel entries must be explicit properties');
        assert.ok(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name), 'Panel names must be static');
        return property.name.text;
      });
      assert.equal(new Set(names).size, names.length, 'Panel names must be unique');
      counts[declaration.name.text.replace('_PANELS', '').toLowerCase()] = names.length;
    }
  }
  assert.ok(Object.keys(counts).length, 'No panel catalogs found');
  return counts;
}

export function deriveMcp(catalog = TOOL_CATALOG) {
  const tools = Object.values(catalog);
  assert.ok(tools.length, 'Registry must contain tools');
  assert.ok(tools.every((tool) => typeof tool.annotations?.readOnlyHint === 'boolean' && typeof tool.category === 'string'));
  const read = tools.filter((tool) => tool.annotations.readOnlyHint).length;
  return { total: tools.length, read, analyst: tools.length - read, categories: new Set(tools.map((tool) => tool.category)).size };
}

export function deriveSpecs(config, workflow) {
  const targets = [...new Set([...workflow.matchAll(/node_target:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))];
  assert.ok(targets.length, 'No desktop build targets found');
  const definitions = [
    { id: 'macOS', suffix: '-apple-darwin', primary: true },
    { id: 'Windows', suffix: '-pc-windows-msvc', primary: false },
    { id: 'Linux', suffix: '-unknown-linux-gnu', primary: false },
  ];
  const minimum = config.bundle?.macOS?.minimumSystemVersion;
  return {
    platforms: definitions.map(({ id, suffix, primary }) => ({
      id, primary, experimental: !primary,
      architectures: targets.filter((target) => target.endsWith(suffix)).map((target) => target.slice(0, -suffix.length)),
      minimumOS: id === 'macOS' && typeof minimum === 'string' ? minimum : null,
    })).filter((platform) => platform.architectures.length),
    minimumOSStatus: 'Only explicitly configured minimums are shown; build-runner OS versions are not supported-system minimums.',
    evidence: ['src-tauri/tauri.conf.json', '.github/workflows/build-desktop.yml'],
  };
}

async function fetchJson(url, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall-Marketing-Build' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching release metadata`);
  if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('Release metadata exceeds limit');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Release metadata exceeds limit');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function resolveRelease({ github, fetchImpl = fetch, timeoutMs = 12000 }) {
  const repository = new URL(github).pathname.replace(/\/$/, '');
  const latestUrl = `${github}/releases/latest`;
  const unavailable = { available: false, latestUrl, assets: {}, manifestUrl: null, manifestAvailable: false, signingStatus: 'unverified' };
  try {
    const release = await fetchJson(`https://api.github.com/repos${repository}/releases/latest`, fetchImpl, timeoutMs);
    assert.ok(typeof release.tag_name === 'string' && typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at)) && Array.isArray(release.assets), 'Invalid release metadata');
    assert.ok(!release.draft && !release.prerelease, 'Latest release must be published and stable');
    const prefix = `${github}/releases/download/`;
    const assets = release.assets.filter((asset) => typeof asset.name === 'string' && typeof asset.browser_download_url === 'string' && asset.browser_download_url.startsWith(prefix) && !/[<>\"'\s]/.test(asset.browser_download_url) && Number.isSafeInteger(asset.size) && asset.size >= 0);
    const manifestAsset = assets.find((asset) => asset.name === 'release-manifest.json');
    let manifest = null;
    if (manifestAsset) {
      manifest = await fetchJson(manifestAsset.browser_download_url, fetchImpl, timeoutMs);
      assert.ok(manifest.tag === release.tag_name && Array.isArray(manifest.assets), 'Manifest does not match latest release');
    }
    const patterns = {
      appleSilicon: /(?:aarch64|arm64)\.dmg$/i,
      intel: /(?:x64|x86_64)\.dmg$/i,
      windows: /(?:x64|x86_64).*\.exe$/i,
      linuxIntel: /(?:amd64|x86_64|x64)\.AppImage$/i,
      linuxArm: /(?:aarch64|arm64)\.AppImage$/i,
    };
    const selected = {};
    for (const [id, pattern] of Object.entries(patterns)) {
      const asset = assets.find((entry) => pattern.test(entry.name));
      if (!asset) continue;
      const checksum = manifest?.assets.find((entry) => typeof entry.name === 'string' && entry.name.replaceAll(' ', '.') === asset.name && entry.size === asset.size && /^[a-f0-9]{64}$/i.test(entry.sha256));
      selected[id] = { name: asset.name, url: asset.browser_download_url, sizeBytes: asset.size, sha256: checksum?.sha256 ?? null };
    }
    return { available: true, latestUrl, version: release.tag_name.replace(/^v/, ''), tag: release.tag_name, publishedAt: release.published_at, assets: selected, manifestUrl: manifestAsset?.browser_download_url ?? null, manifestAvailable: Boolean(manifest), manifest, signingStatus: 'unverified' };
  } catch (error) {
    return { ...unavailable, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function generateSiteData({ base, panelsSource, toolCatalog = TOOL_CATALOG, tauriConfig, workflowSource, fetchImpl = fetch, timeoutMs }) {
  const panels = derivePanels(panelsSource);
  const editions = Object.entries(panels).map(([id, panelCount]) => ({ id, panelCount }));
  const specs = deriveSpecs(tauriConfig, workflowSource);
  const release = await resolveRelease({ github: base.urls.github, fetchImpl, timeoutMs });
  const counts = { panels, mcp: deriveMcp(toolCatalog), editions: editions.length, platforms: specs.platforms.length };
  const availability = resolveAvailability({ release, manifest: release.manifest, catalog: featureCatalog, counts });
  const publicRelease = { ...release };
  delete publicRelease.manifest;
  return { ...base, counts, editions, specs, release: publicRelease, availability };
}

export async function generateFromFiles(siteRoot = fileURLToPath(new URL('../', import.meta.url)), options = {}) {
  const repoRoot = path.resolve(siteRoot, '..');
  const read = (file) => readFile(path.join(repoRoot, file), 'utf8');
  const [base, panelsSource, tauriConfig, workflowSource] = await Promise.all([
    readFile(path.join(siteRoot, 'data/site.json'), 'utf8'), read('src/config/panels.ts'), read('src-tauri/tauri.conf.json'), read('.github/workflows/build-desktop.yml'),
  ]);
  const generated = await generateSiteData({ base: JSON.parse(base), panelsSource, tauriConfig: JSON.parse(tauriConfig), workflowSource, ...options });
  await writeFile(path.join(siteRoot, 'data/generated.json'), JSON.stringify(generated, null, 2) + '\n');
  return generated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const generated = await generateFromFiles();
  console.log(JSON.stringify({ counts: generated.counts, releaseAvailable: generated.release.available, releaseError: generated.release.error ?? null }));
}

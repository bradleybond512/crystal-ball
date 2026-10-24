import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { assertSupportedReleaseVariant } from './release-metadata.mjs';

const PANEL_CATALOGS = ['FULL_PANELS', 'TECH_PANELS', 'FINANCE_PANELS', 'HAPPY_PANELS'];

function panelCount(catalog) {
  assert.ok(catalog && ts.isObjectLiteralExpression(catalog), 'Panel catalog must be an object literal');
  const names = catalog.properties.map((property) => {
    assert.ok(ts.isPropertyAssignment(property), 'Panel entries must be explicit properties');
    assert.ok(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name), 'Panel names must be static');
    return property.name.text;
  });
  assert.equal(new Set(names).size, names.length, 'Panel names must be unique');
  assert.ok(names.length, 'Panel catalog must not be empty');
  return names.length;
}

function derivePanels(source) {
  const parsed = ts.createSourceFile('panels.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length, 0, 'Panel source must parse');
  const counts = {};
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !PANEL_CATALOGS.includes(declaration.name.text)) continue;
      const edition = declaration.name.text.replace('_PANELS', '').toLowerCase();
      assert.ok(!Object.hasOwn(counts, edition), 'Panel catalog must be unique');
      counts[edition] = panelCount(declaration.initializer);
    }
  }
  assert.equal(Object.keys(counts).length, PANEL_CATALOGS.length, 'All source panel catalogs must be present');
  return counts;
}

async function deriveTools(repoRoot) {
  const catalogPath = path.join(repoRoot, 'tools/mcp-server/tool-catalog.mjs');
  const source = await readFile(catalogPath);
  const url = pathToFileURL(catalogPath);
  url.searchParams.set('source', createHash('sha256').update(source).digest('hex'));
  const { TOOL_CATALOG: catalog } = await import(url.href);
  assert.ok(catalog && typeof catalog === 'object' && !Array.isArray(catalog), 'Registry catalog must be an object');
  const tools = Object.values(catalog);
  assert.ok(tools.length, 'Registry must contain tools');
  assert.ok(tools.every((tool) => typeof tool.annotations?.readOnlyHint === 'boolean'), 'Every tool needs a read-only annotation');
  const read = tools.filter((tool) => tool.annotations.readOnlyHint).length;
  return { total: tools.length, read, analystAdditional: tools.length - read };
}

function versionParts(version) {
  assert.match(version, /^\d+\.\d+\.\d+$/, 'Capability versions must be stable semantic versions');
  return version.split('.').map(Number);
}

function meetsMinimum(version, minimum) {
  const actual = versionParts(version);
  const required = versionParts(minimum);
  for (const [index, part] of actual.entries()) {
    if (part !== required[index]) return part > required[index];
  }
  return true;
}

async function validateFeature(feature, repoRoot) {
  assert.match(feature.id, /^[a-z][a-z0-9-]+$/, 'Feature ID must be stable');
  assert.ok(['desktop', 'companion'].includes(feature.component), 'Unknown feature component');
  if (feature.component === 'companion') {
    assert.equal(feature.minimumVersion, null, 'Companion features require source revision, not package version');
  } else {
    versionParts(feature.minimumVersion);
  }
  if (feature.variants !== undefined) {
    assert.ok(Array.isArray(feature.variants) && feature.variants.length, 'Feature variants must not be empty');
    for (const variant of feature.variants) assertSupportedReleaseVariant(variant);
  }
  assert.ok(Array.isArray(feature.sourcePaths) && feature.sourcePaths.length, 'Feature source paths are required');
  for (const sourcePath of feature.sourcePaths) {
    assert.ok(typeof sourcePath === 'string' && !path.isAbsolute(sourcePath)
      && !sourcePath.split(/[\\/]/).includes('..'), 'Feature source paths must stay inside the repository');
    const sourceStat = await stat(path.join(repoRoot, sourcePath));
    assert.ok(sourceStat.isFile(), 'Feature source path must be a file');
  }
}

async function readFeatures(repoRoot) {
  const catalog = JSON.parse(await readFile(path.join(repoRoot, 'config/release-features.json'), 'utf8'));
  assert.equal(catalog.schemaVersion, 1, 'Unsupported feature catalog schema');
  assert.ok(Array.isArray(catalog.features) && catalog.features.length, 'Feature catalog must not be empty');
  assert.equal(new Set(catalog.features.map((feature) => feature.id)).size, catalog.features.length, 'Feature IDs must be unique');
  for (const feature of catalog.features) await validateFeature(feature, repoRoot);
  return catalog.features;
}

export async function deriveReleaseCapabilities({ repoRoot, version, commitSha, variant }) {
  assertSupportedReleaseVariant(variant);
  versionParts(version);
  assert.ok(typeof commitSha === 'string' && commitSha.length, 'Source commit is required');
  const [packageSource, companionSource, panelsSource, toolCounts, features] = await Promise.all([
    readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    readFile(path.join(repoRoot, 'tools/mcp-server/package.json'), 'utf8'),
    readFile(path.join(repoRoot, 'src/config/panels.ts'), 'utf8'),
    deriveTools(repoRoot),
    readFeatures(repoRoot),
  ]);
  assert.equal(JSON.parse(packageSource).version, version, 'Release version must match package version');
  const companionVersion = JSON.parse(companionSource).version;
  versionParts(companionVersion);
  return {
    schemaVersion: 1,
    sourceCommit: commitSha,
    sourceCatalogs: { panels: derivePanels(panelsSource) },
    components: {
      desktop: {
        version, bundled: true, variant,
        features: features.filter((feature) => feature.component === 'desktop'
          && meetsMinimum(version, feature.minimumVersion)
          && (!feature.variants || feature.variants.includes(variant))),
      },
      companion: {
        version: companionVersion,
        bundled: false,
        requiresSeparateInstallation: true,
        sourceCommit: commitSha,
        toolCounts,
        features: features.filter((feature) => feature.component === 'companion'),
      },
    },
  };
}

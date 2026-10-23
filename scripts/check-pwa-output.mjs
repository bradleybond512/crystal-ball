import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createPwaManifestPaths } from '../src/config/pwa-manifest.ts';
import { normalizeDeploymentBase } from '../src/utils/deployment-base.ts';

/**
 * @param {string} tag
 * @param {string} name
 * @returns {string | undefined}
 */
function attribute(tag, name) {
  return tag.match(new RegExp(String.raw`\b${name}=["']([^"']*)["']`, 'i'))?.[1];
}

/**
 * Inspect generated output; this does not establish installed-PWA offline behavior.
 * @param {unknown} manifest
 * @param {string} html
 * @param {string} base
 * @returns {string[]}
 */
export function validatePwaOutput(manifest, html, base) {
  const expected = createPwaManifestPaths(base);
  /** @type {string[]} */
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return ['Manifest must be an object'];
  const actual = /** @type {Record<string, unknown>} */ (manifest);
  if (actual.start_url !== expected.start_url) errors.push('Manifest start_url does not match deployment base');
  if (actual.scope !== expected.scope) errors.push('Manifest scope does not match deployment base');
  if (!isDeepStrictEqual(actual.icons, expected.icons)) errors.push('Manifest icons do not match deployment base');
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const manifestLink = links.find((tag) => attribute(tag, 'rel') === 'manifest');
  if (!manifestLink || attribute(manifestLink, 'href') !== `${expected.scope}manifest.webmanifest`) {
    errors.push('HTML manifest link does not match deployment base');
  }
  const scripts = (html.match(/<script\b[^>]*>/gi) ?? [])
    .filter((tag) => attribute(tag, 'type') === 'module')
    .map((tag) => attribute(tag, 'src'));
  if (scripts.length === 0 || scripts.some((src) => !src?.startsWith(`${expected.scope}assets/`))) {
    errors.push('HTML module entry does not match deployment base');
  }
  const noscript = html.match(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/i)?.[1] ?? '';
  if (!/<h1\b[^>]*>Crystal Ball needs JavaScript<\/h1>/i.test(noscript)
    || !/Enable JavaScript and reload this page/.test(noscript)
    || !/No live information is shown/.test(noscript)) {
    errors.push('HTML lacks the static JavaScript-disabled explanation');
  }
  return errors;
}

/**
 * @param {string} directory
 * @param {string} base
 * @returns {string[]}
 */
export function inspectPwaOutput(directory, base) {
  const deploymentBase = normalizeDeploymentBase(base);
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(path.resolve(directory, 'manifest.webmanifest'), 'utf8'));
  const html = readFileSync(path.resolve(directory, 'index.html'), 'utf8');
  const errors = validatePwaOutput(manifest, html, deploymentBase);
  const assets = [
    ...new Set(createPwaManifestPaths(deploymentBase).icons.map(({ src }) => src.slice(deploymentBase.length))),
    'data/countries.geojson',
    ...['dark', 'light', 'happy-dark', 'happy-light', 'satellite', 'terrain', 'emergency'].map((name) => `map-styles/${name}.json`),
    ...['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((name) => `cesium/${name}`),
  ];
  for (const asset of assets) {
    if (!existsSync(path.resolve(directory, asset))) errors.push(`Missing bundled output asset: ${asset}`);
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--base' || args[2] !== '--dir') {
    throw new Error('Usage: node --import tsx scripts/check-pwa-output.mjs --base /crystal-ball/ --dir dist');
  }
  const errors = inspectPwaOutput(args[3], args[1]);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`PWA output paths verified for ${normalizeDeploymentBase(args[1])} in ${args[3]}`);
  }
}

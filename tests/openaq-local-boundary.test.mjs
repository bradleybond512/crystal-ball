import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function sourceFiles(path) {
  const absolute = resolve(root, path);
  return readdirSync(absolute).flatMap((name) => {
    const child = resolve(absolute, name);
    if (statSync(child).isDirectory()) {
      if (name === '__tests__') return [];
      return sourceFiles(child.slice(root.length + 1));
    }
    return /\.(?:js|mjs|ts)$/.test(name) ? [child] : [];
  });
}

test('production OpenAQ callers and sidecar routes use the desktop-local namespace', () => {
  const productionFiles = [
    ...sourceFiles('src'),
    resolve(root, 'src-tauri/sidecar/local-api-server.mjs'),
  ];
  const routeLiterals = productionFiles.flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(/['"`]([^'"`]*\/api\/[^'"`]*openaq[^'"`]*)['"`]/gi)]
      .map((match) => ({ path, route: match[1] }));
  });

  assert.ok(routeLiterals.length >= 4, 'expected both OpenAQ callers and sidecar routes');
  for (const { path, route } of routeLiterals) {
    assert.match(
      route,
      /^(?:\$\{getApiBaseUrl\(\)\})?\/api\/local-airquality\/openaq(?:\/worst)?(?:\?|$)/,
      `${path.slice(root.length + 1)} uses a cloud-fallback-capable OpenAQ route: ${route}`,
    );
  }
});

test('runtime policy blocks cloud fallback for the local OpenAQ namespace', () => {
  const runtime = read('src/services/runtime.ts');

  assert.match(runtime, /return target\.startsWith\('\/api\/local-'\);/);
  assert.match(runtime, /const allowCloudFallback = !isLocalOnlyApiTarget\(target\);/);
  assert.match(runtime, /if \(!allowCloudFallback\) \{\s*throw new Error\(`Cloud fallback blocked for \$\{target\}`\);/);
  assert.match(runtime, /if \(!response\.ok\) \{\s*if \(!allowCloudFallback\) \{[\s\S]*?return response;/);
  assert.match(runtime, /catch \(error\) \{[\s\S]*?if \(!allowCloudFallback\) \{\s*throw error;/);
});

test('retired OpenAQ v2 Edge route and legacy repository references are absent', () => {
  assert.equal(existsSync(resolve(root, 'api/openaq-readings.js')), false);

  const productionFiles = [
    ...sourceFiles('src'),
    ...sourceFiles('api'),
    resolve(root, 'src-tauri/sidecar/local-api-server.mjs'),
  ];
  const legacyReferences = productionFiles.flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return /api\.openaq\.org\/v2|\/v2\/measurements|\/api\/airquality\/openaq/.test(source)
      ? [path.slice(root.length + 1)]
      : [];
  });
  assert.deepEqual(legacyReferences, [], `legacy OpenAQ references remain in: ${legacyReferences.join(', ')}`);

  const roadmap = read('ROADMAP.md');
  assert.match(roadmap, /openaq-monitor[^\n]*OpenAQ v3[^\n]*desktop sidecar/i);
  assert.doesNotMatch(roadmap, /api\/openaq-readings\.js/);
  assert.match(read('scripts/targeted-tests-baseline.txt'), /^api\/openaq-readings\.js$/m);

  const packageJson = JSON.parse(read('package.json'));
  assert.match(packageJson.scripts['test:openaq'], /tests\/openaq-local-boundary\.test\.mjs/);
});

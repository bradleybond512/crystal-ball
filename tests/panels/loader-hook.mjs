/**
 * Node loader hook (worker context) — substitutes test stubs for a small
 * set of source modules that depend on Vite-only features.
 *
 * Lives as .mjs (not .mts) because module hooks run in a dedicated worker
 * that does not inherit tsx's loader.
 *
 * Wired via tests/panels/register-hook.mjs which is passed to `tsx --import`.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

const ASSET_QUERY_RE = /\?(worker|url|inline|raw)\b/;
const assetStubPath = path.join(projectRoot, 'tests', 'panels', 'stubs', 'asset-stub.mjs');
let assetStubSource;

const STUBS = {
  [path.join(projectRoot, 'src', 'services', 'i18n.ts')]:
    path.join(projectRoot, 'tests', 'panels', 'stubs', 'i18n-stub.mjs'),
  [path.join(projectRoot, 'src', 'services', 'analytics.ts')]:
    path.join(projectRoot, 'tests', 'panels', 'stubs', 'analytics-stub.mjs'),
  [path.join(projectRoot, 'src', 'services', 'ml-worker.ts')]:
    path.join(projectRoot, 'tests', 'panels', 'stubs', 'ml-worker-stub.mjs'),
};

// Sentinel used so we can rewrite `import.meta.env.<KEY>` references in
// renderer source. `import.meta.env` is provided only by the Vite
// bundler — under tsx it's `undefined`, which crashes any module that
// reads it at import time. We inject a `globalThis.__viteImportMetaEnv`
// fallback below, then rewrite source code to read from it.
const VITE_ENV_PROBE_RE = /\bimport\s*\.\s*meta\s*\.\s*env\b/g;

export async function load(url, context, nextLoad) {
  // Vite asset/worker queries can reach load() without passing through our
  // resolve() below: tsx ≥4.22 registers sync in-thread hooks
  // (module.registerHooks) that resolve the `@/` alias and short-circuit
  // before async register() hooks see the specifier. The final URL still
  // carries the query, so intercepting here works under either ordering.
  if (ASSET_QUERY_RE.test(url)) {
    assetStubSource ??= readFileSync(assetStubPath, 'utf8');
    return { source: assetStubSource, format: 'module', shortCircuit: true };
  }
  // Only rewrite project source. Skip node_modules and our own stubs.
  if (!url.startsWith('file://')) return nextLoad(url, context);
  const abs = fileURLToPath(url);
  if (abs.includes(`${path.sep}node_modules${path.sep}`)) return nextLoad(url, context);
  if (abs.includes(`${path.sep}tests${path.sep}panels${path.sep}stubs${path.sep}`)) {
    return nextLoad(url, context);
  }
  const ext = path.extname(abs);
  if (ext !== '.ts' && ext !== '.mts' && ext !== '.tsx') return nextLoad(url, context);
  const result = await nextLoad(url, context);
  if (typeof result.source !== 'string' && !(result.source instanceof Uint8Array)) return result;

  let source = typeof result.source === 'string'
    ? result.source
    : Buffer.from(result.source).toString('utf8');
  VITE_ENV_PROBE_RE.lastIndex = 0; // /g regex: .test() advances lastIndex across calls
  if (!VITE_ENV_PROBE_RE.test(source)) return result;
  VITE_ENV_PROBE_RE.lastIndex = 0;

  // Replace `import.meta.env` with our global fallback so reads work in node.
  source = source.replace(VITE_ENV_PROBE_RE, '(globalThis.__viteImportMetaEnv||{})');
  return { ...result, source, format: result.format ?? 'module' };
}

export async function resolve(specifier, context, nextResolve) {
  // Strip Vite's `?worker`, `?url`, `?inline`, `?raw` query suffixes —
  // panels only use them to pull in workers/assets the harness has no
  // need for. Replacing the import with a no-op lets the panel mount.
  if (typeof specifier === 'string' && /\?(worker|url|inline|raw)\b/.test(specifier)) {
    const stubPath = path.join(projectRoot, 'tests', 'panels', 'stubs', 'asset-stub.mjs');
    return {
      url: pathToFileURL(stubPath).href,
      format: 'module',
      shortCircuit: true,
    };
  }

  const resolved = await nextResolve(specifier, context);
  try {
    if (resolved.url.startsWith('file://')) {
      const abs = fileURLToPath(resolved.url);
      const stub = STUBS[abs];
      if (stub) {
        return {
          url: pathToFileURL(stub).href,
          format: 'module',
          shortCircuit: true,
        };
      }
    }
  } catch {
    // ignore
  }
  return resolved;
}

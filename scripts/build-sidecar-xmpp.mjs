/**
 * Bundle src-tauri/sidecar/s2u-xmpp-source.mjs into a single
 * `src-tauri/sidecar/s2u-xmpp.bundle.mjs` so `local-api-server.mjs`
 * can `import()` it without npm dependencies at runtime. Mirrors the
 * `build:sidecar-sebuf` bundling pattern.
 *
 * Run: node scripts/build-sidecar-xmpp.mjs
 * Or:  npm run build:sidecar-xmpp
 */

import { build } from 'esbuild';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const entryPoint = path.join(projectRoot, 'src-tauri', 'sidecar', 's2u-xmpp-source.mjs');
const outfile = path.join(projectRoot, 'src-tauri', 'sidecar', 's2u-xmpp.bundle.mjs');

try {
  await build({
 entryPoints: [entryPoint],
 outfile,
 bundle: true,
 format: 'esm',
 platform: 'node',
 target: 'node22',
 treeShaking: true,
 // @xmpp/client uses dynamic import for transport selection; mark
 // the legacy ws-only browser transport as external so esbuild
 // doesn't choke when Node 22 has WebSocket builtin.
 // @xmpp/client (and its deps) call require('events') etc. In an ESM
 // bundle esbuild rewrites those to a __require shim that throws
 // "Dynamic require of \"events\" is not supported" at runtime. Inject a
 // real createRequire so node-builtin requires resolve, otherwise the
 // bundle imports but throws on first use and the S2U XMPP feed silently
 // stays disabled in the packaged app.
 banner: {
   js: [
     "import { createRequire as __xmppCreateRequire } from 'node:module';",
     "import { fileURLToPath as __xmppFileURLToPath } from 'node:url';",
     "import { dirname as __xmppDirname } from 'node:path';",
     'const require = __xmppCreateRequire(import.meta.url);',
     'const __filename = __xmppFileURLToPath(import.meta.url);',
     'const __dirname = __xmppDirname(__filename);',
   ].join('\n'),
 },
 external: [],
 logLevel: 'warning',
  });

  const { size } = await stat(outfile);
  const sizeKB = (size / 1024).toFixed(1);
  console.log(`build:sidecar-xmpp  src-tauri/sidecar/s2u-xmpp.bundle.mjs  ${sizeKB} KB`);
} catch (error) {
  console.error('build:sidecar-xmpp failed:', error.message);
  // eslint-disable-next-line unicorn/no-process-exit -- CLI build script
  process.exit(1);
}

// R4-SEC-008: crystalball.app is for sale. Nothing in the app may trust it —
// not a CSP, not a CORS allowlist, not APP_HOSTS, not a link or default — and
// the only trusted web origin is the GitHub Pages site Bradley owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const FORBIDDEN = 'crystalball' + '.app';
const OWNED_HOST = 'bradleybond512.github.io';

// History and reviews may mention the old domain; code, config and tests of
// trust decisions may not. Tests are excluded because they assert rejection.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'docs', '.agentic', 'tmp', '__tests__', 'coverage', 'test-results', 'playwright-report']);
const SKIP_FILES = /(?:\.test\.[cm]?[jt]s|\.spec\.ts|CHANGELOG\.md|ROADMAP\.md|README\.md)$/;
const TEXT = /\.(?:[cm]?[jt]sx?|json|html|css|rs|toml|ya?ml|lsrules|txt|example|plist|md)$/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (path.relative(root, full) === 'tests') continue;
      yield* files(full);
    } else if ((TEXT.test(name) || name.startsWith('.env')) && !SKIP_FILES.test(name) && stat.size < 5_000_000) {
      yield full;
    }
  }
}

test('no code or config refers to the unowned domain', () => {
  const offenders = [];
  for (const file of files(root)) {
    if (readFileSync(file, 'utf8').includes(FORBIDDEN)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

function hostsIn(policy) {
  return [...policy.matchAll(/[a-z]+:\/\/([^\s;/'"]+)/g)].map((m) => m[1]);
}

test('both CSPs trust only known third-party services, loopback and owned hosts', () => {
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json')).app.security.csp;
  const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read('index.html'))?.[1] ?? '';
  for (const host of [...hostsIn(tauri), ...hostsIn(meta)]) {
    assert.ok(!host.includes('crystalball'), `CSP host ${host}`);
  }
});

test('APP_HOSTS and the sidecar CORS list come from the owned list', async () => {
  const owned = read('src/config/owned-origins.ts');
  assert.match(owned, new RegExp(`OWNED_WEB_HOSTS[^=]*= Object\\.freeze\\(\\['${OWNED_HOST.replaceAll('.', '\\.')}'\\]\\)`));
  const runtime = read('src/services/runtime.ts');
  assert.match(runtime, /const APP_HOSTS = new Set\(\[\s*\.\.\.OWNED_WEB_HOSTS,/);
  assert.doesNotMatch(runtime, /host\.endsWith\(/, 'no suffix trust');

  const { isSidecarOriginAllowed } = await import('../src-tauri/sidecar/local-api-server.mjs');
  assert.equal(isSidecarOriginAllowed(`https://${OWNED_HOST}`), true);
  for (const denied of [`https://${FORBIDDEN}`, `https://api.${FORBIDDEN}`, `https://tech.${FORBIDDEN}`, `https://evil.${OWNED_HOST}`, `http://${OWNED_HOST}`]) {
    assert.equal(isSidecarOriginAllowed(denied), false, denied);
  }
});

test('the server allowlists trust the owned origin and no other account', async () => {
  for (const file of ['api/_cors.js', 'api/_api-key.js', 'server/cors.ts', 'api/youtube/embed.js']) {
    const source = read(file);
    assert.match(source, /\/\^https:\\\/\\\/bradleybond512\\\.github\\\.io\$\//, `${file} allows the owned origin`);
    assert.doesNotMatch(source, /-elie-/, `${file} trusts no previews of another Vercel account`);
  }
  const { getCorsHeaders } = await import('../api/_cors.js');
  const cors = (origin) => getCorsHeaders(new Request('https://example.test/api/x', { headers: origin ? { origin } : {} }))['Access-Control-Allow-Origin'];
  assert.equal(cors(`https://${OWNED_HOST}`), `https://${OWNED_HOST}`);
  assert.equal(cors(`https://${FORBIDDEN}`), `https://${OWNED_HOST}`, 'an unowned origin is never reflected');
});

test('no cloud fallback target and no unowned data source by default', () => {
  const sidecar = read('src-tauri/sidecar/local-api-server.mjs');
  assert.match(sidecar, /process\.env\.LOCAL_API_REMOTE_BASE \?\? ''\)/);
  const posture = sidecar.slice(sidecar.indexOf("requestUrl.pathname === '/api/military/v1/get-theater-posture'"));
  assert.doesNotMatch(posture.slice(0, 2500), /fetchWithTimeout\(|cloudUrl/, 'theater posture is computed locally');
});

test('story sharing produces no link', () => {
  const share = read('src/services/story-share.ts');
  assert.doesNotMatch(share, /generateStoryDeepLink|https?:\/\/[^`'"]*\/api\/story/);
  assert.doesNotMatch(read('src/components/StoryModal.ts'), /story-copy|copyDeepLink/);
});

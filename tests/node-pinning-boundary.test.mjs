// R3-SEC-005 source gates: a release sidecar runs only the bundled Node whose
// SHA-256 build.rs pinned, verified before every spawn; debug builds keep the
// developer fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const main = read('src-tauri/src/main.rs');

function fnBody(signature) {
  const start = main.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  return main.slice(start, main.indexOf('\n}\n', start));
}

test('a release selection considers only the bundled candidates', () => {
  const select = fnBody('fn select_node_binary(');
  assert.match(select, /if release \{\s*return bundled\.iter\(\)\.find\(\|candidate\| candidate\.is_file\(\)\)\.cloned\(\);\s*\}/);
  const resolve = fnBody('fn resolve_node_binary(');
  assert.match(resolve, /let \(path_dirs, common\): \(Vec<PathBuf>, Vec<PathBuf>\) = if release \{\s*\(Vec::new\(\), Vec::new\(\)\)/);
  assert.match(resolve, /#\[cfg\(debug_assertions\)\]\s*if let Ok\(value\) = env::var\("LOCAL_API_NODE_BIN"\)/, 'the override stays debug-only');
});

test('a release build verifies the pin before returning the binary', () => {
  const resolve = fnBody('fn resolve_node_binary(');
  assert.match(resolve, /let node = chosen\.ok_or_else\(\|\| NODE_MISSING_MESSAGE\.to_string\(\)\)\?;\s*verify_node_pin\(&node, BUNDLED_NODE_SHA256\)\?;\s*Ok\(node\)/);
  assert.match(main, /const BUNDLED_NODE_SHA256: &str = env!\("CRYSTALBALL_BUNDLED_NODE_SHA256"\);/);
  const verify = fnBody('fn verify_node_pin(');
  assert.match(verify, /if expected_hex\.is_empty\(\) \{\s*return Err\(NODE_UNPINNED_MESSAGE\.to_string\(\)\);/, 'no pin fails closed');
});

test('start_local_api resolves and verifies Node before any secret reaches the child', () => {
  const start = fnBody('fn start_local_api(');
  const resolve = start.indexOf('let node_binary = match resolve_node_binary(app) {');
  assert.ok(resolve > 0);
  for (const later of ['secrets_cache.state.read(|secrets| {', '.spawn()']) {
    const at = start.indexOf(later);
    assert.ok(at > resolve, `${later} comes after the Node check`);
  }
  assert.match(start.slice(resolve), /Err\(error\) => \{\s*if let Ok\(mut slot\) = state\.start_error\.lock\(\) \{\s*\*slot = Some\(error\.clone\(\)\);\s*\}\s*return Err\(error\);/);
  assert.match(fnBody('fn local_api_status('), /start_error: state\.start_error\.lock\(\)\.ok\(\)\.and_then\(\|slot\| slot\.clone\(\)\),/);
});

test('build.rs pins the exact bundled file, for release profiles only', () => {
  const build = read('src-tauri/build.rs');
  assert.match(build, /let node_dir = manifest_dir\.join\("sidecar"\)\.join\("node"\);/);
  assert.match(build, /if std::env::var\("PROFILE"\)\.as_deref\(\) != Ok\("release"\) \{\s*return String::new\(\);/);
  assert.match(build, /cargo:rustc-env=CRYSTALBALL_BUNDLED_NODE_SHA256=\{\}/);
  const cargo = read('src-tauri/Cargo.toml');
  const runtime = cargo.match(/\[dependencies\][\s\S]*?\nsha2 = "([^"]+)"/)?.[1];
  const buildDep = cargo.match(/\[build-dependencies\][\s\S]*?\nsha2 = "([^"]+)"/)?.[1];
  assert.ok(runtime && buildDep && runtime === buildDep, 'the build dependency reuses the runtime sha2 version');
});

test('packaging still bundles the downloaded Node where build.rs reads it', () => {
  const download = read('scripts/download-node.sh');
  assert.match(download, /DEST_DIR="\$\{ROOT_DIR\}\/src-tauri\/sidecar\/node"/);
  assert.match(read('src-tauri/tauri.conf.json'), /"sidecar\/node"/);
});

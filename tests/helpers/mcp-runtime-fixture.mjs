// Test-only isolation: current tracked source, no ignored inputs or user config.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Select before outer fake-HOME isolation; only install-smoke reads this cache.
const TARBALL_SOURCE = process.env.CB_TEST_NPM_CACHE ?? process.env.CB_TEST_MCP_TARBALL_SOURCE
  ?? process.env.npm_config_cache ?? join(homedir(), '.npm');
export function npmCli() {
  const candidates = [join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../share/nodejs/npm/bin/npm-cli.js')];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const executable = realpathSync(candidate);
    const metadata = JSON.parse(readFileSync(join(dirname(executable), '../package.json'), 'utf8'));
    if (metadata.name === 'npm' && executable.endsWith('/npm/bin/npm-cli.js')) return executable;
  }
  throw new Error('No genuine npm CLI found beside the selected Node installation.');
}
export function isolatedEnv(root, extra = {}) {
  const home = join(root, 'home');
  const temp = join(root, 'temp');
  const ports = join(root, 'owned-ports');
  mkdirSync(ports, { recursive: true });
  for (const dir of [home, temp, join(root, 'data'), join(root, 'resources')]) mkdirSync(dir, { recursive: true });
  const cache = join(root, 'npm-cache');
  if (!existsSync(cache)) mkdirSync(cache);
  const config = join(root, 'empty-user.npmrc');
  const globalConfig = join(root, 'empty-global.npmrc');
  writeFileSync(config, '');
  writeFileSync(globalConfig, '');
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp,
    CB_TEST_PORT_REGISTRY: ports, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'),
    npm_config_userconfig: config, npm_config_globalconfig: globalConfig, npm_config_ignore_scripts: 'true',
    npm_config_offline: 'true', npm_config_cache: cache, CB_TEST_MCP_TARBALL_SOURCE: TARBALL_SOURCE, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    CRYSTALBALL_MCP_MONITOR_INTERVAL_MINUTES: '0', LOCAL_API_TOKEN: 'fixture-only-sidecar-token',
    LOCAL_API_PORT: '0', LOCAL_API_DATA_DIR: join(root, 'data'), LOCAL_API_RESOURCE_DIR: join(root, 'resources'),
    LOCAL_API_PORT_FILE: join(root, 'data/sidecar.port'), LOCAL_API_CLOUD_FALLBACK: 'false',
    LOCAL_API_REMOTE_BASE: 'http://127.0.0.1:1', CB_SIDECAR_FILE_LOG: '0',
    ...(process.env.CB_TEST_ARTIFACT_DIR ? { CB_TEST_ARTIFACT_DIR: process.env.CB_TEST_ARTIFACT_DIR } : {}), ...extra,
  };
}
export function sourceFixture({ packageOnly = false, prepareTarballs = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cb-isolated-runtime-')));
  try {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  // Disposable runners have no .git; their enclosing runner supplies this manifest.
  const tracked = existsSync(join(REPO, '.git'))
    ? execFileSync('/usr/bin/git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).split('\0').filter(Boolean)
    : JSON.parse(readFileSync(join(REPO, '.fixture-tracked.json'), 'utf8'));
  const files = tracked.filter((name) => !packageOnly || name.startsWith('tools/mcp-server/') || name.startsWith('tests/helpers/') || name === 'scripts/install-crystalball-mcp.mjs' || name === 'package.json');
  for (const name of files) {
    if (name === '.npmrc' || name.includes('.env.local')) continue;
    const dest = join(repo, name);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(REPO, name), dest);
  }
  writeFileSync(join(repo, '.fixture-tracked.json'), JSON.stringify(files));
  symlinkSync(join(REPO, 'node_modules'), join(repo, 'node_modules'), 'dir');
  const packageDeps = join(REPO, 'tools/mcp-server/node_modules');
  if (existsSync(packageDeps)) symlinkSync(packageDeps, join(repo, 'tools/mcp-server/node_modules'), 'dir');
  const env = isolatedEnv(root);
  // npm run uses a shell, so direct-child wrapping alone cannot guard the
  // script's `node` invocation. Supply an owned PATH shim with explicit import.
  const guardedBin = join(root, 'guarded-bin'); mkdirSync(guardedBin);
  const quote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;
  const guardedNode = join(guardedBin, 'node');
  writeFileSync(guardedNode, `#!/bin/sh\nexec ${quote(process.execPath)} --import ${quote(join(repo, 'tests/helpers/loopback-only.mjs'))} "$@"\n`);
  chmodSync(guardedNode, 0o755);
  env.PATH = `${guardedBin}:${env.PATH}`;
  if (prepareTarballs) {
    const admission = execFileSync(process.execPath, ['--import', join(repo, 'tests/helpers/loopback-only.mjs'), join(repo, 'tests/helpers/mcp-locked-cache.mjs'), TARBALL_SOURCE, env.npm_config_cache, join(repo, 'tools/mcp-server/package-lock.json')], { cwd: repo, env, encoding: 'utf8' });
    if (env.CB_TEST_ARTIFACT_DIR) writeFileSync(join(env.CB_TEST_ARTIFACT_DIR, `${root.split('/').at(-1)}-tarball-admission.txt`), admission);
  }
  return { root, repo, serverRoot: join(repo, 'tools/mcp-server'), env, cleanup() { rmSync(root, { recursive: true, force: true }); } };
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}

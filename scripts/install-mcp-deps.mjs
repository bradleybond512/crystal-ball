/**
 * Installs dependencies for the nested `tools/mcp-server` package.
 *
 * That directory is its own npm package with its own package.json and
 * package-lock.json. The root `npm ci` does not touch it — there are no
 * workspaces and no postinstall — so on a fresh clone the MCP server starts
 * and immediately dies with:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@modelcontextprotocol/sdk'
 *
 * which surfaces to the user only as "crystalball (CONNECTION_CLOSED)". CI got
 * away with it because .github/workflows/smoke.yml runs an explicit
 * `cd tools/mcp-server && npm ci`; developers had no equivalent step.
 *
 * Runs from the root `prepare` script. Deliberately:
 *   - a no-op when the local server entrypoints are present,
 *   - non-fatal on failure (a broken MCP server must not break `npm install`),
 *   - skippable with CB_SKIP_MCP_INSTALL=1 for CI jobs that do their own.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SERVER_DIR = path.join(repoRoot, 'tools', 'mcp-server');

const ENTRYPOINT_PROBE = `
  import { realpathSync, statSync } from 'node:fs';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';

  try {
    const modulesDir = path.join(realpathSync(process.cwd()), 'node_modules');
    for (const specifier of [
      '@modelcontextprotocol/sdk/server/mcp.js',
      '@modelcontextprotocol/sdk/server/stdio.js',
      'zod',
    ]) {
      const entry = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
      const relative = path.relative(modulesDir, entry);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep)
          || path.isAbsolute(relative) || !statSync(entry).isFile()) process.exit(1);
    }
  } catch {
    process.exit(1);
  }
`;

function hasLocalEntrypoints(serverDir) {
  try {
    execFileSync(process.execPath, ['--input-type=module', '--eval', ENTRYPOINT_PROBE], {
      cwd: serverDir,
      timeout: 2000,
      maxBuffer: 1024,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide what to do without doing it. Split out so the skip logic is testable
 * without shelling out to npm.
 *
 * @returns {'skip:disabled'|'skip:no-package'|'skip:installed'|'skip:no-npm'|'ci'|'install'}
 */
export function decideAction({ serverDir = DEFAULT_SERVER_DIR, env = process.env } = {}) {
  if (env.CB_SKIP_MCP_INSTALL === '1') return 'skip:disabled';
  // Not a full checkout (e.g. a published tarball) — nothing to install.
  if (!existsSync(path.join(serverDir, 'package.json'))) return 'skip:no-package';
  // Resolve ESM exports without loading dependency code or accepting hoisted packages.
  if (hasLocalEntrypoints(serverDir)) return 'skip:installed';
  // npm sets npm_execpath for lifecycle scripts; without it we will not guess.
  if (!env.npm_execpath || !existsSync(env.npm_execpath)) return 'skip:no-npm';
  return existsSync(path.join(serverDir, 'package-lock.json')) ? 'ci' : 'install';
}

export function installMcpDeps({ serverDir = DEFAULT_SERVER_DIR, env = process.env } = {}) {
  const action = decideAction({ serverDir, env });
  if (action === 'skip:no-npm') {
    console.warn('[mcp-deps] Not running under npm (no npm_execpath); skipping.');
    console.warn('[mcp-deps] Install manually with: npm run mcp:install');
    return action;
  }
  if (action.startsWith('skip:')) return action;

  // Invoke npm's CLI through the running node binary rather than resolving
  // "npm" from PATH — no PATH lookup, no hijack surface.
  console.log(`[mcp-deps] Installing tools/mcp-server dependencies (npm ${action})…`);
  try {
    execFileSync(process.execPath, [env.npm_execpath, action, '--no-audit', '--no-fund'], {
      cwd: serverDir,
      stdio: 'inherit',
    });
    console.log('[mcp-deps] Done — the crystalball MCP server can now start.');
  } catch (error) {
    // Warn, never throw: a developer without network access should still be
    // able to install the root project and work on the app.
    console.warn(`[mcp-deps] Install failed: ${error instanceof Error ? error.message : String(error)}`);
    console.warn('[mcp-deps] The crystalball MCP server will not start until this succeeds.');
    console.warn('[mcp-deps] Retry with: npm run mcp:install');
  }
  return action;
}

// Only run when executed directly, so importing this module (tests) is free of
// side effects.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  installMcpDeps();
}

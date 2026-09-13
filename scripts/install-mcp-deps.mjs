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
 *   - a fast no-op when node_modules is already present,
 *   - non-fatal on failure (a broken MCP server must not break `npm install`),
 *   - skippable with CB_SKIP_MCP_INSTALL=1 for CI jobs that do their own.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repoRoot, 'tools', 'mcp-server');

function installMcpDeps() {
  if (process.env.CB_SKIP_MCP_INSTALL === '1') return;
  // Not a full checkout (e.g. a published tarball) — nothing to install.
  if (!existsSync(path.join(serverDir, 'package.json'))) return;
  // Already installed. The common case; keep it free.
  if (existsSync(path.join(serverDir, 'node_modules'))) return;

  // Invoke npm's CLI through the running node binary rather than resolving
  // "npm" from PATH. npm sets npm_execpath for lifecycle scripts, so this is
  // the same npm that started us — no PATH lookup, no hijack surface.
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !existsSync(npmCli)) {
    console.warn('[mcp-deps] Not running under npm (no npm_execpath); skipping.');
    console.warn('[mcp-deps] Install manually with: npm run mcp:install');
    return;
  }

  const command = existsSync(path.join(serverDir, 'package-lock.json')) ? 'ci' : 'install';
  console.log(`[mcp-deps] Installing tools/mcp-server dependencies (npm ${command})…`);
  try {
    execFileSync(process.execPath, [npmCli, command, '--no-audit', '--no-fund'], {
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
}

installMcpDeps();

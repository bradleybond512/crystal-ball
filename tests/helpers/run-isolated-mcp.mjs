import { spawnSync } from 'node:child_process';
import { sourceFixture, npmCli } from './mcp-runtime-fixture.mjs';
import { join } from 'node:path';
const fixture = sourceFixture();
try {
  const requested = process.argv.slice(2);
  const args = requested[0] === '--npm-mcp-test'
    ? [npmCli(), '--prefix', fixture.serverRoot, 'test', '--', '--import', join(fixture.repo, 'tests/helpers/loopback-only.mjs')]
    : requested[0] === '--npm-script' && /^test:/.test(requested[1] ?? '')
      ? [npmCli(), 'run', requested[1]]
      : requested;
  const result = spawnSync(process.execPath, ['--import', join(fixture.repo, 'tests/helpers/loopback-only.mjs'), ...args], {
    cwd: fixture.repo, env: { ...fixture.env, CB_TEST_RUNNER_GROUP: '1' },
    detached: process.env.CB_TEST_RUNNER_GROUP !== '1', stdio: 'inherit', timeout: 120_000,
  });
  if (process.env.CB_TEST_RUNNER_GROUP !== '1' && result.pid) {
    try { process.kill(-result.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally { fixture.cleanup(); }

import { homedir } from 'node:os';
import { prepareLaunch } from './launch-trust.mjs';
import { runChild } from './child-lifecycle.mjs';

try {
  const spec = prepareLaunch({ argv: process.argv.slice(2), home: homedir(), platform: process.platform,
    arch: process.arch, bootstrapVersion: process.versions.node, env: process.env });
  const result = await runChild(spec);
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.code ?? 1;
} catch (error) {
  process.stderr.write(`Filesystem MCP unavailable: ${error.message}. Use the documented explicit qualification/provisioning process; no automatic installation is performed.\n`);
  process.exitCode = 1;
}

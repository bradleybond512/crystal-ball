import { execSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';

function isGitRepo() {
  try {
 execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
 return true;
  } catch {
 return false;
  }
}

if (!isGitRepo()) process.exit(0);

const topLevel = execSync('git rev-parse --show-toplevel', {
  encoding: 'utf8',
}).trim();

process.chdir(topLevel);

try {
  execSync('git config core.hooksPath .husky', { stdio: 'ignore' });
} catch {
  process.exit(0);
}

for (const hookName of ['pre-commit', 'pre-push']) {
  const hookPath = `.husky/${hookName}`;
  if (existsSync(hookPath)) chmodSync(hookPath, 0o755);
}

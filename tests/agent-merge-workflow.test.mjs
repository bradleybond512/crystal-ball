import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'auto-merge-agent-branches.yml'),
  'utf8',
);

test('agent branches create draft PRs and never merge without approval', () => {
  assert.doesNotMatch(
    workflow,
    /enablePullRequestAutoMerge|github\.rest\.pulls\.merge/,
    'agent workflow should not merge or enable auto-merge on branch push',
  );
  assert.match(workflow, /draft:\s*true/, 'agent PRs should start as drafts');
  assert.match(
 workflow,
 /TITLE=\$\{BRANCH##\*\/\}[\s\S]*TITLE=\$\{TITLE\/\/-\/ \}/,
 'agent workflow should derive PR titles with shell-safe parameter expansion',
  );
});

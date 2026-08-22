import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'lint.yml'),
  'utf8',
);
const eslintWorkflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'eslint.yml'),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

test('markdown lint workflow only lints markdown files changed in the pull request', () => {
  assert.match(
 workflow,
 /actions\/checkout@[a-f0-9]{40}[\s\S]*fetch-depth: 0/,
 'lint workflow should fetch enough history to diff against the base branch',
  );
  // Two valid strategies — either fetch the base ref shallowly and diff
 // against it, or rely on a checkout with fetch-depth: 0 and diff against
 // the recorded base.sha directly.
 assert.match(
 workflow,
 /git diff --name-only --diff-filter=ACMRT "(origin\/\$\{\{ github\.base_ref \}\}\.\.\.HEAD"|\$\{\{ github\.event\.pull_request\.base\.sha \}\}" HEAD) -- '\*\.md'/,
 'lint workflow should resolve the changed markdown file set from the pull request diff',
  );
  assert.match(
 workflow,
 /xargs -0 node scripts\/lint-markdown\.mjs < "\$RUNNER_TEMP\/markdown-files\.txt"/,
 'lint workflow should lint only the changed markdown files',
  );
  assert.match(
 workflow,
 /if: github\.event_name == 'merge_group'\s+run: npm run lint:md/,
 'merge groups should lint the complete repository after combining changes',
  );
});

test('ESLint workflow has a bounded completion time', () => {
  assert.match(
 eslintWorkflow,
 /eslint:[\s\S]*timeout-minutes: 12/,
 'ESLint workflow should stop a stuck lint process before consuming an entire runner allocation',
  );
});

test('ESLint CI tests and runs the repository-wide debt ratchet', () => {
  assert.match(packageJson.scripts.lint, /lint-baseline\.mjs/);
  assert.match(packageJson.scripts['lint:ci'], /npm run lint/);
  assert.match(
 eslintWorkflow,
 /npm run test:eslint-runner[\s\S]*npm run lint:ci/,
 'ESLint workflow should test the lint infrastructure before enforcing the full-repository ratchet',
  );
});

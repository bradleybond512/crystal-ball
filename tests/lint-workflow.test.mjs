import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'lint.yml'),
  'utf8',
);

test('markdown lint workflow only lints markdown files changed in the pull request', () => {
  assert.match(
 workflow,
 /actions\/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10[\s\S]*fetch-depth: 0/,
 'lint workflow should fetch enough history to diff against the base branch',
  );
  // Two valid strategies — either fetch the base ref shallowly and diff
 // against it, or rely on a checkout with fetch-depth: 0 and diff against
 // the recorded base.sha directly.
 assert.match(
 workflow,
 /git diff --name-only "(origin\/\$\{\{ github\.base_ref \}\}\.\.\.HEAD"|\$\{\{ github\.event\.pull_request\.base\.sha \}\}" HEAD) -- '\*\.md'/,
 'lint workflow should resolve the changed markdown file set from the pull request diff',
  );
  assert.match(
 workflow,
 /xargs -0 npx markdownlint-cli2 < "\$RUNNER_TEMP\/markdown-files\.txt"/,
 'lint workflow should lint only the changed markdown files',
  );
  assert.doesNotMatch(
 workflow,
 /run: npm run lint:md/,
 'lint workflow should not lint the entire repository on every markdown-touching pull request',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'release-integrity.yml'),
  'utf8',
);

test('release integrity workflow blocks stale release versions on main pushes', () => {
  assert.match(
 workflow,
 /name: Release Integrity/,
 'release integrity workflow should exist',
  );
  assert.match(
 workflow,
 /Run release doctor for full variant on main push[\s\S]*node scripts\/release-doctor\.mjs --variant full/,
 'main-push release guard should block stale full releases without allow-existing-target-release',
  );
  assert.match(
 workflow,
 /Run release doctor for tech variant on main push[\s\S]*node scripts\/release-doctor\.mjs --variant tech/,
 'main-push release guard should block stale tech releases without allow-existing-target-release',
  );
  assert.match(
 workflow,
 /Run release doctor for finance variant on main push[\s\S]*node scripts\/release-doctor\.mjs --variant finance/,
 'main-push release guard should block stale finance releases without allow-existing-target-release',
  );
  assert.doesNotMatch(
 workflow,
 /Run release doctor for full variant on main push[\s\S]*allow-existing-target-release/,
 'main-push release guard should not allow already-used release tags',
  );
  assert.match(
 workflow,
 /Run release doctor for full variant on pull requests[\s\S]*allow-existing-target-release[\s\S]*--variant full/,
 'pull requests can keep the softer release-doctor mode to avoid breaking unrelated work',
  );
});

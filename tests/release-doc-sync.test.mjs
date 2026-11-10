import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const repoRoot = path.resolve(import.meta.dirname, '..');

const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
);
const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const documentation = readFileSync(
  path.join(repoRoot, 'docs', 'DOCUMENTATION.md'),
  'utf8',
);
const changelog = readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

const autoTag = readFileSync(path.join(repoRoot, '.github/workflows/auto-tag.yml'), 'utf8');
const desktop = readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('README uses a non-stale latest-release download label', () => {
  assert.match(readme, /<strong>Download Latest Release<\/strong>/);
  assert.doesNotMatch(readme, /<strong>Download v\d+\.\d+\.\d+<\/strong>/);
});

test('documentation version badge is dynamic and release-backed', () => {
  assert.match(
 documentation,
 /img\.shields\.io\/github\/v\/release\/bradleybond512\/crystal-ball\?label=version/,
  );
  assert.doesNotMatch(
 documentation,
 /img\.shields\.io\/badge\/version-\d+\.\d+\.\d+-blue/,
  );
});

// This is a narrow source-preparation exception, not a release-readiness check.
// Compare parsed job guards, not comments, an opt-in setting, or a substring:
// a future workflow change must explicitly update this fail-closed contract.
function assertCurrentVersionHeading({ version, text, autoTagSource, desktopSource }) {
  const token = new RegExp(`(?<![\\d.])${escapeRegex(version)}(?![\\d.])`);
  const headings = text.split(/\r?\n/).filter((line) => /^\s*#+/.test(line) && token.test(line));
  assert.equal(headings.length, 1, `Expected exactly one heading for version ${version}`);
  const prefix = `## [${version}] - `;
  const heading = headings[0];
  assert.ok(heading.startsWith(prefix), `Malformed heading for version ${version}`);
  const status = heading.slice(prefix.length);
  if (status !== 'unreleased') {
    assert.match(status, /^\d{4}-\d{2}-\d{2}$/, 'Published versions require an ISO release date');
    const date = new Date(`${status}T00:00:00.000Z`);
    assert.equal(Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10), status,
      'Published versions require a valid calendar date');
    return;
  }
  const tagWorkflow = parse(autoTagSource);
  const desktopWorkflow = parse(desktopSource);
  assert.equal(tagWorkflow?.jobs?.['auto-tag']?.if,
    "false && vars.DESKTOP_RELEASE_ENABLED == 'true'", 'Unreleased requires the auto-tag source pause');
  assert.equal(desktopWorkflow?.jobs?.['release-context']?.if,
    "(false && vars.DESKTOP_RELEASE_ENABLED == 'true') || (github.event_name == 'workflow_dispatch' && inputs.publish_mode == 'build')",
    'Unreleased requires the release-context source pause');
  assert.equal(desktopWorkflow?.jobs?.['publish-release']?.if,
    "false && vars.DESKTOP_RELEASE_ENABLED == 'true' && needs.release-context.outputs.publish == 'true'",
    'Unreleased requires the publish-release source pause');
}

const fixture = {
  version: '2.25.148',
  text: '## [2.25.148] - unreleased\n\nSource preparation only.\n',
  autoTagSource: `jobs:
  auto-tag:
    if: false && vars.DESKTOP_RELEASE_ENABLED == 'true'
`,
  desktopSource: `jobs:
  release-context:
    if: (false && vars.DESKTOP_RELEASE_ENABLED == 'true') || (github.event_name == 'workflow_dispatch' && inputs.publish_mode == 'build')
  publish-release:
    if: false && vars.DESKTOP_RELEASE_ENABLED == 'true' && needs.release-context.outputs.publish == 'true'
`,
};

test('changelog has one dated current version or a source-paused unreleased version', () => {
  assertCurrentVersionHeading({ version: packageJson.version, text: changelog, autoTagSource: autoTag, desktopSource: desktop });
});

test('exact current version may remain unreleased while all source pauses hold', () => {
  assertCurrentVersionHeading(fixture);
  assertCurrentVersionHeading({ ...fixture, text: `## [Unreleased]\n\n${fixture.text}\n## [2.25.147] - 2026-10-01\n` });
});

for (const [name, patch, message] of [
  ['auto-tag', { autoTagSource: fixture.autoTagSource.replace('false && ', '') }, /auto-tag source pause/],
  ['release-context', { desktopSource: fixture.desktopSource.replace('(false && ', '(') }, /release-context source pause/],
  ['publish-release', { desktopSource: fixture.desktopSource.replace('if: false && ', 'if: ') }, /publish-release source pause/],
  ['absent auto-tag job', { autoTagSource: 'jobs: {}' }, /auto-tag source pause/],
  ['absent context job', { desktopSource: fixture.desktopSource.replace('release-context:', 'unused-context:') }, /release-context source pause/],
  ['absent publisher job', { desktopSource: fixture.desktopSource.replace('publish-release:', 'unused-publisher:') }, /publish-release source pause/],
  ['comment-only pause', { autoTagSource: fixture.autoTagSource.replace('if: false && ', '# false &&\n    if: ') }, /auto-tag source pause/],
  ['trailing bypass', { autoTagSource: fixture.autoTagSource.replace("== 'true'", "== 'true' || true") }, /auto-tag source pause/],
  ['string false', { autoTagSource: fixture.autoTagSource.replace("if: false && vars.DESKTOP_RELEASE_ENABLED == 'true'", "if: \"'false' && vars.DESKTOP_RELEASE_ENABLED == 'true'\"") }, /auto-tag source pause/],
]) {
  test(`unreleased fails closed without ${name}`, () => {
    assert.throws(() => assertCurrentVersionHeading({ ...fixture, ...patch }), message);
  });
}

test('duplicate YAML keys do not hide an enabled release job', () => {
  assert.throws(() => assertCurrentVersionHeading({ ...fixture,
    autoTagSource: `${fixture.autoTagSource}  auto-tag:\n    if: true\n`,
  }), /unique/);
});

for (const [name, text] of [
  ['missing entry', '## [Unreleased]\n'],
  ['other unreleased version', '## [2.25.149] - unreleased\n'],
  ['prefix match', '## [2.25.1480] - unreleased\n'],
  ['unescaped version', '## [2x25x148] - unreleased\n'],
  ['duplicate unreleased', fixture.text.repeat(2)],
  ['dated and unreleased', `${fixture.text}## [2.25.148] - 2026-11-10\n`],
  ['duplicate dates', '## [2.25.148] - 2026-11-10\n## [2.25.148] - 2026-11-09\n'],
  ['malformed duplicate', `${fixture.text}## 2.25.148 - unreleased\n`],
  ['wrong heading depth', '### [2.25.148] - unreleased\n'],
  ['missing brackets', '## 2.25.148 - unreleased\n'],
  ['wrong delimiters', '## (2.25.148) - unreleased\n'],
  ['prerelease suffix', '## [2.25.148-rc.1] - unreleased\n'],
  ['missing status', '## [2.25.148]\n'],
  ['capitalized status', '## [2.25.148] - Unreleased\n'],
  ['trailing annotation', '## [2.25.148] - unreleased (draft)\n'],
  ['malformed date', '## [2.25.148] - 2026-1-2\n'],
  ['impossible date', '## [2.25.148] - 2026-02-30\n'],
  ['invalid date', '## [2.25.148] - 2026-13-01\n'],
]) {
  test(`current-version heading rejects ${name}`, () => {
    assert.throws(() => assertCurrentVersionHeading({ ...fixture, text }));
  });
}

test('published version requires a date even when release workflows are enabled', () => {
  const enabled = { autoTagSource: 'jobs: {}', desktopSource: 'jobs: {}' };
  assertCurrentVersionHeading({ ...fixture, ...enabled, text: '## [2.25.148] - 2026-11-10\n' });
  assertCurrentVersionHeading({ ...fixture, ...enabled, text: '## [2.25.148] - 2024-02-29\n' });
  assert.throws(() => assertCurrentVersionHeading({ ...fixture, ...enabled }), /source pause/);
  assert.throws(() => assertCurrentVersionHeading({ ...fixture, ...enabled, text: '## [2.25.148] - pending\n' }), /ISO release date/);
});

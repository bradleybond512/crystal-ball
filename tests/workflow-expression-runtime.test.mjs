import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');

function stepFrom(name) {
  for (const file of ['auto-tag', 'build-desktop']) {
    const workflow = parse(readFileSync(path.join(root, `.github/workflows/${file}.yml`), 'utf8'));
    for (const job of Object.values(workflow.jobs)) {
      const step = job.steps.find((candidate) => candidate.name === name);
      if (step) return step;
    }
  }
  throw new Error(`Missing workflow step ${name}`);
}

function executeStep(t, name, { hostile = false, releaseExists = false, publicRelease = false, draftReadFailure = false, expectedStatus = 0, values: overrides = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'workflow-expression-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const marker = path.join(dir, 'must-not-exist');
  const suffix = hostile ? ` "quoted" $(touch ${marker}) \`touch ${marker}\` tail` : '';
  const values = {
    'steps.version.outputs.version': '1.2.3' + suffix,
    'steps.version.outputs.tag': 'v1.2.3' + suffix,
    'needs.release-context.outputs.version': '1.2.3' + suffix,
    'needs.release-context.outputs.variant': 'full' + suffix,
    'needs.release-context.outputs.tag': 'v1.2.3' + suffix,
    'needs.release-context.outputs.commit_sha': 'a'.repeat(40) + suffix,
    'needs.release-context.outputs.short_sha': 'a'.repeat(8) + suffix,
    'needs.release-context.outputs.release_name': 'Crystal Ball v1.2.3' + suffix,
    'matrix.label': 'Linux-x64',
    'secrets.GITHUB_TOKEN': 'fixture-gh-token',
    'needs.release-context.outputs.publish': 'true',
    'secrets.APPLE_CERTIFICATE': '',
    'secrets.APPLE_CERTIFICATE_PASSWORD': '',
    'secrets.KEYCHAIN_PASSWORD': '',
    'secrets.APPLE_ID': '',
    'secrets.APPLE_PASSWORD': '',
    'secrets.APPLE_TEAM_ID': '',
    ...overrides,
  };
  const step = stepFrom(name);
  const render = (text) => text.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    assert.ok(key in values, `fixture must resolve ${key}`);
    return values[key];
  });
  const calls = path.join(dir, 'calls.jsonl');
  writeFileSync(calls, '');
  const record = `const fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({tool:require('node:path').basename(process.argv[1]),args})+'\\n');\n`;
  const tool = (name, body) => writeFileSync(path.join(bin, name), `#!${process.execPath}\n${record}${body}`, { mode: 0o755 });
  tool('git', 'process.exit(1);');
  tool('gh', `if(args[0]==='release'&&args[1]==='view'){if(args.includes('--json')){process.stdout.write('${publicRelease ? 'false' : 'true'}');if(${draftReadFailure})process.exit(1);}process.exit(${releaseExists ? 0 : 1});}`);
  tool('node', '');
  const asset = 'downloaded-bundles/fixture/assets/asset with spaces.dmg';
  mkdirSync(path.dirname(path.join(dir, asset)), { recursive: true });
  writeFileSync(path.join(dir, asset), 'fixture');
  writeFileSync(path.join(dir, 'release-manifest.json'), '{}');
  const env = {
    PATH: `${bin}:/usr/bin:/bin`, GITHUB_ENV: path.join(dir, 'environment'), GITHUB_OUTPUT: path.join(dir, 'outputs'), GITHUB_REPOSITORY: 'example/project',
    WM_BUILD_TIMESTAMP: '2026-10-13T00:00:00Z',
    ...Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, render(String(value))])),
  };
  // macOS ships Bash 3. This fixture supports only the unchanged Linux
  // workflow's fixed mapfile invocation; argument expansion stays real Bash.
  const compatibility = `if ! type mapfile >/dev/null 2>&1; then
    mapfile() {
      [ "$1" = "-t" ] && [ "$2" = "ASSET_FILES" ] || return 99
      ASSET_FILES=()
      while IFS= read -r fixture_asset; do ASSET_FILES+=("$fixture_asset"); done
    }
  fi
`;
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', compatibility + render(step.run)], {
    cwd: dir, env, encoding: 'utf8',
  });
  assert.equal(result.status, expectedStatus, result.stderr);
  assert.equal(existsSync(marker), false, 'workflow values are literal data, never shell evaluation');
  return { result, environment: existsSync(env.GITHUB_ENV) ? readFileSync(env.GITHUB_ENV, 'utf8') : '', outputs: existsSync(env.GITHUB_OUTPUT) ? readFileSync(env.GITHUB_OUTPUT, 'utf8') : '', events: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse), values, asset };
}

const names = ['Check if tag already exists', 'Check if release already published', 'Dispatch build-desktop.yml in publish mode', 'Collect release manifest', 'Create or update GitHub release', 'Upload release assets and manifest', 'Verify uploaded release payload'];

for (const name of names) {
  for (const hostile of [false, true]) {
    test(`${name} preserves ${hostile ? 'quotes, command substitutions and backticks' : 'nominal release arguments'}`, (t) => {
      const { events, values, asset } = executeStep(t, name, { hostile, releaseExists: name === names[5] });
      const tag = values['steps.version.outputs.tag'];
      if (name === names[0]) assert.deepEqual(events[0].args, ['rev-parse', tag]);
      if (name === names[1]) assert.deepEqual(events[0].args, ['release', 'view', tag, '--repo', 'example/project']);
      if (name === names[2]) assert.deepEqual(events[0].args, ['workflow', 'run', 'build-desktop.yml', '--repo', 'example/project', '--ref', 'main', '-f', 'variant=full', '-f', 'publish_mode=publish', '-f', `release_tag=${tag}`]);
      if (name === names[3]) {
        const args = events[0].args;
        for (const [flag, field] of [['--version', 'version'], ['--variant', 'variant'], ['--tag', 'tag'], ['--commit-sha', 'commit_sha']]) {
          assert.equal(args[args.indexOf(flag) + 1], values[`needs.release-context.outputs.${field}`]);
        }
        assert.ok(args.includes('collect'));
        assert.equal(events.length, 2, 'manifest collection and existing asset-copy child retained');
      }
      if (name === names[4]) assert.deepEqual(events[1].args, ['release', 'create', tag, '--title', values['needs.release-context.outputs.release_name'], '--notes', 'See changelog below.', '--verify-tag', '--draft']);
      if (name === names[5]) assert.deepEqual(events[1].args, ['release', 'upload', tag, asset, 'release-manifest.json', '--clobber']);
      if (name === names[6]) {
        assert.deepEqual(events[0].args, ['release', 'download', tag, '--dir', 'downloaded-release']);
        assert.deepEqual(events[1].args, ['scripts/release-manifest.mjs', '--mode', 'verify', '--output', 'release-manifest.json', '--download-dir', 'downloaded-release']);
      }
    });
  }
}

test('existing release edit branch retains quoted title and tag arguments', (t) => {
  const { events, values } = executeStep(t, 'Create or update GitHub release', { hostile: true, releaseExists: true });
  assert.deepEqual(events[2].args, ['release', 'edit', values['needs.release-context.outputs.tag'], '--title', values['needs.release-context.outputs.release_name']]);
});


for (const name of ['Create or update GitHub release', 'Upload release assets and manifest', 'Generate and update release notes']) {
  test(`${name} refuses to mutate an existing public release`, (t) => {
    const { events } = executeStep(t, name, { releaseExists: true, publicRelease: true, expectedStatus: 1 });
    assert.ok(events.every((event) => event.tool === 'gh' && event.args[0] === 'release' && event.args[1] === 'view'));
  });
}

for (const name of ['Create or update GitHub release', 'Upload release assets and manifest', 'Generate and update release notes']) {
  test(`${name} refuses mutation after a failed draft-state read even with true output`, (t) => {
    const { events, result } = executeStep(t, name, { releaseExists: true, draftReadFailure: true, expectedStatus: 1 });
    assert.match(result.stdout + result.stderr, /Could not verify draft release state/);
    assert.ok(events.every((event) => event.tool === 'gh' && event.args[0] === 'release' && event.args[1] === 'view'));
  });
}

for (const name of ['Upload release assets and manifest', 'Generate and update release notes']) {
  test(`${name} refuses mutation when the release disappeared`, (t) => {
    const { events } = executeStep(t, name, { expectedStatus: 1 });
    assert.ok(events.every((event) => event.tool === 'gh' && event.args[0] === 'release' && event.args[1] === 'view'));
  });
}

const credentialGroups = [
  ['Check Apple signing secrets', ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'KEYCHAIN_PASSWORD']],
  ['Configure Apple notarization credentials', ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']],
];
for (const [name, keys] of credentialGroups) {
  for (const missing of [null, ...keys]) {
    test(`${name} blocks publish with ${missing ?? 'all credentials'} missing`, (t) => {
      const values = Object.fromEntries(keys.map((key) => [`secrets.${key}`, missing === null || missing === key ? '' : 'synthetic-fixture-value']));
      const { result, events, environment } = executeStep(t, name, { values, expectedStatus: 1 });
      assert.match(result.stdout + result.stderr, /::error::/);
      assert.deepEqual(events, [], 'missing credentials stop before external commands');
      assert.equal(environment, '', 'no ad-hoc identity or partial notarization credentials escape on publish failure');
    });
  }
  test(`${name} accepts complete credentials as literal data`, (t) => {
    const values = Object.fromEntries(keys.map((key) => [`secrets.${key}`, 'synthetic "quotes" $(false) `false`']));
    const { events, outputs } = executeStep(t, name, { values });
    assert.deepEqual(events, []);
    assert.match(outputs, /available=true/);
  });
  test(`${name} preserves build-only behavior without credentials`, (t) => {
    const { result, environment } = executeStep(t, name, { values: { 'needs.release-context.outputs.publish': 'false' } });
    assert.doesNotMatch(result.stdout + result.stderr, /::error::/);
    if (name === 'Check Apple signing secrets') assert.match(environment, /APPLE_SIGNING_IDENTITY=-/);
  });
}

test('notarization secrets reach only the actual build through env, never shell text or GITHUB_ENV', () => {
  const check = stepFrom('Configure Apple notarization credentials');
  const build = stepFrom('Build Tauri app');
  for (const key of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']) {
    assert.equal(build.env[key], `\${{ steps.apple-notarization.outputs.available == 'true' && secrets.${key} || '' }}`);
    assert.equal(check.env[key], `\${{ secrets.${key} }}`);
  }
  assert.doesNotMatch(check.run, /GITHUB_ENV|\$\{\{/);
  assert.doesNotMatch(stepFrom('Check Apple signing secrets').run, /\$\{\{/);
});

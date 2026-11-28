import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validReceipt } from './fixtures/native-ci/receipts.mjs';
import test from 'node:test';
import { parse } from 'yaml';

const raw = readFileSync(new URL('../.github/workflows/native-tests.yml', import.meta.url), 'utf8');
const workflow = parse(raw);

test('native coverage runs unprivileged on the two approved hosted platforms within 95 minutes', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['merge_group', 'pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ['native', 'report']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const native = workflow.jobs.native, report = workflow.jobs.report;
  assert.equal(native.if, undefined, 'fork PRs retain coverage');
  assert.equal(native['runs-on'], '${{ matrix.os }}');
  assert.deepEqual(native.strategy.matrix.include, [
    { os: 'ubuntu-24.04', platform: 'linux-x64' },
    { os: 'macos-15', platform: 'darwin-arm64' },
  ]);
  assert.equal(native.strategy['fail-fast'], false);
  assert.equal(native.strategy['max-parallel'], 2);
  assert.equal(native['timeout-minutes'], 45);
  assert.equal(report['timeout-minutes'], 5);
  assert.equal(2 * native['timeout-minutes'] + report['timeout-minutes'], 95);
  assert.ok([report.needs].flat().includes('native'));
  assert.equal(report.if, 'always()');
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['continue-on-error'], undefined);
    assert.equal(job.permissions, undefined);
    for (const step of job.steps) {
      assert.equal(step['continue-on-error'], undefined);
      if (step.uses) assert.match(step.uses, /^[^@]+@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with?.['persist-credentials'], false);
      if (step.uses?.startsWith('actions/setup-node@')) {
        assert.equal(String(step.with['node-version']), '22');
        assert.equal(step.with['package-manager-cache'], false);
        assert.equal(step.with.cache, undefined);
      }
    }
  }
  assert.doesNotMatch(raw, /secrets\.|id-token:|self-hosted|pull_request_target|schedule:|continue-on-error:|actions\/cache@|rust-cache@/);
});

test('native and reporting evidence is retained even when a platform fails', () => {
  const native = workflow.jobs.native;
  const upload = native.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(upload);
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with['retention-days'], 7);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.match(upload.with.name, /matrix\.platform/);
  const report = workflow.jobs.report;
  assert.ok(report.steps.some(step => step.uses?.startsWith('actions/download-artifact@')));
  const reporting = report.steps.filter(step => step.run).map(step => step.run).join('\n');
  assert.match(reporting, /native-test-driver\.mjs/);
  assert.ok(report.steps.some(step => Object.values(step.env ?? {}).some(value => String(value).includes('needs.native.result'))), 'aggregate must also inspect the matrix job result');
  assert.ok(native.steps.some(step => step.run?.includes('native-test-driver.mjs')), 'native evidence comes from the fixed-target driver');
});

test('native and build-policy changes trigger the dedicated workflow', () => {
  const paths = workflow.on.pull_request.paths;
  for (const required of ['src-tauri/**', 'scripts/native-test-driver.mjs', 'scripts/native-test-inventory.json', '.github/workflows/native-tests.yml', 'package.json', 'package-lock.json']) {
    assert.ok(paths.includes(required), required);
  }
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.deepEqual(workflow.on.push.paths, paths);
});

test('actual report shell rejects stale, missing, malformed or failed platform evidence', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'native report fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reportStep = workflow.jobs.report.steps.find(step => step.run?.includes('native-test-driver.mjs'));
  const sourceSha = 'a'.repeat(40), platforms = ['linux-x64', 'darwin-arm64'];
  const run = (receipts, result = 'success', expectedSha = sourceSha, alter = () => {}) => {
    const artifactDir = path.join(dir, 'receipts');
    rmSync(artifactDir, { recursive: true, force: true }); mkdirSync(artifactDir);
    receipts.forEach((receipt, i) => {
      const entry = path.join(artifactDir, `native-${i}`); mkdirSync(entry);
      writeFileSync(path.join(entry, 'receipt.json'), typeof receipt === 'string' ? receipt : JSON.stringify(receipt));
    });
    alter(artifactDir);
    return spawnSync('/bin/bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', reportStep.run], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 5000,
      env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', RECEIPT_DIR: artifactDir,
        NATIVE_RESULT: result, EXPECTED_SOURCE_SHA: expectedSha },
    });
  };
  const good = platforms.map(platform => validReceipt(platform, sourceSha));
  const baseline = run(good);
  assert.equal(baseline.status, 0, baseline.stderr);
  assert.equal(JSON.parse(baseline.stdout.trim()).passed, true);
  for (const alter of [
    artifactDir => {
      const outside = path.join(dir, 'outside-receipt.json'); writeFileSync(outside, JSON.stringify(good[0]));
      const file = path.join(artifactDir, 'native-0/receipt.json'); rmSync(file); symlinkSync(outside, file);
    },
    artifactDir => writeFileSync(path.join(artifactDir, 'native-0/receipt.json'), JSON.stringify({ ...good[0], padding: 'x'.repeat(2 * 1024 * 1024) })),
  ]) {
    const actual = run(good, 'success', sourceSha, alter);
    assert.equal(actual.error, undefined); assert.notEqual(actual.status, 0, 'unsafe receipt must fail');
  }
  for (const [receipts, result, expectedSha] of [
    [[], 'success', sourceSha], [[good[0]], 'success', sourceSha],
    [[good[0], good[0]], 'success', sourceSha], [[good[0], '{broken'], 'success', sourceSha],
    [good, 'failure', sourceSha], [good, 'cancelled', sourceSha], [good, 'skipped', sourceSha],
    [good, 'success', 'c'.repeat(40)], [good, 'success', ''],
  ]) {
    const actual = run(receipts, result, expectedSha);
    assert.equal(actual.error, undefined);
    assert.notEqual(actual.status, 0, JSON.stringify({ result, expectedSha, receipts }));
  }
});

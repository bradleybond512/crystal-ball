import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as driver from '../scripts/native-test-driver.mjs';
import { controlDefinitions, validReceipt } from './fixtures/native-ci/receipts.mjs';

const platforms = ['linux-x64', 'darwin-arm64'];

test('aggregate requires all three independently identified mutation controls and exact evidence', () => {
  const good = platforms.map(platform => validReceipt(platform));
  assert.equal(driver.aggregateReceipts(platforms, good).passed, true);
  const valid = good[1].stages.find(stage => stage.id === 'mutation').controls;
  const variants = [undefined, [], valid.slice(1), [...valid, valid[0]], [valid[0], valid[0], valid[2]], [...valid, { ...valid[0], id: 'unknown' }],
    valid.map((control, i) => i === 1 ? { ...control, id: 'unknown' } : control)];
  for (const change of [
    { source: 'src-tauri/tests/watchdog_contract.rs' }, { target: 'watchdog_contract' },
    { appliedDiff: false }, { detectedFailure: false }, { restored: false },
    { originalHash: 'invalid' }, { originalHash: 'invalid', restoredHash: 'invalid' }, { mutatedHash: valid[1].originalHash }, { restoredHash: 'e'.repeat(64) },
    { failureNames: [] }, { failureNames: ['main_focus_tracks_gain_and_loss'] },
    { counts: { ...valid[1].counts, tests: 0, passed: 0 } },
    { counts: { ...valid[1].counts, filtered: 1 } },
    { redCounts: { ...valid[1].redCounts, failed: 0 } },
    { redCounts: { ...valid[1].redCounts, ignored: 1 } },
  ]) variants.push(valid.map((control, i) => i === 1 ? { ...control, ...change } : control));
  for (const controls of variants) {
    const changed = structuredClone(good);
    changed[1].stages.find(stage => stage.id === 'mutation').controls = controls;
    assert.equal(driver.aggregateReceipts(platforms, changed).passed, false, JSON.stringify(controls));
  }
});

test('fixed production mutation specifications change the intended rejection guards once', () => {
  for (const control of controlDefinitions) {
    const original = readFileSync(new URL('../' + control.source, import.meta.url), 'utf8');
    const mutated = driver.prepareControlMutation(control.id, original);
    assert.notEqual(mutated, original);
    assert.throws(() => driver.prepareControlMutation(control.id, ''), /unique|missing/i);
    assert.throws(() => driver.prepareControlMutation(control.id, original + original), /unique/i);
    if (control.id === 'crypto-nonce-rejection') {
      assert.match(mutated, /let mut env: ShadowEnvelope/);
      assert.match(mutated, /env\.n\.resize\(12, 0\)/);
      assert.doesNotMatch(mutated, /env\.v != 2 \|\| env\.n\.len\(\) != 12/);
    }
    if (control.id === 'crypto-auth-rejection') assert.match(mutated, /decrypt\(&nonce, env\.c\.as_ref\(\)\)\.unwrap_or_default\(\)/);
  }
  assert.throws(() => driver.prepareControlMutation('unknown', 'anything'));
});

test('crypto red validator requires complete case execution and only fixed expected failures', () => {
  const control = controlDefinitions[2];
  const expected = driver.inventory.targets.find(target => target.name === 'crystalball').tests;
  const failed = control.failureNames.length;
  const stdout = `running ${expected.length} tests\n` + expected.map(name => `test ${name} ... ${control.failureNames.includes(name) ? 'FAILED' : 'ok'}`).join('\n') + `\n\ntest result: FAILED. ${expected.length - failed} passed; ${failed} failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.1s\n`;
  const result = { status: 'failed', exitCode: 101, stdout, failure: null };
  assert.equal(driver.validateMutationFailure(result, expected, control.failureNames).failed, failed);
  for (const changed of [
    { ...result, status: 'passed', exitCode: 0 }, { ...result, failure: 'output_limit' },
    { ...result, status: 'timed_out' }, { ...result, stdout: stdout.replace('0 filtered out', '1 filtered out') },
    { ...result, stdout: stdout.replace(`${control.failureNames[0]} ... FAILED`, `${control.failureNames[0]} ... ok`) },
    { ...result, stdout: stdout.replace(`${expected[0]} ... ok`, `${expected[0]} ... FAILED`) },
  ]) assert.throws(() => driver.validateMutationFailure(changed, expected, control.failureNames));
});

test('hosted orchestration source keeps full harness runs, bounded stages and unconditional restoration', () => {
  const source = readFileSync(new URL('../scripts/native-test-driver.mjs', import.meta.url), 'utf8');
  const mutation = source.slice(source.indexOf("  await stage('mutation', 'control', async () => {"), source.indexOf('  if (receipt.stages.some'));
  assert.match(mutation, /for \(const spec of mutationControls\)/);
  assert.match(mutation, /receipt\.stages\.find\(s => s\.id === `test:\$\{spec\.target\}`\)\?\.status === 'passed'/);
  assert.match(mutation, /const names = \[\.\.\.target\.tests, \.\.\.\(platform === 'darwin-arm64' \? target\.darwinOnly : \[\]\)\]/);
  assert.match(mutation, /`--\$\{target\.kind\}`, target\.name, '--no-run', '--message-format=json'/);
  assert.equal((mutation.match(/compileArgs, 5 \* 60_000/g) ?? []).length, 2);
  assert.equal((mutation.match(/\['--test-threads=1'\], 120_000, testEnv/g) ?? []).length, 2);
  assert.match(mutation, /const temp = path\.join\(state, `mutation-\$\{spec\.id\}`\)/);
  assert.match(mutation, /TMPDIR: temp, TMP: temp, TEMP: temp/);
  assert.match(mutation, /redCounts = validateMutationFailure\(result, names, spec\.failureNames\)/);
  assert.match(mutation, /finally \{\s*writeFileSync\(filename, original\);\s*requireThat\(hash\(readFileSync\(filename\)\) === originalHash,[\s\S]*?command\(`\$\{spec\.id\}-restored`, 'git', \['status', '--porcelain'\]\)[\s\S]*?validateLock\(readFileSync\(lockFile\), receipt\.lockHash\);\s*\}/);
  assert.match(mutation, /const counts = parseTestResult\(passed\(await command\(`\$\{spec\.id\}-green`/);
  assert.match(mutation, /controls\.push\(\{ \.\.\.spec,[^\n]+originalHash, mutatedHash, restoredHash: hash\(readFileSync\(filename\)\), redCounts, counts \}\)/);
  assert.match(source, /const deadline = Date\.now\(\) \+ 43 \* 60_000/);
  assert.match(source, /timeoutMs: Math\.min\(timeoutMs, remaining\)/);
});

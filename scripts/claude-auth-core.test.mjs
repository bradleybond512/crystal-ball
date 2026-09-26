import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClaudeAuthReport,
  isConfigScratchFile,
  statusFromFindings,
} from './claude-auth-core.mjs';

// Full stat modes as lstat returns them: file-type bits plus permissions.
const FILE_600 = 0o10_0600;
const FILE_640 = 0o10_0640;
const DIR_700 = 0o4_0700;

function healthyProbe(overrides = {}) {
  return {
    platform: 'linux',
    uid: 501,
    gid: 20,
    home: '/home/ada',
    configPath: '/home/ada/.claude.json',
    config: {
      exists: true,
      path: '/home/ada/.claude.json',
      realPath: '/home/ada/.claude.json',
      uid: 501,
      mode: FILE_600,
      size: 4096,
      writable: true,
      hasOAuthAccount: true,
    },
    claudeDir: {
      exists: true,
      path: '/home/ada/.claude',
      realPath: '/home/ada/.claude',
      uid: 501,
      mode: DIR_700,
    },
    credentialsFile: { exists: true, uid: 501, mode: FILE_600, size: 512 },
    strayFiles: [],
    diskFreeBytes: 50 * 1024 * 1024 * 1024,
    env: {},
    envSources: [],
    installs: [{ path: '/usr/local/bin/claude', realPath: '/usr/local/bin/claude' }],
    ...overrides,
  };
}

function ids(report) {
  return report.findings.map((f) => f.id);
}

test('a healthy linux probe reports no findings', () => {
  const report = buildClaudeAuthReport(healthyProbe());
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.findings, []);
});

test('foreign ownership of the config is a blocker', () => {
  const probe = healthyProbe();
  probe.config.uid = 0;
  const report = buildClaudeAuthReport(probe);
  assert.equal(report.status, 'red');
  assert.ok(ids(report).includes('config-foreign-owner'));
  assert.match(report.findings[0].fix, /Inspect/);
});

test('foreign ownership of ~/.claude is a blocker', () => {
  const probe = healthyProbe();
  probe.claudeDir.uid = 0;
  assert.ok(ids(buildClaudeAuthReport(probe)).includes('claudeDir-foreign-owner'));
});

test('a config synced into iCloud Drive is a blocker', () => {
  const probe = healthyProbe();
  probe.config.realPath = '/home/ada/Library/Mobile Documents/com~apple~CloudDocs/.claude.json';
  const report = buildClaudeAuthReport(probe);
  assert.equal(report.status, 'red');
  const cloud = report.findings.find((f) => f.id === 'config-cloud-synced');
  assert.match(cloud.title, /iCloud Drive/);
});

test('an unreadable config is reported once, not cascaded', () => {
  const probe = healthyProbe();
  probe.config.parseError = true;
  const report = buildClaudeAuthReport(probe);
  assert.deepEqual(ids(report), ['config-corrupt']);
});

test('a zero-byte config outranks a parse error', () => {
  const probe = healthyProbe();
  probe.config.size = 0;
  assert.deepEqual(ids(buildClaudeAuthReport(probe)), ['config-empty']);
});

test('a read-only config is a blocker', () => {
  const probe = healthyProbe();
  probe.config.writable = false;
  assert.ok(ids(buildClaudeAuthReport(probe)).includes('config-readonly'));
});

test('a missing account block warns without blocking', () => {
  const probe = healthyProbe();
  probe.config.hasOAuthAccount = false;
  const report = buildClaudeAuthReport(probe);
  assert.equal(report.status, 'yellow');
  assert.ok(ids(report).includes('config-no-account'));
});

test('group-readable credentials are a blocker', () => {
  const probe = healthyProbe();
  probe.credentialsFile.mode = FILE_640;
  const report = buildClaudeAuthReport(probe);
  assert.equal(report.status, 'red');
  assert.ok(ids(report).includes('credentials-permissive'));
});

test('missing credentials are a blocker off macOS', () => {
  const probe = healthyProbe({ credentialsFile: { exists: false } });
  assert.ok(ids(buildClaudeAuthReport(probe)).includes('credentials-missing'));
});

test('macOS is told to check the keychain by hand and is never probed', () => {
  const probe = healthyProbe({ platform: 'darwin', credentialsFile: { exists: false } });
  const report = buildClaudeAuthReport(probe);
  const ledger = ids(report);
  assert.ok(ledger.includes('keychain-manual-check'));
  assert.ok(!ledger.includes('credentials-missing'));
  assert.doesNotMatch(JSON.stringify(report), /security (find|add|delete)-generic-password/);
});

test('a nearly full home volume is a blocker', () => {
  const report = buildClaudeAuthReport(healthyProbe({ diskFreeBytes: 12 * 1024 * 1024 }));
  assert.equal(report.status, 'red');
  assert.match(report.findings[0].title, /12 MB free/);
});

test('overriding auth env vars are reported with their source line', () => {
  const probe = healthyProbe({
    env: { ANTHROPIC_API_KEY: true },
    envSources: [{ file: '.zshrc', line: 42, variable: 'ANTHROPIC_API_KEY' }],
  });
  const report = buildClaudeAuthReport(probe);
  const env = report.findings.find((f) => f.id === 'env-ANTHROPIC_API_KEY');
  assert.match(env.detail, /\.zshrc:42/);
});

test('an env var with no discoverable source still reports', () => {
  const probe = healthyProbe({ env: { CLAUDE_CODE_OAUTH_TOKEN: true } });
  const report = buildClaudeAuthReport(probe);
  const env = report.findings.find((f) => f.id === 'env-CLAUDE_CODE_OAUTH_TOKEN');
  assert.match(env.detail, /Source not found/);
});

test('duplicate installs warn', () => {
  const probe = healthyProbe({
    installs: [
      { path: '/opt/homebrew/bin/claude', realPath: '/opt/homebrew/bin/claude' },
      { path: '/Users/ada/.local/bin/claude', realPath: '/Users/ada/.local/bin/claude' },
    ],
  });
  assert.ok(ids(buildClaudeAuthReport(probe)).includes('multiple-installs'));
});

test('scratch files are observations with no automatic repair metadata', () => {
  const report = buildClaudeAuthReport(healthyProbe({ strayFiles: ['.claude.json.tmp1', '.claude.json.lock'] }));
  const item = report.findings.find((f) => f.id === 'config-stray-writes');
  assert.match(item.detail, /ownership and activity have not been assessed/);
  assert.doesNotMatch(JSON.stringify(report), /autoFix|safe to delete|concurrent CLI/i);
});

test('reports never prescribe unsupported credential or filesystem repairs', () => {
  const probe = healthyProbe({ platform: 'darwin', env: { ANTHROPIC_API_KEY: true }, strayFiles: ['.claude.json.lock'], installs: [{}, {}] });
  probe.config.uid = 0;
  probe.config.realPath = '/home/ada/Dropbox/.claude.json';
  const text = JSON.stringify(buildClaudeAuthReport(probe));
  assert.doesNotMatch(text, /chown|chmod|\bunset\b|delete|remove the|move the|fresh ACL|log in again/i);
});

test('read errors and parser details cannot leak into reports', () => {
  for (const key of ['readError', 'parseError']) {
    const probe = healthyProbe();
    probe.config[key] = 'SENSITIVE_SENTINEL';
    const report = buildClaudeAuthReport(probe);
    assert.equal(report.findings[0].id, key === 'readError' ? 'config-unreadable' : 'config-corrupt');
    assert.doesNotMatch(JSON.stringify(report), /SENSITIVE_SENTINEL/);
  }
});

test('a missing config short-circuits the remaining config rules', () => {
  const probe = healthyProbe({ config: { exists: false, path: '/home/ada/.claude.json' } });
  const report = buildClaudeAuthReport(probe);
  assert.ok(ids(report).includes('config-missing'));
  assert.ok(!ids(report).includes('config-readonly'));
});

test('findings sort blockers ahead of warnings', () => {
  const probe = healthyProbe({ env: { ANTHROPIC_API_KEY: true }, diskFreeBytes: 1024 });
  const severities = buildClaudeAuthReport(probe).findings.map((f) => f.severity);
  assert.deepEqual(severities, [...severities].sort((a, b) => (a === 'red' ? -1 : 1) - (b === 'red' ? -1 : 1)));
  assert.equal(severities[0], 'red');
});

test('statusFromFindings collapses an empty ledger to ok', () => {
  assert.equal(statusFromFindings([]), 'ok');
  assert.equal(statusFromFindings([{ severity: 'yellow' }]), 'yellow');
  assert.equal(statusFromFindings([{ severity: 'yellow' }, { severity: 'red' }]), 'red');
});

test('scratch filenames are recognized without an ownership or activity claim', () => {
  for (const name of ['.claude.json.tmp1234', '.claude.json.tmp-a.b', '.claude.json.lock', '.claude.json.swp']) {
    assert.equal(isConfigScratchFile(name), true, name);
  }
});

test('the live config and the credential store are never recognized as scratch', () => {
  for (const name of ['.claude.json', '.credentials.json', '.claude', 'claude.json.tmp1']) {
    assert.equal(isConfigScratchFile(name), false, name);
  }
});

test('a backup is not classified as scratch', () => {
  assert.equal(isConfigScratchFile('.claude.json.backup'), false);
});

test('scratch filename recognition rejects path separators', () => {
  for (const name of [
    '.claude.json.tmp/../../../etc/passwd',
    '../.claude.json.tmp1',
    '/root/.claude.json.lock',
    '.claude.json.tmp/nested',
  ]) {
    assert.equal(isConfigScratchFile(name), false, name);
  }
});

test('a non-string name is never recognized as scratch', () => {
  for (const value of [undefined, null, 42, {}, ['.claude.json.lock']]) {
    assert.equal(isConfigScratchFile(value), false);
  }
});

// R4-SEC-002 steps 4-5: dependency and CI-policy changes need Bradley's label;
// the gate runs from the base branch and never runs PR code; auto-merge skips
// those PRs; CI verifies registry signatures; Dependabot waits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  APPROVAL_LABEL,
  MAX_PR_FILES,
  SENSITIVE_PATTERNS,
  decide,
  listPullRequestFiles,
  sensitiveFiles,
} from '../scripts/dependency-change-policy.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('lockfiles, Cargo manifests, .npmrc, workflows and the gates are sensitive; ordinary code is not', () => {
  const sensitive = [
    'package-lock.json', 'tools/mcp-server/package-lock.json', 'npm-shrinkwrap.json', '.npmrc', 'tools/mcp-server/.npmrc',
    'src-tauri/Cargo.lock', 'src-tauri/Cargo.toml', '.github/workflows/new.yml', '.github/dependabot.yml',
    '.github/CODEOWNERS', 'scripts/check-install-script-drift.mjs', 'scripts/check-dependency-age.mjs',
    'scripts/dependency-change-policy.mjs', './package-lock.json', String.raw`src-tauri\Cargo.lock`,
  ];
  assert.deepEqual(sensitiveFiles(sensitive).map((h) => h.path).length, sensitive.length);
  const ordinary = ['package.json', 'src/main.ts', 'docs/x.md', 'scripts/other.mjs', 'my-package-lock.json.md', '.github/pull_request_template.md', ''];
  assert.deepEqual(sensitiveFiles(ordinary), []);
});

test('the decision: clean passes, sensitive fails, the label approves', () => {
  assert.equal(decide(['src/a.ts'], []).code, 0);
  const blocked = decide(['src/a.ts', 'package-lock.json'], ['claude']);
  assert.equal(blocked.code, 1);
  assert.match(blocked.lines.join('\n'), /package-lock\.json \(npm lockfile\)/);
  assert.equal(decide(['package-lock.json'], [APPROVAL_LABEL]).code, 0);
});

test('PR files are listed across pages, renames count both names, and API errors throw', async () => {
  const page = (n, start = 0) => Array.from({ length: n }, (_, i) => ({ filename: `src/f${start + i}.ts` }));
  const pages = [page(100), [...page(2, 100), { filename: 'lib/new.lock', previous_filename: 'package-lock.json' }]];
  const seen = [];
  const files = await listPullRequestFiles({
    repo: 'o/r', pr: 7, token: 't',
    fetchImpl: async (url, init) => {
      seen.push(String(url));
      assert.equal(init.headers.Authorization, 'Bearer t');
      return new Response(JSON.stringify(pages[seen.length - 1]), { status: 200 });
    },
  });
  assert.equal(seen.length, 2);
  assert.match(seen[1], /\/repos\/o\/r\/pulls\/7\/files\?per_page=100&page=2$/);
  assert.ok(files.includes('package-lock.json'), 'a rename away from a lockfile still counts');
  assert.equal(decide(files, []).code, 1);
  await assert.rejects(listPullRequestFiles({ repo: 'o/r', pr: 7, token: 't', fetchImpl: async () => new Response('{}', { status: 403 }) }), /HTTP 403/);
});

test('a PR too large for GitHub to list is treated as sensitive', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ filename: `src/f${i}.ts` }));
  const files = await listPullRequestFiles({ repo: 'o/r', pr: 1, token: 't', fetchImpl: async () => new Response(JSON.stringify(full), { status: 200 }) });
  assert.ok(files.length > MAX_PR_FILES);
  assert.equal(decide(files, []).code, 1);
});

test('the gate workflow runs from the base branch, never checks out PR code, and is read-only', () => {
  const wf = read('.github/workflows/dependency-change-gate.yml');
  assert.match(wf, /^on:\n {2}pull_request_target:\n {4}types: \[opened, synchronize, reopened, labeled, unlabeled, ready_for_review\]/m);
  assert.doesNotMatch(wf, /pull_request\.head|head_ref|ref:\s/, 'never checks out the PR');
  assert.match(wf, /persist-credentials: false/);
  assert.match(wf, /^permissions:\n {2}contents: read\n {2}pull-requests: read\n\n/m);
  assert.doesNotMatch(wf, /: write/);
  assert.match(wf, /run: node scripts\/dependency-change-policy\.mjs --pr "\$PR_NUMBER"/);
  assert.match(wf, /^ {2}dependency-change-gate:\n {4}name: dependency-change-gate$/m);
});

test('auto-merge is skipped (and turned off) for sensitive PRs', () => {
  const wf = read('.github/workflows/auto-merge-agent-branches.yml');
  const policy = wf.indexOf('git diff --name-only origin/main...HEAD | node scripts/dependency-change-policy.mjs --stdin');
  const enable = wf.indexOf('- name: Enable GitHub auto-merge');
  assert.ok(policy > 0 && enable > policy, 'policy runs first');
  assert.match(wf.slice(enable, enable + 120), /if: steps\.policy\.outputs\.sensitive != 'true'/);
  assert.match(wf, /disablePullRequestAutoMerge/);
  // The branch name reaches the script through env, never pasted into its code.
  const off = wf.slice(wf.indexOf('- name: Turn auto-merge off for a sensitive PR'), enable);
  assert.match(off, /env:\n\s+BRANCH: \$\{\{ github\.ref_name \}\}/);
  assert.doesNotMatch(off.slice(off.indexOf('script: |')), /\$\{\{/, 'no expression inside the script');
});

test('CI verifies registry signatures and dependency age', () => {
  const audit = read('.github/workflows/security-audit.yml');
  assert.ok(audit.indexOf('run: npm audit signatures') > audit.indexOf('- run: npm ci'));
  const integrity = read('.github/workflows/release-integrity.yml');
  assert.match(integrity, /node scripts\/check-dependency-age\.mjs --base FETCH_HEAD/);
  assert.match(integrity, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
});

test('Dependabot waits 7 days (14 for majors) on every ecosystem', () => {
  const entries = read('.github/dependabot.yml').split(/\n {2}- package-ecosystem: /).slice(1);
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.match(entry, /\n {4}cooldown:\n {6}default-days: 7\n/, entry.split('\n')[0]);
    if (!entry.startsWith('"github-actions"')) assert.match(entry, /\n {6}semver-major-days: 14\n/, entry.split('\n')[0]);
  }
});

test('CODEOWNERS covers the dependency files and every gate script', () => {
  const owners = read('.github/CODEOWNERS');
  for (const line of ['/package-lock.json', '**/package-lock.json', '**/.npmrc', '/src-tauri/Cargo.toml', '/src-tauri/Cargo.lock', '/.github/dependabot.yml', '/.github/workflows/']) {
    assert.ok(owners.split('\n').some((l) => l.startsWith(`${line} `)), line);
  }
  for (const { re } of SENSITIVE_PATTERNS.filter((p) => p.why === 'supply-chain gate')) {
    const script = re.source.replaceAll('\\', '').replace(/^\^/, '').replace(/\$$/, '');
    assert.ok(owners.includes(`/${script} @bradleybond512`), script);
  }
});

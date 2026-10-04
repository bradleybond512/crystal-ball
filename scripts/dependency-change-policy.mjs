#!/usr/bin/env node
// Dependency change gate policy (R4-SEC-002 step 5).
//
// Which files bring third-party code or CI policy into the repo, and so need
// Bradley's explicit approval (the `dependency-change-approved` label) before
// a PR can merge. Lockfiles are the source of truth for what gets installed:
// a dependency change in package.json that is not in the lockfile fails
// `npm ci`, so package.json itself (often edited for test scripts) is not on
// the list.
//
// Used by:
//   - .github/workflows/dependency-change-gate.yml (pull_request_target: runs
//     the BASE branch's copy, lists the PR's files through the API);
//   - .github/workflows/auto-merge-agent-branches.yml (skips auto-merge).
//
// CLI: node scripts/dependency-change-policy.mjs --stdin   (paths on stdin)
//      node scripts/dependency-change-policy.mjs --pr <n>  (GitHub API; needs
//      GH_TOKEN and REPO; labels from PR_LABELS)
// Exit: 0 nothing sensitive or approved, 1 sensitive and unapproved, 2 error.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const APPROVAL_LABEL = 'dependency-change-approved';
export const MAX_PR_FILES = 3000; // GitHub's list-files limit

/** Sensitive paths, matched against repo-relative POSIX paths. */
export const SENSITIVE_PATTERNS = Object.freeze([
  { re: /(?:^|\/)package-lock\.json$/, why: 'npm lockfile' },
  { re: /(?:^|\/)npm-shrinkwrap\.json$/, why: 'npm lockfile' },
  { re: /(?:^|\/)\.npmrc$/, why: 'npm install policy' },
  { re: /(?:^|\/)Cargo\.lock$/, why: 'Cargo lockfile' },
  { re: /(?:^|\/)Cargo\.toml$/, why: 'Cargo manifest' },
  { re: /^\.github\/workflows\//, why: 'CI workflow' },
  { re: /^\.github\/dependabot\.ya?ml$/, why: 'Dependabot policy' },
  { re: /^\.github\/CODEOWNERS$/, why: 'code owners' },
  { re: /^\.github\/tools\//, why: 'CI tool pins' },
  { re: /^\.github\/mcp\.json$/, why: 'agent MCP server pins' },
  { re: /^scripts\/check-install-script-drift\.mjs$/, why: 'supply-chain gate' },
  { re: /^scripts\/check-dependency-age\.mjs$/, why: 'supply-chain gate' },
  { re: /^scripts\/dependency-change-policy\.mjs$/, why: 'supply-chain gate' },
]);

/** The sensitive files in a change set, with the reason for each. */
export function sensitiveFiles(paths) {
  const hits = [];
  for (const raw of paths) {
    const path = String(raw).trim().replaceAll('\\', '/').replace(/^\.\//, '');
    if (!path) continue;
    const match = SENSITIVE_PATTERNS.find(({ re }) => re.test(path));
    if (match) hits.push({ path, why: match.why });
  }
  return hits;
}

/** Decide: exit code plus the lines to print. */
export function decide(paths, labels) {
  const hits = sensitiveFiles(paths);
  if (hits.length === 0) return { code: 0, lines: ['[dependency-change-gate] OK — no dependency or CI-policy files changed.'] };
  const lines = hits.map((h) => `[dependency-change-gate] ${h.path} (${h.why})`);
  if (labels.includes(APPROVAL_LABEL)) {
    lines.push(`[dependency-change-gate] ${hits.length} sensitive file(s) approved by the "${APPROVAL_LABEL}" label.`);
    return { code: 0, lines };
  }
  lines.push(`[dependency-change-gate] ${hits.length} sensitive file(s) need Bradley's review. After reviewing, he applies "${APPROVAL_LABEL}".`);
  return { code: 1, lines };
}

/** Every file a PR changes (current and, for renames, previous names), via the REST API. */
export async function listPullRequestFiles({ repo, pr, token, fetchImpl = fetch }) {
  const files = [];
  const maxPages = Math.ceil(MAX_PR_FILES / 100);
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('unexpected GitHub API response');
    for (const file of batch) {
      if (typeof file?.filename === 'string') files.push(file.filename);
      if (typeof file?.previous_filename === 'string') files.push(file.previous_filename);
    }
    if (batch.length < 100) return files;
  }
  // More files than GitHub will list: some may be hidden, so treat as sensitive.
  return [...files, '.github/workflows/__unlisted-files__'];
}

function labelsFromEnv() {
  return (process.env.PR_LABELS ?? '').split(',').map((l) => l.trim()).filter(Boolean);
}

async function main(argv) {
  let paths;
  if (argv.includes('--stdin')) {
    paths = readFileSync(0, 'utf8').split('\n');
  } else if (argv.includes('--pr')) {
    const pr = Number(argv[argv.indexOf('--pr') + 1]);
    const repo = process.env.REPO ?? '';
    const token = process.env.GH_TOKEN ?? '';
    if (!Number.isSafeInteger(pr) || pr <= 0 || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) {
      console.log('[dependency-change-gate] needs --pr <number>, REPO and GH_TOKEN');
      return 2;
    }
    try {
      paths = await listPullRequestFiles({ repo, pr, token });
    } catch (error) {
      console.log(`[dependency-change-gate] cannot list the PR's files (${error instanceof Error ? error.message : error}); failing closed.`);
      return 2;
    }
  } else {
    console.log('[dependency-change-gate] usage: --stdin | --pr <number>');
    return 2;
  }
  const { code, lines } = decide(paths, labelsFromEnv());
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

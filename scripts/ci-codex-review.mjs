#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path -- dev-tooling CLI: git/codex on PATH is intentional */
// CI-run Codex cross-agent review — the no-self-attestation path.
//
// When OPENAI_API_KEY exists as an Actions secret, the review runs inside CI
// on the PR diff and the check verdict comes from Codex directly, so a local
// agent cannot attest its own review. Without the secret, CI falls back to
// verifying the SHA-pinned verdict commit (scripts/verify-review-verdict.mjs)
// recorded by the local review loop.
//
// The prompt demands a single JSON object as the FINAL line so the verdict is
// machine-parsed, never inferred from prose.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseVerdictLine(output) {
  // The final JSON-object line wins; everything before it is reasoning noise.
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try {
      const parsed = JSON.parse(lines[i]);
      if (typeof parsed.blockingFindings === 'number' && Array.isArray(parsed.findings)) {
        return parsed;
      }
    } catch { /* keep scanning upward */ }
  }
  return null;
}

export function buildPrompt(branch) {
  return [
    `You are the independent cross-agent reviewer for Crystal Ball branch ${branch}.`,
    'The unified diff against main arrives on stdin. Review it for real defects:',
    'correctness, security boundaries, fail-open provider votes (`ok` must derive',
    'from adapter output, not the raw fetch), denylist filtering of untrusted',
    'fields, truthiness-tested coordinates, regressions, missing or weakened',
    'tests, and CI/release hazards. Ignore style covered by automation.',
    '',
    'Your FINAL output line must be exactly one JSON object, no code fence:',
    '{"blockingFindings": <int>, "findings": [{"severity": "...", "file": "...",',
    '"line": <int>, "summary": "...", "blocking": <bool>}]}',
  ].join('\n');
}

function main() {
  const branch = process.env.GITHUB_HEAD_REF || 'unknown-branch';
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
  const diff = execFileSync('git', ['diff', `${baseRef}...HEAD`], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (!diff.trim()) {
    console.log('[ci-codex-review] Empty diff; nothing to review.');
    return;
  }
  const r = spawnSync('codex', ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', buildPrompt(branch)], {
    cwd: root, input: diff, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  console.log(output);
  if (r.status !== 0) {
    console.error(`[ci-codex-review] codex exec failed (exit ${r.status}).`);
    process.exit(1);
  }
  const verdict = parseVerdictLine(output);
  if (!verdict) {
    console.error('[ci-codex-review] No parseable verdict line in reviewer output — refusing to pass on prose.');
    process.exit(1);
  }
  const blocking = verdict.findings.filter((f) => f.blocking);
  if (verdict.blockingFindings > 0 || blocking.length > 0) {
    console.error(`[ci-codex-review] ${Math.max(verdict.blockingFindings, blocking.length)} blocking finding(s):`);
    for (const f of blocking) console.error(`  - [${f.severity}] ${f.file}:${f.line} ${f.summary}`);
    process.exit(1);
  }
  console.log('[ci-codex-review] No blocking findings.');
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectRun) main();

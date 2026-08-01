#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path -- dev-tooling CLI: git on PATH is intentional */
// SHA-pinned cross-agent review verdicts.
//
// The old gate was a free-text marker in the PR body: self-attestable, never
// tied to a commit, and #1601 merged mid-review because nothing invalidated
// an approval when new code was pushed. This protocol fixes the binding:
//
//   1. The reviewer examines the branch at commit R (the code tip).
//   2. The loop records .agentic/reviews/<R>.json and commits it — that
//      commit must touch NOTHING outside .agentic/reviews/.
//   3. CI verifies: HEAD is a verdict-only commit (adds/modifies only, no
//      deletes — rename tricks decompose to a delete under --no-renames),
//      its first parent is R, the file pins R exactly, the reviewer is the
//      required cross-agent, the verdict is "approve" with zero blocking
//      findings, and quoted evidence is present.
//
// Any code pushed after the verdict makes HEAD a code commit again, so the
// check goes red until a fresh review is recorded. A stale approval cannot
// ride a new push into main.
//
// KNOWN LIMIT: without CI-side reviewer execution (CI_CODEX_REVIEW +
// OPENAI_API_KEY), the reviewer identity is attested by the recording agent —
// the protocol proves WHAT was approved and WHEN it went stale, not WHO
// approved it. CI runs the copy of this script from origin/main, so a PR
// cannot weaken or delete the verifier it is judged by.
//
// Usage:
//   node scripts/verify-review-verdict.mjs [--ci]        verify HEAD
//   node scripts/verify-review-verdict.mjs --record \
//     --reviewer codex --evidence-file <path>            record for HEAD
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REVIEWS_DIR = '.agentic/reviews';
const MIN_EVIDENCE_LENGTH = 40;

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...options }).trim();
}

export function requiredReviewers(branch) {
  // No 'human' reviewer string: it would be a forgeable bypass of the cycle
  // cap. The human override for an escalated PR is a GitHub admin merge —
  // authenticated by GitHub itself, not by a string an agent can type.
  if (branch.startsWith('claude/')) return ['codex'];
  if (branch.startsWith('codex/')) return ['claude'];
  if (branch.startsWith('copilot/')) return ['codex', 'claude'];
  return null; // not an agent branch — no verdict required
}

// The reviewer's structured verdict object is the ONLY accepted approval
// marker. Scans every line for a JSON object carrying blockingFindings; an
// approval requires at least one such object and every one of them clean, so
// a transcript quoting an earlier failing cycle cannot back a record.
export function evidenceApproves(evidence) {
  let sawVerdict = false;
  for (const line of evidence.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.includes('blockingFindings')) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof obj.blockingFindings !== 'number') continue;
    sawVerdict = true;
    if (obj.blockingFindings !== 0) return false;
    if (Array.isArray(obj.findings) && obj.findings.some((f) => f?.blocking === true)) return false;
  }
  return sawVerdict;
}

// headEntries: [{ status, file }] from a --no-renames name-status diff of the
// HEAD commit. Statuses other than A/M (deletes, type changes) can never be
// part of a legitimate verdict commit; with rename detection disabled a
// "rename a code file onto the verdict path" trick decomposes into D + A and
// the D is rejected here.
export function validateVerdict({ branch, headEntries, headParent, verdictJson }) {
  const reviewers = requiredReviewers(branch);
  if (reviewers === null) return { ok: true, reason: 'not an agent branch; verdict not required' };

  const failures = [];
  const expectedFile = `${REVIEWS_DIR}/${headParent}.json`;

  const offending = headEntries.filter(
    (e) => !e.file.startsWith(`${REVIEWS_DIR}/`) || (e.status !== 'A' && e.status !== 'M'),
  );
  if (headEntries.length === 0 || offending.length > 0) {
    failures.push(
      'HEAD is not a verdict-only commit. The tip of an agent branch must be a commit '
        + `that only adds or modifies files under ${REVIEWS_DIR}/, recording the cross-agent review of its parent. `
        + (offending.length > 0 ? `Offending entries: ${offending.map((e) => [e.status, e.file].join(' ')).join(', ')}. ` : '')
        + 'Run the review, then: node scripts/verify-review-verdict.mjs --record --reviewer <agent> --evidence-file <transcript>',
    );
    return { ok: false, failures };
  }
  if (!headEntries.some((e) => e.file === expectedFile)) {
    failures.push(
      `HEAD does not record a verdict for its parent: expected ${expectedFile}, got ${headEntries.map((e) => e.file).join(', ')}. `
        + 'The verdict must pin the exact commit the reviewer examined — re-run the review against the current tip.',
    );
    return { ok: false, failures };
  }

  let verdict;
  try {
    verdict = JSON.parse(verdictJson);
  } catch {
    failures.push(`${expectedFile} is not valid JSON.`);
    return { ok: false, failures };
  }

  if (verdict.reviewedSha !== headParent) {
    failures.push(`Verdict pins ${verdict.reviewedSha}, but the reviewed commit is ${headParent}.`);
  }
  if (!reviewers.includes(String(verdict.reviewer || '').toLowerCase())) {
    failures.push(
      `Reviewer "${verdict.reviewer}" is not a valid cross-agent for ${branch.split('/')[0]}/* — `
        + `required: ${reviewers.join(' or ')}. Self-review does not count.`,
    );
  }
  if (verdict.verdict !== 'approve') {
    failures.push(`Verdict is "${verdict.verdict}", not "approve".`);
  }
  if (verdict.blockingFindings !== 0) {
    failures.push(`blockingFindings is ${verdict.blockingFindings}; a verdict may only be recorded at zero.`);
  }
  if (typeof verdict.evidence !== 'string' || verdict.evidence.trim().length < MIN_EVIDENCE_LENGTH) {
    failures.push(
      `evidence must quote the reviewer's actual concluding output (>= ${MIN_EVIDENCE_LENGTH} chars), `
        + 'never a paraphrase.',
    );
  } else {
    // Prose is not evidence. Substring matching over English is polarity-blind
    // ("VERDICT: APPROVE? No; blocking findings remain" satisfies every
    // positive marker), so the only accepted approval signal is the reviewer's
    // own STRUCTURED verdict object with a zero count and no blocking finding.
    if (!evidenceApproves(verdict.evidence)) {
      failures.push(
        'evidence must contain the reviewer\'s structured verdict object '
          + '({"blockingFindings": 0, "findings": [...]}) with a zero count and no finding marked '
          + 'blocking. Prose approvals are rejected — English negation is not machine-checkable.',
      );
    }
  }
  return failures.length > 0 ? { ok: false, failures } : { ok: true, reason: `verdict by ${verdict.reviewer} for ${headParent}` };
}

function headState(cwd) {
  const headSha = git(['rev-parse', 'HEAD'], { cwd });
  let headParent = '';
  try {
    headParent = git(['rev-parse', 'HEAD^'], { cwd });
  } catch { /* root commit — headEntries below still lists its files */ }
  const raw = headParent
    ? git(['diff-tree', '--no-renames', '--name-status', '-r', headParent, headSha], { cwd })
    : git(['diff-tree', '--no-renames', '--name-status', '-r', '--root', headSha], { cwd })
        .split('\n').slice(1).join('\n'); // --root prefixes the commit hash line
  const headEntries = raw.split('\n').filter(Boolean).map((line) => {
    const [status, ...rest] = line.split('\t');
    return { status: status.trim(), file: rest.join('\t') };
  });
  return { headSha, headParent, headEntries };
}

function currentBranch(cwd) {
  return process.env.GITHUB_HEAD_REF || git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
}

export function verify(cwd = process.cwd()) {
  const branch = currentBranch(cwd);
  const { headParent, headEntries } = headState(cwd);
  let verdictJson = '';
  if (headParent) {
    try {
      verdictJson = git(['show', `HEAD:${REVIEWS_DIR}/${headParent}.json`], { cwd });
    } catch { /* validated below via headEntries */ }
  }
  return { branch, ...validateVerdict({ branch, headEntries, headParent, verdictJson }) };
}

function record(cwd, { reviewer, evidenceFile }) {
  const branch = currentBranch(cwd);
  const reviewers = requiredReviewers(branch);
  if (reviewers === null) throw new Error(`${branch} is not an agent branch; nothing to record.`);
  if (!reviewers.includes(reviewer)) {
    throw new Error(`Reviewer "${reviewer}" is not a valid cross-agent for this branch (required: ${reviewers.join(' or ')}).`);
  }
  // Untracked files (evidence transcripts, worktree node_modules symlinks) do
  // not change the committed state the verdict pins; tracked modifications do.
  if (git(['status', '--porcelain', '--untracked-files=no'], { cwd })) {
    throw new Error('Tracked files have uncommitted changes; a verdict must pin an exact committed state.');
  }
  const { headSha, headEntries } = headState(cwd);
  if (headEntries.length > 0 && headEntries.every((e) => e.file.startsWith(`${REVIEWS_DIR}/`))) {
    throw new Error('HEAD is already a verdict commit; do not stack verdicts. Push code first, then re-review.');
  }
  const evidence = readFileSync(evidenceFile, 'utf8').trim();
  if (evidence.length < MIN_EVIDENCE_LENGTH) {
    throw new Error(`Evidence file is too short to be a real reviewer conclusion (< ${MIN_EVIDENCE_LENGTH} chars).`);
  }
  const file = path.join(cwd, REVIEWS_DIR, `${headSha}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({
    reviewedSha: headSha,
    reviewer,
    verdict: 'approve',
    blockingFindings: 0,
    reviewedAt: new Date().toISOString(),
    evidence,
  }, null, 2)}\n`);
  git(['add', `${REVIEWS_DIR}/${headSha}.json`], { cwd });
  git(['commit', '--no-verify', '-m', `agentic: record ${reviewer} review verdict for ${headSha.slice(0, 8)}`], { cwd });
  return verify(cwd);
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };

  if (args.includes('--record')) {
    const reviewer = get('--reviewer');
    const evidenceFile = get('--evidence-file');
    if (!reviewer || !evidenceFile) {
      console.error('Usage: verify-review-verdict.mjs --record --reviewer <codex|claude> --evidence-file <path>');
      process.exit(2);
    }
    const result = record(process.cwd(), { reviewer: reviewer.toLowerCase(), evidenceFile });
    if (!result.ok) {
      console.error('[review-verdict] Recorded verdict failed self-verification:');
      for (const f of result.failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log(`[review-verdict] Recorded and verified: ${result.reason}`);
    return;
  }

  const result = verify(process.cwd());
  if (result.ok) {
    console.log(`[review-verdict] PASS (${result.branch}): ${result.reason}`);
    return;
  }
  console.error(`[review-verdict] FAIL (${result.branch}):`);
  for (const f of result.failures) console.error(`  - ${f}`);
  process.exit(1);
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectRun) main();

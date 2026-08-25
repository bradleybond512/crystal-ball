import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareRoadmaps,
  parseRoadmaps,
  reconcileRoadmaps,
  renderWatchdog,
  validateSnapshot,
} from '../scripts/roadmap-controller.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const UX = `
# Usability

- **Status:** ACTIVE

### UX-000 — First run

Exit condition: Packaged verification passes.
Review after: 2026-09-01

### UX-001 — Home shell

### UX-002 — Blocked lens

Exit condition: Identity design is approved.
Review after: 2026-09-02

## Progress Tracker

| ID | Task | Status | PR |
|---|---|---|---|
| UX-000 | First run | MONITOR | #1660 |
| UX-001 | Home shell | NOT STARTED | — |
| UX-002 | Blocked lens | BLOCKED — HIGH ASSURANCE | — |
`;

const ACC = `
# Accuracy

> Status: ACTIVE

## Phase 0 — Spine

| ID | Status | Work | Evidence |
|---|---|---|---|
| ACC-001 | DONE | Spine | PR #10 |

## Phase 5 — Correlation

| ID | Status | Work | Depends on |
|---|---|---|---|
| ACC-501 | DONE | Benchmark | ACC-001 |
| ACC-502 | TODO | Reliability | ACC-501 (DONE) |
| ACC-503 | WAITING | Tunables | ACC-502 |

### ACC-501 — Benchmark

Status: \`DONE\`
Evidence: PR #20
Dependencies: ACC-001

### ACC-502 — Reliability

Status: \`TODO\`
Dependencies: ACC-501 (DONE)

### ACC-503 — Tunables

Status: \`WAITING\`
Dependencies: ACC-502
Exit condition: ACC-502 is DONE.
Review after: 2026-09-03
`;

function parse(ux = UX, acc = ACC) {
  return parseRoadmaps({
    'docs/USABILITY_UPLIFT_FOR_CODEX.md': ux,
    'docs/PREDICTION_ACCURACY_ROADMAP.md': acc,
  });
}

function snapshot(pullRequests = []) {
  return {
    schemaVersion: 1,
    complete: true,
    truncated: false,
    baseBranch: 'main',
    eventType: 'schedule',
    candidatePrNumbers: [],
    generatedAt: '2026-08-24T12:00:00.000Z',
    pullRequests,
  };
}

function pr(number, state, text, extra = {}) {
  return {
    number,
    state,
    base: 'main',
    draft: state === 'OPEN',
    title: text,
    body: '',
    updatedAt: '2026-08-24T11:00:00.000Z',
    mergedAt: state === 'MERGED' ? '2026-08-24T11:00:00.000Z' : null,
    ...extra,
  };
}

test('parses UX, Phase 0, and Phase 5 tasks into one normalized state', () => {
  const state = parse();
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.programs, { accuracy: 'ACTIVE', usability: 'ACTIVE' });
  assert.equal(state.tasks.length, 7);
  assert.deepEqual(
    state.tasks.map(({ id, status, highAssurance }) => ({ id, status, highAssurance })),
    [
      { id: 'ACC-001', status: 'DONE', highAssurance: false },
      { id: 'ACC-501', status: 'DONE', highAssurance: false },
      { id: 'ACC-502', status: 'TODO', highAssurance: false },
      { id: 'ACC-503', status: 'WAITING', highAssurance: false },
      { id: 'UX-000', status: 'MONITOR', highAssurance: false },
      { id: 'UX-001', status: 'TODO', highAssurance: false },
      { id: 'UX-002', status: 'BLOCKED', highAssurance: true },
    ],
  );
  assert.deepEqual(state.tasks.find(({ id }) => id === 'ACC-502').dependencies, ['ACC-501']);
  assert.deepEqual(state.tasks.find(({ id }) => id === 'ACC-502').dependencyAnyOf, []);
  assert.deepEqual(state.tasks.find(({ id }) => id === 'UX-000').evidencePrs, [1660]);
});

test('rejects incomplete program structure and COMPLETE programs with unfinished tasks', () => {
  const duplicateUx = UX.replace(
    '### UX-001 — Home shell\n\n',
    '### UX-001 — Home shell\n\n### UX-001 — Duplicate shell\n\n',
  );
  assert.ok(parse(duplicateUx).errors.some((message) => /UX-001.*defined more than once/.test(message)));

  const trackerOnly = UX.replace('### UX-001 — Home shell\n\n', '');
  assert.ok(parse(trackerOnly).errors.some((message) => /UX-001.*Progress Tracker.*heading/.test(message)));

  const missingMirror = ACC.replace('| ACC-502 | TODO | Reliability | ACC-501 (DONE) |\n', '');
  assert.ok(parse(UX, missingMirror).errors.some((message) => /ACC-502.*missing from the Phase 5 mirror/.test(message)));

  const complete = parse(UX.replace('**Status:** ACTIVE', '**Status:** COMPLETE'));
  assert.ok(complete.errors.some((message) => /usability program is COMPLETE.*unfinished/i.test(message)));
});

test('reports duplicate definitions, mirror drift, unknown status, and missing wait metadata', () => {
  const badAcc = ACC
    .replace('| ACC-502 | TODO | Reliability |', '| ACC-502 | DONE | Reliability |')
    .replace('Exit condition: ACC-502 is DONE.\nReview after: 2026-09-03\n', '')
    + '\n### ACC-502 — Duplicate\n\nStatus: `TODO`\n'
    + '\n### ACC-504 — Unknown\n\nStatus: `PAUSED`\n';
  const state = parse(UX, badAcc);
  assert.ok(state.errors.some((message) => /ACC-502.*defined more than once/.test(message)));
  assert.ok(state.errors.some((message) => /ACC-502.*mirror status DONE.*heading status TODO/.test(message)));
  assert.ok(state.errors.some((message) => /ACC-504.*unrecognized status PAUSED/.test(message)));
  assert.ok(state.errors.some((message) => /ACC-503.*Exit condition/.test(message)));
  assert.ok(state.errors.some((message) => /ACC-503.*Review after/.test(message)));
});

test('rejects oversized roadmap documents and terminal tasks without evidence', () => {
  const oversized = parse(`${UX}\n${'x'.repeat(2_097_152)}`, ACC);
  assert.ok(oversized.errors.some((message) => /USABILITY_UPLIFT_FOR_CODEX.*2 MiB/.test(message)));

  const missingEvidence = parse(UX, ACC.replace('Evidence: PR #20\n', ''));
  assert.ok(missingEvidence.errors.some((message) => /ACC-501.*terminal.*evidence/.test(message)));

  const placeholderEvidence = parse(UX, ACC.replace('Evidence: PR #20', 'Evidence: pending'));
  assert.ok(placeholderEvidence.errors.some((message) => /ACC-501.*terminal.*evidence/.test(message)));
});

test('baseline comparison blocks task deletion and terminal-state mutation', () => {
  const baseline = parse();
  const deleted = parse(UX.replace('| UX-001 | Home shell | NOT STARTED | — |\n', '')
    .replace('### UX-001 — Home shell\n\n', ''), ACC);
  assert.ok(compareRoadmaps(baseline, deleted).some((message) => /UX-001.*deleted/.test(message)));

  const reopened = parse(UX, ACC.replace('| ACC-001 | DONE | Spine |', '| ACC-001 | TODO | Spine |'));
  assert.ok(compareRoadmaps(baseline, reopened).some((message) => /ACC-001.*terminal.*DONE.*TODO/.test(message)));
});

test('validates a bounded, complete, main-only token-free snapshot', () => {
  assert.deepEqual(validateSnapshot(snapshot([pr(10, 'MERGED', 'ACC-001')])), []);
  assert.match(validateSnapshot({ ...snapshot(), complete: false })[0], /complete/);
  assert.match(validateSnapshot({ ...snapshot(), truncated: true })[0], /truncated/);
  assert.match(validateSnapshot({ ...snapshot(), baseBranch: 'release' })[0], /baseBranch/);
  assert.match(validateSnapshot({ ...snapshot(), token: 'secret' })[0], /unknown field token/);
  assert.ok(validateSnapshot({ ...snapshot(), generatedAt: 'August 24' })
    .some((message) => /generatedAt/.test(message)));
  assert.ok(validateSnapshot(snapshot(Array.from({ length: 513 }, (_, index) => pr(index + 1, 'OPEN', 'x'))))
    .some((message) => /at most 512/.test(message)));
  assert.ok(validateSnapshot(snapshot([{ ...pr(1, 'OPEN', 'x'), base: 'release' }]))
    .some((message) => /base main/.test(message)));
});

test('rejects impossible review dates instead of allowing Date normalization', () => {
  const state = parse(UX.replace('Review after: 2026-09-02', 'Review after: 2026-02-30'));
  assert.ok(state.errors.some((message) => /UX-002.*invalid Review after date 2026-02-30/.test(message)));
});

test('reconciliation accepts merged terminal evidence and monitored merged work', () => {
  const state = parse();
  const report = reconcileRoadmaps(state, snapshot([
    pr(10, 'MERGED', 'ACC-001'),
    pr(20, 'MERGED', 'ACC-501'),
    pr(1660, 'MERGED', 'UX-000'),
  ]), { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  assert.deepEqual(report.blocking, []);
  assert.equal(report.nextEligible.id, 'ACC-502');
});

test('the candidate PR may provisionally supply terminal evidence, but an unrelated open PR may not', () => {
  const state = parse();
  const pulls = [
    pr(10, 'OPEN', 'ACC-001 evidence'),
    pr(20, 'MERGED', 'ACC-501 evidence'),
    pr(1660, 'MERGED', 'UX-000'),
  ];
  const candidate = reconcileRoadmaps(state, {
    ...snapshot(pulls),
    eventType: 'pull_request',
    candidatePrNumbers: [10],
  }, { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  assert.ok(!candidate.blocking.some((message) => /ACC-001.*not merged/.test(message)));

  const unrelated = reconcileRoadmaps(state, snapshot(pulls), {
    now: '2026-08-24T12:00:00.000Z', baseBranch: 'main',
  });
  assert.ok(unrelated.blocking.some((message) => /ACC-001.*not merged/.test(message)));
});

test('candidate PR claims are one-to-one and synchronized with roadmap state', () => {
  const state = parse();
  const todoClaim = reconcileRoadmaps(state, {
    ...snapshot([pr(40, 'OPEN', 'Roadmap task: ACC-502')]),
    eventType: 'pull_request',
    candidatePrNumbers: [40],
  }, { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  assert.ok(todoClaim.blocking.some((message) => /ACC-502.*candidate PR #40.*IN_REVIEW/.test(message)));

  const multiClaim = reconcileRoadmaps(state, {
    ...snapshot([pr(41, 'OPEN', 'ACC-502 and UX-001')]),
    eventType: 'pull_request',
    candidatePrNumbers: [41],
  }, { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  assert.ok(multiClaim.blocking.some((message) => /candidate PR #41.*exactly one.*ACC-502.*UX-001/.test(message)));
});

test('reconciliation catches merged active work, unmerged evidence, and duplicate claims', () => {
  const activeUx = UX.replace('| UX-000 | First run | MONITOR |', '| UX-000 | First run | IN PROGRESS |');
  const state = parse(activeUx);
  const report = reconcileRoadmaps(state, snapshot([
    pr(10, 'OPEN', 'ACC-001 evidence'),
    pr(20, 'MERGED', 'ACC-501 evidence'),
    pr(1660, 'MERGED', 'UX-000 claim'),
    pr(30, 'OPEN', 'Roadmap task: ACC-502'),
    pr(31, 'OPEN', 'ACC-502 alternate claim'),
  ]), { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  assert.ok(report.blocking.some((message) => /UX-000.*active.*#1660.*merged/.test(message)));
  assert.ok(report.blocking.some((message) => /ACC-001.*evidence PR #10.*not merged/.test(message)));
  assert.ok(report.blocking.some((message) => /ACC-502.*multiple open claims.*#30.*#31/.test(message)));
});

test('an orphan claim blocks its candidate PR but is advisory to the scheduled watchdog', () => {
  const state = parse();
  const pull = pr(32, 'OPEN', 'Roadmap task: ACC-999');
  const candidate = reconcileRoadmaps(state, {
    ...snapshot([pull]),
    eventType: 'pull_request',
    candidatePrNumbers: [32],
  }, { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  assert.ok(candidate.blocking.some((message) => /ACC-999.*missing from the roadmaps/.test(message)));

  const scheduled = reconcileRoadmaps(state, snapshot([pull]), {
    now: '2026-08-24T12:00:00.000Z', baseBranch: 'main',
  });
  assert.ok(!scheduled.blocking.some((message) => /ACC-999/.test(message)));
  assert.ok(scheduled.advisory.some((message) => /ACC-999.*missing from the roadmaps/.test(message)));
});

test('reconciliation advises on claims stalled beyond 72 hours and names the next eligible task', () => {
  const state = parse();
  const report = reconcileRoadmaps(state, snapshot([
    pr(10, 'MERGED', 'ACC-001'),
    pr(20, 'MERGED', 'ACC-501'),
    pr(1660, 'MERGED', 'UX-000'),
    pr(30, 'OPEN', 'Roadmap task: ACC-502', { updatedAt: '2026-08-20T11:59:59.000Z' }),
  ]), { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  assert.ok(report.advisory.some((message) => /ACC-502.*#30.*stalled.*72 hours/.test(message)));
  assert.equal(report.nextEligible.id, 'UX-001');
});

test('reconciliation reports overdue wait reviews and supports OR dependencies', () => {
  const overdue = parse(UX.replace('Review after: 2026-09-02', 'Review after: 2026-08-20'));
  const overdueReport = reconcileRoadmaps(overdue, null, {
    now: '2026-08-24T12:00:00.000Z', baseBranch: 'main',
  });
  assert.ok(overdueReport.advisory.some((message) => /UX-002.*review overdue since 2026-08-20/.test(message)));

  const anyOfAcc = ACC
    .replace('| ACC-503 | WAITING | Tunables | ACC-502 |', '| ACC-503 | TODO | Tunables | ACC-502 or ACC-501 |')
    .replace('Status: `WAITING`\nDependencies: ACC-502\nExit condition: ACC-502 is DONE.\nReview after: 2026-09-03', 'Status: `TODO`\nDependencies: ACC-502 or ACC-501');
  const anyOf = parse(UX, anyOfAcc);
  assert.deepEqual(anyOf.tasks.find(({ id }) => id === 'ACC-503').dependencyAnyOf, ['ACC-502', 'ACC-501']);
  const report = reconcileRoadmaps(anyOf, snapshot([
    pr(10, 'MERGED', 'ACC-001'),
    pr(20, 'MERGED', 'ACC-501'),
    pr(1660, 'MERGED', 'UX-000'),
    pr(30, 'OPEN', 'Roadmap task: ACC-502'),
  ]), { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  assert.equal(report.nextEligible.id, 'ACC-503');
});

test('task IDs mentioned incidentally in a PR body are not treated as claims', () => {
  const state = parse();
  const report = reconcileRoadmaps(state, snapshot([
    pr(10, 'MERGED', 'ACC-001'),
    pr(20, 'MERGED', 'ACC-501'),
    pr(1660, 'MERGED', 'UX-000'),
    pr(30, 'OPEN', 'Unrelated docs', {
      body: 'The next eligible task remains ACC-502, but this PR does not claim it.',
    }),
  ]), { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  assert.equal(report.nextEligible.id, 'ACC-502');
});

test('watchdog Markdown is deterministic, marked, and carries a body digest', () => {
  const state = parse();
  const report = reconcileRoadmaps(state, snapshot([
    pr(10, 'MERGED', 'ACC-001'),
    pr(20, 'MERGED', 'ACC-501'),
    pr(1660, 'MERGED', 'UX-000'),
  ]), { now: '2026-08-24T12:00:00.000Z', baseBranch: 'main' });
  const first = renderWatchdog(report);
  const second = renderWatchdog(report);
  assert.equal(first, second);
  assert.match(first, /<!-- crystal-ball-roadmap-controller:v1 -->/);
  assert.match(first, /<!-- roadmap-body-sha256:[a-f0-9]{64} -->/);
  assert.match(first, /Next eligible task:.*ACC-502/);
});

test('CLI exits 0 offline, 1 for policy drift, and 2 for invalid snapshot input', () => {
  const clean = spawnSync(process.execPath, ['scripts/roadmap-controller.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`);

  const dir = mkdtempSync(join(tmpdir(), 'roadmap-controller-'));
  const invalidPath = join(dir, 'invalid.json');
  writeFileSync(invalidPath, '{ nope');
  const invalid = spawnSync(process.execPath, ['scripts/roadmap-controller.mjs', '--snapshot', invalidPath], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 2);
  assert.match(`${invalid.stdout}${invalid.stderr}`, /invalid snapshot JSON/i);

  const policyPath = join(dir, 'policy.json');
  writeFileSync(policyPath, JSON.stringify(snapshot([
    pr(1659, 'OPEN', 'UX-006 evidence'),
  ])));
  const policy = spawnSync(process.execPath, ['scripts/roadmap-controller.mjs', '--snapshot', policyPath], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(policy.status, 1);
  assert.match(`${policy.stdout}${policy.stderr}`, /Blocking/);
});

test('CLI exports every PR reference parsed from the real roadmaps for the workflow snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-references-'));
  const output = join(dir, 'references.json');
  const result = spawnSync(process.execPath, [
    'scripts/roadmap-controller.mjs', '--references-output', output,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const references = JSON.parse(readFileSync(output, 'utf8'));
  assert.ok(references.includes(1596));
  assert.ok(references.includes(1624));
  assert.ok(references.includes(1665));
});

test('workflow is pinned, least-privileged, token-free at the Node boundary, and main-only for writes', () => {
  const workflow = readFileSync(join(root, '.github/workflows/roadmap-controller.yml'), 'utf8');
  assert.doesNotMatch(workflow, /pull_request_target/);
  for (const match of workflow.matchAll(/uses:\s*([^\s]+)/g)) {
    assert.match(match[1], /@[a-f0-9]{40}$/);
  }
  assert.match(workflow, /pull_request:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(workflow, /merge_group:/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /github\.event_name == 'schedule'.*github\.ref == 'refs\/heads\/main'/s);
  assert.match(workflow, /git show origin\/main:scripts\/roadmap-controller\.mjs/);
  assert.match(workflow, /git show origin\/main:docs\/USABILITY_UPLIFT_FOR_CODEX\.md/);
  assert.match(workflow, /--baseline-ux/);
  assert.match(workflow, /--references-output/);
  assert.match(workflow, /ROADMAP_REFERENCES_PATH/);
  assert.doesNotMatch(workflow, /docs\.matchAll/);
  assert.match(workflow, /concurrency:\s*\n\s*group: roadmap-controller-watchdog/);
  assert.doesNotMatch(workflow, /node scripts\/roadmap-controller\.mjs[^\n]*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /crystal-ball-roadmap-controller:v1/);
});

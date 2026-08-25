#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UX_PATH = 'docs/USABILITY_UPLIFT_FOR_CODEX.md';
const ACC_PATH = 'docs/PREDICTION_ACCURACY_ROADMAP.md';
const TASK_ID = /\b(?:UX|ACC)-\d{3}\b/g;
const WAIT_STATUSES = new Set(['WAITING', 'MONITOR', 'BLOCKED']);
const TERMINAL_STATUSES = new Set(['DONE', 'REJECTED']);
const EVIDENCE_STATUSES = new Set([...TERMINAL_STATUSES, 'MONITOR']);
const MAX_ROADMAP_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_FIELDS = new Set([
  'schemaVersion', 'complete', 'truncated', 'baseBranch', 'eventType', 'candidatePrNumbers',
  'generatedAt', 'pullRequests',
]);
const PR_FIELDS = new Set([
  'number', 'state', 'base', 'draft', 'title', 'body', 'updatedAt', 'mergedAt',
]);

function normalizeStatus(value) {
  let raw = value.replace(/[\*`]/g, '').trim().toUpperCase();
  const highAssurance = raw.endsWith('HIGH ASSURANCE');
  if (highAssurance) {
    raw = raw.slice(0, -'HIGH ASSURANCE'.length).trim().replace(/[—-]$/, '').trim();
  }
  const aliases = new Map([
    ['NOT STARTED', 'TODO'],
    ['TODO', 'TODO'],
    ['IN PROGRESS', 'IN_REVIEW'],
    ['IN REVIEW', 'IN_REVIEW'],
    ['WAITING', 'WAITING'],
    ['MONITOR', 'MONITOR'],
    ['BLOCKED', 'BLOCKED'],
    ['DONE', 'DONE'],
    ['REJECTED', 'REJECTED'],
  ]);
  return { raw, status: aliases.get(raw) ?? null, highAssurance };
}

function tableRows(section) {
  const lines = section.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (inTable) break;
      continue;
    }
    const cells = line.trim().slice(1, -1).split('|').map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    rows.push(cells);
  }
  return rows;
}

function sectionAfter(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) return '';
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function headingBlocks(markdown, prefix) {
  const pattern = prefix === 'UX'
    ? /^### (UX-\d{3}) — (.+)$/gm
    : /^### (ACC-\d{3}) — (.+)$/gm;
  const matches = [...markdown.matchAll(pattern)];
  return matches.map((match, index) => ({
    id: match[1],
    title: stripTitleModifier(match[2]),
    body: markdown.slice(match.index + match[0].length, matches[index + 1]?.index ?? markdown.length),
  }));
}

function stripTitleModifier(title) {
  const marker = title.lastIndexOf(' *(');
  return marker !== -1 && title.endsWith(')*') ? title.slice(0, marker).trim() : title.trim();
}

function field(body, name) {
  const prefix = `${name}:`;
  const line = body.split('\n').find((candidate) => candidate.toLowerCase().startsWith(prefix.toLowerCase()));
  return line ? line.slice(prefix.length).trim() : null;
}

function prNumbers(value) {
  return [...new Set([...value.matchAll(/#(\d+)\b/g)].map((match) => Number(match[1])))];
}

function taskFrom({ id, title, statusText, body = '', evidence = '', source, mirror = false }) {
  const normalized = normalizeStatus(statusText);
  const evidenceLines = body.split('\n').filter((line) => {
    const lower = line.toLowerCase();
    return ['evidence:', 'verification:', 'verify:', 'pr:', 'merged:', 'landed:']
      .some((prefix) => lower.startsWith(prefix));
  });
  const evidenceText = evidenceLines.map((line) => line.slice(line.indexOf(':') + 1).trim()).join('\n');
  const dependencyText = field(body, 'Dependencies') ?? '';
  const dependencyIds = dependencyText.match(TASK_ID);
  const evidencePrs = prNumbers(`${evidence}\n${evidenceText}`);
  const dependencyAnyOf = /\bor\b/i.test(dependencyText) && dependencyIds
    ? [...new Set(dependencyIds)]
    : [];
  return {
    id,
    title,
    status: normalized.status,
    rawStatus: normalized.raw,
    highAssurance: normalized.highAssurance,
    dependencies: dependencyIds && dependencyAnyOf.length === 0 ? [...new Set(dependencyIds)] : [],
    dependencyAnyOf,
    evidencePrs,
    hasEvidence: evidencePrs.length > 0,
    exitCondition: field(body, 'Exit condition'),
    reviewAfter: field(body, 'Review after'),
    source,
    mirror,
  };
}

function programStatus(markdown, pattern, name, errors) {
  const raw = pattern.exec(markdown)?.[1]?.toUpperCase() ?? null;
  if (!raw) {
    errors.push(`${name} program status is missing`);
    return null;
  }
  if (!['ACTIVE', 'COMPLETE'].includes(raw)) {
    errors.push(`${name} program has unrecognized status ${raw}`);
    return null;
  }
  return raw;
}

function addTask(task, tasks, errors) {
  if (tasks.has(task.id)) {
    errors.push(`${task.id} is defined more than once`);
    return;
  }
  tasks.set(task.id, task);
  if (!task.status) errors.push(`${task.id} has unrecognized status ${task.rawStatus || '(empty)'}`);
}

function validateWaitMetadata(task, errors) {
  if (!WAIT_STATUSES.has(task.status)) return;
  if (!task.exitCondition) errors.push(`${task.id} (${task.status}) is missing Exit condition metadata`);
  if (!task.reviewAfter) {
    errors.push(`${task.id} (${task.status}) is missing Review after metadata`);
  } else if (!isCalendarDate(task.reviewAfter)) {
    errors.push(`${task.id} has invalid Review after date ${task.reviewAfter}`);
  }
}

function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

// The parser keeps all format errors so one run can repair a malformed roadmap atomically.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function parseRoadmaps(files) {
  const errors = [];
  const tasks = new Map();
  const programs = { accuracy: null, usability: null };
  const ux = files?.[UX_PATH];
  const acc = files?.[ACC_PATH];
  if (typeof ux !== 'string') errors.push(`${UX_PATH} is missing`);
  else if (Buffer.byteLength(ux) > MAX_ROADMAP_BYTES) errors.push(`${UX_PATH} exceeds the 2 MiB limit`);
  if (typeof acc !== 'string') errors.push(`${ACC_PATH} is missing`);
  else if (Buffer.byteLength(acc) > MAX_ROADMAP_BYTES) errors.push(`${ACC_PATH} exceeds the 2 MiB limit`);

  if (typeof ux === 'string' && Buffer.byteLength(ux) <= MAX_ROADMAP_BYTES) {
    programs.usability = programStatus(ux, /^- \*\*Status:\*\*\s*([A-Z]+)/m, 'usability', errors);
    const uxBlocks = headingBlocks(ux, 'UX');
    const blocks = new Map();
    for (const block of uxBlocks) {
      if (blocks.has(block.id)) errors.push(`${block.id} is defined more than once`);
      else blocks.set(block.id, block);
    }
    const tracker = sectionAfter(ux, '## Progress Tracker');
    const rows = tableRows(tracker).filter((row) => /^UX-\d{3}$/.test(row[0] ?? ''));
    if (rows.length === 0) errors.push(`${UX_PATH} has no Progress Tracker task rows`);
    for (const row of rows) {
      const [id, title, statusText, evidence = ''] = row;
      const block = blocks.get(id);
      if (!block) errors.push(`${id} appears in the Progress Tracker without a task heading`);
      const body = block?.body ?? '';
      addTask(taskFrom({ id, title, statusText, body, evidence, source: UX_PATH }), tasks, errors);
    }
    for (const id of blocks.keys()) {
      if (!tasks.has(id)) errors.push(`${id} has a heading but is missing from the Progress Tracker`);
    }
  }

  if (typeof acc === 'string' && Buffer.byteLength(acc) <= MAX_ROADMAP_BYTES) {
    programs.accuracy = programStatus(acc, /^> Status:\s*([A-Z]+)/m, 'accuracy', errors);
    const phase0 = tableRows(sectionAfter(acc, '## Phase 0'))
      .filter((row) => /^ACC-\d{3}$/.test(row[0] ?? ''));
    if (phase0.length === 0) errors.push(`${ACC_PATH} has no Phase 0 task rows`);
    for (const [id, statusText, title, evidence = ''] of phase0) {
      addTask(taskFrom({ id, title, statusText, evidence, source: ACC_PATH }), tasks, errors);
    }

    const blocks = headingBlocks(acc, 'ACC');
    const seenHeadings = new Set();
    for (const block of blocks) {
      if (seenHeadings.has(block.id)) {
        errors.push(`${block.id} is defined more than once`);
        continue;
      }
      seenHeadings.add(block.id);
      const statusText = field(block.body, 'Status') ?? '';
      addTask(taskFrom({
        id: block.id,
        title: block.title,
        statusText,
        body: block.body,
        source: ACC_PATH,
      }), tasks, errors);
    }

    const phase5Section = sectionAfter(acc, '## Phase 5');
    const phase5 = tableRows(phase5Section)
      .filter((row) => /^ACC-\d{3}$/.test(row[0] ?? ''));
    if (phase5.length === 0) errors.push(`${ACC_PATH} has no Phase 5 mirror rows`);
    const mirrorIds = new Set();
    for (const [id, mirrorStatus] of phase5) {
      if (mirrorIds.has(id)) errors.push(`${id} appears more than once in the Phase 5 mirror`);
      mirrorIds.add(id);
      const heading = tasks.get(id);
      if (!heading) {
        errors.push(`${id} appears in the Phase 5 mirror without a task heading`);
        continue;
      }
      const normalizedMirror = normalizeStatus(mirrorStatus);
      if (!normalizedMirror.status) {
        errors.push(`${id} has unrecognized Phase 5 mirror status ${normalizedMirror.raw}`);
      } else if (normalizedMirror.status !== heading.status) {
        errors.push(`${id} mirror status ${normalizedMirror.raw} does not match heading status ${heading.rawStatus}`);
      }
    }
    const phase5HeadingIds = new Set(blocks
      .filter((block) => /^ACC-5\d{2}$/.test(block.id))
      .map((block) => block.id));
    for (const id of phase5HeadingIds) {
      if (!mirrorIds.has(id)) errors.push(`${id} has a Phase 5 task heading but is missing from the Phase 5 mirror`);
    }
  }

  const ordered = [...tasks.values()].sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set(ordered.map((task) => task.id));
  for (const task of ordered) {
    validateWaitMetadata(task, errors);
    if (TERMINAL_STATUSES.has(task.status)
      && !task.hasEvidence) {
      errors.push(`${task.id} is terminal (${task.status}) without evidence`);
    }
    if (task.status === 'MONITOR' && !task.hasEvidence) {
      errors.push(`${task.id} (MONITOR) is missing evidence`);
    }
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) errors.push(`${task.id} depends on ${dependency}, which is missing from the roadmaps`);
    }
    for (const dependency of task.dependencyAnyOf) {
      if (!ids.has(dependency)) errors.push(`${task.id} depends on ${dependency}, which is missing from the roadmaps`);
    }
  }
  for (const [program, status] of Object.entries(programs)) {
    const source = program === 'usability' ? UX_PATH : ACC_PATH;
    if (status === 'COMPLETE' && ordered.some((task) => task.source === source && !TERMINAL_STATUSES.has(task.status))) {
      errors.push(`${program} program is COMPLETE but has unfinished tasks`);
    }
  }
  return { tasks: ordered, programs, errors: [...new Set(errors)].sort() };
}

export function compareRoadmaps(baseline, candidate) {
  const errors = [];
  const candidateById = new Map(candidate.tasks.map((task) => [task.id, task]));
  for (const previous of baseline.tasks) {
    const current = candidateById.get(previous.id);
    if (!current) {
      errors.push(`${previous.id} was deleted from the roadmaps`);
      continue;
    }
    if (TERMINAL_STATUSES.has(previous.status) && current.status !== previous.status) {
      errors.push(`${previous.id} terminal status changed from ${previous.status} to ${current.status ?? 'INVALID'}`);
    }
  }
  return errors.sort();
}

function isIsoDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

// Every field is checked independently so malformed snapshots fail closed with complete diagnostics.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function validateSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return ['snapshot must be an object'];
  for (const key of Object.keys(snapshot)) {
    if (!SNAPSHOT_FIELDS.has(key)) errors.push(`snapshot has unknown field ${key}`);
  }
  if (snapshot.schemaVersion !== 1) errors.push('snapshot schemaVersion must be 1');
  if (snapshot.complete !== true) errors.push('snapshot complete must be true');
  if (snapshot.truncated !== false) errors.push('snapshot truncated must be false');
  if (snapshot.baseBranch !== 'main') errors.push('snapshot baseBranch must be main');
  if (!['pull_request', 'merge_group', 'schedule', 'workflow_dispatch'].includes(snapshot.eventType)) {
    errors.push('snapshot eventType is invalid');
  }
  if (!Array.isArray(snapshot.candidatePrNumbers)
    || snapshot.candidatePrNumbers.length > 32
    || snapshot.candidatePrNumbers.some((number) => !Number.isSafeInteger(number) || number < 1)
    || new Set(snapshot.candidatePrNumbers).size !== snapshot.candidatePrNumbers.length) {
    errors.push('snapshot candidatePrNumbers is invalid');
  }
  if (!isIsoDate(snapshot.generatedAt)) errors.push('snapshot generatedAt must be an ISO date');
  if (!Array.isArray(snapshot.pullRequests)) return [...errors, 'snapshot pullRequests must be an array'];
  if (snapshot.pullRequests.length > 512) errors.push('snapshot pullRequests must contain at most 512 entries');
  const numbers = new Set();
  for (const [index, pull] of snapshot.pullRequests.entries()) {
    const label = `snapshot pullRequests[${index}]`;
    if (!pull || typeof pull !== 'object' || Array.isArray(pull)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    for (const key of Object.keys(pull)) {
      if (!PR_FIELDS.has(key)) errors.push(`${label} has unknown field ${key}`);
    }
    if (!Number.isSafeInteger(pull.number) || pull.number < 1) errors.push(`${label} has invalid number`);
    if (numbers.has(pull.number)) errors.push(`${label} duplicates PR #${pull.number}`);
    numbers.add(pull.number);
    if (!['OPEN', 'CLOSED', 'MERGED'].includes(pull.state)) errors.push(`${label} has invalid state`);
    if (pull.base !== 'main') errors.push(`${label} must target base main`);
    if (typeof pull.draft !== 'boolean') errors.push(`${label} draft must be boolean`);
    if (typeof pull.title !== 'string' || pull.title.length > 512) errors.push(`${label} title is invalid`);
    if (typeof pull.body !== 'string' || pull.body.length > 131_072) errors.push(`${label} body is invalid`);
    if (!isIsoDate(pull.updatedAt)) errors.push(`${label} updatedAt must be an ISO date`);
    if (pull.mergedAt !== null && !isIsoDate(pull.mergedAt)) errors.push(`${label} mergedAt is invalid`);
    if (pull.state === 'MERGED' && !isIsoDate(pull.mergedAt)) errors.push(`${label} MERGED state requires mergedAt`);
    if (pull.state !== 'MERGED' && pull.mergedAt !== null) errors.push(`${label} non-MERGED state cannot have mergedAt`);
  }
  if (Array.isArray(snapshot.candidatePrNumbers)) {
    for (const number of snapshot.candidatePrNumbers) {
      if (!numbers.has(number)) errors.push(`snapshot candidate PR #${number} is missing from pullRequests`);
    }
    if (['schedule', 'workflow_dispatch'].includes(snapshot.eventType)
      && snapshot.candidatePrNumbers.length > 0) {
      errors.push(`snapshot ${snapshot.eventType} event cannot have candidate PRs`);
    }
  }
  return errors;
}

function idsClaimedBy(pull) {
  const titleIds = pull.title.match(TASK_ID) ?? [];
  const bodyIds = [...pull.body.matchAll(/\bRoadmap task:\s*((?:UX|ACC)-\d{3})\b/gi)]
    .map((match) => match[1].toUpperCase());
  return [...new Set([...titleIds, ...bodyIds])];
}

function eligibleTask(tasks, openClaims) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const eligible = tasks.filter((task) => task.status === 'TODO'
    && !openClaims.has(task.id)
    && task.dependencies.every((id) => TERMINAL_STATUSES.has(byId.get(id)?.status))
    && (task.dependencyAnyOf.length === 0
      || task.dependencyAnyOf.some((id) => TERMINAL_STATUSES.has(byId.get(id)?.status))));
  return eligible.find((task) => task.id.startsWith('UX-')) ?? eligible[0];
}

// Reconciliation deliberately evaluates every task and claim before producing a deterministic report.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function reconcileRoadmaps(state, snapshot = null, context = {}) {
  const blocking = [...state.errors];
  const advisory = [];
  const tasks = [...state.tasks].sort((left, right) => left.id.localeCompare(right.id));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const baseBranch = context.baseBranch ?? 'main';
  const now = Date.parse(context.now ?? new Date().toISOString());
  const pulls = snapshot?.pullRequests?.filter((pull) => pull.base === baseBranch) ?? [];
  const pullsByNumber = new Map(pulls.map((pull) => [pull.number, pull]));
  const candidatePrNumbers = snapshot ? new Set(snapshot.candidatePrNumbers) : new Set();
  const claims = new Map();

  for (const pull of pulls) {
    const claimedIds = idsClaimedBy(pull);
    if (pull.state === 'OPEN' && claimedIds.length > 1) {
      const message = `candidate PR #${pull.number} must claim exactly one roadmap task; found ${claimedIds.join(', ')}`;
      if (candidatePrNumbers.has(pull.number)) blocking.push(message);
      else advisory.push(message);
    }
    for (const id of claimedIds) {
      if (pull.state === 'OPEN') {
        if (!claims.has(id)) claims.set(id, []);
        claims.get(id).push(pull);
      }
      if (!byId.has(id) && pull.state === 'OPEN') {
        const message = `${id} is claimed by open PR #${pull.number} but is missing from the roadmaps`;
        if (candidatePrNumbers.has(pull.number)) blocking.push(message);
        else advisory.push(message);
      } else if (pull.state === 'OPEN' && byId.has(id)) {
        const task = byId.get(id);
        const evidenceTransition = EVIDENCE_STATUSES.has(task.status) && task.evidencePrs.includes(pull.number);
        if (task.status !== 'IN_REVIEW' && !evidenceTransition) {
          const prefix = candidatePrNumbers.has(pull.number) ? `candidate PR #${pull.number}` : `open PR #${pull.number}`;
          blocking.push(`${id} is claimed by ${prefix} but its roadmap status is ${task.status}; expected IN_REVIEW`);
        }
      }
    }
  }

  if (Number.isFinite(now)) {
    const today = new Date(now).toISOString().slice(0, 10);
    for (const task of tasks) {
      if (WAIT_STATUSES.has(task.status) && task.reviewAfter && task.reviewAfter < today) {
        advisory.push(`${task.id} review overdue since ${task.reviewAfter}`);
      }
    }
  }

  for (const [id, taskClaims] of claims) {
    taskClaims.sort((left, right) => left.number - right.number);
    if (taskClaims.length > 1 && byId.has(id)) {
      const claimNumbers = taskClaims.map((pull) => `#${pull.number}`).join(', ');
      blocking.push(`${id} has multiple open claims: ${claimNumbers}`);
    }
    for (const pull of taskClaims) {
      if (Number.isFinite(now) && now - Date.parse(pull.updatedAt) > 72 * 60 * 60 * 1000) {
        advisory.push(`${id} claim #${pull.number} is stalled beyond 72 hours (last update ${pull.updatedAt})`);
      }
    }
  }

  if (snapshot) {
    for (const task of tasks) {
      const taskClaims = claims.get(task.id) ?? [];
      if (task.status === 'IN_REVIEW') {
        const referenced = task.evidencePrs.map((number) => pullsByNumber.get(number)).filter(Boolean);
        const merged = referenced.find((pull) => pull.state === 'MERGED');
        if (merged) blocking.push(`${task.id} is active but referenced PR #${merged.number} is merged`);
        if (taskClaims.length === 0 && !merged) blocking.push(`${task.id} is active but has no open PR claim`);
      }
      if (EVIDENCE_STATUSES.has(task.status)) {
        for (const number of task.evidencePrs) {
          const evidence = pullsByNumber.get(number);
          if (!evidence) {
            blocking.push(`${task.id} evidence PR #${number} is missing from the complete snapshot`);
          } else if (evidence.state !== 'MERGED') {
            if (!candidatePrNumbers.has(number)) {
              blocking.push(`${task.id} evidence PR #${number} is not merged (state ${evidence.state})`);
            } else if (!idsClaimedBy(evidence).includes(task.id)) {
              blocking.push(`${task.id} evidence PR #${number} does not claim ${task.id}`);
            }
          }
        }
      }
    }
  }

  const openClaimIds = new Set(claims.keys());
  const nextEligible = eligibleTask(tasks, openClaimIds) ?? null;
  if (nextEligible) advisory.push(`Next eligible task is ${nextEligible.id}: ${nextEligible.title}`);
  return {
    blocking: [...new Set(blocking)].sort(),
    advisory: [...new Set(advisory)].sort(),
    nextEligible,
    counts: tasks.reduce((counts, task) => {
      counts[task.status ?? 'INVALID'] = (counts[task.status ?? 'INVALID'] ?? 0) + 1;
      return counts;
    }, {}),
    programs: state.programs,
  };
}

function markdownList(items, empty) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${empty}`;
}

export function renderWatchdog(report) {
  const counts = Object.entries(report.counts).sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}: ${count}`).join(' | ');
  const next = report.nextEligible
    ? `**Next eligible task:** ${report.nextEligible.id} — ${report.nextEligible.title}`
    : '**Next eligible task:** none';
  const body = [
    '<!-- crystal-ball-roadmap-controller:v1 -->',
    '# Roadmap controller',
    '',
    `Accuracy program: ${report.programs?.accuracy ?? 'INVALID'} | Usability program: ${report.programs?.usability ?? 'INVALID'}`,
    '',
    counts || 'No tasks parsed.',
    '',
    next,
    '',
    '## Blocking',
    '',
    markdownList(report.blocking, 'None.'),
    '',
    '## Advisory',
    '',
    markdownList(report.advisory, 'None.'),
  ].join('\n');
  const digest = createHash('sha256').update(body).digest('hex');
  return `${body}\n\n<!-- roadmap-body-sha256:${digest} -->\n`;
}

function usage(message) {
  if (message) console.error(message);
  console.error(`Usage: node ${path.basename(process.argv[1] ?? 'roadmap-controller.mjs')} [--snapshot FILE] [--baseline-ux FILE --baseline-acc FILE] [--format markdown|json] [--output FILE] [--references-output FILE]`);
  return 2;
}

function parseArgs(argv) {
  const options = {
    snapshot: null, baselineUx: null, baselineAcc: null, format: 'markdown', output: null,
    referencesOutput: null,
  };
  const valueOptions = new Map([
    ['--snapshot', 'snapshot'],
    ['--baseline-ux', 'baselineUx'],
    ['--baseline-acc', 'baselineAcc'],
    ['--format', 'format'],
    ['--output', 'output'],
    ['--references-output', 'referencesOutput'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (valueOptions.has(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      options[valueOptions.get(arg)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (!['markdown', 'json'].includes(options.format)) throw new Error(`invalid format ${options.format}`);
  if (Boolean(options.baselineUx) !== Boolean(options.baselineAcc)) {
    throw new Error('--baseline-ux and --baseline-acc must be supplied together');
  }
  return options;
}

function writeReferenceExport(state, outputPath) {
  if (!outputPath) return;
  const references = [...new Set(state.tasks.flatMap((task) => task.evidencePrs))]
    .sort((left, right) => left - right);
  writeFileSync(path.resolve(outputPath), `${JSON.stringify(references)}\n`);
}

export function runCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    return usage(error.message);
  }
  const files = {};
  try {
    files[UX_PATH] = readFileSync(path.resolve(UX_PATH), 'utf8');
    files[ACC_PATH] = readFileSync(path.resolve(ACC_PATH), 'utf8');
  } catch (error) {
    console.error(`invalid roadmap input: ${error.message}`);
    return 2;
  }
  const state = parseRoadmaps(files);
  writeReferenceExport(state, options.referencesOutput);
  if (options.baselineUx && options.baselineAcc) {
    try {
      const baseline = parseRoadmaps({
        [UX_PATH]: readFileSync(path.resolve(options.baselineUx), 'utf8'),
        [ACC_PATH]: readFileSync(path.resolve(options.baselineAcc), 'utf8'),
      });
      state.errors.push(...compareRoadmaps(baseline, state));
    } catch (error) {
      console.error(`invalid baseline roadmap input: ${error.message}`);
      return 2;
    }
  }
  let githubSnapshot = null;
  if (options.snapshot) {
    try {
      githubSnapshot = JSON.parse(readFileSync(path.resolve(options.snapshot), 'utf8'));
    } catch (error) {
      console.error(`invalid snapshot JSON: ${error.message}`);
      return 2;
    }
    const snapshotErrors = validateSnapshot(githubSnapshot);
    if (snapshotErrors.length > 0) {
      const formattedErrors = snapshotErrors.map((item) => `- ${item}`).join('\n');
      console.error(`invalid snapshot input:\n${formattedErrors}`);
      return 2;
    }
  }
  const report = reconcileRoadmaps(state, githubSnapshot, {
    now: githubSnapshot?.generatedAt ?? new Date().toISOString(),
    baseBranch: 'main',
  });
  const rendered = options.format === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderWatchdog(report);
  if (options.output) writeFileSync(path.resolve(options.output), rendered);
  else process.stdout.write(rendered);
  return report.blocking.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli();
}

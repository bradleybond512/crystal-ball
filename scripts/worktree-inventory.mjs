#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_LIMITS = Object.freeze({
  metadataMs: 30_000, statusMs: 60_000, patchMs: 60_000, commandMs: 5000,
  outputBytes: 16 * 1024 * 1024, maxRefs: 10_000, maxWorktrees: 2000,
  maxAncestryTips: 256, commitsPerRef: 128, totalCommits: 512,
  patchBytes: 2 * 1024 * 1024, totalPatchBytes: 32 * 1024 * 1024,
});
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const fullRef = value => typeof value === 'string' && /^refs\/(heads|remotes)\/.+/.test(value)
  && !/[\u0000-\u0020\u007F~^:?*[\\]/.test(value) && !value.includes('..') && !value.includes('@{')
  && !value.includes('//') && !value.endsWith('/') && !value.endsWith('.')
  && value.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock'));
const safePath = value => typeof value === 'string' && value.length > 0 && !value.includes('\0');
const oneLine = value => value.endsWith('\n') ? value.slice(0, -1) : value;
const unknown = reason => ({ state: 'unknown', complete: false, reason });
const fresh = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && Date.parse(value) <= now && now - Date.parse(value) <= 86_400_000;

function limitsFor(overrides = {}) {
  if (!exact(overrides, Object.keys(DEFAULT_LIMITS))) throw new Error('invalid-limits');
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) throw new Error('invalid-limits');
  }
  return limits;
}

export function gitEnvironment() {
  const env = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'TMPDIR']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_ALLOW_PROTOCOL: '', GIT_PROTOCOL_FROM_USER: '0' };
}

function oid(value) {
  if (!oidPattern.test(value)) throw new Error('invalid-oid');
  return value;
}
function ref(value) {
  if (!fullRef(value)) throw new Error('invalid-ref');
  return value;
}

function argumentsFor(operation, values) {
  switch (operation) {
    case 'common': { return ['rev-parse', '--path-format=absolute', '--git-common-dir'];
    }
    case 'base': { return ['rev-parse', '--verify', '--end-of-options', `${ref(values[0])}^{commit}`];
    }
    case 'head': { return ['rev-parse', '--verify', 'HEAD'];
    }
    case 'index': { return ['rev-parse', '--path-format=absolute', '--git-path', 'index'];
    }
    case 'shallow': { return ['rev-parse', '--is-shallow-repository'];
    }
    case 'config': { return ['config', '--null', '--get-regexp', String.raw`^(remote\..*\.(url|promisor)|filter\..*\.(clean|process))$`];
    }
    case 'refs': { return ['for-each-ref', '--sort=refname', '--format=%(refname)%00%(objectname)%00%(objecttype)%00', 'refs/heads/', 'refs/remotes/'];
    }
    case 'worktrees': { return ['worktree', 'list', '--porcelain', '-z'];
    }
    case 'ancestor': { return ['merge-base', '--is-ancestor', oid(values[0]), oid(values[1])];
    }
    case 'status': { return ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignore-submodules=all'];
    }
    case 'tree': { return ['rev-parse', '--verify', `${oid(values[0])}^{tree}`];
    }
    case 'commits': {
      if (!Number.isSafeInteger(values[2]) || values[2] < 1 || values[2] > DEFAULT_LIMITS.commitsPerRef + 1) throw new Error('invalid-limit');
      return ['rev-list', '--left-right', '--parents', `--max-count=${values[2]}`, `${oid(values[0])}...${oid(values[1])}`, '--'];
    }
    case 'patch': { return ['show', '--format=', '--root', '--no-show-signature', '--no-notes', '--no-color',
      '--submodule=short', '--no-relative', '--ignore-submodules=none', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', oid(values[0]), '--'];
    }
    case 'patch-id': { return ['patch-id', '--stable'];
    }
    default: { throw new Error('operation-not-allowed');
    }
  }
}

function executor(limits, dependencies) {
  const spawn = dependencies.spawn ?? spawnSync;
  const now = dependencies.now ?? Date.now;
  let deadline = now() + limits.metadataMs;
  let calls = 0;
  return {
    phase(ms) { deadline = now() + Math.max(0, ms); },
    remaining() { return Math.max(0, deadline - now()); },
    calls() { return calls; },
    run(repo, operation, values = [], input, outputCap = limits.outputBytes) {
      if (!safePath(repo)) return { ok: false, reason: 'invalid-path' };
      const remaining = deadline - now();
      if (remaining <= 0) return { ok: false, reason: 'phase-time-limit' };
      let args;
      try { args = argumentsFor(operation, values); } catch { return { ok: false, reason: 'invalid-command-input' }; }
      calls++;
      let result;
      try {
        result = spawn('/usr/bin/git', ['--no-optional-locks', '-c', 'protocol.allow=never', '-c', 'core.fsmonitor=false',
          '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'core.untrackedCache=false',
          '-c', 'core.hooksPath=/dev/null', ...args], {
          cwd: repo, env: gitEnvironment(), encoding: null, input, shell: false,
          timeout: Math.max(1, Math.min(limits.commandMs, remaining)), killSignal: 'SIGKILL',
          maxBuffer: Math.min(limits.outputBytes, outputCap), stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch { return { ok: false, reason: 'git-execution-failed' }; }
      return capturedOutput(result, operation, Math.min(limits.outputBytes, outputCap));
    },
  };
}

function capturedOutput(result, operation, cap) {
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const observedBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
  const overflow = result.error?.code === 'ENOBUFS' || observedBytes > cap;
  const receipt = { observedBytes, overflow };
  if (result.error || result.signal || overflow) {
    return { ...receipt, ok: false, reason: result.error?.code === 'ETIMEDOUT' ? 'command-time-limit' : 'command-output-or-execution-limit' };
  }
  if (stderr.length) return { ...receipt, ok: false, reason: 'git-warning-or-error' };
  if (result.status !== 0 && !(['ancestor', 'config'].includes(operation) && result.status === 1)) return { ...receipt, ok: false, reason: 'git-command-failed' };
  const text = stdout.toString('utf8');
  if (!Buffer.isBuffer(stdout) || !Buffer.from(text, 'utf8').equals(stdout)) {
    return { ...receipt, ok: false, reason: operation === 'patch' ? 'patch-encoding-unsupported' : 'git-output-encoding-unsupported' };
  }
  return { ...receipt, ok: true, status: result.status, text };
}

function remoteIdentity(value) {
  const parsed = /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(value);
  return parsed ? parsed[1].toLowerCase() : null;
}

function parseConfig(text) {
  const remotes = new Map();
  let filters = false;
  let partial = false;
  for (const entry of text.split('\0').filter(Boolean)) {
    const split = entry.indexOf('\n');
    if (split === -1) throw new Error('invalid-config');
    const key = entry.slice(0, split);
    const value = entry.slice(split + 1);
    filters ||= /^filter\..*\.(clean|process)$/.test(key) && Boolean(value.trim());
    partial ||= /^remote\..*\.promisor$/.test(key) && /^(true|yes|on|1)$/i.test(value);
    const match = /^remote\.(.*)\.url$/.exec(key);
    if (!match) continue;
    const identity = remoteIdentity(value);
    remotes.set(match[1], remotes.has(match[1]) && remotes.get(match[1]) !== identity ? null : identity);
  }
  return { remotes, filters, partial };
}

function parseRefs(text) {
  if (text && !text.endsWith('\0\n')) throw new Error('incomplete-ref-output');
  return text.split('\0\n').filter(Boolean).map(entry => {
    const [ref, oid, type, ...extra] = entry.split('\0');
    if (extra.length || !fullRef(ref) || !oidPattern.test(oid) || type !== 'commit') throw new Error('invalid-ref-output');
    return { ref, oid, kind: ref.startsWith('refs/heads/') ? 'local' : 'cached-tracking' };
  });
}

function parseWorktrees(text) {
  if (text && !text.endsWith('\0\0')) throw new Error('incomplete-worktree-output');
  return text.split('\0\0').filter(Boolean).map(record => {
    const item = { path: null, head: null, branch: null, detached: false, locked: false, prunable: false };
    for (const field of record.split('\0')) {
      if (field.startsWith('worktree ')) item.path = field.slice(9);
      else if (field.startsWith('HEAD ')) item.head = field.slice(5);
      else if (field.startsWith('branch ')) item.branch = field.slice(7);
      else if (field === 'detached') item.detached = true;
      else if (field === 'locked' || field.startsWith('locked ')) item.locked = true;
      else if (field === 'prunable' || field.startsWith('prunable ')) item.prunable = true;
      else if (field !== 'bare') throw new Error('invalid-worktree-output');
    }
    if (!safePath(item.path) || !path.isAbsolute(item.path) || (item.head !== null && !oidPattern.test(item.head))
      || (item.branch !== null && !fullRef(item.branch))) throw new Error('invalid-worktree-output');
    return { ...item, status: { state: 'not-requested', complete: false } };
  });
}

function metadata(repo, baseRef, run) {
  const results = Object.fromEntries(['base', 'refs', 'worktrees', 'config', 'shallow'].map(op => [op, run.run(repo, op, op === 'base' ? [baseRef] : [])]));
  const failed = Object.values(results).find(result => !result.ok);
  if (failed) throw new Error(failed.reason);
  const base = oneLine(results.base.text);
  if (!oidPattern.test(base)) throw new Error('invalid-base-output');
  const config = parseConfig(results.config.text);
  const remote = baseRef.startsWith('refs/remotes/') ? baseRef.slice(13).split('/')[0] : null;
  const identities = new Set(config.remotes.values());
  let identity = identities.size === 1 ? [...identities][0] : null;
  if (remote) identity = config.remotes.get(remote) ?? null;
  return { base, refs: parseRefs(results.refs.text), worktrees: parseWorktrees(results.worktrees.text), config, identity,
    shallow: oneLine(results.shallow.text) !== 'false', fingerprint: digest(results.base.text + results.refs.text + results.worktrees.text + results.config.text + results.shallow.text) };
}

function ancestry(repo, base, tip, limited, run) {
  const result = { baseOid: base, tipOid: tip };
  if (base === tip) return { ...result, state: 'equal' };
  if (limited) return { ...result, state: 'unknown', reason: 'incomplete-history' };
  const contained = run.run(repo, 'ancestor', [tip, base]);
  if (!contained.ok) return { ...result, state: 'unknown', reason: contained.reason };
  if (contained.status === 0) return { ...result, state: 'tip-ancestor' };
  const ahead = run.run(repo, 'ancestor', [base, tip]);
  if (!ahead.ok) return { ...result, state: 'unknown', reason: ahead.reason };
  return { ...result, state: ahead.status === 0 ? 'base-ancestor' : 'diverged' };
}

function indexIdentity(repo, run, limits) {
  const head = run.run(repo, 'head');
  const index = run.run(repo, 'index');
  if (!head.ok || !index.ok || !oidPattern.test(oneLine(head.text))) throw new Error('status-identity-unavailable');
  const indexPath = oneLine(index.text);
  if (!path.isAbsolute(indexPath)) throw new Error('status-identity-unavailable');
  try {
    return { head: oneLine(head.text), index: digest(readBounded(indexPath, limits.outputBytes)) };
  } catch { throw new Error('status-index-unavailable'); }
}

function countedStatus(row, counts) {
  const mode = '[0-7]{6}';
  const hash = '(?:[a-f0-9]{40}|[a-f0-9]{64})';
  const submodule = String.raw`(?:N\.\.\.|S[.C][.M][.U])`;
  const prefix = String.raw`^[12u] [\s\S]{2} ${submodule} `;
  const ending = row[0] === 'u' ? `(?:${mode} ){4}(?:${hash} ){3}` : `(?:${mode} ){3}(?:${hash} ){2}`;
  const score = row[0] === '2' ? '[RC][0-9]+ ' : '';
  if (!new RegExp(prefix + ending + score + String.raw`[\s\S]+$`).test(row)) throw new Error('invalid-status-output');
  const xy = row.slice(2, 4);
  if (!/^[.MADRCUT?!]{2}$/.test(xy)) throw new Error('invalid-status-output');
  if (row[0] === 'u') { counts.conflicted++; return; }
  if (xy[0] !== '.') counts.staged++;
  if (xy[1] !== '.') counts.unstaged++;
}

function statusCounts(text) {
  if (text && !text.endsWith('\0')) throw new Error('incomplete-status-output');
  const counts = { staged: 0, unstaged: 0, conflicted: 0, untracked: 0 };
  const records = text.split('\0');
  for (let i = 0; i < records.length - 1; i++) {
    const row = records[i];
    if (row.startsWith('? ') && row.length > 2) { counts.untracked++; continue; }
    if (!/^[12u] /.test(row)) throw new Error('invalid-status-output');
    countedStatus(row, counts);
    if (row[0] === '2' && !records[++i]) throw new Error('invalid-status-output');
  }
  return counts;
}

function statusFor(worktree, common, run, limits, now) {
  const limitations = ['ignored-files-unassessed', 'submodule-contents-unassessed', 'non-atomic-observation', 'owner-activity-unknown'];
  const observedAt = new Date(now()).toISOString();
  try {
    if (!statSync(worktree.path).isDirectory()) return { ...unknown('worktree-unavailable'), observedAt, limitations };
    const registered = run.run(worktree.path, 'common');
    if (!registered.ok || realpathSync(oneLine(registered.text)) !== common) return { ...unknown('worktree-repository-changed'), observedAt, limitations };
    const config = run.run(worktree.path, 'config');
    if (!config.ok) return { ...unknown(config.reason), observedAt, limitations };
    if (parseConfig(config.text).filters) return { ...unknown('external-filter-configured'), observedAt, limitations };
    const before = indexIdentity(worktree.path, run, limits);
    const result = run.run(worktree.path, 'status');
    if (!result.ok) return { ...unknown(result.reason), observedAt, limitations };
    const after = indexIdentity(worktree.path, run, limits);
    if (before.head !== after.head || before.index !== after.index) return { ...unknown('status-identity-changed'), observedAt, limitations, consistency: false };
    return { state: 'observed', complete: true, counts: statusCounts(result.text), observedAt, limitations, consistency: true };
  } catch { return { ...unknown('status-unavailable'), observedAt, limitations }; }
}

function validPrSnapshot(value, now) {
  if (!exact(value, ['schemaVersion', 'repository', 'generatedAt', 'complete', 'truncated', 'pagination', 'pullRequests'])
    || value.schemaVersion !== 1 || !repoPattern.test(value.repository) || !fresh(value.generatedAt, now)
    || value.complete !== true || value.truncated !== false
    || !exact(value.pagination, ['complete', 'pages']) || value.pagination.complete !== true
    || !Number.isSafeInteger(value.pagination.pages) || value.pagination.pages < 1
    || !Array.isArray(value.pullRequests) || value.pullRequests.length > 10_000) return false;
  const identities = new Set();
  return value.pullRequests.every(pr => {
    const side = (input, isHead) => exact(input, isHead ? ['repository', 'ref', 'oid'] : ['repository', 'ref'])
      && repoPattern.test(input.repository) && fullRef(input.ref) && input.ref.startsWith('refs/heads/')
      && (!isHead || oidPattern.test(input.oid));
    if (!exact(pr, ['number', 'state', 'head', 'base']) || !Number.isSafeInteger(pr.number) || pr.number < 1
      || identities.has(pr.number) || !['OPEN', 'CLOSED', 'MERGED'].includes(pr.state) || !side(pr.head, true) || !side(pr.base, false)
      || pr.base.repository.toLowerCase() !== value.repository.toLowerCase()) return false;
    identities.add(pr.number);
    return true;
  });
}

function ownership(ref, config, identity, snapshot, valid) {
  if (snapshot === undefined) return unknown('pr-snapshot-not-supplied');
  if (!valid || !identity || snapshot.repository.toLowerCase() !== identity) return unknown('pr-snapshot-invalid-stale-or-mismatched');
  let headRepo = identity;
  let headRef = ref.ref;
  if (ref.kind === 'cached-tracking') {
    const segments = ref.ref.slice(13).split('/');
    headRepo = config.remotes.get(segments.shift());
    headRef = `refs/heads/${segments.join('/')}`;
  }
  if (!headRepo) return unknown('head-repository-unknown');
  const matches = snapshot.pullRequests.filter(pr => pr.state === 'OPEN' && pr.head.repository.toLowerCase() === headRepo && pr.head.ref === headRef);
  const prs = matches.map(pr => ({ number: pr.number, state: pr.state, oidMatches: pr.head.oid === ref.oid }));
  const drift = prs.some(pr => !pr.oidMatches);
  let state = prs.length ? 'matched' : 'no-matching-open-pr-in-snapshot';
  if (drift) state = 'unknown';
  return { state, complete: !drift,
    ...(drift ? { reason: 'head-oid-mismatch' } : {}), source: 'supplied-snapshot', supplierDeclaredComplete: true,
    observedAt: snapshot.generatedAt, prs, ownerActivity: 'unknown' };
}

function validRecovery(value, now) {
  if (!exact(value, ['schemaVersion', 'generatedAt', 'provenance', 'records']) || value.schemaVersion !== 1
    || !fresh(value.generatedAt, now) || typeof value.provenance !== 'string' || value.provenance.length < 1 || value.provenance.length > 1024
    || !Array.isArray(value.records) || value.records.length > 10_000) return false;
  return value.records.every(record => exact(record, ['repository', 'oid', 'verifiedAt', 'independentCopy', 'verification', 'coversCommitted', 'coversUntracked', 'coveredFiles'])
    && repoPattern.test(record.repository) && oidPattern.test(record.oid) && fresh(record.verifiedAt, now)
    && record.independentCopy === true && record.coversCommitted === true && typeof record.coversUntracked === 'boolean'
    && exact(record.verification, ['method', 'digest']) && ['read-back', 'restore-test'].includes(record.verification.method)
    && /^[a-f0-9]{64}$/.test(record.verification.digest) && Array.isArray(record.coveredFiles)
    && record.coveredFiles.length <= 10_000 && record.coveredFiles.every(value => safePath(value)));
}

function recovery(ref, identity, snapshot, valid) {
  if (!valid || !identity) return { ...unknown(snapshot === undefined ? 'recovery-evidence-not-supplied' : 'recovery-evidence-invalid-or-stale'), collectorVerified: false };
  const record = snapshot.records.find(item => item.repository.toLowerCase() === identity && item.oid === ref.oid);
  if (!record) return { ...unknown('recovery-coverage-unknown'), collectorVerified: false };
  return { state: 'supplied-verification-record', complete: true, collectorVerified: false,
    provenanceHash: digest(snapshot.provenance), verifiedAt: record.verifiedAt, verification: { ...record.verification },
    coveredOid: record.oid, coversUntracked: record.coversUntracked, coveredFileCount: record.coveredFiles.length };
}

function commitItems(text) {
  return text.trim().split('\n').filter(Boolean).map(line => {
    const [marked, ...parents] = line.split(' ');
    if (!/^[<>]/.test(marked) || !oidPattern.test(marked.slice(1)) || parents.some(parent => !oidPattern.test(parent))) throw new Error('invalid-commit-output');
    return { oid: marked.slice(1), side: marked[0] === '<' ? 'base' : 'tip', parents };
  });
}

function patchFor(repo, item, index, run, limits, budget) {
  if (index >= limits.commitsPerRef || budget.commits >= limits.totalCommits) return { reason: 'commit-limit' };
  if (item.parents.length > 1) return { reason: 'merge-commit-unassessed' };
  if (budget.stopped) return { reason: 'prior-patch-output-overflow' };
  if (budget.bytes >= limits.totalPatchBytes) return { reason: 'aggregate-patch-byte-limit' };
  budget.commits++;
  const cap = Math.min(limits.outputBytes, limits.patchBytes, limits.totalPatchBytes - budget.bytes);
  budget.bytes += cap;
  const patch = run.run(repo, 'patch', [item.oid], undefined, cap);
  budget.bytes += Math.max(0, (patch.observedBytes ?? 0) - cap);
  if (patch.overflow) budget.stopped = true;
  if (!patch.ok) return { reason: patch.reason };
  budget.bytes -= cap - patch.observedBytes;
  if (!patch.text) return { reason: 'empty-commit' };
  if (/^GIT binary patch$/m.test(patch.text) || /^Binary files /m.test(patch.text)) return { reason: 'binary-patch-unassessed' };
  const id = run.run(repo, 'patch-id', [], patch.text);
  const match = id.ok ? /^([a-f0-9]{40}|[a-f0-9]{64}) [a-f0-9]+\n$/.exec(id.text) : null;
  return match ? { patchId: match[1] } : { reason: id.reason ?? 'patch-id-unavailable' };
}

function patchMatches(result, groups) {
  for (const [tipCommit, patchId] of groups.tip) {
    const matches = [...groups.base].filter(([, id]) => id === patchId);
    for (const [baseCommit] of matches) result.matches.push({ tipCommit, baseCommit, patchId });
    if (!matches.length) result.unmatched.push({ oid: tipCommit, side: 'tip', state: 'unmatched-in-examined-scope' });
  }
  for (const [baseCommit, patchId] of groups.base) {
    if (![...groups.tip.values()].includes(patchId)) result.unmatched.push({ oid: baseCommit, side: 'base', state: 'unmatched-in-examined-scope' });
  }
}

function treeEquality(repo, base, tip, run) {
  const a = run.run(repo, 'tree', [base]);
  const b = run.run(repo, 'tree', [tip]);
  if (!a.ok || !b.ok || !oidPattern.test(oneLine(a.text)) || !oidPattern.test(oneLine(b.text))) return 'unknown';
  return a.text === b.text ? 'equal' : 'different';
}

function patches(repo, base, tip, run, limits, budget) {
  const result = { treeEquality: treeEquality(repo, base, tip, run), complete: false, matches: [], unmatched: [], omitted: [], uniqueWork: 'unresolved' };
  if (result.treeEquality === 'unknown') return { ...result, reason: 'tree-unavailable' };
  if (result.treeEquality === 'equal') return { ...result, complete: true };
  const enumerated = run.run(repo, 'commits', [base, tip, limits.commitsPerRef + 1]);
  if (!enumerated.ok) return { ...result, reason: enumerated.reason };
  let items;
  try { items = commitItems(enumerated.text); } catch { return { ...result, reason: 'invalid-commit-output' }; }
  result.complete = items.length <= limits.commitsPerRef;
  if (!result.complete) result.reason = 'commit-enumeration-capped';
  const groups = { base: new Map(), tip: new Map() };
  for (const [index, item] of items.entries()) {
    const observed = patchFor(repo, item, index, run, limits, budget);
    if (observed.reason) {
      result.omitted.push({ oid: item.oid, side: item.side, reason: observed.reason });
      result.complete = false;
    } else groups[item.side].set(item.oid, observed.patchId);
  }
  patchMatches(result, groups);
  return result;
}

function validatedOptions(options) {
  if (!exact(options, ['repos', 'baseRef', 'statusWorktrees', 'patchRefs', 'prSnapshot', 'recoverySnapshot', 'limits'])
    || !Array.isArray(options.repos) || options.repos.length < 1 || options.repos.length > 64 || !options.repos.every(value => safePath(value))
    || !fullRef(options.baseRef) || !Array.isArray(options.statusWorktrees ?? []) || !(options.statusWorktrees ?? []).every(value => safePath(value))
    || (options.statusWorktrees ?? []).length > DEFAULT_LIMITS.maxWorktrees
    || !Array.isArray(options.patchRefs ?? []) || !(options.patchRefs ?? []).every(value => fullRef(value))
    || (options.patchRefs ?? []).length > DEFAULT_LIMITS.maxRefs) throw new Error('invalid-input');
  return limitsFor(options.limits);
}

function hasGrafts(common) {
  try { return statSync(path.join(common, 'info/grafts')).size > 0; }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new Error('graft-state-unavailable');
  }
}

function refEvidence(ref, context, data, repo, cache, counters) {
  const { limits, run, options, validPr, validCopy, fail } = context;
  if (!cache.has(ref.oid)) {
    let result = { state: 'unknown', baseOid: data.base, tipOid: ref.oid, reason: 'ancestry-tip-limit' };
    if (counters.ancestry < limits.maxAncestryTips) {
      counters.ancestry++;
      result = ancestry(repo, data.base, ref.oid, data.shallow || data.grafted, run);
    }
    cache.set(ref.oid, result);
  }
  ref.ancestry = cache.get(ref.oid);
  if (ref.ancestry.state === 'unknown') fail('ancestry', ref.ref, ref.ancestry.reason);
  ref.ownership = ownership(ref, data.config, data.identity, options.prSnapshot, validPr);
  let identity = data.identity;
  if (ref.kind === 'cached-tracking') identity = data.config.remotes.get(ref.ref.slice(13).split('/')[0]);
  ref.recovery = recovery(ref, identity, options.recoverySnapshot, validCopy);
  if (options.prSnapshot !== undefined && ref.ownership.state === 'unknown') fail('ownership', ref.ref, ref.ownership.reason);
  if (options.recoverySnapshot !== undefined && ref.recovery.state === 'unknown') fail('recovery', ref.ref, ref.recovery.reason);
}

function collectRepository(alias, context, counters) {
  const { run, options, limits, internals, report, fail } = context;
  const repo = realpathSync(alias);
  const commonResult = run.run(repo, 'common');
  if (!commonResult.ok) throw new Error(commonResult.reason);
  const common = realpathSync(oneLine(commonResult.text));
  if (internals.has(common)) { internals.get(common).entry.aliases.push(alias); return; }
  const data = metadata(repo, options.baseRef, run);
  data.grafted = hasGrafts(common);
  const remainingRefs = Math.max(0, limits.maxRefs - counters.refs);
  const remainingWorktrees = Math.max(0, limits.maxWorktrees - counters.worktrees);
  const entry = { commonDirectory: common, aliases: [alias], identity: data.identity, base: { ref: options.baseRef, oid: data.base },
    limitations: { shallow: data.shallow, grafted: data.grafted, partialClone: data.config.partial, trackingRefs: 'cached-not-current-remote-confirmation', ownerActivity: 'unknown' },
    refs: data.refs.slice(0, remainingRefs), worktrees: data.worktrees.slice(0, remainingWorktrees),
    consistency: { startFingerprint: data.fingerprint, endFingerprint: null, unchanged: false, atomic: false } };
  counters.refs += entry.refs.length;
  counters.worktrees += entry.worktrees.length;
  for (const item of data.refs.slice(remainingRefs)) fail('refs', item.ref, 'record-limit');
  for (const item of data.worktrees.slice(remainingWorktrees)) fail('worktrees', item.path, 'record-limit');
  const cache = new Map();
  for (const ref of entry.refs) refEvidence(ref, context, data, repo, cache, counters);
  report.repositories.push(entry);
  internals.set(common, { entry, repo, data });
}

function selectedStatuses(context) {
  const { report, run, limits, fail, now } = context;
  const registered = new Map(report.repositories.flatMap(entry => entry.worktrees.map(item => [item.path, { item, common: entry.commonDirectory }])));
  run.phase(limits.statusMs);
  for (const selected of report.requested.statusWorktrees) {
    let canonical = selected;
    try { canonical = realpathSync(selected); } catch { /* Missing registered paths remain reportable. */ }
    const found = registered.get(canonical) ?? registered.get(selected);
    if (!found) { fail('status', selected, 'not-in-captured-registration'); continue; }
    found.item.status = statusFor(found.item, found.common, run, limits, now);
    if (!found.item.status.complete) fail('status', selected, found.item.status.reason);
  }
}

function selectedPatches(context) {
  const { report, run, limits, fail, internals } = context;
  run.phase(limits.patchMs);
  const budget = { commits: 0, bytes: 0 };
  for (const selected of report.requested.patchRefs) {
    let found = false;
    for (const { entry, repo } of internals.values()) {
      const ref = entry.refs.find(item => item.ref === selected);
      if (!ref) continue;
      found = true;
      ref.patchEvidence = entry.limitations.shallow || entry.limitations.grafted
        ? { ...unknown('incomplete-history'), treeEquality: 'unknown', matches: [], unmatched: [], omitted: [], uniqueWork: 'unresolved' }
        : patches(repo, entry.base.oid, ref.oid, run, limits, budget);
      if (!ref.patchEvidence.complete) fail('patches', selected, ref.patchEvidence.reason ?? 'unassessed-commits');
    }
    if (!found) fail('patches', selected, 'not-in-captured-refs');
  }
  return budget;
}

function endingEvidence(context, remaining) {
  const { run, options, fail, internals } = context;
  run.phase(remaining);
  for (const { entry, repo } of internals.values()) {
    try {
      const end = metadata(repo, options.baseRef, run);
      entry.consistency.endFingerprint = end.fingerprint;
      entry.consistency.unchanged = end.fingerprint === entry.consistency.startFingerprint;
      if (!entry.consistency.unchanged) {
        entry.consistency.reason = 'repository-metadata-changed';
        fail('consistency', entry.commonDirectory, entry.consistency.reason);
      }
    } catch {
      entry.consistency.reason = 'ending-metadata-unavailable';
      fail('consistency', entry.commonDirectory, entry.consistency.reason);
    }
  }
}

export function collectInventory(options, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const started = now();
  const report = { schemaVersion: 1, startedAt: new Date(started).toISOString(), complete: true, exitCode: 0, repositories: [], errors: [], skipped: [] };
  let limits;
  try { limits = validatedOptions(options); }
  catch { return { ...report, complete: false, exitCode: 1, finishedAt: new Date(now()).toISOString(), errors: [{ reason: 'invalid-input-or-limits' }] }; }
  report.limits = limits;
  report.requested = { repos: [...new Set(options.repos.map(value => path.resolve(value)))].sort(), baseRef: options.baseRef,
    statusWorktrees: [...new Set((options.statusWorktrees ?? []).map(value => path.resolve(value)))].sort(), patchRefs: [...new Set(options.patchRefs)].sort() };
  const run = executor(limits, dependencies);
  const validPr = validPrSnapshot(options.prSnapshot, started);
  const validCopy = validRecovery(options.recoverySnapshot, started);
  const fail = (dimension, id, reason) => { report.complete = false; report.skipped.push({ dimension, id, reason }); };
  const context = { now, run, limits, validPr, validCopy, fail, options, report, internals: new Map() };
  if (options.prSnapshot !== undefined && !validPr) fail('ownership', 'supplied-pr-snapshot', 'invalid-incomplete-or-stale');
  if (options.recoverySnapshot !== undefined && !validCopy) fail('recovery', 'supplied-recovery-snapshot', 'invalid-incomplete-or-stale');
  const counters = { refs: 0, worktrees: 0, ancestry: 0 };
  for (const alias of report.requested.repos) {
    try { collectRepository(alias, context, counters); }
    catch { report.complete = false; report.errors.push({ dimension: 'metadata', id: alias, reason: 'repository-metadata-unavailable' }); }
  }
  const metadataRemaining = run.remaining();
  selectedStatuses(context);
  const budget = selectedPatches(context);
  endingEvidence(context, metadataRemaining);
  report.counters = { gitCommands: run.calls(), examinedPatchCommits: budget.commits, patchBytes: budget.bytes };
  report.finishedAt = new Date(now()).toISOString();
  report.exitCode = report.complete ? 0 : 2;
  if (!report.repositories.length) report.exitCode = 1;
  return report;
}

function readBounded(file, maxBytes) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('file-unavailable-or-oversized');
    const bytes = Buffer.alloc(maxBytes + 1);
    let count = 0;
    while (count <= maxBytes) {
      const read = readSync(fd, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    if (count > maxBytes) throw new Error('file-size-limit');
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}

function snapshotFile(file) {
  if (!safePath(file)) throw new Error('snapshot-unavailable');
  return JSON.parse(readBounded(file, DEFAULT_LIMITS.outputBytes).toString('utf8'));
}

function main(args) {
  const options = { repos: [], statusWorktrees: [], patchRefs: [] };
  try {
    const flags = new Map([['--repo', 'repos'], ['--base-ref', 'baseRef'], ['--status-worktree', 'statusWorktrees'], ['--patch-ref', 'patchRefs'], ['--pr-snapshot', 'prSnapshot'], ['--recovery-snapshot', 'recoverySnapshot']]);
    for (let index = 0; index < args.length; index += 2) {
      const key = flags.get(args[index]);
      const value = args[index + 1];
      if (!key || !value) throw new Error('invalid-arguments');
      if (Array.isArray(options[key])) options[key].push(value);
      else if (Object.hasOwn(options, key)) throw new Error('duplicate-argument');
      else options[key] = key.endsWith('Snapshot') ? snapshotFile(value) : value;
    }
    const report = collectInventory(options);
    process.stdout.write(JSON.stringify(report) + '\n');
    process.exitCode = report.exitCode;
  } catch {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, complete: false, exitCode: 1, errors: [{ reason: 'invalid-arguments-or-snapshot' }] }) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));

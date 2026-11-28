import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/auto-merge-agent-branches.yml', import.meta.url), 'utf8'));
const steps = Object.values(workflow.jobs).flatMap(job => job.steps);
const scripts = steps.filter(step => step.with?.script);
const notice = steps.find(step => step.id === 'create-pr');
const label = steps.find(step => step.name === 'Label PR by branch prefix');
const disable = scripts.find(step => step.with.script.includes('disablePullRequestAutoMerge'));
const sha = 'a'.repeat(40);
const privateError = 'PRIVATE_API_MESSAGE_DO_NOT_LOG';
const clone = value => structuredClone(value);

function pull(overrides = {}) {
  return { number: 41, node_id: 'PR_fixture', state: 'open', draft: true, body: 'human-owned body',
    html_url: 'https://github.com/example/project/pull/41',
    head: { ref: 'codex/example', sha, repo: { full_name: 'example/project' } },
    base: { ref: 'main', repo: { full_name: 'example/project' } }, ...overrides };
}

function node(overrides = {}) {
  return { __typename: 'PullRequest', id: 'PR_fixture', number: 41, state: 'OPEN',
    headRefName: 'codex/example', baseRefName: 'main', headRepository: { nameWithOwner: 'example/project' },
    repository: { nameWithOwner: 'example/project' }, autoMergeRequest: { enabledAt: '2026-11-27T00:00:00Z' }, ...overrides };
}

async function execute(step, options = {}) {
  assert.ok(step?.with?.script, 'expected actual workflow JavaScript');
  const branch = options.branch ?? 'codex/example';
  const calls = [], logs = [], failures = [], outputs = {};
  const values = { 'github.ref_name': branch, 'github.sha': sha, 'steps.meta.outputs.branch': branch,
    'steps.meta.outputs.title': 'fixture title', 'steps.create-pr.outputs.pr_number': '41',
    'needs.auto-pr.outputs.pr_number': '41', 'needs.auto-pr.outputs.pr_node_id': 'PR_fixture',
    "secrets.AUTO_MERGE_PAT != ''": 'false' };
  const render = text => String(text).replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    assert.ok(Object.hasOwn(values, key), `unresolved expression ${key}`);
    return values[key];
  });
  const env = { ...Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, render(value)])), ...options.env };
  const response = Object.hasOwn(options, 'response') ? clone(options.response) : { data: clone(options.prs ?? [pull()]), headers: {} };
  const unchanged = clone(response);
  const record = (action, args) => calls.push({ action, args: clone(args) });
  const forbidden = action => async args => { record(action, args); return { data: pull() }; };
  const github = { rest: {
    pulls: { list: async args => { record('lookup', args); if (options.lookupError) throw options.lookupError; return response; },
      create: forbidden('create'), update: forbidden('update'), merge: forbidden('merge') },
    issues: { addLabels: async args => { record('label', args); if (options.labelError) throw options.labelError; return {}; } },
  }, graphql: async (query, args) => {
    const action = query.includes('disablePullRequestAutoMerge') ? 'disable' : /enablePullRequestAutoMerge|markPullRequestReadyForReview|convertPullRequestToDraft/.test(query) ? 'forbidden-graphql' : 'query';
    record(action, { query, variables: args });
    if (action === 'query') {
      if (options.queryError) throw options.queryError;
      return clone(Object.hasOwn(options, 'queryResponse') ? options.queryResponse : { node: node({ headRefName: branch }) });
    }
    if (options.disableError) throw options.disableError;
    return clone(Object.hasOwn(options, 'disableResponse') ? options.disableResponse : { disablePullRequestAutoMerge: { pullRequest: { id: 'PR_fixture', number: 41, autoMergeRequest: null } } });
  } };
  const log = (level, text) => logs.push({ level, text: String(text) });
  const core = { setOutput: (key, value) => { outputs[key] = String(value); }, setFailed: text => { failures.push(String(text)); log('failure', text); },
    info: text => log('info', text), notice: text => log('notice', text), warning: text => log('warning', text), error: text => log('error', text) };
  const sandbox = { github, core, context: { repo: { owner: 'example', repo: 'project' }, sha }, process: { env },
    console: { log: text => log('console', text) }, require: name => { assert.equal(name, 'fs'); return { readFileSync: () => 'fixture body' }; } };
  let thrown;
  try { await new Script(`(async () => {\n${render(step.with.script)}\n})()`).runInNewContext(sandbox, { timeout: 1000 }); }
  catch (error) { thrown = error; }
  assert.deepEqual(response, unchanged, 'API response body/readiness must remain unchanged');
  return { calls, logs, failures, outputs, thrown, injected: sandbox.injected };
}

const messages = result => result.logs.map(item => item.text).join('\n');
function noPublication(result) {
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.ok(result.calls.every(call => ['lookup', 'label', 'query', 'disable'].includes(call.action)), JSON.stringify(result.calls));
}
function sanitizedFailure(result, action) {
  noPublication(result);
  assert.ok(result.failures.length > 0, 'failure must not be reported as success');
  assert.match(messages(result), action);
  assert.ok(!messages(result).includes(privateError), 'raw API failure must not escape');
}

test('no matching PR produces a bounded informational notice without publication', async () => {
  const result = await execute(notice, { prs: [] });
  noPublication(result);
  assert.deepEqual(result.calls, [{ action: 'lookup', args: { owner: 'example', repo: 'project', head: 'example:codex/example', base: 'main', state: 'open', per_page: 2, page: 1 } }]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.outputs.pr_number ?? '', '');
  assert.match(messages(result), /no .*pull request|no .*PR/i);
  assert.match(messages(result), /draft/i);
  assert.match(messages(result), /approv/i);
  assert.doesNotMatch(messages(result), /enable.*settings|allow github actions|add.*secret/i);
});

for (const draft of [true, false]) {
  test(`existing ${draft ? 'draft' : 'ready'} PR preserves body and readiness`, async () => {
    const result = await execute(notice, { prs: [pull({ draft })] });
    noPublication(result);
    assert.equal(result.failures.length, 0);
    assert.equal(result.outputs.pr_number, '41');
    assert.equal(result.outputs.pr_node_id, 'PR_fixture');
    assert.equal(result.calls.length, 1);
    assert.match(messages(result), draft ? /draft/i : /ready/i);
  });
}

test('mismatched head SHA is explicit and never claimed to contain the pushed commit', async () => {
  const result = await execute(notice, { prs: [pull({ head: { ref: 'codex/example', sha: 'b'.repeat(40), repo: { full_name: 'example/project' } } })] });
  noPublication(result);
  assert.equal(result.outputs.pr_number, '41');
  assert.match(messages(result), /mismatch|does not match|differs|different/i);
  assert.doesNotMatch(messages(result), /contains (?:this|the) push|matches (?:this|the) push/i);
});

const invalidPrs = [
  ['wrong base', pr => { pr.base.ref = 'release'; }],
  ['wrong head repository', pr => { pr.head.repo.full_name = 'other/project'; }],
  ['wrong base repository', pr => { pr.base.repo.full_name = 'other/project'; }],
  ['wrong branch', pr => { pr.head.ref = 'codex/other'; }],
  ['closed PR', pr => { pr.state = 'closed'; }],
  ['malformed number', pr => { pr.number = '41'; }],
  ['missing draft state', pr => { delete pr.draft; }],
  ['invalid SHA', pr => { pr.head.sha = 'invalid'; }],
  ['missing node identity', pr => { pr.node_id = ''; }],
];
for (const [name, change] of invalidPrs) {
  test(`lookup rejects ${name} without publishing or labeling`, async () => {
    const pr = pull(); change(pr);
    const result = await execute(notice, { prs: [pr] });
    sanitizedFailure(result, /lookup|pull request|PR/i);
    assert.equal(result.outputs.pr_number ?? '', '');
    assert.equal(result.calls.length, 1);
  });
}

for (const [name, response] of [
  ['non-array', { data: {}, headers: {} }],
  ['ambiguous', { data: [pull(), pull({ number: 42 })], headers: {} }],
  ['truncated', { data: [pull()], headers: { link: '<https://api.github.com/next>; rel="next"' } }],
]) {
  test(`lookup rejects ${name} response`, async () => {
    const result = await execute(notice, { response });
    sanitizedFailure(result, /lookup|pull request|PR/i);
    assert.equal(result.outputs.pr_number ?? '', '');
  });
}

for (const status of [403, 429, 500]) {
  test(`lookup HTTP ${status} fails with a sanitized category rather than credential advice`, async () => {
    const result = await execute(notice, { lookupError: { status, message: privateError } });
    sanitizedFailure(result, /lookup/i);
    assert.match(messages(result), new RegExp(String(status)));
    assert.doesNotMatch(messages(result), /allow github actions|add.*secret|enable.*settings/i);
  });
}

test('existing prefix labels are retained and labeling failure names its action', async () => {
  const success = await execute(label);
  noPublication(success);
  assert.deepEqual(success.calls, [{ action: 'label', args: { owner: 'example', repo: 'project', issue_number: 41, labels: ['ai-generated', 'codex'] } }]);
  const failed = await execute(label, { labelError: { status: 403, message: privateError } });
  sanitizedFailure(failed, /label/i);
  assert.doesNotMatch(messages(failed), /labels may not exist/i);
});

test('hostile branch values remain literal API arguments rather than executable JavaScript', async () => {
  for (const branch of ["codex/x';globalThis.injected=true;//", 'codex/x";globalThis.injected=true;//']) {
    const pr = pull({ head: { ref: branch, sha, repo: { full_name: 'example/project' } } });
    const result = await execute(notice, { branch, prs: [pr] });
    noPublication(result);
    assert.equal(result.injected, undefined);
    assert.equal(result.failures.length, 0);
    assert.equal(result.calls[0].args.head, `example:${branch}`);
    assert.equal(result.outputs.pr_number, '41');
  }
});

test('every actual publication script forbids creation, readiness changes and automatic arming', async () => {
  for (const step of scripts) {
    for (const prs of [[], [pull()], [pull({ draft: false })]]) noPublication(await execute(step, { prs }));
  }
});

test('sensitive protection observes already-off state without issuing a mutation', async () => {
  const result = await execute(disable, { queryResponse: { node: node({ autoMergeRequest: null }) } });
  noPublication(result);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.calls.map(call => call.action), ['query']);
  assert.match(messages(result), /off|disabled/i);
});

test('sensitive protection disables only the verified PR and confirms returned off state', async () => {
  const result = await execute(disable);
  noPublication(result);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.calls.map(call => call.action), ['query', 'disable']);
  assert.deepEqual(result.calls[0].args.variables, { id: 'PR_fixture' });
  assert.deepEqual(result.calls[1].args.variables, { id: 'PR_fixture' });
  assert.match(messages(result), /off|disabled/i);
});

for (const [name, options] of [
  ['query failure', { queryError: { status: 403, message: privateError } }],
  ['wrong node', { queryResponse: { node: node({ headRepository: { nameWithOwner: 'other/project' } }) } }],
  ['missing state', { queryResponse: { node: node({ autoMergeRequest: undefined }) } }],
  ['disable failure', { disableError: { status: 403, message: privateError } }],
  ['wrong disable identity', { disableResponse: { disablePullRequestAutoMerge: { pullRequest: { id: 'PR_other', number: 42, autoMergeRequest: null } } } }],
  ['unconfirmed disablement', { disableResponse: { disablePullRequestAutoMerge: { pullRequest: { id: 'PR_fixture', number: 41, autoMergeRequest: { enabledAt: 'still-enabled' } } } } }],
]) {
  test(`sensitive ${name} cannot claim auto-merge was turned off`, async () => {
    const result = await execute(disable, options);
    sanitizedFailure(result, /auto.merge|sensitive|pull request|PR/i);
    assert.ok(!result.logs.some(item => item.level === 'info' && /(?:is|was|confirmed|already) (?:off|disabled)|disabled.*success/i.test(item.text)));
    if (['query failure', 'wrong node', 'missing state'].includes(name)) assert.ok(!result.calls.some(call => call.action === 'disable'));
  });
}

test('trigger scope excludes Dependabot and permissions retain only existing narrow writes', () => {
  assert.deepEqual(workflow.on.push.branches, ['claude/**', 'codex/**', 'copilot/**', 'feat/**', 'fix/**', 'ui/**', 'chore/**', 'perf/**', 'docs/**']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  for (const job of Object.values(workflow.jobs)) {
    assert.ok(Object.keys(job.permissions).every(key => ['contents', 'pull-requests'].includes(key)));
    assert.ok(job.steps.filter(step => step.uses?.startsWith('actions/checkout@')).every(step => step.with['persist-credentials'] === false));
  }
});

function safetyJobRuns({ failed = false, cancelled = false, prNumber = '41', branch = 'codex/example' } = {}) {
  let expression = String(workflow.jobs['auto-merge'].if).replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  if (!/\b(?:always|cancelled|success|failure)\s*\(/.test(expression) && failed) return false;
  expression = expression.replaceAll('needs.auto-pr.outputs.pr_number', JSON.stringify(prNumber)).replaceAll('github.ref_name', JSON.stringify(branch));
  return new Script(expression).runInNewContext({ cancelled: () => cancelled, success: () => !failed, failure: () => failed,
    always: () => true, startsWith: (value, prefix) => value.toLowerCase().startsWith(prefix.toLowerCase()) }, { timeout: 100 });
}

test('labeling failure cannot suppress sensitive protection but cancellation and missing identity do', () => {
  assert.equal(safetyJobRuns({ failed: true }), true, 'explicit status condition must override GitHub implicit success gating');
  assert.equal(safetyJobRuns({ failed: false }), true);
  assert.equal(safetyJobRuns({ cancelled: true }), false);
  assert.equal(safetyJobRuns({ prNumber: '' }), false);
  assert.equal(safetyJobRuns({ branch: 'dependabot/npm/example' }), false);
});

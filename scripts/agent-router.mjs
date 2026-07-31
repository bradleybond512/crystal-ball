#!/usr/bin/env node

const args = process.argv.slice(2);
const requestIndex = args.indexOf('--request');
const request = (requestIndex === -1 ? args.join(' ') : args[requestIndex + 1]).toLowerCase();
const exactSignals = new Set(['api', 'map', 'ui']);
const matchesSignal = signal => exactSignals.has(signal)
  ? new RegExp(`(?:^|[^a-z0-9])${signal}(?:$|[^a-z0-9])`).test(request)
  : request.includes(signal);

const routes = [
  { agent: 'prediction_engineer', tests: ['npm run test:cognition', 'npm run test:intelligence'], high: true, words: ['predict', 'forecast', 'calibrat', 'brier', 'self-tun', 'promotion'] },
  { agent: 'correlation_engineer', tests: ['npm run test:correlation', 'npm run test:intelligence'], high: true, words: ['correlat', 'causal', 'cluster', 'anomal', 'evidence graph'] },
  { agent: 'tauri_security_engineer', tests: ['npm run test:sec-hardening', 'npm run secrets:scan'], high: true, words: ['tauri', 'rust', 'sidecar', 'ipc', 'ssrf', 'csp', 'secret', 'filesystem', 'permission'] },
  {
    agent: 'release_engineer',
    tests: ['npm run version:check', 'npm run lockfile:check'],
    high: true,
    words: ['release', 'notar', 'updater', 'install', 'version'],
    patterns: [/\bsign(?:ed|ing)?\b/, /\bpackage\.json\b/],
  },
  { agent: 'provider_engineer', tests: ['npm run test:providers'], words: ['provider', 'feed', 'ingest', 'api', 'cache', 'source health'] },
  { agent: 'intelligence_engineer', tests: ['npm run test:intelligence'], words: ['intelligence', 'situation', 'alert', 'rule', 'hypothesis', 'evidence'] },
  { agent: 'ui_map_engineer', tests: ['npm run test:renderer'], words: ['ui', 'component', 'panel', 'map', 'globe', 'deck.gl', 'accessib'] },
  { agent: 'performance_engineer', tests: ['npm run bundle:check'], words: ['performance', 'memory', 'slow', 'benchmark', 'render loop', 'latency'] },
];

const selected = routes.filter(route =>
  route.words.some(word => matchesSignal(word))
  || route.patterns?.some(pattern => pattern.test(request)));
const highAssurance = selected.some(route => route.high) || ['architecture', 'migration', 'delete', 'destructive'].some(word => request.includes(word));
const mechanicalIntent = ['typo', 'copy', 'readme', 'comment', 'format', 'documentation', 'capitalization']
  .some(word => request.includes(word));
const sensitiveIntent = ['release', 'deploy', 'notar', 'sign ', 'version bump', 'install app']
  .some(word => request.includes(word));
const trivial = mechanicalIntent
  && selected.length === 0
  && !highAssurance
  && !sensitiveIntent;
let tier = 'focused';
if (trivial) {
  tier = 'mechanical';
} else if (highAssurance) {
  tier = 'high_assurance';
} else if (selected.length > 1) {
  tier = 'standard';
}

const agents = new Set(
  tier === 'mechanical' ? [] : selected.map(route => route.agent),
);
if (tier === 'mechanical') agents.add('mechanical_engineer');
if (tier === 'standard' || tier === 'high_assurance') {
  agents.add('repository_analyst');
  agents.add('architect');
}
if (tier === 'high_assurance') agents.add('mission_architect');
if (request.includes('ui') || request.includes('workflow') || request.includes('interaction')) agents.add('product_designer');
if (tier !== 'mechanical') {
  agents.add('test_engineer');
  agents.add('independent_reviewer');
}

const tests = [...new Set(selected.flatMap(route => route.tests))];

console.log(JSON.stringify({
  tier,
  agents: [...agents],
  targeted_checks: tests,
  always_run: ['npm run lint:ci', 'npm run typecheck:all', 'npm run secrets:scan', 'npm run cross-agent:check'],
  human_design_approval: highAssurance,
  rationale: selected.length ? selected.map(route => route.agent) : ['general implementation'],
}, null, 2));

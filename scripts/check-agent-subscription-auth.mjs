#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const FORBIDDEN_MODEL_CREDENTIALS = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
];

export function assertNoModelCredentialEnvironment(env = process.env) {
  const present = FORBIDDEN_MODEL_CREDENTIALS.filter((name) => env[name]);
  if (present.length) {
    throw new Error(
      `Subscription-only policy forbids model credential environment variables: ${present.join(', ')}`,
    );
  }
}

function defaultRunner(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    shell: false,
  });
}

export function verifyCodexSubscription(runner = defaultRunner) {
  const result = runner('codex', ['login', 'status']);
  if (result.error) {
    throw new Error(`Codex authentication check failed: ${result.error.message}`);
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status !== 0 || !/logged in using chatgpt/i.test(output)) {
    throw new Error(
      'Codex must be authenticated with a ChatGPT subscription. Run `codex login` and choose ChatGPT.',
    );
  }
  return 'ChatGPT';
}

export function verifyClaudeSubscription(runner = defaultRunner) {
  const result = runner('claude', ['auth', 'status']);
  if (result.error) {
    throw new Error(`Claude authentication check failed: ${result.error.message}`);
  }
  let status;
  try {
    status = JSON.parse(result.stdout ?? '');
  } catch {
    throw new Error('Claude returned an unreadable authentication status.');
  }
  if (
    result.status !== 0
    || status.loggedIn !== true
    || status.authMethod !== 'claude.ai'
    || status.apiProvider !== 'firstParty'
    || !['pro', 'max'].includes(status.subscriptionType)
  ) {
    throw new Error(
      'Claude must be authenticated with a Claude Pro or Max subscription. Run `claude login` and choose Claude.ai.',
    );
  }
  return status.subscriptionType;
}

function main() {
  assertNoModelCredentialEnvironment();
  const requested = new Set(process.argv.slice(2));
  if (
    [...requested].some((value) => !['--codex', '--claude', '--all'].includes(value))
  ) {
    throw new Error('Usage: check-agent-subscription-auth.mjs [--codex|--claude|--all]');
  }
  const checkAll = requested.size === 0 || requested.has('--all');
  const verified = [];
  if (checkAll || requested.has('--codex')) {
    verified.push(`Codex: ${verifyCodexSubscription()}`);
  }
  if (checkAll || requested.has('--claude')) {
    verified.push(`Claude: ${verifyClaudeSubscription()}`);
  }
  console.log(`Subscription authentication verified (${verified.join(', ')}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

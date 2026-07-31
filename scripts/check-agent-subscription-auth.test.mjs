import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoModelCredentialEnvironment,
  verifyClaudeSubscription,
  verifyCodexSubscription,
} from './check-agent-subscription-auth.mjs';

test('rejects every environment credential that could bypass subscriptions', () => {
  for (const name of [
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'CODEX_ACCESS_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
  ]) {
    assert.throws(
      () => assertNoModelCredentialEnvironment({ [name]: 'secret' }),
      new RegExp(name),
    );
  }
});

test('accepts a ChatGPT-backed Codex login', () => {
  const result = verifyCodexSubscription(() => ({
    status: 0,
    stdout: 'Logged in using ChatGPT\n',
    stderr: '',
  }));
  assert.equal(result, 'ChatGPT');
});

test('rejects a non-ChatGPT Codex login', () => {
  assert.throws(
    () => verifyCodexSubscription(() => ({
      status: 0,
      stdout: 'Logged in using an API key\n',
      stderr: '',
    })),
    /ChatGPT subscription/,
  );
});

test('accepts a Claude Pro or Max login', () => {
  const result = verifyClaudeSubscription(() => ({
    status: 0,
    stdout: JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      subscriptionType: 'max',
    }),
    stderr: '',
  }));
  assert.equal(result, 'max');
});

test('rejects Claude Console or API authentication', () => {
  assert.throws(
    () => verifyClaudeSubscription(() => ({
      status: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: 'console',
        apiProvider: 'firstParty',
        subscriptionType: null,
      }),
      stderr: '',
    })),
    /Claude Pro or Max subscription/,
  );
});

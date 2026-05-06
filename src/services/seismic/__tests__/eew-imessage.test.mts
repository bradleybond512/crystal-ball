import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyOutcome,
  buildBody,
  escalateTier5ToImessage,
} from '../eew-imessage.ts';
import type { EewAlert } from '../eew-alert-engine.ts';

const NOW = 1_745_000_000_000;

function tier5(overrides: Partial<EewAlert> = {}): EewAlert {
  return {
    eventId: 'usgs:big',
    tier: 'TIER_5_EXTREME',
    reason: 'M8.0 — M≥8.0 anywhere',
    triggeredAt: NOW,
    ...overrides,
  };
}

// ── buildBody ──────────────────────────────────────────────────────────

test('buildBody starts with TIER_5 EEW prefix', () => {
  const body = buildBody(tier5(), NOW);
  assert.match(body, /^TIER_5 EEW:/);
});

test('buildBody includes alert reason', () => {
  const body = buildBody(tier5({ reason: 'M9.1 — Cascadia subduction' }), NOW);
  assert.match(body, /Cascadia subduction/);
});

test('buildBody truncates body over 160 chars with ellipsis', () => {
  const longReason = 'X'.repeat(500);
  const body = buildBody(tier5({ reason: longReason }), NOW);
  assert.ok(body.length <= 160, `body length was ${body.length}`);
  assert.ok(body.endsWith('…'));
});

// ── escalateTier5ToImessage ────────────────────────────────────────────

test('non-TIER_5 alert returns disabled (defensive guard)', async () => {
  const wrongTier = { ...tier5(), tier: 'TIER_4_SEVERE' as const };
  const out = await escalateTier5ToImessage(wrongTier, NOW, {
    enabled: true,
    getSettings: () => ({ recipient: '+15551234567' }),
    send: async () => ({ ok: true }),
  });
  assert.equal(out.status, 'disabled');
  assert.equal(out.status === 'disabled' ? out.reason : '', 'feature_off');
});

test('feature-off toggle returns disabled, never calls send', async () => {
  let sendCalled = false;
  const out = await escalateTier5ToImessage(tier5(), NOW, {
    enabled: false,
    getSettings: () => ({ recipient: '+15551234567' }),
    send: async () => {
      sendCalled = true;
      return { ok: true };
    },
  });
  assert.equal(out.status, 'disabled');
  assert.equal(sendCalled, false);
});

test('empty recipient returns disabled with no_recipient', async () => {
  let sendCalled = false;
  const out = await escalateTier5ToImessage(tier5(), NOW, {
    enabled: true,
    getSettings: () => ({ recipient: '' }),
    send: async () => {
      sendCalled = true;
      return { ok: true };
    },
  });
  assert.equal(out.status, 'disabled');
  assert.equal(out.status === 'disabled' ? out.reason : '', 'no_recipient');
  assert.equal(sendCalled, false);
});

test('whitespace-only recipient is treated as empty', async () => {
  const out = await escalateTier5ToImessage(tier5(), NOW, {
    enabled: true,
    getSettings: () => ({ recipient: '   ' }),
    send: async () => ({ ok: true }),
  });
  assert.equal(out.status, 'disabled');
});

test('successful send returns sent', async () => {
  const out = await escalateTier5ToImessage(tier5(), NOW, {
    enabled: true,
    getSettings: () => ({ recipient: '+15551234567' }),
    send: async () => ({ ok: true }),
  });
  assert.equal(out.status, 'sent');
});

test('send failure returns failed with the error reason — no retry', async () => {
  let callCount = 0;
  const out = await escalateTier5ToImessage(tier5(), NOW, {
    enabled: true,
    getSettings: () => ({ recipient: '+15551234567' }),
    send: async () => {
      callCount += 1;
      return { ok: false, reason: 'Messages.app rate-limited' };
    },
  });
  assert.equal(out.status, 'failed');
  assert.equal(out.status === 'failed' ? out.error : '', 'Messages.app rate-limited');
  assert.equal(callCount, 1);
});

test('send throw is caught and surfaced as failed', async () => {
  const out = await escalateTier5ToImessage(tier5(), NOW, {
    enabled: true,
    getSettings: () => ({ recipient: '+15551234567' }),
    send: async () => { throw new Error('bridge unavailable'); },
  });
  assert.equal(out.status, 'failed');
  assert.equal(out.status === 'failed' ? out.error : '', 'bridge unavailable');
});

// ── applyOutcome ───────────────────────────────────────────────────────

test('applyOutcome sets imessageStatus=sent and clears error', () => {
  const alert = tier5({ imessageError: 'previous' });
  const next = applyOutcome(alert, { status: 'sent' });
  assert.equal(next.imessageStatus, 'sent');
  assert.equal(next.imessageError, undefined);
});

test('applyOutcome sets imessageStatus=failed with error', () => {
  const next = applyOutcome(tier5(), { status: 'failed', error: 'rate limited' });
  assert.equal(next.imessageStatus, 'failed');
  assert.equal(next.imessageError, 'rate limited');
});

test('applyOutcome sets imessageStatus=disabled, no error', () => {
  const next = applyOutcome(tier5(), { status: 'disabled', reason: 'feature_off' });
  assert.equal(next.imessageStatus, 'disabled');
  assert.equal(next.imessageError, undefined);
});

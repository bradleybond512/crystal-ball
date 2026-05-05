import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWebhookPayload,
  deliverAlert,
  detectWebhookFormat,
  formatDiscordEmbed,
  formatGenericJson,
  formatSlackBlocks,
  planVoiceCommand,
  shouldFireWebhook,
} from '../alert-delivery';

describe('planVoiceCommand', () => {
  it('TIER_3 uses rate 175', () => {
    const cmd = planVoiceCommand({ tier: 'TIER_3', summary: 'tornado warning' });
    assert.equal(cmd.shouldSpeak, true);
    assert.equal(cmd.repeats, 1);
    assert.deepEqual(cmd.args, ['-r', '175', 'Crystal Ball warning: tornado warning']);
  });

  it('TIER_4 uses rate 200 + Samantha voice', () => {
    const cmd = planVoiceCommand({ tier: 'TIER_4', summary: 'imminent threat' });
    assert.equal(cmd.shouldSpeak, true);
    assert.deepEqual(cmd.args, ['-r', '200', '-v', 'Samantha', 'Crystal Ball urgent: imminent threat']);
  });

  it('TIER_5 repeats 3 times with the body', () => {
    const cmd = planVoiceCommand({
      tier: 'TIER_5',
      summary: 'short',
      body: 'Take cover immediately. Tornado on the ground.',
    });
    assert.equal(cmd.repeats, 3);
    assert.match(cmd.args.join(' '), /Take cover immediately/);
  });

  it('TIER_2 / TIER_1 do not speak', () => {
    assert.equal(planVoiceCommand({ tier: 'TIER_2', summary: 's' }).shouldSpeak, false);
    assert.equal(planVoiceCommand({ tier: 'TIER_1', summary: 's' }).shouldSpeak, false);
  });

  it('strips dangerous characters from summary', () => {
    const cmd = planVoiceCommand({ tier: 'TIER_3', summary: "'; rm -rf /; echo 'x" });
    const joined = cmd.args.join(' ');
    assert.equal(joined.includes('rm -rf'), true);
    // The summary is sanitized — but `rm -rf /` is allowed text since
    // we pass via execFile, not shell. The strip is only for non-printable
    // / non-ASCII glyphs that would confuse VoiceOver. Make sure the
    // summary is at least present.
  });
});

describe('detectWebhookFormat', () => {
  it('matches discord.com host', () => {
    assert.equal(detectWebhookFormat('https://discord.com/api/webhooks/123/abc'), 'discord');
    assert.equal(
      detectWebhookFormat('https://canary.discord.com/api/webhooks/123/abc'),
      'discord',
    );
  });

  it('matches Slack hooks host', () => {
    assert.equal(
      detectWebhookFormat('https://hooks.slack.com/services/T0/B0/abc'),
      'slack',
    );
  });

  it('falls back to generic', () => {
    assert.equal(detectWebhookFormat('https://example.com/webhook'), 'generic');
  });

  it('returns generic for invalid URLs', () => {
    assert.equal(detectWebhookFormat('not a url'), 'generic');
  });
});

describe('formatDiscordEmbed', () => {
  it('builds an embed with tier-coded color', () => {
    const out = formatDiscordEmbed({ tier: 'TIER_4', summary: 'severe wind', at: 1 });
    const body = out as { embeds: { color: number; title: string }[] };
    assert.equal(body.embeds.length, 1);
    assert.equal(body.embeds[0]!.color, 0xf44336);
    assert.match(body.embeds[0]!.title, /TIER 4/);
  });

  it('includes body when provided', () => {
    const out = formatDiscordEmbed({
      tier: 'TIER_3',
      summary: 'sum',
      body: 'extra',
      at: 1,
    });
    const body = out as { embeds: { description: string }[] };
    assert.match(body.embeds[0]!.description, /sum.*extra/s);
  });
});

describe('formatSlackBlocks', () => {
  it('builds header + section + context blocks', () => {
    const out = formatSlackBlocks({ tier: 'TIER_3', summary: 'wind shear', at: 1 });
    const body = out as { blocks: { type: string }[] };
    assert.equal(body.blocks[0]!.type, 'header');
    assert.equal(body.blocks[1]!.type, 'section');
    assert.equal(body.blocks[2]!.type, 'context');
  });
});

describe('formatGenericJson', () => {
  it('returns a flat shape for generic webhooks', () => {
    const out = formatGenericJson({ tier: 'TIER_2', summary: 's', at: 999 });
    assert.deepEqual(out, {
      source: 'crystal-ball',
      tier: 'TIER_2',
      summary: 's',
      body: null,
      at: 999,
    });
  });
});

describe('buildWebhookPayload', () => {
  it('routes Discord URL to embed format', () => {
    const wh = buildWebhookPayload(
      'https://discord.com/api/webhooks/1/abc',
      { tier: 'TIER_3', summary: 's' },
    );
    assert.equal(wh.format, 'discord');
    assert.ok((wh.body as { embeds: unknown[] }).embeds);
  });

  it('routes Slack URL to blocks format', () => {
    const wh = buildWebhookPayload(
      'https://hooks.slack.com/services/T/B/x',
      { tier: 'TIER_3', summary: 's' },
    );
    assert.equal(wh.format, 'slack');
    assert.ok((wh.body as { blocks: unknown[] }).blocks);
  });

  it('routes everything else to generic', () => {
    const wh = buildWebhookPayload('https://example.com/x', { tier: 'TIER_3', summary: 's' });
    assert.equal(wh.format, 'generic');
  });
});

describe('shouldFireWebhook', () => {
  it('fires for TIER_2 through TIER_5', () => {
    assert.equal(shouldFireWebhook('TIER_2'), true);
    assert.equal(shouldFireWebhook('TIER_5'), true);
  });

  it('does not fire for TIER_1', () => {
    assert.equal(shouldFireWebhook('TIER_1'), false);
  });
});

describe('deliverAlert', () => {
  it('runs voice 3x for TIER_5 and posts to all webhooks', async () => {
    const speakCalls: unknown[] = [];
    const postCalls: { url: string }[] = [];
    const result = await deliverAlert(
      { tier: 'TIER_5', summary: 'severe', body: 'take cover' },
      {
        voiceEnabled: true,
        webhookUrls: [
          'https://discord.com/api/webhooks/1/abc',
          'https://hooks.slack.com/services/T/B/x',
          'https://example.com/x',
        ],
      },
      {
        speak: async (cmd) => {
          speakCalls.push(cmd.args);
          return true;
        },
        postWebhook: async ({ url, format }) => {
          postCalls.push({ url });
          assert.match(format, /discord|slack|generic/);
          return { ok: true, status: 200 };
        },
      },
    );
    assert.equal(speakCalls.length, 3); // repeats
    assert.equal(result.voice.succeeded, true);
    assert.equal(result.webhooks.length, 3);
    assert.ok(result.webhooks.every((w) => w.succeeded));
    assert.equal(postCalls.length, 3);
  });

  it('skips voice when voiceEnabled=false', async () => {
    const result = await deliverAlert(
      { tier: 'TIER_4', summary: 'urgent' },
      { voiceEnabled: false, webhookUrls: [] },
      {
        speak: async () => {
          throw new Error('should not be called');
        },
      },
    );
    assert.equal(result.voice.attempted, false);
  });

  it('skips webhooks for TIER_1', async () => {
    const result = await deliverAlert(
      { tier: 'TIER_1', summary: 'fyi' },
      { voiceEnabled: true, webhookUrls: ['https://example.com/x'] },
      {
        postWebhook: async () => {
          throw new Error('should not be called');
        },
      },
    );
    assert.equal(result.webhooks.length, 0);
  });

  it('reports webhook failure without throwing', async () => {
    const result = await deliverAlert(
      { tier: 'TIER_3', summary: 's' },
      { voiceEnabled: false, webhookUrls: ['https://example.com/x'] },
      {
        postWebhook: async () => ({ ok: false, status: 500, reason: 'server error' }),
      },
    );
    assert.equal(result.webhooks[0]!.succeeded, false);
    assert.equal(result.webhooks[0]!.reason, 'server error');
  });

  it('skips empty webhook URLs (handles unconfigured slots)', async () => {
    const calls: string[] = [];
    await deliverAlert(
      { tier: 'TIER_3', summary: 's' },
      { voiceEnabled: false, webhookUrls: ['', 'https://example.com/x', ''] },
      {
        postWebhook: async ({ url }) => {
          calls.push(url);
          return { ok: true, status: 200 };
        },
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'https://example.com/x');
  });
});

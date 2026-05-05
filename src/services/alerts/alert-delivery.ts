/**
 * Alert Delivery — voice + webhook fan-out for Crystal Ball alerts.
 *
 * Voice (macOS only):
 *   TIER_3 -> say -r 175 "Crystal Ball warning: {summary}"
 *   TIER_4 -> say -r 200 -v Samantha "Crystal Ball urgent: {summary}"
 *   TIER_5 -> full alert read aloud + repeat 3x
 *
 * Webhooks (any platform):
 *   - URL whose host is `discord.com` or `*.discord.com` -> Discord
 *     embed format
 *   - URL whose host is `hooks.slack.com` -> Slack blocks format
 *   - everything else -> generic JSON POST
 *   - Webhooks fire for TIER_2+
 *
 * Pure deterministic core: building a Voice command, formatting a
 * payload for a given URL, deciding whether a tier should trigger
 * which channel. Side effects (running `say`, posting to a webhook)
 * are confined to the orchestrator at the bottom and are injected as
 * adapters so the unit tests can run with no system access.
 */

// Public types

export type AlertTier = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5';

export interface AlertPayload {
  tier: AlertTier;
  summary: string;
  /** Optional richer body. Used for TIER_5 full read-aloud. */
  body?: string;
  /** ms timestamp. Defaults to delivery time when absent. */
  at?: number;
}

export interface VoiceCommand {
  /** Whether to invoke the `say` command at all for this alert. */
  shouldSpeak: boolean;
  /** Argv-style args for the `say` invocation. */
  args: readonly string[];
  /** Number of times to repeat the spoken phrase. */
  repeats: number;
}

export type WebhookFormat = 'discord' | 'slack' | 'generic';

export interface WebhookPayload {
  url: string;
  format: WebhookFormat;
  /** JSON-serializable body to POST. */
  body: unknown;
}

// Voice configuration

export function planVoiceCommand(payload: AlertPayload): VoiceCommand {
  const summary = payload.summary.replace(/[^A-Za-z0-9 .,;:!?'-]+/g, ' ').trim();
  switch (payload.tier) {
    case 'TIER_5': {
      const text = `Crystal Ball emergency. ${payload.body ?? payload.summary}`;
      return {
        shouldSpeak: true,
        args: ['-r', '210', '-v', 'Samantha', text],
        repeats: 3,
      };
    }
    case 'TIER_4': {
      return {
        shouldSpeak: true,
        args: ['-r', '200', '-v', 'Samantha', `Crystal Ball urgent: ${summary}`],
        repeats: 1,
      };
    }
    case 'TIER_3': {
      return {
        shouldSpeak: true,
        args: ['-r', '175', `Crystal Ball warning: ${summary}`],
        repeats: 1,
      };
    }
    default: {
      return { shouldSpeak: false, args: [], repeats: 0 };
    }
  }
}

// Webhook format detection

export function detectWebhookFormat(url: string): WebhookFormat {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return 'generic';
  }
  if (host === 'discord.com' || host.endsWith('.discord.com')) return 'discord';
  if (host === 'hooks.slack.com') return 'slack';
  return 'generic';
}

// Tier color map for visual webhook formats

const DISCORD_TIER_COLOR: Record<AlertTier, number> = {
  TIER_1: 0x4A_9E_FF, // blue
  TIER_2: 0xFF_EB_3B, // yellow
  TIER_3: 0xFF_B7_4D, // orange
  TIER_4: 0xF4_43_36, // red
  TIER_5: 0x88_00_00, // dark red
};

// Webhook formatters

export function formatDiscordEmbed(payload: AlertPayload): unknown {
  return {
    embeds: [
      {
        title: `Crystal Ball ${payload.tier.replace('_', ' ')}`,
        description: payload.body
          ? `${payload.summary}\n\n${payload.body}`
          : payload.summary,
        color: DISCORD_TIER_COLOR[payload.tier],
        timestamp: new Date(payload.at ?? Date.now()).toISOString(),
        footer: { text: 'Crystal Ball' },
      },
    ],
  };
}

export function formatSlackBlocks(payload: AlertPayload): unknown {
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `Crystal Ball ${payload.tier.replace('_', ' ')}` },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: payload.body ? `*${payload.summary}*\n${payload.body}` : `*${payload.summary}*`,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Crystal Ball • <!date^${Math.floor((payload.at ?? Date.now()) / 1000)}^{date_short_pretty} {time}|now>` },
        ],
      },
    ],
  };
}

export function formatGenericJson(payload: AlertPayload): unknown {
  return {
    source: 'crystal-ball',
    tier: payload.tier,
    summary: payload.summary,
    body: payload.body ?? null,
    at: payload.at ?? Date.now(),
  };
}

export function buildWebhookPayload(url: string, payload: AlertPayload): WebhookPayload {
  const format = detectWebhookFormat(url);
  switch (format) {
    case 'discord': {
      return { url, format, body: formatDiscordEmbed(payload) };
    }
    case 'slack': {
      return { url, format, body: formatSlackBlocks(payload) };
    }
    default: {
      return { url, format, body: formatGenericJson(payload) };
    }
  }
}

// Tier gating for webhook delivery

const WEBHOOK_TIERS: ReadonlySet<AlertTier> = new Set(['TIER_2', 'TIER_3', 'TIER_4', 'TIER_5']);

export function shouldFireWebhook(tier: AlertTier): boolean {
  return WEBHOOK_TIERS.has(tier);
}

// Delivery orchestrator

export interface AlertDeliveryConfig {
  voiceEnabled: boolean;
  webhookUrls: readonly string[];
}

export interface AlertDeliveryAdapters {
  /** Resolves true on success, false on failure. Implementations call
   *  `say` (Tauri shell) on macOS, no-op on web. */
  speak?: (cmd: VoiceCommand) => Promise<boolean>;
  /** POSTs the body to the URL. */
  postWebhook?: (
    payload: WebhookPayload,
  ) => Promise<{ ok: boolean; status: number; reason?: string }>;
  /** Optional clock for tests. */
  now?: () => number;
}

export interface AlertDeliveryResult {
  voice: { attempted: boolean; succeeded: boolean };
  webhooks: {
    url: string;
    format: WebhookFormat;
    attempted: boolean;
    succeeded: boolean;
    reason?: string;
  }[];
}

export async function deliverAlert(
  payload: AlertPayload,
  config: AlertDeliveryConfig,
  adapters: AlertDeliveryAdapters = {},
): Promise<AlertDeliveryResult> {
  const result: AlertDeliveryResult = {
    voice: { attempted: false, succeeded: false },
    webhooks: [],
  };

  // Voice
  const voiceCommand = planVoiceCommand(payload);
  if (config.voiceEnabled && voiceCommand.shouldSpeak && adapters.speak) {
    result.voice.attempted = true;
    let allOk = true;
    for (let i = 0; i < voiceCommand.repeats; i += 1) {
      const ok = await adapters.speak(voiceCommand);
      if (!ok) {
        allOk = false;
        break;
      }
    }
    result.voice.succeeded = allOk;
  }

  // Webhooks
  if (shouldFireWebhook(payload.tier) && adapters.postWebhook) {
    for (const url of config.webhookUrls) {
      if (!url) continue;
      const built = buildWebhookPayload(url, payload);
      const post = await adapters.postWebhook(built);
      result.webhooks.push({
        url,
        format: built.format,
        attempted: true,
        succeeded: post.ok,
        reason: post.reason,
      });
    }
  }

  return result;
}

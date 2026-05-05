import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const DISCORD_TIER_COLOR = {
  TIER_1: 0x4A_9E_FF,
  TIER_2: 0xFF_EB_3B,
  TIER_3: 0xFF_B7_4D,
  TIER_4: 0xF4_43_36,
  TIER_5: 0x88_00_00,
};

function detectFormat(url) {
  let host;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return 'invalid';
  }
  if (host === 'discord.com' || host.endsWith('.discord.com')) return 'discord';
  if (host === 'hooks.slack.com') return 'slack';
  return 'generic';
}

function buildBody(format, payload) {
  switch (format) {
    case 'discord': {
      return {
        embeds: [
          {
            title: `Crystal Ball ${payload.tier.replace('_', ' ')}`,
            description: payload.summary,
            color: DISCORD_TIER_COLOR[payload.tier] ?? 0x4A_9E_FF,
            timestamp: new Date(payload.at ?? Date.now()).toISOString(),
            footer: { text: 'Crystal Ball' },
          },
        ],
      };
    }
    case 'slack': {
      return {
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: `Crystal Ball ${payload.tier.replace('_', ' ')}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*${payload.summary}*` } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: 'Crystal Ball test' }] },
        ],
      };
    }
    default: {
      return {
        source: 'crystal-ball',
        tier: payload.tier,
        summary: payload.summary,
        at: payload.at ?? Date.now(),
      };
    }
  }
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) {
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  const url = new URL(req.url).searchParams.get('url');
  if (!url) {
    return Response.json(
      { error: 'url is required' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  // Whitelist outbound hosts to known webhook providers + a generic
  // any-host case (the user explicitly opts in by saving a URL into
  // their runtime config).
  const format = detectFormat(url);
  if (format === 'invalid') {
    return Response.json(
      { error: 'invalid url' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  const payload = {
    tier: 'TIER_2',
    summary: 'Crystal Ball test message',
    at: Date.now(),
  };
  const body = buildBody(format, payload);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return Response.json(
      {
        url,
        format,
        status: response.status,
        ok: response.ok,
      },
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  } catch (error) {
    return Response.json(
      {
        url,
        format,
        ok: false,
        reason: error?.message || String(error),
      },
      { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
}

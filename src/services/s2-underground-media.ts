// S2 Underground panel — media + Patreon data layer.
//
// Distinct from `s2-underground.ts` (the map-events globe overlay). This module
// powers the S2 Underground content panel: YouTube video briefings + an optional
// Patreon supporter layer (audio episodes + verified-patron badge).
//
// Pure parsers (no DOM, no fetch) are unit-tested with fixtures. Fetch wrappers
// are thin I/O over the tested parsers and the sidecar proxy routes.
//
// Patreon does not expose locked video to embed (no media API, audio-only RSS,
// DRM) — video comes from S2's public YouTube channel. See
// docs/superpowers/specs/2026-06-01-s2-underground-panel-design.md.
//
// NOTE: parsers use String.match because the repo's PreToolUse security hook
// rejects the regex match-and-advance method token; the lint rule preferring it
// is disabled for this file.
/* eslint-disable @typescript-eslint/prefer-regexp-exec, sonarjs/prefer-regexp-exec */

import { setSecretValue } from './runtime-config';

// S2 Underground identifiers (verified 2026-06-02).
// YouTube channel confirmed via its RSS feed; Patreon campaign id from the
// public user API (creator user 30479515 → campaign 3936408).
export const S2_YOUTUBE_CHANNEL_ID = 'UCTq1zHztiV69Ur8t6jco4CQ';
export const S2_PATREON_CAMPAIGN_ID = '3936408';
export const S2_PATREON_URL = 'https://www.patreon.com/s2underground';

// ── Pure parsers ────────────────────────────────────────────────────────────

export interface S2Video { videoId: string; title: string; published: string; thumbnail: string }

function firstGroup(haystack: string, re: RegExp): string {
  return haystack.match(re)?.[1] ?? '';
}

export function parseYoutubeChannelFeed(xml: string): S2Video[] {
  if (typeof xml !== 'string' || !xml.includes('<entry')) return [];
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/g) ?? [];
  return entries.map((e) => ({
    videoId: firstGroup(e, /<yt:videoId>([\s\S]*?)<\/yt:videoId>/).trim(),
    title: firstGroup(e, /<title[^>]*>([\s\S]*?)<\/title>/).trim(),
    published: firstGroup(e, /<published>([\s\S]*?)<\/published>/).trim(),
    thumbnail: firstGroup(e, /<media:thumbnail[^>]*url="([^"]+)"/),
  })).filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.videoId));
}

export interface S2Audio { title: string; published: string; durationSec: number; audioUrl: string }

export function parsePatreonAudioRss(xml: string): S2Audio[] {
  if (typeof xml !== 'string' || !xml.includes('<item')) return [];
  const items = xml.match(/<item[\s\S]*?<\/item>/g) ?? [];
  const out: S2Audio[] = [];
  for (const it of items) {
    const audioUrl =
      it.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="audio\/[^"]*"/)?.[1]
      ?? it.match(/<enclosure[^>]*type="audio\/[^"]*"[^>]*url="([^"]+)"/)?.[1];
    if (!audioUrl) continue;
    const title = (it.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '')
      .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const published = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '').trim();
    const durRaw = (it.match(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/)?.[1] ?? '0').trim();
    const durationSec = /^\d+$/.test(durRaw) ? Number(durRaw) : 0;
    out.push({ title, published, durationSec, audioUrl });
  }
  return out;
}

export interface PatronStatus { active: boolean; amountCents: number }

export function parsePatreonIdentity(payload: unknown, campaignId: string): PatronStatus {
  const inc = (payload as { included?: unknown[] })?.included;
  if (!Array.isArray(inc)) return { active: false, amountCents: 0 };
  for (const node of inc) {
    const n = node as {
      type?: string;
      attributes?: { patron_status?: string; currently_entitled_amount_cents?: number };
      relationships?: { campaign?: { data?: { id?: string } } };
    };
    if (n.type !== 'member') continue;
    if (n.relationships?.campaign?.data?.id !== campaignId) continue;
    const active = n.attributes?.patron_status === 'active_patron';
    return { active, amountCents: n.attributes?.currently_entitled_amount_cents ?? 0 };
  }
  return { active: false, amountCents: 0 };
}

// ── Fetch wrappers (thin I/O over the tested parsers + sidecar routes) ────────
//
// Relative /api/ paths are auto-authenticated + base-resolved by the runtime
// fetch interceptor. The renderer cannot read raw secret values, so Patreon
// tokens received during OAuth are held in module memory for the session and
// also persisted via setSecretValue so the sidecar picks them up (env-injected
// from the keychain) on the next launch.

let sessionAccessToken: string | null = null;
let sessionRefreshToken: string | null = null;

export function setPatreonSessionTokens(access: string, refresh?: string): void {
  sessionAccessToken = access;
  if (refresh) sessionRefreshToken = refresh;
}

export async function fetchS2Videos(): Promise<S2Video[]> {
  try {
    const r = await fetch(`/api/youtube/channel-feed?channelId=${encodeURIComponent(S2_YOUTUBE_CHANNEL_ID)}`);
    if (!r.ok) return [];
    const j = (await r.json()) as { items?: S2Video[] };
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
}

export async function fetchS2Audio(): Promise<{ episodes: S2Audio[]; configured: boolean }> {
  try {
    const r = await fetch('/api/patreon/audio-rss');
    if (!r.ok) return { episodes: [], configured: true };
    return (await r.json()) as { episodes: S2Audio[]; configured: boolean };
  } catch {
    return { episodes: [], configured: true };
  }
}

export interface PatronStatusResult extends PatronStatus { configured: boolean }

export async function fetchPatronStatus(): Promise<PatronStatusResult> {
  try {
    const qs = sessionAccessToken ? `&accessToken=${encodeURIComponent(sessionAccessToken)}` : '';
    const r = await fetch(`/api/patreon/verify?campaignId=${encodeURIComponent(S2_PATREON_CAMPAIGN_ID)}${qs}`);
    const j = (await r.json()) as { identity?: unknown; expired?: boolean; configured?: boolean };
    if (j.expired) {
      const ok = await refreshPatronToken();
      if (ok) return fetchPatronStatus();
      return { active: false, amountCents: 0, configured: true };
    }
    if (!j.identity) return { active: false, amountCents: 0, configured: j.configured ?? false };
    return { ...parsePatreonIdentity(j.identity, S2_PATREON_CAMPAIGN_ID), configured: true };
  } catch {
    return { active: false, amountCents: 0, configured: false };
  }
}

export async function refreshPatronToken(): Promise<boolean> {
  try {
    const qs = sessionRefreshToken ? `?refreshToken=${encodeURIComponent(sessionRefreshToken)}` : '';
    const r = await fetch(`/api/patreon/refresh${qs}`);
    if (!r.ok) return false;
    const j = (await r.json()) as { access_token?: string; refresh_token?: string };
    if (!j.access_token) return false;
    sessionAccessToken = j.access_token;
    if (j.refresh_token) sessionRefreshToken = j.refresh_token;
    await setSecretValue('PATREON_ACCESS_TOKEN', j.access_token);
    if (j.refresh_token) await setSecretValue('PATREON_REFRESH_TOKEN', j.refresh_token);
    return true;
  } catch {
    return false;
  }
}

# S2 Underground Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "S2 Underground" panel that plays S2's public YouTube video briefings in-app and adds a Patreon supporter layer (audio-RSS episodes + an OAuth verified-patron badge).

**Architecture:** A renderer panel (`S2UndergroundPanel`) renders three sections from JSON served by new sidecar proxy routes. The sidecar fetches/parses upstream feeds (keyless YouTube channel RSS; the user's token-bearing Patreon audio-RSS) and brokers the Patreon OAuth code-exchange so the `client_secret` and tokens stay server-side. Pure parsers are fixture-tested; video playback reuses the existing `/api/youtube-embed` iframe bridge.

**Tech Stack:** TypeScript (Vite renderer), Node sidecar (`local-api-server.mjs`), Rust (`main.rs` keychain key list), `node:test` runner via `tsx`.

**Spec:** `docs/superpowers/specs/2026-06-01-s2-underground-panel-design.md`

**Constants to confirm before/while implementing (external inputs, see spec Prerequisites):**
- `S2_YOUTUBE_CHANNEL_ID` — S2 Underground's YouTube channel ID (`UC…`).
- `S2_PATREON_CAMPAIGN_ID` — S2 Underground's Patreon campaign numeric ID.
- `S2_PATREON_URL` — `https://www.patreon.com/s2underground` (patron posts deep-link).
Use the named constants throughout; fill their literal values in Task 2 / Task 6 / Task 11 where defined.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/services/s2-underground.ts` | Pure parsers (`parseYoutubeChannelFeed`, `parsePatreonAudioRss`, `parsePatreonIdentity`) + renderer fetch wrappers + constants. |
| `src/services/__tests__/s2-underground.test.mts` | Fixture tests for the three parsers. |
| `src/components/S2UndergroundPanel.ts` | Panel UI: video section (list + youtube-embed iframe), audio section (list + `<audio>`), connect/badge section. |
| `src-tauri/sidecar/local-api-server.mjs` | New routes: `/api/youtube/channel-feed`, `/api/patreon/audio-rss`, `/oauth/patreon/callback`, `/api/patreon/verify`, `/api/patreon/refresh`, `/api/patreon/oauth-state`. |
| `src-tauri/sidecar/__tests__/s2-routes.test.mjs` | Smoke tests for the new routes. |
| `src/services/runtime-config.ts` | New `RuntimeSecretKey`s + an `s2Patreon` feature definition. |
| `src/services/settings-constants.ts` | Human labels / descriptions / signup URLs for the new secrets. |
| `src-tauri/src/main.rs` | Add the new keys to `SUPPORTED_SECRET_KEYS`. |
| `src/config/panels.ts`, `src/app/panel-layout.ts` | Panel registration. |

---

## Task 1: Register secret keys

**Files:**
- Modify: `src-tauri/src/main.rs:42` (`SUPPORTED_SECRET_KEYS` array + count)
- Modify: `src/services/runtime-config.ts:12` (`RuntimeSecretKey` union) and the feature-definitions array
- Modify: `src/services/settings-constants.ts` (labels)

- [ ] **Step 1: Add keys to the Rust keychain allowlist**

In `src-tauri/src/main.rs`, change the array length and append the five keys before the closing `]`:

```rust
const SUPPORTED_SECRET_KEYS: [&str; 73] = [
    // ...existing 68 entries unchanged...
    "PATREON_OAUTH_CLIENT_ID",
    "PATREON_OAUTH_CLIENT_SECRET",
    "PATREON_ACCESS_TOKEN",
    "PATREON_REFRESH_TOKEN",
    "PATREON_AUDIO_RSS_URL",
];
```

(Set the literal to `current_count + 5`; the existing literal is `68`.)

- [ ] **Step 2: Add keys to the renderer union + feature def**

In `src/services/runtime-config.ts`, add the five string literals to the `RuntimeSecretKey` union (line 12 block), then add a feature definition alongside the others (e.g. after `economicFred`):

```typescript
  {
    id: 's2Patreon',
    name: 'S2 Underground Patreon supporter',
    requiredSecrets: [],
    desktopRequiredSecrets: ['PATREON_OAUTH_CLIENT_ID', 'PATREON_OAUTH_CLIENT_SECRET'],
  },
```

(`requiredSecrets: []` so the panel's free YouTube section never shows as "needs config"; the Patreon features degrade gracefully when unset.)

- [ ] **Step 3: Add human labels**

In `src/services/settings-constants.ts`, add entries to the relevant maps (follow the existing shape for `FRED_API_KEY`):

```typescript
  PATREON_OAUTH_CLIENT_ID: 'Patreon OAuth Client ID',
  PATREON_OAUTH_CLIENT_SECRET: 'Patreon OAuth Client Secret',
  PATREON_ACCESS_TOKEN: 'Patreon Access Token (managed)',
  PATREON_REFRESH_TOKEN: 'Patreon Refresh Token (managed)',
  PATREON_AUDIO_RSS_URL: 'Patreon Audio RSS URL',
```

Add matching `KEY_DESCRIPTIONS` and a `SIGNUP_URLS` entry pointing client-id/secret to `https://www.patreon.com/portal/registration/register-clients`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:all`
Expected: PASS (zero errors).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs src/services/runtime-config.ts src/services/settings-constants.ts
git commit -m "feat(s2): register Patreon secret keys"
```

---

## Task 2: YouTube channel-feed parser (pure)

**Files:**
- Create: `src/services/s2-underground.ts`
- Test: `src/services/__tests__/s2-underground.test.mts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/__tests__/s2-underground.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseYoutubeChannelFeed } from '../s2-underground.ts';

const ATOM = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <yt:videoId>dQw4w9WgXcQ</yt:videoId>
  <title>Global Intelligence Summary - 01 JUN</title>
  <published>2026-06-01T12:00:00+00:00</published>
  <media:group><media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"/></media:group>
 </entry>
</feed>`;

describe('parseYoutubeChannelFeed', () => {
  it('extracts video items', () => {
    const items = parseYoutubeChannelFeed(ATOM);
    assert.equal(items.length, 1);
    assert.equal(items[0].videoId, 'dQw4w9WgXcQ');
    assert.equal(items[0].title, 'Global Intelligence Summary - 01 JUN');
    assert.equal(items[0].thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.ok(items[0].published.startsWith('2026-06-01'));
  });
  it('returns [] on garbage', () => {
    assert.deepEqual(parseYoutubeChannelFeed('not xml'), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/__tests__/s2-underground.test.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (regex via `.match`/`.matchAll`, never `.exec`)

```typescript
// src/services/s2-underground.ts
export const S2_YOUTUBE_CHANNEL_ID = 'UC_CONFIRM_ME'; // TODO confirm: S2 Underground channel id
export const S2_PATREON_CAMPAIGN_ID = 'CONFIRM_ME';   // TODO confirm: S2 Underground campaign id
export const S2_PATREON_URL = 'https://www.patreon.com/s2underground';

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/__tests__/s2-underground.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/s2-underground.ts src/services/__tests__/s2-underground.test.mts
git commit -m "feat(s2): YouTube channel-feed parser"
```

---

## Task 3: Sidecar `/api/youtube/channel-feed` route

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (add route in the dispatch chain, after the `/api/youtube-embed` block near line 4653)
- Test: `src-tauri/sidecar/__tests__/s2-routes.test.mjs`

- [ ] **Step 1: Write the failing smoke test**

```javascript
// src-tauri/sidecar/__tests__/s2-routes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sidecarParseYoutubeChannelFeed } from '../local-api-server.mjs';

test('sidecarParseYoutubeChannelFeed mirrors renderer parser', () => {
  const xml = '<feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>x</title><published>2026-06-01T00:00:00Z</published></entry></feed>';
  const items = sidecarParseYoutubeChannelFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].videoId, 'dQw4w9WgXcQ');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src-tauri/sidecar/__tests__/s2-routes.test.mjs`
Expected: FAIL — export not defined.

- [ ] **Step 3: Add the exported parser + route** (regex via `.match`, never `.exec`)

Near the other sidecar parsers (e.g. after `computeSignalWatchSidecar`), add:

```javascript
export function sidecarParseYoutubeChannelFeed(xml) {
  if (typeof xml !== 'string' || !xml.includes('<entry')) return [];
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/g) || [];
  return entries.map((e) => ({
    videoId: (e.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/)?.[1] || '').trim(),
    title: (e.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '').trim(),
    published: (e.match(/<published>([\s\S]*?)<\/published>/)?.[1] || '').trim(),
    thumbnail: e.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] || '',
  })).filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.videoId));
}
```

In the dispatch chain (after the `/api/youtube-embed` block), add:

```javascript
  if (requestUrl.pathname === '/api/youtube/channel-feed') {
    const channelId = requestUrl.searchParams.get('channelId') || '';
    if (!/^UC[A-Za-z0-9_-]{20,}$/.test(channelId)) {
      return json({ error: 'Invalid channelId' }, 400, makeCorsHeaders(req));
    }
    try {
      const up = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
        headers: { 'User-Agent': 'CrystalBall/1.0' },
      });
      if (!up.ok) throw new Error(`HTTP ${up.status}`);
      const items = sidecarParseYoutubeChannelFeed(await up.text());
      recordFeedSuccess('s2-youtube');
      return json({ items }, 200, makeCorsHeaders(req));
    } catch (err) {
      recordFeedFailure('s2-youtube', err);
      return json({ error: String(err?.message || err) }, 502, makeCorsHeaders(req));
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src-tauri/sidecar/__tests__/s2-routes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/sidecar/local-api-server.mjs src-tauri/sidecar/__tests__/s2-routes.test.mjs
git commit -m "feat(s2): sidecar youtube channel-feed route"
```

---

## Task 4: Patreon audio-RSS parser (pure)

**Files:**
- Modify: `src/services/s2-underground.ts`
- Modify: `src/services/__tests__/s2-underground.test.mts`

- [ ] **Step 1: Add the failing test**

```typescript
import { parsePatreonAudioRss } from '../s2-underground.ts';

const RSS = `<rss><channel>
 <item>
  <title>Patron Brief 12</title>
  <pubDate>Mon, 01 Jun 2026 12:00:00 GMT</pubDate>
  <enclosure url="https://cdn.patreon.com/a/12.mp3?token=abc" type="audio/mpeg" length="123"/>
  <itunes:duration>1830</itunes:duration>
 </item>
</channel></rss>`;

describe('parsePatreonAudioRss', () => {
  it('extracts audio episodes', () => {
    const eps = parsePatreonAudioRss(RSS);
    assert.equal(eps.length, 1);
    assert.equal(eps[0].title, 'Patron Brief 12');
    assert.equal(eps[0].audioUrl, 'https://cdn.patreon.com/a/12.mp3?token=abc');
    assert.equal(eps[0].durationSec, 1830);
  });
  it('ignores items with no audio enclosure', () => {
    assert.deepEqual(parsePatreonAudioRss('<rss><channel><item><title>x</title></item></channel></rss>'), []);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (`parsePatreonAudioRss` not exported)

Run: `npx tsx --test src/services/__tests__/s2-underground.test.mts`

- [ ] **Step 3: Implement** (regex via `.match`, never `.exec`)

Append to `src/services/s2-underground.ts`:

```typescript
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
    const title = (it.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const published = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '').trim();
    const durRaw = (it.match(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/)?.[1] ?? '0').trim();
    const durationSec = /^\d+$/.test(durRaw) ? Number(durRaw) : 0;
    out.push({ title, published, durationSec, audioUrl });
  }
  return out;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx tsx --test src/services/__tests__/s2-underground.test.mts`

- [ ] **Step 5: Commit**

```bash
git add src/services/s2-underground.ts src/services/__tests__/s2-underground.test.mts
git commit -m "feat(s2): Patreon audio-RSS parser"
```

---

## Task 5: Sidecar `/api/patreon/audio-rss` route

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs`
- Modify: `src-tauri/sidecar/__tests__/s2-routes.test.mjs`

- [ ] **Step 1: Add the failing test**

```javascript
import { sidecarParsePatreonAudioRss } from '../local-api-server.mjs';

test('sidecarParsePatreonAudioRss extracts audio enclosures', () => {
  const xml = '<rss><channel><item><title>x</title><enclosure url="https://c/1.mp3" type="audio/mpeg"/></item></channel></rss>';
  const eps = sidecarParsePatreonAudioRss(xml);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].audioUrl, 'https://c/1.mp3');
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx tsx --test src-tauri/sidecar/__tests__/s2-routes.test.mjs`

- [ ] **Step 3: Add exported parser (mirror of Task 4, plain JS) + route**

```javascript
export function sidecarParsePatreonAudioRss(xml) {
  if (typeof xml !== 'string' || !xml.includes('<item')) return [];
  const items = xml.match(/<item[\s\S]*?<\/item>/g) || [];
  const out = [];
  for (const it of items) {
    const audioUrl =
      (it.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="audio\/[^"]*"/) || [])[1]
      || (it.match(/<enclosure[^>]*type="audio\/[^"]*"[^>]*url="([^"]+)"/) || [])[1];
    if (!audioUrl) continue;
    const title = ((it.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const published = ((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
    const durRaw = (((it.match(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/) || [])[1]) || '0').trim();
    const durationSec = /^\d+$/.test(durRaw) ? Number(durRaw) : 0;
    out.push({ title, published, durationSec, audioUrl });
  }
  return out;
}
```

Route:

```javascript
  if (requestUrl.pathname === '/api/patreon/audio-rss') {
    const rssUrl = process.env.PATREON_AUDIO_RSS_URL || '';
    if (!rssUrl) return json({ episodes: [], configured: false }, 200, makeCorsHeaders(req));
    try {
      const up = await fetch(rssUrl, { headers: { 'User-Agent': 'CrystalBall/1.0' } });
      if (!up.ok) throw new Error(`HTTP ${up.status}`);
      const episodes = sidecarParsePatreonAudioRss(await up.text());
      recordFeedSuccess('s2-patreon-audio');
      return json({ episodes, configured: true }, 200, makeCorsHeaders(req));
    } catch (err) {
      recordFeedFailure('s2-patreon-audio', err);
      return json({ error: String(err?.message || err), configured: true }, 502, makeCorsHeaders(req));
    }
  }
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx tsx --test src-tauri/sidecar/__tests__/s2-routes.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/sidecar/local-api-server.mjs src-tauri/sidecar/__tests__/s2-routes.test.mjs
git commit -m "feat(s2): sidecar patreon audio-rss route"
```

---

## Task 6: Patreon identity → patron-status parser (pure)

**Files:**
- Modify: `src/services/s2-underground.ts`
- Modify: `src/services/__tests__/s2-underground.test.mts`

- [ ] **Step 1: Add the failing test**

```typescript
import { parsePatreonIdentity } from '../s2-underground.ts';

const IDENTITY = {
  data: { id: 'user1', type: 'user' },
  included: [
    { type: 'member', attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 500 },
      relationships: { campaign: { data: { id: 'CAMP1' } } } },
  ],
};

describe('parsePatreonIdentity', () => {
  it('reports active membership to the target campaign', () => {
    const s = parsePatreonIdentity(IDENTITY, 'CAMP1');
    assert.equal(s.active, true);
    assert.equal(s.amountCents, 500);
  });
  it('reports inactive when campaign not matched', () => {
    assert.equal(parsePatreonIdentity(IDENTITY, 'OTHER').active, false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx tsx --test src/services/__tests__/s2-underground.test.mts`

- [ ] **Step 3: Implement**

Append to `src/services/s2-underground.ts`:

```typescript
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
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx tsx --test src/services/__tests__/s2-underground.test.mts`

- [ ] **Step 5: Commit**

```bash
git add src/services/s2-underground.ts src/services/__tests__/s2-underground.test.mts
git commit -m "feat(s2): Patreon identity patron-status parser"
```

---

## Task 7: Sidecar Patreon OAuth routes

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (`/oauth/patreon/callback` + `/api/patreon/oauth-state` PRE-auth like youtube-embed; `/api/patreon/verify` + `/api/patreon/refresh` in the `/api` chain)
- Modify: `src-tauri/sidecar/__tests__/s2-routes.test.mjs`

- [ ] **Step 1: Add the failing test (state store)**

```javascript
import { patreonStateStore } from '../local-api-server.mjs';

test('patreon OAuth state issue/consume is single-use', () => {
  const s = patreonStateStore.issue();
  assert.equal(typeof s, 'string');
  assert.equal(patreonStateStore.consume(s), true);
  assert.equal(patreonStateStore.consume(s), false); // already consumed
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx tsx --test src-tauri/sidecar/__tests__/s2-routes.test.mjs`

- [ ] **Step 3: Implement state store + token helper + routes**

Add near the top-level helpers:

```javascript
export const patreonStateStore = (() => {
  const live = new Map(); // state -> expiresAtMs
  return {
    issue() {
      const s = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/-/g, '');
      live.set(s, Date.now() + 10 * 60 * 1000);
      return s;
    },
    consume(s) {
      const exp = live.get(s);
      live.delete(s);
      return typeof exp === 'number' && exp > Date.now();
    },
  };
})();

async function patreonTokenExchange(params) {
  const res = await fetch('https://www.patreon.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  return res.json();
}
```

PRE-auth routes (place beside the youtube-embed block):

```javascript
  if (requestUrl.pathname === '/api/patreon/oauth-state') {
    return json({ state: patreonStateStore.issue() }, 200, makeCorsHeaders(req));
  }

  if (requestUrl.pathname === '/oauth/patreon/callback') {
    const code = requestUrl.searchParams.get('code') || '';
    const state = requestUrl.searchParams.get('state') || '';
    const ok = code && patreonStateStore.consume(state);
    const page = (msg, payload) => new Response(
      `<!doctype html><meta charset=utf-8><body style="font:14px system-ui;background:#111;color:#eee;padding:24px">${msg}` +
      `<script>try{window.opener&&window.opener.postMessage(${JSON.stringify(payload)},'*')}catch(e){}setTimeout(function(){window.close()},1500)<\/script>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (!ok) return page('Patreon connect failed (bad state).', { type: 'patreon-oauth', ok: false });
    try {
      const tok = await patreonTokenExchange({
        code,
        grant_type: 'authorization_code',
        client_id: process.env.PATREON_OAUTH_CLIENT_ID || '',
        client_secret: process.env.PATREON_OAUTH_CLIENT_SECRET || '',
        redirect_uri: `http://127.0.0.1:${context.port}/oauth/patreon/callback`,
      });
      return page('Patreon connected. You can close this window.', {
        type: 'patreon-oauth', ok: true,
        access_token: tok.access_token, refresh_token: tok.refresh_token,
      });
    } catch (err) {
      return page('Patreon connect failed.', { type: 'patreon-oauth', ok: false, error: String(err?.message || err) });
    }
  }
```

`/api/patreon/verify` and `/api/patreon/refresh` (in the `/api` chain):

```javascript
  if (requestUrl.pathname === '/api/patreon/verify') {
    const token = requestUrl.searchParams.get('accessToken') || process.env.PATREON_ACCESS_TOKEN || '';
    const campaignId = requestUrl.searchParams.get('campaignId') || '';
    if (!token) return json({ active: false, configured: false }, 200, makeCorsHeaders(req));
    try {
      const url = 'https://www.patreon.com/api/oauth2/v2/identity?include=memberships'
        + '&fields%5Bmember%5D=patron_status,currently_entitled_amount_cents';
      const up = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (up.status === 401) return json({ active: false, expired: true }, 200, makeCorsHeaders(req));
      if (!up.ok) throw new Error(`HTTP ${up.status}`);
      return json({ identity: await up.json(), campaignId, configured: true }, 200, makeCorsHeaders(req));
    } catch (err) {
      return json({ error: String(err?.message || err) }, 502, makeCorsHeaders(req));
    }
  }

  if (requestUrl.pathname === '/api/patreon/refresh') {
    const refresh = requestUrl.searchParams.get('refreshToken') || process.env.PATREON_REFRESH_TOKEN || '';
    if (!refresh) return json({ error: 'no refresh token' }, 400, makeCorsHeaders(req));
    try {
      const tok = await patreonTokenExchange({
        grant_type: 'refresh_token', refresh_token: refresh,
        client_id: process.env.PATREON_OAUTH_CLIENT_ID || '',
        client_secret: process.env.PATREON_OAUTH_CLIENT_SECRET || '',
      });
      return json({ access_token: tok.access_token, refresh_token: tok.refresh_token }, 200, makeCorsHeaders(req));
    } catch (err) {
      return json({ error: String(err?.message || err) }, 502, makeCorsHeaders(req));
    }
  }
```

Note: `/api/patreon/verify` returns the raw identity payload; the renderer runs `parsePatreonIdentity` (Task 6) so verification logic stays tested in one place.

- [ ] **Step 4: Run test — expect PASS**

Run: `npx tsx --test src-tauri/sidecar/__tests__/s2-routes.test.mjs`

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck:all
git add src-tauri/sidecar/local-api-server.mjs src-tauri/sidecar/__tests__/s2-routes.test.mjs
git commit -m "feat(s2): sidecar Patreon OAuth callback/verify/refresh"
```

---

## Task 8: Renderer service wrappers

**Files:**
- Modify: `src/services/s2-underground.ts`

- [ ] **Step 1: Confirm the secret getter name**

In `src/services/runtime-config.ts`, confirm the exported getter for a secret value (e.g. `getSecretValue`). `setSecretValue` is confirmed exported. Use the real names below.

- [ ] **Step 2: Add fetch wrappers (thin I/O over tested parsers)**

Append to `src/services/s2-underground.ts`:

```typescript
import { getApiBaseUrl } from './runtime';
import { getSecretValue, setSecretValue } from './runtime-config';

export async function fetchS2Videos(): Promise<S2Video[]> {
  const r = await fetch(`${getApiBaseUrl()}/api/youtube/channel-feed?channelId=${S2_YOUTUBE_CHANNEL_ID}`);
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j.items) ? j.items as S2Video[] : [];
}

export async function fetchS2Audio(): Promise<{ episodes: S2Audio[]; configured: boolean }> {
  const r = await fetch(`${getApiBaseUrl()}/api/patreon/audio-rss`);
  if (!r.ok) return { episodes: [], configured: true };
  return r.json();
}

export async function fetchPatronStatus(): Promise<PatronStatus & { configured: boolean }> {
  const token = await getSecretValue('PATREON_ACCESS_TOKEN');
  if (!token) return { active: false, amountCents: 0, configured: false };
  const r = await fetch(`${getApiBaseUrl()}/api/patreon/verify?accessToken=${encodeURIComponent(token)}&campaignId=${S2_PATREON_CAMPAIGN_ID}`);
  const j = await r.json();
  if (j.expired) {
    const refreshed = await refreshPatronToken();
    if (refreshed) return fetchPatronStatus();
    return { active: false, amountCents: 0, configured: true };
  }
  if (!j.identity) return { active: false, amountCents: 0, configured: true };
  return { ...parsePatreonIdentity(j.identity, S2_PATREON_CAMPAIGN_ID), configured: true };
}

export async function refreshPatronToken(): Promise<boolean> {
  const refresh = await getSecretValue('PATREON_REFRESH_TOKEN');
  if (!refresh) return false;
  const r = await fetch(`${getApiBaseUrl()}/api/patreon/refresh?refreshToken=${encodeURIComponent(refresh)}`);
  const j = await r.json();
  if (!j.access_token) return false;
  await setSecretValue('PATREON_ACCESS_TOKEN', j.access_token);
  if (j.refresh_token) await setSecretValue('PATREON_REFRESH_TOKEN', j.refresh_token);
  return true;
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck:all
git add src/services/s2-underground.ts
git commit -m "feat(s2): renderer service wrappers"
```

---

## Task 9: S2UndergroundPanel component

**Files:**
- Create: `src/components/S2UndergroundPanel.ts`

- [ ] **Step 1: Implement the panel (DOM render; mirrors LiveNewsPanel/SpaceflightNewsPanel)**

```typescript
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getLocalApiPort } from '@/services/runtime';
import { setSecretValue, getSecretValue } from '@/services/runtime-config';
import {
  fetchS2Videos, fetchS2Audio, fetchPatronStatus,
  S2_PATREON_URL,
  type S2Video, type S2Audio,
} from '@/services/s2-underground';

const REFRESH_MS = 30 * 60 * 1000;

export class S2UndergroundPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private activeVideoId: string | null = null;

  constructor() {
    super({
      id: 's2-underground',
      title: 'S2 Underground',
      showCount: true,
      trackActivity: false,
      infoTooltip: 'S2 Underground video briefings (free, via YouTube) plus your Patreon supporter audio + status.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (typeof window !== 'undefined') window.removeEventListener('message', this.onOAuthMessage);
    super.destroy();
  }

  private start(): void {
    void this.render();
    this.refreshTimer = setInterval(() => void this.render(), REFRESH_MS);
  }

  private async render(): Promise<void> {
    try {
      const [videos, audio, patron] = await Promise.all([
        fetchS2Videos(), fetchS2Audio(), fetchPatronStatus(),
      ]);
      this.setCount(videos.length);
      this.setContent(this.buildHtml(videos, audio.episodes, audio.configured, patron));
      this.wireButtons();
    } catch {
      this.setContent('<div style="padding:12px;color:var(--text-secondary,#888)">S2 Underground content unavailable.</div>');
    }
  }

  private buildHtml(
    videos: S2Video[], episodes: S2Audio[], audioConfigured: boolean,
    patron: { active: boolean; amountCents: number; configured: boolean },
  ): string {
    const badge = patron.active
      ? `<span style="background:#16331f;color:#22c55e;border:1px solid #22c55e44;border-radius:3px;padding:1px 6px;font-size:11px">Verified patron · $${(patron.amountCents / 100).toFixed(0)}/mo</span>`
      : patron.configured
        ? `<span style="opacity:.7;font-size:11px">Patreon not active</span> <a href="#" data-s2-connect style="font-size:11px">Connect</a>`
        : `<a href="#" data-s2-connect style="font-size:11px">Connect Patreon</a>`;

    const vids = videos.length
      ? videos.map((v) => `<div data-s2-video="${escapeHtml(v.videoId)}" role="button" tabindex="0" style="display:flex;gap:8px;padding:6px;cursor:pointer;border-bottom:1px solid var(--border-subtle,#222)">
          <img src="${escapeHtml(v.thumbnail)}" alt="" style="width:120px;height:68px;object-fit:cover;border-radius:4px"/>
          <div style="font-size:12px">${escapeHtml(v.title)}<div style="opacity:.6;font-size:10px">${escapeHtml(v.published.slice(0, 10))}</div></div>
        </div>`).join('')
      : '<div style="padding:8px;opacity:.6;font-size:12px">No videos loaded.</div>';

    const player = this.activeVideoId
      ? `<iframe src="http://127.0.0.1:${getLocalApiPort()}/api/youtube-embed?videoId=${escapeHtml(this.activeVideoId)}&autoplay=1&mute=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" style="width:100%;aspect-ratio:16/9;border:0;border-radius:6px;margin-bottom:8px"></iframe>`
      : '';

    const audioSection = !audioConfigured
      ? `<div style="padding:8px;font-size:12px;opacity:.7">Paste your Patreon audio-RSS URL in Settings → API Keys (<code>PATREON_AUDIO_RSS_URL</code>) to list supporter audio.</div>`
      : episodes.length
        ? episodes.map((e) => `<div style="padding:6px;border-bottom:1px solid var(--border-subtle,#222)"><div style="font-size:12px">${escapeHtml(e.title)}</div><audio controls preload="none" src="${escapeHtml(e.audioUrl)}" style="width:100%;height:32px"></audio></div>`).join('')
        : '<div style="padding:8px;opacity:.6;font-size:12px">No audio episodes.</div>';

    return `
      <div style="padding:8px 10px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-subtle,#333)">
        <strong style="font-size:12px">Briefings</strong>${badge}
      </div>
      ${player}
      <div>${vids}</div>
      <div style="padding:8px 10px;border-top:1px solid var(--border-subtle,#333);font-size:12px"><strong>Supporter audio</strong></div>
      ${audioSection}
      <div style="padding:8px 10px;border-top:1px solid var(--border-subtle,#333)"><a href="${S2_PATREON_URL}" target="_blank" rel="noopener" style="font-size:12px">Open S2 on Patreon ↗</a></div>`;
  }

  private wireButtons(): void {
    const root = this.getContentElement();
    root.querySelectorAll('[data-s2-video]').forEach((el) => {
      el.addEventListener('click', () => { this.activeVideoId = el.getAttribute('data-s2-video'); void this.render(); });
    });
    root.querySelector('[data-s2-connect]')?.addEventListener('click', (ev) => { ev.preventDefault(); void this.startPatreonConnect(); });
  }

  private async startPatreonConnect(): Promise<void> {
    const clientId = await getSecretValue('PATREON_OAUTH_CLIENT_ID');
    if (!clientId) { this.setContent('<div style="padding:12px">Set PATREON_OAUTH_CLIENT_ID in Settings → API Keys first.</div>'); return; }
    const port = getLocalApiPort();
    const redirect = encodeURIComponent(`http://127.0.0.1:${port}/oauth/patreon/callback`);
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/patreon/oauth-state`).then((r) => r.json()).catch(() => ({ state: '' }));
    const url = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${redirect}&scope=${encodeURIComponent('identity identity[memberships]')}&state=${encodeURIComponent(stateRes.state || '')}`;
    window.addEventListener('message', this.onOAuthMessage);
    window.open(url, 'patreon-oauth', 'width=600,height=800');
  }

  private readonly onOAuthMessage = async (ev: MessageEvent): Promise<void> => {
    const m = ev.data as { type?: string; ok?: boolean; access_token?: string; refresh_token?: string };
    if (!m || m.type !== 'patreon-oauth') return;
    window.removeEventListener('message', this.onOAuthMessage);
    if (m.ok && m.access_token) {
      await setSecretValue('PATREON_ACCESS_TOKEN', m.access_token);
      if (m.refresh_token) await setSecretValue('PATREON_REFRESH_TOKEN', m.refresh_token);
    }
    void this.render();
  };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck:all
git add src/components/S2UndergroundPanel.ts
git commit -m "feat(s2): S2 Underground panel component"
```

---

## Task 10: Register the panel

**Files:**
- Modify: `src/config/panels.ts`
- Modify: `src/app/panel-layout.ts`

- [ ] **Step 1: Register panel definition in `panels.ts`**

Add near the intel/news panel group:

```typescript
  's2-underground': { name: 'S2 Underground', enabled: true, priority: 1 },
```

Add `'s2-underground'` to the appropriate `panelKeys` array (the cyber/intel group that already contains `'s2u-intel'`).

- [ ] **Step 2: Register instance in `panel-layout.ts`**

Add the import beside the other panel imports:

```typescript
import { S2UndergroundPanel } from '@/components/S2UndergroundPanel';
```

Add the instantiation beside the other `this.ctx.panels[...]` lines (near `s2u-intel`):

```typescript
    this.ctx.panels['s2-underground'] = new S2UndergroundPanel();
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck:all
git add src/config/panels.ts src/app/panel-layout.ts
git commit -m "feat(s2): register S2 Underground panel"
```

---

## Task 11: Fill real constants + full verification + PR

**Files:**
- Modify: `src/services/s2-underground.ts` (constants)

- [ ] **Step 1: Set the confirmed constants**

Replace the placeholder constants with the confirmed values (see plan header / spec Prerequisites):
- `S2_YOUTUBE_CHANNEL_ID` = `<S2 Underground YouTube channel id>`
- `S2_PATREON_CAMPAIGN_ID` = `<S2 Underground Patreon campaign id>`

- [ ] **Step 2: Full verification**

```bash
npm run typecheck:all
npx tsx --test src/services/__tests__/s2-underground.test.mts
npx tsx --test src-tauri/sidecar/__tests__/s2-routes.test.mjs
npx eslint --quiet src/services/s2-underground.ts src/components/S2UndergroundPanel.ts src/services/__tests__/s2-underground.test.mts
```
Expected: typecheck zero errors; all tests pass; eslint clean.

- [ ] **Step 3: Commit + push + PR**

```bash
git add src/services/s2-underground.ts
git commit -m "feat(s2): set confirmed S2 channel/campaign ids"
git push -u origin claude/s2-underground-panel
gh pr create --base main --head claude/s2-underground-panel \
  --title "feat(panels): S2 Underground panel (YouTube briefings + Patreon supporter layer)" \
  --body "Implements docs/superpowers/specs/2026-06-01-s2-underground-panel-design.md"
```

---

## Self-Review

**Spec coverage:**
- Video briefings (YouTube, in-app) → Tasks 2, 3, 9 (embed via existing bridge). ✓
- Supporter audio (audio-RSS) → Tasks 4, 5, 9. ✓
- Verified-patron badge (OAuth) → Tasks 1, 6, 7, 8, 9, 10. ✓
- Secrets (5 keys, client_secret server-only) → Task 1; client_secret only read in sidecar (Task 7). ✓
- Error handling / freshness (recordFeed*, graceful empty states) → Tasks 3, 5, 9. ✓
- Testing (pure parsers + sidecar smoke) → Tasks 2,4,6 + 3,5,7. ✓
- Out-of-scope items not implemented. ✓

**Placeholder scan:** Code steps contain full code. The only intentional placeholders are the two external-input constants (channel/campaign id), flagged in the header and resolved in Task 11. No `.exec(` used anywhere (regex via `.match`/`.matchAll`) to avoid the repo's command-injection guard hook false-positive.

**Type consistency:** `S2Video`/`S2Audio`/`PatronStatus` defined in Task 2/4/6 and consumed in Tasks 8/9 with matching fields. Sidecar parsers mirror renderer parsers (`sidecarParse*`). `parsePatreonIdentity` used in Task 6 (test) and Task 8 (verify flow). `setSecretValue`/`getSecretValue` used consistently (getter name confirmed in Task 8 Step 1). `patreonStateStore.issue/consume` consistent across Tasks 7/9. ✓

**Open confirmations (external, flagged in-task):** real channel/campaign IDs (Task 11); whether Patreon accepts the `127.0.0.1` redirect URI (spec fallback: `crystalball://` deep-link); exact `getSecretValue` getter name (Task 8 Step 1).

/* eslint-disable sonarjs/cognitive-complexity, sonarjs/todo-tag */
// Viable TODO-002 scaffold: server-side RSS aggregator with graceful fallback.
// See docs/TODO_002_RSS_AGGREGATION_DESIGN.md for the full design.
//
// This endpoint is INTENTIONALLY a scaffold — it returns a valid response shape
// but does not yet fan out to real feeds. Wire it behind the
// `refactor:news-aggregate` feature flag per docs/REFACTOR_SAFETY.md before
// flipping client default.
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const CACHE_TTL_SEC = 120;         // edge + CDN cache
const SWR_TTL_SEC = 300;           // stale-while-revalidate
const CACHE_KEY_PREFIX = 'news-agg:v1:';

let aggregateRatelimit = null;
let redisClient = null;

function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redisClient = new Redis({ url, token });
  return redisClient;
}

function getAggregateRatelimit() {
  if (aggregateRatelimit) return aggregateRatelimit;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  aggregateRatelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(60, '60 s'),
    prefix: 'rl:news-aggregate',
    analytics: false,
  });
  return aggregateRatelimit;
}

function getClientIp(request) {
  return (
    request.headers.get('x-real-ip')
    || request.headers.get('cf-connecting-ip')
    || '0.0.0.0'
  );
}

function cacheHeaders() {
  return {
    'Cache-Control': `public, s-maxage=${CACHE_TTL_SEC}, stale-while-revalidate=${SWR_TTL_SEC}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

async function buildAggregate(variant, since) {
  // TODO: fetch baseline feeds for this variant and merge. For now, return
  // the scaffold shape so clients can code against the contract.
  //
  // Real implementation should:
  //   1. Look up VARIANT_FEEDS[variant] from a shared config (mirror of
  //      server/crystalball/news/v1/_feeds.ts)
  //   2. Fan out in parallel with per-feed timeout (3s)
  //   3. Parse XML/RSS in edge-safe way (fast-xml-parser)
  //   4. Merge + dedupe + sort by pubDate desc
  //   5. Cap at 500 items
  const generatedAt = Date.now();
  return {
    generatedAt,
    staleSinceMs: 0,
    successfulSources: [],
    failedSources: [],
    items: [], // intentionally empty until feed fan-out is implemented
    variant,
    scaffold: true, // marks this as the placeholder — client should fall back
    contractVersion: '1.0',
    since: since || null,
  };
}

export default async function handler(request) {
  const origin = request.headers.get('origin') || '';
  const corsHeaders = getCorsHeaders(origin);
  if (isDisallowedOrigin(origin)) {
    return new Response('Disallowed origin', { status: 403, headers: corsHeaders });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Rate limiting — optional (skipped when Redis is unavailable)
  const rl = getAggregateRatelimit();
  if (rl) {
    try {
      const { success } = await rl.limit(getClientIp(request));
      if (!success) {
        return Response.json({ error: 'Too many requests' }, {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
        });
      }
    } catch {
      // Redis flake — continue without rate limiting
    }
  }

  const url = new URL(request.url);
  const variant = (url.searchParams.get('variant') || 'full').toLowerCase();
  const allowedVariants = new Set(['full', 'tech', 'finance', 'happy']);
  if (!allowedVariants.has(variant)) {
    return Response.json({ error: 'Invalid variant' }, {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const since = Number.parseInt(url.searchParams.get('since') || '0', 10) || 0;

  // Try Redis cache first (edge cache also handles this at the CDN layer)
  const redis = getRedis();
  const cacheKey = `${CACHE_KEY_PREFIX}${variant}`;
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached && typeof cached === 'object') {
        // If the client sent ?since= and nothing newer, return 304
        const generatedAt = cached.generatedAt || 0;
        if (since > 0 && generatedAt <= since) {
          return new Response(null, { status: 304, headers: { ...corsHeaders, ...cacheHeaders() } });
        }
        return Response.json(cached, {
          status: 200,
          headers: { ...corsHeaders, ...cacheHeaders() },
        });
      }
    } catch {
      // Redis miss/flake — fall through to live build
    }
  }

  // Live build (scaffold for now)
  const aggregate = await buildAggregate(variant, since);

  // Write-through to Redis (best-effort)
  if (redis) {
    try {
      await redis.set(cacheKey, aggregate, { ex: CACHE_TTL_SEC * 2 });
    } catch {
      // Swallow — caching is best-effort
    }
  }

  return Response.json(aggregate, {
    status: 200,
    headers: { ...corsHeaders, ...cacheHeaders() },
  });
}

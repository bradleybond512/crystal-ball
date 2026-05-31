/**
 * GOES imagery — animation-frame proxy.
 *
 * Given sat / sector / product query params, fetches the NESDIS
 * directory listing and returns the most recent timestamped frames (so
 * the panel can play a live loop) plus the latest still URL + freshness.
 *
 * Free, no key. East = GOES-19 (GOES-16 retired 2025-04-04), West = GOES-18.
 *
 * The frame parser mirrors src/services/imagery/goes-catalog.ts; keep
 * the two in sync (the TS version is the source of truth + is unit-tested).
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const CDN = 'https://cdn.star.nesdis.noaa.gov';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_FRAMES = 24;

const SATELLITES = new Set(['GOES19', 'GOES18']);
const SECTORS = {
  CONUS: { animationSize: '1250x750', stillSize: '2500x1500' },
  FD: { animationSize: '1808x1808', stillSize: '1808x1808' },
};
const PRODUCTS = new Set(['GEOCOLOR', '13', '07', '08', '09']);

export const cache = new Map();

const j = (payload, status, cors) =>
  Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });

function dirUrl(sat, sector, product) {
  return `${CDN}/${sat}/ABI/${sector}/${product}/`;
}

function goesTimestampToEpoch(stamp) {
  if (!/^\d{11}$/.test(stamp)) return null;
  const year = Number(stamp.slice(0, 4));
  const doy = Number(stamp.slice(4, 7));
  const hour = Number(stamp.slice(7, 9));
  const minute = Number(stamp.slice(9, 11));
  if (doy < 1 || doy > 366 || hour > 23 || minute > 59) return null;
  const ms = Date.UTC(year, 0, 1, hour, minute, 0, 0) + (doy - 1) * 86_400_000;
  if (new Date(ms).getUTCFullYear() !== year) return null;
  return ms;
}

function parseFrames(html, sat, sector, product, size) {
  const dir = dirUrl(sat, sector, product);
  const re = new RegExp(String.raw`(\d{11})_${sat}-ABI-${sector}-${product}-${size}\.jpg`, 'g');
  const seen = new Set();
  const frames = [];
  for (const m of html.matchAll(re)) {
    const ts = m[1];
    if (seen.has(ts)) continue;
    const epochMs = goesTimestampToEpoch(ts);
    if (epochMs === null) continue;
    seen.add(ts);
    frames.push({
      timestamp: ts,
      epochMs,
      url: `${dir}${ts}_${sat}-ABI-${sector}-${product}-${size}.jpg`,
    });
  }
  frames.sort((a, b) => a.epochMs - b.epochMs);
  return frames.slice(-MAX_FRAMES);
}

async function buildPayload(sat, sector, product) {
  const sec = SECTORS[sector];
  const dir = dirUrl(sat, sector, product);
  let frames = [];
  let degraded = false;
  let reason;
  try {
    const r = await fetch(dir, {
      headers: { 'User-Agent': 'CrystalBall/2 (goes-imagery)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (r.ok) {
      const html = await r.text();
      frames = parseFrames(html, sat, sector, product, sec.animationSize);
    } else {
      degraded = true;
      reason = `NESDIS listing HTTP ${r.status}`;
    }
  } catch (error) {
    degraded = true;
    reason = error?.message ?? String(error);
  }
  const latestFrame = frames.length > 0 ? frames.at(-1) : null;
  return {
    satellite: sat,
    sector,
    product,
    latestUrl: `${dir}latest.jpg`,
    stillUrl: `${dir}latest.jpg`,
    animationSize: sec.animationSize,
    stillSize: sec.stillSize,
    frames,
    frameCount: frames.length,
    latestFrameAt: latestFrame ? new Date(latestFrame.epochMs).toISOString() : null,
    degraded,
    reason,
    generatedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL_MS / 1000,
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const sat = (url.searchParams.get('sat') || 'GOES19').toUpperCase();
  const sector = (url.searchParams.get('sector') || 'CONUS').toUpperCase();
  const product = (url.searchParams.get('product') || 'GEOCOLOR').toUpperCase();

  if (!SATELLITES.has(sat) || !SECTORS[sector] || !PRODUCTS.has(product)) {
    return j({ error: 'Invalid sat/sector/product', sat, sector, product }, 400, cors);
  }

  const key = `${sat}:${sector}:${product}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const payload = await buildPayload(sat, sector, product);
  cache.set(key, { at: Date.now(), payload });
  return j(payload, 200, cors);
}

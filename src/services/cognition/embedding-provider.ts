/**
 * Embedding Provider — two-tier, local-first embedding adapter.
 *
 * Tier 1 (neural): POST /api/intel-embed (sidecar) → Ollama nomic-embed-text
 *   (768-dim). 10s timeout. Returns 503 when Ollama is absent.
 *
 * Tier 2 (hashed): deterministic 256-dim djb2 hashed bag-of-words embedder,
 *   L2-normalized. Fully offline, test-stable, and used as fallback when the
 *   sidecar is unreachable or returns non-OK.
 *
 * Vectors of different tiers are never compared against each other — the
 * vector-index partitions by tier. When Ollama appears, new episodes get
 * neural vectors; old hashed episodes are lazily re-embedded on access
 * (max 20 per session) to avoid a migration stampede.
 *
 * Pure module: no DOM, no globals at import time. Fetch is guarded behind
 * an async function; tests import embedHashed directly.
 */

import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';

// ── Public types ──────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  vector: Float32Array;
  tier: 'neural' | 'hashed';
  dim: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMBED_ENDPOINT = '/api/intel-embed';
const EMBED_TIMEOUT_MS = 10_000;
const HASHED_DIM = 256;
const NEURAL_DIM = 768; // nomic-embed-text default

// ── Hashed embedder (deterministic, offline) ──────────────────────────────────

/**
 * djb2 hash — maps a string token to a bucket index [0, buckets).
 * Pure arithmetic: no dependencies, no globals.
 */
function djb2(token: string, buckets: number): number {
  let h = 5381;
  for (const ch of token) {
    h = ((h << 5) + h + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return h % buckets;
}

/**
 * Tokenize text: lowercase, split on non-alphanumeric, discard empty tokens.
 * Deterministic — same text always produces the same token list.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 0);
}

/**
 * L2-normalize a float vector in-place. No-op when norm is 0 to avoid NaN.
 */
function l2NormalizeInPlace(vec: Float32Array): void {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return;
  for (let i = 0; i < vec.length; i++) { const v = vec[i] ?? 0; vec[i] = v / norm; }
}

/**
 * Deterministic hashed bag-of-words embedder, 256-dim, L2-normalized.
 * Exported separately for tests and sync callers; used as the fallback
 * when the sidecar is unavailable.
 *
 * Quality is below neural embeddings but it is deterministic, offline,
 * and fully test-stable — all unit tests run against this tier only.
 */
export function embedHashed(text: string): EmbeddingResult {
  const vec = new Float32Array(HASHED_DIM);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const bucket = djb2(token, HASHED_DIM);
    vec[bucket] = (vec[bucket] ?? 0) + 1;
  }
  l2NormalizeInPlace(vec);
  return { vector: vec, tier: 'hashed', dim: HASHED_DIM };
}

// ── Neural embedding via sidecar ──────────────────────────────────────────────

interface EmbedResponseShape {
  vector?: unknown;
  error?: unknown;
}

async function tryNeuralEmbedding(text: string): Promise<EmbeddingResult | null> {
  if (!isDesktopRuntime()) return null;
  const base = getApiBaseUrl();
  if (!base) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${EMBED_ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json() as EmbedResponseShape;
    if (!Array.isArray(json.vector)) return null;
    const raw = json.vector as number[];
    if (raw.length !== NEURAL_DIM) return null;
    const vec = new Float32Array(raw);
    l2NormalizeInPlace(vec);
    return { vector: vec, tier: 'neural', dim: NEURAL_DIM };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Local-first embedding. Tries the sidecar neural path first; falls back
 * to the deterministic hashed embedder when the sidecar is unavailable or
 * returns a non-OK / malformed response.
 */
export async function embed(text: string): Promise<EmbeddingResult> {
  const neural = await tryNeuralEmbedding(text);
  if (neural !== null) return neural;
  return embedHashed(text);
}

// ── Lazy re-embed on tier upgrade ─────────────────────────────────────────────

/** Track how many hashed→neural re-embeds have been done this session. */
let _reEmbedThisSession = 0;
const RE_EMBED_SESSION_CAP = 20;

/**
 * If Ollama is now available and this episode still has a hashed vector,
 * re-embed it to neural quality. Capped at 20 per session to prevent a
 * stampede when Ollama first appears.
 *
 * Returns the upgraded EmbeddingResult or null if no upgrade occurred.
 */
export async function maybeUpgradeEmbedding(
  currentTier: 'neural' | 'hashed',
  text: string,
): Promise<EmbeddingResult | null> {
  if (currentTier === 'neural') return null;
  if (_reEmbedThisSession >= RE_EMBED_SESSION_CAP) return null;
  const result = await tryNeuralEmbedding(text);
  if (result === null) return null;
  _reEmbedThisSession += 1;
  return result;
}

/** Reset the session re-embed counter (tests / boot). */
export function _resetReEmbedCounterForTests(): void {
  _reEmbedThisSession = 0;
}

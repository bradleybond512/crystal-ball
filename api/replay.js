import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getFixtures } from './_algorithm-state.js';

export const config = { runtime: 'edge' };

const REGRESSION_THRESHOLD = 0.1;
const WINDOW_SIZE = 50;

function decisionsEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
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
  const url = new URL(req.url);
  const algorithmId = url.searchParams.get('algorithmId');
  if (!algorithmId) {
    return Response.json(
      { error: 'algorithmId is required' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }

  // Sidecar can't actually re-run renderer-side TS code. We expose the
  // fixture list and a stub regression report so external tools can
  // operate on the corpus directly. Renderer-side replay invokes the
  // src/services/algorithms/replay-engine.ts module via TS imports.
  const fixtures = getFixtures(algorithmId);
  const recent = fixtures.slice(-WINDOW_SIZE);
  return Response.json(
    {
      algorithmId,
      total: recent.length,
      windowSize: WINDOW_SIZE,
      regressionThreshold: REGRESSION_THRESHOLD,
      // The sidecar cannot re-run algorithms; provide the corpus and
      // a fingerprint hash for renderer-side comparison.
      fixtures: recent.map((f) => ({
        id: f.id,
        recordedAt: f.recordedAt,
        severity: f.severity,
        inputsHash: hashInputs(f.inputs),
        decision: f.decision,
      })),
      decisionsEqualHelper: 'see src/services/algorithms/replay-engine.ts',
      _decisionsEqualSampleCheck: decisionsEqual({ a: 1 }, { a: 1 }),
    },
    { headers: { 'Content-Type': 'application/json', 'cache-control': 'no-store', ...corsHeaders } },
  );
}

function hashInputs(value) {
  const str = JSON.stringify(value ?? null);
  let h = 0;
  for (const ch of str) {
    h = Math.trunc(h * 31 + ch.codePointAt(0));
  }
  return `h${(h >>> 0).toString(16)}`;
}

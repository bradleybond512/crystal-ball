import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';
import { getAlgorithmState } from '../_algorithm-state.js';

export const config = { runtime: 'edge' };

function handleGet(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, POST, OPTIONS');
  const state = getAlgorithmState();
  const byAlgorithm = new Map();
  for (const r of state.shadowLedger.values()) {
    const summary = byAlgorithm.get(r.algorithmId) ?? { graded: 0, total: 0 };
    summary.total += 1;
    if (r.outcome !== undefined) summary.graded += 1;
    byAlgorithm.set(r.algorithmId, summary);
  }
  return Response.json(
    {
      shadowAlgorithms: [...byAlgorithm.keys()].sort((a, b) => a.localeCompare(b)),
      summary: Object.fromEntries(byAlgorithm),
    },
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

async function handlePost(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, POST, OPTIONS');
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  const action = body?.action;
  const algorithmId = typeof body?.algorithmId === 'string' ? body.algorithmId : null;
  if (!algorithmId || (action !== 'enable' && action !== 'disable')) {
    return Response.json(
      { error: 'algorithmId and action (enable|disable) are required' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  const state = getAlgorithmState();
  state.lifecycle.set(algorithmId, {
    algorithmId,
    state: action === 'enable' ? 'shadow' : 'deprecated',
    transitions: [
      ...((state.lifecycle.get(algorithmId) || {}).transitions || []),
      { at: Date.now(), to: action === 'enable' ? 'shadow' : 'deprecated' },
    ],
  });
  return Response.json(
    { algorithmId, state: state.lifecycle.get(algorithmId) },
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, POST, OPTIONS');
  if (isDisallowedOrigin(req)) {
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return Response.json(
    { error: 'Method not allowed' },
    { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

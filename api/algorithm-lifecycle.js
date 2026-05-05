import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getAlgorithmState } from './_algorithm-state.js';

export const config = { runtime: 'edge' };

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
  const state = getAlgorithmState();
  if (!algorithmId) {
    const all = [];
    for (const e of state.lifecycle.values()) all.push({ ...e });
    return Response.json(
      { lifecycles: all },
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  const entry = state.lifecycle.get(algorithmId);
  if (!entry) {
    return Response.json(
      { error: `No lifecycle for ${algorithmId}` },
      { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  return Response.json(
    { ...entry },
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

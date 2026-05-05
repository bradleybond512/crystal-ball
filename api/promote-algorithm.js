import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getAlgorithmState } from './_algorithm-state.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'POST, OPTIONS');
  if (isDisallowedOrigin(req)) {
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }

  const algorithmId = typeof body?.algorithmId === 'string' ? body.algorithmId : null;
  const reason = typeof body?.reason === 'string' ? body.reason : 'human approval';
  if (!algorithmId) {
    return Response.json(
      { error: 'algorithmId is required' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }

  const state = getAlgorithmState();
  const entry = state.lifecycle.get(algorithmId);
  if (!entry) {
    return Response.json(
      { error: `No lifecycle for ${algorithmId}` },
      { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  if (entry.state !== 'candidate') {
    return Response.json(
      { error: `Cannot promote: state is ${entry.state}, must be candidate` },
      { status: 409, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  const at = Date.now();
  const updated = {
    ...entry,
    state: 'live',
    enteredStateAt: at,
    transitions: [
      ...(entry.transitions ?? []),
      { at, from: 'candidate', to: 'live', reason, initiator: 'human' },
    ],
  };
  state.lifecycle.set(algorithmId, updated);
  return Response.json(
    { ...updated },
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

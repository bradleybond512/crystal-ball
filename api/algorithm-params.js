import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getAlgorithmState, getParams, setParam } from './_algorithm-state.js';

export const config = { runtime: 'edge' };

function unauthorizedOrigin(req, methods) {
  const corsHeaders = getCorsHeaders(req, methods);
  if (isDisallowedOrigin(req)) {
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  return null;
}

function methodNotAllowed(req, methods) {
  return Response.json(
    { error: 'Method not allowed' },
    {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req, methods) },
    },
  );
}

function handleGet(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, POST, OPTIONS');
  const url = new URL(req.url);
  const algorithmId = url.searchParams.get('algorithmId');
  if (!algorithmId) {
    const state = getAlgorithmState();
    const out = {};
    for (const [id, params] of state.params) {
      out[id] = Object.fromEntries(params);
    }
    return Response.json({ all: out }, { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
  const params = getParams(algorithmId);
  return Response.json(
    { algorithmId, params },
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
  const algorithmId = typeof body?.algorithmId === 'string' ? body.algorithmId : null;
  const param = typeof body?.param === 'string' ? body.param : null;
  const value = body?.value;
  if (!algorithmId || !param) {
    return Response.json(
      { error: 'algorithmId and param are required' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  if (typeof value !== 'number' && typeof value !== 'boolean') {
    return Response.json(
      { error: 'value must be a number or boolean' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  setParam(algorithmId, param, value);
  return Response.json(
    { algorithmId, params: getParams(algorithmId) },
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

export default async function handler(req) {
  const blocked = unauthorizedOrigin(req, 'GET, POST, OPTIONS');
  if (blocked) return blocked;
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req, 'GET, POST, OPTIONS') });
  }
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return methodNotAllowed(req, 'GET, POST, OPTIONS');
}

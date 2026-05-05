import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';
import { listPending } from '../_algorithm-state.js';

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

  const pending = listPending();
  const now = Date.now();
  const due = pending.filter((p) => p.msUntilDue <= 0);
  return Response.json(
    {
      now,
      pending,
      dueCount: due.length,
      totalCount: pending.length,
    },
    { headers: { 'Content-Type': 'application/json', 'cache-control': 'no-store', ...corsHeaders } },
  );
}

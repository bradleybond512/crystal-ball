import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import {
  annotationCounts,
  listAnnotations,
  recordAnnotation,
  recordOutcome,
  getAlgorithmState,
} from './_algorithm-state.js';

export const config = { runtime: 'edge' };

const ANNOTATION_TO_GRADE = {
  confirmed: { outcome: 'hit', verdict: 'TRUE_POSITIVE', reason: 'user confirmed' },
  false_positive: { outcome: 'miss', verdict: 'FALSE_POSITIVE', reason: 'user flagged as false positive' },
  missed: { outcome: 'miss', verdict: 'FALSE_NEGATIVE', reason: 'user reported missed event' },
  observed_early: { outcome: 'hit', verdict: 'TRUE_POSITIVE', reason: 'user observed event early' },
  inconclusive: null,
};

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
  let stored;
  try {
    stored = recordAnnotation(body);
  } catch (error) {
    return Response.json(
      { error: error?.message || String(error) },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  // Bridge to grade if applicable.
  const grade = ANNOTATION_TO_GRADE[stored.annotationType];
  let gradedRecord = null;
  if (grade) {
    const state = getAlgorithmState();
    const record = state.ledger.get(stored.alertId);
    if (record && record.outcome === undefined) {
      try {
        gradedRecord = recordOutcome(stored.alertId, grade.outcome, grade.verdict, grade.reason);
      } catch {
        gradedRecord = null;
      }
    }
  }
  return Response.json(
    { annotation: stored, graded: gradedRecord !== null },
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

function handleGet(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, POST, OPTIONS');
  const url = new URL(req.url);
  const algorithmId = url.searchParams.get('algorithmId') || undefined;
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? Number(sinceParam) : undefined;
  if (since !== undefined && !Number.isFinite(since)) {
    return Response.json(
      { error: 'since must be a number (ms timestamp)' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  const filter = {};
  if (algorithmId) filter.algorithmId = algorithmId;
  if (since !== undefined) filter.since = since;
  const list = listAnnotations(filter);
  const counts = annotationCounts(algorithmId);
  return Response.json(
    {
      algorithmId: algorithmId ?? null,
      total: list.length,
      annotations: list,
      ...counts,
    },
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

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getAlgorithmState } from './_algorithm-state.js';

export const config = { runtime: 'edge' };

const CRITERIA = {
  minPrecision: 0.7,
  minRecall: 0.6,
  minF1: 0.65,
  minGradedEvents: 50,
};

function parseVerdict(record) {
  if (typeof record.outcomeReason === 'string') {
    const m = record.outcomeReason.match(/^\[(TRUE_POSITIVE|FALSE_POSITIVE|TRUE_NEGATIVE|FALSE_NEGATIVE|INCONCLUSIVE)\]/);
    if (m) return m[1];
  }
  if (record.outcome === 'hit' || record.outcome === 'partial') return 'TRUE_POSITIVE';
  if (record.outcome === 'inconclusive') return 'TRUE_NEGATIVE';
  if (record.outcome === 'miss') {
    if (typeof record.score === 'number' && record.score >= 0.5) return 'FALSE_POSITIVE';
    return 'FALSE_NEGATIVE';
  }
  return null;
}

function evaluate(decisions) {
  const graded = decisions.filter((d) => d.outcome !== undefined);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const d of graded) {
    const v = parseVerdict(d);
    if (v === 'TRUE_POSITIVE') tp += 1;
    else if (v === 'FALSE_POSITIVE') fp += 1;
    else if (v === 'FALSE_NEGATIVE') fn += 1;
  }
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  const reasons = [];
  if (graded.length < CRITERIA.minGradedEvents) {
    reasons.push(`need >=${CRITERIA.minGradedEvents} graded events, have ${graded.length}`);
  }
  if (!(precision !== null && precision >= CRITERIA.minPrecision)) {
    reasons.push(`precision below ${CRITERIA.minPrecision}`);
  }
  if (!(recall !== null && recall >= CRITERIA.minRecall)) {
    reasons.push(`recall below ${CRITERIA.minRecall}`);
  }
  if (!(f1 !== null && f1 >= CRITERIA.minF1)) {
    reasons.push(`F1 below ${CRITERIA.minF1}`);
  }
  return { eligible: reasons.length === 0, graded: graded.length, precision, recall, f1, reasons };
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
  const state = getAlgorithmState();
  const decisions = [];
  for (const r of state.shadowLedger.values()) {
    if (r.algorithmId === algorithmId) decisions.push(r);
  }
  const result = evaluate(decisions);
  return Response.json(
    { algorithmId, criteria: CRITERIA, ...result },
    { headers: { 'Content-Type': 'application/json', 'cache-control': 'no-store', ...corsHeaders } },
  );
}

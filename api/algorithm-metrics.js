import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getAlgorithmState } from './_algorithm-state.js';

export const config = { runtime: 'edge' };

const WINDOW_MS = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  all: Number.POSITIVE_INFINITY,
};

const VERDICT_MAP = {
  hit: 'TRUE_POSITIVE',
  partial: 'TRUE_POSITIVE',
  miss: null,
  inconclusive: 'TRUE_NEGATIVE',
};

function parseVerdict(record) {
  if (typeof record.outcomeReason === 'string') {
    const m = record.outcomeReason.match(/^\[(TRUE_POSITIVE|FALSE_POSITIVE|TRUE_NEGATIVE|FALSE_NEGATIVE|INCONCLUSIVE)\]/);
    if (m) return m[1];
  }
  const fallback = VERDICT_MAP[record.outcome];
  if (fallback !== null && fallback !== undefined) return fallback;
  if (record.outcome === 'miss') {
    if (typeof record.score === 'number' && record.score >= 0.5) return 'FALSE_POSITIVE';
    return 'FALSE_NEGATIVE';
  }
  return null;
}

function tallyVerdict(counts, verdict) {
  if (verdict === 'TRUE_POSITIVE') counts.tp += 1;
  else if (verdict === 'FALSE_POSITIVE') counts.fp += 1;
  else if (verdict === 'TRUE_NEGATIVE') counts.tn += 1;
  else if (verdict === 'FALSE_NEGATIVE') counts.fn += 1;
}

function brierContribution(record, verdict) {
  if (!verdict) return null;
  if (typeof record.score !== 'number' || !Number.isFinite(record.score)) return null;
  const actual = verdict === 'TRUE_POSITIVE' || verdict === 'FALSE_NEGATIVE' ? 1 : 0;
  return (record.score - actual) ** 2;
}

function ratioOrNull(num, denom) {
  return denom === 0 ? null : num / denom;
}

function computeMetrics(records) {
  const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
  let brierSum = 0;
  let brierN = 0;
  for (const r of records) {
    const v = parseVerdict(r);
    tallyVerdict(counts, v);
    const brier = brierContribution(r, v);
    if (brier !== null) {
      brierSum += brier;
      brierN += 1;
    }
  }
  const precision = ratioOrNull(counts.tp, counts.tp + counts.fp);
  const recall = ratioOrNull(counts.tp, counts.tp + counts.fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  const decided = counts.tp + counts.fp + counts.tn + counts.fn;
  const accuracy = ratioOrNull(counts.tp + counts.tn, decided);
  const brier = ratioOrNull(brierSum, brierN);
  return {
    truePositive: counts.tp,
    falsePositive: counts.fp,
    trueNegative: counts.tn,
    falseNegative: counts.fn,
    total: records.length,
    precision,
    recall,
    f1,
    accuracy,
    brier,
  };
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
  const window = url.searchParams.get('window') || 'all';
  if (!algorithmId) {
    return Response.json(
      { error: 'algorithmId is required' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  if (!(window in WINDOW_MS)) {
    return Response.json(
      { error: `Unknown window "${window}". Use 7d / 30d / 90d / all.` },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }

  const state = getAlgorithmState();
  const all = [];
  for (const r of state.ledger.values()) {
    if (r.algorithmId !== algorithmId) continue;
    if (r.outcome === undefined) continue;
    all.push(r);
  }
  const now = Date.now();
  const cutoff = now - WINDOW_MS[window];
  const filtered = window === 'all' ? all : all.filter((r) => r.at >= cutoff);
  const metrics = computeMetrics(filtered);

  return Response.json(
    {
      algorithmId,
      window,
      generatedAt: now,
      metrics,
    },
    { headers: { 'Content-Type': 'application/json', 'cache-control': 'no-store', ...corsHeaders } },
  );
}

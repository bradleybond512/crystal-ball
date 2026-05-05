import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';
import { getAlgorithmState, recordOutcome } from '../_algorithm-state.js';

export const config = { runtime: 'edge' };

function isPartialHit(predicted, observed) {
  return (
    typeof predicted === 'number' &&
    typeof observed === 'number' &&
    Number.isFinite(predicted) &&
    Number.isFinite(observed) &&
    observed + 0.1 < predicted
  );
}

function inferAlertFired(record, observation) {
  if (typeof observation.alertFired === 'boolean') return observation.alertFired;
  const score = typeof record.score === 'number' ? record.score : 0;
  return Number.isFinite(score) && score >= 0.5;
}

function gradeFromObservation(record, observation) {
  const inferredFired = inferAlertFired(record, observation);
  const eventOccurred = !!observation.eventOccurred;
  const score = typeof record.score === 'number' ? record.score : 0;
  const predicted = typeof observation.predictedSeverity === 'number' ? observation.predictedSeverity : score;
  const observed = typeof observation.observedSeverity === 'number' ? observation.observedSeverity : null;
  const note = observation.notes ? ` ${observation.notes}` : '';

  if (eventOccurred && inferredFired) {
    if (isPartialHit(predicted, observed)) {
      return {
        verdict: 'TRUE_POSITIVE',
        outcome: 'partial',
        reason: `partial hit: predicted ${predicted.toFixed(2)}, observed ${observed.toFixed(2)}.${note}`.trim(),
      };
    }
    return {
      verdict: 'TRUE_POSITIVE',
      outcome: 'hit',
      reason: `event occurred and alert fired.${note}`.trim(),
    };
  }
  if (eventOccurred) {
    return {
      verdict: 'FALSE_NEGATIVE',
      outcome: 'miss',
      reason: `event occurred but alert did not fire.${note}`.trim(),
    };
  }
  if (inferredFired) {
    return {
      verdict: 'FALSE_POSITIVE',
      outcome: 'miss',
      reason: `alert fired but event did not occur.${note}`.trim(),
    };
  }
  return {
    verdict: 'TRUE_NEGATIVE',
    outcome: 'inconclusive',
    reason: `no event, no alert.${note}`.trim(),
  };
}

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

  const id = typeof body?.id === 'string' ? body.id : null;
  if (!id) {
    return Response.json(
      { error: 'id is required' },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }

  const state = getAlgorithmState();
  const record = state.ledger.get(id);
  if (!record) {
    return Response.json(
      { error: `Unknown evaluation id: ${id}` },
      { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
  if (record.outcome !== undefined) {
    return Response.json(
      { error: `Evaluation already graded as ${record.outcome}` },
      { status: 409, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }

  const observation = body.observation && typeof body.observation === 'object' ? body.observation : {};
  const grade = gradeFromObservation(record, observation);
  try {
    const updated = recordOutcome(id, grade.outcome, grade.verdict, grade.reason);
    return Response.json(
      { record: updated, verdict: grade.verdict, outcome: grade.outcome, reason: grade.reason },
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  } catch (error) {
    return Response.json(
      { error: error?.message || String(error) },
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
}

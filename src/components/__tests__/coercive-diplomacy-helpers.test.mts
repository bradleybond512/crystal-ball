import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getByActionType,
  getOngoingTensions,
  getMostSevere,
  rankByTension,
  actionClass,
  tensionClass,
  outcomeClass,
  computeGlobalDiplomaticStabilityIndex,
  buildRenderData,
  type CoercionIncident,
  type BilateralTension,
  type CoercionActionType,
  type CoercionOutcome,
  type TensionStatus,
} from '../coercive-diplomacy-helpers.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_INCIDENTS: CoercionIncident[] = [
  { id: 'I1', actor: 'A', target: 'B', actionType: 'Expulsion', date: '2022-03', description: 'Mass expulsion', outcome: 'Ongoing', severity: 9 },
  { id: 'I2', actor: 'C', target: 'D', actionType: 'Consulate Closure', date: '2021-11', description: 'Consulate closed', outcome: 'Escalated', severity: 8 },
  { id: 'I3', actor: 'E', target: 'F', actionType: 'Downgrade', date: '2023-01', description: 'Downgrade relations', outcome: 'Resolved', severity: 5 },
  { id: 'I4', actor: 'G', target: 'H', actionType: 'Travel Ban', date: '2022-06', description: 'Travel ban imposed', outcome: 'Partially Resolved', severity: 4 },
  { id: 'I5', actor: 'I', target: 'J', actionType: 'Threat', date: '2023-10', description: 'Economic threat', outcome: 'Ongoing', severity: 10 },
  { id: 'I6', actor: 'K', target: 'L', actionType: 'Recall', date: '2022-03', description: 'Ambassador recalled', outcome: 'Ongoing', severity: 7 },
  { id: 'I7', actor: 'M', target: 'N', actionType: 'Expulsion', date: '2023-05', description: 'Tit-for-tat expulsion', outcome: 'Failed', severity: 6 },
];

const MOCK_TENSIONS: BilateralTension[] = [
  { id: 'T1', partyA: 'Russia', partyB: 'NATO', status: 'Escalating', tensionScore: 95, primaryGrievance: 'Ukraine', lastIncident: '2024-09', trend: 'deteriorating' },
  { id: 'T2', partyA: 'China', partyB: 'USA', status: 'Active', tensionScore: 80, primaryGrievance: 'Taiwan', lastIncident: '2024-08', trend: 'stable' },
  { id: 'T3', partyA: 'UK', partyB: 'Argentina', status: 'Frozen', tensionScore: 35, primaryGrievance: 'Falklands', lastIncident: '2023-04', trend: 'stable' },
  { id: 'T4', partyA: 'Azerbaijan', partyB: 'Armenia', status: 'Easing', tensionScore: 55, primaryGrievance: 'Border', lastIncident: '2024-01', trend: 'improving' },
];

// ── getByActionType ───────────────────────────────────────────────────────────
describe('getByActionType', () => {
  it('returns only Expulsion incidents', () => {
    const result = getByActionType(MOCK_INCIDENTS, 'Expulsion');
    assert.equal(result.length, 2);
    assert.ok(result.every((i) => i.actionType === 'Expulsion'));
  });

  it('returns only Consulate Closure incidents', () => {
    const result = getByActionType(MOCK_INCIDENTS, 'Consulate Closure');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'I2');
  });

  it('returns empty array when no match', () => {
    const result = getByActionType([], 'Expulsion');
    assert.deepEqual(result, []);
  });

  it('returns all Recall incidents', () => {
    const result = getByActionType(MOCK_INCIDENTS, 'Recall');
    assert.equal(result.length, 1);
    assert.equal(result[0].actionType, 'Recall');
  });

  it('returns Threat incidents', () => {
    const result = getByActionType(MOCK_INCIDENTS, 'Threat');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'I5');
  });

  it('returns Travel Ban incidents', () => {
    const result = getByActionType(MOCK_INCIDENTS, 'Travel Ban');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'I4');
  });

  it('does not mutate the input array', () => {
    const original = [...MOCK_INCIDENTS];
    getByActionType(MOCK_INCIDENTS, 'Expulsion');
    assert.equal(MOCK_INCIDENTS.length, original.length);
  });
});

// ── getOngoingTensions ────────────────────────────────────────────────────────
describe('getOngoingTensions', () => {
  it('returns Active and Escalating tensions', () => {
    const result = getOngoingTensions(MOCK_TENSIONS);
    assert.equal(result.length, 2);
    assert.ok(result.every((t) => t.status === 'Active' || t.status === 'Escalating'));
  });

  it('excludes Frozen tensions', () => {
    const result = getOngoingTensions(MOCK_TENSIONS);
    assert.ok(result.every((t) => t.status !== 'Frozen'));
  });

  it('excludes Easing tensions', () => {
    const result = getOngoingTensions(MOCK_TENSIONS);
    assert.ok(result.every((t) => t.status !== 'Easing'));
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(getOngoingTensions([]), []);
  });

  it('returns all when all are Active', () => {
    const all: BilateralTension[] = MOCK_TENSIONS.map((t) => ({ ...t, status: 'Active' as TensionStatus }));
    assert.equal(getOngoingTensions(all).length, 4);
  });
});

// ── getMostSevere ─────────────────────────────────────────────────────────────
describe('getMostSevere', () => {
  it('returns the incident with highest severity', () => {
    const result = getMostSevere(MOCK_INCIDENTS);
    assert.equal(result?.id, 'I5');
    assert.equal(result?.severity, 10);
  });

  it('returns null for empty array', () => {
    assert.equal(getMostSevere([]), null);
  });

  it('returns the only incident for single-element array', () => {
    const result = getMostSevere([MOCK_INCIDENTS[0]]);
    assert.equal(result?.id, 'I1');
  });

  it('returns first maximum when tied', () => {
    const tied: CoercionIncident[] = [
      { ...MOCK_INCIDENTS[0], severity: 10 },
      { ...MOCK_INCIDENTS[1], severity: 10 },
    ];
    const result = getMostSevere(tied);
    assert.equal(result?.severity, 10);
  });
});

// ── rankByTension ─────────────────────────────────────────────────────────────
describe('rankByTension', () => {
  it('sorts tensions by tensionScore descending', () => {
    const result = rankByTension(MOCK_TENSIONS);
    assert.equal(result[0].tensionScore, 95);
    assert.equal(result[result.length - 1].tensionScore, 35);
  });

  it('does not mutate the original array', () => {
    const original = MOCK_TENSIONS.map((t) => t.id);
    rankByTension(MOCK_TENSIONS);
    assert.deepEqual(MOCK_TENSIONS.map((t) => t.id), original);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(rankByTension([]), []);
  });

  it('returns a new array (not the same reference)', () => {
    const result = rankByTension(MOCK_TENSIONS);
    assert.ok(result !== MOCK_TENSIONS);
  });

  it('maintains correct relative order', () => {
    const result = rankByTension(MOCK_TENSIONS);
    for (let i = 0; i < result.length - 1; i++) {
      assert.ok(result[i].tensionScore >= result[i + 1].tensionScore);
    }
  });
});

// ── actionClass ───────────────────────────────────────────────────────────────
describe('actionClass', () => {
  it('returns cd-action-expulsion for Expulsion', () => {
    assert.equal(actionClass('Expulsion'), 'cd-action-expulsion');
  });

  it('returns cd-action-closure for Consulate Closure', () => {
    assert.equal(actionClass('Consulate Closure'), 'cd-action-closure');
  });

  it('returns cd-action-downgrade for Downgrade', () => {
    assert.equal(actionClass('Downgrade'), 'cd-action-downgrade');
  });

  it('returns cd-action-travel-ban for Travel Ban', () => {
    assert.equal(actionClass('Travel Ban'), 'cd-action-travel-ban');
  });

  it('returns cd-action-threat for Threat', () => {
    assert.equal(actionClass('Threat'), 'cd-action-threat');
  });

  it('returns cd-action-recall for Recall', () => {
    assert.equal(actionClass('Recall'), 'cd-action-recall');
  });
});

// ── tensionClass ──────────────────────────────────────────────────────────────
describe('tensionClass', () => {
  it('returns cd-tension-escalating for Escalating', () => {
    assert.equal(tensionClass('Escalating'), 'cd-tension-escalating');
  });

  it('returns cd-tension-active for Active', () => {
    assert.equal(tensionClass('Active'), 'cd-tension-active');
  });

  it('returns cd-tension-frozen for Frozen', () => {
    assert.equal(tensionClass('Frozen'), 'cd-tension-frozen');
  });

  it('returns cd-tension-easing for Easing', () => {
    assert.equal(tensionClass('Easing'), 'cd-tension-easing');
  });
});

// ── outcomeClass ──────────────────────────────────────────────────────────────
describe('outcomeClass', () => {
  it('returns cd-outcome-ongoing for Ongoing', () => {
    assert.equal(outcomeClass('Ongoing'), 'cd-outcome-ongoing');
  });

  it('returns cd-outcome-escalated for Escalated', () => {
    assert.equal(outcomeClass('Escalated'), 'cd-outcome-escalated');
  });

  it('returns cd-outcome-resolved for Resolved', () => {
    assert.equal(outcomeClass('Resolved'), 'cd-outcome-resolved');
  });

  it('returns cd-outcome-partial for Partially Resolved', () => {
    assert.equal(outcomeClass('Partially Resolved'), 'cd-outcome-partial');
  });

  it('returns cd-outcome-failed for Failed', () => {
    assert.equal(outcomeClass('Failed'), 'cd-outcome-failed');
  });
});

// ── computeGlobalDiplomaticStabilityIndex ─────────────────────────────────────
describe('computeGlobalDiplomaticStabilityIndex', () => {
  it('returns 100 for empty inputs', () => {
    assert.equal(computeGlobalDiplomaticStabilityIndex([], []), 100);
  });

  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalDiplomaticStabilityIndex(MOCK_INCIDENTS, MOCK_TENSIONS);
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('higher severity incidents lower the index', () => {
    const low = MOCK_INCIDENTS.map((i) => ({ ...i, severity: 1 }));
    const high = MOCK_INCIDENTS.map((i) => ({ ...i, severity: 10 }));
    const idxLow = computeGlobalDiplomaticStabilityIndex(low, []);
    const idxHigh = computeGlobalDiplomaticStabilityIndex(high, []);
    assert.ok(idxLow > idxHigh);
  });

  it('higher tension scores lower the index', () => {
    const lowT = MOCK_TENSIONS.map((t) => ({ ...t, tensionScore: 10 }));
    const highT = MOCK_TENSIONS.map((t) => ({ ...t, tensionScore: 90 }));
    const idxLow = computeGlobalDiplomaticStabilityIndex([], lowT);
    const idxHigh = computeGlobalDiplomaticStabilityIndex([], highT);
    assert.ok(idxLow > idxHigh);
  });

  it('Ongoing outcome weighs more than Resolved', () => {
    const ongoing = [{ ...MOCK_INCIDENTS[0], outcome: 'Ongoing' as CoercionOutcome, severity: 8 }];
    const resolved = [{ ...MOCK_INCIDENTS[0], outcome: 'Resolved' as CoercionOutcome, severity: 8 }];
    const idxOngoing = computeGlobalDiplomaticStabilityIndex(ongoing, []);
    const idxResolved = computeGlobalDiplomaticStabilityIndex(resolved, []);
    assert.ok(idxOngoing < idxResolved);
  });

  it('returns an integer', () => {
    const idx = computeGlobalDiplomaticStabilityIndex(MOCK_INCIDENTS, MOCK_TENSIONS);
    assert.equal(idx, Math.round(idx));
  });

  it('never exceeds 100', () => {
    const minimal = [{ ...MOCK_INCIDENTS[0], severity: 1, outcome: 'Resolved' as CoercionOutcome }];
    assert.ok(computeGlobalDiplomaticStabilityIndex(minimal, []) <= 100);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns a valid render data object', () => {
    const data = buildRenderData();
    assert.ok(data);
  });

  it('has at least 10 incidents', () => {
    const { incidents } = buildRenderData();
    assert.ok(incidents.length >= 10);
  });

  it('has at least 8 bilateral tensions', () => {
    const { tensions } = buildRenderData();
    assert.ok(tensions.length >= 8);
  });

  it('globalDiplomaticStabilityIndex is between 0 and 100', () => {
    const { globalDiplomaticStabilityIndex } = buildRenderData();
    assert.ok(globalDiplomaticStabilityIndex >= 0 && globalDiplomaticStabilityIndex <= 100);
  });

  it('totalExpulsions counts only Expulsion action types', () => {
    const { incidents, totalExpulsions } = buildRenderData();
    const expected = incidents.filter((i) => i.actionType === 'Expulsion').length;
    assert.equal(totalExpulsions, expected);
  });

  it('activeIncidents counts Ongoing and Escalated outcomes', () => {
    const { incidents, activeIncidents } = buildRenderData();
    const expected = incidents.filter((i) => i.outcome === 'Ongoing' || i.outcome === 'Escalated').length;
    assert.equal(activeIncidents, expected);
  });

  it('highSeverityCount counts incidents with severity >= 8', () => {
    const { incidents, highSeverityCount } = buildRenderData();
    const expected = incidents.filter((i) => i.severity >= 8).length;
    assert.equal(highSeverityCount, expected);
  });

  it('mostSevereIncident is not null', () => {
    const { mostSevereIncident } = buildRenderData();
    assert.ok(mostSevereIncident !== null);
  });

  it('mostSevereIncident has the highest severity in incidents', () => {
    const { incidents, mostSevereIncident } = buildRenderData();
    const maxSeverity = Math.max(...incidents.map((i) => i.severity));
    assert.equal(mostSevereIncident?.severity, maxSeverity);
  });

  it('all incident IDs are unique', () => {
    const { incidents } = buildRenderData();
    const ids = incidents.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all tension IDs are unique', () => {
    const { tensions } = buildRenderData();
    const ids = tensions.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all incidents have severity between 1 and 10', () => {
    const { incidents } = buildRenderData();
    assert.ok(incidents.every((i) => i.severity >= 1 && i.severity <= 10));
  });

  it('all tensions have tensionScore between 0 and 100', () => {
    const { tensions } = buildRenderData();
    assert.ok(tensions.every((t) => t.tensionScore >= 0 && t.tensionScore <= 100));
  });

  it('all incidents have non-empty actor and target', () => {
    const { incidents } = buildRenderData();
    assert.ok(incidents.every((i) => i.actor.length > 0 && i.target.length > 0));
  });

  it('all tensions have non-empty partyA and partyB', () => {
    const { tensions } = buildRenderData();
    assert.ok(tensions.every((t) => t.partyA.length > 0 && t.partyB.length > 0));
  });

  it('includes at least one Expulsion incident', () => {
    const { incidents } = buildRenderData();
    assert.ok(incidents.some((i) => i.actionType === 'Expulsion'));
  });

  it('includes at least one Escalating tension', () => {
    const { tensions } = buildRenderData();
    assert.ok(tensions.some((t) => t.status === 'Escalating'));
  });
});

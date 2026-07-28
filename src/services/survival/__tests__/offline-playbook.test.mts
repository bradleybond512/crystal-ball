// src/services/survival/__tests__/offline-playbook.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOfflinePlaybook } from '../offline-playbook.ts';
import { certifyGridDown, GUIDANCE_LEVEL } from '../grid-down-certify.ts';
import { bandForLevel, SURVIVAL_AXES } from '../survival-types.ts';
import type {
  AxisState, PostureThreat, SurvivalAxis, SurvivalPosture, WorldSnapshot,
} from '../survival-types.ts';
import type { WeatherHazardKind } from '../../weather/weather-threat-types.ts';

const CAP = 1_700_000_000_000;

function threat(axis: SurvivalAxis, hazardKind: WeatherHazardKind, hazardLabel: string): PostureThreat {
  return {
    sourceEventId: `e-${hazardKind}`, axis, severity: 75, threatLevel: 'warning', hazardKind, hazardLabel,
    timeToImpactMins: 30, arrivalLabel: '30 min', why: 'polygon over saved place', confidenceLabel: 'high',
  };
}

function axisState(axis: SurvivalAxis, level: number, opts: { threats?: PostureThreat[]; drivers?: string[] } = {}): AxisState {
  return {
    axis, level, band: bandForLevel(level), trend: 'steady', threats: opts.threats ?? [],
    confidence: { total: level, max: 100, items: [{ label: 'x', value: level, max: 100, polarity: 'negative' }] },
    explanation: { headline: `${axis}`, lines: [], missingConfirmation: [] },
    drivers: opts.drivers ?? [],
  };
}

function posture(overrides: Partial<Record<SurvivalAxis, AxisState>> = {}): SurvivalPosture {
  const axes = SURVIVAL_AXES.map((a) => overrides[a] ?? axisState(a, 0));
  const worst = axes.reduce((m, a) => (a.level > m.level ? a : m), axes[0]!);
  return {
    axes, overallLevel: worst.level, overallBand: worst.band, worstAxis: worst.axis,
    headline: 'x', capturedAtMs: CAP, staleInputs: [],
  };
}

function snapshot(p: SurvivalPosture): WorldSnapshot {
  return { version: 1, capturedAtMs: CAP, freshness: [], weatherAlerts: [], savedPlaces: [], posture: p, plan: { committed: [] } };
}

test('an all-secure snapshot needs no offline action', () => {
  const r = resolveOfflinePlaybook(snapshot(posture()));
  assert.equal(r.playbooks.length, 0);
  assert.equal(r.unresolvedAxes.length, 0);
  assert.equal(r.capturedAtMs, CAP);
  assert.match(r.headline, /No axis is elevated/);
});

test('an axis just below the elevated floor is not resolved; at the floor it is', () => {
  const below = resolveOfflinePlaybook(snapshot(posture({ supply: axisState('supply', GUIDANCE_LEVEL - 1) })));
  assert.equal(below.playbooks.length, 0);

  const at = resolveOfflinePlaybook(snapshot(posture({ supply: axisState('supply', GUIDANCE_LEVEL) })));
  assert.deepEqual(at.playbooks.map((p) => p.axis), ['supply']);
  assert.ok(at.playbooks[0]!.actions.length >= 1);
});

test('THE GAP: an elevated axis with NO threat and NO driver still resolves ≥1 action', () => {
  // This is exactly the guidanceGapAxes case grid-down-certify flags but cannot fill.
  const p = posture({ supply: axisState('supply', 70) });
  const cert = certifyGridDown(snapshot(p), { now: CAP });
  assert.deepEqual(cert.guidanceGapAxes, ['supply']); // certify sees the gap...

  const r = resolveOfflinePlaybook(snapshot(p)); // ...the resolver fills it.
  const supply = r.playbooks.find((pb) => pb.axis === 'supply')!;
  assert.ok(supply.actions.length >= 1);
  assert.equal(r.unresolvedAxes.length, 0);
  assert.ok(supply.triggers.length >= 1, 'triggers is never empty');
});

test('every elevated axis resolves at least one action (gap closes by construction)', () => {
  for (const axis of SURVIVAL_AXES) {
    const r = resolveOfflinePlaybook(snapshot(posture({ [axis]: axisState(axis, 85) })));
    const pb = r.playbooks.find((p) => p.axis === axis);
    assert.ok(pb && pb.actions.length >= 1, `${axis} resolved no action`);
    assert.equal(r.unresolvedAxes.length, 0);
  }
});

test('physical_safety draws calibrated weather actions from the threat hazardKind', () => {
  const p = posture({ physical_safety: axisState('physical_safety', 90, { threats: [threat('physical_safety', 'tornado', 'Tornado Warning')] }) });
  const r = resolveOfflinePlaybook(snapshot(p));
  const ps = r.playbooks.find((pb) => pb.axis === 'physical_safety')!;
  assert.ok(ps.actions.every((a) => a.source === 'weather_hazard'));
  assert.ok(ps.actions.some((a) => a.id.startsWith('tornado-')), 'has tornado-specific action');
  assert.deepEqual(ps.triggers, ['Tornado Warning']);
});

test('physical_safety with no weather threat falls back to the static safety play', () => {
  const p = posture({ physical_safety: axisState('physical_safety', 70, { drivers: ['seismic swarm nearby'] }) });
  const r = resolveOfflinePlaybook(snapshot(p));
  const ps = r.playbooks.find((pb) => pb.axis === 'physical_safety')!;
  assert.ok(ps.actions.length >= 1);
  assert.ok(ps.actions.every((a) => a.source === 'axis_playbook'));
  assert.deepEqual(ps.triggers, ['seismic swarm nearby']);
});

test('multiple physical_safety hazards merge and de-duplicate by action id', () => {
  const p = posture({ physical_safety: axisState('physical_safety', 90, {
    threats: [threat('physical_safety', 'high_wind', 'High Wind Warning'), threat('physical_safety', 'severe_thunderstorm', 'Severe Thunderstorm Warning')],
  }) });
  const r = resolveOfflinePlaybook(snapshot(p));
  const ps = r.playbooks.find((pb) => pb.axis === 'physical_safety')!;
  const ids = ps.actions.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate action ids');
  assert.equal(ps.triggers.length, 2);
});

test('higher band unlocks more actions than merely elevated', () => {
  const elevated = resolveOfflinePlaybook(snapshot(posture({ comms: axisState('comms', GUIDANCE_LEVEL) })));
  const critical = resolveOfflinePlaybook(snapshot(posture({ comms: axisState('comms', 90) })));
  const eN = elevated.playbooks[0]!.actions.length;
  const cN = critical.playbooks[0]!.actions.length;
  assert.ok(cN > eN, `critical (${cN}) should unlock more than elevated (${eN})`);
});

test('energy_water strain folds power-outage actions into the weather play', () => {
  const withoutEW = posture({ physical_safety: axisState('physical_safety', 90, { threats: [threat('physical_safety', 'tornado', 'Tornado Warning')] }) });
  const withEW = posture({
    physical_safety: axisState('physical_safety', 90, { threats: [threat('physical_safety', 'tornado', 'Tornado Warning')] }),
    energy_water: axisState('energy_water', 70),
  });
  const a = resolveOfflinePlaybook(snapshot(withoutEW)).playbooks.find((p) => p.axis === 'physical_safety')!;
  const b = resolveOfflinePlaybook(snapshot(withEW)).playbooks.find((p) => p.axis === 'physical_safety')!;
  const outageA = a.actions.some((x) => x.id.startsWith('outage-'));
  const outageB = b.actions.some((x) => x.id.startsWith('outage-'));
  assert.equal(outageA, false, 'no outage actions without energy_water strain');
  assert.equal(outageB, true, 'outage actions appear once energy_water is elevated');
});

test('actions are ordered worst-first (priority asc, then estimatedMinutes asc)', () => {
  const r = resolveOfflinePlaybook(snapshot(posture({ health: axisState('health', 90) })));
  const actions = r.playbooks[0]!.actions;
  for (let i = 1; i < actions.length; i += 1) {
    const prev = actions[i - 1]!;
    const cur = actions[i]!;
    const ordered = prev.priority < cur.priority || (prev.priority === cur.priority && prev.estimatedMinutes <= cur.estimatedMinutes);
    assert.ok(ordered, `action ${i} out of order`);
  }
});

test('playbooks are sorted worst-axis first by level', () => {
  const r = resolveOfflinePlaybook(snapshot(posture({
    supply: axisState('supply', 55),
    comms: axisState('comms', 90),
    health: axisState('health', 70),
  })));
  assert.deepEqual(r.playbooks.map((p) => p.axis), ['comms', 'health', 'supply']);
  assert.match(r.headline, /^3 axes need offline action — Comms \(critical\) leads/);
});

test('maxPerAxis caps actions while keeping the worst-first ones', () => {
  const full = resolveOfflinePlaybook(snapshot(posture({ energy_water: axisState('energy_water', 90) })));
  const capped = resolveOfflinePlaybook(snapshot(posture({ energy_water: axisState('energy_water', 90) })), { maxPerAxis: 2 });
  const fullActions = full.playbooks[0]!.actions;
  const cappedActions = capped.playbooks[0]!.actions;
  assert.equal(cappedActions.length, 2);
  assert.deepEqual(cappedActions.map((a) => a.id), fullActions.slice(0, 2).map((a) => a.id));
});

test('an absent axis is skipped, not treated as elevated', () => {
  const p = posture({ supply: axisState('supply', 70) });
  const trimmed: SurvivalPosture = { ...p, axes: p.axes.filter((a) => a.axis !== 'comms') };
  const r = resolveOfflinePlaybook(snapshot(trimmed));
  assert.ok(!r.playbooks.some((pb) => pb.axis === 'comms'));
  assert.ok(r.playbooks.some((pb) => pb.axis === 'supply'));
});

test('a non-finite axis level is treated as 0, not elevated', () => {
  const p = posture({ supply: axisState('supply', Number.NaN) });
  const r = resolveOfflinePlaybook(snapshot(p));
  assert.ok(!r.playbooks.some((pb) => pb.axis === 'supply'));
});

// ── Codex review regressions (PR #1540) ──────────────────────────────────────

test('a zero / negative / fractional maxPerAxis never starves an elevated axis', () => {
  for (const cap of [0, -3, 0.5]) {
    const r = resolveOfflinePlaybook(snapshot(posture({ supply: axisState('supply', 85) })), { maxPerAxis: cap });
    const supply = r.playbooks.find((pb) => pb.axis === 'supply');
    assert.ok(supply && supply.actions.length >= 1, `cap ${cap} starved supply`);
    assert.equal(supply!.actions.length, 1, `cap ${cap} should floor to 1 action`);
    assert.equal(r.unresolvedAxes.length, 0);
    assert.match(r.headline, /1 steps staged/);
  }
});

test('capped physical_safety fallback keeps the priority-1 action, not a lower one', () => {
  // Level 90 unlocks the priority-1 HIGH_BAND ps-ready-evac; a cap of 2 must not
  // drop it in favor of the priority-2 ps-shoes-light.
  const p = posture({ physical_safety: axisState('physical_safety', 90, { drivers: ['seismic swarm'] }) });
  const r = resolveOfflinePlaybook(snapshot(p), { maxPerAxis: 2 });
  const ps = r.playbooks.find((pb) => pb.axis === 'physical_safety')!;
  assert.equal(ps.actions.length, 2);
  assert.ok(ps.actions.every((a) => a.priority === 1), 'both survivors are priority-1');
  assert.ok(ps.actions.some((a) => a.id === 'ps-ready-evac'), 'ps-ready-evac survives the cap');
});

test('weather-hazard dedup is independent of threat order', () => {
  const forward = posture({ physical_safety: axisState('physical_safety', 90, {
    threats: [threat('physical_safety', 'flash_flood', 'Flash Flood Warning'), threat('physical_safety', 'flood', 'Flood Warning')],
  }) });
  const reversed = posture({ physical_safety: axisState('physical_safety', 90, {
    threats: [threat('physical_safety', 'flood', 'Flood Warning'), threat('physical_safety', 'flash_flood', 'Flash Flood Warning')],
  }) });
  const a = resolveOfflinePlaybook(snapshot(forward)).playbooks.find((p) => p.axis === 'physical_safety')!;
  const b = resolveOfflinePlaybook(snapshot(reversed)).playbooks.find((p) => p.axis === 'physical_safety')!;
  // Same actions, same order, same per-action priority regardless of threat order.
  assert.deepEqual(a.actions.map((x) => [x.id, x.priority]), b.actions.map((x) => [x.id, x.priority]));
});

test('a weather threat with an empty hazardLabel still yields non-empty triggers', () => {
  const t = threat('physical_safety', 'tornado', '');
  const p = posture({ physical_safety: axisState('physical_safety', 90, { threats: [t], drivers: ['radar-indicated rotation'] }) });
  const r = resolveOfflinePlaybook(snapshot(p));
  const ps = r.playbooks.find((pb) => pb.axis === 'physical_safety')!;
  assert.ok(ps.actions.length >= 1);
  assert.ok(ps.triggers.length >= 1, 'triggers falls back, never empty');
  assert.deepEqual(ps.triggers, ['radar-indicated rotation']);
});

test('a non-finite energy_water level does not spuriously fold in outage actions', () => {
  const p = posture({
    physical_safety: axisState('physical_safety', 90, { threats: [threat('physical_safety', 'tornado', 'Tornado Warning')] }),
    energy_water: axisState('energy_water', Number.POSITIVE_INFINITY),
  });
  const r = resolveOfflinePlaybook(snapshot(p));
  const ps = r.playbooks.find((pb) => pb.axis === 'physical_safety')!;
  assert.ok(!ps.actions.some((a) => a.id.startsWith('outage-')), 'Infinity is not elevated');
  // And the energy_water axis itself is not resolved from a non-finite level.
  assert.ok(!r.playbooks.some((pb) => pb.axis === 'energy_water'));
});

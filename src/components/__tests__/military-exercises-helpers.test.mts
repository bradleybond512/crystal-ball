import assert from 'node:assert/strict';
import test   from 'node:test';
import {
  threatLevelColor,
  threatLevelLabel,
  signalTypeLabel,
  signalTypeColor,
  exerciseTypeColor,
  formatTroops,
  getByRegion,
  getLargeExercises,
  getRecentExercises,
  getBySignalType,
  getByThreatLevel,
  getCriticalAndHigh,
  getCoerciveExercises,
  computeRegionalIntensity,
  totalTroopsInExercises,
  renderExercisesTable,
  renderRegionalIntensitySection,
  buildRenderData,
  EXERCISES,
  type MilitaryExercise,
  type ExerciseType,
  type ThreatLevel,
  type SignalType,
  type ExerciseRegion,
} from '../military-exercises-helpers.ts';

// ── threatLevelColor ────────────────────────────────────────────────────────
test('threatLevelColor critical returns red', () => {
  assert.match(threatLevelColor('critical'), /ef4444/);
});
test('threatLevelColor high returns orange', () => {
  assert.match(threatLevelColor('high'), /f97316/);
});
test('threatLevelColor elevated returns yellow', () => {
  assert.match(threatLevelColor('elevated'), /facc15/);
});
test('threatLevelColor routine returns green', () => {
  assert.match(threatLevelColor('routine'), /22c55e/);
});
test('threatLevelColor all four levels return a string', () => {
  const levels: ThreatLevel[] = ['routine', 'elevated', 'high', 'critical'];
  for (const l of levels) {
    const c = threatLevelColor(l);
    assert.ok(c.length > 0, `empty color for ${l}`);
  }
});

// ── threatLevelLabel ────────────────────────────────────────────────────────
test('threatLevelLabel critical', () => { assert.equal(threatLevelLabel('critical'), 'Critical'); });
test('threatLevelLabel high',     () => { assert.equal(threatLevelLabel('high'),     'High');     });
test('threatLevelLabel elevated', () => { assert.equal(threatLevelLabel('elevated'), 'Elevated'); });
test('threatLevelLabel routine',  () => { assert.equal(threatLevelLabel('routine'),  'Routine');  });

// ── signalTypeLabel ─────────────────────────────────────────────────────────
test('signalTypeLabel deterrence',          () => { assert.equal(signalTypeLabel('deterrence'),          'Deterrence');          });
test('signalTypeLabel coercion',            () => { assert.equal(signalTypeLabel('coercion'),            'Coercion');            });
test('signalTypeLabel alliance_solidarity', () => { assert.equal(signalTypeLabel('alliance_solidarity'), 'Alliance solidarity'); });
test('signalTypeLabel power_projection',    () => { assert.equal(signalTypeLabel('power_projection'),    'Power projection');    });
test('signalTypeLabel readiness',           () => { assert.equal(signalTypeLabel('readiness'),           'Readiness');           });
test('signalTypeLabel intimidation',        () => { assert.equal(signalTypeLabel('intimidation'),        'Intimidation');        });

// ── signalTypeColor ─────────────────────────────────────────────────────────
test('signalTypeColor coercion is red', () => {
  assert.match(signalTypeColor('coercion'), /ef4444/);
});
test('signalTypeColor intimidation is red', () => {
  assert.match(signalTypeColor('intimidation'), /ef4444/);
});
test('signalTypeColor alliance_solidarity is green', () => {
  assert.match(signalTypeColor('alliance_solidarity'), /22c55e/);
});
test('signalTypeColor deterrence is yellow', () => {
  assert.match(signalTypeColor('deterrence'), /facc15/);
});

// ── exerciseTypeColor ───────────────────────────────────────────────────────
test('exerciseTypeColor returns a color for each type', () => {
  const types: ExerciseType[] = ['Joint', 'Naval', 'Air', 'Ground', 'Cyber'];
  for (const t of types) {
    const c = exerciseTypeColor(t);
    assert.ok(c.startsWith('#') || c.startsWith('var('), `no color for ${t}: ${c}`);
  }
});
test('exerciseTypeColor Joint and Naval differ', () => {
  assert.notEqual(exerciseTypeColor('Joint'), exerciseTypeColor('Naval'));
});
test('exerciseTypeColor Air and Ground differ', () => {
  assert.notEqual(exerciseTypeColor('Air'), exerciseTypeColor('Ground'));
});

// ── formatTroops ────────────────────────────────────────────────────────────
test('formatTroops 25000 -> 25k', () => { assert.equal(formatTroops(25000), '25k'); });
test('formatTroops 90000 -> 90k', () => { assert.equal(formatTroops(90000), '90k'); });
test('formatTroops 600 stays as-is', () => { assert.equal(formatTroops(600),   '600'); });
test('formatTroops 11000 -> 11k',   () => { assert.equal(formatTroops(11000), '11k'); });
test('formatTroops 1000 -> 1k',     () => { assert.equal(formatTroops(1000),  '1k');  });

// ── getByRegion ─────────────────────────────────────────────────────────────
test('getByRegion Pacific returns only Pacific entries', () => {
  const result = getByRegion(EXERCISES, 'Pacific');
  assert.ok(result.length > 0);
  assert.ok(result.every((e) => e.region === 'Pacific'));
});
test('getByRegion Europe returns only Europe entries', () => {
  const result = getByRegion(EXERCISES, 'Europe');
  assert.ok(result.every((e) => e.region === 'Europe'));
});
test('getByRegion Arctic returns empty from EXERCISES', () => {
  assert.equal(getByRegion(EXERCISES, 'Arctic').length, 0);
});
test('getByRegion handles empty input', () => {
  assert.deepEqual(getByRegion([], 'Pacific'), []);
});

// ── getLargeExercises ───────────────────────────────────────────────────────
test('getLargeExercises default >= 10000 troops', () => {
  const result = getLargeExercises(EXERCISES);
  assert.ok(result.every((e) => e.troops >= 10000));
});
test('getLargeExercises custom threshold 50000', () => {
  const result = getLargeExercises(EXERCISES, 50000);
  assert.ok(result.every((e) => e.troops >= 50000));
});
test('getLargeExercises very high threshold returns empty', () => {
  assert.deepEqual(getLargeExercises(EXERCISES, 1_000_000), []);
});
test('getLargeExercises includes Steadfast Defender (90k)', () => {
  const result = getLargeExercises(EXERCISES);
  assert.ok(result.some((e) => e.id === 'steadfast-defender-2024'));
});
test('getLargeExercises excludes Yudh Abhyas (600 troops)', () => {
  const result = getLargeExercises(EXERCISES);
  assert.ok(!result.some((e) => e.id === 'yudh-abhyas-2023'));
});

// ── getRecentExercises ──────────────────────────────────────────────────────
test('getRecentExercises afterYear 2024 excludes 2023 exercises', () => {
  const result = getRecentExercises(EXERCISES, 2024);
  assert.ok(!result.some((e) => e.id === 'zapad-2023'));
});
test('getRecentExercises afterYear 2023 includes Zapad-2023', () => {
  const result = getRecentExercises(EXERCISES, 2023);
  assert.ok(result.some((e) => e.id === 'zapad-2023'));
});
test('getRecentExercises future year returns empty', () => {
  assert.equal(getRecentExercises(EXERCISES, 2099).length, 0);
});

// ── getBySignalType ─────────────────────────────────────────────────────────
test('getBySignalType deterrence returns only deterrence', () => {
  const result = getBySignalType(EXERCISES, 'deterrence');
  assert.ok(result.every((e) => e.signalType === 'deterrence'));
});
test('getBySignalType coercion includes joint-sword-2024a', () => {
  const result = getBySignalType(EXERCISES, 'coercion');
  assert.ok(result.some((e) => e.id === 'joint-sword-2024a'));
});

// ── getByThreatLevel ────────────────────────────────────────────────────────
test('getByThreatLevel critical returns only critical', () => {
  const result = getByThreatLevel(EXERCISES, 'critical');
  assert.ok(result.every((e) => e.threatLevel === 'critical'));
});
test('getByThreatLevel routine includes yudh-abhyas-2023', () => {
  assert.ok(getByThreatLevel(EXERCISES, 'routine').some((e) => e.id === 'yudh-abhyas-2023'));
});

// ── getCriticalAndHigh ──────────────────────────────────────────────────────
test('getCriticalAndHigh returns only critical or high', () => {
  const result = getCriticalAndHigh(EXERCISES);
  assert.ok(result.every((e) => e.threatLevel === 'critical' || e.threatLevel === 'high'));
});
test('getCriticalAndHigh includes both PLA Joint Sword exercises', () => {
  const result = getCriticalAndHigh(EXERCISES);
  assert.ok(result.some((e) => e.id === 'joint-sword-2024a'));
  assert.ok(result.some((e) => e.id === 'joint-sword-2024b'));
});
test('getCriticalAndHigh handles empty array', () => {
  assert.deepEqual(getCriticalAndHigh([]), []);
});

// ── getCoerciveExercises ────────────────────────────────────────────────────
test('getCoerciveExercises returns coercion and intimidation only', () => {
  const result = getCoerciveExercises(EXERCISES);
  assert.ok(result.every((e) => e.signalType === 'coercion' || e.signalType === 'intimidation'));
});
test('getCoerciveExercises includes joint-sword-2024b (intimidation)', () => {
  assert.ok(getCoerciveExercises(EXERCISES).some((e) => e.id === 'joint-sword-2024b'));
});
test('getCoerciveExercises excludes deterrence exercises', () => {
  const result = getCoerciveExercises(EXERCISES);
  assert.ok(!result.some((e) => e.signalType === 'deterrence'));
});

// ── computeRegionalIntensity ────────────────────────────────────────────────
test('computeRegionalIntensity returns 5 region entries', () => {
  assert.equal(computeRegionalIntensity(EXERCISES).length, 5);
});
test('computeRegionalIntensity Pacific has positive intensity', () => {
  const pacific = computeRegionalIntensity(EXERCISES).find((r) => r.region === 'Pacific');
  assert.ok(pacific !== undefined && pacific.intensityScore > 0);
});
test('computeRegionalIntensity Arctic has zero exercises and zero score', () => {
  const arctic = computeRegionalIntensity(EXERCISES).find((r) => r.region === 'Arctic');
  assert.ok(arctic !== undefined);
  assert.equal(arctic.exerciseCount, 0);
  assert.equal(arctic.intensityScore, 0);
});
test('computeRegionalIntensity every score is in [0, 100]', () => {
  for (const r of computeRegionalIntensity(EXERCISES)) {
    assert.ok(r.intensityScore >= 0 && r.intensityScore <= 100,
      `${r.region}: score ${r.intensityScore} out of range`);
  }
});
test('computeRegionalIntensity empty exercises yields all zero scores', () => {
  for (const r of computeRegionalIntensity([])) {
    assert.equal(r.exerciseCount, 0);
    assert.equal(r.totalTroops, 0);
    assert.equal(r.intensityScore, 0);
  }
});
test('computeRegionalIntensity Europe has at least 3 exercises', () => {
  const europe = computeRegionalIntensity(EXERCISES).find((r) => r.region === 'Europe');
  assert.ok(europe !== undefined && europe.exerciseCount >= 3);
});
test('computeRegionalIntensity level is a valid ThreatLevel', () => {
  const valid: ThreatLevel[] = ['routine', 'elevated', 'high', 'critical'];
  for (const r of computeRegionalIntensity(EXERCISES)) {
    assert.ok(valid.includes(r.level), `${r.region}: invalid level ${r.level}`);
  }
});

// ── totalTroopsInExercises ──────────────────────────────────────────────────
test('totalTroopsInExercises is positive for EXERCISES', () => {
  assert.ok(totalTroopsInExercises(EXERCISES) > 0);
});
test('totalTroopsInExercises returns 0 for empty', () => {
  assert.equal(totalTroopsInExercises([]), 0);
});
test('totalTroopsInExercises single exercise', () => {
  const one: MilitaryExercise = {
    id: 't', name: 'T', leadNation: 'X', participants: [], location: 'X',
    region: 'Pacific', troops: 12345, type: 'Joint', date: '2024',
    signal: '', signalType: 'deterrence', threatLevel: 'routine',
  };
  assert.equal(totalTroopsInExercises([one]), 12345);
});

// ── renderExercisesTable ────────────────────────────────────────────────────
test('renderExercisesTable has data-section attribute', () => {
  assert.match(renderExercisesTable(EXERCISES.slice(0, 2)), /data-section="exercises-table"/);
});
test('renderExercisesTable empty shows no-exercises message', () => {
  assert.match(renderExercisesTable([]), /No exercises tracked/);
});
test('renderExercisesTable escapes XSS in name', () => {
  const evil: MilitaryExercise = {
    id: 'x', name: '<script>alert(1)</script>', leadNation: 'X', participants: [],
    location: 'X', region: 'Europe', troops: 1000, type: 'Air', date: '2024',
    signal: '', signalType: 'deterrence', threatLevel: 'routine',
  };
  const html = renderExercisesTable([evil]);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});
test('renderExercisesTable includes data-exercise-id attribute', () => {
  assert.match(renderExercisesTable(EXERCISES.slice(0, 1)), /data-exercise-id="/);
});

// ── renderRegionalIntensitySection ─────────────────────────────────────────
test('renderRegionalIntensitySection has data-section attribute', () => {
  const intensities = computeRegionalIntensity(EXERCISES);
  assert.match(renderRegionalIntensitySection(intensities), /data-section="regional-intensity"/);
});
test('renderRegionalIntensitySection empty array shows no-data message', () => {
  assert.match(renderRegionalIntensitySection([]), /No regional intensity data/);
});
test('renderRegionalIntensitySection excludes Arctic (zero exercises)', () => {
  const intensities = computeRegionalIntensity(EXERCISES);
  const html = renderRegionalIntensitySection(intensities);
  assert.ok(!html.includes('>Arctic<'));
});

// ── buildRenderData ─────────────────────────────────────────────────────────
test('buildRenderData has all expected keys', () => {
  const rd = buildRenderData(EXERCISES);
  assert.ok(Array.isArray(rd.intensities));
  assert.ok(Array.isArray(rd.large));
  assert.ok(Array.isArray(rd.coercive));
  assert.equal(typeof rd.criticalHighCount, 'number');
  assert.equal(typeof rd.totalTroops, 'number');
  assert.ok(Array.isArray(rd.pacificExercises));
  assert.ok(Array.isArray(rd.europeExercises));
  assert.ok(Array.isArray(rd.otherExercises));
});
test('buildRenderData pacific + europe + other = all exercises', () => {
  const rd = buildRenderData(EXERCISES);
  assert.equal(
    rd.pacificExercises.length + rd.europeExercises.length + rd.otherExercises.length,
    EXERCISES.length,
  );
});
test('buildRenderData coercive is subset of EXERCISES', () => {
  const ids = new Set(EXERCISES.map((e) => e.id));
  for (const e of buildRenderData(EXERCISES).coercive) {
    assert.ok(ids.has(e.id), `${e.id} not in EXERCISES`);
  }
});

// ── Static data integrity ───────────────────────────────────────────────────
test('EXERCISES has at least 12 entries', () => {
  assert.ok(EXERCISES.length >= 12);
});
test('EXERCISES every id is unique', () => {
  const ids = EXERCISES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});
test('EXERCISES every entry has troops > 0', () => {
  for (const e of EXERCISES) assert.ok(e.troops > 0, `${e.name}: troops must be > 0`);
});
test('EXERCISES every threatLevel is valid', () => {
  const valid: ThreatLevel[] = ['routine', 'elevated', 'high', 'critical'];
  for (const e of EXERCISES) {
    assert.ok(valid.includes(e.threatLevel), `${e.name}: bad threatLevel ${e.threatLevel}`);
  }
});
test('EXERCISES every signalType is valid', () => {
  const valid: SignalType[] = ['deterrence','coercion','alliance_solidarity','power_projection','readiness','intimidation'];
  for (const e of EXERCISES) {
    assert.ok(valid.includes(e.signalType), `${e.name}: bad signalType ${e.signalType}`);
  }
});
test('EXERCISES every region is valid', () => {
  const valid: ExerciseRegion[] = ['Pacific','Europe','Middle East','South Asia','Arctic'];
  for (const e of EXERCISES) {
    assert.ok(valid.includes(e.region), `${e.name}: bad region ${e.region}`);
  }
});
test('EXERCISES every type is valid', () => {
  const valid: ExerciseType[] = ['Joint','Naval','Air','Ground','Cyber'];
  for (const e of EXERCISES) {
    assert.ok(valid.includes(e.type), `${e.name}: bad type ${e.type}`);
  }
});
test('EXERCISES contains rimpac-2024', () => {
  assert.ok(EXERCISES.some((e) => e.id === 'rimpac-2024'));
});
test('EXERCISES contains steadfast-defender-2024', () => {
  assert.ok(EXERCISES.some((e) => e.id === 'steadfast-defender-2024'));
});
test('EXERCISES contains joint-sword-2024a', () => {
  assert.ok(EXERCISES.some((e) => e.id === 'joint-sword-2024a'));
});
test('EXERCISES contains joint-sword-2024b', () => {
  assert.ok(EXERCISES.some((e) => e.id === 'joint-sword-2024b'));
});
test('EXERCISES Steadfast Defender has 90000 troops', () => {
  const sd = EXERCISES.find((e) => e.id === 'steadfast-defender-2024');
  assert.ok(sd !== undefined && sd.troops === 90000);
});
test('EXERCISES both Joint Sword exercises have critical threat level', () => {
  const a = EXERCISES.find((e) => e.id === 'joint-sword-2024a');
  const b = EXERCISES.find((e) => e.id === 'joint-sword-2024b');
  assert.equal(a?.threatLevel, 'critical');
  assert.equal(b?.threatLevel, 'critical');
});

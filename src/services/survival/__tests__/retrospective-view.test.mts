import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRetrospectiveBoardView } from '../retrospective-view.ts';
import type {
  RetrospectiveDigest,
  RetroLesson,
  RetroBiasKind,
  RetroSeverity,
} from '../retrospective-digest.ts';

function lesson(over: Partial<RetroLesson> = {}): RetroLesson {
  const biasKind: RetroBiasKind = over.biasKind ?? 'overconfident';
  const missMagnitude = over.missMagnitude ?? 24;
  const severity: RetroSeverity =
    over.severity ?? (missMagnitude >= 20 ? 'critical' : missMagnitude >= 10 ? 'notable' : 'minor');
  return {
    source: over.source ?? 'move_effect',
    subject: over.subject ?? 'shelter · Physical safety',
    axis: over.axis ?? 'physical_safety',
    biasKind,
    severity,
    missMagnitude,
    sampleCount: over.sampleCount ?? 4,
    confidence: over.confidence ?? 0.8,
    priority: over.priority ?? missMagnitude,
    lesson: over.lesson ?? 'Reality ran worse than the board showed.',
  };
}

function digest(over: Partial<RetrospectiveDigest> = {}): RetrospectiveDigest {
  const lessons = over.lessons ?? [];
  const overconfident = lessons.filter((l) => l.biasKind === 'overconfident').length;
  const underconfident = lessons.filter((l) => l.biasKind === 'underconfident').length;
  return {
    lessons,
    headline: over.headline ?? 'test headline',
    summary: over.summary ?? {
      totalCalibrations: lessons.length,
      actionableLessons: lessons.length,
      overconfident,
      underconfident,
      wellCalibrated: 0,
      insufficientData: 0,
      meanLessonConfidence: 0.8,
    },
  };
}

test('empty digest → neutral, empty, headline passed through', () => {
  const view = buildRetrospectiveBoardView(digest({ headline: 'nothing to learn' }));
  assert.equal(view.isEmpty, true);
  assert.equal(view.tone, 'neutral');
  assert.equal(view.rows.length, 0);
  assert.equal(view.overflow, 0);
  assert.equal(view.overflowLabel, '');
  assert.equal(view.headline, 'nothing to learn');
});

test('title is the constant board title', () => {
  const view = buildRetrospectiveBoardView(digest());
  assert.equal(view.title, 'What I got wrong last time');
});

test('single overconfident lesson → danger card + danger row', () => {
  const view = buildRetrospectiveBoardView(digest({ lessons: [lesson()] }));
  assert.equal(view.isEmpty, false);
  assert.equal(view.tone, 'danger');
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]!.tone, 'danger');
  assert.equal(view.rows[0]!.chip, 'Overconfident');
});

test('overconfident row is always danger tone even when severity is minor', () => {
  const view = buildRetrospectiveBoardView(
    digest({ lessons: [lesson({ missMagnitude: 3, severity: 'minor' })] }),
  );
  assert.equal(view.rows[0]!.tone, 'danger');
});

test('underconfident + notable/critical severity → caution row', () => {
  const view = buildRetrospectiveBoardView(
    digest({ lessons: [lesson({ biasKind: 'underconfident', missMagnitude: 15, severity: 'notable' })] }),
  );
  assert.equal(view.rows[0]!.tone, 'caution');
  assert.equal(view.rows[0]!.chip, 'Underconfident');
});

test('underconfident + minor severity → muted row', () => {
  const view = buildRetrospectiveBoardView(
    digest({ lessons: [lesson({ biasKind: 'underconfident', missMagnitude: 4, severity: 'minor' })] }),
  );
  assert.equal(view.rows[0]!.tone, 'muted');
});

test('underconfident-only digest → muted card (benign, not danger)', () => {
  const view = buildRetrospectiveBoardView(
    digest({ lessons: [lesson({ biasKind: 'underconfident', missMagnitude: 15, severity: 'notable' })] }),
  );
  assert.equal(view.tone, 'muted');
});

test('card tone is danger if ANY overconfident lesson exists, not just the first row', () => {
  const lessons = [
    lesson({ biasKind: 'underconfident', subject: 'a', missMagnitude: 30, severity: 'critical' }),
    lesson({ biasKind: 'overconfident', subject: 'b', missMagnitude: 5, severity: 'minor' }),
  ];
  const view = buildRetrospectiveBoardView(digest({ lessons }));
  assert.equal(view.tone, 'danger');
});

test('rows preserve the digest ranking order', () => {
  const lessons = [
    lesson({ subject: 'first' }),
    lesson({ subject: 'second' }),
    lesson({ subject: 'third' }),
  ];
  const view = buildRetrospectiveBoardView(digest({ lessons }));
  assert.deepEqual(view.rows.map((r) => r.subject), ['first', 'second', 'third']);
});

test('maxRows caps rows and reports overflow', () => {
  const lessons = Array.from({ length: 8 }, (_, i) => lesson({ subject: `s${i}` }));
  const view = buildRetrospectiveBoardView(digest({ lessons }), { maxRows: 3 });
  assert.equal(view.rows.length, 3);
  assert.equal(view.overflow, 5);
  assert.equal(view.overflowLabel, '+5 more');
});

test('default cap is 5 rows', () => {
  const lessons = Array.from({ length: 7 }, (_, i) => lesson({ subject: `s${i}` }));
  const view = buildRetrospectiveBoardView(digest({ lessons }));
  assert.equal(view.rows.length, 5);
  assert.equal(view.overflow, 2);
});

test('no overflow → empty overflow label', () => {
  const lessons = [lesson({ subject: 'a' }), lesson({ subject: 'b' })];
  const view = buildRetrospectiveBoardView(digest({ lessons }), { maxRows: 5 });
  assert.equal(view.overflow, 0);
  assert.equal(view.overflowLabel, '');
});

test('non-positive maxRows collapses to zero rows, everything overflows', () => {
  const lessons = [lesson({ subject: 'a' }), lesson({ subject: 'b' })];
  const view = buildRetrospectiveBoardView(digest({ lessons }), { maxRows: 0 });
  assert.equal(view.rows.length, 0);
  assert.equal(view.overflow, 2);
  assert.equal(view.overflowLabel, '+2 more');
});

test('non-finite maxRows falls back to the default cap', () => {
  const lessons = Array.from({ length: 7 }, (_, i) => lesson({ subject: `s${i}` }));
  const view = buildRetrospectiveBoardView(digest({ lessons }), { maxRows: Number.NaN });
  assert.equal(view.rows.length, 5);
});

test('metric rounds the miss magnitude to whole points', () => {
  const view = buildRetrospectiveBoardView(digest({ lessons: [lesson({ missMagnitude: 23.6 })] }));
  assert.equal(view.rows[0]!.metric, '24 pts');
});

test('metric clamps a negative/non-finite miss to 0 pts', () => {
  const view = buildRetrospectiveBoardView(
    digest({ lessons: [lesson({ missMagnitude: Number.NaN })] }),
  );
  assert.equal(view.rows[0]!.metric, '0 pts');
});

test('summary line reflects the digest counts', () => {
  const view = buildRetrospectiveBoardView(
    digest({
      summary: {
        totalCalibrations: 6,
        actionableLessons: 3,
        overconfident: 2,
        underconfident: 1,
        wellCalibrated: 3,
        insufficientData: 0,
        meanLessonConfidence: 0.7,
      },
    }),
  );
  assert.equal(view.summaryLine, '2 overconfident · 1 underconfident · 3 well-calibrated');
});

test('summary line appends unproven count when present', () => {
  const view = buildRetrospectiveBoardView(
    digest({
      summary: {
        totalCalibrations: 5,
        actionableLessons: 1,
        overconfident: 1,
        underconfident: 0,
        wellCalibrated: 2,
        insufficientData: 2,
        meanLessonConfidence: 0.6,
      },
    }),
  );
  assert.equal(view.summaryLine, '1 overconfident · 0 underconfident · 2 well-calibrated · 2 unproven');
});

test('row carries subject and lesson verbatim from the digest', () => {
  const view = buildRetrospectiveBoardView(
    digest({ lessons: [lesson({ subject: 'flee-now · Mobility', lesson: 'The road closed sooner than modeled.' })] }),
  );
  assert.equal(view.rows[0]!.subject, 'flee-now · Mobility');
  assert.equal(view.rows[0]!.lesson, 'The road closed sooner than modeled.');
});

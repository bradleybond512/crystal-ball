import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCommsFallbackBoardView } from '../comms-fallback-view.ts';
import type { CommsFallbackPlan, CommsRung } from '../comms-fallback.ts';
import type { SurvivalBand } from '../survival-types.ts';

function rung(over: Partial<CommsRung> = {}): CommsRung {
  const base: CommsRung = {
    id: over.id ?? 'cellular_voice_sms',
    method: over.method ?? 'Cellular voice + SMS',
    instruction: over.instruction ?? 'Prefer SMS — it stores-and-forwards through congestion.',
    dependsOn: over.dependsOn ?? ['cell_tower'],
    offlineCapable: over.offlineCapable ?? false,
    receiveOnly: over.receiveOnly ?? false,
    viable: over.viable ?? true,
  };
  if ('reference' in over) base.reference = over.reference;
  return base;
}

function plan(over: Partial<CommsFallbackPlan> = {}): CommsFallbackPlan {
  const ladder = over.ladder ?? [rung()];
  return {
    capturedAtMs: over.capturedAtMs ?? 0,
    commsLevel: over.commsLevel ?? 20,
    commsBand: over.commsBand ?? 'guarded',
    powerCompromised: over.powerCompromised ?? false,
    ladder,
    recommendedRungId: over.recommendedRungId ?? ladder[0]!.id,
    receiveRungId: 'receiveRungId' in over ? over.receiveRungId ?? null : null,
    checkIn: over.checkIn ?? {
      outOfAreaContact: 'Designate one out-of-area contact everyone reaches separately.',
      meetingPoint: 'Agree a physical meeting point and a fallback time.',
      cadenceLabel: 'Check in as needed',
    },
    headline: over.headline ?? 'Comms nominal — primary path: Cellular voice + SMS.',
  };
}

test('title is the constant board title', () => {
  const view = buildCommsFallbackBoardView(plan());
  assert.equal(view.title, 'How to reach people');
});

test('headline is passed through from the plan', () => {
  const view = buildCommsFallbackBoardView(plan({ headline: 'Comms critical — fall back to In person.' }));
  assert.equal(view.headline, 'Comms critical — fall back to In person.');
});

test('band → tone: critical danger, high caution, elevated muted, secure/guarded neutral', () => {
  const cases: Array<[SurvivalBand, string]> = [
    ['critical', 'danger'],
    ['high', 'caution'],
    ['elevated', 'muted'],
    ['guarded', 'neutral'],
    ['secure', 'neutral'],
  ];
  for (const [band, tone] of cases) {
    const view = buildCommsFallbackBoardView(plan({ commsBand: band }));
    assert.equal(view.tone, tone, `band ${band}`);
    assert.equal(view.commsBand, band);
  }
});

test('the recommended transmit rung reads as "Use this"', () => {
  const ladder = [
    rung({ id: 'cellular_voice_sms', viable: true }),
    rung({ id: 'two_way_radio', method: 'Two-way radio', dependsOn: ['battery'], offlineCapable: true, viable: true }),
  ];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'cellular_voice_sms' }));
  assert.equal(view.rungs[0]!.state, 'recommended');
  assert.equal(view.rungs[0]!.stateLabel, 'Use this');
});

test('a viable non-recommended rung reads as "Backup"', () => {
  const ladder = [
    rung({ id: 'cellular_voice_sms', viable: true }),
    rung({ id: 'two_way_radio', method: 'Two-way radio', dependsOn: ['battery'], offlineCapable: true, viable: true }),
  ];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'cellular_voice_sms' }));
  assert.equal(view.rungs[1]!.state, 'viable');
  assert.equal(view.rungs[1]!.stateLabel, 'Backup');
});

test('a non-viable rung reads as "Down"', () => {
  const ladder = [
    rung({ id: 'broadband_internet', method: 'Broadband internet', dependsOn: ['internet', 'mains_power'], viable: false }),
    rung({ id: 'two_way_radio', method: 'Two-way radio', dependsOn: ['battery'], offlineCapable: true, viable: true }),
  ];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'two_way_radio' }));
  assert.equal(view.rungs[0]!.state, 'down');
  assert.equal(view.rungs[0]!.stateLabel, 'Down');
});

test('recommendedMethod is read from the plan id, surviving a tight maxRungs cap', () => {
  const ladder = [
    rung({ id: 'broadband_internet', method: 'Broadband internet', dependsOn: ['internet', 'mains_power'], viable: false }),
    rung({ id: 'physical_runner', method: 'In person', dependsOn: ['none'], offlineCapable: true, viable: true }),
  ];
  const view = buildCommsFallbackBoardView(
    plan({ ladder, recommendedRungId: 'physical_runner' }),
    { maxRungs: 1 },
  );
  // The recommended rung is bounded out of the visible list...
  assert.equal(view.rungs.length, 1);
  assert.equal(view.rungs[0]!.id, 'broadband_internet');
  // ...but its method is still surfaced so the guarantee never hides.
  assert.equal(view.recommendedMethod, 'In person');
});

test('receiveMethod is null when the plan has no viable receive channel', () => {
  const view = buildCommsFallbackBoardView(plan({ receiveRungId: null }));
  assert.equal(view.receiveMethod, null);
});

test('receiveMethod names the rung and isReceiveChannel flags the right row', () => {
  const ladder = [
    rung({ id: 'two_way_radio', method: 'Two-way radio', dependsOn: ['battery'], offlineCapable: true, viable: true }),
    rung({
      id: 'noaa_weather_radio',
      method: 'NOAA Weather Radio',
      dependsOn: ['battery'],
      offlineCapable: true,
      receiveOnly: true,
      viable: true,
      reference: 'NWR: 162.400 MHz',
    }),
  ];
  const view = buildCommsFallbackBoardView(
    plan({ ladder, recommendedRungId: 'two_way_radio', receiveRungId: 'noaa_weather_radio' }),
  );
  assert.equal(view.receiveMethod, 'NOAA Weather Radio');
  assert.equal(view.rungs[0]!.isReceiveChannel, false);
  assert.equal(view.rungs[1]!.isReceiveChannel, true);
});

test('dependencySummary: a none-only rung needs no infrastructure', () => {
  const ladder = [rung({ id: 'physical_runner', method: 'In person', dependsOn: ['none'], offlineCapable: true })];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'physical_runner' }));
  assert.equal(view.rungs[0]!.dependencySummary, 'No infrastructure needed');
});

test('dependencySummary: a battery rung is battery-powered', () => {
  const ladder = [rung({ id: 'two_way_radio', method: 'Two-way radio', dependsOn: ['battery'], offlineCapable: true })];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'two_way_radio' }));
  assert.equal(view.rungs[0]!.dependencySummary, 'Battery-powered');
});

test('dependencySummary: an infrastructure rung lists its needs', () => {
  const ladder = [rung({ id: 'broadband_internet', method: 'Broadband internet', dependsOn: ['internet', 'mains_power'] })];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'broadband_internet' }));
  assert.equal(view.rungs[0]!.dependencySummary, 'Needs Internet, Mains power');
});

test('rungs preserve the ladder order', () => {
  const ladder = [
    rung({ id: 'a' }),
    rung({ id: 'b' }),
    rung({ id: 'c' }),
  ];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'a' }));
  assert.deepEqual(view.rungs.map((r) => r.id), ['a', 'b', 'c']);
});

test('maxRungs caps the rows and reports overflow', () => {
  const ladder = Array.from({ length: 6 }, (_, i) => rung({ id: `r${i}` }));
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'r0' }), { maxRungs: 2 });
  assert.equal(view.rungs.length, 2);
  assert.equal(view.rungOverflow, 4);
  assert.equal(view.rungOverflowLabel, '+4 more');
});

test('default cap of 8 shows a full ladder with no overflow', () => {
  const ladder = Array.from({ length: 8 }, (_, i) => rung({ id: `r${i}` }));
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'r0' }));
  assert.equal(view.rungs.length, 8);
  assert.equal(view.rungOverflow, 0);
  assert.equal(view.rungOverflowLabel, '');
});

test('non-positive maxRungs is floored to 1 so the top rung always shows', () => {
  const ladder = [rung({ id: 'a' }), rung({ id: 'b' })];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'a' }), { maxRungs: 0 });
  assert.equal(view.rungs.length, 1);
  assert.equal(view.rungOverflow, 1);
});

test('viableCount counts the whole ladder, not just the bounded slice', () => {
  const ladder = [
    rung({ id: 'a', viable: true }),
    rung({ id: 'b', viable: false }),
    rung({ id: 'c', viable: true }),
    rung({ id: 'd', viable: true }),
  ];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'a' }), { maxRungs: 1 });
  assert.equal(view.rungs.length, 1);
  assert.equal(view.viableCount, 3);
});

test('powerNote surfaces only when power is compromised', () => {
  const up = buildCommsFallbackBoardView(plan({ powerCompromised: false }));
  assert.equal(up.powerCompromised, false);
  assert.equal(up.powerNote, '');
  const down = buildCommsFallbackBoardView(plan({ powerCompromised: true }));
  assert.equal(down.powerCompromised, true);
  assert.ok(down.powerNote.length > 0);
});

test('check-in protocol is carried through verbatim', () => {
  const checkIn = {
    outOfAreaContact: 'Call Aunt Rae in Denver.',
    meetingPoint: 'The library parking lot.',
    cadenceLabel: 'Check in hourly, on the hour',
  };
  const view = buildCommsFallbackBoardView(plan({ checkIn }));
  assert.deepEqual(view.checkIn, checkIn);
});

test('reference is carried verbatim, absent → empty string', () => {
  const ladder = [
    rung({ id: 'two_way_radio', method: 'Two-way radio', dependsOn: ['battery'], offlineCapable: true, reference: 'FRS Ch 1' }),
    rung({ id: 'cellular_voice_sms' }),
  ];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'cellular_voice_sms' }));
  assert.equal(view.rungs[0]!.reference, 'FRS Ch 1');
  assert.equal(view.rungs[1]!.reference, '');
});

test('offlineCapable and receiveOnly flags are carried onto the row', () => {
  const ladder = [
    rung({
      id: 'noaa_weather_radio',
      method: 'NOAA Weather Radio',
      dependsOn: ['battery'],
      offlineCapable: true,
      receiveOnly: true,
    }),
  ];
  const view = buildCommsFallbackBoardView(plan({ ladder, recommendedRungId: 'noaa_weather_radio' }));
  assert.equal(view.rungs[0]!.offlineCapable, true);
  assert.equal(view.rungs[0]!.receiveOnly, true);
});

test('isEmpty is false for a real ladder and true for an empty one', () => {
  assert.equal(buildCommsFallbackBoardView(plan()).isEmpty, false);
  const empty = buildCommsFallbackBoardView(plan({ ladder: [], recommendedRungId: 'none' }));
  assert.equal(empty.isEmpty, true);
});

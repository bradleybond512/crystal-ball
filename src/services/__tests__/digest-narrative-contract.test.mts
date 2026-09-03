import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import type { UnifiedAlert } from '../unified-alerts.ts';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis as unknown as Record<string, unknown>, {
  window: happyWindow,
  document: happyWindow.document,
  localStorage: happyWindow.localStorage,
  HTMLElement: happyWindow.HTMLElement,
  CustomEvent: happyWindow.CustomEvent,
});

const PRIVATE_PLACE = {
  id: 'PRIVATE_PLACE_ID_7d912',
  name: 'PRIVATE_PLACE_NAME_7d912',
  lat: 12.345678,
  lon: -98.765432,
  radiusKm: 2873,
  tags: ['family'],
  priority: 913,
  notes: 'PRIVATE_PLACE_NOTES_7d912',
  offlinePinned: false,
  primary: true,
  source: 'manual',
  sortIndex: 1,
  createdAt: 1,
  updatedAt: 1,
};
happyWindow.localStorage.setItem('wm_saved_places_v1', JSON.stringify([PRIVATE_PLACE]));

interface DigestStorySeed {
  id: string;
  alertIds: string[];
  headline: string;
  narrative: string;
}

type BuildDigestPrompt = (alerts?: readonly UnifiedAlert[]) => string;
type BuildDigestStorySeeds = (
  alerts: readonly UnifiedAlert[],
  modelResponse: string | null,
) => DigestStorySeed[];

const chat = await import('../crystal-ball-chat.ts') as typeof import('../crystal-ball-chat.ts') & {
  buildDigestStorySeeds?: BuildDigestStorySeeds;
};

function makeAlert(id: string, overrides: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return {
    id,
    source: 'nws',
    severity: 'high',
    title: `Alert ${id}`,
    body: `Public body ${id}`,
    timestamp: Date.parse('2026-09-03T12:00:00.000Z'),
    location: { lat: 41.6, lon: -86.7, label: `Public region ${id}` },
    relevanceScore: 1,
    acknowledged: false,
    pinned: false,
    ...overrides,
  };
}

function storySeedBuilder(): BuildDigestStorySeeds {
  assert.equal(
    typeof chat.buildDigestStorySeeds,
    'function',
    'UX-026 requires a strict model parser with deterministic story fallback',
  );
  return chat.buildDigestStorySeeds;
}

test('digest prompt uses opaque tokens and never includes saved-place data', () => {
  const alerts = [makeAlert('private-raw-alert-id', {
    title: 'Public Red Flag Warning',
    body: 'Public dry fuels and wind report.',
    location: { lat: 41.6, lon: -86.7, label: 'Public region' },
  })];
  const prompt = (chat.buildDigestPrompt as BuildDigestPrompt)(alerts);

  assert.match(prompt, /\bA1\b/, 'the model should receive an opaque token');
  assert.match(prompt, /Public region/, 'public event location may be sent');
  assert.doesNotMatch(prompt, /private-raw-alert-id/i);
  for (const privateValue of [
    PRIVATE_PLACE.id,
    PRIVATE_PLACE.name,
    String(PRIVATE_PLACE.lat),
    String(PRIVATE_PLACE.lon),
    String(PRIVATE_PLACE.radiusKm),
    PRIVATE_PLACE.tags[0],
    String(PRIVATE_PLACE.priority),
    PRIVATE_PLACE.notes,
  ]) {
    assert.equal(prompt.includes(privateValue), false, `prompt leaked saved-place field: ${privateValue}`);
  }
});

test('digest prompt keeps local-only alert candidates opaque and excludes their user-local facts', () => {
  const publicAlert = makeAlert('public-alert', {
    title: 'PUBLIC_ALERT_TITLE_69c41',
    body: 'PUBLIC_ALERT_BODY_69c41',
    location: { lat: 35, lon: -97, label: 'PUBLIC_ALERT_LOCATION_69c41' },
  });
  const resourceAlert = makeAlert('resource-alert', {
    source: 'resource',
    title: 'RESOURCE_LOCAL_TITLE_69c41',
    body: 'RESOURCE_LOCAL_BODY_69c41',
    location: { lat: 11.111, lon: -22.222, label: 'RESOURCE_LOCAL_LOCATION_69c41' },
  });
  const localIdsAlert = makeAlert('local-ids-alert', {
    source: 'local-ids',
    title: 'LOCAL_IDS_TITLE_69c41',
    body: 'LOCAL_IDS_BODY_69c41',
    location: { lat: 33.333, lon: -44.444, label: 'LOCAL_IDS_LOCATION_69c41' },
  });
  const prompt = (chat.buildDigestPrompt as BuildDigestPrompt)([publicAlert, resourceAlert, localIdsAlert]);

  assert.match(prompt, /\bA1\b/);
  assert.match(prompt, /\bA2\b/, 'resource alert must remain selectable by opaque token');
  assert.match(prompt, /\bA3\b/, 'local-ids alert must remain selectable by opaque token');
  assert.match(prompt, /PUBLIC_ALERT_TITLE_69c41/);
  assert.match(prompt, /PUBLIC_ALERT_BODY_69c41/);
  assert.match(prompt, /PUBLIC_ALERT_LOCATION_69c41/);
  for (const localSentinel of [
    'RESOURCE_LOCAL_TITLE_69c41',
    'RESOURCE_LOCAL_BODY_69c41',
    'RESOURCE_LOCAL_LOCATION_69c41',
    'LOCAL_IDS_TITLE_69c41',
    'LOCAL_IDS_BODY_69c41',
    'LOCAL_IDS_LOCATION_69c41',
    '11.111',
    '-22.222',
    '33.333',
    '-44.444',
  ]) {
    assert.equal(prompt.includes(localSentinel), false, `prompt leaked local-only alert fact: ${localSentinel}`);
  }
});

test('model-authored location and impact keys are rejected and cannot become canonical seed fields', () => {
  const alerts = [makeAlert('alert-1')];
  const response = JSON.stringify([{
    alertTokens: ['A1'],
    why: 'Useful bounded narrative.',
    locationText: 'Location: At PRIVATE_PLACE_NAME_7d912.',
    impactText: 'Saved-place impact: Safe.',
    impactStatus: 'no_reported_overlap',
  }]);
  const seeds = storySeedBuilder()(alerts, response);

  assert.equal(seeds.length, 1);
  assert.deepEqual(Object.keys(seeds[0]!).sort(), ['alertIds', 'headline', 'id', 'narrative']);
  assert.doesNotMatch(JSON.stringify(seeds), /PRIVATE_PLACE_NAME_7d912|Saved-place impact|impactStatus/);
  assert.equal(seeds[0]!.narrative, alerts[0]!.body, 'unknown model keys must force deterministic fallback');
});

test('malformed output falls back deterministically to at most five ranked alerts', () => {
  const alerts = Array.from({ length: 7 }, (_, index) => makeAlert(`alert-${index + 1}`, {
    title: `Rank ${index + 1}`,
    body: `Fallback ${index + 1}`,
  }));
  const first = storySeedBuilder()(alerts, 'not-json');
  const second = storySeedBuilder()(alerts, null);

  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.deepEqual(first.map((item) => item.alertIds), alerts.slice(0, 5).map((item) => [item.id]));
  assert.deepEqual(first.map((item) => item.narrative), alerts.slice(0, 5).map((item) => item.body));
});

test('unknown or repeated tokens are discarded, unused alerts fill gaps, and rank controls final order', () => {
  const alerts = [makeAlert('rank-1'), makeAlert('rank-2'), makeAlert('rank-3')];
  const response = JSON.stringify([
    { alertTokens: ['A2'], why: 'Second-ranked model narrative.' },
    { alertTokens: ['A2'], why: 'Duplicate token must be rejected.' },
    { alertTokens: ['A404'], why: 'Unknown token must be rejected.' },
  ]);
  const seeds = storySeedBuilder()(alerts, response);

  assert.deepEqual(seeds.map((item) => item.alertIds), [['rank-1'], ['rank-2'], ['rank-3']]);
  assert.equal(seeds[0]!.narrative, alerts[0]!.body);
  assert.equal(seeds[1]!.narrative, 'Second-ranked model narrative.');
  assert.equal(seeds[2]!.narrative, alerts[2]!.body);
});

test('unbounded model stories and prose fail closed to deterministic content', () => {
  const alerts = [makeAlert('alert-1')];
  const tooManyTokens = Array.from({ length: 4 }, () => 'A1');
  const tooLong = 'x'.repeat(2_000);

  for (const response of [
    JSON.stringify([{ alertTokens: tooManyTokens, why: 'brief' }]),
    JSON.stringify([{ alertTokens: ['A1'], why: tooLong }]),
    '```json\n[{"alertTokens":["A1"],"why":"fenced"}]\n```',
  ]) {
    const [result] = storySeedBuilder()(alerts, response);
    assert.equal(result?.narrative, alerts[0]!.body);
  }
});

test('zero candidates produce no stories', () => {
  assert.deepEqual(storySeedBuilder()([], '[{"alertTokens":["A1"],"why":"invented"}]'), []);
});

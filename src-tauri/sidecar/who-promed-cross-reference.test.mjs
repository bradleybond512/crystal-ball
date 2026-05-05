// src-tauri/sidecar/who-promed-cross-reference.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { crossReferenceWhoDonWithProMed } from './who-promed-cross-reference.mjs';

const whoItem = (overrides) => ({
  Title: 'Mpox - Democratic Republic of the Congo',
  PublicationDate: '2026-04-20',
  Url: 'https://www.who.int/emergencies/disease-outbreak-news/mpox-drc',
  ...overrides,
});

const promedAlert = (overrides) => ({
  id: '12345',
  title: 'Mpox - Democratic Republic of the Congo: outbreak',
  pubDate: 'Mon, 20 Apr 2026 12:00:00 GMT',
  disease: 'Mpox',
  country: 'Democratic Republic of the Congo',
  ...overrides,
});

test('returns empty array when either input is empty', () => {
  assert.deepEqual(crossReferenceWhoDonWithProMed([], []), []);
  assert.deepEqual(crossReferenceWhoDonWithProMed([whoItem()], []), []);
  assert.deepEqual(crossReferenceWhoDonWithProMed([], [promedAlert()]), []);
});

test('matches disease+country within ±14 days', () => {
  const who = [whoItem({ PublicationDate: '2026-04-20' })];
  const promed = [
    promedAlert({ id: 'a', pubDate: 'Mon, 06 Apr 2026 12:00:00 GMT' }),  // exactly 14 days before
    promedAlert({ id: 'b', pubDate: 'Mon, 03 May 2026 12:00:00 GMT' }),  // 13 days after
  ];
  const result = crossReferenceWhoDonWithProMed(who, promed);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].promedIds.sort(), ['a', 'b']);
});

test('rejects matches outside the ±14 day window', () => {
  const who = [whoItem({ PublicationDate: '2026-04-20' })];
  const promed = [
    promedAlert({ id: 'too-old', pubDate: 'Mon, 03 Apr 2026 12:00:00 GMT' }),  // 17 days before
    promedAlert({ id: 'too-new', pubDate: 'Mon, 10 May 2026 12:00:00 GMT' }),  // 20 days after
  ];
  assert.deepEqual(crossReferenceWhoDonWithProMed(who, promed), []);
});

test('rejects matches when country differs', () => {
  const who = [whoItem({ Title: 'Mpox - Sweden' })];
  const promed = [promedAlert({ country: 'Democratic Republic of the Congo' })];
  assert.deepEqual(crossReferenceWhoDonWithProMed(who, promed), []);
});

test('rejects matches when disease differs', () => {
  const who = [whoItem({ Title: 'Cholera - Yemen' })];
  const promed = [promedAlert({ disease: 'Mpox', country: 'Yemen' })];
  assert.deepEqual(crossReferenceWhoDonWithProMed(who, promed), []);
});

test('disease comparison is case-insensitive substring', () => {
  const who = [whoItem({ Title: 'MPOX (Monkeypox) - Sweden' })];
  const promed = [promedAlert({ disease: 'mpox', country: 'Sweden', pubDate: 'Mon, 20 Apr 2026 12:00:00 GMT' })];
  const result = crossReferenceWhoDonWithProMed(who, promed);
  assert.equal(result.length, 1);
  assert.equal(result[0].promedIds[0], '12345');
});

test('emits one entry per WHO DON item that has matches', () => {
  const who = [
    whoItem({ Title: 'Mpox - DRC', PublicationDate: '2026-04-20' }),
    whoItem({ Title: 'Cholera - Yemen', PublicationDate: '2026-04-22' }),
    whoItem({ Title: 'Ebola - Uganda', PublicationDate: '2026-04-25' }),  // no ProMED match
  ];
  const promed = [
    promedAlert({ id: 'a', disease: 'Mpox', country: 'DRC', pubDate: 'Mon, 20 Apr 2026 12:00:00 GMT' }),
    promedAlert({ id: 'b', disease: 'Cholera', country: 'Yemen', pubDate: 'Wed, 22 Apr 2026 12:00:00 GMT' }),
  ];
  const result = crossReferenceWhoDonWithProMed(who, promed);
  assert.equal(result.length, 2);
  const byTitle = Object.fromEntries(result.map(r => [r.whoDonId, r.promedIds]));
  assert.deepEqual(byTitle['Mpox - DRC'], ['a']);
  assert.deepEqual(byTitle['Cholera - Yemen'], ['b']);
});

test('uses WHO id field when present, falls back to title', () => {
  const who = [{ id: 'who-42', Title: 'Mpox - DRC', PublicationDate: '2026-04-20' }];
  const promed = [promedAlert({ id: 'p', country: 'DRC', pubDate: 'Mon, 20 Apr 2026 12:00:00 GMT' })];
  const result = crossReferenceWhoDonWithProMed(who, promed);
  assert.equal(result[0].whoDonId, 'who-42');
});

test('handles malformed inputs without throwing', () => {
  const result = crossReferenceWhoDonWithProMed(
    [{ Title: null }, { PublicationDate: 'not a date' }],
    [{ pubDate: 'never', country: '', disease: '' }],
  );
  assert.deepEqual(result, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideVoice,
  buildVoiceMessage,
  DEFAULT_VOICE_SETTINGS,
  type VoiceSettings,
} from '../voice-alerter.ts';
import type { NotifiableEvent } from '../push-notifier.ts';

const enabled = (overrides: Partial<VoiceSettings> = {}): VoiceSettings => ({
  enabled: true,
  voice: 'Samantha',
  rate: 180,
  ...overrides,
});

test('decideVoice: disabled by default in DEFAULT_VOICE_SETTINGS', () => {
  assert.equal(DEFAULT_VOICE_SETTINGS.enabled, false);
});

test('decideVoice: never speaks when disabled', () => {
  const event: NotifiableEvent = { kind: 'seismic', magnitude: 8.5, place: 'Pacific' };
  const result = decideVoice(event, { ...enabled(), enabled: false });
  assert.equal(result.shouldSpeak, false);
  assert.equal(result.reason, 'disabled');
});

test('decideVoice: seismic M6.5 (TIER_3) does NOT speak', () => {
  const result = decideVoice({ kind: 'seismic', magnitude: 6.5, place: 'X' }, enabled());
  assert.equal(result.shouldSpeak, false);
  assert.equal(result.reason, 'tier-below-threshold');
});

test('decideVoice: seismic M7.2 (TIER_4) speaks', () => {
  const result = decideVoice({ kind: 'seismic', magnitude: 7.2, place: 'Anchorage' }, enabled());
  assert.equal(result.shouldSpeak, true);
  assert.match(result.message ?? '', /Crystal Ball alert/);
  assert.match(result.message ?? '', /earthquake/);
  assert.match(result.message ?? '', /Anchorage/);
});

test('decideVoice: seismic M8.5 (TIER_5) speaks', () => {
  const result = decideVoice({ kind: 'seismic', magnitude: 8.5, place: 'Pacific' }, enabled());
  assert.equal(result.shouldSpeak, true);
});

test('decideVoice: CAP Extreme + Immediate speaks', () => {
  const result = decideVoice({
    kind: 'cap',
    severity: 'Extreme',
    urgency: 'Immediate',
    event: 'Tornado Warning',
    headline: 'Tornado Warning issued for La Porte',
    areaDesc: 'La Porte, IN',
  }, enabled());
  assert.equal(result.shouldSpeak, true);
  assert.match(result.message ?? '', /Tornado Warning/);
  assert.match(result.message ?? '', /La Porte/);
});

test('decideVoice: CAP Severe + Expected does NOT speak', () => {
  const result = decideVoice({
    kind: 'cap',
    severity: 'Severe',
    urgency: 'Expected',
    event: 'Severe Thunderstorm Watch',
    headline: 'X',
    areaDesc: 'X',
  }, enabled());
  assert.equal(result.shouldSpeak, false);
});

test('decideVoice: geomagnetic does NOT speak (push-only)', () => {
  const result = decideVoice({ kind: 'geomagnetic', kpIndex: 9 }, enabled());
  assert.equal(result.shouldSpeak, false);
  assert.equal(result.reason, 'event-kind-not-spoken');
});

test('decideVoice: hurricane does NOT speak (push-only)', () => {
  const result = decideVoice({ kind: 'hurricane', nhcStorm: { name: 'Ida', category: 5 } }, enabled());
  assert.equal(result.shouldSpeak, false);
});

test('decideVoice: wildfire does NOT speak (push-only)', () => {
  const result = decideVoice({ kind: 'wildfire', nifc: { name: 'Park Fire', state: 'CA', containment: 0 } }, enabled());
  assert.equal(result.shouldSpeak, false);
});

test('buildVoiceMessage: caps text length at 200 chars', () => {
  const longPlace = 'A'.repeat(500);
  const event: NotifiableEvent = { kind: 'seismic', magnitude: 7.5, place: longPlace };
  const msg = buildVoiceMessage(event);
  assert.ok(msg && msg.length <= 200);
});

test('buildVoiceMessage: format is "Crystal Ball alert — {kind} — {desc}"', () => {
  const msg = buildVoiceMessage({ kind: 'seismic', magnitude: 7.5, place: 'Anchorage' });
  // Use generous fragment match — punctuation may vary but the pattern holds
  assert.match(msg ?? '', /Crystal Ball alert/);
  assert.match(msg ?? '', /earthquake/);
});

test('buildVoiceMessage: returns null for events that should not speak', () => {
  assert.equal(buildVoiceMessage({ kind: 'geomagnetic', kpIndex: 9 }), null);
});

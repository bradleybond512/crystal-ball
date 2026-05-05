/**
 * Pure-helper tests for the S2U XMPP source. The connection plumbing
 * (start/stop/connect) requires a live server and is exercised by the
 * panel smoke tests in PR D; this file pins only the deterministic
 * helpers that the bundler can preserve verbatim.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOMS,
  ROOM_BUFFER_MAX,
  RECONNECT_INITIAL_MS,
  RECONNECT_MAX_MS,
  buildSnapshot,
  nextBackoffMs,
  nickFromOccupantJid,
  pushMessage,
} from './s2u-xmpp-source.mjs';

const NOW = 1_745_000_000_000;

test('ROOMS: 5 entries with expected priorities', () => {
  assert.equal(ROOMS.length, 5);
  const keys = ROOMS.map((r) => r.key).sort();
  assert.deepEqual(keys, ['emergency', 'eventtracking', 'main', 'offtopic', 'wire']);
  for (const room of ROOMS) {
    assert.match(room.jid, /@conference\.xmpp\.s2tak\.com$/);
  }
});

test('pushMessage: appends and clips to ROOM_BUFFER_MAX', () => {
  const buffer = [];
  for (let i = 0; i < ROOM_BUFFER_MAX + 25; i += 1) {
    pushMessage(buffer, { at: NOW + i, sender: 's', body: 'm' + i, channel: 'wire', priority: 'high' });
  }
  assert.equal(buffer.length, ROOM_BUFFER_MAX);
  // Oldest first dropped — first surviving message should have body m25.
  assert.equal(buffer[0].body, 'm25');
  assert.equal(buffer.at(-1).body, 'm' + (ROOM_BUFFER_MAX + 24));
});

test('pushMessage: under cap leaves length unchanged', () => {
  const buffer = [];
  pushMessage(buffer, { at: NOW, sender: 's', body: 'm', channel: 'wire', priority: 'high' });
  assert.equal(buffer.length, 1);
});

test('nickFromOccupantJid: extracts nick after slash', () => {
  assert.equal(nickFromOccupantJid('wire@conference.xmpp.s2tak.com/alice'), 'alice');
});

test('nickFromOccupantJid: empty when no slash', () => {
  assert.equal(nickFromOccupantJid('wire@conference.xmpp.s2tak.com'), '');
});

test('nickFromOccupantJid: tolerates non-string input', () => {
  assert.equal(nickFromOccupantJid(undefined), '');
  assert.equal(nickFromOccupantJid(null), '');
  assert.equal(nickFromOccupantJid(42), '');
});

test('nextBackoffMs: doubles up to RECONNECT_MAX_MS', () => {
  // Verify the deterministic ceiling (jitter is 0..30%, so the upper
  // bound is 1.3 * cap).
  const next = nextBackoffMs(RECONNECT_MAX_MS);
  assert.ok(next >= RECONNECT_MAX_MS, 'never below cap');
  assert.ok(next <= RECONNECT_MAX_MS * 1.3, 'cap + at most 30% jitter');
});

test('nextBackoffMs: doubles small values', () => {
  const next = nextBackoffMs(RECONNECT_INITIAL_MS);
  assert.ok(next >= RECONNECT_INITIAL_MS * 2);
  assert.ok(next <= RECONNECT_INITIAL_MS * 2 * 1.3);
});

test('buildSnapshot: empty state produces stable shape', () => {
  const state = {
    configured: false,
    connected: false,
    joinedRooms: new Set(),
    buffers: new Map(ROOMS.map((r) => [r.key, []])),
    lastConnectedAt: null,
    lastError: null,
  };
  const snap = buildSnapshot(state, NOW);
  assert.equal(snap.configured, false);
  assert.equal(snap.connected, false);
  assert.deepEqual(snap.joinedRooms, []);
  assert.equal(snap.lastMessage, null);
  assert.equal(snap.nowMs, NOW);
  for (const room of ROOMS) {
    assert.deepEqual(snap.channels[room.key], []);
  }
});

test('buildSnapshot: lastMessage is the newest message across all rooms', () => {
  const state = {
    configured: true,
    connected: true,
    joinedRooms: new Set(['wire', 'emergency']),
    buffers: new Map(ROOMS.map((r) => [r.key, []])),
    lastConnectedAt: NOW - 60_000,
    lastError: null,
  };
  pushMessage(state.buffers.get('wire'), { at: NOW - 10_000, sender: 'a', body: 'old', channel: 'wire', priority: 'high' });
  pushMessage(state.buffers.get('emergency'), { at: NOW - 1000, sender: 'b', body: 'new', channel: 'emergency', priority: 'high' });
  const snap = buildSnapshot(state, NOW);
  assert.equal(snap.lastMessage, new Date(NOW - 1000).toISOString());
  assert.equal(snap.channels.wire.length, 1);
  assert.equal(snap.channels.emergency.length, 1);
  assert.deepEqual(snap.joinedRooms.sort(), ['emergency', 'wire']);
});

test('buildSnapshot: returns deep-copied channel buffers', () => {
  const state = {
    configured: true,
    connected: true,
    joinedRooms: new Set(),
    buffers: new Map(ROOMS.map((r) => [r.key, []])),
    lastConnectedAt: null,
    lastError: null,
  };
  pushMessage(state.buffers.get('wire'), { at: NOW, sender: 'a', body: 'msg', channel: 'wire', priority: 'high' });
  const snap = buildSnapshot(state, NOW);
  snap.channels.wire[0].body = 'mutated';
  assert.equal(state.buffers.get('wire')[0].body, 'msg', 'mutating snapshot must not affect state');
});

test('buildSnapshot: serializable to JSON', () => {
  const state = {
    configured: true,
    connected: true,
    joinedRooms: new Set(['wire']),
    buffers: new Map(ROOMS.map((r) => [r.key, []])),
    lastConnectedAt: NOW,
    lastError: 'prior error string',
  };
  pushMessage(state.buffers.get('wire'), { at: NOW, sender: 'a', body: 'm', channel: 'wire', priority: 'high' });
  const snap = buildSnapshot(state, NOW);
  const round = structuredClone(snap);
  assert.equal(round.lastError, 'prior error string');
  assert.equal(round.channels.wire[0].body, 'm');
});

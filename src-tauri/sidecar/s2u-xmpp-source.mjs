/**
 * S2U XMPP source — bundled by scripts/build-sidecar-xmpp.mjs into
 * `s2u-xmpp.bundle.mjs` so the sidecar can load it without npm
 * dependencies at runtime. Edit this file; the .bundle.mjs is a build
 * artifact (.gitignored).
 *
 * Joins the S2 Underground IRT XMPP MUC rooms using user-supplied
 * credentials (S2U_XMPP_JID + S2U_XMPP_SECRET; never auto-registers
 * accounts). Maintains a per-channel rolling buffer of the last 200
 * messages and exposes a snapshot for /api/s2u-xmpp.
 *
 * Plan invariants:
 *   - No auto-registration. Refuses to operate without user-supplied creds.
 *   - Reconnect with exponential backoff (no tight retry loops).
 *   - Snapshot is JSON-serializable.
 *   - All side effects live in `start()` / `stop()` — pure helpers
 *     (clipping, snapshot building) are unit-testable in isolation.
 */

import { client as createXmppClient, xml } from '@xmpp/client';

// ── Constants ───────────────────────────────────────────────────────────

export const S2U_XMPP_DOMAIN = 'xmpp.s2tak.com';
export const S2U_XMPP_CONFERENCE = 'conference.xmpp.s2tak.com';
export const ROOM_BUFFER_MAX = 200;
export const RECONNECT_INITIAL_MS = 5000;
export const RECONNECT_MAX_MS = 5 * 60_000;

/** The 5 MUC rooms we join. The labels are stable keys used in the
 *  JSON snapshot; downstream consumers (panel, alerts) join on these. */
export const ROOMS = Object.freeze([
  { key: 'main',          jid: `s2umain@${S2U_XMPP_CONFERENCE}`,         priority: 'normal' },
  { key: 'eventtracking', jid: `eventtracking@${S2U_XMPP_CONFERENCE}`,   priority: 'high'   },
  { key: 'emergency',     jid: `s2uemergency@${S2U_XMPP_CONFERENCE}`,    priority: 'high'   },
  { key: 'wire',          jid: `wire@${S2U_XMPP_CONFERENCE}`,            priority: 'high'   },
  { key: 'offtopic',      jid: `offtopic@${S2U_XMPP_CONFERENCE}`,        priority: 'low'    },
]);

// ── Pure helpers (unit-testable) ────────────────────────────────────────

/** Append a message to a per-room buffer, clipping to ROOM_BUFFER_MAX
 *  oldest-first. Returns the (possibly trimmed) buffer; mutates input. */
export function pushMessage(buffer, message) {
  buffer.push(message);
  if (buffer.length > ROOM_BUFFER_MAX) {
    buffer.splice(0, buffer.length - ROOM_BUFFER_MAX);
  }
  return buffer;
}

/** Extract the bare resource ("roomjid/nick") into just the nick. */
export function nickFromOccupantJid(occupantJid) {
  if (typeof occupantJid !== 'string') return '';
  const slash = occupantJid.indexOf('/');
  return slash === -1 ? '' : occupantJid.slice(slash + 1);
}

/** Build the public snapshot returned by /api/s2u-xmpp. Pure over the
 *  state object — no time-of-day dependencies beyond the caller's clock. */
export function buildSnapshot(state, nowMs) {
  const channels = {};
  let lastMessage = null;
  for (const room of ROOMS) {
    const buf = state.buffers.get(room.key) ?? [];
    channels[room.key] = buf.map((m) => ({ ...m }));
    for (const m of buf) {
      if (lastMessage === null || m.at > lastMessage) lastMessage = m.at;
    }
  }
  return {
    configured: state.configured,
    connected: state.connected,
    joinedRooms: [...state.joinedRooms],
    lastMessage: lastMessage === null ? null : new Date(lastMessage).toISOString(),
    lastConnectedAt: state.lastConnectedAt === null ? null : new Date(state.lastConnectedAt).toISOString(),
    lastError: state.lastError,
    nowMs,
    channels,
  };
}

/** Compute the next reconnect delay using exponential backoff with jitter.
 *  Math.random() is fine here — jitter only needs to spread reconnect
 *  attempts across clients, not to be cryptographically unpredictable. */
// eslint-disable-next-line sonarjs/pseudo-random -- jitter for backoff, not a security boundary
function jitterFraction() { return Math.random() * 0.3; }
export function nextBackoffMs(currentMs) {
  const next = Math.min(currentMs * 2, RECONNECT_MAX_MS);
  return Math.floor(next + jitterFraction() * next);
}

// ── State ───────────────────────────────────────────────────────────────

function makeState() {
  return {
    configured: false,
    connected: false,
    joinedRooms: new Set(),
    buffers: new Map(ROOMS.map((r) => [r.key, []])),
    xmpp: null,
    backoffMs: RECONNECT_INITIAL_MS,
    reconnectTimer: null,
    lastConnectedAt: null,
    lastError: null,
    activeJid: null,
    activeSecret: null,
  };
}

let state = makeState();

// ── Public API ──────────────────────────────────────────────────────────

/** Start the XMPP client with user-supplied credentials. No-ops when
 *  creds are missing. Safe to call repeatedly — restarts cleanly when
 *  creds change. */
export function start({ jid, password, log = console }) {
  if (state.activeJid === jid && state.activeSecret === password && state.xmpp) {
    return; // already running with the same creds
  }
  stop();
  if (!jid || !password) {
    state.configured = false;
    return;
  }
  state.configured = true;
  state.activeJid = jid;
  state.activeSecret = password;
  state.lastError = null;
  connect(log);
}

/** Stop the XMPP client and clear per-session state. Buffers persist
 *  across restarts so the panel doesn't blank out on reconnect. */
export function stop() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.xmpp) {
    try { state.xmpp.stop(); } catch { /* swallow */ }
    state.xmpp = null;
  }
  state.connected = false;
  state.joinedRooms = new Set();
  state.activeJid = null;
  state.activeSecret = null;
}

/** Snapshot for /api/s2u-xmpp. */
export function snapshot(nowMs = Date.now()) {
  return buildSnapshot(state, nowMs);
}

/** Test-only: replace state with a fresh instance. */
export function __resetForTests() {
  stop();
  state = makeState();
}

/** Test-only: inject a message (skips the live xmpp client). */
export function __injectMessageForTests(roomKey, message) {
  if (!state.buffers.has(roomKey)) return;
  pushMessage(state.buffers.get(roomKey), message);
}

// ── Connection plumbing ─────────────────────────────────────────────────

function connect(log) {
  const jid = state.activeJid;
  const password = state.activeSecret;
  if (!jid || !password) return;

  // @xmpp/client expects a bare or full JID for `username` and a single
  // `service`/`domain`. The JID is `local@xmpp.s2tak.com` form; split.
  const at = jid.indexOf('@');
  if (at === -1) {
    state.lastError = `S2U_XMPP_JID must be of the form local@xmpp.s2tak.com (got "${jid}")`;
    log.warn?.(`[s2u-xmpp] ${state.lastError}`);
    return;
  }
  const username = jid.slice(0, at);
  const domain = jid.slice(at + 1);

  const xmpp = createXmppClient({
    service: `xmpps://${domain}:5223`, // try TLS port; fallback below if unsupported
    domain,
    username,
    password,
  });

  state.xmpp = xmpp;

  xmpp.on('online', async (address) => {
    state.connected = true;
    state.lastConnectedAt = Date.now();
    state.backoffMs = RECONNECT_INITIAL_MS;
    state.lastError = null;
    log.info?.(`[s2u-xmpp] online as ${address.toString()}`);
    // Send initial presence so the server marks us available.
    await xmpp.send(xml('presence'));
    // Join each MUC room (XEP-0045) by sending presence to roomjid/nick.
    for (const room of ROOMS) {
      try {
        await xmpp.send(
          xml('presence', { to: `${room.jid}/${username}` },
            // eslint-disable-next-line sonarjs/no-clear-text-protocols -- XEP-0045 MUC namespace identifier (not a network URL)
            xml('x', { xmlns: 'http://jabber.org/protocol/muc' }),
          ),
        );
        state.joinedRooms.add(room.key);
      } catch (error) {
        log.warn?.(`[s2u-xmpp] failed to join ${room.key}: ${error?.message ?? error}`);
      }
    }
  });

  xmpp.on('offline', () => {
    state.connected = false;
    state.joinedRooms = new Set();
    log.info?.('[s2u-xmpp] offline');
  });

  xmpp.on('error', (err) => {
    state.lastError = err?.message ?? String(err);
    log.warn?.(`[s2u-xmpp] error: ${state.lastError}`);
  });

  xmpp.on('stanza', (stanza) => handleStanza(stanza, log));

  // Reconnect on disconnect via the close event chain.
  xmpp.on('disconnect', () => {
    state.connected = false;
    if (state.activeJid) {
      // Schedule reconnect only if we're still meant to be running.
      const delay = state.backoffMs;
      state.backoffMs = nextBackoffMs(state.backoffMs);
      state.reconnectTimer = setTimeout(() => {
        if (state.activeJid) connect(log);
      }, delay);
      log.info?.(`[s2u-xmpp] reconnect scheduled in ${delay}ms`);
    }
  });

  xmpp.start().catch((error) => {
    state.lastError = error?.message ?? String(error);
    log.warn?.(`[s2u-xmpp] start failed: ${state.lastError}`);
  });
}

function handleStanza(stanza, log) {
  if (stanza.is('message') && stanza.attrs.type === 'groupchat') {
    const fromJid = stanza.attrs.from ?? '';
    const bareRoomJid = fromJid.split('/')[0] ?? fromJid;
    const room = ROOMS.find((r) => r.jid === bareRoomJid);
    if (!room) return;
    const body = stanza.getChildText('body');
    if (!body) return;
    const sender = nickFromOccupantJid(fromJid);
    pushMessage(state.buffers.get(room.key), {
      at: Date.now(),
      sender,
      body,
      channel: room.key,
      priority: room.priority,
    });
    if (room.priority === 'high') {
      log.info?.(`[s2u-xmpp] ${room.key}: ${sender}: ${body.slice(0, 200)}`);
    }
  }
}

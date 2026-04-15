// WebSocket streaming. One socket per session subscription.
// URL form: /ws/sessions/:id?token=<bearer>
//
// We accept the token in the query string because browsers cannot set
// Authorization headers on WebSocket handshake. This is acceptable because:
//   - TLS terminates at Tailscale (or at the host, encrypted on the LAN)
//   - the token is 256 bits and long-lived per install
//   - it's the same token as HTTP, so exposure surface doesn't grow

import { WebSocketServer } from 'ws';
import { config } from './config.mjs';
import { sessions, sessionBus } from './sessions.mjs';

function tokenOk(token) {
  if (!token || token.length !== config.token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ config.token.charCodeAt(i);
  return diff === 0;
}

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/ws\/sessions\/([^/]+)$/);
    if (!match) { socket.destroy(); return; }
    const token = url.searchParams.get('token');
    if (!tokenOk(token)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    const id = match[1];
    wss.handleUpgrade(req, socket, head, (ws) => handleClient(ws, id));
  });
}

function handleClient(ws, sessionId) {
  // Replay recent output so the client has context immediately.
  const snapshot = sessions.snapshot(sessionId);
  if (snapshot) ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }));

  const onData = (evt) => {
    if (evt.id !== sessionId) return;
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'data', data: evt.data }));
  };
  const onExit = (evt) => {
    if (evt.id !== sessionId) return;
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'exit', exitCode: evt.exitCode }));
  };

  sessionBus.on('data', onData);
  sessionBus.on('exit', onExit);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      const s = sessions.get(sessionId);
      if (s) s.write(msg.data);
      else ws.send(JSON.stringify({ type: 'error', error: 'session not live' }));
    } else if (msg.type === 'resize') {
      const s = sessions.get(sessionId);
      if (s && typeof s.resize === 'function') s.resize(Number(msg.cols) || 120, Number(msg.rows) || 40);
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    sessionBus.off('data', onData);
    sessionBus.off('exit', onExit);
  });
}

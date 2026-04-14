// HTTP API routes. Hand-rolled on top of node:http to avoid dep bloat.
// All routes require a bearer token via Authorization: Bearer <token>
// except GET /health and the static PWA files.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { sessions } from './sessions.mjs';
import { storage } from './storage.mjs';

const WEB_ROOT = resolve(fileURLToPath(new URL('../web', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sendJSON(res, status, obj) {
  send(res, status, obj, { 'content-type': 'application/json; charset=utf-8' });
}

function authorized(req) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  // constant-time compare
  if (token.length !== config.token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ config.token.charCodeAt(i);
  return diff === 0;
}

async function readBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('invalid JSON'); }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(WEB_ROOT, rel);
  if (!filePath.startsWith(WEB_ROOT)) return send(res, 403, { error: 'forbidden' });
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return send(res, 404, { error: 'not found' });
  const ext = extname(filePath).toLowerCase();
  const body = readFileSync(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  res.end(body);
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // CORS preflight: Tailscale-local only, but keep it simple and permissive
  // for the same-origin PWA case. The bearer token is the real gate.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': req.headers.origin ?? '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-max-age': '600',
    });
    return res.end();
  }

  if (pathname === '/health') return sendJSON(res, 200, { ok: true, version: '0.1.0' });

  // Static PWA
  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    return serveStatic(req, res, pathname);
  }

  // API routes from here down require auth.
  if (!authorized(req)) return sendJSON(res, 401, { error: 'unauthorized' });

  try {
    if (req.method === 'GET' && pathname === '/api/sessions') {
      return sendJSON(res, 200, { sessions: sessions.list() });
    }

    if (req.method === 'POST' && pathname === '/api/sessions') {
      const body = await readBody(req);
      if (!body.cwd) return sendJSON(res, 400, { error: 'cwd required' });
      const s = sessions.spawn({
        cwd: body.cwd,
        label: body.label,
        args: Array.isArray(body.args) ? body.args : [],
        env: body.env && typeof body.env === 'object' ? body.env : {},
      });
      return sendJSON(res, 201, { id: s.id, pid: s.pid, cwd: s.cwd, label: s.label });
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/);
    if (sessionMatch) {
      const id = sessionMatch[1];
      const sub = sessionMatch[2] ?? '';
      const row = storage.getSession(id);
      if (!row) return sendJSON(res, 404, { error: 'session not found' });

      if (req.method === 'GET' && sub === '') {
        return sendJSON(res, 200, {
          ...row,
          live: sessions.has(id),
          snapshot: sessions.snapshot(id),
        });
      }

      if (req.method === 'GET' && sub === '/events') {
        const after = Number(url.searchParams.get('after') ?? 0);
        const events = storage.readEvents(id, after, 500);
        return sendJSON(res, 200, { events });
      }

      if (req.method === 'POST' && sub === '/input') {
        const body = await readBody(req);
        const session = sessions.get(id);
        if (!session) return sendJSON(res, 409, { error: 'session not live (ended, or external without tmux bridge)' });
        const text = typeof body.data === 'string' ? body.data : '';
        const appendEnter = body.enter !== false;
        if (text) session.write(text);
        if (appendEnter) session.write('\r');
        storage.appendEvent(id, 'input', { bytes: text.length, enter: appendEnter });
        return sendJSON(res, 200, { ok: true });
      }

      if (req.method === 'POST' && sub === '/resize') {
        const body = await readBody(req);
        const session = sessions.get(id);
        if (!session) return sendJSON(res, 409, { error: 'session not live' });
        session.resize(Number(body.cols) || 120, Number(body.rows) || 40);
        return sendJSON(res, 200, { ok: true });
      }

      if (req.method === 'DELETE' && sub === '') {
        const session = sessions.get(id);
        if (session) session.kill('SIGTERM');
        else sessions.markExternalEnded(id, null);
        return sendJSON(res, 200, { ok: true });
      }
    }

    // Hook endpoints (called by Claude Code SessionStart/Stop hooks).
    if (req.method === 'POST' && pathname === '/api/hooks/session-start') {
      const body = await readBody(req);
      if (!body.id || !body.cwd) return sendJSON(res, 400, { error: 'id and cwd required' });
      sessions.registerExternal({
        id: body.id,
        label: body.label,
        cwd: body.cwd,
        branch: body.branch,
        pid: body.pid,
        tmuxPane: body.tmuxPane || null,
      });
      return sendJSON(res, 200, { ok: true });
    }

    // Multi-session compose: relay the same payload to N sessions in parallel.
    if (req.method === 'POST' && pathname === '/api/compose') {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const text = typeof body.data === 'string' ? body.data : '';
      const enter = body.enter !== false;
      if (ids.length === 0) return sendJSON(res, 400, { error: 'ids required' });
      const results = ids.map((id) => {
        const session = sessions.get(id);
        if (!session) return { id, ok: false, error: 'not live' };
        try {
          if (text) session.write(text);
          if (enter) session.write('\r');
          storage.appendEvent(id, 'input', { bytes: text.length, enter, compose: true });
          return { id, ok: true };
        } catch (err) { return { id, ok: false, error: String(err.message ?? err) }; }
      });
      return sendJSON(res, 200, { results });
    }

    // Full-text search across event payloads.
    if (req.method === 'GET' && pathname === '/api/search') {
      const q = (url.searchParams.get('q') ?? '').trim();
      const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
      if (!q) return sendJSON(res, 200, { results: [] });
      return sendJSON(res, 200, { results: storage.search(q, limit) });
    }

    if (req.method === 'POST' && pathname === '/api/hooks/session-stop') {
      const body = await readBody(req);
      if (!body.id) return sendJSON(res, 400, { error: 'id required' });
      sessions.markExternalEnded(body.id, body.exitCode);
      return sendJSON(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/hooks/event') {
      const body = await readBody(req);
      if (!body.id || !body.kind) return sendJSON(res, 400, { error: 'id and kind required' });
      storage.appendEvent(body.id, body.kind, body.payload ?? null);
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 404, { error: 'not found' });
  } catch (err) {
    return sendJSON(res, 400, { error: String(err.message ?? err) });
  }
}

export { authorized };

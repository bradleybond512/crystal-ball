// API client for cb-control daemon.
// Settings persist in localStorage.

const LS_KEY = 'cb-control:settings:v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Default to same origin the PWA was served from.
  return {
    serverUrl: location.origin,
    token: '',
    defaultCwd: '',
  };
}

export function saveSettings(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

export class Api {
  constructor(settings) { this.settings = settings; }

  update(settings) { this.settings = settings; }

  async #fetch(path, opts = {}) {
    const url = this.settings.serverUrl.replace(/\/$/, '') + path;
    const headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + this.settings.token,
      ...(opts.headers ?? {}),
    };
    const res = await fetch(url, { ...opts, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}${text ? ' — ' + text : ''}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  health() { return this.#fetch('/health'); }
  listSessions() { return this.#fetch('/api/sessions'); }
  getSession(id) { return this.#fetch('/api/sessions/' + encodeURIComponent(id)); }
  spawnSession(body) {
    return this.#fetch('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
  }
  sendInput(id, data, enter = true) {
    return this.#fetch('/api/sessions/' + encodeURIComponent(id) + '/input', {
      method: 'POST', body: JSON.stringify({ data, enter }),
    });
  }
  killSession(id) {
    return this.#fetch('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
  }

  wsUrl(id) {
    const base = this.settings.serverUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    return `${base}/ws/sessions/${encodeURIComponent(id)}?token=${encodeURIComponent(this.settings.token)}`;
  }
}

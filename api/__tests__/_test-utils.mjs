/**
 * Shared mock request/response utilities for api/__tests__/*.test.mjs
 */

export function mockReq(opts = {}) {
  return {
    method: opts.method || 'GET',
    query: opts.query || {},
    headers: opts.headers || {},
    body: opts.body,
    url: opts.url || '/',
  };
}

export function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(data) { this.body = data; this.ended = true; return this; },
    send(data) { this.body = data; this.ended = true; return this; },
    end(data) { if (data) this.body = data; this.ended = true; return this; },
  };
  return res;
}

export function mockFetch(responses) {
  // responses: Map<urlPattern, { status, json?, text?, headers? }>
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    for (const [pattern, response] of responses) {
      if (url.includes(pattern)) {
        return {
          ok: (response.status ?? 200) < 400,
          status: response.status ?? 200,
          headers: new Map(Object.entries(response.headers ?? {})),
          async json() { return response.json ?? {}; },
          async text() { return response.text ?? ''; },
        };
      }
    }
    throw new Error(`Unmocked fetch: ${url}`);
  };
  return () => { global.fetch = originalFetch; };
}

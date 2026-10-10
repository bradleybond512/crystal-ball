// This synchronous transaction is called only after authentication and readBody.
// Its sink contains all env writes and credential/cache invalidations.
const MAX_REVISION = 18_446_744_073_709_551_615n;
export function parseRevision(raw) {
  if (typeof raw !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(raw)) return null;
  const revision = BigInt(raw);
  return revision <= MAX_REVISION ? revision : null;
}

export function createSecretUpdateReceiver({ allowedKeys, native, floor, apply }) {
  const seed = native ? parseRevision(floor) : 0n;
  if (seed === null) throw new Error('Invalid native secret revision floor');
  const accepted = new Map();
  return (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { status: 400, body: { error: 'expected { key, value }' } };
    }
    const { key, value, revision: rawRevision } = payload;
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      return { status: 403, body: { error: 'key not in allowlist' } };
    }
    const revision = native ? parseRevision(rawRevision) : null;
    if (native && revision === null) return { status: 400, body: { error: 'invalid revision' } };
    // No await between compare, advance and the entire effects sink. An older
    // body's readBody may finish after a newer update; it must have no effects.
    if (native && revision <= (accepted.get(key) ?? seed)) {
      return { status: 200, body: { ok: true, key } };
    }
    if (native) accepted.set(key, revision);
    apply(key, value);
    return { status: 200, body: { ok: true, key } };
  };
}

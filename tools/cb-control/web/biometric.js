// Biometric unlock via WebAuthn platform authenticator (Face ID / Touch ID).
//
// This is a lightweight client-side gate, not a server-verified auth factor.
// The server still requires a bearer token for every API call. Biometric
// unlock adds a second check: the PWA will not call any write endpoint
// (input, spawn, kill, compose) until a fresh authentication assertion
// is obtained from the phone's secure enclave.
//
// The credential is created on first enablement. The credential ID is
// stored in localStorage; no user handle is sent to the server.
// To revoke: delete the PWA's site data on the phone.
//
// UX:
//   - If biometric is disabled  → this module is a no-op (everything passes)
//   - If biometric is enabled   → require() prompts Face ID and resolves or throws
//   - Successful unlocks cache for UNLOCK_TTL_MS so users aren't re-prompted
//     on every keystroke, only on the first send in a window.

const LS_KEY = 'cb-control:biometric:v1';
const UNLOCK_TTL_MS = 60_000;

const state = { lastUnlockTs: 0 };

function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') ?? { enabled: false, credentialId: null, rpId: location.hostname }; }
  catch { return { enabled: false, credentialId: null, rpId: location.hostname }; }
}
function save(v) { localStorage.setItem(LS_KEY, JSON.stringify(v)); }

function b64urlEncode(buf) {
  const bin = String.fromCharCode(...new Uint8Array(buf));
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b64 = (s + pad).replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function isSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials?.create);
}

export function isEnabled() {
  return load().enabled && !!load().credentialId;
}

export async function enable() {
  if (!isSupported()) throw new Error('Web Authentication not supported on this device.');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'cb-control', id: location.hostname },
      user: { id: userId, name: 'phone', displayName: 'Phone user' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('Registration cancelled.');
  save({ enabled: true, credentialId: b64urlEncode(cred.rawId), rpId: location.hostname });
  state.lastUnlockTs = Date.now();
}

export function disable() {
  save({ enabled: false, credentialId: null, rpId: location.hostname });
  state.lastUnlockTs = 0;
}

/**
 * Require a fresh biometric assertion. No-op if disabled. Throws on cancel.
 * Cached for UNLOCK_TTL_MS.
 */
export async function require(forceFresh = false) {
  const s = load();
  if (!s.enabled || !s.credentialId) return;
  if (!forceFresh && (Date.now() - state.lastUnlockTs) < UNLOCK_TTL_MS) return;
  if (!isSupported()) throw new Error('Biometric enabled but not supported.');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: s.rpId,
      allowCredentials: [{ id: b64urlDecode(s.credentialId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60_000,
    },
  });
  if (!assertion) throw new Error('Biometric unlock cancelled.');
  state.lastUnlockTs = Date.now();
}

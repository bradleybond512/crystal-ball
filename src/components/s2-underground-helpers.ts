/**
 * Pure helpers for S2UndergroundPanel, extracted so the security-critical
 * OAuth message gate is unit-testable without a DOM.
 */

export interface OAuthMessageLike {
  origin: string;
  source: unknown;
  data: unknown;
}

/**
 * Decide whether a postMessage event may carry the Patreon OAuth tokens we
 * persist. A message is trusted only when it comes from our own sidecar
 * origin AND from the exact popup window we opened AND is tagged as the
 * Patreon callback. Any of these failing means a foreign page/frame is
 * posting to us and the message must be ignored — otherwise an attacker
 * could inject an access_token we'd save to the keychain.
 */
export function isTrustedOAuthMessage(
  ev: OAuthMessageLike,
  expectedOrigin: string,
  expectedSource: unknown,
): boolean {
  if (ev.origin !== expectedOrigin) return false;
  if (ev.source !== expectedSource) return false;
  const data = ev.data as { type?: string } | null | undefined;
  return data?.type === 'patreon-oauth';
}

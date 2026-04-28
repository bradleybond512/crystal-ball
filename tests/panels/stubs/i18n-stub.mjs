/**
 * Test-time stub for src/services/i18n.ts. The real module uses Vite's
 * `import.meta.glob`, which is not implemented under tsx. Panels only need
 * the `t()` helper — return the i18n key as the literal string, which is
 * good enough to detect non-empty content during a smoke test.
 */

export function t(key) {
  return key;
}

export async function changeLanguage() {}

export function getCurrentLanguage() {
  return 'en';
}

export function isRTL() {
  return false;
}

export async function ensureLanguageLoaded() {
  return 'en';
}

export const SUPPORTED_LANGUAGES = ['en'];

export default { t };

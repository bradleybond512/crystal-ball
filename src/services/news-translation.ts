 
/* eslint-disable no-console, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-optional-chain, unicorn/prefer-code-point */
/**
 * News Translation Service
 *
 * On-demand per-article translation for headlines in languages other than
 * the user's active UI language. Uses the same LLM provider chain as
 * summarization (Ollama -> Groq -> OpenRouter -> browser T5) and caches
 * translations in a Map + localStorage to avoid repeated LLM calls.
 *
 * Does NOT auto-translate on fetch -- only when the user clicks a
 * "Translate" button on a headline. Caches persist across reloads via
 * localStorage cb-news-translations.
 */

import { generateSummary, translateText } from './summarization';
import { getCurrentLanguage } from './i18n';

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  targetLang: string;
  sourceLang?: string;
  provider: 'ollama' | 'groq' | 'openrouter' | 'browser' | 'cache';
  cachedAt: number;
}

const STORAGE_KEY = 'cb-news-translations';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 500;

// djb2 hash -- deterministic, no crypto import needed
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = Math.trunc(hash); // force 32-bit int
  }
  return (hash >>> 0).toString(36);
}

function cacheKey(originalText: string, targetLang: string): string {
  return `${djb2(originalText)}|${targetLang}`;
}

// In-memory cache keyed by `${djb2(originalText)}|${targetLang}`
const memCache = new Map<string, TranslationResult>();
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, TranslationResult>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.cachedAt === 'number' && now - entry.cachedAt < TTL_MS) {
        memCache.set(key, entry);
      }
    }
  } catch (error) {
    console.warn('[news-translation] hydrate failed', error);
  }
}

function persist(): void {
  try {
    // Trim to MAX_ENTRIES, keep most recent by cachedAt
    if (memCache.size > MAX_ENTRIES) {
      const sorted = [...memCache.entries()].sort((a, b) => b[1].cachedAt - a[1].cachedAt);
      memCache.clear();
      for (const [k, v] of sorted.slice(0, MAX_ENTRIES)) memCache.set(k, v);
    }
    const out: Record<string, TranslationResult> = {};
    for (const [k, v] of memCache.entries()) out[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch (error) {
    console.warn('[news-translation] persist failed', error);
  }
}

export function getCachedTranslation(
  originalText: string,
  targetLang: string,
): TranslationResult | null {
  hydrate();
  const key = cacheKey(originalText, targetLang);
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= TTL_MS) {
    memCache.delete(key);
    return null;
  }
  return entry;
}

export function clearTranslationCache(): void {
  memCache.clear();
  hydrated = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function needsTranslation(
  text: string,
  textLang: string | undefined,
  targetLang?: string,
): boolean {
  if (!text || !textLang) return false;
  const target = targetLang || getCurrentLanguage();
  if (textLang === target) return false;
  if (getCachedTranslation(text, target)) return false;
  return true;
}

export async function translateHeadline(
  originalText: string,
  targetLang?: string,
  sourceLang?: string,
): Promise<TranslationResult | null> {
  if (!originalText || !originalText.trim()) return null;
  const target = targetLang || getCurrentLanguage();
  hydrate();

  // Cache hit
  const cached = getCachedTranslation(originalText, target);
  if (cached) {
    return { ...cached, provider: 'cache' };
  }

  // Try dedicated translate RPC first (summarization.ts translateText uses mode='translate')
  let translated: string | null = null;
  let providerUsed: TranslationResult['provider'] = 'openrouter';
  try {
    translated = await translateText(originalText, target);
  } catch (error) {
    console.warn('[news-translation] translateText failed', error);
  }

  // Fallback: piggyback on generateSummary with a translation prompt as geoContext
  if (!translated) {
    const prompt = `Translate this news headline to ${target}. Preserve proper nouns, country names, and military terminology. Headline:\n\n${originalText}\n\nOutput only the translation, no explanation.`;
    try {
      const result = await generateSummary([originalText, originalText], undefined, prompt, target, {
        skipBrowserFallback: false,
      });
      if (result && result.summary) {
        translated = result.summary.trim();
        providerUsed = result.provider === 'cache' ? 'openrouter' : result.provider;
      }
    } catch (error) {
      console.warn('[news-translation] generateSummary fallback failed', error);
    }
  }

  if (!translated) return null;

  const entry: TranslationResult = {
    originalText,
    translatedText: translated,
    targetLang: target,
    sourceLang,
    provider: providerUsed,
    cachedAt: Date.now(),
  };
  memCache.set(cacheKey(originalText, target), entry);
  persist();
  return entry;
}

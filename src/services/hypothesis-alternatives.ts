import { generateText } from './llm-adapter';
import { sanitizeForPrompt } from '@/utils/prompt-sanitize';
import { isGhostMode } from './mode-manager';
import { isFeatureAvailable } from './runtime-config';
import { signatureFor } from './hypothesis-feedback';
import type { Hypothesis, AnalystSnapshot } from './analyst-loop';

export interface AlternativeView {
  signature: string;
  hypothesisId: string;
  generatedAt: number;
  alternative: string;
  alternativeConfidence: number;
  premortem: string;
}

const ENABLED_KEY = 'crystalball-alternatives-enabled';
const STORAGE_KEY = 'crystalball-hypothesis-alternatives-v1';
const COOLDOWN_MS = 30 * 60 * 1000;
const MAX_PER_CYCLE = 2;
const EVENT_NAME = 'cb:hypothesis-alternatives';

export function isAlternativesEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; }
  catch { return false; }
}

export function setAlternativesEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch { /* ignore */ }
}

const cache = new Map<string, AlternativeView>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, AlternativeView>;
    for (const [k, v] of Object.entries(obj)) cache.set(k, v);
  } catch { /* ignore */ }
}

function save(): void {
  const obj: Record<string, AlternativeView> = {};
  for (const [k, v] of cache) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }
  catch { /* quota */ }
}

export function getAlternativeView(h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>): AlternativeView | null {
  load();
  return cache.get(signatureFor(h)) ?? null;
}

export function getAllAlternativeViews(): AlternativeView[] {
  load();
  return [...cache.values()].sort((a, b) => b.generatedAt - a.generatedAt);
}

export function parseAlternativesResponse(raw: string): Omit<AlternativeView, 'signature' | 'hypothesisId' | 'generatedAt'> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<AlternativeView>;
    if (typeof obj.alternative !== 'string' || typeof obj.premortem !== 'string') return null;
    const conf = typeof obj.alternativeConfidence === 'number' && Number.isFinite(obj.alternativeConfidence)
      ? obj.alternativeConfidence
      : 0;
    return {
      alternative: obj.alternative,
      alternativeConfidence: Math.max(0, Math.min(1, conf)),
      premortem: obj.premortem,
    };
  } catch {
    return null;
  }
}

export function buildAlternativesPrompt(h: Hypothesis): string {
  const evidenceLines = h.evidence
    .slice(0, 8)
    .map(e => `- [${sanitizeForPrompt(e.source, 40)}] ${sanitizeForPrompt(e.label, 200)}`)
    .join('\n');
  return (
    `You are an intelligence analyst running a structured alternatives check.\n` +
    `Primary hypothesis (confidence ${h.confidence.toFixed(2)}): ` +
    `${sanitizeForPrompt(h.statement, 280)}\n\n` +
    `Evidence:\n${evidenceLines || '- (none)'}\n\n` +
    `Respond with ONLY a JSON object, no prose:\n` +
    `{"alternative": "<second-most-likely explanation of the SAME evidence>",\n` +
    ` "alternativeConfidence": <0-1>,\n` +
    ` "premortem": "<single cheapest observable that would falsify the primary hypothesis>"}`
  );
}

const inFlight = new Set<string>();

async function reviewOne(h: Hypothesis): Promise<void> {
  const sig = signatureFor(h);
  if (inFlight.has(sig)) return;
  inFlight.add(sig);
  try {
    const res = await generateText(buildAlternativesPrompt(h), { maxTokens: 300 });
    if (!res.text) throw new Error('empty response');
    const parsed = parseAlternativesResponse(res.text);
    if (!parsed) throw new Error('unparseable response');
    const view: AlternativeView = {
      signature: sig,
      hypothesisId: h.id,
      generatedAt: Date.now(),
      ...parsed,
    };
    cache.set(sig, view);
    save();
    document.dispatchEvent(new CustomEvent<AlternativeView>(EVENT_NAME, { detail: view }));
  } catch {
    // Don't cache failures — cooldown only applies to successful responses
  } finally {
    inFlight.delete(sig);
  }
}

function shouldReview(h: Hypothesis): boolean {
  if (h.risk !== 'critical' && h.risk !== 'high') return false;
  const existing = cache.get(signatureFor(h));
  if (!existing) return true;
  return Date.now() - existing.generatedAt >= COOLDOWN_MS;
}

function handleSnapshot(snapshot: AnalystSnapshot): void {
  if (!isAlternativesEnabled()) return;
  if (isGhostMode()) return;
  if (!isFeatureAvailable('aiClaude')) return;
  const candidates = snapshot.hypotheses.filter(h => shouldReview(h)).slice(0, MAX_PER_CYCLE);
  for (const h of candidates) void reviewOne(h);
}

let started = false;

export function startHypothesisAlternatives(): void {
  if (started) return;
  started = true;
  load();
  document.addEventListener('cb:analyst-hypotheses', (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    handleSnapshot(ce.detail);
  });
}

export function subscribeAlternatives(cb: (view: AlternativeView) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<AlternativeView>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}

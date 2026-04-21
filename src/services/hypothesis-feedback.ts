/**
 * Hypothesis Feedback — thumbs up/down per analyst hypothesis.
 *
 * Works like correlation-feedback.ts but keyed by hypothesis "signature"
 * (kind + sorted evidence source set) so feedback generalizes across
 * successive cycles rather than dying with a specific UUID.
 *
 * Returns a multiplier in [0.5, 1.3] that analyst-loop.ts applies to a
 * hypothesis's confidence before ranking. Reinforces fusion patterns the
 * user finds useful, dampens noise.
 */

import type { Hypothesis } from './analyst-loop';

const STORAGE_KEY = 'crystalball-hypothesis-feedback-v1';
const MIN_SAMPLES = 2;

interface SigStats { up: number; down: number; lastTouched: number; }

const stats = new Map<string, SigStats>();
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, SigStats>;
    for (const [k, v] of Object.entries(obj)) stats.set(k, v);
  } catch { /* noop */ }
}

function save(): void {
  const obj: Record<string, SigStats> = {};
  for (const [k, v] of stats) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* quota */ }
}

/** Build a stable signature from hypothesis kind + sorted evidence sources. */
export function signatureFor(h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>): string {
  const sources = [...new Set(h.evidence.map(e => e.source))].sort((a, b) => a.localeCompare(b)).join(',');
  const region = h.region?.slice(0, 40) ?? '*';
  return `${h.kind}|${sources}|${region}`;
}

export function thumbsUp(h: Hypothesis): void {
  ensureLoaded();
  const key = signatureFor(h);
  const cur = stats.get(key) ?? { up: 0, down: 0, lastTouched: 0 };
  cur.up += 1;
  cur.lastTouched = Date.now();
  stats.set(key, cur);
  save();
  document.dispatchEvent(new CustomEvent<{ key: string }>('cb:hypothesis-feedback', { detail: { key } }));
}

export function thumbsDown(h: Hypothesis): void {
  ensureLoaded();
  const key = signatureFor(h);
  const cur = stats.get(key) ?? { up: 0, down: 0, lastTouched: 0 };
  cur.down += 1;
  cur.lastTouched = Date.now();
  stats.set(key, cur);
  save();
  document.dispatchEvent(new CustomEvent<{ key: string }>('cb:hypothesis-feedback', { detail: { key } }));
}

/** 0.5–1.3 multiplier applied to a hypothesis's confidence. */
export function getHypothesisFeedbackMult(h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>): number {
  ensureLoaded();
  const s = stats.get(signatureFor(h));
  if (!s || s.up + s.down < MIN_SAMPLES) return 1;
  const total = s.up + s.down;
  const upRatio = s.up / total;
  const downRatio = s.down / total;
  return Math.max(0.5, Math.min(1.3, 1 + upRatio * 0.3 - downRatio * 0.5));
}

/** Read-only current stats, for debug/overlay panels. */
export function getFeedbackStats(): Readonly<Record<string, SigStats>> {
  ensureLoaded();
  const out: Record<string, SigStats> = {};
  for (const [k, v] of stats) out[k] = v;
  return out;
}

export function resetHypothesisFeedback(): void {
  ensureLoaded();
  stats.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

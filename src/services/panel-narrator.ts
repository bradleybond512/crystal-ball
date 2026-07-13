/**
 * Panel narrator — periodically asks the local LLM for a 1-line plain-English
 * summary of what's currently visible in each panel. Round-robins so we don't
 * hammer the model. Dispatches `cb:panel-narrative` for Panel.ts to render.
 */

 
import { runIntel } from './intel-provider';

const CYCLE_MS = 60_000;       // tick every minute
const MIN_TEXT_LEN = 40;        // skip panels with no real content
const SKIP_PANELS = new Set([
  'world-map', 'live-news-video', 'satellite-cam', 'webcam-feed',
  'ask-crystal-ball', 'gods-eye', 'gods-vision',
]);

let started = false;
let queue: string[] = [];
let cursor = 0;
const lastByPanel = new Map<string, { text: string; at: number }>();

function buildQueue(): void {
  const tiles = [...document.querySelectorAll<HTMLElement>('#panelsGrid [data-panel], .hs-focus-body [data-panel]')];
  queue = tiles
    .map(t => t.dataset.panel!)
    .filter(id => !SKIP_PANELS.has(id));
}

function extractText(panelId: string): string {
  const el = document.getElementById(`${panelId}Content`);
  if (!el) return '';
  // Use innerText so CSS hidden / display:none branches are excluded.
  return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

async function narrateNext(): Promise<void> {
  if (queue.length === 0) buildQueue();
  if (queue.length === 0) return;
  const panelId = queue[cursor % queue.length]!;
  cursor++;
  const text = extractText(panelId);
  if (text.length < MIN_TEXT_LEN) return;
  // Skip if we just narrated this panel and content hasn't changed much.
  const prev = lastByPanel.get(panelId);
  if (prev && Date.now() - prev.at < 4 * 60_000) return;
  const prompt = `You are a situational analyst. In ONE short sentence (max 18 words), describe what is currently happening in this dashboard panel ("${panelId}"). Be specific and factual. No preamble.\n\nPanel content:\n${text}`;
  try {
    const r = await runIntel(prompt, { maxTokens: 60, temperature: 0.2 });
    const line = r.response.trim().split('\n')[0]?.slice(0, 200) ?? '';
    if (!line) return;
    lastByPanel.set(panelId, { text: line, at: Date.now() });
    document.dispatchEvent(new CustomEvent('cb:panel-narrative', { detail: { panelId, text: line } }));
  } catch { /* local LLM unavailable — silently skip */ }
}

async function narrateDailyRollup(): Promise<void> {
  // One rolling cross-panel summary dispatched to the top-of-app bar.
  const tiles = [...document.querySelectorAll<HTMLElement>('#panelsGrid [data-panel]')];
  const snippets: string[] = [];
  for (const t of tiles.slice(0, 12)) {
    const id = t.dataset.panel!;
    if (SKIP_PANELS.has(id)) continue;
    const txt = extractText(id).slice(0, 300);
    if (txt.length < MIN_TEXT_LEN) continue;
    snippets.push(`[${id}] ${txt}`);
  }
  if (snippets.length === 0) return;
  const prompt = `You are a situational analyst. In 3 short bullets (max 15 words each), summarize the most important cross-panel developments right now. No preamble.\n\n${snippets.join('\n\n').slice(0, 3500)}`;
  try {
    const r = await runIntel(prompt, { maxTokens: 180, temperature: 0.2 });
    const text = r.response.trim();
    if (!text) return;
    document.dispatchEvent(new CustomEvent('cb:daily-rollup', { detail: { text } }));
  } catch { /* noop */ }
}

export function startPanelNarrator(): void {
  if (started) return;
  started = true;
  window.setTimeout(() => { void narrateNext(); }, 15_000);
  window.setInterval(() => { void narrateNext(); }, CYCLE_MS);
  // Daily rollup every 15 minutes
  window.setTimeout(() => { void narrateDailyRollup(); }, 45_000);
  window.setInterval(() => { void narrateDailyRollup(); }, 15 * 60_000);
}

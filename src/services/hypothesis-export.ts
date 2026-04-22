/**
 * Hypothesis Export — build a self-contained markdown bundle for a
 * single hypothesis thread. Includes the statement, evidence, entities,
 * thread history, skeptic note, questions + answers, playbook, and (if
 * available) projection. Copies to clipboard; also fires an event so
 * the HUD can flash a confirmation toast.
 */

import type { Hypothesis } from './analyst-loop';
import { getThreadFor } from './hypothesis-threads';
import { entitiesForHypothesis } from './hypothesis-entities';
import { getSkepticNote } from './hypothesis-skeptic';
import { getCachedAnswer, suggestQuestions } from './question-suggester';
import { getPlaybookFor, summarizePlaybook } from './action-memory';
import { getCachedProjection } from './hypothesis-projection';

const EVENT_COPIED = 'cb:hypothesis-export-copied';

// ── Formatting ───────────────────────────────────────────────────────────────

function fmtPercent(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function fmtTimeAgo(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Sections ─────────────────────────────────────────────────────────────────

function buildHeader(h: Hypothesis): string {
  const thread = getThreadFor(h);
  const parts: string[] = [
    `# Analyst Hypothesis — ${h.kind}`,
    '',
    `**Risk:** ${h.risk}  ·  **Confidence:** ${fmtPercent(h.confidence)}`,
    h.region ? `**Region:** ${h.region}` : '',
    thread && thread.cycleCount > 1
      ? `**Thread:** seen ${thread.cycleCount}× · trajectory ${thread.trajectory} · peak ${thread.peakRisk}`
      : '',
    '',
    `> ${h.statement}`,
    '',
  ];
  return parts.filter(Boolean).join('\n');
}

function buildEntities(h: Hypothesis): string {
  const mentions = entitiesForHypothesis(h.id);
  if (mentions.length === 0) return '';
  const lines = mentions.map(m => `- ${m.kind}: \`${m.entity}\``);
  return `## Entities\n\n${lines.join('\n')}\n\n`;
}

function buildEvidence(h: Hypothesis): string {
  if (h.evidence.length === 0) return '';
  const lines = h.evidence.slice(0, 12).map(e => {
    const panelSuffix = e.panelId ? ` → panel \`${e.panelId}\`` : '';
    return `- [${e.source}] **${e.label}**${panelSuffix}`;
  });
  return `## Evidence\n\n${lines.join('\n')}\n\n`;
}

function buildSkeptic(h: Hypothesis): string {
  const note = getSkepticNote(h);
  if (!note) return '';
  return `## Skeptic\n\n${note.text}\n\n_Generated ${fmtTimeAgo(note.generatedAt)}._\n\n`;
}

function buildQuestions(h: Hypothesis): string {
  const questions = suggestQuestions(h);
  if (questions.length === 0) return '';
  const parts: string[] = ['## Questions'];
  for (const q of questions) {
    parts.push('', `**Q.** ${q}`);
    const a = getCachedAnswer(h, q);
    if (a) parts.push('', `**A.** _[${a.provider}]_ ${a.text}`);
  }
  parts.push('');
  return parts.join('\n');
}

function buildPlaybook(h: Hypothesis): string {
  const book = getPlaybookFor(h);
  if (!book || book.actions.length === 0) return '';
  return `## Playbook\n\n${summarizePlaybook(book)}\n\n`;
}

function buildProjection(h: Hypothesis): string {
  const p = getCachedProjection(h);
  if (!p) return '';
  const out: string[] = [`## Projection (${p.provider})`, '', p.narrative];
  if (p.cascade) {
    out.push('', `**Cascade sim:** ${p.cascade.triggerName} — ${p.cascade.effects.length} effects, recovery ~${p.cascade.estimatedRecoveryHours}h, risk ${p.cascade.riskScore}/100.`);
  }
  out.push('', `_Generated ${fmtTimeAgo(p.generatedAt)}._`, '');
  return out.join('\n');
}

function buildFooter(): string {
  return `---\n_Exported from Crystal Ball at ${new Date().toISOString()}._\n`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Build the full markdown bundle as a string (no clipboard side effect). */
export function buildHypothesisBundle(h: Hypothesis): string {
  return [
    buildHeader(h),
    buildEntities(h),
    buildEvidence(h),
    buildSkeptic(h),
    buildQuestions(h),
    buildPlaybook(h),
    buildProjection(h),
    buildFooter(),
  ].filter(Boolean).join('');
}

/**
 * Build + copy to clipboard. Returns true if the copy succeeded.
 * Dispatches cb:hypothesis-export-copied with { hypothesisId, chars }
 * so the HUD can flash a confirmation.
 */
export async function exportHypothesisToClipboard(h: Hypothesis): Promise<boolean> {
  const markdown = buildHypothesisBundle(h);
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(markdown);
    document.dispatchEvent(new CustomEvent<{ hypothesisId: string; chars: number }>(EVENT_COPIED, {
      detail: { hypothesisId: h.id, chars: markdown.length },
    }));
    return true;
  } catch {
    return false;
  }
}

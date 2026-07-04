/**
 * Ask-the-data view helpers — pure HTML formatting for the Command Center's
 * "Ask the data" section (precedent: forecast-provenance-view.ts).
 *
 * Kept out of CommandCenterPanel so the formatting is unit-testable without
 * the panel's DOM lifecycle.
 */

import { escapeHtml } from '@/utils/sanitize';
import type { AnswerPacket } from '@/services/insights/ask-the-data';

/** Starter chips shown before the user has asked anything. */
export const ASK_SUGGESTED_QUESTIONS: readonly string[] = [
  'Why is risk high right now?',
  'What changed since I last looked?',
  'What should I watch next?',
];

export function buildAskFollowupChipHtml(question: string): string {
  return `<button type="button" data-ask-followup="${escapeHtml(question)}"
    style="flex:0 0 auto;padding:3px 10px;border:1px solid var(--border-subtle,#444);border-radius:999px;background:rgba(255,255,255,0.04);color:inherit;font-size:11px;white-space:nowrap;cursor:pointer;">${escapeHtml(question)}</button>`;
}

export function buildAskAnswerHtml(packet: AnswerPacket): string {
  const evidence = packet.evidence.length === 0
    ? ''
    : `<ul style="list-style:none;margin:6px 0 0 0;padding:0;display:flex;flex-direction:column;gap:3px;">
        ${packet.evidence.slice(0, 6).map((row) => `<li style="font-size:11px;display:flex;gap:6px;align-items:baseline;">
          <strong style="flex:0 0 auto;">${escapeHtml(row.label)}</strong>
          <span style="color:var(--text-secondary,#aaa);">${escapeHtml(row.fact)}</span>
          ${row.confidence !== undefined ? `<span style="margin-left:auto;flex:0 0 auto;font-size:10px;color:var(--text-secondary,#aaa);">${Math.round(row.confidence * 100)}%</span>` : ''}
        </li>`).join('')}
      </ul>`;
  const followUps = packet.followUps.length === 0
    ? ''
    : `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
        ${packet.followUps.slice(0, 4).map((q) => buildAskFollowupChipHtml(q)).join('')}
      </div>`;
  return `<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid var(--accent,#4a9eff);border-radius:4px;background:rgba(74,158,255,0.06);">
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;">${escapeHtml(packet.intent.replace(/_/g, ' '))}</div>
    <div style="font-size:12px;margin-top:4px;">${escapeHtml(packet.answer)}</div>
    ${evidence}
    ${followUps}
  </div>`;
}

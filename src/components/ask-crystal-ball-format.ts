/**
 * Formats an ask-the-data AnswerPacket into a plain-text chat bubble body:
 * the deterministic answer, an "Evidence:" section (one bullet per row),
 * and a "You might ask next:" section (one bullet per follow-up).
 *
 * Pure — no DOM, fetch, or state.
 */

import type { AnswerPacket } from '@/services/insights/ask-the-data';

export function formatAnswerForChat(packet: AnswerPacket): string {
  const parts: string[] = [packet.answer];
  if (packet.evidence.length > 0) {
    parts.push('', 'Evidence:', ...packet.evidence.map((e) => `• ${e.label}: ${e.fact}`));
  }
  if (packet.followUps.length > 0) {
    parts.push('', 'You might ask next:', ...packet.followUps.map((q) => `• ${q}`));
  }
  return parts.join('\n');
}

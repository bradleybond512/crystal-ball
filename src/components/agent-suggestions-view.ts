/**
 * Analyst HUD section for pending agent suggestions (R4-SEC-004).
 *
 * External agents can propose hypothesis feedback or a dismissal over MCP;
 * nothing applies until the user presses Confirm. Every field is set with
 * textContent (never innerHTML), and the agent's note is labelled as
 * unverified, because both the note and the hypothesis statement can carry
 * feed text an attacker wrote.
 *
 * Buttons carry data-agent-suggestion-action / data-agent-suggestion-id and
 * are handled by the HUD's delegated root click listener, so a background
 * re-render between pointerdown and pointerup cannot orphan them.
 */

import type { AgentSuggestion, AgentSuggestionKind } from '@/services/agent-suggestions';
import { formatDurationMinutes } from '@/utils/format-duration';

export const AGENT_SUGGESTION_ACTION_ATTR = 'data-agent-suggestion-action';
export const AGENT_SUGGESTION_ID_ATTR = 'data-agent-suggestion-id';
export type AgentSuggestionAction = 'confirm' | 'discard';

export const AGENT_SUGGESTION_LABELS: Readonly<Record<AgentSuggestionKind, string>> = {
  thumbs_up: 'Mark useful (raises its ranking)',
  thumbs_down: 'Mark as noise (lowers its ranking)',
  dismiss: 'Hide this hypothesis for 24 hours',
};

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function actionButton(action: AgentSuggestionAction, suggestion: AgentSuggestion, label: string): HTMLButtonElement {
  const btn = textElement('button', `analyst-hud-agent-suggestion-${action}`, label);
  btn.type = 'button';
  btn.dataset.agentSuggestionAction = action;
  btn.dataset.agentSuggestionId = suggestion.id;
  btn.setAttribute('aria-label', `${label}: ${AGENT_SUGGESTION_LABELS[suggestion.kind]}`);
  return btn;
}

function buildRow(suggestion: AgentSuggestion, now: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'analyst-hud-agent-suggestion';
  row.dataset.agentSuggestionKind = suggestion.kind;

  row.append(textElement('div', 'analyst-hud-agent-suggestion-kind', AGENT_SUGGESTION_LABELS[suggestion.kind]));
  row.append(textElement('div', 'analyst-hud-agent-suggestion-statement', suggestion.statement || '(no statement)'));
  if (suggestion.note) {
    row.append(textElement('div', 'analyst-hud-agent-suggestion-note', `Agent note (unverified): ${suggestion.note}`));
  }
  const ageMinutes = Math.max(0, (now - suggestion.receivedAt) / 60_000);
  row.append(textElement(
    'div',
    'analyst-hud-agent-suggestion-meta',
    `From an external agent, ${formatDurationMinutes(ageMinutes)} ago. Nothing changes until you confirm.`,
  ));

  const actions = document.createElement('div');
  actions.className = 'analyst-hud-agent-suggestion-actions';
  actions.append(actionButton('confirm', suggestion, 'Confirm'), actionButton('discard', suggestion, 'Discard'));
  row.append(actions);
  return row;
}

/** The section, or null when nothing is pending (the HUD then omits it). */
export function buildAgentSuggestionsSection(suggestions: readonly AgentSuggestion[], now: number): HTMLElement | null {
  if (suggestions.length === 0) return null;
  const sec = document.createElement('section');
  sec.className = 'analyst-hud-section analyst-hud-agent-suggestions';
  sec.setAttribute('aria-label', 'Agent suggestions awaiting confirmation');
  sec.append(textElement('h3', '', `Agent suggestions (${suggestions.length})`));
  for (const suggestion of suggestions) sec.append(buildRow(suggestion, now));
  return sec;
}

/** Read the delegated action from a click target, if it is one of these buttons. */
export function agentSuggestionActionFrom(target: Element): { action: AgentSuggestionAction; id: string } | null {
  const btn = target.closest?.<HTMLElement>(`[${AGENT_SUGGESTION_ACTION_ATTR}]`);
  const action = btn?.dataset.agentSuggestionAction;
  const id = btn?.dataset.agentSuggestionId;
  if (!id || (action !== 'confirm' && action !== 'discard')) return null;
  return { action, id };
}

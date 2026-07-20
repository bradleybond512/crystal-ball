/**
 * Ask Crystal Ball — Conversational AI Intelligence Panel
 *
 * Chat-style panel that lets users ask questions about the current
 * global situation. Recognized diagnostic questions are answered
 * deterministically (via ask-the-data) before falling back to Claude
 * Agent (primary) with Ollama fallback for unknown-intent questions.
 */

import { Panel } from './Panel';
import {
  sendMessage,
  getHistory,
  recordExchange,
  QUICK_ASK_PRESETS,
} from '@/services/crystal-ball-chat';
import { escapeHtml as esc } from '@/utils/sanitize';
import { answer, classifyIntent } from '@/services/insights/ask-the-data';
import type { AskContext } from '@/services/insights/ask-the-data';
import { getLiveDiagnosticsSnapshot } from '@/services/diagnostics/live-diagnostics-snapshot';
import { contextFromSnapshots } from '@/services/diagnostics/system-health';
import { getFeatureHealthRegistry } from '@/services/diagnostics/diagnostics-state';
import { formatAnswerForChat } from './ask-crystal-ball-format';

const BUBBLE_BASE = 'max-width:85%;padding:0.45rem 0.65rem;border-radius:10px;font-size:0.73rem;line-height:1.45;white-space:pre-wrap;word-break:break-word;';
const BUBBLE_USER = `${BUBBLE_BASE}background:rgba(59,130,246,0.25);color:rgba(200,220,255,0.95);border-bottom-right-radius:3px;`;
const BUBBLE_ASSISTANT = `${BUBBLE_BASE}background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.85);border-bottom-left-radius:3px;`;

function injectDotsStyle(): void {
  if (document.getElementById('awm-dots-style')) return;
  const style = document.createElement('style');
  style.id = 'awm-dots-style';
  style.textContent = [
 '.awm-dots span { animation: awm-dot-fade 1.4s ease-in-out infinite; }',
 '.awm-dots span:nth-child(1) { animation-delay: 0s; }',
 '.awm-dots span:nth-child(2) { animation-delay: 0.2s; }',
 '.awm-dots span:nth-child(3) { animation-delay: 0.4s; }',
 '@keyframes awm-dot-fade { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }',
  ].join('\n');
  document.head.append(style);
}

export class AskCrystalBallPanel extends Panel {
  private chatContainer: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLElement | null = null;
  private abortChat: AbortController | null = null;
  private isGenerating = false;

  constructor() {
 super({ id: 'ask-crystal-ball', title: 'Ask Crystal Ball' });
 this._renderChatUI();
  }

  // ── UI construction ──────────────────────────────────────────────────────

  private _renderChatUI(): void {
 const el = this.getContentElement();

 el.innerHTML = `
<div style="display:flex;flex-direction:column;height:100%;min-height:280px;font-size:0.78rem;">
  <div class="awm-messages" style="flex:1;overflow-y:auto;padding:0.6rem;display:flex;flex-direction:column;gap:0.5rem;">
  </div>
  <div class="awm-presets" style="padding:0.4rem 0.6rem 0;display:flex;flex-wrap:wrap;gap:0.3rem;">
  </div>
  <div class="awm-input-bar" style="display:flex;gap:0.4rem;padding:0.5rem 0.6rem;border-top:1px solid rgba(255,255,255,0.08);align-items:flex-end;">
 <textarea class="awm-input" rows="1" placeholder="Ask about the current situation..."
 style="flex:1;resize:none;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:0.45rem 0.6rem;color:inherit;font-size:0.75rem;font-family:inherit;line-height:1.4;max-height:80px;overflow-y:auto;"></textarea>
 <button class="awm-send" style="padding:0.4rem 0.7rem;background:rgba(59,130,246,0.8);color:#fff;border:none;border-radius:6px;font-size:0.72rem;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;line-height:1.4;" title="Send message">Send</button>
  </div>
</div>`;

 this.chatContainer = el.querySelector('.awm-messages');
 this.inputEl = el.querySelector('.awm-input');
 this.sendBtn = el.querySelector('.awm-send');

 this.sendBtn?.addEventListener('click', () => { void this._handleSend(); });

 this.inputEl?.addEventListener('keydown', (e: KeyboardEvent) => {
 if (e.key === 'Enter' && !e.shiftKey) {
 e.preventDefault();
 void this._handleSend();
 }
 });

 this.inputEl?.addEventListener('input', () => {
 if (!this.inputEl) return;
 this.inputEl.style.height = 'auto';
 this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 80)}px`;
 });

 this._renderPresetsOrHistory();
  }

  private _renderPresetsOrHistory(): void {
 const history = getHistory();
 if (history.length === 0) {
 this._showPresets();
 return;
 }
 this._hidePresets();
 for (const msg of history) {
 this._appendMessageBubble(msg.role, msg.content);
 }
 this._scrollToBottom();
  }

  private _showPresets(): void {
 const presetsEl = this.getContentElement().querySelector('.awm-presets') as HTMLElement | null;
 if (!presetsEl) return;
 presetsEl.style.display = 'flex';
 presetsEl.innerHTML = QUICK_ASK_PRESETS.map(
 q => `<button class="awm-preset-btn" style="padding:0.3rem 0.55rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:rgba(255,255,255,0.7);font-size:0.65rem;cursor:pointer;transition:background 0.15s;">${esc(q)}</button>`,
 ).join('');

 presetsEl.querySelectorAll('.awm-preset-btn').forEach((btn, i) => {
 btn.addEventListener('click', () => {
 const preset = QUICK_ASK_PRESETS[i];
 if (preset && this.inputEl) {
 this.inputEl.value = preset;
 void this._handleSend();
 }
 });
 });
  }

  private _hidePresets(): void {
 const presetsEl = this.getContentElement().querySelector('.awm-presets') as HTMLElement | null;
 if (presetsEl) presetsEl.style.display = 'none';
  }

  // ── Message rendering ──────────────────────────────────────────────────

  private _appendMessageBubble(role: 'user' | 'assistant', content: string): HTMLElement {
 const container = this.chatContainer ?? this.getContentElement();

 const wrapper = document.createElement('div');
 const align = role === 'user' ? 'flex-end' : 'flex-start';
 wrapper.style.cssText = `display:flex;justify-content:${align};`;

 const bubble = document.createElement('div');
 bubble.style.cssText = role === 'user' ? BUBBLE_USER : BUBBLE_ASSISTANT;
 bubble.textContent = content;

 wrapper.append(bubble);
 container.append(wrapper);
 return bubble;
  }

  private _appendThinkingIndicator(): { wrapper: HTMLElement; bubble: HTMLElement } {
 const container = this.chatContainer ?? this.getContentElement();
 injectDotsStyle();

 const wrapper = document.createElement('div');
 wrapper.style.cssText = 'display:flex;justify-content:flex-start;';
 wrapper.className = 'awm-thinking';

 const bubble = document.createElement('div');
 bubble.style.cssText = `${BUBBLE_ASSISTANT}color:rgba(255,255,255,0.45);`;
 bubble.innerHTML = '<span class="awm-dots">thinking<span>.</span><span>.</span><span>.</span></span>';

 wrapper.append(bubble);
 container.append(wrapper);
 this._scrollToBottom();
 return { wrapper, bubble };
  }

  private _scrollToBottom(): void {
 if (this.chatContainer) {
 this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
 }
  }

  // ── Send handling ─────────────────────────────────────────────────────

  private _buildAskContext(): AskContext {
 const snapshot = getLiveDiagnosticsSnapshot();
 const panels = snapshot.panels;
 const ctx = contextFromSnapshots({ panels, sources: snapshot.sources, providers: snapshot.providers });
 const features = getFeatureHealthRegistry().all(ctx);
 return { features, panels };
  }

  private async _handleSend(): Promise<void> {
 if (!this.inputEl || this.isGenerating) return;

 const text = this.inputEl.value.trim();
 if (!text) return;

 this.inputEl.value = '';
 this.inputEl.style.height = 'auto';
 this._hidePresets();
 this._appendMessageBubble('user', text);
 this._scrollToBottom();

 const intent = classifyIntent(text);
 if (intent !== 'unknown') {
 try {
 const packet = answer(text, this._buildAskContext());
 const formatted = formatAnswerForChat(packet);
 this._appendMessageBubble('assistant', formatted);
 recordExchange(text, formatted);
 this._scrollToBottom();
 return;
 } catch {
 // fall through to the LLM path if the deterministic answer can't be built
 }
 }

 const { wrapper: thinkingWrapper } = this._appendThinkingIndicator();
 this._startGenerating();

 try {
 await this._streamResponse(text, thinkingWrapper);
 } catch (error) {
 thinkingWrapper.remove();
 this._handleStreamError(error);
 } finally {
 this._stopGenerating();
 }
  }

  private async _streamResponse(text: string, thinkingWrapper: HTMLElement): Promise<void> {
 let responseBubble: HTMLElement | null = null;
 let accumulated = '';

 for await (const chunk of sendMessage(text, this.abortChat?.signal)) {
 if (!responseBubble) {
 thinkingWrapper.remove();
 responseBubble = this._appendMessageBubble('assistant', '');
 }
 accumulated += chunk;
 responseBubble.textContent = accumulated;
 this._scrollToBottom();
 }

 if (!responseBubble) {
 thinkingWrapper.remove();
 this._appendMessageBubble('assistant', 'No response received. Check your AI configuration in Settings.');
 }
  }

  private _handleStreamError(error: unknown): void {
 const isAbort = error instanceof DOMException && error.name === 'AbortError';
 if (isAbort) return;
 const errMsg = error instanceof Error ? error.message : 'An error occurred';
 this._appendMessageBubble('assistant', `Error: ${errMsg}`);
  }

  private _startGenerating(): void {
 this.isGenerating = true;
 this.abortChat = new AbortController();
 this._updateSendButton();
  }

  private _stopGenerating(): void {
 this.isGenerating = false;
 this.abortChat = null;
 this._updateSendButton();
 this._scrollToBottom();
  }

  private _updateSendButton(): void {
 if (!this.sendBtn) return;
 if (this.isGenerating) {
 this.sendBtn.textContent = 'Stop';
 this.sendBtn.style.background = 'rgba(239,68,68,0.7)';
 this.sendBtn.onclick = () => { this.abortChat?.abort(); };
 } else {
 this.sendBtn.textContent = 'Send';
 this.sendBtn.style.background = 'rgba(59,130,246,0.8)';
 this.sendBtn.onclick = () => { void this._handleSend(); };
 }
  }

  /** No-op: chat panel is interactive, not data-driven. */
  update(_data: unknown): void {
 // Conversation state is managed internally.
  }

  override destroy(): void {
 this.abortChat?.abort();
 this.abortChat = null;
 super.destroy();
  }
}

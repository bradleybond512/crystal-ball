/**
 * Intelligence Briefing Panel
 *
 * Displays AI-generated intelligence briefings with structured sections:
 * Executive Summary, Active Threats, Escalation Watch, Economic Outlook,
 * Recommended Actions, and 24h Forecast.
 *
 * Auto-generates on first load if no cached briefing exists.
 * Falls back gracefully when no AI provider is configured.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  generateBriefing,
  getCachedBriefing,
  subscribeBriefing,
} from '@/services/intelligence-briefing';
import type {
  IntelligenceBriefing,
  BriefingSection,
  BriefingItem,
  BriefingProvider,
  ThreatSeverity,
} from '@/services/intelligence-briefing';

// ── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<ThreatSeverity, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  info: '#3b82f6',
};

const SECTION_ICONS: Record<string, string> = {
  'executive-summary': '\u{1F4CB}', // clipboard
  'active-threats': '\u26A0\uFE0F', // warning
  'escalation-watch': '\u{1F525}', // fire
  'economic-outlook': '\u{1F4C8}', // chart
  'recommended-actions': '\u{1F6E1}', // shield
  '24h-forecast': '\u{1F52E}', // crystal ball
};

const PROVIDER_LABELS: Record<BriefingProvider, { label: string; color: string }> = {
  claude: { label: 'Claude', color: '#c084fc' },
  ollama: { label: 'Ollama', color: '#22c55e' },
  groq: { label: 'Groq', color: '#f97316' },
  openrouter: { label: 'OpenRouter', color: '#3b82f6' },
  browser: { label: 'Browser T5', color: '#888' },
};

// ── Panel ────────────────────────────────────────────────────────────────────

export class IntelligenceBriefingPanel extends Panel {
  private readonly _unsub: () => void;
  private _collapsedSections = new Set<string>();
  private _loading = false;
  private _error: string | null = null;

  constructor() {
 super({
 id: 'intelligence-briefing',
 title: 'Intelligence Briefing',
 });

 this._unsub = subscribeBriefing(() => this.render());

 // Auto-generate on first load if no cached briefing
 const cached = getCachedBriefing();
 if (cached) {
 this.render();
 } else {
 this.renderEmpty();
 }
  }

  override destroy(): void {
 this._unsub();
 super.destroy();
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  private async handleGenerate(): Promise<void> {
 if (this._loading) return;
 this._loading = true;
 this._error = null;
 this.renderLoading();

 try {
 await generateBriefing();
 this.render();
 } catch (error) {
 this._error = error instanceof Error ? error.message : 'Failed to generate briefing';
 this.renderError();
 } finally {
 this._loading = false;
 }
  }

  // ── Render States ───────────────────────────────────────────────────────

  private renderEmpty(): void {
 const el = this.getContentElement();
 el.innerHTML = '';

 const container = document.createElement('div');
 container.style.cssText = 'padding:1rem;text-align:center;';

 const icon = document.createElement('div');
 icon.style.cssText = 'font-size:2.5rem;margin-bottom:0.75rem;opacity:0.7;';
 icon.textContent = '\u{1F4CB}'; // clipboard
 container.append(icon);

 const desc = document.createElement('div');
 desc.style.cssText = 'font-size:0.8rem;opacity:0.7;margin-bottom:1rem;line-height:1.4;';
 desc.textContent = 'Generate an AI-powered intelligence briefing from all active data sources — situations, alerts, threat forecasts, and economic indicators.';
 container.append(desc);

 container.append(this.createGenerateButton('Generate Briefing'));

 const hint = document.createElement('div');
 hint.style.cssText = 'font-size:0.68rem;opacity:0.5;margin-top:0.75rem;line-height:1.3;';
 hint.textContent = 'Requires Claude API key, Ollama, Groq, or OpenRouter. Configure in Settings > API Keys.';
 container.append(hint);

 el.append(container);
  }

  private renderLoading(): void {
 const el = this.getContentElement();
 el.innerHTML = '';

 const container = document.createElement('div');
 container.style.cssText = 'padding:1.5rem;text-align:center;';

 const spinner = document.createElement('div');
 spinner.className = 'ib-spinner';
 spinner.style.cssText = 'width:28px;height:28px;border:3px solid rgba(255,255,255,0.15);border-top-color:rgba(255,255,255,0.7);border-radius:50%;animation:ib-spin 0.8s linear infinite;margin:0 auto 0.75rem;';
 container.append(spinner);

 const msg = document.createElement('div');
 msg.style.cssText = 'font-size:0.78rem;opacity:0.7;';
 msg.textContent = 'Generating intelligence briefing...';
 container.append(msg);

 const sub = document.createElement('div');
 sub.style.cssText = 'font-size:0.68rem;opacity:0.45;margin-top:0.4rem;';
 sub.textContent = 'Collecting signals and synthesizing analysis';
 container.append(sub);

 el.append(container);
 this.ensureSpinnerStyle();
  }

  private renderError(): void {
 const el = this.getContentElement();
 el.innerHTML = '';

 const container = document.createElement('div');
 container.style.cssText = 'padding:1rem;text-align:center;';

 const errIcon = document.createElement('div');
 errIcon.style.cssText = 'font-size:1.5rem;margin-bottom:0.5rem;';
 errIcon.textContent = '\u26A0\uFE0F'; // warning
 container.append(errIcon);

 const msg = document.createElement('div');
 msg.style.cssText = 'font-size:0.78rem;color:#ef4444;margin-bottom:0.75rem;line-height:1.3;';
 msg.textContent = this._error ?? 'Failed to generate briefing';
 container.append(msg);

 container.append(this.createGenerateButton('Retry'));

 el.append(container);
  }

  // ── Main Render ─────────────────────────────────────────────────────────

  private render(): void {
 const briefing = getCachedBriefing();
 if (!briefing) {
 this.renderEmpty();
 return;
 }

 const el = this.getContentElement();
 el.innerHTML = '';

 const wrapper = document.createElement('div');
 wrapper.className = 'ib-wrapper';
 wrapper.style.cssText = 'display:flex;flex-direction:column;gap:0;';

 // Header bar with timestamp + provider + refresh
 wrapper.append(this.renderHeader(briefing));

 // Sections
 for (const section of briefing.sections) {
 wrapper.append(this.renderSection(section));
 }

 el.append(wrapper);
  }

  private renderHeader(briefing: IntelligenceBriefing): HTMLElement {
 const header = document.createElement('div');
 header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.08);gap:0.5rem;flex-wrap:wrap;';

 // Left: timestamp
 const ts = document.createElement('span');
 ts.style.cssText = 'font-size:0.68rem;opacity:0.55;';
 ts.textContent = this.formatTimestamp(briefing.generatedAt);
 header.append(ts);

 // Right: provider badge + refresh button
 const right = document.createElement('div');
 right.style.cssText = 'display:flex;align-items:center;gap:0.4rem;';

 const providerInfo = PROVIDER_LABELS[briefing.provider];
 if (providerInfo) {
 const badge = document.createElement('span');
 badge.style.cssText = `font-size:0.62rem;padding:0.15rem 0.4rem;border-radius:3px;background:${providerInfo.color}22;color:${providerInfo.color};border:1px solid ${providerInfo.color}44;`;
 badge.textContent = providerInfo.label;
 right.append(badge);
 }

 const refreshBtn = document.createElement('button');
 refreshBtn.style.cssText = 'background:none;border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:0.2rem 0.5rem;font-size:0.68rem;color:inherit;cursor:pointer;opacity:0.7;transition:opacity 0.15s;';
 refreshBtn.textContent = '\u21BB Refresh'; // recycle symbol
 refreshBtn.addEventListener('mouseenter', () => { refreshBtn.style.opacity = '1'; });
 refreshBtn.addEventListener('mouseleave', () => { refreshBtn.style.opacity = '0.7'; });
 refreshBtn.addEventListener('click', () => { void this.handleGenerate(); });
 right.append(refreshBtn);

 header.append(right);
 return header;
  }

  private renderSection(section: BriefingSection): HTMLElement {
 const container = document.createElement('div');
 container.className = `ib-section ib-section-${section.type}`;
 container.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.06);';

 const isCollapsed = this._collapsedSections.has(section.type);
 const isExecSummary = section.type === 'executive-summary';

 // Section header (collapsible, except exec summary is always visible)
 const sectionHeader = document.createElement('div');
 sectionHeader.style.cssText = 'display:flex;align-items:center;gap:0.4rem;padding:0.5rem 0.6rem;cursor:pointer;user-select:none;transition:background 0.15s;';
 sectionHeader.addEventListener('mouseenter', () => { sectionHeader.style.background = 'rgba(255,255,255,0.04)'; });
 sectionHeader.addEventListener('mouseleave', () => { sectionHeader.style.background = 'transparent'; });

 // Collapse arrow (not for exec summary)
 if (!isExecSummary) {
 const arrow = document.createElement('span');
 arrow.style.cssText = `font-size:0.6rem;opacity:0.5;transition:transform 0.15s;transform:rotate(${isCollapsed ? '0deg' : '90deg'});`;
 arrow.textContent = '\u25B6'; // right-pointing triangle
 sectionHeader.append(arrow);
 }

 // Section icon
 const sectionIcon = document.createElement('span');
 sectionIcon.style.cssText = 'font-size:0.85rem;';
 sectionIcon.textContent = SECTION_ICONS[section.type] ?? '\u{1F4CB}';
 sectionHeader.append(sectionIcon);

 // Section title
 const title = document.createElement('span');
 title.style.cssText = 'font-size:0.75rem;font-weight:600;flex:1;';
 title.textContent = section.title;
 sectionHeader.append(title);

 // Severity indicator
 if (section.severity) {
 const sevDot = document.createElement('span');
 sevDot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${SEVERITY_COLORS[section.severity]};box-shadow:0 0 4px ${SEVERITY_COLORS[section.severity]};flex-shrink:0;`;
 sectionHeader.append(sevDot);
 }

 if (!isExecSummary) {
 sectionHeader.addEventListener('click', () => {
 if (this._collapsedSections.has(section.type)) {
 this._collapsedSections.delete(section.type);
 } else {
 this._collapsedSections.add(section.type);
 }
 this.render();
 });
 }
 container.append(sectionHeader);

 // Section body
 if (!isCollapsed || isExecSummary) {
 const body = document.createElement('div');
 body.style.cssText = 'padding:0 0.6rem 0.6rem;font-size:0.73rem;line-height:1.5;opacity:0.85;';

 // Render items if present (active threats)
 if (section.items && section.items.length > 0) {
 for (const item of section.items) {
 body.append(this.renderBriefingItem(item));
 }
 }

 // Render markdown-like content
 if (section.content) {
 const contentEl = document.createElement('div');
 contentEl.className = 'ib-content';
 contentEl.innerHTML = this.renderMarkdown(section.content);
 body.append(contentEl);
 }

 container.append(body);
 }

 return container;
  }

  private renderBriefingItem(item: BriefingItem): HTMLElement {
 const el = document.createElement('div');
 el.style.cssText = 'display:flex;align-items:flex-start;gap:0.4rem;padding:0.25rem 0;';

 if (item.severity) {
 const badge = document.createElement('span');
 const color = SEVERITY_COLORS[item.severity];
 badge.style.cssText = `font-size:0.6rem;padding:0.1rem 0.3rem;border-radius:2px;background:${color}22;color:${color};border:1px solid ${color}44;font-weight:600;flex-shrink:0;margin-top:0.1rem;`;
 badge.textContent = item.severity.toUpperCase();
 el.append(badge);
 }

 const text = document.createElement('div');
 text.style.cssText = 'flex:1;';

 if (item.title) {
 const titleSpan = document.createElement('span');
 titleSpan.style.cssText = 'font-weight:600;';
 titleSpan.textContent = item.title;
 text.append(titleSpan);
 }

 if (item.detail) {
 const detailSpan = document.createElement('span');
 detailSpan.style.cssText = 'opacity:0.8;';
 detailSpan.textContent = item.title ? ` ${item.detail}` : item.detail;
 text.append(detailSpan);
 }

 el.append(text);
 return el;
  }

  // ── Utilities ──────────────────────────────────────────────────────────

  private createGenerateButton(label: string): HTMLElement {
 const btn = document.createElement('button');
 btn.style.cssText = 'background:rgba(192,132,252,0.15);border:1px solid rgba(192,132,252,0.3);border-radius:6px;padding:0.5rem 1.2rem;font-size:0.78rem;color:#c084fc;cursor:pointer;transition:background 0.15s;';
 btn.textContent = label;
 btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(192,132,252,0.25)'; });
 btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(192,132,252,0.15)'; });
 btn.addEventListener('click', () => { void this.handleGenerate(); });
 return btn;
  }

  private renderMarkdown(text: string): string {
 // Simple markdown-like rendering for briefing content
 // Process line-by-line to avoid complex regex backtracking
 const escaped = this.esc(text);
 const lines = escaped.split('\n');
 const rendered = lines.map(line => {
 // Bold
 let processed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
 // Italic
 processed = processed.replace(/\*(.*?)\*/g, '<em>$1</em>');
 // List items
 if (/^[-*]\s+/.test(processed)) {
 const content = processed.replace(/^[-*]\s+/, '');
 return `<div style="padding-left:0.8rem;position:relative;margin:0.15rem 0;"><span style="position:absolute;left:0;opacity:0.4;">\u2022</span>${content}</div>`;
 }
 return processed;
 });
 return rendered.join('<br>').replace(/(<br>){3,}/g, '<br><br>');
  }

  private esc(s: string): string {
 return escapeHtml(s);
  }

  private formatTimestamp(ts: number): string {
 const d = new Date(ts);
 const now = Date.now();
 const diff = now - ts;

 const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

 if (diff < 60_000) return `Generated just now`;
 if (diff < 3_600_000) return `Generated ${Math.round(diff / 60_000)}m ago at ${timeStr}`;
 if (diff < 86_400_000) return `Generated ${Math.round(diff / 3_600_000)}h ago at ${timeStr}`;
 return `Generated ${d.toLocaleDateString()} at ${timeStr}`;
  }

  private ensureSpinnerStyle(): void {
 if (document.getElementById('ib-spinner-style')) return;
 const style = document.createElement('style');
 style.id = 'ib-spinner-style';
 style.textContent = '@keyframes ib-spin { to { transform: rotate(360deg); } }';
 document.head.append(style);
  }
}

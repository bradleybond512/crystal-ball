/**
 * ScenarioSimulatorPanel
 *
 * What-if cascading impact analysis panel. Users enter a hypothetical premise
 * (or choose a preset) and the system projects cascading effects across
 * military, economic, infrastructure, humanitarian, cyber, and supply-chain
 * domains with a timeline visualization.
 */
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { h, safeHtml, replaceChildren } from '@/utils/dom-utils';
import {
  simulateScenario,
  getCachedSimulations,
  PRESET_SCENARIOS,
  type ScenarioResult,
  type DomainImpact,
  type TimelineEvent,
} from '@/services/scenario-simulator';
import type { ScenarioSeverity } from '@/services/situation-types';

// ── Severity styling ─────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<ScenarioSeverity, string> = {
  catastrophic: '#dc2626',
  severe: '#ea580c',
  moderate: '#ca8a04',
  minor: '#16a34a',
  positive: '#2563eb',
};

const SEVERITY_LABELS: Record<ScenarioSeverity, string> = {
  catastrophic: 'Catastrophic',
  severe: 'Severe',
  moderate: 'Moderate',
  minor: 'Minor',
  positive: 'Positive',
};

function domainSeverityColor(severity: number): string {
  if (severity >= 0.8) return SEVERITY_COLORS.catastrophic;
  if (severity >= 0.6) return SEVERITY_COLORS.severe;
  if (severity >= 0.4) return SEVERITY_COLORS.moderate;
  return SEVERITY_COLORS.minor;
}

function domainLabel(domain: string): string {
  const labels: Record<string, string> = {
 military: 'Military',
 economic: 'Economic',
 infrastructure: 'Infrastructure',
 humanitarian: 'Humanitarian',
 cyber: 'Cyber',
 supply_chain: 'Supply Chain',
  };
  return labels[domain] ?? domain;
}

function domainIcon(domain: string): string {
  const icons: Record<string, string> = {
 military: '\u{2694}\u{FE0F}', // crossed swords
 economic: '\u{1F4C9}', // chart decreasing
 infrastructure: '\u{1F3D7}\u{FE0F}', // building construction
 humanitarian: '\u{1F6D1}', // stop sign (aid)
 cyber: '\u{1F512}', // lock
 supply_chain: '\u{1F6A2}', // ship
  };
  return icons[domain] ?? '\u{26A0}\u{FE0F}';
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours}h`;
  if (hours < 168) return `${Math.round(hours / 24)}d`;
  return `${Math.round(hours / 168)}w`;
}

// ── Panel ────────────────────────────────────────────────────────────────────

export class ScenarioSimulatorPanel extends Panel {
  private abortCtrl: AbortController | null = null;
  private inputEl: HTMLInputElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private historySelect: HTMLSelectElement | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'scenario-simulator',
 title: 'Scenario Simulator',
 showCount: false,
 trackActivity: true,
 infoTooltip:
 'What-if analysis engine. Enter a hypothetical scenario and see projected cascading ' +
 'effects across military, economic, infrastructure, humanitarian, cyber, and supply-chain ' +
 'domains with a probability-weighted timeline.',
 });

 this.buildUI();
  }

  // ── UI Construction ──────────────────────────────────────────────────────

  private buildUI(): void {
 // Preset chips
 const presetsEl = h('div', { className: 'scenario-presets' },
 ...PRESET_SCENARIOS.map(preset =>
 h('button', {
 className: 'scenario-preset-chip',
 title: preset,
 onClick: () => void this.submit(preset),
 }, preset),
 ),
 );

 // Input form
 this.inputEl = h('input', {
 type: 'text',
 className: 'scenario-input',
 placeholder: 'Describe a what-if scenario...',
 maxlength: '500',
 }) as HTMLInputElement;

 this.submitBtn = h('button', {
 className: 'scenario-submit-btn',
 title: 'Simulate scenario',
 onClick: () => this.submit(this.inputEl?.value ?? ''),
 }, 'Simulate') as HTMLButtonElement;

 const formEl = h('form', {
 className: 'scenario-form',
 onSubmit: (e: Event) => { e.preventDefault(); this.submit(this.inputEl?.value ?? ''); },
 },
 this.inputEl,
 this.submitBtn,
 );

 // History dropdown
 this.historySelect = h('select', {
 className: 'scenario-history-select',
 onChange: () => this.loadFromHistory(),
 }) as HTMLSelectElement;
 this.refreshHistoryDropdown();

 const historyRow = h('div', { className: 'scenario-history-row' },
 h('span', { className: 'scenario-history-label' }, 'Previous:'),
 this.historySelect,
 );

 // Loading indicator
 this.loadingEl = h('div', { className: 'scenario-loading scenario-loading--hidden' },
 h('span', { className: 'scenario-loading-text' }, 'Simulating...'),
 h('span', { className: 'scenario-loading-elapsed' }, ''),
 );

 // Results container
 this.resultsEl = h('div', { className: 'scenario-results' });

 // Assemble
 const wrapper = h('div', { className: 'scenario-wrapper' },
 presetsEl,
 formEl,
 historyRow,
 this.loadingEl,
 this.resultsEl,
 );

 this.content.innerHTML = '';
 this.content.append(wrapper);
  }

  // ── Submission ─────────────────────────────────────────────────────────────

  private async submit(rawPremise: string): Promise<void> {
 const premise = rawPremise.trim().slice(0, 500);
 if (!premise) return;

 // Abort any in-flight simulation
 if (this.abortCtrl) {
 this.abortCtrl.abort();
 }

 if (this.inputEl) this.inputEl.value = '';
 this.setUILoading(true);

 this.abortCtrl = new AbortController();

 try {
 const result = await simulateScenario(premise, this.abortCtrl.signal);
 this.renderResult(result);
 this.refreshHistoryDropdown();
 } catch (error: unknown) {
 if ((error as Error).name === 'AbortError') return;
 this.renderError((error as Error).message || 'Simulation failed');
 } finally {
 this.setUILoading(false);
 }
  }

  // ── Loading State ──────────────────────────────────────────────────────────

  private setUILoading(loading: boolean): void {
 if (this.submitBtn) {
 this.submitBtn.disabled = loading;
 this.submitBtn.textContent = loading ? 'Simulating...' : 'Simulate';
 }
 if (this.inputEl) this.inputEl.disabled = loading;

 if (loading) {
 this.loadingEl?.classList.remove('scenario-loading--hidden');
 const startTime = Date.now();
 const elapsedEl = this.loadingEl?.querySelector('.scenario-loading-elapsed');
 this.elapsedTimer = setInterval(() => {
 const seconds = Math.floor((Date.now() - startTime) / 1000);
 if (elapsedEl) elapsedEl.textContent = `${seconds}s`;
 }, 1000);
 } else {
 this.loadingEl?.classList.add('scenario-loading--hidden');
 if (this.elapsedTimer) {
 clearInterval(this.elapsedTimer);
 this.elapsedTimer = null;
 }
 }
  }

  // ── History ────────────────────────────────────────────────────────────────

  private refreshHistoryDropdown(): void {
 if (!this.historySelect) return;
 const cached = getCachedSimulations();

 // Clear existing options
 this.historySelect.innerHTML = '';

 const suffix = cached.length === 1 ? '' : 's';
 const placeholderText = cached.length > 0
 ? `${cached.length} saved simulation${suffix}`
 : 'No previous simulations';
 const placeholder = h('option', { value: '' }, placeholderText) as HTMLOptionElement;
 placeholder.disabled = true;
 placeholder.selected = true;
 this.historySelect.append(placeholder);

 for (const [i, entry] of cached.entries()) {
 if (!entry) continue;
 const date = new Date(entry.generatedAt);
 const label = `${entry.premise.slice(0, 40)}${entry.premise.length > 40 ? '...' : ''} (${date.toLocaleDateString()})`;
 const opt = h('option', { value: String(i) }, label) as HTMLOptionElement;
 this.historySelect.append(opt);
 }

 // Show/hide entire history row based on cache contents
 const historyRow = this.historySelect.closest('.scenario-history-row');
 if (historyRow instanceof HTMLElement) {
 historyRow.style.display = cached.length > 0 ? '' : 'none';
 }
  }

  private loadFromHistory(): void {
 if (!this.historySelect) return;
 const idx = Number(this.historySelect.value);
 if (Number.isNaN(idx)) return;

 const cached = getCachedSimulations();
 const entry = cached[idx];
 if (entry) {
 this.renderResult(entry);
 }

 // Reset dropdown to placeholder
 this.historySelect.selectedIndex = 0;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private renderResult(result: ScenarioResult): void {
 if (!this.resultsEl) return;

 const html = `
 <div class="scenario-result">
 ${this.renderHeader(result)}
 ${this.renderImpacts(result.impacts)}
 ${this.renderTimeline(result.timeline)}
 ${this.renderPersonalImpact(result.personalImpact)}
 ${this.renderPreparations(result.recommendedPreparations)}
 ${this.renderMeta(result)}
 </div>
 `;

 replaceChildren(this.resultsEl, safeHtml(html));
  }

  private renderHeader(result: ScenarioResult): string {
 const severityColor = SEVERITY_COLORS[result.overallSeverity] ?? SEVERITY_COLORS.moderate;
 const severityLabel = SEVERITY_LABELS[result.overallSeverity] ?? 'Moderate';

 return `
 <div class="scenario-header">
 <div class="scenario-premise">${escapeHtml(result.premise)}</div>
 <div class="scenario-severity-row">
 <span class="scenario-severity-badge" style="background:${severityColor}">
 ${escapeHtml(severityLabel)}
 </span>
 <span class="scenario-source-badge">${result.source === 'claude' ? 'AI Analysis' : 'Template Projection'}</span>
 </div>
 <div class="scenario-probability">${escapeHtml(result.probabilityAssessment)}</div>
 </div>
 `;
  }

  private renderImpacts(impacts: DomainImpact[]): string {
 if (impacts.length === 0) return '';

 const sorted = [...impacts].sort((a, b) => b.severity - a.severity);
 const cards = sorted
 .map(impact => {
 const color = domainSeverityColor(impact.severity);
 const pct = Math.round(impact.severity * 100);
 const cascades = impact.cascadeEffects
 .map(eff => `<li>${escapeHtml(eff)}</li>`)
 .join('');

 return `
 <div class="scenario-impact-card" style="border-left: 3px solid ${color}">
 <div class="scenario-impact-header">
 <span class="scenario-impact-icon">${domainIcon(impact.domain)}</span>
 <span class="scenario-impact-domain">${escapeHtml(domainLabel(impact.domain))}</span>
 <span class="scenario-impact-severity" style="color:${color}">${pct}%</span>
 </div>
 <div class="scenario-impact-desc">${escapeHtml(impact.description)}</div>
 ${cascades ? `<ul class="scenario-cascade-list">${cascades}</ul>` : ''}
 </div>
 `;
 })
 .join('');

 return `
 <div class="scenario-section">
 <div class="scenario-section-title">Domain Impacts</div>
 <div class="scenario-impacts-grid">${cards}</div>
 </div>
 `;
  }

  private renderTimeline(timeline: TimelineEvent[]): string {
 if (timeline.length === 0) return '';

 const events = timeline.map(evt => {
 const probPct = Math.round(evt.probability * 100);
 const barWidth = Math.max(5, probPct);

 return `
 <div class="scenario-timeline-event">
 <div class="scenario-timeline-marker">
 <span class="scenario-timeline-hours">${escapeHtml(formatHours(evt.hours))}</span>
 </div>
 <div class="scenario-timeline-content">
 <div class="scenario-timeline-text">${escapeHtml(evt.event)}</div>
 <div class="scenario-timeline-bar-row">
 <div class="scenario-timeline-bar" style="width:${barWidth}%"></div>
 <span class="scenario-timeline-prob">${probPct}%</span>
 </div>
 </div>
 </div>
 `;
 }).join('');

 return `
 <div class="scenario-section">
 <div class="scenario-section-title">Timeline</div>
 <div class="scenario-timeline">${events}</div>
 </div>
 `;
  }

  private renderPersonalImpact(text: string): string {
 if (!text) return '';
 return `
 <div class="scenario-section">
 <div class="scenario-section-title">Personal Impact</div>
 <div class="scenario-personal-impact">${escapeHtml(text)}</div>
 </div>
 `;
  }

  private renderPreparations(preparations: string[]): string {
 if (preparations.length === 0) return '';
 const items = preparations.map(p => `<li>${escapeHtml(p)}</li>`).join('');
 return `
 <div class="scenario-section">
 <div class="scenario-section-title">Recommended Preparations</div>
 <ul class="scenario-preparations-list">${items}</ul>
 </div>
 `;
  }

  private renderMeta(result: ScenarioResult): string {
 const date = new Date(result.generatedAt);
 const timeStr = date.toLocaleString([], {
 month: 'short', day: 'numeric',
 hour: '2-digit', minute: '2-digit',
 });
 return `
 <div class="scenario-meta">
 Generated ${escapeHtml(timeStr)} via ${result.source === 'claude' ? 'Claude AI' : 'template engine'}
 </div>
 `;
  }

  private renderError(message: string): void {
 if (!this.resultsEl) return;
 const html = `
 <div class="scenario-error">
 <strong>Simulation failed</strong>: ${escapeHtml(message)}
 </div>
 `;
 replaceChildren(this.resultsEl, safeHtml(html));
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  override destroy(): void {
 this.abortCtrl?.abort();
 if (this.elapsedTimer) {
 clearInterval(this.elapsedTimer);
 this.elapsedTimer = null;
 }
 super.destroy();
  }
}

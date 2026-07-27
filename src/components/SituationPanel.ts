/**
 * Situation Awareness Panel
 *
 * Displays active Situations — correlated clusters of weak signals that
 * describe unfolding real-world events. Each situation shows:
 *  - Phase badge (emerging/developing/active/de-escalating)
 *  - Domain icon and title
 *  - Contributing signal count + confidence bar
 *  - Projected scenarios with probability bars
 *  - Personalized action cards with urgency indicators
 */

import { Panel } from './Panel';
import { situationEngine } from '@/services/situation-engine';
import type {
  Situation,
  SituationPhase,
  Scenario,
  ActionCard,
  ActionUrgency,
  SituationDomain,
  SituationSignalSnapshot,
  ScenarioSeverity,
  VerificationDetails,
  VerificationVerdict,
} from '@/services/situation-types';

// ── Constants ────────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<SituationPhase, string> = {
  emerging: 'EMERGING',
  developing: 'DEVELOPING',
  active: 'ACTIVE',
  'de-escalating': 'DE-ESC',
  resolved: 'RESOLVED',
};

const PHASE_COLORS: Record<SituationPhase, string> = {
  emerging:        'var(--severity-info)',
  developing:      'var(--severity-medium)',
  active:          'var(--severity-high)',
  'de-escalating': 'var(--severity-low)',
  resolved:        'var(--severity-ok)',
};

const DOMAIN_ICONS: Record<SituationDomain, string> = {
  military: '\u2694', // ⚔
  economic: '\u{1F4C8}', // 📈
  natural_hazard: '\u26A0', // ⚠
  cyber: '\u{1F6E1}', // 🛡
  infrastructure: '\u26A1', // ⚡
  health: '\u{1F3E5}', // 🏥
  civil_unrest: '\u{1F4E2}', // 📢
  compound: '\u{1F310}', // 🌐
};

const URGENCY_COLORS: Record<ActionUrgency, string> = {
  immediate: 'var(--severity-critical)',
  soon:      'var(--severity-high)',
  monitor:   'var(--severity-low)',
  fyi:       'var(--severity-info)',
};

const SEVERITY_COLORS: Record<ScenarioSeverity, string> = {
  catastrophic: 'var(--severity-critical)',
  severe:       'var(--severity-high)',
  moderate:     'var(--severity-medium)',
  minor:        'var(--severity-low)',
  positive:     'var(--severity-ok)',
};

const DOMAIN_COLORS: Record<SituationDomain, string> = {
  military:       'var(--severity-critical)',
  economic:       'var(--severity-medium)',
  natural_hazard: 'var(--severity-ok)',
  cyber:          'var(--domain-cyber)',
  infrastructure: 'var(--domain-infrastructure)',
  health:         'var(--domain-biosurveillance)',
  civil_unrest:   'var(--severity-high)',
  compound:       'var(--severity-low)',
};

const VERIFICATION_BADGE: Record<VerificationVerdict, { icon: string; color: string; label: string }> = {
  verified:    { icon: '\u2713', color: 'var(--severity-ok)',       label: 'Verified' },
  likely:      { icon: '~',      color: 'var(--severity-medium)',   label: 'Likely' },
  unverified:  { icon: '?',      color: 'var(--severity-info)',     label: 'Unverified' },
  contradicted:{ icon: '\u26A0', color: 'var(--severity-critical)', label: 'Contradicted' },
};

// ── Panel ────────────────────────────────────────────────────────────────────

export class SituationPanel extends Panel {
  private readonly _unsub: () => void;
  private _expandedSitId: string | null = null;

  constructor() {
 super({
 id: 'situation-awareness',
 title: 'Situation Awareness',
 showCount: true,
 className: 'sit-panel',
 });

 this._unsub = situationEngine.subscribe(() => this.render());
 situationEngine.start();

 // Delegate every card interaction onto the stable content root. render()
 // rebuilds the card list (innerHTML='') on each engine notify (signal
 // ingestion + 5-min reassess), so a listener bound to a per-render button
 // would be torn down between pointerdown and pointerup and the click
 // swallowed. The content root is created once by Panel and never replaced.
 this.getContentElement()?.addEventListener('click', (e) => this.handleContentClick(e), { signal: this.signal });

 this.render();
  }

  override destroy(): void {
 this._unsub();
 situationEngine.stop();
 super.destroy();
  }

  /**
   * One delegated click handler for the whole card list. Because render()
   * rebuilds every card on each engine notify, state is re-resolved by id at
   * event time rather than captured in a per-render closure.
   */
  private handleContentClick(e: Event): void {
 const target = e.target as HTMLElement;
 const card = target.closest<HTMLElement>('.sit-card');
 const sitId = card?.dataset.sitId;
 if (!sitId) return;
 // Most-specific controls first — they previously stopped propagation to
 // beat the header toggle; this ordering reproduces that precedence.
 if (target.closest('.sit-map-btn')) {
 e.stopPropagation();
 const sit = situationEngine.getSituations().find(s => s.id === sitId);
 if (sit) this.focusOnMap(sit);
 return;
 }
 const dismiss = target.closest<HTMLElement>('.sit-act-dismiss');
 if (dismiss) {
 e.stopPropagation();
 const sit = situationEngine.getSituations().find(s => s.id === sitId);
 const act = sit?.actions.find(a => a.id === dismiss.dataset.actId);
 if (act) { act.dismissed = true; this.render(); }
 return;
 }
 if (target.closest('.sit-verif-badge')) {
 e.stopPropagation();
 this._expandedSitId = this._expandedSitId === sitId ? null : sitId;
 this.render();
 return;
 }
 if (target.closest('.sit-header')) {
 this._expandedSitId = this._expandedSitId === sitId ? null : sitId;
 this.render();
 }
  }

  private render(): void {
 const el = this.getContentElement();
 if (!el) return;

 const situations = situationEngine.getSituations();
 if (this.countEl) this.countEl.textContent = String(situationEngine.getActiveCount());

 if (situations.length === 0) {
 el.innerHTML = '<div class="sit-empty">No active situations. Signals are being monitored.</div>';
 return;
 }

 const frag = document.createDocumentFragment();

 for (const sit of situations) {
 const card = this.renderSituation(sit);
 frag.append(card);
 }

 el.innerHTML = '';
 el.append(frag);
  }

  private renderSituation(sit: Situation): HTMLElement {
 const card = document.createElement('div');
 card.className = `sit-card sit-phase-${sit.phase}`;
 card.dataset.sitId = sit.id;

 const isExpanded = this._expandedSitId === sit.id;

 // Header row
 const header = document.createElement('div');
 header.className = 'sit-header';
 header.innerHTML = `
 <span class="sit-domain-icon">${DOMAIN_ICONS[sit.domain]}</span>
 <span class="sit-title">${this.esc(sit.title)}</span>
 <span class="sit-phase-badge" style="background:${PHASE_COLORS[sit.phase]}">${PHASE_LABELS[sit.phase]}</span>
 `;

 // "Show on Map" button
 if (sit.geo.lat !== 0 || sit.geo.lon !== 0) {
 const mapBtn = document.createElement('button');
 mapBtn.className = 'sit-map-btn';
 mapBtn.title = 'Show on map';
 mapBtn.textContent = '\u{1F5FA}\uFE0F'; // 🗺️
 header.append(mapBtn);
 }

 card.append(header);

 // Confidence bar + verification badge
 const confRow = document.createElement('div');
 confRow.className = 'sit-conf-row';

 const confBar = document.createElement('div');
 confBar.className = 'sit-conf-bar';
 confBar.innerHTML = `
 <div class="sit-conf-fill" style="width:${Math.round(sit.confidence * 100)}%;background:${PHASE_COLORS[sit.phase]}"></div>
 <span class="sit-conf-label">${Math.round(sit.confidence * 100)}% · ${sit.signals.length} signals · ${sit.domainDiversity} domain${sit.domainDiversity === 1 ? '' : 's'}</span>
 `;
 confRow.append(confBar);

 // Verification badge
 const vd = sit.verificationDetails;
 if (vd) {
 const badge = VERIFICATION_BADGE[vd.overallVerdict];
 const badgeEl = document.createElement('span');
 badgeEl.className = `sit-verif-badge sit-verif-${vd.overallVerdict}`;
 badgeEl.style.color = badge.color;
 badgeEl.style.borderColor = badge.color;
 badgeEl.textContent = `${badge.icon} ${badge.label}`;
 badgeEl.title = this.verificationTooltip(vd);
 confRow.append(badgeEl);
 }

 card.append(confRow);

 // Summary
 const summary = document.createElement('div');
 summary.className = 'sit-summary';
 summary.textContent = sit.summary;
 card.append(summary);

 if (isExpanded) {
 this.renderExpandedDetails(sit, card);
 }

 return card;
  }

  /** Render the expanded detail sections (geo, timeline, scenarios, actions, signals, verification, evidence) */
  private renderExpandedDetails(sit: Situation, card: HTMLElement): void {
 if (sit.geo.label) {
 const geo = document.createElement('div');
 geo.className = 'sit-geo';
 const countrySuffix = sit.geo.countries.length > 0 ? ' (' + sit.geo.countries.join(', ') + ')' : '';
 geo.textContent = '\u{1F4CD} ' + sit.geo.label + countrySuffix;
 card.append(geo);
 }

 // Timeline visualization
 if (sit.signals.length >= 2) {
 card.append(this.renderTimeline(sit));
 }

 if (sit.scenarios.length > 0) {
 const scenSection = document.createElement('div');
 scenSection.className = 'sit-scenarios';
 scenSection.innerHTML = '<div class="sit-section-title">Projected Scenarios</div>';
 for (const sc of sit.scenarios) {
 scenSection.append(this.renderScenario(sc));
 }
 card.append(scenSection);
 }

 // Action cards
 if (sit.actions.length > 0) {
 const actSection = document.createElement('div');
 actSection.className = 'sit-actions';
 actSection.innerHTML = '<div class="sit-section-title">Recommended Actions</div>';
 for (const ac of sit.actions.filter(a => !a.dismissed)) {
 actSection.append(this.renderAction(ac));
 }
 card.append(actSection);
 }

 // Contributing signals
 this.renderSignalsList(sit.signals, card);

 // Verification breakdown
 if (sit.verificationDetails) {
 card.append(this.renderVerificationBreakdown(sit.verificationDetails));
 }

 // Evidence verdict
 if (sit.evidence) {
 const evid = document.createElement('div');
 evid.className = 'sit-evidence sit-ev-' + sit.evidence.verdict;
 evid.innerHTML = [
 '<span class="sit-ev-verdict">' + sit.evidence.verdict.toUpperCase() + '</span>',
 '<span class="sit-ev-reason">' + this.esc(sit.evidence.confidenceReason) + '</span>',
 '<span class="sit-ev-action">Action: ' + sit.evidence.actionThreshold + '</span>',
 ].join('');
 card.append(evid);
 }
  }

  /** Render the contributing signals list into the card */
  private renderSignalsList(signals: SituationSignalSnapshot[], card: HTMLElement): void {
 if (signals.length === 0) return;
 const sigSection = document.createElement('div');
 sigSection.className = 'sit-signals-list';
 sigSection.innerHTML = '<div class="sit-section-title">Contributing Signals</div>';
 for (const sig of signals.slice(0, 8)) {
 const sigEl = document.createElement('div');
 sigEl.className = 'sit-signal-item';
 sigEl.innerHTML = [
 '<span class="sit-sig-type">' + this.esc(sig.type) + '</span>',
 '<span class="sit-sig-conf">' + Math.round(sig.confidence * 100) + '%</span>',
 '<span class="sit-sig-time">' + this.relTime(sig.timestamp) + '</span>',
 ].join('');
 sigSection.append(sigEl);
 }
 card.append(sigSection);
  }

  private renderScenario(sc: Scenario): HTMLElement {
 const el = document.createElement('div');
 el.className = 'sit-scenario';
 el.innerHTML = `
 <div class="sit-sc-header">
 <span class="sit-sc-label">${this.esc(sc.label)}</span>
 <span class="sit-sc-prob" style="color:${SEVERITY_COLORS[sc.severity]}">${Math.round(sc.probability * 100)}%</span>
 </div>
 <div class="sit-sc-bar">
 <div class="sit-sc-fill" style="width:${Math.round(sc.probability * 100)}%;background:${SEVERITY_COLORS[sc.severity]}"></div>
 </div>
 <div class="sit-sc-desc">${this.esc(sc.description)}</div>
 <div class="sit-sc-horizon">${sc.horizonHours}h horizon · ${sc.severity}</div>
 `;
 return el;
  }

  private renderAction(ac: ActionCard): HTMLElement {
 const el = document.createElement('div');
 el.className = `sit-action sit-act-${ac.urgency}`;
 el.innerHTML = `
 <div class="sit-act-header">
 <span class="sit-act-urgency" style="background:${URGENCY_COLORS[ac.urgency]}">${ac.urgency.toUpperCase()}</span>
 <span class="sit-act-headline">${this.esc(ac.headline)}</span>
 </div>
 <div class="sit-act-rationale">${this.esc(ac.rationale)}</div>
 <ul class="sit-act-steps">${ac.steps.map(s => `<li>${this.esc(s)}</li>`).join('')}</ul>
 `;

 // Dismiss button
 const dismissBtn = document.createElement('button');
 dismissBtn.className = 'sit-act-dismiss';
 dismissBtn.textContent = 'Dismiss';
 dismissBtn.dataset.actId = ac.id;
 el.append(dismissBtn);

 return el;
  }

  // ── Timeline + Map ─────────────────────────────────────────────────────

  private renderTimeline(sit: Situation): HTMLElement {
 const container = document.createElement('div');
 container.className = 'sit-timeline';

 const signals = [...sit.signals].sort((a, b) => a.timestamp - b.timestamp);
 const now = Date.now();
 const oldest = signals[0]!.timestamp;
 const timeSpan = Math.max(now - oldest, 60_000);

 const svgW = 260;
 const svgH = 60;
 const padX = 8;
 const padY = 6;
 const plotW = svgW - padX * 2;
 const plotH = svgH - padY * 2;

 const tx = (ts: number): number => padX + ((ts - oldest) / timeSpan) * plotW;
 const ty = (conf: number): number => padY + (1 - conf) * plotH;

 let svg = `<svg class="sit-timeline-svg" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none">`;
 svg += `<line x1="${padX}" y1="${ty(0.5)}" x2="${svgW - padX}" y2="${ty(0.5)}" stroke="#222" stroke-width="0.5" stroke-dasharray="2,2"/>`;

 if (signals.length >= 2) {
 const points = signals.map(s => `${tx(s.timestamp)},${ty(s.confidence)}`).join(' ');
 svg += `<polyline points="${points}" fill="none" stroke="${PHASE_COLORS[sit.phase]}" stroke-width="1.5" stroke-opacity="0.6" stroke-linejoin="round"/>`;
 }

 const thresholds = [0.35, 0.6];
 for (let i = 1; i < signals.length; i++) {
 const prev = signals[i - 1]!.confidence;
 const curr = signals[i]!.confidence;
 for (const th of thresholds) {
 if ((prev < th && curr >= th) || (prev >= th && curr < th)) {
 const x = tx(signals[i]!.timestamp);
 svg += `<line x1="${x}" y1="${padY}" x2="${x}" y2="${svgH - padY}" stroke="#555" stroke-width="1" stroke-dasharray="3,2"/>`;
 }
 }
 }

 for (const sig of signals) {
 const cx = tx(sig.timestamp);
 const cy = ty(sig.confidence);
 const color = DOMAIN_COLORS[sig.domain] ?? '#888';
 svg += `<circle cx="${cx}" cy="${cy}" r="3" fill="${color}" stroke="#000" stroke-width="0.5" opacity="0.9">`;
 svg += `<title>${this.esc(sig.type)} (${Math.round(sig.confidence * 100)}%) - ${this.relTime(sig.timestamp)}</title>`;
 svg += `</circle>`;
 }

 svg += `</svg>`;
 container.innerHTML = svg;

 const label = document.createElement('div');
 label.className = 'sit-timeline-label';
 label.textContent = `${signals.length} signal${signals.length === 1 ? '' : 's'} over ${this.formatDuration(timeSpan)}`;
 container.append(label);

 return container;
  }

  private focusOnMap(sit: Situation): void {
 document.dispatchEvent(new CustomEvent('wm:focus-situation', {
 detail: {
 situationId: sit.id,
 center: { lat: sit.geo.lat, lon: sit.geo.lon },
 signals: sit.signals.map(s => ({ id: s.id, type: s.type, domain: s.domain })),
 },
 }));
  }

  private formatDuration(ms: number): string {
 const totalMin = Math.round(ms / 60_000);
 if (totalMin < 60) return `${totalMin}m`;
 const h = Math.floor(totalMin / 60);
 const m = totalMin % 60;
 if (m === 0) return `${h}h`;
 return `${h}h ${m}m`;
  }

  // ── Verification helpers ────────────────────────────────────────────

  private verificationTooltip(vd: VerificationDetails): string {
 const lines: string[] = [
 `Sources: ${vd.independentSources} independent`,
 `Temporal corroboration: ${vd.temporalCorroboration ? 'yes' : 'no'}`,
 `Cross-domain: ${vd.crossDomainVerified ? 'yes' : 'no'}`,
 `Contradictions: ${vd.hasContradictions ? 'YES' : 'none'}`,
 `Freshness: ${Math.round(vd.freshnessScore * 100)}%`,
 ];
 return lines.join('\n');
  }

  private renderVerificationBreakdown(vd: VerificationDetails): HTMLElement {
 const badge = VERIFICATION_BADGE[vd.overallVerdict];
 const el = document.createElement('div');
 el.className = 'sit-verif-breakdown';
 el.innerHTML = `
 <div class="sit-section-title">Verification Breakdown</div>
 <div class="sit-verif-grid">
 <div class="sit-verif-item">
 <span class="sit-verif-metric">${vd.independentSources}</span>
 <span class="sit-verif-desc">Independent sources${vd.independentSources >= 3 ? ' \u2713' : ''}</span>
 </div>
 <div class="sit-verif-item">
 <span class="sit-verif-metric" style="color:${vd.temporalCorroboration ? '#5cb85c' : '#888'}">${vd.temporalCorroboration ? 'Yes' : 'No'}</span>
 <span class="sit-verif-desc">Temporal corroboration</span>
 </div>
 <div class="sit-verif-item">
 <span class="sit-verif-metric" style="color:${vd.crossDomainVerified ? '#5cb85c' : '#888'}">${vd.crossDomainVerified ? 'Yes' : 'No'}</span>
 <span class="sit-verif-desc">Cross-domain verified</span>
 </div>
 <div class="sit-verif-item">
 <span class="sit-verif-metric" style="color:${vd.hasContradictions ? '#d9534f' : '#5cb85c'}">${vd.hasContradictions ? 'Yes' : 'None'}</span>
 <span class="sit-verif-desc">Contradictions</span>
 </div>
 <div class="sit-verif-item">
 <span class="sit-verif-metric">${Math.round(vd.freshnessScore * 100)}%</span>
 <span class="sit-verif-desc">Freshness</span>
 </div>
 <div class="sit-verif-item">
 <span class="sit-verif-metric" style="color:${badge.color}">${badge.icon} ${badge.label}</span>
 <span class="sit-verif-desc">Overall verdict</span>
 </div>
 </div>
 `;
 return el;
  }

  // ── Utilities ──────────────────────────────────────────────────────────

  private esc(s: string): string {
 const el = document.createElement('span');
 el.textContent = s;
 return el.innerHTML;
  }

  private relTime(ts: number): string {
 const diff = Date.now() - ts;
 if (diff < 60_000) return 'just now';
 if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
 if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
 return `${Math.round(diff / 86_400_000)}d ago`;
  }
}

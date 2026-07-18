/**
 * Escalation Forecast Panel
 *
 * Dashboard of 9 military theater cards showing escalation scores (0-100),
 * trend arrows, estimated days to conflict, and contributing factors.
 * Cards are sorted by score (highest first). Click to expand details
 * including factor breakdown and 30-point sparkline history.
 *
 * A "Global Tension Index" banner sits at the top.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getEscalationForecasts,
  getTheaterHistory,
  getGlobalTensionIndex,
  subscribeEscalation,
  type EscalationForecast,
  type EscalationFactor,
  type ScorePoint,
} from '@/services/escalation-forecast';

function ensureEscStyles(): void {
  if (document.getElementById('esc-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'esc-panel-styles';
  style.textContent = `
 .esc-panel { display:flex; flex-direction:column; gap:8px; padding:4px 0; }
 .esc-global-index { border:1px solid; border-radius:6px; padding:8px 12px; margin-bottom:4px; }
 .esc-gti-header { display:flex; align-items:center; gap:8px; }
 .esc-gti-label { font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; opacity:0.7; }
 .esc-gti-value { font-size:1.4rem; font-weight:700; font-variant-numeric:tabular-nums; }
 .esc-gti-level { font-size:0.7rem; font-weight:600; text-transform:uppercase; }
 .esc-gti-bar { height:4px; background:var(--bg-tertiary,#333); border-radius:2px; margin-top:4px; }
 .esc-gti-fill { height:100%; border-radius:2px; transition:width 0.5s; }
 .esc-gti-counts { display:flex; gap:8px; margin-top:4px; font-size:0.7rem; }
 .esc-gti-badge { font-weight:600; }
 .esc-grid { display:flex; flex-direction:column; gap:6px; }
 .esc-card { border-radius:6px; padding:8px 10px; cursor:pointer;
 background:var(--bg-secondary,#1a1a2e); transition:background 0.15s; }
 .esc-card:hover { background:var(--bg-tertiary,#252540); }
 .esc-card-expanded { background:var(--bg-tertiary,#252540); }
 .esc-card-header { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
 .esc-card-title { display:flex; flex-direction:column; }
 .esc-theater-name { font-weight:600; font-size:0.85rem; }
 .esc-region-tag { font-size:0.65rem; opacity:0.5; text-transform:uppercase; letter-spacing:0.04em; }
 .esc-card-metrics { display:flex; align-items:center; gap:6px; }
 .esc-gauge { display:flex; align-items:center; gap:4px; }
 .esc-gauge-bar { width:60px; height:6px; background:var(--bg-tertiary,#333); border-radius:3px; overflow:hidden; }
 .esc-gauge-fill { height:100%; border-radius:3px; transition:width 0.5s; }
 .esc-gauge-value { font-size:0.85rem; font-weight:700; font-variant-numeric:tabular-nums; min-width:24px; text-align:right; }
 .esc-days { font-size:0.75rem; font-weight:600; font-variant-numeric:tabular-nums; }
 .esc-days-stable { color:#9ca3af; }
 .esc-card-summary { display:flex; align-items:center; gap:8px; margin-top:4px; }
 .esc-level-badge { font-size:0.6rem; font-weight:700; padding:1px 6px; border-radius:3px; text-transform:uppercase; letter-spacing:0.03em; }
 .esc-top-factor { font-size:0.7rem; opacity:0.6; }
 .esc-expanded { margin-top:8px; padding-top:8px; border-top:1px solid var(--border-color,#333); }
 .esc-section-title { font-size:0.7rem; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; opacity:0.6; margin:6px 0 4px; }
 .esc-factor-row { margin-bottom:6px; }
 .esc-factor-header { display:flex; align-items:center; gap:6px; font-size:0.75rem; }
 .esc-factor-name { flex:1; }
 .esc-factor-weight { opacity:0.5; font-size:0.65rem; }
 .esc-factor-score { font-weight:600; font-variant-numeric:tabular-nums; min-width:20px; text-align:right; }
 .esc-factor-bar-bg { height:3px; background:var(--bg-tertiary,#333); border-radius:2px; margin:2px 0; }
 .esc-factor-bar { height:100%; border-radius:2px; }
 .esc-factor-detail { font-size:0.65rem; opacity:0.5; }
 .esc-sparkline { width:100%; height:40px; display:block; }
 .esc-sparkline-empty { font-size:0.7rem; opacity:0.4; padding:8px 0; }
 .esc-empty { text-align:center; opacity:0.5; padding:24px 0; font-size:0.85rem; }
  `;
  document.head.append(style);
}

export class EscalationForecastPanel extends Panel {
  private expandedTheaterId: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
 super({
 id: 'escalation-forecast',
 title: 'Escalation Watch',
 showCount: true,
 trackActivity: true,
 });
 this.init();
  }

  private init(): void {
 this.showLoading();
 this.unsubscribe = subscribeEscalation(() => this.render());
 // Initial render with whatever data exists
 this.render();
  }

  override destroy(): void {
 if (this.unsubscribe) {
 this.unsubscribe();
 this.unsubscribe = null;
 }
 super.destroy();
  }

  // ── Color helpers ─────────────────────────────────────────────────────

  private scoreColor(score: number): string {
 if (score >= 80) return '#ef4444'; // red
 if (score >= 60) return '#f97316'; // orange
 if (score >= 40) return '#eab308'; // yellow
 if (score >= 20) return '#84cc16'; // lime
 return '#22c55e'; // green
  }

  private scoreLabel(score: number): string {
 if (score >= 80) return 'CRITICAL';
 if (score >= 60) return 'HIGH';
 if (score >= 40) return 'ELEVATED';
 if (score >= 20) return 'GUARDED';
 return 'STABLE';
  }

  private trendArrow(trend: EscalationForecast['trend']): string {
 switch (trend) {
 case 'rising': { return '<span style="color:#ef4444" title="Rising">&#x2191;</span>';
 }
 case 'falling': { return '<span style="color:#22c55e" title="Falling">&#x2193;</span>';
 }
 case 'stable': { return '<span style="color:#9ca3af" title="Stable">&#x2192;</span>';
 }
 }
  }

  // ── Sparkline SVG ─────────────────────────────────────────────────────

  private renderSparkline(points: ScorePoint[]): string {
 if (points.length < 2) {
 return '<div class="esc-sparkline-empty">Collecting data...</div>';
 }

 const width = 200;
 const height = 40;
 const maxScore = Math.max(...points.map(p => p.score), 100);
 const minScore = Math.min(...points.map(p => p.score), 0);
 const range = maxScore - minScore || 1;

 const coords = points.map((p, i) => {
 const x = (i / (points.length - 1)) * width;
 const y = height - ((p.score - minScore) / range) * (height - 4) - 2;
 return `${x.toFixed(1)},${y.toFixed(1)}`;
 });

 const lastPoint = points[points.length - 1]!;
 const color = this.scoreColor(lastPoint.score);

 return `
 <svg class="esc-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
 <polyline points="${coords.join(' ')}"
 fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
 <circle cx="${coords[coords.length - 1]!.split(',')[0]}" cy="${coords[coords.length - 1]!.split(',')[1]}"
 r="2.5" fill="${color}"/>
 </svg>
 `;
  }

  // ── Score gauge (arc) ─────────────────────────────────────────────────

  private renderGauge(score: number): string {
 const color = this.scoreColor(score);
 // Simple horizontal bar gauge
 return `
 <div class="esc-gauge">
 <div class="esc-gauge-bar">
 <div class="esc-gauge-fill" style="width:${score}%;background:${color}"></div>
 </div>
 <span class="esc-gauge-value" style="color:${color}">${score}</span>
 </div>
 `;
  }

  // ── Factor rows ───────────────────────────────────────────────────────

  private renderFactors(factors: EscalationFactor[]): string {
 return factors.map(f => {
 const barWidth = Math.round(f.rawValue);
 return `
 <div class="esc-factor-row">
 <div class="esc-factor-header">
 <span class="esc-factor-name">${escapeHtml(f.name)}</span>
 <span class="esc-factor-weight">${Math.round(f.weight * 100)}%</span>
 <span class="esc-factor-score">${Math.round(f.rawValue)}</span>
 </div>
 <div class="esc-factor-bar-bg">
 <div class="esc-factor-bar" style="width:${barWidth}%;background:${this.scoreColor(f.rawValue)}"></div>
 </div>
 <div class="esc-factor-detail">${escapeHtml(f.detail)}</div>
 </div>
 `;
 }).join('');
  }

  // ── Theater card ──────────────────────────────────────────────────────

  private renderCard(forecast: EscalationForecast): string {
 const isExpanded = this.expandedTheaterId === forecast.theaterId;
 const daysLabel = forecast.estimatedDays === null
 ? '<span class="esc-days esc-days-stable">Stable</span>'
 : `<span class="esc-days" style="color:${this.scoreColor(forecast.score)}">~${forecast.estimatedDays}d</span>`;

 // Guard: factors may be empty for newly-created theaters. `[0]!` would
 // throw at runtime because `EscalationForecast.factors` has no minLength.
 const topFactor = forecast.factors.length > 0
 ? forecast.factors.reduce((best, f) => f.contribution > best.contribution ? f : best, forecast.factors[0]!)
 : undefined;

 const history = getTheaterHistory(forecast.theaterId);

 const expandedContent = isExpanded ? `
 <div class="esc-expanded">
 <div class="esc-section-title">Factor Breakdown</div>
 ${this.renderFactors(forecast.factors)}
 <div class="esc-section-title">Score History (${history.length} points)</div>
 ${this.renderSparkline(history)}
 </div>
 ` : '';

 return `
 <div class="esc-card ${isExpanded ? 'esc-card-expanded' : ''}" data-theater="${escapeHtml(forecast.theaterId)}"
 style="border-left:3px solid ${this.scoreColor(forecast.score)}">
 <div class="esc-card-header">
 <div class="esc-card-title">
 <span class="esc-theater-name">${escapeHtml(forecast.name)}</span>
 <span class="esc-region-tag">${escapeHtml(forecast.region)}</span>
 </div>
 <div class="esc-card-metrics">
 ${this.renderGauge(forecast.score)}
 ${this.trendArrow(forecast.trend)}
 ${daysLabel}
 </div>
 </div>
 <div class="esc-card-summary">
 <span class="esc-level-badge" style="background:${this.scoreColor(forecast.score)}20;color:${this.scoreColor(forecast.score)}">
 ${this.scoreLabel(forecast.score)}
 </span>
 ${topFactor ? `<span class="esc-top-factor">${escapeHtml(topFactor.name)}: ${Math.round(topFactor.rawValue)}</span>` : ''}
 </div>
 ${expandedContent}
 </div>
 `;
  }

  // ── Global Tension Index ──────────────────────────────────────────────

  private renderGlobalIndex(forecasts: EscalationForecast[]): string {
 const gti = getGlobalTensionIndex();
 const criticalCount = forecasts.filter(f => f.score >= 80).length;
 const highCount = forecasts.filter(f => f.score >= 60 && f.score < 80).length;

 return `
 <div class="esc-global-index" style="border-color:${this.scoreColor(gti)}">
 <div class="esc-gti-header">
 <span class="esc-gti-label">Global Tension Index</span>
 <span class="esc-gti-value" style="color:${this.scoreColor(gti)}">${gti}</span>
 <span class="esc-gti-level" style="color:${this.scoreColor(gti)}">${this.scoreLabel(gti)}</span>
 </div>
 <div class="esc-gti-bar">
 <div class="esc-gti-fill" style="width:${gti}%;background:${this.scoreColor(gti)}"></div>
 </div>
 <div class="esc-gti-counts">
 ${criticalCount > 0 ? `<span class="esc-gti-badge" style="color:#ef4444">${criticalCount} Critical</span>` : ''}
 ${highCount > 0 ? `<span class="esc-gti-badge" style="color:#f97316">${highCount} High</span>` : ''}
 <span class="esc-gti-badge" style="color:#9ca3af">${forecasts.length} theaters</span>
 </div>
 </div>
 `;
  }

  // ── Main render ───────────────────────────────────────────────────────

  private render(): void {
 const forecasts = getEscalationForecasts();

 if (forecasts.length === 0) {
 this.setContent(`
 <div class="esc-panel">
 <div class="esc-empty">Awaiting data from military posture and event feeds...</div>
 </div>
 `);
 return;
 }

 this.setCount(forecasts.filter(f => f.score >= 60).length);

 const cardsHtml = forecasts.map(f => this.renderCard(f)).join('');

 ensureEscStyles();

 this.setContent(`
 <div class="esc-panel">
 ${this.renderGlobalIndex(forecasts)}
 <div class="esc-grid">
 ${cardsHtml}
 </div>
 </div>
 `);

 this.attachCardListeners();
  }

  private attachCardListeners(): void {
 const cards = this.content.querySelectorAll('.esc-card');
 cards.forEach(card => {
 card.addEventListener('click', () => {
 const theaterId = (card as HTMLElement).dataset.theater ?? null;
 this.expandedTheaterId = theaterId === this.expandedTheaterId ? null : theaterId;
 this.render();
 });
 });
  }
}

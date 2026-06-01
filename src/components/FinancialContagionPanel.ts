import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getContagionModel,
  type ContagionModel,
  type ChannelStress,
  type CascadePath,
} from '@/services/financial-contagion';

export class FinancialContagionPanel extends Panel {
  private model: ContagionModel | null = null;

  constructor() {
 super({ id: 'financial-contagion', title: 'Financial Contagion' });
 this.showLoading('Modelling contagion channels...');
  }

  /** Call after panel is mounted to begin data fetch. */
  public init(): void {
 void this.load();
  }

  async load(): Promise<void> {
 try {
 this.model = await getContagionModel();
 this.render();
 } catch (error) {
 const msg = error instanceof Error ? error.message : String(error);
 if (/unavailable/i.test(msg)) {
 // Expected when the upstream economic-stress feed is down — a data
 // condition, not an app error. Tag [FEED] so it doesn't read as a bug.
 console.warn(`[FEED] [FinancialContagionPanel] ${msg}`);
 } else {
 console.error('[FinancialContagionPanel] load error:', error);
 }
 this.showError('Contagion data unavailable');
 }
  }

  /** Called externally by the data-loader refresh cycle. */
  update(model: ContagionModel | null): void {
 if (!model) {
 this.showError('Contagion data unavailable');
 return;
 }
 this.model = model;
 this.render();
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
 const m = this.model;
 if (!m) return;

 const el = this.getContentElement();
 const score = m.systemicRiskScore;
 const scoreColor = score >= 70 ? '#ef4444' : score >= 45 ? '#eab308' : '#22c55e';
 const scoreLabel = score >= 70 ? 'HIGH' : score >= 45 ? 'ELEVATED' : 'LOW';

 const channelsHtml = m.channels.map(c => this.renderChannelBar(c)).join('');
 const cascadesHtml = m.cascadePaths.length > 0
 ? m.cascadePaths.map(p => this.renderCascadePath(p)).join('')
 : '<div style="opacity:0.5;font-size:0.72rem;padding:0.3rem 0;">No active cascade paths detected.</div>';

 const narrativeHtml = m.aiNarrative
 ? `<div style="padding:0.55rem;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.18);border-radius:6px;font-size:0.72rem;line-height:1.45;color:rgba(255,255,255,0.85);">
 <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.55;margin-bottom:0.3rem;">AI Assessment</div>
 ${escapeHtml(m.aiNarrative)}
 </div>`
 : '';

 const ts = new Date(m.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

 el.innerHTML = `
<div style="padding:0.8rem;display:flex;flex-direction:column;gap:0.65rem;">
  <!-- Systemic Risk Score -->
  <div>
 <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.35rem;">
 <div style="font-size:0.62rem;opacity:0.5;text-transform:uppercase;letter-spacing:0.05em;">Systemic Risk Score</div>
 <div style="display:flex;align-items:center;gap:0.35rem;">
 <span style="font-size:0.65rem;font-weight:600;color:${scoreColor};opacity:0.8;">${scoreLabel}</span>
 <span style="font-size:1.5rem;font-weight:700;color:${scoreColor};line-height:1;">${score}<span style="font-size:0.8rem;opacity:0.5;">/100</span></span>
 </div>
 </div>
 <div style="height:8px;background:rgba(255,255,255,0.07);border-radius:4px;overflow:hidden;position:relative;">
 <div style="position:absolute;inset:0;background:linear-gradient(90deg,#22c55e 0%,#eab308 50%,#ef4444 100%);opacity:0.2;border-radius:4px;"></div>
 <div style="width:${Math.min(100, score)}%;height:100%;background:linear-gradient(90deg,rgba(34,197,94,0.8) 0%,rgba(234,179,8,0.9) 55%,rgba(239,68,68,1) 100%);border-radius:4px;transition:width 0.6s ease;"></div>
 </div>
  </div>

  <!-- Channel Stress Bars -->
  <div>
 <div style="font-size:0.62rem;opacity:0.5;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem;">Contagion Channels</div>
 <div style="display:flex;flex-direction:column;gap:0.3rem;">${channelsHtml}</div>
  </div>

  <!-- Active Cascade Paths -->
  <div>
 <div style="font-size:0.62rem;opacity:0.5;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem;">Active Cascade Paths</div>
 <div style="display:flex;flex-direction:column;gap:0.45rem;">${cascadesHtml}</div>
  </div>

  <!-- AI Narrative -->
  ${narrativeHtml}

  <!-- Timestamp -->
  <div style="font-size:0.58rem;opacity:0.35;text-align:right;">Updated ${ts}</div>
</div>`;
  }

  private renderChannelBar(ch: ChannelStress): string {
 const pct = Math.min(100, ch.stressLevel);
 const color = ch.stressLevel >= 70 ? '#ef4444' : ch.stressLevel >= 45 ? '#eab308' : '#22c55e';
 const trendIcon = ch.trend === 'rising' ? '<span style="color:#ef4444;margin-left:0.2rem;">&#9650;</span>'
 : ch.trend === 'falling' ? '<span style="color:#22c55e;margin-left:0.2rem;">&#9660;</span>'
 : '';

 return `
<div style="display:flex;align-items:center;gap:0.4rem;">
  <div style="flex:0 0 120px;font-size:0.68rem;opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(ch.channel)}">${escapeHtml(ch.channel)}</div>
  <div style="flex:1;height:7px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden;position:relative;">
 <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width 0.5s ease;"></div>
  </div>
  <div style="flex:0 0 40px;text-align:right;font-size:0.68rem;font-weight:600;color:${color};">${ch.stressLevel}${trendIcon}</div>
</div>`;
  }

  private renderCascadePath(path: CascadePath): string {
 const stepsHtml = path.steps.map((step, i) => {
 const stepColor = step.probability >= 60 ? '#ef4444' : step.probability >= 35 ? '#eab308' : '#22c55e';
 const arrow = i < path.steps.length - 1 ? '<span style="opacity:0.4;margin:0 0.25rem;">&#8594;</span>' : '';
 return `<span style="color:${stepColor};font-weight:500;">${escapeHtml(step.label)} (${step.probability}%)</span>${arrow}`;
 }).join('');

 const probColor = path.overallProbability >= 30 ? '#ef4444' : path.overallProbability >= 10 ? '#eab308' : '#22c55e';

 return `
<div style="padding:0.45rem 0.55rem;background:rgba(255,255,255,0.03);border-radius:5px;border-left:3px solid ${probColor};">
  <div style="font-size:0.68rem;font-weight:600;margin-bottom:0.25rem;">${escapeHtml(path.trigger)}</div>
  <div style="font-size:0.65rem;line-height:1.5;display:flex;flex-wrap:wrap;align-items:center;">${stepsHtml}</div>
  <div style="font-size:0.6rem;opacity:0.5;margin-top:0.2rem;">Overall cascade probability: <strong style="color:${probColor};">${path.overallProbability}%</strong></div>
</div>`;
  }
}

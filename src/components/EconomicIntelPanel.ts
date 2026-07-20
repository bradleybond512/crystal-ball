import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';

type TrendDirection = 'rising' | 'falling' | 'stable';

// ── Sidecar response shapes (mirror engines from PRs #295 + #297) ──────

interface FsiAlert {
  date: string;
  index: number;
  tier: 'low' | 'normal' | 'elevated' | 'severe';
  message: string;
}

interface FinancialStressResponse {
  configured: boolean;
  current?: FsiAlert;
  /** Trailing series for the sparkline (oldest first). */
  series?: { date: string; index: number }[];
  error?: string;
}

interface CommodityAlert {
  commodity: string;
  unit: string;
  currentPrice: number;
  deviation12mSigma: number;
  deviation24mSigma: number;
  trend: TrendDirection;
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

interface CommodityStressResponse {
  configured: boolean;
  alerts?: CommodityAlert[];
  error?: string;
}

interface EnsoSnapshot {
  current: { year: number; season: string; oni: number };
  phase: 'el_nino' | 'la_nina' | 'neutral';
  phaseRunLength: number;
  forecast6m: string;
}

interface EnsoResponse {
  configured: boolean;
  snapshot?: EnsoSnapshot;
  shortageAdjustments?: { commodity: string; multiplier: number; rationale: string }[];
  error?: string;
}

type TabId = 'fsi' | 'commodities' | 'enso' | 'macro';

type VixGauge = 'calm' | 'elevated' | 'stress' | 'crisis';

interface MacroSeriesSnapshot {
  series: string;
  current: number | null;
  asOf: string | null;
  mean30: number | null;
  stddev30: number | null;
  zScore: number | null;
  trend: TrendDirection;
  vixGauge: VixGauge | null;
  error?: string;
}

interface MacroStressResponse {
  components?: MacroSeriesSnapshot[];
  asOf?: string | null;
}
const REFRESH_MS = 5 * 60_000;

// EconomicIntelPanel: financial stress gauge + ENSO status + commodity
// stress table. Reads from /api/financial-stress, /api/commodity-stress,
// /api/enso. All three return configured=false until live ingestion
// lands; the panel renders graceful empty states meanwhile.
export class EconomicIntelPanel extends Panel {
  private fsi: FinancialStressResponse | null = null;
  private commodities: CommodityStressResponse | null = null;
  private enso: EnsoResponse | null = null;
  private macro: MacroStressResponse | null = null;
  private fsiError: string | null = null;
  private commoditiesError: string | null = null;
  private ensoError: string | null = null;
  private macroError: string | null = null;
  private activeTab: TabId = 'fsi';
  private refreshTimer: number | null = null;

  constructor() {
 super({
 id: 'economic-intel',
 title: 'Economic Intel',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'OFR FSI gauge + ENSO phase + commodity stress alerts. Reads /api/financial-stress, /api/commodity-stress, /api/enso.',
 });
 this.showLoading('Loading economic intel…');
 setTimeout(() => { void this.refresh(); }, 0);
 this.refreshTimer = window.setInterval(() => { void this.refresh(); }, REFRESH_MS);
  }

  override destroy(): void {
 if (this.refreshTimer !== null) {
 window.clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }

  async refresh(): Promise<void> {
 await Promise.all([this.refreshFsi(), this.refreshCommodities(), this.refreshEnso(), this.refreshMacro()]);
  }

  private async refreshMacro(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/macro-stress`);
 const body = (await res.json().catch(() => null)) as MacroStressResponse | null;
 if (body) {
 this.macro = body;
 this.macroError = null;
 } else {
 this.macroError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.macroError = error instanceof Error ? error.message : String(error);
 }
 this.render();
  }

  private async refreshFsi(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/financial-stress`);
 const body = (await res.json().catch(() => null)) as FinancialStressResponse | null;
 if (body) {
 this.fsi = body;
 this.fsiError = null;
 } else {
 this.fsiError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.fsiError = error instanceof Error ? error.message : String(error);
 }
 this.updateCount();
 this.render();
  }

  private async refreshCommodities(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/commodity-stress`);
 const body = (await res.json().catch(() => null)) as CommodityStressResponse | null;
 if (body) {
 this.commodities = body;
 this.commoditiesError = null;
 } else {
 this.commoditiesError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.commoditiesError = error instanceof Error ? error.message : String(error);
 }
 this.updateCount();
 this.render();
  }

  private async refreshEnso(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/enso`);
 const body = (await res.json().catch(() => null)) as EnsoResponse | null;
 if (body) {
 this.enso = body;
 this.ensoError = null;
 } else {
 this.ensoError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.ensoError = error instanceof Error ? error.message : String(error);
 }
 this.render();
  }

  private updateCount(): void {
 const fsiAlert = this.fsi?.current?.tier === 'severe' || this.fsi?.current?.tier === 'elevated' ? 1 : 0;
 const commodityCount = this.commodities?.alerts?.filter((a) => a.overallRisk === 'high' || a.overallRisk === 'critical').length ?? 0;
 this.setCount(fsiAlert + commodityCount);
  }

  private renderTabs(): string {
 const fsiBadge = this.fsi?.current ? this.fsi.current.tier : '—';
 const commodityHot = this.commodities?.alerts?.filter((a) => a.overallRisk === 'high' || a.overallRisk === 'critical').length ?? 0;
 const commodityLabel = commodityHot > 0 ? `Commodities · ${commodityHot}` : 'Commodities';
 const vixComp = this.macro?.components?.find((c) => c.series.toUpperCase() === 'VIXCLS');
 const macroLabel = vixComp?.vixGauge ? `Macro · VIX ${vixComp.vixGauge}` : 'Macro';
 const tabs: { id: TabId; label: string }[] = [
 { id: 'fsi', label: `FSI · ${fsiBadge}` },
 { id: 'commodities', label: commodityLabel },
 { id: 'enso', label: `ENSO · ${this.enso?.snapshot?.phase ?? '—'}` },
 { id: 'macro', label: macroLabel },
 ];
 const items = tabs.map((t) => {
 const active = t.id === this.activeTab;
 const bg = active ? 'rgba(255,255,255,0.08)' : 'transparent';
 const border = active ? '#3b82f6' : 'transparent';
 return `<button data-econ-tab="${escapeHtml(t.id)}" style="background:${bg};border:none;padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:2px solid ${border}">${escapeHtml(t.label)}</button>`;
 }).join('');
 return `<div style="display:flex;border-bottom:1px solid var(--panel-border,#2a2a2c);background:rgba(255,255,255,0.02)">${items}</div>`;
  }

  private renderFsi(): string {
 if (this.fsiError) return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.fsiError)}</div>`;
 if (!this.fsi) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading…</div>';
 if (!this.fsi.configured || !this.fsi.current) {
 return `<div style="padding:12px;font-size:12px;line-height:1.5">
 <strong>OFR FSI not yet wired.</strong><br/>
 Engine ready (FSI tier ladder + 18 tests passing). Sidecar fetcher follows in a follow-up PR.
 </div>`;
 }
 const tierColor = colorForTier(this.fsi.current.tier);
 const fillPct = fsiBarPct(this.fsi.current.index);
 const sparkline = renderSparkline(this.fsi.series ?? []);
 return `
 <div style="padding:12px">
 <div style="display:flex;justify-content:space-between;align-items:baseline">
 <div style="font-size:32px;font-weight:600;color:${tierColor};font-family:ui-monospace,monospace">${this.fsi.current.index.toFixed(2)}</div>
 <div style="font-size:11px;opacity:0.6">${escapeHtml(this.fsi.current.date)}</div>
 </div>
 <div style="margin-top:6px;font-size:11px"><span style="color:${tierColor};font-weight:600;text-transform:uppercase">${escapeHtml(this.fsi.current.tier)}</span> · ${escapeHtml(this.fsi.current.message)}</div>
 <div style="margin-top:12px;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden"><div style="height:100%;width:${fillPct}%;background:${tierColor}"></div></div>
 ${sparkline}
 </div>`;
  }

  private renderCommodities(): string {
 if (this.commoditiesError) return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.commoditiesError)}</div>`;
 if (!this.commodities) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading…</div>';
 if (!this.commodities.configured) {
 return `<div style="padding:12px;font-size:12px;line-height:1.5">
 <strong>Commodity stress not yet wired.</strong><br/>
 Engine ready (12m + 24m σ-deviation alerts; 18 tests passing). Sidecar fetcher follows.
 </div>`;
 }
 const alerts = this.commodities.alerts ?? [];
 if (alerts.length === 0) return '<div style="padding:12px;opacity:0.6;font-size:12px">No commodity alerts.</div>';
 const rows = alerts.map((a) => renderCommodityRow(a)).join('');
 return `<table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="background:rgba(255,255,255,0.04);text-align:left;font-size:10px;opacity:0.7"><tr><th style="padding:4px 8px">Risk</th><th style="padding:4px 8px">Commodity</th><th style="padding:4px 8px">Price</th><th style="padding:4px 8px">12m σ</th><th style="padding:4px 8px">Trend</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  private renderEnso(): string {
 if (this.ensoError) return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.ensoError)}</div>`;
 if (!this.enso) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading…</div>';
 if (!this.enso.configured || !this.enso.snapshot) {
 return `<div style="padding:12px;font-size:12px;line-height:1.5">
 <strong>ENSO monitor not yet wired.</strong><br/>
 Engine ready (NOAA ONI parser + phase classification + shortage adjustments; 22 tests passing). Sidecar fetcher follows.
 </div>`;
 }
 const phaseColor = colorForEnsoPhase(this.enso.snapshot.phase);
 const adjustmentRows = (this.enso.shortageAdjustments ?? []).map((a) => `<tr><td style="padding:4px 8px">${escapeHtml(a.commodity)}</td><td style="padding:4px 8px;font-family:ui-monospace,monospace">${a.multiplier.toFixed(2)}×</td><td style="padding:4px 8px;opacity:0.85">${escapeHtml(a.rationale)}</td></tr>`).join('');
 return `
 <div style="padding:12px">
 <div style="display:flex;justify-content:space-between;align-items:baseline">
 <div style="font-size:24px;font-weight:600;color:${phaseColor}">${escapeHtml(humanPhase(this.enso.snapshot.phase))}</div>
 <div style="font-size:11px;opacity:0.7;font-family:ui-monospace,monospace">ONI ${this.enso.snapshot.current.oni.toFixed(2)} (${escapeHtml(this.enso.snapshot.current.season)} ${this.enso.snapshot.current.year})</div>
 </div>
 <div style="margin-top:6px;font-size:11px;opacity:0.7">Run length ${this.enso.snapshot.phaseRunLength} season(s)</div>
 <div style="margin-top:8px;font-size:12px;line-height:1.5">${escapeHtml(this.enso.snapshot.forecast6m)}</div>
 ${adjustmentRows ? `<div style="margin-top:14px;font-size:11px;font-weight:600;opacity:0.8">Shortage adjustments</div><table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:4px"><tbody>${adjustmentRows}</tbody></table>` : ''}
 </div>`;
  }

  private renderMacro(): string {
 if (this.macroError) return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.macroError)}</div>`;
 if (!this.macro?.components || this.macro.components.length === 0) {
 return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading macro stress data…</div>';
 }
 const rows = this.macro.components.map((c) => {
 const arrow = trendArrow(c.trend);
 const decimals = c.series === 'VIXCLS' ? 2 : 4;
 const cur = c.current === null ? '—' : c.current.toFixed(decimals);
 const z = c.zScore === null ? '—' : c.zScore.toFixed(2);
 const gaugeBadge = c.vixGauge
 ? `<span style="margin-left:8px;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;text-transform:uppercase;background:${vixGaugeColor(c.vixGauge)};color:#000;">${escapeHtml(c.vixGauge)}</span>`
 : '';
 const errLine = c.error ? `<div style="font-size:10px;color:#ef4444;">⚠ ${escapeHtml(c.error)}</div>` : '';
 return `<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
 <td style="padding:4px 8px;font-family:ui-monospace,monospace;font-weight:600;">${escapeHtml(c.series)}${gaugeBadge}</td>
 <td style="padding:4px 8px;font-family:ui-monospace,monospace;">${escapeHtml(cur)}</td>
 <td style="padding:4px 8px;color:var(--text-secondary,#aaa);">${arrow}</td>
 <td style="padding:4px 8px;font-family:ui-monospace,monospace;">z ${escapeHtml(z)}</td>
 <td style="padding:4px 8px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(c.asOf ?? '—')}${errLine}</td>
 </tr>`;
 }).join('');
 return `<div style="padding:8px;"><div style="font-size:11px;color:var(--text-secondary,#aaa);margin-bottom:6px;">Source: FRED CSV · 30-day rolling z-score</div><table style="width:100%;border-collapse:collapse;font-size:11px;"><tbody>${rows}</tbody></table></div>`;
  }

  private renderActiveTab(): string {
 if (this.activeTab === 'commodities') return this.renderCommodities();
 if (this.activeTab === 'enso') return this.renderEnso();
 if (this.activeTab === 'macro') return this.renderMacro();
 return this.renderFsi();
  }

  private render(): void {
 const html = `${this.renderTabs()}<div data-econ-body>${this.renderActiveTab()}</div>`;
 this.setContent(html);
 const root = document.querySelector<HTMLElement>(`[data-panel-id="${this.getPanelId()}"]`);
 if (root) {
 root.querySelectorAll<HTMLButtonElement>('button[data-econ-tab]').forEach((btn) => {
 btn.addEventListener('click', () => {
 const id = btn.getAttribute('data-econ-tab') as TabId | null;
 if (id) {
 this.activeTab = id;
 this.render();
 }
 });
 });
 }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function vixGaugeColor(g: VixGauge): string {
  if (g === 'calm') return '#4caf50';
  if (g === 'elevated') return '#ffeb3b';
  if (g === 'stress') return '#ff9800';
  return '#ff453a';
}

function trendArrow(trend: TrendDirection): string {
  if (trend === 'rising') return '↑';
  if (trend === 'falling') return '↓';
  return '→';
}

function colorForTier(tier: string): string {
  switch (tier) {
    case 'severe': { return '#ef4444';
    }
    case 'elevated': { return '#fde68a';
    }
    case 'low': { return '#86efac';
    }
    default: { return '#9ca3af';
    }
  }
}

function colorForRisk(risk: string): string {
  switch (risk) {
    case 'critical': { return '#ef4444';
    }
    case 'high': { return '#fca5a5';
    }
    case 'medium': { return '#fde68a';
    }
    default: { return '#86efac';
    }
  }
}

function colorForEnsoPhase(phase: string): string {
  switch (phase) {
    case 'el_nino': { return '#fca5a5';
    }
    case 'la_nina': { return '#93c5fd';
    }
    default: { return '#9ca3af';
    }
  }
}

function humanPhase(phase: string): string {
  switch (phase) {
    case 'el_nino': { return 'El Niño';
    }
    case 'la_nina': { return 'La Niña';
    }
    default: { return 'Neutral';
    }
  }
}

function fsiBarPct(index: number): number {
  // Map FSI [-3, +5] to [0, 100] for the bar fill.
  const clamped = Math.max(-3, Math.min(5, index));
  return Math.round(((clamped + 3) / 8) * 100);
}


function renderCommodityRow(a: CommodityAlert): string {
  const riskColor = colorForRisk(a.overallRisk);
  const arrow = trendArrow(a.trend);
  return `<tr><td style="padding:4px 8px;color:${riskColor};font-weight:600;text-transform:uppercase;font-size:10px">${escapeHtml(a.overallRisk)}</td><td style="padding:4px 8px"><strong>${escapeHtml(a.commodity)}</strong></td><td style="padding:4px 8px;font-family:ui-monospace,monospace">${a.currentPrice.toFixed(2)} <span style="opacity:0.5">${escapeHtml(a.unit)}</span></td><td style="padding:4px 8px;font-family:ui-monospace,monospace">${a.deviation12mSigma >= 0 ? '+' : ''}${a.deviation12mSigma.toFixed(2)}σ</td><td style="padding:4px 8px;text-align:center">${arrow}</td></tr>`;
}

function renderSparkline(series: { date: string; index: number }[]): string {
  if (series.length < 2) return '';
  const values = series.map((s) => s.index);
  const min = Math.min(...values, -3);
  const max = Math.max(...values, 5);
  const w = 280;
  const h = 40;
  const points = series.map((s, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((s.index - min) / (max - min)) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" style="margin-top:8px;display:block"><polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="1.5"/><line x1="0" y1="${h - ((1.5 - min) / (max - min)) * h}" x2="${w}" y2="${h - ((1.5 - min) / (max - min)) * h}" stroke="#fde68a" stroke-dasharray="2 3" opacity="0.5"/><line x1="0" y1="${h - ((3 - min) / (max - min)) * h}" x2="${w}" y2="${h - ((3 - min) / (max - min)) * h}" stroke="#ef4444" stroke-dasharray="2 3" opacity="0.5"/></svg>`;
}

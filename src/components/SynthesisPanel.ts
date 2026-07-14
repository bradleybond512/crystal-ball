import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';

// ── Sidecar response shapes ─────────────────────────────────────────────

interface PrecedentAnalog {
  id: string;
  date: string;
  location: string;
  country: string;
  similarity: number;
  summary: string;
  aftermath30d: string;
  aftermath90d: string;
  keyDifferences: string[];
  source: string;
}

interface PrecedentsResponse {
  configured: boolean;
  query?: { eventType?: string; location?: string; intensity?: string };
  currentEventSummary?: string;
  analogs?: PrecedentAnalog[];
  averageOutcome?: string;
  worstCase?: string;
  bestCase?: string;
  error?: string;
}

interface LeadingIndicatorAlert {
  causeSignal: string;
  effectSignal: string;
  lagDays: number;
  strength: number;
  message: string;
}

interface LeadingIndicatorsResponse {
  configured: boolean;
  pairs?: { cause: string; effect: string; lagDays: number; pValue: number; strength: number }[];
  alerts?: LeadingIndicatorAlert[];
  lastAnalyzed?: string;
  error?: string;
}

type TabId = 'precedents' | 'indicators' | 'signals';

function readWatchKeywords(): string[] {
  try {
    const raw = localStorage.getItem(WATCH_KEYWORDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const out = parsed.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 100);
        if (out.length > 0) return out;
      }
    }
  } catch { /* fallthrough */ }
  return DEFAULT_WATCH_KEYWORDS;
}

function createEmptySignalResult(keyword: string, error: string): SignalWatchResult {
  return {
    keyword,
    lastHourCount: 0,
    baselineRate: 0,
    surgeRatio: 0,
    surgeLevel: 'normal',
    totalSeen: 0,
    recent: [],
    error,
  };
}

function surgeColor(level: SurgeLevel): string {
  if (level === 'spike') return '#ff453a';
  if (level === 'surge') return '#ff5722';
  if (level === 'elevated') return '#ff9800';
  return '#4caf50';
}

function renderSignalRow(s: SignalWatchResult): string {
  const color = surgeColor(s.surgeLevel);
  const errLine = s.error
    ? `<div style="font-size:10px;color:#ef4444;margin-top:2px;">⚠ ${escapeHtml(s.error)}</div>`
    : '';
  const recentItems = s.recent.slice(0, 3).map((p) => {
    const ageH = Math.max(0, Math.round((Date.now() / 1000 - p.createdAt) / 3600));
    return `<div style="font-size:10px;opacity:0.7;margin-top:2px;">↳ <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener" style="color:inherit;">${escapeHtml(p.title.slice(0, 100))}</a> · ${ageH}h ago</div>`;
  }).join('');
  return `<div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div><strong>${escapeHtml(s.keyword)}</strong>
        <span style="margin-left:8px;color:${color};font-weight:700;text-transform:uppercase;font-size:10px;">${s.surgeLevel}</span>
      </div>
      <div style="font-family:ui-monospace,monospace;font-size:10px;opacity:0.7;">×${s.surgeRatio.toFixed(2)} · ${s.lastHourCount}/h vs ${s.baselineRate.toFixed(2)}/h baseline</div>
    </div>
    ${errLine}
    ${recentItems}
  </div>`;
}

interface SignalPost {
  id: string;
  title: string;
  subreddit: string;
  url: string;
  createdAt: number;
  score: number;
  comments: number;
  author: string;
}

type SurgeLevel = 'normal' | 'elevated' | 'surge' | 'spike';

interface SignalWatchResult {
  keyword: string;
  lastHourCount: number;
  baselineRate: number;
  surgeRatio: number;
  surgeLevel: SurgeLevel;
  totalSeen: number;
  recent: SignalPost[];
  error?: string;
  asOf?: string;
}

const WATCH_KEYWORDS_STORAGE_KEY = 'cb:synthesis:watch-keywords';
const DEFAULT_WATCH_KEYWORDS = ['Taiwan', 'Hormuz', 'cyberattack'];

const REFRESH_MS = 5 * 60_000;

// "What does history say?" panel. Reads from /api/precedents and
// /api/leading-indicators. The sidecar endpoints land in a follow-up
// (corpus pre-compute on startup is non-trivial); until then the panel
// renders graceful empty states so users see the scaffolding without
// errors.
export class SynthesisPanel extends Panel {
  private precedents: PrecedentsResponse | null = null;
  private indicators: LeadingIndicatorsResponse | null = null;
  private precedentsError: string | null = null;
  private indicatorsError: string | null = null;
  private activeTab: TabId = 'precedents';
  private refreshTimer: number | null = null;

  constructor() {
 super({
 id: 'synthesis',
 title: 'Synthesis',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Historical precedent matcher + cross-domain leading indicators. Reads /api/precedents and /api/leading-indicators.',
 });
 this.showLoading('Loading synthesis…');
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
 await Promise.all([this.refreshPrecedents(), this.refreshIndicators(), this.refreshSignals()]);
  }

  private async refreshSignals(): Promise<void> {
 const keywords = readWatchKeywords();
 const results: SignalWatchResult[] = [];
 for (const kw of keywords.slice(0, 5)) {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/signal-watch?q=${encodeURIComponent(kw)}`);
 const body = (await res.json().catch(() => null)) as SignalWatchResult | null;
 if (body) {
 results.push(body);
 } else {
 results.push(createEmptySignalResult(kw, `Sidecar HTTP ${res.status}`));
 }
 } catch (error) {
 const msg = error instanceof Error ? error.message : String(error);
 results.push(createEmptySignalResult(kw, msg));
 }
 }
 this.signals = results;
 this.render();
  }

  private async refreshPrecedents(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/precedents`);
 const body = (await res.json().catch(() => null)) as PrecedentsResponse | null;
 if (body) {
 this.precedents = body;
 this.precedentsError = null;
 } else {
 this.precedentsError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.precedentsError = error instanceof Error ? error.message : String(error);
 }
 this.updateCount();
 this.render();
  }

  private async refreshIndicators(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/leading-indicators`);
 const body = (await res.json().catch(() => null)) as LeadingIndicatorsResponse | null;
 if (body) {
 this.indicators = body;
 this.indicatorsError = null;
 } else {
 this.indicatorsError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.indicatorsError = error instanceof Error ? error.message : String(error);
 }
 this.render();
  }

  private signals: SignalWatchResult[] = [];

  private updateCount(): void {
 const analogs = this.precedents?.analogs?.length ?? 0;
 const alerts = this.indicators?.alerts?.length ?? 0;
 const signalSurges = this.signals.filter((s) => s.surgeLevel !== 'normal').length;
 this.setCount(analogs + alerts + signalSurges);
  }

  private renderTabs(): string {
 const analogCount = this.precedents?.analogs?.length ?? 0;
 const alertCount = this.indicators?.alerts?.length ?? 0;
 const surgeCount = this.signals.filter((s) => s.surgeLevel !== 'normal').length;
 const tabs: { id: TabId; label: string; count: number }[] = [
 { id: 'precedents', label: 'Precedents', count: analogCount },
 { id: 'indicators', label: 'Leading Indicators', count: alertCount },
 { id: 'signals', label: 'Signal Watch', count: surgeCount },
 ];
 const items = tabs.map((t) => {
 const active = t.id === this.activeTab;
 const bg = active ? 'rgba(255,255,255,0.08)' : 'transparent';
 const border = active ? '#3b82f6' : 'transparent';
 return `<button data-synth-tab="${escapeHtml(t.id)}" style="background:${bg};border:none;padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:2px solid ${border}">${escapeHtml(t.label)} <span style="opacity:0.5">${t.count}</span></button>`;
 }).join('');
 return `<div style="display:flex;border-bottom:1px solid var(--panel-border,#2a2a2c);background:rgba(255,255,255,0.02)">${items}</div>`;
  }

  private renderPrecedents(): string {
 if (this.precedentsError) {
 return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.precedentsError)}</div>`;
 }
 if (!this.precedents) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading…</div>';
 if (!this.precedents.configured) {
 return `<div style="padding:12px;font-size:12px;line-height:1.5">
 <strong>Historical corpus not configured.</strong><br/>
 The sidecar will load and pre-compute embeddings from GDELT / UCDP / ACLED at startup. Add corpus sources in <code>tools/synthesis/corpus.json</code> or wait for the live-feed wiring PR.<br/>
 <span style="opacity:0.7">Engine ready (TF-IDF + cosine, 21 tests passing); needs a corpus to operate on.</span>
 </div>`;
 }
 const analogs = this.precedents.analogs ?? [];
 if (analogs.length === 0) {
 return `<div style="padding:12px;opacity:0.7;font-size:12px;line-height:1.5">
 <strong>No analogs found.</strong><br/>
 ${escapeHtml(this.precedents.currentEventSummary ?? 'No active query.')}
 </div>`;
 }
 const summaryHtml = this.precedents.currentEventSummary
 ? `<div style="padding:6px 10px;font-size:11px;background:rgba(255,255,255,0.04);border-bottom:1px solid var(--panel-border,#2a2a2c)"><span style="opacity:0.6">Current:</span> ${escapeHtml(this.precedents.currentEventSummary)}</div>`
 : '';
 const top = analogs.slice(0, 5).map((a) => this.renderAnalog(a)).join('');
 const rollups = renderRollups(this.precedents);
 return `${summaryHtml}${rollups}<div>${top}</div>`;
  }

  private renderAnalog(a: PrecedentAnalog): string {
 const bar = Math.round(Math.max(0, Math.min(1, a.similarity)) * 100);
 const diffs = a.keyDifferences.length > 0
 ? `<div style="font-size:10px;opacity:0.6;margin-top:2px">Differences: ${escapeHtml(a.keyDifferences.join(' · '))}</div>`
 : '';
 const aftermath90 = a.aftermath90d
 ? `<div style="font-size:11px;margin-top:4px;opacity:0.85"><strong>+90d:</strong> ${escapeHtml(a.aftermath90d)}</div>`
 : '';
 const aftermath30 = a.aftermath30d
 ? `<div style="font-size:11px;margin-top:2px;opacity:0.85"><strong>+30d:</strong> ${escapeHtml(a.aftermath30d)}</div>`
 : '';
 return `
 <div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.04)">
 <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px">
 <span><strong>${escapeHtml(a.location)}</strong> <span style="opacity:0.6">${escapeHtml(a.date)}</span></span>
 <span style="font-family:ui-monospace,monospace;opacity:0.7">${bar}%</span>
 </div>
 <div style="height:3px;background:rgba(255,255,255,0.08);margin-top:3px;border-radius:2px;overflow:hidden">
 <div style="height:100%;width:${bar}%;background:#3b82f6"></div>
 </div>
 <div style="font-size:11px;margin-top:4px;line-height:1.4">${escapeHtml(a.summary)}</div>
 ${aftermath30}${aftermath90}${diffs}
 </div>`;
  }

  private renderIndicators(): string {
 if (this.indicatorsError) {
 return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.indicatorsError)}</div>`;
 }
 if (!this.indicators) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading…</div>';
 if (!this.indicators.configured) {
 return `<div style="padding:12px;font-size:12px;line-height:1.5">
 <strong>Time series not configured.</strong><br/>
 The sidecar will pull rolling 365-day daily series for BDI / commodities / ACLED rate / ProMED rate / USGS quake rate / CISA KEV in a follow-up PR. Granger F-test runs across every pair at lags 1–90.<br/>
 <span style="opacity:0.7">Engine ready (Granger F-test + OLS + F-distribution survival, 19 tests passing); needs the live series feeder.</span>
 </div>`;
 }
 const alerts = this.indicators.alerts ?? [];
 const pairs = this.indicators.pairs ?? [];
 const alertItems = renderAlertItems(alerts);
 const pairsTable = renderPairsTable(pairs);
 const pairsSection = pairsTable
 ? `<div style="border-bottom:1px solid var(--panel-border,#2a2a2c);padding:6px 10px;font-size:11px;font-weight:600;opacity:0.8;margin-top:8px">All significant pairs</div>${pairsTable}`
 : '';
 const lastAnalyzed = this.indicators.lastAnalyzed
 ? `<div style="padding:6px 10px;font-size:10px;opacity:0.5">Last analyzed: ${escapeHtml(this.indicators.lastAnalyzed)}</div>`
 : '';
 return `${lastAnalyzed}<div style="border-bottom:1px solid var(--panel-border,#2a2a2c);padding:6px 10px;font-size:11px;font-weight:600;opacity:0.8">Active alerts</div>${alertItems}${pairsSection}`;
  }

  private renderSignals(): string {
 if (this.signals.length === 0) {
 return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading signal watch…</div>';
 }
 const headerHtml = `<div style="padding:6px 10px;font-size:10px;opacity:0.6;border-bottom:1px solid var(--panel-border,#2a2a2c);">Reddit post velocity vs 23h baseline · keywords from <code>cb:synthesis:watch-keywords</code> (defaults: ${DEFAULT_WATCH_KEYWORDS.join(', ')})</div>`;
 const rows = this.signals.map((s) => renderSignalRow(s)).join('');
 return `${headerHtml}<div>${rows}</div>`;
  }

  private renderActiveTab(): string {
 if (this.activeTab === 'indicators') return this.renderIndicators();
 if (this.activeTab === 'signals') return this.renderSignals();
 return this.renderPrecedents();
  }

  private render(): void {
 const html = `${this.renderTabs()}<div data-synth-body>${this.renderActiveTab()}</div>`;
 this.setContent(html);
 const root = document.querySelector<HTMLElement>(`[data-panel-id="${this.getPanelId()}"]`);
 if (root) {
 root.querySelectorAll<HTMLButtonElement>('button[data-synth-tab]').forEach((btn) => {
 btn.addEventListener('click', () => {
 const id = btn.getAttribute('data-synth-tab') as TabId | null;
 if (id) {
 this.activeTab = id;
 this.render();
 }
 });
 });
 }
  }
}

// ── Module-scope helpers (extracted so the class methods stay simple) ──

function renderAlertItems(alerts: readonly LeadingIndicatorAlert[]): string {
  if (alerts.length === 0) return '<div style="padding:10px;opacity:0.6;font-size:11px">No active alerts.</div>';
  return alerts.map((a) => {
    const strengthPct = (a.strength * 100).toFixed(1);
    return `<div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;line-height:1.5"><span style="color:#fde68a;font-weight:600">${escapeHtml(a.causeSignal)} → ${escapeHtml(a.effectSignal)}</span> · ${a.lagDays}d · ${strengthPct}% strength<br/><span style="opacity:0.85">${escapeHtml(a.message)}</span></div>`;
  }).join('');
}

function renderPairsTable(pairs: readonly { cause: string; effect: string; lagDays: number; pValue: number; strength: number }[]): string {
  if (pairs.length === 0) return '';
  const head = '<thead style="background:rgba(255,255,255,0.04);text-align:left;font-size:10px;opacity:0.7"><tr><th style="padding:4px 8px">Cause</th><th style="padding:4px 8px">Effect</th><th style="padding:4px 8px">Lag (d)</th><th style="padding:4px 8px">p</th><th style="padding:4px 8px">Strength</th></tr></thead>';
  const rows = pairs.map((p) => {
    const strengthPct = (p.strength * 100).toFixed(1);
    return `<tr><td style="padding:4px 8px">${escapeHtml(p.cause)}</td><td style="padding:4px 8px">${escapeHtml(p.effect)}</td><td style="padding:4px 8px">${p.lagDays}</td><td style="padding:4px 8px;font-family:ui-monospace,monospace">${p.pValue.toExponential(2)}</td><td style="padding:4px 8px">${strengthPct}%</td></tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:11px">${head}<tbody>${rows}</tbody></table>`;
}

function renderRollups(p: PrecedentsResponse): string {
  const cells: string[] = [];
  if (p.bestCase) cells.push(`<div style="padding:4px 8px;font-size:11px"><span style="color:#86efac">Best case</span> · ${escapeHtml(p.bestCase)}</div>`);
  if (p.averageOutcome) cells.push(`<div style="padding:4px 8px;font-size:11px"><span style="color:#fde68a">Median</span> · ${escapeHtml(p.averageOutcome)}</div>`);
  if (p.worstCase) cells.push(`<div style="padding:4px 8px;font-size:11px"><span style="color:#fca5a5">Worst case</span> · ${escapeHtml(p.worstCase)}</div>`);
  if (cells.length === 0) return '';
  return `<div style="background:rgba(255,255,255,0.03);border-bottom:1px solid var(--panel-border,#2a2a2c)">${cells.join('')}</div>`;
}

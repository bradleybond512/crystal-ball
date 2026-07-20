/* eslint-disable sonarjs/no-nested-template-literals */
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  computePortCongestion, computeCanalStatus, computeChokepointRisk,
  CANAL_CONFIGS,
  type PortCode, type CanalId, type VesselPosition,
  type PortStatus, type CanalStatus, type RiskScore,
  type CongestionLevel,
} from '@/services/supplychain/supply-chain-service';

type Tab = 'ports' | 'canals' | 'risk';

const TAB_LABELS: Record<Tab, string> = {
  ports:  'Ports',
  canals: 'Canals',
  risk:   'Risk',
};

const LEVEL_COLOR: Record<CongestionLevel, string> = {
  low:      '#4caf50',
  moderate: '#ffeb3b',
  high:     '#ff9800',
  critical: '#ef4444',
};

const LEVEL_BG: Record<CongestionLevel, string> = {
  low:      'rgba(76,175,80,0.08)',
  moderate: 'rgba(255,235,59,0.08)',
  high:     'rgba(255,152,0,0.10)',
  critical: 'rgba(239,68,68,0.12)',
};

const ALL_PORTS: PortCode[] = ['USLA','USLGB','SGSIN','CNSHA','NLRTM','DEHAM','CNNGB','USNYK','BEANR','KRPUS'];
const ALL_CANALS: CanalId[] = ['suez','panama','bosphorus','malacca'];

const REFRESH_MS = 60_000;

function _trendArrow(trend: 'rising' | 'falling' | 'stable'): string {
  if (trend === 'rising') return '▲';
  if (trend === 'falling') return '▼';
  return '→';
}

function _trendColor(trend: 'rising' | 'falling' | 'stable'): string {
  if (trend === 'rising') return '#ef4444';
  if (trend === 'falling') return '#4caf50';
  return '#9e9e9e';
}

function _canalDisruptionLevel(s: CanalStatus): CongestionLevel {
  if (s.disruptionStatus === 'closed') return 'critical';
  if (s.disruptionStatus === 'restricted') return 'high';
  if (s.disruptionStatus === 'delayed') return 'moderate';
  return 'low';
}

export class SupplyChainDisruptionPanel extends Panel {
  private activeTab: Tab = 'ports';
  private portStatuses: PortStatus[] = [];
  private canalStatuses: CanalStatus[] = [];
  private riskScores: RiskScore[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private prevAnchored: Partial<Record<PortCode, number>> = {};
  private vessels: VesselPosition[] = [];
  private bdi: number | null = null;
  private bdiDate: string | null = null;
  private bdiDegraded = false;

  constructor() {
    super({
      id: 'supply-chain-disruption',
      title: 'Supply Chain Disruption',
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'Real-time port congestion, canal queue wait times, and chokepoint risk composite. ' +
        'Data from AIS vessel positions. Alerts fire on high/critical congestion.',
    });
    this._compute();
    this.render();
    void this._fetchBdi();
    this.refreshTimer = setInterval(() => {
      this._compute();
      this.render();
      void this._fetchBdi();
    }, REFRESH_MS);
  }

  /** Pull the live Baltic Dry Index from the sidecar; degraded = FRED proxy. */
  private async _fetchBdi(): Promise<void> {
    try {
      const resp = await fetch('/api/supplychain/bdi', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) { this.bdi = null; this.bdiDegraded = true; this.render(); return; }
      const data = (await resp.json()) as { bdi?: number; date?: string; degraded?: boolean };
      this.bdi = typeof data.bdi === 'number' ? data.bdi : null;
      this.bdiDate = data.date ?? null;
      this.bdiDegraded = data.degraded === true;
    } catch {
      this.bdi = null;
      this.bdiDegraded = true;
    }
    this.render();
  }

  /** Inject live AIS vessel positions from the data loader. */
  public setVessels(vessels: VesselPosition[]): void {
    this.vessels = vessels;
    this._compute();
    this.render();
  }

  private _compute(): void {
    const now = Date.now();
    this.portStatuses = ALL_PORTS.map((code) => {
      const status = computePortCongestion(this.vessels, code, this.prevAnchored[code], now);
      this.prevAnchored[code] = status.anchored;
      return status;
    }).sort((a, b) => b.congestionScore - a.congestionScore);

    this.canalStatuses = ALL_CANALS.map((id) => computeCanalStatus(this.vessels, id, now))
      .sort((a, b) => b.estimatedWaitHours - a.estimatedWaitHours);

    this.riskScores = this.canalStatuses.map((cs) => {
      const waitStress = Math.min(100, Math.round((cs.estimatedWaitHours / 48) * 100));
      return computeChokepointRisk(cs.name, waitStress, waitStress);
    }).sort((a, b) => b.score - a.score);
  }

  private render(): void {
    this.setContent(this._buildHtml());
    this._bindTabClicks();
  }

  private _buildHtml(): string {
    const tabs = (Object.keys(TAB_LABELS) as Tab[]).map((t) => {
      const active = t === this.activeTab;
      return `<button class="scd-tab" data-tab="${t}" role="tab" aria-selected="${active}"
        style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);
          background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};
          color:inherit;border-radius:4px;cursor:pointer;font-size:12px">
        ${escapeHtml(TAB_LABELS[t])}
      </button>`;
    }).join('');

    const tabBar = `<div style="display:flex;gap:4px;margin-bottom:10px">${tabs}</div>`;
    let body = '';
    if (this.activeTab === 'ports') body = this._buildPortsTab();
    else if (this.activeTab === 'canals') body = this._buildCanalsTab();
    else body = this._buildRiskTab();

    return `<div style="padding:8px">${tabBar}${body}</div>`;
  }

  private _levelBadge(level: CongestionLevel, text?: string): string {
    const label = escapeHtml(text ?? level.toUpperCase());
    return `<span style="font-size:10px;font-weight:700;color:${LEVEL_COLOR[level]};
      background:${LEVEL_BG[level]};border-radius:3px;padding:1px 5px">${label}</span>`;
  }

  private _buildPortsTab(): string {
    if (this.portStatuses.length === 0) {
      return '<p style="color:rgba(255,255,255,0.4);font-size:12px">No vessel data yet.</p>';
    }
    const rows = this.portStatuses.map((ps) => {
      const trendArrow = _trendArrow(ps.trend);
      const trendColor = _trendColor(ps.trend);
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;
          border-bottom:1px solid rgba(255,255,255,0.05)">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${escapeHtml(ps.name)}
            </div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4)">
              ${ps.anchored} anchored · ${ps.inTransit} transiting
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${this._levelBadge(ps.congestionLevel)}
            <span style="font-size:11px;color:${trendColor};margin-left:4px">${trendArrow}</span>
            <div style="font-size:10px;color:rgba(255,255,255,0.35)">${ps.congestionScore}/100</div>
          </div>
        </div>`;
    }).join('');
    return `<div>${rows}</div>`;
  }

  private _buildCanalsTab(): string {
    if (this.canalStatuses.length === 0) {
      return '<p style="color:rgba(255,255,255,0.4);font-size:12px">No vessel data yet.</p>';
    }
    const rows = this.canalStatuses.map((cs) => {
      const level = _canalDisruptionLevel(cs);
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;
          border-bottom:1px solid rgba(255,255,255,0.05)">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500">${escapeHtml(cs.name)}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4)">
              ${cs.queued} queued · ${cs.inTransit} in transit
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${this._levelBadge(level, cs.disruptionStatus)}
            <div style="font-size:10px;color:rgba(255,255,255,0.35)">
              ${cs.estimatedWaitHours}h wait
            </div>
          </div>
        </div>`;
    }).join('');
    return `<div>${rows}</div>`;
  }

  private _buildRiskTab(): string {
    const cfgNames: Record<CanalId, string> = {
      suez: CANAL_CONFIGS.suez.name,
      panama: CANAL_CONFIGS.panama.name,
      bosphorus: CANAL_CONFIGS.bosphorus.name,
      malacca: CANAL_CONFIGS.malacca.name,
    };
    const rows = this.riskScores.map((rs) => {
      const drivers = rs.drivers.slice(0, 2).map((d) => `<li>${escapeHtml(d)}</li>`).join('');
      return `
        <div style="margin-bottom:8px;padding:6px 8px;border-radius:6px;
          background:${LEVEL_BG[rs.level]};border:1px solid rgba(255,255,255,0.06)">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="font-size:12px;font-weight:500;flex:1">${escapeHtml(rs.location)}</span>
            ${this._levelBadge(rs.level)}
            <span style="font-size:11px;color:rgba(255,255,255,0.4)">${rs.score}/100</span>
          </div>
          ${drivers ? `<ul style="margin:0;padding-left:14px;font-size:10px;color:rgba(255,255,255,0.5)">${drivers}</ul>` : ''}
        </div>`;
    }).join('');
    const note = `<p style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:6px">
      Composite = 65% AIS closure risk + 35% freight stress. Canals: ${Object.values(cfgNames).join(', ')}.
    </p>`;
    return `<div>${rows || '<p style="color:rgba(255,255,255,0.4);font-size:12px">No risk data.</p>'}${this._buildBdiLine()}${note}</div>`;
  }

  private _buildBdiLine(): string {
    if (this.bdi === null && !this.bdiDegraded) return '';
    const value = this.bdi === null
      ? '<span style="color:rgba(255,255,255,0.4)">unavailable</span>'
      : `<strong>${escapeHtml(String(this.bdi))}</strong>${this.bdiDate ? ` <span style="color:rgba(255,255,255,0.35)">(${escapeHtml(this.bdiDate)})</span>` : ''}`;
    const warn = this.bdiDegraded
      ? '<div style="font-size:10px;color:#ff9800;margin-top:2px">⚠ Using index proxy (live BDI unavailable)</div>'
      : '';
    return `<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(255,255,255,0.6)">
      Baltic Dry Index: ${value}${warn}
    </div>`;
  }

  private _bindTabClicks(): void {
    const container = this.getContentElement();
    container.querySelectorAll<HTMLButtonElement>('.scd-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as Tab | undefined;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        this.render();
      }, { once: true });
    });
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
    super.destroy();
  }
}

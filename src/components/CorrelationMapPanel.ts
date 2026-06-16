import { Panel } from './Panel';
import { getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

interface ChainEvent {
  id: string;
  domain: string;
  title: string;
  severity: number;
  occurredAt: number;
}

interface CorrelationChain {
  id: string;
  chainType: string;
  title: string;
  confidence: number;
  detectedAt: number;
  events: ChainEvent[];
}

const DOMAIN_ICONS: Record<string, string> = {
  earthquake:      '🌋',
  tsunami:         '🌊',
  evacuation:      '🚨',
  wildfire:        '🔥',
  'air-quality':   '💨',
  health:          '🏥',
  weather:         '🌀',
  'supply-chain':  '🚢',
  commodity:       '📦',
  cyber:           '💻',
  infrastructure:  '⚡',
  economic:        '📉',
  conflict:        '⚔️',
  displacement:    '🏃',
  humanitarian:    '🤝',
  maritime:        '⚓',
  aviation:        '✈️',
};

const CHAIN_LABELS: Record<string, string> = {
  'seismic-cascade':   'Seismic Cascade',
  'wildfire-cascade':  'Wildfire Cascade',
  'hurricane-cascade': 'Hurricane Cascade',
  'cyber-cascade':     'Cyber Cascade',
  'conflict-cascade':  'Conflict Cascade',
  'maritime-economic': 'Maritime / Economic',
  'aviation-conflict': 'Aviation / Conflict',
};

function domainIcon(domain: string): string {
  return DOMAIN_ICONS[domain] ?? '🔗';
}

function confidenceColor(c: number): string {
  if (c >= 0.75) return '#ef4444';
  if (c >= 0.55) return '#f97316';
  if (c >= 0.4)  return '#eab308';
  return '#6b7280';
}

export class CorrelationMapPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private chains: CorrelationChain[] = [];
  private expandedId: string | null = null;
  private error: string | null = null;

  constructor() {
    super({
      id: 'correlation-map',
      title: 'Correlation Map',
      showCount: false,
      trackActivity: true,
      infoTooltip: 'Active cross-domain causal chains detected by the v2 correlation engine. Shows seismic, wildfire, hurricane, cyber, and conflict cascades.',
    });
    this.showLoading('Loading correlation chains…');
    this.start();
    this.attachDelegatedListeners();
  }

  private start(): void {
    void this.fetchAndRender();
    this.refreshTimer = setInterval(() => void this.fetchAndRender(), 30_000);
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private attachDelegatedListeners(): void {
    this.getContentElement().addEventListener('click', (e: Event) => {
      const target = (e.target as Element).closest('.cm2-chain');
      if (!target) return;
      const id = (target as HTMLElement).dataset.chainId ?? '';
      this.expandedId = this.expandedId === id ? null : id;
      this.render();
    });
  }

  private async fetchAndRender(): Promise<void> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/intelligence/correlations/chains`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { chains: CorrelationChain[] };
      this.chains = Array.isArray(data?.chains) ? data.chains : [];
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'fetch failed';
    }
    this.render();
  }

  private render(): void {
    this.setContent(this.buildHtml());
  }

  private buildHtml(): string {
    if (this.error) {
      return `<div style="padding:12px;color:var(--color-warning,#f97316);font-size:13px;">Correlation engine unavailable: ${escapeHtml(this.error)}</div>`;
    }

    if (this.chains.length === 0) {
      return `<div style="padding:16px;color:var(--text-muted,#888);font-size:13px;text-align:center;">No active correlation chains detected.</div>`;
    }

    const rows = this.chains.map(chain => this.buildChainRow(chain)).join('');
    return `<div class="cm2-list" style="display:flex;flex-direction:column;gap:4px;padding:8px;">${rows}</div>`;
  }

  private buildChainRow(chain: CorrelationChain): string {
    const expanded = this.expandedId === chain.id;
    const label = escapeHtml(CHAIN_LABELS[chain.chainType] ?? chain.chainType);
    const pct = Math.round(chain.confidence * 100);
    const color = confidenceColor(chain.confidence);
    const icons = escapeHtml(chain.events.map(e => domainIcon(e.domain)).join(' → '));
    const eventCount = chain.events.length;

    const header = `<div class="cm2-chain" data-chain-id="${escapeHtml(chain.id)}"
      style="border:1px solid var(--border-color,#333);border-radius:6px;padding:8px 10px;cursor:pointer;background:var(--surface-secondary,#1a1a1a);">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:11px;font-weight:600;color:${escapeHtml(color)};border-radius:4px;padding:2px 6px;white-space:nowrap;">${label}</span>
        <span style="font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
          title="${escapeHtml(chain.title)}">${icons}</span>
        <span style="font-size:11px;color:var(--text-muted,#888);white-space:nowrap;">${eventCount}&nbsp;event${eventCount === 1 ? '' : 's'}</span>
        <span style="font-size:11px;font-weight:600;color:${escapeHtml(color)};white-space:nowrap;">${pct}%</span>
      </div>
      <div style="margin-top:5px;height:4px;border-radius:2px;background:var(--border-color,#333);">
        <div style="height:100%;width:${pct}%;border-radius:2px;background:${escapeHtml(color)};"></div>
      </div>
    </div>`;

    if (!expanded) return header;

    const eventRows = chain.events.map(ev => `<div style="display:flex;align-items:baseline;gap:6px;padding:4px 0;border-bottom:1px solid var(--border-color,#222);">
      <span style="font-size:14px;">${domainIcon(ev.domain)}</span>
      <span style="font-size:11px;color:var(--text-muted,#888);min-width:80px;">${escapeHtml(ev.domain)}</span>
      <span style="font-size:12px;flex:1;">${escapeHtml(ev.title)}</span>
    </div>`).join('');

    const detail = `<div style="padding:6px 10px 8px;border:1px solid var(--border-color,#333);border-top:none;border-radius:0 0 6px 6px;background:var(--surface-tertiary,#111);font-size:12px;margin-bottom:4px;">${eventRows}</div>`;

    return header + detail;
  }
}

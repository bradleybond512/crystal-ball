import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getCausalChainBuilder } from '@/services/intelligence/causal-chain';
import { query as queryObservations } from '@/services/intelligence/observation-store';
import {
  chainsForPanel,
  type PanelCorrelationChain,
} from '@/services/correlation/causal-chain-view';
import { getCorrelationStore } from '@/services/intelligence/correlation-store';
import { buildLivePairRows, type LivePairRow } from '@/services/correlation/correlation-map-view';

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
  causal:              'Causal Chain',
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
  if (c >= 0.75) return 'var(--sev-critical,#ef4444)';
  if (c >= 0.55) return 'var(--sev-high,#f97316)';
  if (c >= 0.4)  return 'var(--sev-medium,#eab308)';
  return 'var(--text-muted,#6b7280)';
}

const LIVE_PAIR_WINDOW_MS = 24 * 3_600_000;

function formatAge(ageMs: number): string {
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export class CorrelationMapPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private chains: PanelCorrelationChain[] = [];
  private pairRows: LivePairRow[] = [];
  private expandedId: string | null = null;
  private error: string | null = null;

  constructor() {
    super({
      id: 'correlation-map',
      title: 'Correlation Map',
      showCount: false,
      trackActivity: true,
      infoTooltip: 'Active cross-domain causal chains from the live causal-chain builder — root cause, downstream effects, and chain confidence.',
    });
    this.showLoading('Loading correlation chains…');
    this.start();
    this.attachDelegatedListeners();
  }

  private start(): void {
    this.loadAndRender();
    this.refreshTimer = setInterval(() => this.loadAndRender(), 30_000);
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

  private loadAndRender(): void {
    try {
      // Read the live causal-chain builder directly — no sidecar hop.
      // (The old /api/intelligence/correlations/chains mirror had no
      // producer since correlator-v2 was retired; the route remains for
      // external posters but this panel no longer depends on it.)
      // Intermediate chain hops resolve against the observation ring
      // buffer; aged-out ones degrade to mechanism placeholders.
      const byId = new Map(queryObservations({ limit: 1000 }).map((o) => [o.id, o]));
      this.chains = chainsForPanel(
        getCausalChainBuilder().getChains(),
        (id) => byId.get(id),
      );
      this.pairRows = buildLivePairRows(getCorrelationStore().getRecent(LIVE_PAIR_WINDOW_MS), Date.now());
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'chain read failed';
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

    const liveSection = this.buildLivePairsSection();

    if (this.chains.length === 0) {
      return `${liveSection}<div style="padding:16px;color:var(--text-muted,#888);font-size:13px;text-align:center;">No active correlation chains detected.</div>`;
    }

    const rows = this.chains.map(chain => this.buildChainRow(chain)).join('');
    return `${liveSection}<div class="cm2-list" style="display:flex;flex-direction:column;gap:4px;padding:8px;">${rows}</div>`;
  }

  private buildLivePairsSection(): string {
    const header = `<div style="font-size:11px;font-weight:600;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:0.03em;padding:8px 10px 4px;">Live correlations</div>`;

    if (this.pairRows.length === 0) {
      return `${header}<div style="padding:0 10px 10px;color:var(--text-muted,#888);font-size:13px;">No kernel-scored pairs in the last 24h.</div>`;
    }

    const rows = this.pairRows.map(row => this.buildPairRow(row)).join('');
    return `${header}<div class="cm2-pair-list" style="display:flex;flex-direction:column;gap:4px;padding:0 8px 8px;">${rows}</div>`;
  }

  private buildPairRow(row: LivePairRow): string {
    const pct = Math.round(row.confidence * 100);
    const color = confidenceColor(row.confidence);
    const badges = [
      row.learned
        ? `<span class="cm2-pair-badge-learned" style="font-size:10px;font-weight:700;color:#a855f7;border:1px solid #a855f7;border-radius:4px;padding:1px 5px;white-space:nowrap;">LEARNED</span>`
        : '',
      row.regimeBoosted
        ? `<span class="cm2-pair-badge-regime" style="font-size:10px;font-weight:700;color:#38bdf8;border:1px solid #38bdf8;border-radius:4px;padding:1px 5px;white-space:nowrap;">REGIME</span>`
        : '',
    ].join('');
    const chips = row.factorChips
      .map(c => `<span class="cm2-pair-chip" style="font-size:10px;color:var(--text-muted,#888);border:1px solid var(--border-color,#333);border-radius:4px;padding:1px 5px;white-space:nowrap;">${escapeHtml(c.key)}&times;${c.value}</span>`)
      .join('');

    return `<div class="cm2-pair" style="border:1px solid var(--border-color,#333);border-radius:6px;padding:6px 10px;background:var(--surface-secondary,#1a1a1a);" title="${escapeHtml(row.explanation)}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(row.fromDomain)}&nbsp;&rarr;&nbsp;${escapeHtml(row.toDomain)}</span>
        ${badges}
        <span style="font-size:11px;color:var(--text-muted,#888);white-space:nowrap;">${escapeHtml(formatAge(row.ageMs))}</span>
        <span style="font-size:11px;font-weight:600;color:${escapeHtml(color)};white-space:nowrap;">${pct}%</span>
      </div>
      ${chips ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">${chips}</div>` : ''}
    </div>`;
  }

  private buildChainRow(chain: PanelCorrelationChain): string {
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

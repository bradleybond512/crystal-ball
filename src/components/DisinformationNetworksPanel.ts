/**
 * DisinformationNetworksPanel (panel id: `disinformation-networks`)
 *
 * Tracks coordinated inauthentic behaviour (CIB), state-linked bot farms,
 * and platform takedowns.  Strictly analytical / defensive framing — the
 * panel surfaces detection events and attribution assessments only.
 *
 * Three sections, refreshed every 24 hours:
 *   1. Global CIB Index header
 *   2. Takedown log sorted by significance (Critical → Low)
 *   3. Active network profiles with scale and actor classification
 *
 * Pure logic lives in `disinformation-networks-helpers.ts` so classifiers
 * and aggregations remain testable in isolation.
 */
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  significanceColor,
  statusColor,
  networkScaleClass,
  actorClass,
  formatAccountCount,
  CIB_TAKEDOWNS,
  ACTIVE_NETWORKS,
  type CIBTakedown,
  type ActiveNetwork,
  type CIBRenderData,
} from './disinformation-networks-helpers';

const REFRESH_MS = 24 * 60 * 60_000; // 24 hours

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export class DisinformationNetworksPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'disinformation-networks',
      title: 'Disinformation Networks',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Coordinated inauthentic behaviour (CIB) tracker: documented platform ' +
        'takedowns, state-linked bot farms, and active influence networks. ' +
        'Data drawn from Meta, Google, Twitter/X, TikTok, and EU DSA enforcement ' +
        'reports (2022–2024). Strictly analytical — no offensive content generated.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    safe(() => this.render(), undefined);
    this.refreshTimer = setInterval(() => safe(() => this.render(), undefined), REFRESH_MS);
  }

  private render(): void {
    const data = safe(
      () => buildRenderData(CIB_TAKEDOWNS, ACTIVE_NETWORKS),
      {
        takedowns: [],
        activeNetworks: [],
        globalCIBIndex: 0,
        totalAccountsRemoved: 0,
        mostActiveActor: 'Unknown',
      } as CIBRenderData,
    );

    const critCount = data.takedowns.filter((t) => t.significance === 'Critical').length;
    const highCount = data.takedowns.filter((t) => t.significance === 'High').length;
    this.setCount(critCount + highCount);

    const html = [
      this.renderIndexHeader(data),
      this.renderTakedownLog(data.takedowns),
      this.renderActiveNetworks(data.activeNetworks),
    ].join('');

    this.setContent(`<div class="dn-panel">${html}</div>`);
  }

  // ── Section 1: Global CIB Index ─────────────────────────────────────────

  private renderIndexHeader(data: CIBRenderData): string {
    const idx      = data.globalCIBIndex;
    const idxColor = idx >= 75 ? '#ef4444' : idx >= 50 ? '#f97316' : idx >= 25 ? '#eab308' : '#4caf50';
    const totalFmt = formatAccountCount(data.totalAccountsRemoved);
    const actor    = escapeHtml(data.mostActiveActor);
    return `
      <div class="dn-index-header" style="padding:8px 10px;border-bottom:1px solid #333;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:12px">
          <div>
            <div style="font-size:10px;color:#9e9e9e;text-transform:uppercase;letter-spacing:.05em">Global CIB Index</div>
            <div style="font-size:28px;font-weight:700;color:${idxColor};line-height:1">${idx}<span style="font-size:13px;color:#9e9e9e">/100</span></div>
          </div>
          <div style="flex:1;display:flex;gap:16px;font-size:11px">
            <div>
              <div style="color:#9e9e9e">Accounts removed</div>
              <div style="color:#eee;font-weight:600">${totalFmt}</div>
            </div>
            <div>
              <div style="color:#9e9e9e">Most-documented actor</div>
              <div style="color:#eee;font-weight:600">${actor}</div>
            </div>
            <div>
              <div style="color:#9e9e9e">Takedowns logged</div>
              <div style="color:#eee;font-weight:600">${data.takedowns.length}</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── Section 2: Takedown log ──────────────────────────────────────────────

  private renderTakedownLog(takedowns: CIBTakedown[]): string {
    if (takedowns.length === 0) {
      return '<div class="panel-empty">No takedowns on record.</div>';
    }
    const rows = takedowns.map((t) => {
      const sigColor  = significanceColor(t.significance);
      const platform  = escapeHtml(
        t.platform.length > 30 ? t.platform.slice(0, 28) + '…' : t.platform,
      );
      const actor     = escapeHtml(t.actor);
      const narrative = escapeHtml(
        t.targetNarrative.length > 55 ? t.targetNarrative.slice(0, 53) + '…' : t.targetNarrative,
      );
      const accounts  = t.accountsRemoved > 0 ? formatAccountCount(t.accountsRemoved) : 'ongoing';
      const ongoingBadge = t.ongoing
        ? '<span style="font-size:9px;background:#b71c1c;color:#fff;border-radius:8px;padding:1px 5px;margin-left:4px">ONGOING</span>'
        : '';
      return `<tr>
        <td style="padding:3px 5px;font-size:10px;font-weight:700;color:${sigColor};white-space:nowrap">${escapeHtml(t.significance)}${ongoingBadge}</td>
        <td style="padding:3px 5px;font-size:11px;color:#ccc">${escapeHtml(t.date.slice(0, 7))}</td>
        <td style="padding:3px 5px;font-size:11px;color:#eee">${platform}</td>
        <td style="padding:3px 5px;font-size:11px;color:#f97316">${actor}</td>
        <td style="padding:3px 5px;font-size:11px;color:#9e9e9e;text-align:right">${accounts}</td>
        <td style="padding:3px 5px;font-size:11px;color:#ccc">${narrative}</td>
      </tr>`;
    }).join('');

    return `
      <div class="dn-section" style="margin-bottom:10px">
        <div class="app-section-header" style="padding:4px 10px;font-size:11px;color:#9e9e9e;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #333">
          Platform Takedown Log
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="font-size:10px;color:#666;text-transform:uppercase">
              <th style="padding:3px 5px;text-align:left">Sig.</th>
              <th style="padding:3px 5px;text-align:left">Date</th>
              <th style="padding:3px 5px;text-align:left">Platform</th>
              <th style="padding:3px 5px;text-align:left">Actor</th>
              <th style="padding:3px 5px;text-align:right">Accounts</th>
              <th style="padding:3px 5px;text-align:left">Target narrative</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Section 3: Active network profiles ──────────────────────────────────

  private renderActiveNetworks(networks: ActiveNetwork[]): string {
    if (networks.length === 0) {
      return '<div class="panel-empty">No active networks on record.</div>';
    }
    const scaleColors: Record<string, string> = {
      massive: '#ef4444', large: '#f97316', medium: '#eab308', small: '#4caf50',
    };
    const cards = networks.map((n) => {
      const stColor    = statusColor(n.status);
      const scale      = networkScaleClass(n.estimatedAccounts);
      const aClass     = actorClass(n.actor);
      const actorBadge = aClass === 'state'
        ? '<span style="font-size:9px;background:#4a237a;color:#ce9eff;border-radius:8px;padding:1px 5px;margin-left:4px">STATE</span>'
        : '';
      const scaleDot   = `<span style="font-size:9px;color:${scaleColors[scale] ?? '#ccc'}">&#x25CF;</span>`;
      const narratives = n.primaryNarratives
        .map((nar) => `<li style="font-size:10px;color:#ccc;margin-bottom:1px">${escapeHtml(nar)}</li>`)
        .join('');
      const platformList = escapeHtml(n.platforms.join(', '));
      return `
        <div class="dn-net-card" style="border:1px solid #333;border-radius:4px;padding:6px 8px;margin-bottom:6px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <div style="font-size:12px;font-weight:600;color:#eee">${scaleDot} ${escapeHtml(n.name)}${actorBadge}</div>
            <div style="font-size:10px;font-weight:700;color:${stColor};text-transform:uppercase">${escapeHtml(n.status)}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;color:#9e9e9e;margin-bottom:4px">
            <div>Actor: <span style="color:#f97316">${escapeHtml(n.actor)}</span></div>
            <div>Est. accounts: <span style="color:#eee">${formatAccountCount(n.estimatedAccounts)}</span></div>
            <div style="grid-column:span 2">Platforms: <span style="color:#ccc">${platformList}</span></div>
          </div>
          <ul style="margin:0;padding-left:12px">${narratives}</ul>
        </div>`;
    }).join('');

    return `
      <div class="dn-section">
        <div class="app-section-header" style="padding:4px 10px;font-size:11px;color:#9e9e9e;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #333;margin-bottom:6px">
          Active CIB Networks
        </div>
        <div style="padding:0 6px">${cards}</div>
      </div>`;
  }
}

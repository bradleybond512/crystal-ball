/**
 * DisinformationNetworksPanel (panel id: `disinformation-networks`).
 *
 * Tracks coordinated inauthentic behaviour (CIB), state-linked bot farms,
 * and platform takedowns.  Distinct from PropagandaTracking (which covers
 * overt state media); this panel focuses on covert platform manipulation.
 *
 * Sections:
 *   1. CIB Takedown Database   (10 major ops, 2022-2024)
 *   2. Active Network Profiles (IRA successors, Dragonbridge, MOIS, 50-cent)
 *   3. Global CIB Index        (quarterly accounts removed)
 *   4. Narrative Hotspots      (elections, Ukraine, Gaza, Taiwan, climate)
 *
 * Pure logic lives in `disinformation-networks-helpers.ts`.
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  CIB_TAKEDOWNS,
  ACTIVE_NETWORK_PROFILES,
  QUARTERLY_CIB_DATA,
  NARRATIVE_HOTSPOTS,
  formatAccountCount,
  type TakedownRow,
  type ProfileRow,
  type HotspotRow,
  type QuarterlyCibData,
  type CibRenderData,
} from './disinformation-networks-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'app-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
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
        'Tracks coordinated inauthentic behaviour (CIB), state-linked bot farms, and platform takedowns. ' +
        'Sources: Meta, Twitter/X, Google, TikTok transparency reports and EU DSA enforcement actions. ' +
        'Distinct from PropagandaTracking which covers overt state media.',
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
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const data: CibRenderData =
      safe(() =>
        buildRenderData(
          CIB_TAKEDOWNS,
          ACTIVE_NETWORK_PROFILES,
          QUARTERLY_CIB_DATA,
          NARRATIVE_HOTSPOTS,
        ),
      ) ??
      buildRenderData(
        CIB_TAKEDOWNS,
        ACTIVE_NETWORK_PROFILES,
        QUARTERLY_CIB_DATA,
        NARRATIVE_HOTSPOTS,
      );

    this.setCount(data.activeNetworkCount + data.criticalHotspotCount);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildSummaryBar(data),
        this.buildTakedownSection(data.takedownRows),
        this.buildProfileSection(data.profileRows),
        this.buildQuarterlySection(
          data.quarterlyData,
          data.totalAccountsRemoved,
          data.totalTakedowns,
        ),
        this.buildHotspotSection(data.hotspotRows),
      ),
    );
  }

  // ── Summary bar ─────────────────────────────────────────────────────────

  private buildSummaryBar(data: CibRenderData): HTMLElement {
    return h('div', {
      style:
        'display:flex;gap:16px;padding:6px 8px;background:rgba(255,255,255,0.04);' +
        'border-radius:6px;margin-bottom:4px;flex-wrap:wrap',
    },
      this.statChip('Active Networks',   String(data.activeNetworkCount),                '#ef4444'),
      this.statChip('Critical Hotspots', String(data.criticalHotspotCount),              '#fb923c'),
      this.statChip('Total Ops',         String(data.totalTakedowns),                    '#facc15'),
      this.statChip('Accounts Removed',  formatAccountCount(data.totalAccountsRemoved),  '#4caf50'),
    );
  }

  private statChip(label: string, value: string, color: string): HTMLElement {
    return h('div', { style: 'display:flex;flex-direction:column;align-items:center;min-width:80px' },
      h('span', { style: `font-size:16px;font-weight:700;color:${color}` }, value),
      h('span', { style: 'font-size:10px;color:#9e9e9e;text-transform:uppercase' }, label),
    );
  }

  // ── Section 1: CIB Takedowns ─────────────────────────────────────────────

  private buildTakedownSection(rows: TakedownRow[]): HTMLElement {
    const badge = rows.length > 0 ? countBadge(rows.length, 'ops') : undefined;
    const tbody = h('tbody');
    for (const r of rows) {
      const actorShort = r.actorLabel.split('(')[0]?.trim() ?? r.actorLabel;
      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${r.actorColor}` }, actorShort),
          cell(r.platform, 'color:#ccc'),
          cell(r.accountLabel, 'color:#facc15;text-align:right'),
          cell(r.date.slice(0, 7), 'color:#9e9e9e'),
          cell(r.targetRegion, 'color:#ccc;font-size:11px'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${r.statusColor};text-align:right`,
          }, r.statusLabel),
        ),
        h('tr',
          h('td', {
            colSpan: 6,
            style: 'padding:1px 6px 5px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid rgba(255,255,255,0.05)',
          }, `${r.name} — ${r.notableDetail}`),
        ),
      );
    }
    return h('div', { className: 'app-section' },
      sectionHeader('CIB Takedown Database (2022–2024)', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Actor · platform · accounts · date · target · status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Active Network Profiles ──────────────────────────────────

  private buildProfileSection(rows: ProfileRow[]): HTMLElement {
    const activeCount = rows.filter((r) => r.active).length;
    const badge = activeCount > 0 ? countBadge(activeCount, 'active') : undefined;
    const tbody = h('tbody');
    for (const r of rows) {
      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${r.actorColor}` }, r.name),
          cell(r.accountLabel, 'color:#facc15;text-align:right'),
          cell(r.platformList, 'color:#9e9e9e;font-size:10px'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${r.threatColor};text-align:right`,
          }, r.threatLabel),
        ),
        h('tr',
          h('td', {
            colSpan: 4,
            style: 'padding:1px 6px 5px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid rgba(255,255,255,0.05)',
          }, r.objective),
        ),
      );
    }
    return h('div', { className: 'app-section' },
      sectionHeader('Active Network Profiles', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Network · estimated accounts · platforms · threat level',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Global CIB Index ──────────────────────────────────────────

  private buildQuarterlySection(
    quarterly: QuarterlyCibData[],
    totalAccounts: number,
    totalTakedowns: number,
  ): HTMLElement {
    const maxAccounts = Math.max(...quarterly.map((q) => q.accountsRemoved), 1);
    const recent = quarterly.slice(-6);
    const tbody = h('tbody');
    for (const q of recent) {
      const barWidth = Math.round((q.accountsRemoved / maxAccounts) * 100);
      tbody.append(
        h('tr',
          cell(q.quarter, 'color:#9e9e9e;white-space:nowrap'),
          h('td', { style: 'padding:3px 6px;width:40%' },
            h('div', {
              style: `width:${barWidth}%;height:8px;background:#ef4444;border-radius:2px;min-width:2px`,
            }),
          ),
          cell(formatAccountCount(q.accountsRemoved), 'color:#facc15;text-align:right'),
          cell(`${q.takedownCount} ops`, 'color:#9e9e9e;text-align:right'),
        ),
      );
    }
    return h('div', { className: 'app-section' },
      sectionHeader('Global CIB Index — Accounts Removed per Quarter'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        `Last 6 quarters · total removed: ${formatAccountCount(totalAccounts)} · ops logged: ${totalTakedowns}`,
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Narrative Hotspots ────────────────────────────────────────

  private buildHotspotSection(rows: HotspotRow[]): HTMLElement {
    const highCount = rows.filter((r) => r.intensity >= 80).length;
    const badge = highCount > 0 ? countBadge(highCount, 'critical') : undefined;
    const tbody = h('tbody');
    for (const r of rows) {
      let barColor = '#facc15';
      if (r.intensity >= 80) barColor = '#ef4444';
      else if (r.intensity >= 60) barColor = '#fb923c';
      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;color:#fff' }, r.topic),
          h('td', { style: 'padding:3px 6px;width:25%' },
            h('div', {
              style: `width:${r.intensity}%;height:8px;background:${barColor};border-radius:2px;min-width:2px`,
            }),
          ),
          cell(String(r.intensity), 'color:#facc15;text-align:right;font-weight:600'),
          h('td', { style: `padding:3px 6px;font-size:10px;color:${r.trendColor};text-align:right` }, r.trendLabel),
        ),
        h('tr',
          h('td', {
            colSpan: 4,
            style: 'padding:1px 6px 5px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid rgba(255,255,255,0.05)',
          }, `Regions: ${r.regionList} · Actors: ${r.actorList}`),
        ),
      );
    }
    return h('div', { className: 'app-section' },
      sectionHeader('Narrative Hotspots', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Topic · intensity (0–100) · trend',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}

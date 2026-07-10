/**
 * WarlordEconomicsPanel (panel id `warlord-economics`).
 *
 * Tracks conflict financing, resource exploitation by armed non-state actors,
 * and the economic underpinnings of prolonged civil conflicts.
 *
 * Four sections:
 *   1. Global Conflict Economy Index  0-100 aggregate severity score.
 *   2. Conflict Economy Profiles       10 active profiles with revenue data.
 *   3. High Revenue Actors             profiles above $500M/yr.
 *   4. Resource Type Distribution      dominant resource categories + top regions.
 *
 * Pure helpers live in `warlord-economics-helpers.ts`. Refresh: 24 hours.
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  CONFLICT_ECONOMY_PROFILES,
  buildRenderData,
  revenueClassColor,
  resourceTypeLabel,
  resourceTypeClass,
  type ConflictEconomyProfile,
  type ConflictEconomyRenderRow,
  type GlobalConflictEconomyIndex,
  type WarlordEconomicsRenderData,
} from './warlord-economics-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

const TOOLTIP =
  'Analytical view of conflict-economy dynamics: resource exploitation and ' +
  'financing by armed non-state actors across 10 active conflict zones. ' +
  'Covers minerals, narcotics, gold, jade, port fees, kidnapping, and ' +
  'taxation revenue streams. 24-hour refresh.';

function safe<T>(fn: () => T): T | null {
  try { return fn() ?? null; } catch { return null; }
}

export class WarlordEconomicsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'warlord-economics',
      title: 'Warlord Economics',
      showCount: true,
      trackActivity: true,
      infoTooltip: TOOLTIP,
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
    const profiles = safe(() => CONFLICT_ECONOMY_PROFILES) ?? [];
    const data: WarlordEconomicsRenderData = safe(() => buildRenderData(profiles)) ?? {
      rows: [],
      globalIndex: {
        totalAnnualRevenueBillions: 0,
        profileCount: 0,
        megaRevenueCount: 0,
        majorRevenueCount: 0,
        topRegions: [],
        dominantResourceTypes: [],
        indexScore: 0,
      },
      highRevenueProfiles: [],
      updatedAt: new Date().toISOString(),
    };

    this.setCount(data.globalIndex.profileCount);

    const root = h('div', { className: 'wep-root' },
      this.renderIndexSection(data.globalIndex),
      this.renderProfilesSection(data.rows),
      this.renderHighRevenueSection(data.highRevenueProfiles),
      this.renderResourceDistributionSection(data.globalIndex),
    );
    replaceChildren(this.content, root);
  }

  // ── Section 1: Global Conflict Economy Index ─────────────────────────────

  private renderIndexSection(idx: GlobalConflictEconomyIndex): HTMLElement {
    const score = idx.indexScore;
    const widthPct = Math.max(0, Math.min(100, score));
    let scoreColor = 'var(--severity-low,      #4caf50)';
    if (score >= 75) scoreColor = 'var(--severity-critical, #ef4444)';
    else if (score >= 50) scoreColor = 'var(--severity-high,     #fb923c)';
    else if (score >= 25) scoreColor = 'var(--severity-medium,   #facc15)';

    const badges: HTMLElement[] = [];
    if (idx.megaRevenueCount > 0) {
      badges.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, String(idx.megaRevenueCount) + ' mega'));
    }
    if (idx.majorRevenueCount > 0) {
      badges.push(h('span', {
        style: 'margin-left:4px;font-size:10px;background:#e65100;color:#fff;border-radius:10px;padding:1px 6px',
      }, String(idx.majorRevenueCount) + ' major'));
    }

    return h('div', { className: 'wep-section' },
      h('div', { className: 'wep-section-header', style: 'display:flex;align-items:baseline;gap:8px' },
        h('span', null, 'Global Conflict Economy Index'),
        ...badges,
        h('span', { style: 'margin-left:auto;font-size:18px;font-weight:600' }, String(score), '/100'),
      ),
      h('div', { style: 'background:#1f1f1f;border-radius:3px;height:8px;overflow:hidden;margin:6px 0 4px' },
        h('div', { style: 'background:' + scoreColor + ';width:' + String(widthPct) + '%;height:8px;border-radius:3px' }),
      ),
      h('div', { style: 'font-size:11px;color:#9e9e9e' },
        String(idx.profileCount) + ' active conflict economies — est. $' + idx.totalAnnualRevenueBillions.toFixed(1) + 'B/yr combined revenue',
      ),
    );
  }

  // ── Section 2: Conflict Economy Profiles ─────────────────────────────────

  private renderProfilesSection(rows: readonly ConflictEconomyRenderRow[]): HTMLElement {
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const row of rows) table.append(this.renderProfileRow(row));
    return h('div', { className: 'wep-section' },
      h('div', { className: 'wep-section-header' }, 'Conflict Economy Profiles'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Actor · primary resources · est. annual revenue · external backers',
      ),
      table,
    );
  }

  private renderProfileRow(row: ConflictEconomyRenderRow): HTMLElement {
    const { profile, revenueColor, revenueRangeLabel } = row;
    const resourceTags = profile.primaryRevenueSources.slice(0, 3).map((rt) =>
      h('span', {
        className: resourceTypeClass(rt),
        style: 'font-size:9px;background:#2a2a2a;border-radius:3px;padding:1px 4px;margin-right:3px',
      }, resourceTypeLabel(rt)),
    );
    const backersText = profile.externalBackers.length > 0
      ? profile.externalBackers.join(', ')
      : 'None identified';
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:4px 6px;font-size:12px;font-weight:600;vertical-align:top' }, profile.name),
        h('td', { style: 'padding:4px 6px;font-size:11px;vertical-align:top' }, ...resourceTags),
        h('td', { style: 'padding:4px 6px;font-size:11px;text-align:right;vertical-align:top;color:' + revenueColor },
          revenueRangeLabel,
        ),
      ),
      h('tr', null,
        h('td', { colspan: '3', style: 'padding:0 6px 2px 6px;font-size:10px;color:#aaa' },
          h('span', { style: 'color:#9e9e9e' }, 'Actor: '),
          profile.controllingActor,
          h('span', { style: 'color:#666;margin-left:8px' }, 'Backers: '),
          backersText,
        ),
      ),
      h('tr', null,
        h('td', { colspan: '3', style: 'padding:0 6px 6px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' },
          profile.keyNote,
        ),
      ),
    );
  }

  // ── Section 3: High Revenue Actors ───────────────────────────────────────

  private renderHighRevenueSection(profiles: readonly ConflictEconomyProfile[]): HTMLElement {
    const headerChildren: (HTMLElement | string)[] = ['High Revenue Actors (>$500M/yr)'];
    if (profiles.length > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, String(profiles.length) + ' actors'));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const p of profiles) {
      const color = revenueClassColor(p.annualRevenueMidBillions >= 1 ? 'mega' : 'major');
      const midStr = p.annualRevenueMidBillions >= 1
        ? '$' + p.annualRevenueMidBillions.toFixed(1) + 'B/yr'
        : '$' + String(Math.round(p.annualRevenueMidBillions * 1000)) + 'M/yr';
      table.append(h('tbody', null,
        h('tr', null,
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, p.name),
          h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, p.controllingActor),
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;text-align:right;color:' + color }, midStr),
        ),
        h('tr', null,
          h('td', { colspan: '3', style: 'padding:0 6px 4px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' },
            'Resources: ' + p.primaryRevenueSources.map(s => resourceTypeLabel(s)).join(', '),
          ),
        ),
      ));
    }
    return h('div', { className: 'wep-section' },
      h('div', { className: 'wep-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Actors with estimated annual revenue >= $500M',
      ),
      table,
    );
  }

  // ── Section 4: Resource Type Distribution ────────────────────────────────

  private renderResourceDistributionSection(idx: GlobalConflictEconomyIndex): HTMLElement {
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const maxCount = idx.dominantResourceTypes[0]?.profileCount ?? 1;
    for (const { type, profileCount } of idx.dominantResourceTypes) {
      const pct = Math.round((profileCount / maxCount) * 100);
      const barColor = 'var(--severity-medium, #facc15)';
      table.append(h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:11px;font-weight:600;width:130px' }, resourceTypeLabel(type)),
        h('td', { style: 'padding:3px 6px' },
          h('div', { style: 'background:#1f1f1f;border-radius:2px;height:6px' },
            h('div', { style: 'background:' + barColor + ';width:' + String(pct) + '%;height:6px;border-radius:2px' }),
          ),
        ),
        h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right;color:#9e9e9e;width:60px' },
          String(profileCount) + ' actors',
        ),
      ));
    }

    const regionTable = h('table', { style: 'width:100%;border-collapse:collapse;margin-top:6px' });
    for (const { region, totalBillions } of idx.topRegions) {
      regionTable.append(h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:11px;font-weight:600' }, region),
        h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right;color:#9e9e9e' },
          '$' + totalBillions.toFixed(1) + 'B/yr est.',
        ),
      ));
    }

    return h('div', { className: 'wep-section' },
      h('div', { className: 'wep-section-header' }, 'Resource Type Distribution'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Top resource types by actor count'),
      table,
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin:8px 0 4px' }, 'Top regions by combined estimated revenue'),
      regionTable,
    );
  }
}

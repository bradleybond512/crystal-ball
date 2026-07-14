/**
 * GreatPowerCompetitionPanel — 5-domain balance of power tracker.
 *
 * Actors: US · China · Russia · EU
 * Domains: Military · Economic · Diplomatic · Tech · Informational
 *
 * Layout: domain × actor grid with per-cell score + trend arrow.
 * Bottom row shows composite power index per actor.
 * Right column shows domain leader (who is ahead + gap).
 *
 * Refresh: 1 hour (data changes slowly; model is deterministic).
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getMockActorData,
  buildRenderData,
  type PowerRenderData,
  type TrendDirection,
} from './great-power-competition-helpers';

const REFRESH_MS = 3_600_000; // 1 hour

// ── Colour palette ────────────────────────────────────────────────────────────

const TREND_ARROW: Record<TrendDirection, string> = {
  rising:  '↑',
  falling: '↓',
  stable:  '→',
};

const TREND_COLOR: Record<TrendDirection, string> = {
  rising:  '#4caf50',
  falling: '#ff453a',
  stable:  '#9e9e9e',
};

function scoreColor(score: number): string {
  if (score >= 80) return '#4caf50';
  if (score >= 60) return '#ffeb3b';
  if (score >= 40) return '#ff9800';
  return '#ff453a';
}

const DOMAIN_LABELS: Record<string, string> = {
  military:   'Military',
  economic:   'Economic',
  diplomatic: 'Diplomatic',
  tech:       'Technology',
  info:       'Information',
};

const DOMAIN_ORDER = ['military', 'economic', 'diplomatic', 'tech', 'info'] as const;

// ── Panel class ───────────────────────────────────────────────────────────────

export class GreatPowerCompetitionPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'great-power-competition',
      title: 'Great Power Competition',
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'Five-domain balance of power across US, China, Russia, and EU. ' +
        'Scores 0-100 per domain. Trend arrows reflect change since last period. ' +
        'Composite index uses weighted average: Military 25%, Economic 25%, Diplomatic 20%, Tech 20%, Info 10%.',
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
    try {
      const actorDataSet = getMockActorData();
      const renderData = buildRenderData(actorDataSet);
      this.setContent(this.buildHtml(renderData));
    } catch (error) {
      this.showError(`Great Power Competition panel failed to render: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildHtml(data: PowerRenderData): string {
    const { actors, domainBalances } = data;
    const actorNames = actors.map((a) => a.name);

    const headerRow = this.buildHeaderRow(actorNames);
    const domainRows = DOMAIN_ORDER.map((domain) =>
      this.buildDomainRow(domain, actors, domainBalances[domain]),
    ).join('');
    const compositeRow = this.buildCompositeRow(actors);
    const legend = this.buildLegend();

    return `
      <div style="padding:8px 10px 4px;font-size:11px;color:var(--text-secondary,#888);">
        Balance of power across 5 domains · Updated ${new Date(data.updatedAt).toLocaleTimeString()}
      </div>
      <div style="overflow-x:auto;">
        <table role="table" style="width:100%;border-collapse:collapse;font-size:12px;min-width:420px;">
          <thead>${headerRow}</thead>
          <tbody>
            ${domainRows}
            ${compositeRow}
          </tbody>
        </table>
      </div>
      ${legend}
    `;
  }

  private buildHeaderRow(actorNames: string[]): string {
    const actorHeaders = actorNames
      .map(
        (name) =>
          `<th scope="col" style="padding:6px 10px;font-weight:700;text-align:center;color:var(--text-primary,#e5e5e5);">${escapeHtml(name)}</th>`,
      )
      .join('');
    return `
      <tr style="text-align:left;color:var(--text-secondary,#888);border-bottom:2px solid var(--border-subtle,#444);">
        <th scope="col" style="padding:6px 10px;font-weight:600;">Domain</th>
        ${actorHeaders}
        <th scope="col" style="padding:6px 10px;font-weight:600;text-align:center;">Leader</th>
      </tr>
    `;
  }

  private buildDomainRow(
    domain: typeof DOMAIN_ORDER[number],
    actors: PowerRenderData['actors'],
    balance: PowerRenderData['domainBalances'][string] | undefined,
  ): string {
    const cells = actors
      .map((actor) => {
        const ds = actor.domains[domain];
        const color = scoreColor(ds.score);
        const arrow = TREND_ARROW[ds.trend];
        const arrowColor = TREND_COLOR[ds.trend];
        return `<td style="padding:7px 10px;text-align:center;">
          <span style="font-family:ui-monospace,monospace;font-weight:700;color:${color};">${ds.score.toFixed(1)}</span>
          <span style="font-size:10px;color:${arrowColor};margin-left:2px;" aria-label="${escapeHtml(ds.trend)}">${arrow}</span>
        </td>`;
      })
      .join('');

    const leaderCell = balance
      ? `<td style="padding:7px 8px;text-align:center;font-size:11px;">
          <span style="font-weight:700;color:var(--text-primary,#e5e5e5);">${escapeHtml(balance.leader)}</span>
          <span style="color:var(--text-secondary,#888);margin-left:3px;">+${balance.gap.toFixed(1)}</span>
        </td>`
      : '<td style="padding:7px 8px;text-align:center;color:var(--text-secondary,#888);">—</td>';

    const label = DOMAIN_LABELS[domain] ?? domain;
    return `<tr style="border-bottom:1px solid var(--border-subtle,#222);">
      <td style="padding:7px 10px;font-weight:600;color:var(--text-secondary,#aaa);white-space:nowrap;">${escapeHtml(label)}</td>
      ${cells}
      ${leaderCell}
    </tr>`;
  }

  private buildCompositeRow(actors: PowerRenderData['actors']): string {
    const cells = actors
      .map((actor) => {
        const color = scoreColor(actor.composite);
        return `<td style="padding:8px 10px;text-align:center;border-top:2px solid var(--border-subtle,#444);">
          <span style="font-family:ui-monospace,monospace;font-weight:800;font-size:14px;color:${color};">${actor.composite.toFixed(1)}</span>
        </td>`;
      })
      .join('');

    return `<tr>
      <td style="padding:8px 10px;font-weight:700;color:var(--text-primary,#e5e5e5);border-top:2px solid var(--border-subtle,#444);white-space:nowrap;">Composite</td>
      ${cells}
      <td style="border-top:2px solid var(--border-subtle,#444);"></td>
    </tr>`;
  }

  private buildLegend(): string {
    return `
      <div style="padding:8px 12px;display:flex;gap:16px;flex-wrap:wrap;font-size:10px;color:var(--text-secondary,#888);border-top:1px solid var(--border-subtle,#2a2a2a);">
        <span style="color:#4caf50;">■</span> ≥80 Strong&nbsp;
        <span style="color:#ffeb3b;">■</span> 60-79 Competitive&nbsp;
        <span style="color:#ff9800;">■</span> 40-59 Moderate&nbsp;
        <span style="color:#ff453a;">■</span> &lt;40 Weak&nbsp;&nbsp;
        <span style="color:#4caf50;">↑</span> Rising&nbsp;
        <span style="color:#9e9e9e;">→</span> Stable&nbsp;
        <span style="color:#ff453a;">↓</span> Falling
      </div>
    `;
  }
}

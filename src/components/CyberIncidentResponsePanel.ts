/**
 * CyberIncidentResponsePanel (panel id `cyber-incident-response`).
 *
 * Deep-intelligence incident-response panel for active cyber events.
 * Six sections:
 *   1. Incident Severity Score   composite 0-100 gauge with band label.
 *   2. Active CVE Exploits       CVEs being abused in the wild (KEV-aware).
 *   3. Ransomware Campaigns      group leaderboard with 7d/30d trend.
 *   4. APT Activity              named groups + activity tier + TTPs.
 *   5. Critical Infrastructure   ICS/OT indicators by sector + region.
 *   6. Threat Intel Feeds        OTX / CISA / NVD / etc. aggregation.
 *
 * Live `ObservationEvent`s (domain: 'cyber') feed the CVE exploits
 * section. Ransomware / APT / ICS / feeds use the static catalogues
 * exported by the helpers module — those are designed to be lifted
 * out into separate services later without touching the panel.
 */

import { Panel } from './Panel';
import * as obsStore from '@/services/intelligence/observation-store';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  apTActivityColor,
  apTActivityLabel,
  computeIncidentScore,
  countCriticalIcsIndicators,
  countImminentApT,
  deriveCveExploits,
  icsSectorLabel,
  intelFeedColor,
  ransomwareTrendArrow,
  ransomwareTrendColor,
  severityColor,
  severityLabel,
  sumHighSeverityFeedIndicators,
  timeAgo,
  totalRansomwareVictims7d,
  APT_GROUPS,
  ICS_INDICATORS_BASE,
  INTEL_FEEDS_BASE,
  RANSOMWARE_CAMPAIGNS,
  type ApTGroup,
  type CveExploit,
  type CyberIncidentScore,
  type IcsIndicator,
  type IntelFeedRow,
  type RansomwareCampaign,
} from './cyber-incident-helpers';
import type { ObservationEvent } from '@/types/intelligence';

const REFRESH_MS = 2 * 60 * 1000;
const TOOLTIP =
  'Live cyber-incident response: composite severity score, in-the-wild CVE exploits, ransomware leaderboards, nation-state APT activity, critical-infrastructure indicators, and threat-intel feed aggregation. 2-minute refresh.';

function safe<T>(fn: () => T): T | null {
  try { return fn() ?? null; } catch { return null; }
}

export class CyberIncidentResponsePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'cyber-incident-response',
      title: 'Cyber Incident Response',
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
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  private render(): void {
    const cyberEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'cyber', limit: 500 }),
    ) ?? [];
    const cveExploits = deriveCveExploits(cyberEvents);
    const ransomware = RANSOMWARE_CAMPAIGNS;
    const aptGroups = APT_GROUPS;
    const icsIndicators = ICS_INDICATORS_BASE;
    const feeds = INTEL_FEEDS_BASE;

    const score = computeIncidentScore({
      activeExploits: cveExploits.filter((c) => c.exploitedInWild).length,
      ransomwareVictims7d: totalRansomwareVictims7d(ransomware),
      imminentAptGroups: countImminentApT(aptGroups),
      criticalIcsIndicators: countCriticalIcsIndicators(icsIndicators),
      highSeverityFeedIndicators: sumHighSeverityFeedIndicators(feeds),
    });

    this.setCount(score.total);
    const root = h('div', { className: 'cir-root' },
      this.renderScoreSection(score),
      this.renderCveSection(cveExploits),
      this.renderRansomwareSection(ransomware),
      this.renderApTSection(aptGroups),
      this.renderIcsSection(icsIndicators),
      this.renderFeedsSection(feeds),
    );
    replaceChildren(this.content, root);
  }

  // ── Section 1: Incident Severity Score ───────────────────────────────

  private renderScoreSection(score: CyberIncidentScore): HTMLElement {
    const color = severityColor(score.level);
    const widthPct = Math.max(0, Math.min(100, score.total));
    return h('div', { className: 'cir-section' },
      h('div', { className: 'cir-section-header', style: 'display:flex;align-items:baseline;gap:8px' },
        h('span', null, 'Incident Severity Score'),
        h('span', { style: `font-size:11px;color:${color};text-transform:uppercase;letter-spacing:0.04em` },
          severityLabel(score.level)),
        h('span', { style: 'margin-left:auto;font-size:18px;font-weight:600' }, String(score.total), '/100'),
      ),
      h('div', { style: 'background:#1f1f1f;border-radius:3px;height:8px;overflow:hidden;margin:6px 0 4px' },
        h('div', { style: `background:${color};width:${widthPct}%;height:8px;border-radius:3px` }),
      ),
      h('div', { style: 'font-size:11px;color:#9e9e9e' },
        `Contributions — CVEs ${score.contributions.activeExploits}, ransomware ${score.contributions.ransomware}, APT ${score.contributions.apt}, ICS ${score.contributions.ics}, feeds ${score.contributions.feedActivity}`,
      ),
    );
  }

  // ── Section 2: Active CVE Exploits ──────────────────────────────────

  private renderCveSection(rows: CveExploit[]): HTMLElement {
    const exploited = rows.filter((c) => c.exploitedInWild).length;
    const badgeChildren: (HTMLElement | string | null)[] = ['Active CVE Exploits'];
    if (exploited > 0) {
      badgeChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${exploited} in the wild`));
    }
    const header = h('div', { className: 'cir-section-header' }, ...badgeChildren);
    const body = rows.length === 0
      ? h('div', { style: 'font-size:11px;color:#9e9e9e;padding:4px 6px' }, 'No CVE exploits observed in last 14 days.')
      : this.renderCveTable(rows);
    return h('div', { className: 'cir-section' }, header, body);
  }

  private renderCveTable(rows: CveExploit[]): HTMLElement {
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderCveRow(r));
    return table;
  }

  private renderCveRow(r: CveExploit): HTMLElement {
    const color = r.cvssScore >= 9 ? severityColor('critical')
      : r.cvssScore >= 7 ? severityColor('high')
      : r.cvssScore >= 4 ? severityColor('medium')
      : severityColor('low');
    const tags: HTMLElement[] = [];
    if (r.inKevCatalog) tags.push(h('span', { style: 'font-size:9px;background:#b71c1c;color:#fff;border-radius:8px;padding:1px 5px;margin-left:4px' }, 'KEV'));
    if (r.exploitedInWild) tags.push(h('span', { style: 'font-size:9px;background:#fb923c;color:#fff;border-radius:8px;padding:1px 5px;margin-left:4px' }, 'WILD'));
    return h('tr', null,
      h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, r.cveId, ...tags),
      h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, `${r.vendor} / ${r.product}`),
      h('td', { style: `padding:3px 6px;font-size:11px;text-align:right;color:${color}` }, r.cvssScore.toFixed(1)),
      h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.firstSeenAt)),
    );
  }

  // ── Section 3: Ransomware Campaigns ─────────────────────────────────

  private renderRansomwareSection(rows: RansomwareCampaign[]): HTMLElement {
    const total7d = totalRansomwareVictims7d(rows);
    const header = h('div', { className: 'cir-section-header' },
      'Ransomware Campaigns',
      h('span', { style: 'margin-left:6px;font-size:10px;color:#9e9e9e' }, `${total7d} victims in last 7 d`),
    );
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderRansomwareRow(r));
    return h('div', { className: 'cir-section' }, header, table);
  }

  private renderRansomwareRow(r: RansomwareCampaign): HTMLElement {
    const arrow = ransomwareTrendArrow(r.trend);
    const trendColor = ransomwareTrendColor(r.trend);
    const notable = r.notableVictim
      ? h('tr', null,
        h('td', { colspan: '5', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' },
          `Notable: ${r.notableVictim}`),
      )
      : null;
    const fragment = h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.group),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, icsSectorLabel(r.primarySector)),
        h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right' }, `${r.victimsLast7d} / 7d`),
        h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right;color:#9e9e9e' }, `${r.victimsLast30d} / 30d`),
        h('td', { style: `padding:3px 6px;font-size:13px;text-align:right;color:${trendColor}` }, arrow),
      ),
      notable,
    );
    return fragment;
  }

  // ── Section 4: APT Activity ─────────────────────────────────────────

  private renderApTSection(groups: ApTGroup[]): HTMLElement {
    const imminent = countImminentApT(groups);
    const headerChildren: (HTMLElement | string)[] = ['APT Activity'];
    if (imminent > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${imminent} imminent`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const g of groups) table.append(this.renderApTRow(g));
    return h('div', { className: 'cir-section' },
      h('div', { className: 'cir-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Group · attribution · activity · recent events · notable TTPs'),
      table,
    );
  }

  private renderApTRow(g: ApTGroup): HTMLElement {
    const color = apTActivityColor(g.activity);
    const aLabel = apTActivityLabel(g.activity);
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, g.name),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, g.attribution),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e;text-align:right' }, `${g.recentEventCount} events`),
        h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right;color:${color}` }, aLabel),
      ),
      h('tr', null,
        h('td', { colspan: '4', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' },
          `Targets: ${g.primaryTargets.map(icsSectorLabel).join(', ')} · TTPs: ${g.notableTtps.join(' / ')}`),
      ),
    );
  }

  // ── Section 5: Critical Infrastructure ──────────────────────────────

  private renderIcsSection(rows: readonly IcsIndicator[]): HTMLElement {
    const critical = countCriticalIcsIndicators(rows);
    const headerChildren: (HTMLElement | string)[] = ['Critical Infrastructure Indicators'];
    if (critical > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${critical} critical (7d)`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const i of rows) table.append(this.renderIcsRow(i));
    return h('div', { className: 'cir-section' },
      h('div', { className: 'cir-section-header' }, ...headerChildren),
      table,
    );
  }

  private renderIcsRow(i: IcsIndicator): HTMLElement {
    const color = severityColor(i.severity);
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, icsSectorLabel(i.sector)),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, i.region),
        h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right;color:${color}` }, severityLabel(i.severity)),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(i.detectedAt)),
      ),
      h('tr', null,
        h('td', { colspan: '4', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' },
          `TTPs: ${i.observedTtps.join(' / ')}`),
      ),
    );
  }

  // ── Section 6: Threat Intel Feeds ───────────────────────────────────

  private renderFeedsSection(rows: readonly IntelFeedRow[]): HTMLElement {
    const total = sumHighSeverityFeedIndicators(rows);
    const header = h('div', { className: 'cir-section-header' },
      'Threat Intel Feed Aggregation',
      h('span', { style: 'margin-left:6px;font-size:10px;color:#9e9e9e' }, `${total} high-severity indicators today`),
    );
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const f of rows) table.append(this.renderFeedRow(f));
    return h('div', { className: 'cir-section' }, header, table);
  }

  private renderFeedRow(f: IntelFeedRow): HTMLElement {
    const color = intelFeedColor(f.source);
    const sharePct = Math.round(f.highSeverityShare * 100);
    return h('tr', null,
      h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, f.source),
      h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right' }, `${f.newIndicators} new`),
      h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e;text-align:right' }, `${sharePct}% hi-sev`),
      h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(f.lastFetchedAt)),
    );
  }
}

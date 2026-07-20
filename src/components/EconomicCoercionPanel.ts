/**
 * EconomicCoercionPanel (panel id: `economic-coercion`).
 *
 * Deep-intelligence panel for state-directed economic coercion:
 *
 *   1. State-Directed Boycotts      — consumer/diplomatic/state-led coercion by sector
 *   2. Export Controls as Leverage  — tech + critical-materials denial regimes
 *   3. Statecraft Incident Ledger   — historical episodes with outcomes + lessons
 *   4. Coercion Risk Matrix         — bilateral pair risk scores + leverage vectors
 *   5. Sanctions Pressure Ladder    — multilateral pressure rung by country
 *   6. Commodity Weaponisation      — energy, food, minerals, finance as coercion tools
 *
 * Pure helpers live in `economic-coercion-helpers.ts`.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  boycottIntensityColor,
  boycottIntensityLabel,
  boycottTypeLabel,
  controlSeverityColor,
  controlSeverityLabel,
  controlScopeLabel,
  outcomeColor,
  outcomeLabel,
  classifyRiskLevel,
  riskLevelColor,
  riskLevelLabel,
  rungLabel,
  rungColor,
  escalationRiskColor,
  weaponisationStageColor,
  weaponisationStageLabel,
  commodityClassLabel,
  hedgingLabel,
  countSevereBoycotts,
  countComprehensiveControls,
  countCriticalPairs,
  countWeaponisedCommodities,
  countImminentEscalation,
  coercerSuccessRate,
  totalBoycottImpactUsdBn,
  sortByRisk,
  totalFrozenAssetsUsdBn,
  buildSystemSummary,
  BOYCOTTS,
  EXPORT_CONTROLS,
  STATECRAFT_INCIDENTS,
  COERCION_RISK_PAIRS,
  SANCTIONS_PRESSURE,
  COMMODITY_WEAPONS,
} from './economic-coercion-helpers';

const REFRESH_MS = 30 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const el = h('div', {
    style: 'font-size:13px;font-weight:700;color:#e0e0e0;padding:8px 6px 4px;border-bottom:1px solid #333;margin-bottom:4px',
  }, title);
  if (badge) el.append(badge);
  return el;
}

function pillBadge(text: string, bg: string): HTMLElement {
  return h('span', {
    style: `margin-left:6px;font-size:10px;background:${bg};color:#fff;border-radius:10px;padding:1px 7px`,
  }, text);
}

function subNote(text: string): HTMLElement {
  return h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px;padding:0 6px' }, text);
}

export class EconomicCoercionPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'economic-coercion',
      title: 'Economic Coercion',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'State-directed economic coercion: boycotts, export-control leverage, statecraft incidents, bilateral risk matrix, sanctions pressure ladder, and commodity weaponisation.',
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
    const summary = safe(() =>
      buildSystemSummary(BOYCOTTS, EXPORT_CONTROLS, COERCION_RISK_PAIRS, SANCTIONS_PRESSURE, COMMODITY_WEAPONS),
    );

    const alertCount = (summary?.criticalPairs ?? 0)
      + (summary?.weaponisedCommodities ?? 0)
      + (summary?.imminentEscalation ?? 0);

    this.setCount(alertCount);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'ec-root' },
        this.buildSummaryBar(summary),
        this.buildBoycottsSection(),
        this.buildExportControlsSection(),
        this.buildStatecraftSection(),
        this.buildRiskMatrixSection(),
        this.buildSanctionsSection(),
        this.buildCommoditySection(),
      ),
    );
  }

  // ── Summary bar ───────────────────────────────────────────────────────

  private buildSummaryBar(summary: ReturnType<typeof buildSystemSummary> | undefined): HTMLElement {
    if (!summary) return h('div');

    const stat = (label: string, val: string | number, color?: string): HTMLElement =>
      h('div', {
        style: 'display:flex;flex-direction:column;align-items:center;padding:6px 10px;min-width:70px',
      },
        h('div', {
          style: `font-size:18px;font-weight:700;color:${color ?? '#facc15'}`,
        }, String(val)),
        h('div', { style: 'font-size:9px;color:#9e9e9e;text-align:center;text-transform:uppercase' }, label),
      );

    return h('div', {
      style: 'display:flex;flex-wrap:wrap;gap:4px;background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:4px;margin-bottom:8px',
    },
      stat('Critical Pairs', summary.criticalPairs, '#ef4444'),
      stat('Active Boycotts', summary.activeBoycotts, '#fb923c'),
      stat('Boycott Impact', `$${summary.boycottImpactUsdBn.toFixed(0)}B`, '#facc15'),
      stat('Comp. Controls', summary.comprehensiveControls, '#fb923c'),
      stat('Weaponised Cmdt', summary.weaponisedCommodities, '#ef4444'),
      stat('Escalating', summary.imminentEscalation, '#fb923c'),
    );
  }

  // ── Section 1: Boycotts ───────────────────────────────────────────────

  private buildBoycottsSection(): HTMLElement {
    const severe = countSevereBoycotts(BOYCOTTS);
    const totalImpact = totalBoycottImpactUsdBn(BOYCOTTS);
    const badge = severe > 0
      ? pillBadge(`${severe} severe`, 'var(--severity-critical, #ef4444)')
      : undefined;

    const tbody = h('tbody');
    for (const b of BOYCOTTS) {
      const iColor = boycottIntensityColor(b.intensity);
      const iLabel = boycottIntensityLabel(b.intensity);
      const tLabel = boycottTypeLabel(b.type);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${iColor}` },
            `${b.coercer} → ${b.target}`),
          cell(tLabel, 'color:#9e9e9e'),
          cell(`$${b.tradeImpactUsdBn.toFixed(1)}B`, 'color:#facc15;text-align:right'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${iColor};text-align:right`,
          }, iLabel),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 2px 6px;font-size:10px;color:#ccc',
          }, b.sector),
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 2px 6px;font-size:10px;color:#9e9e9e;text-align:right',
          }, b.startedAt),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 5px 6px;font-size:10px;color:#6b7280;border-bottom:1px solid #222;font-style:italic',
          }, b.trigger),
        ),
      );
    }

    return h('div', { className: 'ec-section' },
      sectionHeader(
        `State-Directed Boycotts  (total impact est. $${totalImpact.toFixed(0)}B)`,
        badge,
      ),
      subNote('Coercer → Target · type · trade impact · intensity · sector · trigger'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Export Controls ────────────────────────────────────────

  private buildExportControlsSection(): HTMLElement {
    const comprehensive = countComprehensiveControls(EXPORT_CONTROLS);
    const badge = comprehensive > 0
      ? pillBadge(`${comprehensive} comprehensive`, 'var(--severity-high, #fb923c)')
      : undefined;

    const tbody = h('tbody');
    for (const ec of EXPORT_CONTROLS) {
      const sColor = controlSeverityColor(ec.severity);
      const sLabel = controlSeverityLabel(ec.severity);
      const scopeL = controlScopeLabel(ec.scope);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` },
            `${ec.imposer} → ${ec.target}`),
          cell(scopeL, 'color:#9e9e9e'),
          cell(ec.effectiveDate, 'color:#9e9e9e;text-align:right'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right`,
          }, sLabel),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 2px 6px;font-size:11px;font-weight:600;color:#ccc',
          }, ec.commodity),
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 2px 6px;font-size:10px;color:#9e9e9e;text-align:right',
          }, ec.entityCount > 0 ? `${ec.entityCount} entities` : 'blanket rule'),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 5px 6px;font-size:10px;color:#6b7280;border-bottom:1px solid #222;font-style:italic',
          }, ec.strategicRationale),
        ),
      );
    }

    return h('div', { className: 'ec-section' },
      sectionHeader('Export Controls as Geopolitical Leverage', badge),
      subNote('Imposer → Target · scope · effective date · severity · commodity · entities · rationale'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Statecraft Incidents ──────────────────────────────────

  private buildStatecraftSection(): HTMLElement {
    const successRate = coercerSuccessRate(STATECRAFT_INCIDENTS);

    const tbody = h('tbody');
    for (const inc of STATECRAFT_INCIDENTS) {
      const oColor = outcomeColor(inc.outcome);
      const oLabel = outcomeLabel(inc.outcome);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${oColor}` },
            `${inc.coercer} → ${inc.target}`),
          cell(inc.duration, 'color:#9e9e9e'),
          cell(`${inc.gdpImpactTargetPct.toFixed(1)}% GDP`, 'color:#facc15;text-align:right'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${oColor};text-align:right`,
          }, oLabel),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 2px 6px;font-size:11px;color:#ccc',
          }, inc.tool),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 5px 6px;font-size:10px;color:#6b7280;border-bottom:1px solid #222;font-style:italic',
          }, `💡 ${inc.lesson}`),
        ),
      );
    }

    return h('div', { className: 'ec-section' },
      sectionHeader(`Statecraft Incident Ledger  (coercer success rate: ${successRate}%)`),
      subNote('Coercer → Target · duration · GDP impact on target · outcome · tool · lesson'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Coercion Risk Matrix ──────────────────────────────────

  private buildRiskMatrixSection(): HTMLElement {
    const sorted = sortByRisk(COERCION_RISK_PAIRS);
    const critical = countCriticalPairs(COERCION_RISK_PAIRS);
    const badge = critical > 0
      ? pillBadge(`${critical} critical`, 'var(--severity-critical, #ef4444)')
      : undefined;

    const tbody = h('tbody');
    for (const pair of sorted) {
      const lvl    = classifyRiskLevel(pair.riskScore);
      const lColor = riskLevelColor(lvl);
      const lLabel = riskLevelLabel(lvl);
      const hLabel = hedgingLabel(pair.hedgingCapacity);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:700;color:${lColor}` },
            `${pair.coercer} → ${pair.target}`),
          h('td', {
            style: `padding:3px 6px;font-size:16px;font-weight:700;color:${lColor};text-align:center`,
          }, String(pair.riskScore)),
          h('td', {
            style: `padding:3px 6px;font-size:10px;color:#9e9e9e`,
          }, `Hedge: ${hLabel}`),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${lColor};text-align:right`,
          }, lLabel),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 2px 6px;font-size:10px;color:#ccc',
          }, `⚡ ${pair.leverageVector}`),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 5px 6px;font-size:10px;color:#6b7280;border-bottom:1px solid #222',
          }, `🎯 ${pair.targetVulnerability}`),
        ),
      );
    }

    return h('div', { className: 'ec-section' },
      sectionHeader('Bilateral Coercion Risk Matrix', badge),
      subNote('Coercer → Target · risk score (0–100) · hedging capacity · leverage vector · vulnerability'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Sanctions Pressure ────────────────────────────────────

  private buildSanctionsSection(): HTMLElement {
    const totalFrozen = totalFrozenAssetsUsdBn(SANCTIONS_PRESSURE);
    const imminent = countImminentEscalation(SANCTIONS_PRESSURE);
    const badge = imminent > 0
      ? pillBadge(`${imminent} escalating`, 'var(--severity-high, #fb923c)')
      : undefined;

    const tbody = h('tbody');
    const sorted = [...SANCTIONS_PRESSURE].sort((a, b) => b.rung - a.rung);

    for (const entry of sorted) {
      const rColor = rungColor(entry.rung);
      const rLabel = rungLabel(entry.rung);
      const eColor = escalationRiskColor(entry.nextEscalationRisk);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600` }, entry.country),
          h('td', {
            style: `padding:3px 6px;font-size:10px;font-weight:700;text-transform:uppercase;color:${rColor}`,
          }, `${entry.rung}/5 — ${rLabel}`),
          cell(`$${entry.frozenAssetsUsdBn.toFixed(0)}B frozen`, 'color:#facc15;text-align:right'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;color:${eColor};text-align:right`,
          }, entry.nextEscalationRisk),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 5px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, entry.regimes.join(' · ')),
        ),
      );
    }

    return h('div', { className: 'ec-section' },
      sectionHeader(
        `Sanctions Pressure Ladder  (total frozen: $${totalFrozen.toFixed(0)}B)`,
        badge,
      ),
      subNote('Country · rung (0–5) · frozen assets · escalation risk · active regimes'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 6: Commodity Weaponisation ───────────────────────────────

  private buildCommoditySection(): HTMLElement {
    const weaponised = countWeaponisedCommodities(COMMODITY_WEAPONS);
    const badge = weaponised > 0
      ? pillBadge(`${weaponised} active/weaponised`, 'var(--severity-critical, #ef4444)')
      : undefined;

    const tbody = h('tbody');
    for (const cw of COMMODITY_WEAPONS) {
      const sColor = weaponisationStageColor(cw.stage);
      const sLabel = weaponisationStageLabel(cw.stage);
      const cLabel = commodityClassLabel(cw.commodityClass);
      const timeStr = cw.timeToAlternativeYears == null
        ? 'No timeline'
        : `${cw.timeToAlternativeYears}yr to alt`;

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` },
            cw.commodity),
          cell(cLabel, 'color:#9e9e9e'),
          cell(timeStr, 'color:#facc15;text-align:right'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right`,
          }, sLabel),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 2px 6px;font-size:10px;color:#ccc',
          }, `Supplier: ${cw.dominantSupplier}`),
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 2px 6px;font-size:10px;color:#9e9e9e;text-align:right',
          }, `Substitute: ${cw.substituteAvailability}`),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 2px 6px;font-size:10px;color:#6b7280;font-style:italic',
          }, cw.dependentTargets),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 5px 6px;font-size:10px;color:#6b7280;border-bottom:1px solid #222',
          }, cw.notes),
        ),
      );
    }

    return h('div', { className: 'ec-section' },
      sectionHeader('Commodity Weaponisation', badge),
      subNote('Commodity · class · stage · time-to-alternative · supplier · substitute · targets · context'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}

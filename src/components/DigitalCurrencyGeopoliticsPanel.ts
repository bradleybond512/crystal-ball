/**
 * DigitalCurrencyGeopoliticsPanel (panel id: `digital-currency-geopolitics`).
 *
 * Tracks CBDC competition, de-dollarization trends, and crypto as a
 * sanctions evasion tool across three sections:
 *
 *   1. CBDC Development Matrix  — 12+ country status, wallets, transactions
 *   2. De-dollarization Signals — reserve shifts, petrodollar cracks, mBridge
 *   3. Sanctions Evasion        — state actors using crypto to bypass SWIFT
 *
 * Pure helpers live in `digital-currency-geopolitics-helpers.ts`.
 * Refreshes every 24 hours (static intelligence dataset).
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  cbdcStatusColor,
  cbdcStatusLabel,
  trendColor,
  trendLabel,
  confidenceColor,
  confidenceLabel,
  riskColor,
  buildRenderData,
  CBDC_ENTRIES,
  DEDOLLARIZATION_SIGNALS,
  SANCTIONS_EVASION_ACTORS,
} from './digital-currency-geopolitics-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000;

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

export class DigitalCurrencyGeopoliticsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'digital-currency-geopolitics',
      title: 'Digital Currency Geopolitics',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'CBDC development status for 12+ countries, de-dollarization trends, and state use of crypto for sanctions evasion.',
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
    const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);

    // Alert count: live-with-sanctions-goal + high-risk dedollarization + confirmed evasion
    const alertCount =
      data.cbdcEntries.filter((e) => e.sanctionsEvasionGoal).length +
      data.dedollarizationSignals.filter((s) => s.riskLevel === 'high').length +
      data.evasionActors.filter((a) => a.confidence === 'confirmed').length;

    this.setCount(alertCount);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'dcgp-root' },
        this.buildHegemonyBar(data.dollarHegemonyIndex),
        this.buildCbdcSection(data),
        this.buildDedollarizationSection(data),
        this.buildEvasionSection(data),
      ),
    );
  }

  // ── Dollar Hegemony Index bar ─────────────────────────────────────────

  private buildHegemonyBar(idx: ReturnType<typeof buildRenderData>['dollarHegemonyIndex']): HTMLElement {
    let scoreColor = '#ef4444';
    if (idx.score >= 70) scoreColor = '#22c55e';
    else if (idx.score >= 50) scoreColor = '#facc15';

    const stat = (label: string, val: string, color?: string): HTMLElement =>
      h('div', {
        style: 'display:flex;flex-direction:column;align-items:center;padding:6px 10px;min-width:60px',
      },
        h('div', { style: `font-size:18px;font-weight:700;color:${color ?? '#facc15'}` }, val),
        h('div', { style: 'font-size:9px;color:#9e9e9e;text-align:center;text-transform:uppercase' }, label),
      );

    return h('div', {
      style: 'background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:4px;margin-bottom:8px',
    },
      h('div', { style: 'font-size:11px;font-weight:600;color:#9e9e9e;padding:4px 6px 2px' },
        'DOLLAR HEGEMONY INDEX'),
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:2px' },
        stat('Score /100', String(idx.score), scoreColor),
        stat('Reserve Share', `${idx.components.reserveShareScore}/30`, '#60a5fa'),
        stat('Trade', `${idx.components.tradeInvoicingScore}/25`, '#60a5fa'),
        stat('CBDC Threat', `${idx.components.cbdcThreatScore}/25`, '#60a5fa'),
        stat('Evasion', `${idx.components.sanctionsEvasionScore}/20`, '#60a5fa'),
      ),
      h('div', { style: 'font-size:11px;color:#9e9e9e;padding:4px 6px;font-style:italic' },
        idx.interpretation),
    );
  }

  // ── Section 1: CBDC Matrix ────────────────────────────────────────────

  private buildCbdcSection(data: ReturnType<typeof buildRenderData>): HTMLElement {
    const liveCount = data.liveCbdcCount;
    const badge     = liveCount > 0
      ? pillBadge(`${liveCount} live`, '#22c55e')
      : undefined;

    const tbody = h('tbody');
    for (const entry of data.cbdcEntries) {
      const sColor = cbdcStatusColor(entry.status);
      const sLabel = cbdcStatusLabel(entry.status);

      const walletStr = entry.walletsMillion == null
        ? ''
        : `${entry.walletsMillion}M wallets`;
      const txStr = entry.transactionsBn == null
        ? ''
        : `$${entry.transactionsBn}B txns`;
      const metaStr = [walletStr, txStr].filter(Boolean).join(' · ') || '—';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` },
            `${entry.country} — ${entry.name}`),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right`,
          }, sLabel),
        ),
        h('tr',
          cell(metaStr, 'color:#facc15'),
          cell(entry.scope, 'color:#9e9e9e;text-align:right'),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 2px 6px;font-size:10px;color:#ccc',
          }, entry.crossBorderPartners.length > 0
            ? `Cross-border: ${entry.crossBorderPartners.join(', ')}`
            : 'No cross-border pilots'),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: `padding:0 6px 5px 6px;font-size:10px;font-style:italic;border-bottom:1px solid #222;${
              entry.sanctionsEvasionGoal ? 'color:#fb923c' : 'color:#6b7280'
            }`,
          }, entry.notes + (entry.sanctionsEvasionGoal ? ' ⚠ Sanctions-evasion goal.' : '')),
        ),
      );
    }

    return h('div', { className: 'dcgp-section' },
      sectionHeader(
        `CBDC Development Matrix  (${data.cbdcEntries.length} countries, ${data.pilotingCount} piloting)`,
        badge,
      ),
      subNote('Country · CBDC name · status · wallets · transactions · cross-border pilots'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: De-dollarization ───────────────────────────────────────

  private buildDedollarizationSection(data: ReturnType<typeof buildRenderData>): HTMLElement {
    const accel = data.acceleratingSignalCount;
    const badge = accel > 0
      ? pillBadge(`${accel} accelerating`, '#ef4444')
      : undefined;

    const tbody = h('tbody');
    for (const sig of data.dedollarizationSignals) {
      const tColor = trendColor(sig.trend);
      const tLbl   = trendLabel(sig.trend);
      const rColor = riskColor(sig.riskLevel);

      const valStr = sig.currentValuePct == null
        ? '—'
        : `${sig.currentValuePct}%`;
      const peakStr = sig.peakValuePct != null && sig.peakYear != null
        ? `peak ${sig.peakValuePct}% (${sig.peakYear})`
        : '';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${tColor}` },
            sig.label),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${rColor};text-align:right`,
          }, sig.riskLevel),
        ),
        h('tr',
          h('td', { style: `padding:0 6px 2px;font-size:11px;color:${tColor}` },
            `${tLbl}${valStr === '—' ? '' : '  ·  Now: ' + valStr}${peakStr ? '  ·  ' + peakStr : ''}`),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 5px;font-size:10px;color:#6b7280;font-style:italic;border-bottom:1px solid #222',
          }, sig.description),
        ),
      );
    }

    return h('div', { className: 'dcgp-section' },
      sectionHeader('De-dollarization Signals', badge),
      subNote('Signal · trend · current value · risk level · context'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Sanctions Evasion via Crypto ───────────────────────────

  private buildEvasionSection(data: ReturnType<typeof buildRenderData>): HTMLElement {
    const totalBn = data.totalEvasionUsdBn;
    const confirmed = data.evasionActors.filter((a) => a.confidence === 'confirmed').length;
    const badge = confirmed > 0
      ? pillBadge(`${confirmed} confirmed`, '#ef4444')
      : undefined;

    const tbody = h('tbody');
    for (const actor of data.evasionActors) {
      const cColor = confidenceColor(actor.confidence);
      const cLabel = confidenceLabel(actor.confidence);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${cColor}` },
            `${actor.country} — ${actor.actor}`),
          h('td', {
            style: `padding:3px 6px;font-size:14px;font-weight:700;color:${cColor};text-align:right`,
          }, `$${actor.estimatedUsdBn.toFixed(1)}B`),
        ),
        h('tr',
          cell(actor.cryptoType, 'color:#facc15'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${cColor};text-align:right`,
          }, cLabel),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 2px;font-size:10px;color:#ccc',
          }, `Method: ${actor.method}`),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 5px;font-size:10px;color:#6b7280;font-style:italic;border-bottom:1px solid #222',
          }, actor.notes),
        ),
      );
    }

    return h('div', { className: 'dcgp-section' },
      sectionHeader(
        `Sanctions Evasion via Crypto  (est. total: $${totalBn.toFixed(1)}B)`,
        badge,
      ),
      subNote('Actor · crypto type · estimated value · confidence · method · notes'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  LAUNDERING_CASES,
  CRYPTO_CRIME_EVENTS,
  FATF_STATUS,
  DERISKING_EVENTS,
  SHELL_JURISDICTIONS,
  TBML_SIGNALS,
  FIU_ALERTS,
  caseStatusColor,
  caseStatusLabel,
  ransomTrendColor,
  ransomTrendLabel,
  fatfStatusColor,
  fatfStatusLabel,
  deRiskingColor,
  deRiskingLabel,
  shellRiskColor,
  shellRiskLabel,
  tbmlPatternLabel,
  fiuTrendColor,
  fiuTrendLabel,
  countActiveLaunderingCases,
  countRisingCryptoCrimes,
  countListedJurisdictions,
  countExpandingDeRisking,
  countHighShellRisk,
  countSurgingFiuAlerts,
  type LaunderingCase,
  type CryptoCrimeEvent,
  type FatfEntry,
  type DeRiskingEvent,
  type ShellJurisdiction,
  type TbmlSignal,
  type FiuAlert,
} from './financial-crimes-helpers';

export interface FinancialCrimesData {
  launderingCases: LaunderingCase[];
  cryptoCrimes: CryptoCrimeEvent[];
  fatfStatus: FatfEntry[];
  deRiskingEvents: DeRiskingEvent[];
  shellJurisdictions: ShellJurisdiction[];
  tbmlSignals: TbmlSignal[];
  fiuAlerts: FiuAlert[];
}

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class FinancialCrimesPanel extends Panel {
  constructor() {
    super({
      id: 'financial-crimes',
      title: 'Financial Crimes',
      showCount: true,
      trackActivity: true,
    });
  }

  refresh(data?: Partial<FinancialCrimesData>): void {
    const launderingCases    = safe(() => data?.launderingCases    ?? LAUNDERING_CASES)     ?? LAUNDERING_CASES;
    const cryptoCrimes       = safe(() => data?.cryptoCrimes       ?? CRYPTO_CRIME_EVENTS)  ?? CRYPTO_CRIME_EVENTS;
    const fatfStatus         = safe(() => data?.fatfStatus         ?? FATF_STATUS)          ?? FATF_STATUS;
    const deRiskingEvents    = safe(() => data?.deRiskingEvents    ?? DERISKING_EVENTS)     ?? DERISKING_EVENTS;
    const shellJurisdictions = safe(() => data?.shellJurisdictions ?? SHELL_JURISDICTIONS)  ?? SHELL_JURISDICTIONS;
    const tbmlSignals        = safe(() => data?.tbmlSignals        ?? TBML_SIGNALS)         ?? TBML_SIGNALS;
    const fiuAlerts          = safe(() => data?.fiuAlerts          ?? FIU_ALERTS)           ?? FIU_ALERTS;

    const html = this.buildHtml({
      launderingCases,
      cryptoCrimes,
      fatfStatus,
      deRiskingEvents,
      shellJurisdictions,
      tbmlSignals,
      fiuAlerts,
    });
    this.setContent(html);

    const stress =
      countActiveLaunderingCases(launderingCases) +
      countRisingCryptoCrimes(cryptoCrimes) +
      countListedJurisdictions(fatfStatus) +
      countExpandingDeRisking(deRiskingEvents) +
      countHighShellRisk(shellJurisdictions) +
      countSurgingFiuAlerts(fiuAlerts);
    this.setCount(stress);
    this.markFresh();
  }

  buildHtml(data: FinancialCrimesData): string {
    return `<div class="financial-crimes">
      ${this.buildLaunderingSection(data.launderingCases)}
      ${this.buildCryptoSection(data.cryptoCrimes)}
      ${this.buildFatfSection(data.fatfStatus)}
      ${this.buildDeRiskingSection(data.deRiskingEvents)}
      ${this.buildShellSection(data.shellJurisdictions)}
      ${this.buildTbmlSection(data.tbmlSignals)}
      ${this.buildFiuSection(data.fiuAlerts)}
    </div>`;
  }

  private buildLaunderingSection(cases: LaunderingCase[]): string {
    const items = cases.length === 0
      ? '<div class="fc-empty">No active laundering cases tracked</div>'
      : cases.map((c) => `
        <div class="fc-case-item">
          <span class="fc-case-name">${escapeHtml(c.caseName)}</span>
          <span class="fc-jurisdiction">${escapeHtml(c.jurisdiction)}</span>
          <span class="fc-amount">$${c.amountUsdMillions.toLocaleString()}M</span>
          <span class="fc-case-status" style="color:${caseStatusColor(c.status)}">${escapeHtml(caseStatusLabel(c.status))}</span>
          <span class="fc-predicate">predicate: ${escapeHtml(c.predicateOffense)}</span>
          <span class="fc-notes">${escapeHtml(c.notes)}</span>
        </div>`).join('');
    return `<section class="fc-section"><h3>Major Money Laundering Cases</h3>${items}</section>`;
  }

  private buildCryptoSection(events: CryptoCrimeEvent[]): string {
    const items = events.length === 0
      ? '<div class="fc-empty">No crypto crime events tracked</div>'
      : events.map((e) => `
        <div class="fc-crypto-item">
          <span class="fc-incident">${escapeHtml(e.incidentName)}</span>
          <span class="fc-asset">${escapeHtml(e.cryptoAsset)}</span>
          <span class="fc-amount">$${e.amountUsdMillions.toLocaleString()}M</span>
          <span class="fc-actor">actor: ${escapeHtml(e.attributedActor)}</span>
          <span class="fc-trend" style="color:${ransomTrendColor(e.paymentTrend)}">${escapeHtml(ransomTrendLabel(e.paymentTrend))}</span>
          <span class="fc-notes">${escapeHtml(e.notes)}</span>
        </div>`).join('');
    return `<section class="fc-section"><h3>Crypto Crime &amp; Ransomware Payment Tracking</h3>${items}</section>`;
  }

  private buildFatfSection(entries: FatfEntry[]): string {
    const items = entries.length === 0
      ? '<div class="fc-empty">No FATF status data</div>'
      : entries.map((e) => `
        <div class="fc-fatf-item">
          <span class="fc-jurisdiction">${escapeHtml(e.jurisdiction)}</span>
          <span class="fc-fatf-status" style="color:${fatfStatusColor(e.status)}">${escapeHtml(fatfStatusLabel(e.status))}</span>
          <span class="fc-effective">effective ${escapeHtml(e.effectiveDate)}</span>
          <span class="fc-driver">${escapeHtml(e.driver)}</span>
        </div>`).join('');
    return `<section class="fc-section"><h3>FATF Grey / Black List Status</h3>${items}</section>`;
  }

  private buildDeRiskingSection(events: DeRiskingEvent[]): string {
    const items = events.length === 0
      ? '<div class="fc-empty">No correspondent banking de-risking activity</div>'
      : events.map((e) => `
        <div class="fc-derisking-item">
          <span class="fc-corridor">${escapeHtml(e.corridor)}</span>
          <span class="fc-direction" style="color:${deRiskingColor(e.direction)}">${escapeHtml(deRiskingLabel(e.direction))}</span>
          <span class="fc-affected">${e.affectedBanks.toLocaleString()} banks affected</span>
          <span class="fc-notes">${escapeHtml(e.notes)}</span>
        </div>`).join('');
    return `<section class="fc-section"><h3>Correspondent Banking De-Risking Events</h3>${items}</section>`;
  }

  private buildShellSection(jurisdictions: ShellJurisdiction[]): string {
    const items = jurisdictions.length === 0
      ? '<div class="fc-empty">No shell company jurisdiction data</div>'
      : jurisdictions.map((j) => `
        <div class="fc-shell-item">
          <span class="fc-jurisdiction">${escapeHtml(j.jurisdiction)}</span>
          <span class="fc-shell-risk" style="color:${shellRiskColor(j.risk)}">risk ${escapeHtml(shellRiskLabel(j.risk))}</span>
          <span class="fc-ubo">UBO: ${escapeHtml(j.beneficialOwnerRegistry)}</span>
          <span class="fc-notes">${escapeHtml(j.notes)}</span>
        </div>`).join('');
    return `<section class="fc-section"><h3>Shell Company Jurisdiction Risk</h3>${items}</section>`;
  }

  private buildTbmlSection(signals: TbmlSignal[]): string {
    const items = signals.length === 0
      ? '<div class="fc-empty">No trade-based money laundering signals</div>'
      : signals.map((s) => `
        <div class="fc-tbml-item">
          <span class="fc-corridor">${escapeHtml(s.corridor)}</span>
          <span class="fc-pattern">${escapeHtml(tbmlPatternLabel(s.pattern))}</span>
          <span class="fc-commodity">${escapeHtml(s.commodity)}</span>
          <span class="fc-amount">$${s.estimatedUsdMillions.toLocaleString()}M est.</span>
          <span class="fc-notes">${escapeHtml(s.notes)}</span>
        </div>`).join('');
    return `<section class="fc-section"><h3>Trade-Based Money Laundering Signals</h3>${items}</section>`;
  }

  private buildFiuSection(alerts: FiuAlert[]): string {
    const items = alerts.length === 0
      ? '<div class="fc-empty">No FIU alert pattern data</div>'
      : alerts.map((a) => `
        <div class="fc-fiu-item">
          <span class="fc-fiu">${escapeHtml(a.fiu)}</span>
          <span class="fc-category">${escapeHtml(a.alertCategory)}</span>
          <span class="fc-fiu-trend" style="color:${fiuTrendColor(a.trend)}">${escapeHtml(fiuTrendLabel(a.trend))}</span>
          <span class="fc-filings">${a.filingsLast30d.toLocaleString()} filings / 30d</span>
          <span class="fc-notes">${escapeHtml(a.notes)}</span>
        </div>`).join('');
    return `<section class="fc-section"><h3>Financial Intelligence Unit Alert Patterns</h3>${items}</section>`;
  }
}

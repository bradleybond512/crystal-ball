import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  NATO_SPENDING,
  ALLIANCE_COHESION_SCORES,
  BILATERAL_AGREEMENTS,
  CREDIBILITY_EVENTS,
  DEFECTION_RISKS,
  BLOC_TENSIONS,
  natoStatusColor,
  natoStatusLabel,
  spendingTrendColor,
  spendingTrendLabel,
  allianceHealthColor,
  allianceHealthLabel,
  cohesionScoreColor,
  agreementStatusColor,
  agreementStatusLabel,
  credibilitySignalColor,
  credibilitySignalLabel,
  defectionRiskColor,
  blocTensionColor,
  blocTensionLabel,
  countNonCompliantNato,
  countFracturedAlliances,
  countSuspendedAgreements,
  countNegativeCredibilityEvents,
  countHighDefectionRisk,
  type NatoMember,
  type AllianceCohesionScore,
  type BilateralAgreement,
  type CredibilityEvent,
  type DefectionRisk,
  type BlocTension,
} from './alliance-cohesion-helpers';

export interface AllianceCohesionData {
  natoSpending: NatoMember[];
  allianceCohesion: AllianceCohesionScore[];
  bilateralAgreements: BilateralAgreement[];
  credibilityEvents: CredibilityEvent[];
  defectionRisks: DefectionRisk[];
  blocTensions: BlocTension[];
}

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class AllianceCohesionPanel extends Panel {
  constructor() {
    super({
      id: 'alliance-cohesion',
      title: 'Alliance Cohesion',
      showCount: true,
      trackActivity: true,
    });
  }

  refresh(data?: Partial<AllianceCohesionData>): void {
    const natoSpending        = safe(() => data?.natoSpending        ?? NATO_SPENDING)          ?? NATO_SPENDING;
    const allianceCohesion    = safe(() => data?.allianceCohesion    ?? ALLIANCE_COHESION_SCORES) ?? ALLIANCE_COHESION_SCORES;
    const bilateralAgreements = safe(() => data?.bilateralAgreements ?? BILATERAL_AGREEMENTS)   ?? BILATERAL_AGREEMENTS;
    const credibilityEvents   = safe(() => data?.credibilityEvents   ?? CREDIBILITY_EVENTS)     ?? CREDIBILITY_EVENTS;
    const defectionRisks      = safe(() => data?.defectionRisks      ?? DEFECTION_RISKS)        ?? DEFECTION_RISKS;
    const blocTensions        = safe(() => data?.blocTensions        ?? BLOC_TENSIONS)          ?? BLOC_TENSIONS;

    const html = this.buildHtml({
      natoSpending,
      allianceCohesion,
      bilateralAgreements,
      credibilityEvents,
      defectionRisks,
      blocTensions,
    });
    this.setContent(html);

    const stress =
      countNonCompliantNato(natoSpending) +
      countFracturedAlliances(allianceCohesion) +
      countSuspendedAgreements(bilateralAgreements) +
      countNegativeCredibilityEvents(credibilityEvents) +
      countHighDefectionRisk(defectionRisks);
    this.setCount(stress);
    this.markFresh();
  }

  buildHtml(data: AllianceCohesionData): string {
    return `<div class="alliance-cohesion">
      ${this.buildNatoSection(data.natoSpending)}
      ${this.buildAllianceSection(data.allianceCohesion)}
      ${this.buildAgreementSection(data.bilateralAgreements)}
      ${this.buildCredibilitySection(data.credibilityEvents)}
      ${this.buildDefectionSection(data.defectionRisks)}
      ${this.buildBlocSection(data.blocTensions)}
    </div>`;
  }

  private buildNatoSection(members: NatoMember[]): string {
    const items = members.length === 0
      ? '<div class="ac-empty">No NATO spending data</div>'
      : members.map((m) => `
        <div class="ac-nato-item">
          <span class="ac-nation">${escapeHtml(m.nation)}</span>
          <span class="ac-gdp">${m.gdpPct.toFixed(2)}% GDP</span>
          <span class="ac-status" style="color:${natoStatusColor(m.status)}">${escapeHtml(natoStatusLabel(m.status))}</span>
          <span class="ac-trend" style="color:${spendingTrendColor(m.trend)}">${escapeHtml(spendingTrendLabel(m.trend))}</span>
          <span class="ac-notes">${escapeHtml(m.notes)}</span>
        </div>`).join('');
    return `<section class="ac-section"><h3>NATO Defense Spending Compliance</h3>${items}</section>`;
  }

  private buildAllianceSection(alliances: AllianceCohesionScore[]): string {
    const items = alliances.length === 0
      ? '<div class="ac-empty">No alliance cohesion data</div>'
      : alliances.map((a) => `
        <div class="ac-alliance-item">
          <span class="ac-alliance-name">${escapeHtml(a.name)}</span>
          <span class="ac-members">${escapeHtml(a.members.join(', '))}</span>
          <span class="ac-health" style="color:${allianceHealthColor(a.health)}">${escapeHtml(allianceHealthLabel(a.health))}</span>
          <span class="ac-score" style="color:${cohesionScoreColor(a.cohesionScore)}">cohesion ${a.cohesionScore.toFixed(1)}/10</span>
          <span class="ac-tension">⚠ ${escapeHtml(a.keyTension)}</span>
          <span class="ac-strength">✓ ${escapeHtml(a.keyStrength)}</span>
        </div>`).join('');
    return `<section class="ac-section"><h3>Alliance Cohesion Scores</h3>${items}</section>`;
  }

  private buildAgreementSection(agreements: BilateralAgreement[]): string {
    const items = agreements.length === 0
      ? '<div class="ac-empty">No bilateral agreements tracked</div>'
      : agreements.map((a) => `
        <div class="ac-agreement-item">
          <span class="ac-pair">${escapeHtml(a.nations[0])} ↔ ${escapeHtml(a.nations[1])}</span>
          <span class="ac-type">${escapeHtml(a.agreementType)}</span>
          <span class="ac-agreement-status" style="color:${agreementStatusColor(a.status)}">${escapeHtml(agreementStatusLabel(a.status))}</span>
          <span class="ac-year">since ${a.signedYear}</span>
          <span class="ac-notes">${escapeHtml(a.notes)}</span>
        </div>`).join('');
    return `<section class="ac-section"><h3>Bilateral Security Agreements</h3>${items}</section>`;
  }

  private buildCredibilitySection(events: CredibilityEvent[]): string {
    const items = events.length === 0
      ? '<div class="ac-empty">No credibility events recorded</div>'
      : events.map((e) => `
        <div class="ac-credibility-item">
          <span class="ac-date">${escapeHtml(e.date)}</span>
          <span class="ac-alliance">${escapeHtml(e.alliance)}</span>
          <span class="ac-signal" style="color:${credibilitySignalColor(e.signal)}">${escapeHtml(credibilitySignalLabel(e.signal))}</span>
          <span class="ac-impact">impact: ${escapeHtml(e.impactNation)}</span>
          <span class="ac-description">${escapeHtml(e.description)}</span>
        </div>`).join('');
    return `<section class="ac-section"><h3>Alliance Credibility Events</h3>${items}</section>`;
  }

  private buildDefectionSection(risks: DefectionRisk[]): string {
    const items = risks.length === 0
      ? '<div class="ac-empty">No defection risk assessments</div>'
      : risks.map((r) => `
        <div class="ac-defection-item">
          <span class="ac-nation">${escapeHtml(r.nation)}</span>
          <span class="ac-primary-alliance">${escapeHtml(r.primaryAlliance)}</span>
          <span class="ac-risk" style="color:${defectionRiskColor(r.riskScore)}">defection ${r.riskScore.toFixed(1)}/10</span>
          <span class="ac-trajectory" style="color:${spendingTrendColor(r.trajectory)}">${escapeHtml(spendingTrendLabel(r.trajectory))}</span>
          <span class="ac-factors">${escapeHtml(r.riskFactors.join(' · '))}</span>
        </div>`).join('');
    return `<section class="ac-section"><h3>Defection Risk Scoring</h3>${items}</section>`;
  }

  private buildBlocSection(tensions: BlocTension[]): string {
    const items = tensions.length === 0
      ? '<div class="ac-empty">No competing bloc tensions tracked</div>'
      : tensions.map((t) => `
        <div class="ac-bloc-item">
          <span class="ac-nation">${escapeHtml(t.nation)}</span>
          <span class="ac-blocs">${escapeHtml(t.bloc1)} vs ${escapeHtml(t.bloc2)}</span>
          <span class="ac-tension-level" style="color:${blocTensionColor(t.tensionLevel)}">${escapeHtml(blocTensionLabel(t.tensionLevel))}</span>
          <span class="ac-description">${escapeHtml(t.description)}</span>
        </div>`).join('');
    return `<section class="ac-section"><h3>Competing Bloc Membership Tensions</h3>${items}</section>`;
  }
}

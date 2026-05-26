import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// ── Types ────────────────────────────────────────────────────────────────

export type IncidentStatus = 'contained' | 'ongoing' | 'emergency';

export interface NuclearIncident {
  facilityName: string;
  country: string;
  inesLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  status: IncidentStatus;
  onsetTimestamp: number;
}

export interface RadiationRelease {
  detectionPoint: string;
  doseRateMicroSvPerHour: number;
  plumeDirection: string;
  affectedRadiusKm: number;
  evacuationZoneKm: number;
}

export type ThreatType = 'test' | 'acquisition' | 'deployment' | 'rhetoric';
export type ThreatLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type DiplomaticStatus = 'engaged' | 'strained' | 'severed';
export type UNStatus = 'none' | 'proposed' | 'passed' | 'vetoed';

export interface NuclearThreat {
  stateActor: string;
  type: ThreatType;
  threatLevel: ThreatLevel;
  diplomaticStatus: DiplomaticStatus;
  unResolutionStatus: UNStatus;
}

export type FacilityRegion =
  | 'North America'
  | 'Europe'
  | 'Russia'
  | 'China'
  | 'South Asia'
  | 'Middle East';

export interface FacilityRisk {
  region: FacilityRegion;
  riskScore: 0 | 1 | 2 | 3 | 4;
  facilityCount: number;
}

export type ComplianceFlag = 'compliant' | 'concerns' | 'non-compliant' | 'withdrawn';

export interface NonProliferationEntry {
  state: string;
  treaty: 'NPT' | 'JCPOA' | 'New START' | 'CTBT';
  status: ComplianceFlag;
  inspectionStatus: 'current' | 'overdue' | 'denied' | 'n/a';
  note?: string;
}

export interface NuclearSuperpowerData {
  incidents: NuclearIncident[];
  releases: RadiationRelease[];
  threats: NuclearThreat[];
  facilities: FacilityRisk[];
  nonProliferation: NonProliferationEntry[];
}

// ── Constants ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<IncidentStatus, string> = {
  contained: 'var(--severity-low, #4caf50)',
  ongoing: 'var(--severity-medium, #facc15)',
  emergency: 'var(--severity-critical, #ef4444)',
};

const INES_LABEL: Record<NuclearIncident['inesLevel'], string> = {
  1: 'Anomaly',
  2: 'Incident',
  3: 'Serious Incident',
  4: 'Accident, local consequences',
  5: 'Accident, wider consequences',
  6: 'Serious Accident',
  7: 'Major Accident',
};

const INES_SEVERITY_COLOR: Record<NuclearIncident['inesLevel'], string> = {
  1: 'var(--severity-low, #4caf50)',
  2: 'var(--severity-low, #4caf50)',
  3: 'var(--severity-medium, #facc15)',
  4: 'var(--severity-medium, #facc15)',
  5: 'var(--severity-high, #fb923c)',
  6: 'var(--severity-high, #fb923c)',
  7: 'var(--severity-critical, #ef4444)',
};

const THREAT_LEVEL_COLOR: Record<ThreatLevel, string> = {
  LOW: 'var(--severity-low, #4caf50)',
  MEDIUM: 'var(--severity-medium, #facc15)',
  HIGH: 'var(--severity-high, #fb923c)',
  CRITICAL: 'var(--severity-critical, #ef4444)',
};

const FACILITY_RISK_COLOR: Record<FacilityRisk['riskScore'], string> = {
  0: 'var(--severity-low, #4caf50)',
  1: 'var(--severity-low, #4caf50)',
  2: 'var(--severity-medium, #facc15)',
  3: 'var(--severity-high, #fb923c)',
  4: 'var(--severity-critical, #ef4444)',
};

const COMPLIANCE_COLOR: Record<ComplianceFlag, string> = {
  compliant: 'var(--severity-low, #4caf50)',
  concerns: 'var(--severity-medium, #facc15)',
  'non-compliant': 'var(--severity-high, #fb923c)',
  withdrawn: 'var(--severity-critical, #ef4444)',
};

// Active incidents = anything not yet contained. Used for the panel count badge.
const ACTIVE_INCIDENT_STATUSES: ReadonlySet<IncidentStatus> = new Set(['ongoing', 'emergency']);

// ── Helpers ──────────────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

// ── Panel ────────────────────────────────────────────────────────────────

export class NuclearSuperpowerPanel extends Panel {
  constructor() {
    super({
      id: 'nuclear-superpower',
      title: 'Nuclear Intelligence',
      showCount: true,
      trackActivity: true,
    });
  }

  refresh(data?: Partial<NuclearSuperpowerData>): void {
    const incidents       = safe(() => data?.incidents ?? [])       ?? [];
    const releases        = safe(() => data?.releases ?? [])        ?? [];
    const threats         = safe(() => data?.threats ?? [])         ?? [];
    const facilities      = safe(() => data?.facilities ?? [])      ?? [];
    const nonProliferation = safe(() => data?.nonProliferation ?? []) ?? [];

    const html = this.buildHtml({ incidents, releases, threats, facilities, nonProliferation });
    this.setContent(html);
    this.setCount(incidents.filter((i) => ACTIVE_INCIDENT_STATUSES.has(i.status)).length);
    this.markFresh();
  }

  buildHtml(data: NuclearSuperpowerData): string {
    return `<div class="nuclear-superpower">
      ${this.buildIncidentSection(data.incidents)}
      ${this.buildReleaseSection(data.releases)}
      ${this.buildThreatSection(data.threats)}
      ${this.buildFacilitySection(data.facilities)}
      ${this.buildNonProliferationSection(data.nonProliferation)}
    </div>`;
  }

  private buildIncidentSection(incidents: NuclearIncident[]): string {
    const items = incidents.length === 0
      ? '<div class="nsp-empty">No active nuclear incidents</div>'
      : incidents.map((i) => `
        <div class="nsp-incident-item">
          <span class="nsp-facility">${escapeHtml(i.facilityName)}</span>
          <span class="nsp-country">${escapeHtml(i.country)}</span>
          <span class="nsp-ines" style="color:${INES_SEVERITY_COLOR[i.inesLevel]}">INES ${i.inesLevel} — ${escapeHtml(INES_LABEL[i.inesLevel])}</span>
          <span class="nsp-status" style="color:${STATUS_COLOR[i.status]}">${escapeHtml(i.status)}</span>
          <span class="nsp-onset" data-onset="${i.onsetTimestamp}">since ${formatRelative(i.onsetTimestamp)}</span>
        </div>`).join('');
    return `<section class="nsp-section"><h3>Global Incident Monitor</h3>${items}</section>`;
  }

  private buildReleaseSection(releases: RadiationRelease[]): string {
    const items = releases.length === 0
      ? '<div class="nsp-empty">No detected radiation releases</div>'
      : releases.map((r) => `
        <div class="nsp-release-item">
          <span class="nsp-point">${escapeHtml(r.detectionPoint)}</span>
          <span class="nsp-dose">${r.doseRateMicroSvPerHour.toLocaleString()} µSv/h</span>
          <span class="nsp-plume">plume ${escapeHtml(r.plumeDirection)}</span>
          <span class="nsp-radius">radius ${r.affectedRadiusKm.toLocaleString()} km</span>
          <span class="nsp-evac">evac ${r.evacuationZoneKm.toLocaleString()} km</span>
        </div>`).join('');
    return `<section class="nsp-section"><h3>Radiation Release Tracker</h3>${items}</section>`;
  }

  private buildThreatSection(threats: NuclearThreat[]): string {
    const items = threats.length === 0
      ? '<div class="nsp-empty">No active nuclear threats</div>'
      : threats.map((t) => `
        <div class="nsp-threat-item">
          <span class="nsp-actor">${escapeHtml(t.stateActor)}</span>
          <span class="nsp-type">${escapeHtml(t.type)}</span>
          <span class="nsp-level" style="color:${THREAT_LEVEL_COLOR[t.threatLevel]}">${escapeHtml(t.threatLevel)}</span>
          <span class="nsp-diplo">diplomacy: ${escapeHtml(t.diplomaticStatus)}</span>
          <span class="nsp-un">UN: ${escapeHtml(t.unResolutionStatus)}</span>
        </div>`).join('');
    return `<section class="nsp-section"><h3>Nuclear Threat Watch</h3>${items}</section>`;
  }

  private buildFacilitySection(facilities: FacilityRisk[]): string {
    const items = facilities.length === 0
      ? '<div class="nsp-empty">No facility risk data</div>'
      : facilities.map((f) => `
        <div class="nsp-facility-item">
          <span class="nsp-region">${escapeHtml(f.region)}</span>
          <span class="nsp-risk" style="color:${FACILITY_RISK_COLOR[f.riskScore]}">risk ${f.riskScore}/4</span>
          <span class="nsp-count">${f.facilityCount.toLocaleString()} facilities</span>
        </div>`).join('');
    return `<section class="nsp-section"><h3>Facility Risk Map</h3>${items}</section>`;
  }

  private buildNonProliferationSection(entries: NonProliferationEntry[]): string {
    const items = entries.length === 0
      ? '<div class="nsp-empty">No non-proliferation status data</div>'
      : entries.map((e) => `
        <div class="nsp-np-item">
          <span class="nsp-state">${escapeHtml(e.state)}</span>
          <span class="nsp-treaty">${escapeHtml(e.treaty)}</span>
          <span class="nsp-compliance" style="color:${COMPLIANCE_COLOR[e.status]}">${escapeHtml(e.status)}</span>
          <span class="nsp-inspect">IAEA: ${escapeHtml(e.inspectionStatus)}</span>
          ${e.note ? `<span class="nsp-note">${escapeHtml(e.note)}</span>` : ''}
        </div>`).join('');
    return `<section class="nsp-section"><h3>Non-Proliferation Status</h3>${items}</section>`;
  }
}

// ── Formatting helpers ───────────────────────────────────────────────────

function formatRelative(timestamp: number): string {
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

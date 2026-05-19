import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// ── Types ────────────────────────────────────────────────────────────────

export interface SquawkEntry {
  callsign: string;
  squawkCode: string;
  altitude: number;
  lat: number;
  lon: number;
  timestamp: number;
}

export interface AirspaceRestriction {
  id: string;
  type: 'TFR' | 'NOTAM' | 'PROHIBITED' | 'RESTRICTED';
  name: string;
  region: string;
  activeUntil?: number;
}

export interface ConflictOverflightRisk {
  region: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  activeConflicts: number;
  recommendation: string;
}

export interface AshAdvisory {
  volcanoName: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  affectedFlightLevels: string;
  region: string;
}

export interface DiversionEntry {
  airport: string;
  iata: string;
  reason: string;
  delayMinutes: number;
  diversionCount: number;
}

export interface AviationSuperpowerData {
  squawks: SquawkEntry[];
  restrictions: AirspaceRestriction[];
  conflictZones: ConflictOverflightRisk[];
  ashAdvisories: AshAdvisory[];
  diversions: DiversionEntry[];
}

// ── Constants ─────────────────────────────────────────────────────────────

const EMERGENCY_SQUAWK_CODES = new Set(['7500', '7600', '7700']);

const RISK_COLOR: Record<ConflictOverflightRisk['riskLevel'], string> = {
  LOW: 'var(--severity-low, #4caf50)',
  MEDIUM: 'var(--severity-medium, #facc15)',
  HIGH: 'var(--severity-high, #fb923c)',
  CRITICAL: 'var(--severity-critical, #ef4444)',
};

const SQUAWK_LABEL: Record<string, string> = {
  '7500': 'Hijack',
  '7600': 'Radio Failure',
  '7700': 'Mayday',
};

const ASH_SEVERITY_COLOR: Record<AshAdvisory['severity'], string> = {
  LOW: 'var(--severity-low, #4caf50)',
  MEDIUM: 'var(--severity-medium, #facc15)',
  HIGH: 'var(--severity-critical, #ef4444)',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

// ── Panel ─────────────────────────────────────────────────────────────────

export class AviationSuperpowerPanel extends Panel {
  constructor() {
    super({
      id: 'aviation-superpower',
      title: 'Aviation Superpower',
      showCount: true,
      trackActivity: true,
    });
  }

  refresh(data?: Partial<AviationSuperpowerData>): void {
    const squawks = safe(() => data?.squawks ?? []) ?? [];
    const restrictions = safe(() => data?.restrictions ?? []) ?? [];
    const conflictZones = safe(() => data?.conflictZones ?? []) ?? [];
    const ashAdvisories = safe(() => data?.ashAdvisories ?? []) ?? [];
    const diversions = safe(() => data?.diversions ?? []) ?? [];

    const html = this.buildHtml({ squawks, restrictions, conflictZones, ashAdvisories, diversions });
    this.setContent(html);
    this.setCount(squawks.filter(s => EMERGENCY_SQUAWK_CODES.has(s.squawkCode)).length);
    this.markFresh();
  }

  buildHtml(data: AviationSuperpowerData): string {
    return `<div class="aviation-superpower">
      ${this.buildSquawkSection(data.squawks)}
      ${this.buildRestrictionsSection(data.restrictions)}
      ${this.buildConflictSection(data.conflictZones)}
      ${this.buildAshSection(data.ashAdvisories)}
      ${this.buildDiversionSection(data.diversions)}
    </div>`;
  }

  private buildSquawkSection(squawks: SquawkEntry[]): string {
    const items = squawks.length === 0
      ? '<div class="asp-empty">No active emergency squawks</div>'
      : squawks.map(s => `
        <div class="asp-squawk-item">
          <span class="asp-callsign">${escapeHtml(s.callsign)}</span>
          <span class="asp-code">${escapeHtml(s.squawkCode)}</span>
          ${SQUAWK_LABEL[s.squawkCode] ? `<span class="asp-label">${escapeHtml(SQUAWK_LABEL[s.squawkCode] ?? '')}</span>` : ''}
          <span class="asp-alt">${s.altitude.toLocaleString()} ft</span>
        </div>`).join('');
    return `<section class="asp-section"><h3>Emergency Squawk Tracker</h3>${items}</section>`;
  }

  private buildRestrictionsSection(restrictions: AirspaceRestriction[]): string {
    const items = restrictions.length === 0
      ? '<div class="asp-empty">No active restrictions</div>'
      : restrictions.map(r => `
        <div class="asp-restriction-item">
          <span class="asp-type">${escapeHtml(r.type)}</span>
          <span class="asp-name">${escapeHtml(r.name)}</span>
          <span class="asp-region">${escapeHtml(r.region)}</span>
        </div>`).join('');
    return `<section class="asp-section"><h3>Airspace Restrictions</h3>${items}</section>`;
  }

  private buildConflictSection(zones: ConflictOverflightRisk[]): string {
    const items = zones.length === 0
      ? '<div class="asp-empty">No active conflict zones</div>'
      : zones.map(z => `
        <div class="asp-conflict-item">
          <span class="asp-region">${escapeHtml(z.region)}</span>
          <span class="asp-risk" style="color:${RISK_COLOR[z.riskLevel]}">${escapeHtml(z.riskLevel)}</span>
          <span class="asp-rec">${escapeHtml(z.recommendation)}</span>
        </div>`).join('');
    return `<section class="asp-section"><h3>Conflict Zone Overflight Risk</h3>${items}</section>`;
  }

  private buildAshSection(advisories: AshAdvisory[]): string {
    const items = advisories.length === 0
      ? '<div class="asp-empty">No active ash advisories</div>'
      : advisories.map(a => `
        <div class="asp-ash-item">
          <span class="asp-volcano">${escapeHtml(a.volcanoName)}</span>
          <span class="asp-sev" style="color:${ASH_SEVERITY_COLOR[a.severity]}">${escapeHtml(a.severity)}</span>
          <span class="asp-fl">${escapeHtml(a.affectedFlightLevels)}</span>
          <span class="asp-region">${escapeHtml(a.region)}</span>
        </div>`).join('');
    return `<section class="asp-section"><h3>Volcanic Ash Advisory</h3>${items}</section>`;
  }

  private buildDiversionSection(diversions: DiversionEntry[]): string {
    const items = diversions.length === 0
      ? '<div class="asp-empty">No active diversions</div>'
      : diversions.map(d => `
        <div class="asp-diversion-item">
          <span class="asp-airport">${escapeHtml(d.airport)}</span>
          <span class="asp-iata">${escapeHtml(d.iata)}</span>
          <span class="asp-reason">${escapeHtml(d.reason)}</span>
          <span class="asp-delay">${d.delayMinutes} min</span>
        </div>`).join('');
    return `<section class="asp-section"><h3>Diversion &amp; Delay Index</h3>${items}</section>`;
  }
}
